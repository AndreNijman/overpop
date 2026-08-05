# OVERPOP — engine contract

This document is **frozen**. Every phase after P1 codes against these signatures.
If you must change something here, change it deliberately, bump the *Revision*
below, and re-run `node tools/harness.mjs --all` — a silent divergence between
this file and the code is the single most expensive failure mode in this project.

**Revision:** 3 · 2026-08-05 — effects and regen tick *before* movement, so a new slow bites the same tick

---

## 0. Hard constraints

| Constraint | Why |
|---|---|
| Vanilla JS. No dependencies, no build step, no bundler. | House style — matches `AndreNijman/pvz` and `AndreNijman/topout`. |
| **Classic `<script src>` only. No ES modules in the browser bundle.** | The game must run by double-clicking `index.html`. ES modules fail under `file://` (CORS). This is a documented feature of the sibling game, not an accident. |
| Every file wraps itself in an IIFE and attaches to the single global `OP`. | No leaked top-level bindings, no load-order surprises beyond the declared one. |
| All art drawn procedurally on canvas. All audio synthesised in WebAudio. | Zero asset files. |
| Sim state is **plain serialisable data**. No closures, no object references between entities. | Mid-round save/resume (P8.1) and determinism checksums both require it. Entities reference definitions by `key` string, never by object. |
| The sim reads randomness **only** from `sim.rng`. | Determinism. Render and audio may use `Math.random()` freely — they can never feed back into sim state. |

### File preamble (every JS file, no exceptions)

```js
;(function (OP) {
  'use strict'
  // ...
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
```

### Units

| Quantity | Unit |
|---|---|
| Space | Logical units. The play field is **1280 × 720**; the renderer scales to fit. |
| Time | Seconds. |
| Tick | Fixed **1/60 s**. `OP.DT = 1 / 60`. |
| Speed | Units per second. `OP.BASE_SPEED = 46` is the reference (a red balloon). |

---

## 1. Track — polyline with a scalar `t`

Everything positional derives from one number per balloon: `t`, the distance
travelled along its path. Get this right and targeting, leaks, and child spawning
all fall out for free.

```js
OP.Track = function (points, opts)      // points: [{x,y}, ...] in order, entry -> exit
OP.Track.prototype = {
  length,                               // total arc length, units
  posAt(t)      -> {x, y},              // clamped to [0, length]
  angleAt(t)    -> radians,             // heading, for sprite rotation
  segmentAt(t)  -> segmentIndex,
  sample(step)  -> [{x,y}, ...]         // for the terrain painter
}
```

Derived facts — **do not reimplement these anywhere else**:

- **Leak:** `balloon.t >= track.length`
- **Remaining distance:** `track.length - balloon.t`
- **First** = smallest remaining. **Last** = largest remaining. Comparing
  *remaining* rather than raw `t` is what makes multi-path maps correct.
- **Children** spawn at the parent's exact `t`, fanned by `OP.CHILD_SPREAD` so
  they don't perfectly overlap.

A map exposes `paths: [Track, ...]`. Each balloon carries `pathIndex`. Balloons
never change path.

---

## 2. Balloons — a layer index, not an entity

A balloon is a *tier index* plus position and state. Popping a layer means
decrementing to the child tier, not destroying and recreating an object — except
where a tier has multiple children, which spawns new entities.

```js
// js/data/balloons.js — OP.BALLOON_TIERS, ordered weakest -> strongest
{
  key: 'ceramic',
  name: 'Ceramic',
  hp: 10,                 // layer HP. 1 for simple balloons, >1 for ceramic and blimps
  speed: 2.5,             // multiplier on OP.BASE_SPEED
  radius: 9,
  blimp: false,           // true => rendered as a blimp, immune to knockback, ability targets
  children: [{ tier: 'rainbow', count: 2 }],   // ordered list; [] for red
  immune: [],             // damage-type keys this tier ignores entirely
  props: 0,               // intrinsic OP.PROP.* bitmask (e.g. WRAITH is born veiled)
  cash: 1                 // cash per layer popped, before difficulty scaling
}
```

Roster: `red · blue · green · yellow · pink · black · white · purple · lead ·
zebra · rainbow · ceramic`, then the blimp class in RBE order:
**`GOLIATH · WRAITH · LEVIATHAN · COLOSSUS · OMEN`**.

`WRAITH` is born `VEILED`, is fast, and ignores `SHARP` and `EXPLOSIVE` — the
composite threat tier. `OMEN` is the final blimp, spawns a mixed child list, and
is `abilityImmune` so no single ability can delete it.

RBE (red-balloon-equivalent) is **computed** from the tree, never hardcoded:

```js
OP.balloonRBE(tierKey) -> number     // hp + sum(children[].count * RBE(child))
```

The harness asserts RBE is **non-decreasing** across the roster (`black`,
`white` and `purple` tie at 11; `lead` and `zebra` tie at 23) and that the
recursion terminates. A hardcoded RBE table would rot the moment anyone tunes HP.

### Properties (bitmask)

```js
OP.PROP = { VEILED: 1, REGEN: 2, PLATED: 4 }
```

- **VEILED** — untargetable unless the tower has `camoDetect`. Not damage immunity;
  a camo balloon caught in an AoE from a non-detecting tower still takes nothing,
  because it was never a valid target. Detection is a *targeting* gate, enforced in
  `OP.Targeting.acquire` and in AoE candidate filtering — both, or camo leaks.
- **REGEN** — climbs back one layer every `OP.REGEN_PERIOD` seconds, up to the tier
  it spawned as. Regen never crosses a split boundary.
- **PLATED** — doubles layer HP. Applies to the current layer only; children
  inherit `PLATED` and get their own doubled HP.

Properties propagate to children in full — including `VEILED` on `WRAITH`
children, which is the point of that tier. `REGEN` is inherited but its timer
restarts, because the child is a fresh layer.

---

## 3. Damage — a table, never an `if`-chain

```js
// js/data/damage-types.js
OP.DMG = { NORMAL:'normal', SHARP:'sharp', EXPLOSIVE:'explosive', FIRE:'fire',
           COLD:'cold', PLASMA:'plasma', ENERGY:'energy', SHATTER:'shatter',
           ACID:'acid', VOID:'void' }
```

| Tier | Ignores |
|---|---|
| `black`, `zebra` | `EXPLOSIVE` |
| `white`, `zebra` | `COLD` |
| `lead` | `SHARP` |
| `purple` | `FIRE`, `PLASMA`, `ENERGY` |
| `WRAITH` | `SHARP`, `EXPLOSIVE` |

One universal override, and it is the only one:

- `VOID` ignores **all** immunities. Reserved for paragon-tier effects.

`SHATTER` deliberately needs no override: **no tier resists it.** That is the
mechanic — a sharp-damage tower whose upgrade converts its damage type to shatter
thereby gains the answer to Lead, with no special case in the resolver. Prefer
this shape for any future "counters X" upgrade.

```js
OP.canDamage(tierKey, dmgType) -> bool
```

### The layer-cascade rule

This is the rule naive clones get wrong, so it is stated exactly:

> Damage cascades down **single-child chains only**. It stops at any split.

- Damage 2 on a `green` → pops green, pops blue, leaves red.
  (`green→blue→red` is a single-child chain.)
- Damage 5 on a `pink` → clears it entirely.
- Damage 5 on a `black` → pops the black layer only. Two pinks spawn **intact**;
  the remaining 4 damage is **discarded**, because `black` splits.
- Damage 15 on a `ceramic` → 10 consumed by its layer HP, 5 discarded, two
  rainbows spawn intact.
- Each layer in a cascade is immunity-checked independently. A cascade halts the
  moment it reaches a layer immune to the incoming type.

Excess damage is **not** how you kill clusters — **pierce** is. A projectile that
pops a balloon may hit the resulting children in the same tick, spending one pierce
per child (see §4).

```js
OP.Damage.hit(sim, balloon, hit) -> {
  damaged, layersPopped, cashEarned, destroyed, spawned: [ids], absorbed
}
// hit: { damage, dmgType, sourceId, effects, ignoreImmunity, instaKill }

OP.Damage.blast(sim, x, y, radius, hit, opts) -> { hits, popped }
// opts: { camoDetect, falloff, maxTargets, exclude:Set }
```

`OP.Damage.hit` is the **only** function permitted to mutate balloon HP or tier.
Status effects on a hit land even when the damage itself is blanked by an
immunity — a glue shot still glues a lead balloon.

---

## 4. Projectiles — per-projectile hit sets

```js
OP.Projectiles.spawn(sim, {
  x, y, vx, vy,
  kind,                  // render key
  damage, dmgType, pierce,
  radius,                // collision radius
  life,                  // seconds before expiry
  ownerId,               // tower id, for pop attribution and buff sourcing
  effects: [],           // status effects applied on hit
  blastRadius,           // > 0 => AoE, resolved via OP.Projectiles.blast
  blastOnExpiry,         // bool
  homing, turnRate, targetId,
  onHit,                 // optional string key into OP.PROJ_BEHAVIOURS, NOT a closure
  data                   // plain-object bag for behaviour state
})
```

Non-negotiable rules:

1. **A projectile must never hit the same balloon twice.** Each carries
   `hits` — a Set of balloon ids. Skipping this silently doubles every tower's DPS
   and the bug is invisible until you profile damage.
2. **Pierce counts distinct balloons**, not collision events.
3. **Swept collision.** Test the segment from previous to current position against
   balloon circles. At round 80+ balloons move further than their own diameter per
   tick and per-frame point tests let them phase through towers.
4. **Pooled.** `sim.projectiles` is a free-list with `alive` flags. No allocation
   in the hot loop.
5. `onHit` is a **string key** into a registry, never a function reference —
   otherwise the sim stops being serialisable.

Children spawned by a pop are appended to `sim.balloons` and inserted into the
spatial grid **immediately**, so a projectile with pierce left can hit them this
tick. Projectiles are processed in ascending id order, which keeps that
deterministic.

---

## 5. Targeting

```js
OP.Targeting.acquire(sim, tower, mode) -> balloonId | -1
OP.TARGET_MODES = ['first','last','close','strong']   // plus tower-specific extras
```

- `first` — min remaining distance. `last` — max remaining. `close` — min distance
  to tower. `strong` — max `OP.balloonRBE(tier)`, ties broken by `first`.
- Candidates come from `OP.Grid.queryCircle(sim.grid, tower.x, tower.y, range)`.
- **Camo gate:** a candidate with `PROP.VEILED` is excluded unless
  `tower.s.camoDetect`. Enforced here *and* in AoE candidate filtering.
- **Line of sight:** if the map declares LOS blockers and the tower is not
  `s.ignoresLOS`, the segment tower→balloon must not cross a blocker.
- Ties break on **ascending balloon id**. Never on iteration order.

---

## 6. Tower module contract

This is the interface the P3 fan-out writes against. One file per tower.

```js
OP.defineTower({
  key: 'acorn-fox',                 // stable id; also the save-file key
  name: 'Acorn Fox',
  family: 'primary',                // primary | military | magic | support
  blurb: 'Throws acorns. Cheap, honest, scales further than it looks.',

  cost: 200,                        // MEDIUM cost; other difficulties scale (§8)
  footprint: 12,                    // placement collision radius
  placement: 'land',                // land | water | any
  unlockRound: 0,

  base: {
    range: 100,
    cooldown: 0.95,                 // seconds between shots
    damage: 1,
    pierce: 2,
    dmgType: OP.DMG.SHARP,
    projSpeed: 350,
    projLife: 1.2,
    projRadius: 4,
    camoDetect: false,
    targetModes: ['first','last','close','strong'],
    shots: 1,                       // projectiles per fire()
    spread: 0                       // radians of arc across shots
  },

  paths: [
    { name: 'Sharpened', tiers: [ /* exactly 5 */ {
        name: 'Whittled Points',
        cost: 140,
        desc: 'Shown verbatim in the upgrade panel.',
        apply (s) { s.pierce += 1 }        // mutate the resolved stat object
      } ] },
    { name: 'Quick Paws', tiers: [ /* 5 */ ] },
    { name: 'Long Throw', tiers: [ /* 5 */ ] }
  ],

  fire (sim, tower) { /* required — emit projectiles via OP.Projectiles.spawn */ },
  update (sim, tower, dt) { /* optional — for towers with non-projectile behaviour */ },
  onPlace (sim, tower) { /* optional */ },
  onSell (sim, tower) { /* optional */ }
})
```

### Stat resolution — order is fixed

`tower.s` is recomputed whenever upgrades or buffs change, never per tick:

1. Deep-clone `base`.
2. Apply purchased upgrades: **path order 0→1→2, tier order 1→5**, calling each
   `apply(s, tower, sim)`.
3. Collect external buffs, then apply them **once** (see below).
4. Freeze the object in debug builds.

### Buffs must be idempotent and order-independent

A support tower does not reach into a neighbour and mutate it. It *registers* a
modifier; resolution collects and applies them in one deterministic pass:

```js
OP.Buffs.register(sim, {
  id,                    // stable, unique per source+kind
  sourceId,
  radius,                // or 'global'
  priority,              // resolution order tiebreak
  mods: {
    rangeMul, rangeAdd, cooldownMul, damageAdd, damageMul,
    pierceAdd, camoDetect, dmgTypeSet, projSpeedMul
  }
})
```

Additive mods sum; multiplicative mods multiply; `dmgTypeSet` takes the highest
`priority`, tie-broken by ascending `id`. Two villages overlapping must produce
the same stats regardless of which was placed first — the harness tests exactly
this, in both placement orders.

### Crosspath rules

```js
OP.canBuyUpgrade(tower, pathIdx) -> bool
```

Two rules, and they compose:

1. **At most one path may exceed tier 2.**
2. **At most two paths may have any upgrades at all.**

Legal maxima are therefore `5-2-0` and its permutations. The upgrade panel must
render locks honestly — a greyed button with a reason, not a hidden one.

### Abilities

A tier-4 or tier-5 `apply` may attach:

```js
s.ability = { name, cooldown, duration, key: 'ability-registry-key' }
```

Cooldowns tick in the sim, activation routes through `OP.ABILITIES[key]`. Again:
a **string key**, not a closure, or the sim stops serialising.

---

## 7. Sim update order

Fixed timestep with an accumulator. This order is **frozen** — reordering it
changes behaviour subtly and breaks every recorded determinism checksum.

```
 1. sim.tick++, sim.time += DT
 2. round runner — release queued balloons for this tick
 3. status effects tick — durations, damage-over-time, recompute speedMul
 4. regen tick — REGEN balloons climb back a layer
 5. balloon movement: t += speed * speedMul * DT; recompute x,y from track
 6. leak check: t >= length  ->  lives -= remaining RBE, remove
 7. rebuild spatial grid from live balloons
 8. towers: cooldown tick, acquire target, fire
 9. projectiles: sweep, collide, damage, cascade, insert children into grid
10. AoE / blast resolution
11. abilities: cooldown tick, queued activations
12. compaction — free dead entities back to their pools
13. economy: leak charges, round-end payouts, banked interest
14. checksum accumulation (harness only)
```

**Effects tick before movement, deliberately.** If movement ran first, a slow or
stun applied on tick N would not bite until tick N+1, and children inheriting a
freeze from a split would each get one free tick at full speed. Both are small,
both are the kind of thing that turns into an unreproducible leak report.

```js
OP.Sim.create(config) -> sim
OP.Sim.step(sim)                    // exactly one fixed tick
OP.Sim.advance(sim, wallDt)         // accumulator; calls step() 0..n times
OP.Sim.serialize(sim)   -> plain object
OP.Sim.deserialize(obj) -> sim      // must round-trip exactly
OP.Sim.checksum(sim)    -> uint32   // order-insensitive fold over entity state
```

`sim.speed` ∈ {1, 2, 3} multiplies how many steps `advance` runs. It never
changes `DT`.

---

## 8. Difficulty & mode scaling

```js
// js/data/difficulties.js
{ key:'medium', name:'Medium', lives:150, cash:650, costMul:1.00,
  rounds:[1,60], cashPerPopMul:1.00 }
```

| Difficulty | Lives | Start cash | Cost × | Rounds |
|---|---|---|---|---|
| Easy | 200 | 650 | 0.85 | 1–40 |
| Medium | 150 | 650 | 1.00 | 1–60 |
| Hard | 100 | 650 | 1.08 | 3–80 |
| Relentless | 1 | 650 | 1.20 | 6–100 |

Modes layer on top as pure config deltas — never as branches inside the sim:

`Standard · Primary Only · Military Only · Magic Only · Deflation · Onslaught ·
Half Cash · Double HP Blimps · Alternate Waves · Reverse · PURIST`

**PURIST** = no continues, no lives regained, no income towers, no powers, no
selling. It is the honesty check on the whole balance pass.

---

## 9. Render contract

```js
OP.Render.frame(sim, ctx, view)
```

- **Render must never mutate sim state.** Not a style preference — the harness
  runs the sim with no renderer at all and checksums must be identical.
- Interpolation for smooth motion uses `sim.accumulator / DT` as alpha, reading
  entity `prevX/prevY`. Never advance the sim to draw a frame.
- Static map layers paint once into an offscreen canvas and blit.
- No per-entity `createLinearGradient` or `shadowBlur` in the hot path — that is
  what actually kills canvas2D at 500+ entities, not the entity count.

---

## 10. Harness

```sh
node tools/harness.mjs --list
node tools/harness.mjs --suite balloons
node tools/harness.mjs --all
node tools/harness.mjs --playthroughs
```

`tools/loadgame.mjs` parses the **ordered `<script src>` list out of
`index.html`**, concatenates those files, and evaluates them in a Node VM with a
stubbed `window`/`document`/canvas. Consequences worth stating:

- The harness tests the exact bundle that ships. No parallel Node-only build.
- Script **order** becomes a real, failing test (`--suite scriptorder`). With
  classic scripts there is no module resolver to save you.
- Any file that touches a real DOM API at load time breaks the harness — which is
  the correct signal, because it would also break under `file://` in a cold cache.

Determinism is asserted by running the same seed twice and comparing
`OP.Sim.checksum`. Playthroughs assert both directions: a reference build must
survive, and a deliberately bad build must leak.

---

## 11. Naming

Mechanics are not protectable; names and characters are. Every proper noun in this
project is original, and no asset, string, or sprite is derived from any
commercial game.

- Enemies are **balloons** (generic noun). Simple tiers are colours; the blimp
  class is `GOLIATH / LEVIATHAN / COLOSSUS / WRAITH / OMEN`.
- Towers are **woodland critters** with original names (Acorn Fox, Elder Owl,
  Berry Warren, …).
- Properties are **VEILED / REGEN / PLATED**.
- Hardest difficulty is **Relentless**; the no-safety-net mode is **PURIST**.

Do not introduce a name from any commercial tower-defense game into this codebase,
including in comments.

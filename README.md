# OVERPOP 🎈

A free, completely original **round-based tower defense game** in the spirit of
Bloons TD 6 — built from nothing but a canvas element.

**▶ Play it: <https://overpop.andrenijman.com/>** — desktop and mobile. On Android,
open it in Chrome and choose *Add to Home screen* to install it as an app.

> **Not affiliated with, endorsed by, or connected to Ninja Kiwi.**
> OVERPOP is an original homage. Every line of code, every sprite (drawn
> procedurally on canvas) and every sound (synthesised with WebAudio) was created
> from scratch for this project. It contains **no assets, names, or text from any
> commercial game.** Towers are woodland critters with original names; the blimp
> class, in RBE order, is GOLIATH / WRAITH / LEVIATHAN / COLOSSUS / OMEN. Mechanics are not
> protectable; names and characters are, and none are borrowed here.

## What's in it

- **25 towers** across four families — Primary, Military, Magic, Support — each
  with a **three-branch, five-tier upgrade tree** (375 upgrades total) and real
  crosspath rules: at most one branch past tier 2, at most two branches touched.
- **Paragon tier** for six of the twenty-five towers: sacrifice your investment in
  a tower type to fuse a single degree-scaled tier-6 version of it, where the
  degree (1–100) comes from the cash, upgrade tiers and pops you gave up. The six,
  and nothing else, are:
  - `acorn-fox` → **Stonecrown Vulpine** — a wide fan of ricocheting stone acorns
  - `frost-hare` → **Rimecrown Hare** — freezes and holds a whole track corner
  - `longshot-lynx` → **Horizonshot Lynx** — a steering round per threat, map-wide
  - `howitzer-mole` → **Bastion Mole** — a scattered salvo on its own aim point
  - `elder-owl` → **Eclipse Owl** — a closed ring of detonating bolts
  - `berry-warren` → **Thornhold Warren** — pays out a fortune, and finally fights
- **8 heroes**, one per game, levelling to 20 off pops and round survival, each
  with a distinct mechanical identity rather than a stat curve.
- **100 rounds** of balloons and blimps plus **endless freeplay** beyond, with a
  second **Alternate Waves** round set.
- **16 maps** from beginner to expert — multi-path tracks, water placement,
  line-of-sight blockers and removable obstacles.
- **Damage types and immunities that actually matter**: lead shrugs off sharp,
  black ignores explosions, white ignores cold, zebra ignores both, purple ignores
  fire/plasma/energy. Plus **VEILED** (needs detection), **REGEN** (climbs back)
  and **PLATED** (double layer HP).
- **4 difficulties** — Easy, Medium, Hard, Relentless — and **11 game modes**:
  Standard, Primary Only, Military Only, Magic Only, Deflation, Onslaught,
  Half Cash, Double HP Blimps, Alternate Waves, Reverse, and **PURIST** (no
  continues, no income, no selling, one life).
- **Activated abilities** on tier-4 and tier-5 upgrades, on real cooldowns.
- Targeting priorities per tower, 1×/2×/3× speed, mid-round **save and resume**.
- **PWA**: installable, fully offline, progress saved locally.
- Zero dependencies, zero build step, zero network calls at runtime.

## What's deliberately not in it

Stated plainly, because "full-featured clone" usually hides a list like this:

- **No co-op multiplayer.** It's a single-player game.
- **No persistent meta-progression tree.** No account-wide power creep that makes
  early rounds trivial for veterans — balance is per-run.
- **No gacha / collection / insta-tower economy.**
- **No boss events, odysseys, races, or contested territory.**
- **Consumable powers are absent by design**, which is also what makes the PURIST
  mode an honest measure of a build.

## How to run it

1. **Just open it** — double-click `index.html`. The whole game runs from
   `file://`. This is why the codebase uses classic `<script>` tags and not ES
   modules, and it is a constraint, not an oversight.
2. Or serve the folder: `python3 -m http.server 8000` — needed if you want the
   service worker and offline install to engage.

## How it's built

| | |
|---|---|
| Language | Vanilla JavaScript, no dependencies, no build step |
| Rendering | One 1280×720 canvas, everything drawn in code |
| Audio | WebAudio synthesis, no sample files |
| Simulation | Fixed 1/60 s timestep, seeded RNG, fully deterministic |
| Verification | Headless Node harness that loads the real shipped bundle |

Two documents matter if you're reading the source:

- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — the frozen engine contract. Track
  model, balloon layer model, the damage cascade rule, the tower module
  interface, buff resolution, and the exact simulation update order.
- **[`RESUME.md`](RESUME.md)** — how the build itself is paused and resumed.
  Progress lives in `BUILD_STATE.json`, every step has a verify command, and
  `node tools/state.mjs brief` reconstructs the full picture from disk.

## Verifying it

The sim is deterministic, so the game can be tested without playing it:

```sh
node tools/harness.mjs --list                 # available suites
node tools/harness.mjs --all                  # every suite
node tools/smoke.mjs                          # real browser boot and play
node tools/playthroughs.mjs --rounds 100      # difficulty x mode matrix
node tools/state.mjs verify all               # do all completed build steps still pass?
```

Playthroughs assert in both directions: a reference build has to hold, and a
deliberately inadequate build has to leak. Asserting only the first would be
satisfied by a game where nothing can ever leak. Determinism is checked by running
the same seed twice, and by saving mid-run and confirming the reloaded game stays in
lockstep with the one that was never interrupted.

**[`docs/VERIFICATION.md`](docs/VERIFICATION.md)** explains each layer and — more
usefully — what it cannot catch.

## Licence & credits

Built by [Andre Nijman](https://andrenijman.com/). More games at
[games.andrenijman.com](https://games.andrenijman.com/).

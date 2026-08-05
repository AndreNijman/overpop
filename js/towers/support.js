/* The support family. Five towers that mostly do not shoot: they print cash,
 * seed the track with hazards, make their neighbours better, or send something
 * out to hunt on its own.
 *
 * ─── HOUSE RULES THIS FILE OBEYS ──────────────────────────────────────────────
 *
 * 1. BUFFS ARE REGISTERED ONLY FROM `def.buffs`. Nothing else in this file calls
 *    OP.Buffs.register or OP.Buffs.unregister*. This is not style — it is the
 *    only shape that survives a restat. `Towers.restatAll` calls
 *    `registerAuras`, which does `unregisterBySource(tower.id)` and then
 *    `def.buffs(sim, tower)`. A buff registered from `update()` is therefore
 *    silently deleted the next time ANY tower is placed, upgraded or sold.
 *    So `update()` only writes plain data into `tower.data` and raises
 *    `sim.buffsDirty`; `def.buffs` reads `tower.data` and is the sole registrar.
 *    That is how Tinker Shrew's *timed* overclock works: the registration is
 *    re-derived from data on every restat, and simply stops being re-derived
 *    when the timer in data runs out.
 *
 * 2. Inside `def.buffs`, `tower.s` is the UNBUFFED stat block (base + upgrades).
 *    All aura geometry is read from it, so two overlapping halls cannot compute
 *    different radii depending on which was placed first.
 *
 * 3. `apply(s, ...)` only ever touches `s`, and only with operations that are a
 *    pure function of `s` — `+=`, `*=`, absolute assignment, `Math.min`. Restat
 *    re-runs the whole tree from scratch on every change.
 *
 * 4. Timers live in `tower.data` as *elapsed* or *remaining* seconds only. The
 *    period is always re-read from `tower.s` each tick, so buying an upgrade
 *    mid-round takes effect immediately instead of latching a stale value.
 *
 * 5. No closures in entity state. Projectile behaviours and abilities are string
 *    keys into OP.PROJ_BEHAVIOURS / OP.ABILITIES, registered at file scope.
 *
 * 6. Every `kind` emitted is declared with OP.declareProjKind.
 */

;(function (OP) {
  'use strict'

  const M = OP.M
  const D = OP.DMG

  /* ---------- projectile art kinds ---------- */

  // A patch of thorns sitting on the track. Stationary: spawned with zero
  // velocity, killed by its own lifetime or by running out of pierce.
  OP.declareProjKind('thorn-patch', { shape: 'spike', tint: '#8e7a3f', size: 6 })
  // The same patch after Snapping Pods, which bursts instead of scratching.
  OP.declareProjKind('thorn-pod', { shape: 'blob', tint: '#6f8f3a', size: 7 })
  // A bolt from one of Tinker Shrew's little turrets.
  OP.declareProjKind('shrew-bolt', { shape: 'dart', tint: '#b9c6cf', size: 3, trail: true })
  // The bird's swipe. Very short-lived — it is a melee strike with a sprite.
  OP.declareProjKind('falcon-claw', { shape: 'slash', tint: '#e8ddc0', size: 7, spin: true })
  // Skyfall: the bird itself, dropped as a bomb.
  OP.declareProjKind('falcon-stoop', { shape: 'blob', tint: '#d8c48a', size: 10, trail: true })

  /* ---------- projectile behaviour ----------
     One shared hook: tear extra damage out of a blimp on contact. Used by both
     Ironbark Spines (thorns) and Blimp Hunter (the bird), because the mechanic is
     identical and a second copy would be a second place to fix. */

  OP.PROJ_BEHAVIOURS['support-shred'] = {
    onHit: function (sim, p, balloon, res) {
      if (!p.data || !(p.data.shred > 0)) return
      if (!balloon || !balloon.alive) return
      if (!OP.BALLOON_TIERS[balloon.tier].blimp) return
      OP.Damage.hit(sim, balloon, {
        damage: p.data.shred,
        dmgType: p.dmgType,
        sourceId: p.ownerId
      })
    }
  }

  /* ---------- shared helpers ---------- */

  /** The path this tower sits closest to, plus the nearest point on it. */
  function nearestPath (sim, x, y) {
    const paths = sim.map.paths
    let bestTrack = null
    let best = null
    for (let i = 0; i < paths.length; i++) {
      const near = paths[i].nearest(x, y)
      if (!best || near.dist < best.dist) { best = near; bestTrack = paths[i] }
    }
    return bestTrack ? { track: bestTrack, near: best } : null
  }

  /** How many of this tower's own hazards are still alive. */
  function ownedProjectiles (sim, towerId) {
    const list = sim.projectiles
    let n = 0
    for (let i = 0; i < list.length; i++) {
      if (list[i].alive && list[i].ownerId === towerId) n++
    }
    return n
  }

  /** Lay one hazard. Zero velocity: it sits where it is put until it expires. */
  function layThorn (sim, tower, s, x, y, life) {
    return OP.Projectiles.spawn(sim, {
      x: x, y: y, vx: 0, vy: 0,
      kind: s.blast > 0 ? 'thorn-pod' : 'thorn-patch',
      damage: s.damage,
      dmgType: s.dmgType,
      pierce: s.pierce,
      radius: s.projRadius,
      life: life,
      ownerId: tower.id,
      camoDetect: s.camoDetect,
      blastRadius: s.blast,
      behaviour: s.behaviour || '',
      data: s.shred > 0 ? { shred: s.shred } : null
    })
  }

  /** Empty a Berry Warren's bank into the player's cash. Returns what it paid. */
  function emptyBank (sim, tower) {
    const d = tower.data
    const amount = Math.floor(d.bank || 0)
    d.bank = 0
    if (amount > 0) OP.Economy.earn(sim, amount, tower.id)
    return amount
  }

  /* ---------- abilities ---------- */

  OP.ABILITIES['berry-collect'] = function (sim, tower) {
    emptyBank(sim, tower)
  }

  OP.ABILITIES['thorn-seedstorm'] = function (sim, tower) {
    const s = tower.s
    const found = nearestPath(sim, tower.x, tower.y)
    if (!found) return
    const track = found.track
    const n = 20
    for (let i = 0; i < n; i++) {
      const p = track.posAt(track.length * (i + 0.5) / n)
      layThorn(sim, tower, s, p.x, p.y, Math.max(s.projLife, 12))
    }
  }

  OP.ABILITIES['falcon-stoop'] = function (sim, tower) {
    const s = tower.s
    const d = tower.data
    const ids = []
    OP.Targeting.acquireMany(sim, tower, 'strong', 1, ids)
    const b = ids.length ? sim.byId.get(ids[0]) : null
    const x = d.bx === undefined ? tower.x : d.bx
    const y = d.by === undefined ? tower.y : d.by
    const tx = b ? b.x : tower.x
    const ty = b ? b.y : tower.y + 1
    OP.Projectiles.fireAt(sim, {
      x: x, y: y,
      kind: 'falcon-stoop',
      damage: 400,
      dmgType: D.SHATTER,
      pierce: 40,
      radius: 9,
      life: 1.2,
      maxRange: s.range * 1.5,
      ownerId: tower.id,
      camoDetect: true,
      blastRadius: 90,
      blastOnExpiry: true
    }, M.angleTo(x, y, tx, ty), 760)
  }

  /* ---------- roster ---------- */

  OP.FAMILY_ROSTERS.support = [
    'berry-warren',
    'caltrop-beetle',
    'warren-hall',
    'tinker-shrew',
    'falconer-ferret'
  ]

  /* ============================================================================
     1. BERRY WARREN — the income tower.

     PAYOUT CURVE, stated because this tower sets the pace of the whole game.
     A round takes roughly 30 seconds of wall time at speed 1.

       state    per harvest   period    per second   per round   payback
       0-0-0    $5            2.00s     $2.50        ~$75        ~7 rounds
       5-0-0    $74           0.84s     $88          ~$2,640     ~13 rounds
       0-5-0    $48 banked    2.00s     $24 + 45%/rd ~$1,000     ~15 rounds
       0-0-5    $7            2.00s     $3.50        ~$3,100     ~10 rounds

     The intent is that base Berry Warren pays for itself inside seven rounds —
     fast enough to be worth the tempo loss, slow enough that skipping defence to
     buy two of them loses the run. Every branch lands between ten and fifteen
     rounds of payback at tier 5, so no branch is the obvious money printer.
     ==========================================================================*/

  OP.defineTower({
    key: 'berry-warren',
    name: 'Berry Warren',
    family: 'support',
    blurb: 'A burrow under a bramble. The rabbits inside pick berries and sell them; they will not help you fight.',

    cost: 500,
    footprint: 18,
    placement: 'land',
    unlockRound: 0,
    income: true,

    base: {
      range: 70,
      cooldown: 4,             // unused: this tower has no fire()
      damage: 0,
      pierce: 1,
      dmgType: D.NORMAL,
      projSpeed: 0,
      projLife: 1,
      projRadius: 4,
      camoDetect: false,
      targetModes: ['first'],

      // income stats
      yield: 5,                // cash per harvest
      harvest: 2.0,            // seconds between harvests
      bankRate: 0,             // interest added to the bank each round end
      bankCap: 0,              // 0 => harvests are paid straight to the player
      lump: 0,                 // flat cash at the end of every round
      lumpPerRound: 0          // extra flat cash per round already survived
    },

    paths: [
      {
        name: 'Richer Berries',
        tiers: [
          { name: 'Fat Berries', cost: 275,
            desc: '+$2 a harvest: $7 every 2 seconds instead of $5.',
            apply: function (s) { s.yield += 2 } },
          { name: 'Second Bush', cost: 525,
            desc: '+$3 a harvest: $10 every 2 seconds.',
            apply: function (s) { s.yield += 3 } },
          { name: 'Bramble Maze', cost: 1300,
            desc: 'Harvests 30% sooner — $10 every 1.4 seconds.',
            apply: function (s) { s.harvest *= 0.7 } },
          { name: 'Berry Glut', cost: 3500,
            desc: '+$14 a harvest: $24 every 1.4 seconds, about $500 a round.',
            apply: function (s) { s.yield += 14 } },
          { name: 'Everbearing Thicket', cost: 28000,
            desc: '+$50 a harvest and 40% sooner: $74 every 0.84 seconds, roughly $2,600 a round.',
            apply: function (s) { s.yield += 50; s.harvest *= 0.6 } }
        ]
      },
      {
        name: 'Berry Bank',
        tiers: [
          { name: 'Tidy Rows', cost: 225,
            desc: '+$1 a harvest: $6 every 2 seconds.',
            apply: function (s) { s.yield += 1 } },
          { name: 'Root Cellar', cost: 475,
            desc: '+$2 a harvest: $8 every 2 seconds.',
            apply: function (s) { s.yield += 2 } },
          { name: 'Berry Bank', cost: 1150,
            desc: 'Harvests go into a bank instead of your cash. The bank gains 15% interest at the end of every round and empties itself into your cash when it reaches $1,200.',
            apply: function (s) { s.bankRate = 0.15; s.bankCap = 1200 } },
          { name: 'Deep Cellar', cost: 3250,
            desc: 'The bank holds $4,000 and gains 25% interest a round. Adds Collect: empty the bank whenever you like, 20 second cooldown.',
            apply: function (s) {
              s.bankRate = 0.25
              s.bankCap = 4000
              s.ability = { name: 'Collect', cooldown: 20, duration: 0, key: 'berry-collect' }
            } },
          { name: 'Endless Larder', cost: 27750,
            desc: '+$40 a harvest, the bank holds $30,000 and gains 45% interest a round, and Collect recharges in 8 seconds.',
            apply: function (s) {
              s.yield += 40
              s.bankRate = 0.45
              s.bankCap = 30000
              s.ability = { name: 'Collect', cooldown: 8, duration: 0, key: 'berry-collect' }
            } }
        ]
      },
      {
        name: 'Autumn Glut',
        tiers: [
          { name: 'Sunnier Slope', cost: 250,
            desc: '+$2 a harvest: $7 every 2 seconds.',
            apply: function (s) { s.yield += 2 } },
          { name: 'Windfall', cost: 550,
            desc: '+$40 in your hand at the end of every round.',
            apply: function (s) { s.lump += 40 } },
          { name: 'Autumn Glut', cost: 1400,
            desc: 'The end-of-round windfall rises to $250.',
            apply: function (s) { s.lump += 210 } },
          { name: 'Harvest Festival', cost: 3750,
            desc: 'The end-of-round windfall becomes $600, plus $12 for every round you have already survived.',
            apply: function (s) { s.lump += 350; s.lumpPerRound += 12 } },
          { name: 'Cornucopia', cost: 28500,
            desc: 'The end-of-round windfall becomes $3,000, plus $80 for every round you have already survived.',
            apply: function (s) { s.lump += 2400; s.lumpPerRound += 68 } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      const d = tower.data
      d.h = 0            // seconds since the last harvest
      d.bank = 0
      // Only rounds cleared AFTER this burrow was dug pay it a windfall.
      d.rounds = sim.stats.roundsCleared
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      if (d.rounds === undefined) d.rounds = sim.stats.roundsCleared
      if (d.bank === undefined) d.bank = 0

      // Period is re-read from `s` every tick, so an upgrade lands immediately.
      d.h = (d.h === undefined ? 0 : d.h) + dt
      let guard = 0
      while (d.h >= s.harvest && guard++ < 64) {
        d.h -= s.harvest
        if (s.bankCap > 0) {
          d.bank = Math.min(s.bankCap, d.bank + s.yield)
          if (d.bank >= s.bankCap) emptyBank(sim, tower)
        } else {
          OP.Economy.earn(sim, s.yield, tower.id)
        }
      }

      // Round-end work. There is no per-tower round hook in the engine, so the
      // cleared-round counter is watched instead — it is plain sim state, so this
      // survives a mid-round save without paying twice.
      if (sim.stats.roundsCleared > d.rounds) {
        let owed = sim.stats.roundsCleared - d.rounds
        d.rounds = sim.stats.roundsCleared
        if (owed > 8) owed = 8
        for (let i = 0; i < owed; i++) {
          if (s.bankRate > 0 && d.bank > 0) {
            d.bank = Math.min(s.bankCap, Math.floor(d.bank * (1 + s.bankRate)))
          }
          if (s.lump > 0) {
            OP.Economy.earn(sim, s.lump + s.lumpPerRound * sim.roundIndex, tower.id)
          }
        }
      }
    }
  })

  /* ============================================================================
     2. CALTROP BEETLE — persistent hazards laid on the track.

     The hazards are ordinary projectiles with zero velocity and a long life, so
     they get swept collision, per-projectile hit sets and pierce accounting for
     free. `s.cooldown` is the laying period (this tower has no fire(), so the
     engine never reads it), which means a Warren Hall's cooldown aura genuinely
     makes the beetle work faster. `s.maxTraps` is what stops that from filling
     the projectile pool.
     ==========================================================================*/

  OP.defineTower({
    key: 'caltrop-beetle',
    name: 'Caltrop Beetle',
    family: 'support',
    blurb: 'Trundles along the verge dropping seed cases of hard thorns. Whatever walks over them regrets it.',

    cost: 400,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 130,              // how far from itself it will seed the track
      cooldown: 1.5,           // seconds between patches
      damage: 1,
      pierce: 5,
      dmgType: D.SHARP,
      projSpeed: 0,            // patches do not move
      projLife: 8,             // seconds a patch survives
      projRadius: 7,
      camoDetect: false,
      targetModes: ['first'],

      maxTraps: 3,             // live patches at once
      trapSpread: 40,          // units of track the patches are spread over
      blast: 0,                // > 0 => the patch bursts instead of scratching
      shred: 0                 // extra damage torn out of a blimp
    },

    paths: [
      {
        name: 'Deep Roots',
        tiers: [
          { name: 'Stubborn Thorns', cost: 220,
            desc: 'Patches last 14 seconds instead of 8.',
            apply: function (s) { s.projLife += 6 } },
          { name: 'Wider Scatter', cost: 420,
            desc: '5 patches on the track at once instead of 3, and +1 pierce each.',
            apply: function (s) { s.maxTraps += 2; s.pierce += 1 } },
          { name: 'Deep Roots', cost: 1040,
            desc: 'Patches last 35 seconds and spread over twice as much track.',
            apply: function (s) { s.projLife *= 2.5; s.trapSpread *= 2 } },
          { name: 'Ironwood Barbs', cost: 4000,
            desc: 'Patches last 90 seconds, 8 on the track at once, +2 damage.',
            apply: function (s) { s.projLife += 55; s.maxTraps += 3; s.damage += 2 } },
          { name: 'The Bramble Wall', cost: 28800,
            desc: 'Patches last 5 minutes, 14 on the track at once, +6 damage and +10 pierce.',
            apply: function (s) { s.projLife += 210; s.maxTraps += 6; s.damage += 6; s.pierce += 10 } }
        ]
      },
      {
        name: 'Snapping Pods',
        tiers: [
          { name: 'Sharper Points', cost: 180,
            desc: '+1 damage per patch.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Busy Beetle', cost: 380,
            desc: 'Lays patches 25% faster — one every 1.13 seconds.',
            apply: function (s) { s.cooldown *= 0.75 } },
          { name: 'Snapping Pods', cost: 920,
            desc: 'Patches become pods that burst for explosive damage in a 44 unit radius when something touches them. +1 damage. Black and Zebra balloons ignore explosions.',
            apply: function (s) { s.blast = 44; s.dmgType = D.EXPLOSIVE; s.damage += 1 } },
          { name: 'Thunder Pods', cost: 3600,
            desc: 'Burst radius 70, +4 damage, and lays a further 40% faster.',
            apply: function (s) { s.blast += 26; s.damage += 4; s.cooldown *= 0.6 } },
          { name: 'Seedstorm', cost: 27200,
            desc: 'Burst radius 110, +12 damage, 10 pods at once, and an ability that seeds the whole track with 20 pods at once.',
            apply: function (s) {
              s.blast += 40
              s.damage += 12
              s.maxTraps += 7
              s.ability = { name: 'Seedstorm', cooldown: 45, duration: 0, key: 'thorn-seedstorm' }
            } }
        ]
      },
      {
        name: 'Ironbark Spines',
        tiers: [
          { name: 'Hard Cases', cost: 200,
            desc: '+1 pierce per patch — 6 balloons per patch.',
            apply: function (s) { s.pierce += 1 } },
          { name: 'Grit Coating', cost: 440,
            desc: '+1 damage per patch.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Ironbark Spines', cost: 1120,
            desc: 'Patches deal shatter damage, which nothing in the air resists — Lead included. +1 damage.',
            apply: function (s) { s.dmgType = D.SHATTER; s.damage += 1 } },
          { name: 'Hull Rippers', cost: 4400,
            desc: 'Patches tear an extra 12 damage out of any blimp that touches them, and they catch Veiled balloons.',
            apply: function (s) { s.shred = 12; s.behaviour = 'support-shred'; s.camoDetect = true } },
          { name: 'Spine Forest', cost: 30000,
            desc: 'Extra blimp damage rises to 90, +10 damage, +8 pierce, and patches last 40 seconds.',
            apply: function (s) { s.shred += 78; s.damage += 10; s.pierce += 8; s.projLife += 32 } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      const d = tower.data
      d.lay = 0        // seconds until the next patch
      d.k = -1         // which of five spots along the track is next
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      d.lay = (d.lay === undefined ? 0 : d.lay) - dt
      if (d.lay > 0) return

      // The cap is what keeps a cooldown aura from filling the projectile pool.
      if (ownedProjectiles(sim, tower.id) >= s.maxTraps) { d.lay = 0.2; return }

      const found = nearestPath(sim, tower.x, tower.y)
      if (!found || found.near.dist > s.range) { d.lay = 0.5; return }

      // Five spots, walked in order. Deterministic on purpose: a patch landing
      // in the same place twice would waste the pierce of the one already there.
      d.k = ((d.k === undefined ? -1 : d.k) + 1) % 5
      const track = found.track
      const offset = s.trapSpread * (d.k / 4 - 0.5)
      const spot = track.posAt(M.clamp(found.near.t + offset, 0, track.length))
      let x = found.near.x
      let y = found.near.y
      if (M.dist2(tower.x, tower.y, spot.x, spot.y) <= s.range * s.range) { x = spot.x; y = spot.y }

      layThorn(sim, tower, s, x, y, s.projLife)
      d.lay = s.cooldown
    }
  })

  /* ============================================================================
     3. WARREN HALL — the village. A pure aura and nothing else.

     Every number the aura hands out is read from the UNBUFFED stat block inside
     `buffs()`, including the radius. That is the whole reason two halls sitting
     inside each other's radius resolve to the same stats in either build order:
     hall A's range buff on hall B cannot grow hall B's aura, because hall B's
     aura was measured before any buff was applied.
     ==========================================================================*/

  OP.defineTower({
    key: 'warren-hall',
    name: 'Warren Hall',
    family: 'support',
    blurb: 'A meeting hall dug into the hillside. Nobody inside fights; everybody outside fights better.',

    cost: 1200,
    footprint: 20,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 130,              // the aura radius
      cooldown: 1,             // unused: this tower has no fire()
      damage: 0,
      pierce: 1,
      dmgType: D.NORMAL,
      projSpeed: 0,
      projLife: 1,
      projRadius: 4,
      camoDetect: false,
      targetModes: ['first'],

      auraRange: 12,           // rangeAdd handed to everyone in radius
      auraPierce: 1,           // pierceAdd
      auraDamage: 0,           // damageAdd
      auraCooldown: 1,         // cooldownMul
      auraCamo: false,         // camoDetect
      auraDmgType: '',         // dmgTypeSet
      auraPriority: 0,         // who wins a dmgTypeSet argument
      auraGlobal: false        // radius becomes 'global'
    },

    paths: [
      {
        name: 'Watchtower',
        tiers: [
          { name: 'Long Eaves', cost: 660,
            desc: 'Nearby towers get +18 range instead of +12.',
            apply: function (s) { s.auraRange += 6 } },
          { name: 'Sharper Stock', cost: 1260,
            desc: 'Nearby towers get +2 pierce instead of +1.',
            apply: function (s) { s.auraPierce += 1 } },
          { name: 'Watchtower', cost: 3120,
            desc: 'Aura radius grows by 45, and nearby towers get +28 range.',
            apply: function (s) { s.range += 45; s.auraRange += 10 } },
          { name: 'Signal Fires', cost: 12000,
            desc: 'Nearby towers get +45 range, +3 pierce, and 12% off their attack cooldown.',
            apply: function (s) { s.auraRange += 17; s.auraPierce += 1; s.auraCooldown *= 0.88 } },
          { name: 'Grand Lookout', cost: 86400,
            desc: 'Aura radius grows by another 120. Nearby towers get +90 range, +6 pierce, +2 damage, and 25% more off their cooldown.',
            apply: function (s) {
              s.range += 120
              s.auraRange += 45
              s.auraPierce += 3
              s.auraDamage += 2
              s.auraCooldown *= 0.85
            } }
        ]
      },
      {
        name: 'Keen Watch',
        tiers: [
          { name: 'Cleared Brush', cost: 540,
            desc: 'Aura radius grows by 25.',
            apply: function (s) { s.range += 25 } },
          { name: 'Night Lanterns', cost: 1140,
            desc: 'Nearby towers get +1 damage.',
            apply: function (s) { s.auraDamage += 1 } },
          { name: 'Keen Watch', cost: 2760,
            desc: 'Nearby towers can see and shoot Veiled balloons, which they could not target at all before.',
            apply: function (s) { s.auraCamo = true } },
          { name: 'Lantern Ring', cost: 10800,
            desc: 'Aura radius grows by 60 and nearby towers get +2 more damage, for +3 in all.',
            apply: function (s) { s.range += 60; s.auraDamage += 2 } },
          { name: 'Unblinking Vigil', cost: 81600,
            desc: 'The aura covers the entire map. Every tower you own sees Veiled balloons and gains +7 damage, +40 range and +3 pierce.',
            apply: function (s) {
              s.auraGlobal = true
              s.auraDamage += 4
              s.auraRange += 28
              s.auraPierce += 2
            } }
        ]
      },
      {
        name: 'Forge Rites',
        tiers: [
          { name: 'Whetstones', cost: 600,
            desc: 'Nearby towers get +1 damage.',
            apply: function (s) { s.auraDamage += 1 } },
          { name: 'Bellows', cost: 1320,
            desc: 'Nearby towers get 10% off their attack cooldown.',
            apply: function (s) { s.auraCooldown *= 0.90 } },
          { name: 'Forge Rites', cost: 3360,
            desc: 'Nearby towers deal shatter damage instead of their own type. Nothing in the air resists shatter, Lead included.',
            apply: function (s) { s.auraDmgType = D.SHATTER; s.auraPriority = 10 } },
          { name: 'Deep Forge', cost: 13200,
            desc: 'Nearby towers get a further 22% off their cooldown — about 30% in all — and +2 damage.',
            apply: function (s) { s.auraCooldown *= 0.78; s.auraDamage += 2 } },
          { name: 'Hall of Embers', cost: 90000,
            desc: 'The shatter conversion overrides any other hall. Nearby towers also get +6 damage, +3 pierce, and a further 35% off their cooldown — about 55% in all.',
            apply: function (s) {
              s.auraDmgType = D.SHATTER
              s.auraPriority = 30
              s.auraDamage += 6
              s.auraPierce += 3
              s.auraCooldown *= 0.65
            } }
        ]
      }
    ],

    /* The only registrar. `tower.s` here is base + upgrades with NO buffs
       applied — the engine swaps it in for the duration of this call. */
    buffs: function (sim, tower) {
      const s = tower.s
      const mods = { rangeAdd: s.auraRange, pierceAdd: s.auraPierce }
      if (s.auraDamage) mods.damageAdd = s.auraDamage
      if (s.auraCooldown !== 1) mods.cooldownMul = s.auraCooldown
      if (s.auraCamo) mods.camoDetect = true
      if (s.auraDmgType) mods.dmgTypeSet = s.auraDmgType
      OP.Buffs.register(sim, {
        id: 'warren-hall:' + tower.id,
        sourceId: tower.id,
        x: tower.x, y: tower.y,
        radius: s.auraGlobal ? 'global' : s.range,
        priority: s.auraPriority,
        excludeSelf: true,
        mods: mods
      })
    },

    onPlace: function (sim, tower) {
      tower.data.boosted = 0
    },

    /* Bookkeeping for the tower panel: how many towers this hall is helping.
       Read from `tower.sBase`, not `tower.s`, so the number matches the radius
       that was actually registered even when another hall is buffing this one. */
    update: function (sim, tower, dt) {
      const d = tower.data
      d.pulse = (d.pulse === undefined ? 0 : d.pulse) + dt
      if (d.pulse < 0.5) return
      d.pulse = 0
      const base = tower.sBase || tower.s
      const global = !!base.auraGlobal
      const r2 = base.range * base.range
      let n = 0
      for (let i = 0; i < sim.towers.length; i++) {
        const other = sim.towers[i]
        if (other.id === tower.id) continue
        if (global || M.dist2(tower.x, tower.y, other.x, other.y) <= r2) n++
      }
      d.boosted = n
    }
  })

  /* ============================================================================
     4. TINKER SHREW — a timed buff, done honestly.

     A timed buff cannot be a one-shot mutation, because restat rebuilds every
     stat block from scratch whenever anything on the board changes. So the
     overclock lives as data:

       tower.data.boost = [ { id: <towerId>, t: <seconds left> }, ... ]

     `update()` ticks `t`, picks new victims, and raises `sim.buffsDirty` when
     that list changes. `buffs()` turns the list into registrations. A restat
     triggered by something completely unrelated therefore RE-DERIVES the
     overclock rather than losing it, and the overclock ends when the timer runs
     out because `buffs()` stops finding anything to register.

     Each registration is a one-unit-radius buff centred on its victim, which
     picks out exactly that tower: footprint checks keep any two towers much
     further apart than a single unit.
     ==========================================================================*/

  OP.defineTower({
    key: 'tinker-shrew',
    name: 'Tinker Shrew',
    family: 'support',
    blurb: 'Runs between your towers with a satchel of springs and grease, winding one of them up at a time.',

    cost: 550,
    footprint: 14,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 120,              // how far it will walk to overclock something
      cooldown: 1,             // unused: this tower has no fire()
      damage: 0,
      pierce: 1,
      dmgType: D.SHARP,        // the type its turrets shoot, once it has any
      projSpeed: 520,
      projLife: 1,
      projRadius: 4,
      camoDetect: false,
      targetModes: ['first'],

      boostCd: 0.70,           // cooldownMul handed to the overclocked tower
      boostTime: 3.0,          // seconds an overclock lasts
      boostPeriod: 7.0,        // seconds between overclocks
      boostCount: 1,           // towers overclocked at once
      boostDamage: 0,
      boostPierce: 0,
      boostRange: 0,
      boostCamo: false,

      turrets: 0,              // little autonomous turrets built beside it
      turretDamage: 0,
      turretPierce: 1,
      turretCd: 1.1,
      turretRange: 0,
      turretDmgType: ''        // '' => the shrew's own damage type
    },

    paths: [
      {
        name: 'Overclock',
        tiers: [
          { name: 'Oiled Gears', cost: 303,
            desc: 'The overclock takes 45% off the target’s attack cooldown instead of 30%.',
            apply: function (s) { s.boostCd -= 0.15 } },
          { name: 'Longer Winding', cost: 578,
            desc: 'The overclock lasts 5 seconds instead of 3.',
            apply: function (s) { s.boostTime += 2 } },
          { name: 'Overclock', cost: 1430,
            desc: '60% off the target’s cooldown, and the target also gets +2 damage while it lasts.',
            apply: function (s) { s.boostCd -= 0.15; s.boostDamage += 2 } },
          { name: 'Pressure Valve', cost: 5500,
            desc: 'The overclock lasts 9 seconds and recharges every 4, and adds +4 damage and +2 pierce.',
            apply: function (s) {
              s.boostTime += 4
              s.boostPeriod -= 3
              s.boostDamage += 2
              s.boostPierce += 2
            } },
          { name: 'Perpetual Motion', cost: 39600,
            desc: '80% off the target’s cooldown, +10 damage, +4 pierce and +40 range. Lasts 20 seconds and recharges every 2, so it never lapses.',
            apply: function (s) {
              s.boostCd -= 0.20
              s.boostDamage += 6
              s.boostPierce += 2
              s.boostRange += 40
              s.boostTime += 11
              s.boostPeriod -= 2
            } }
        ]
      },
      {
        name: 'Field Repairs',
        tiers: [
          { name: 'Spare Springs', cost: 248,
            desc: 'The overclock lasts 4.5 seconds instead of 3.',
            apply: function (s) { s.boostTime += 1.5 } },
          { name: 'Wider Rounds', cost: 523,
            desc: 'The shrew reaches 30 units further for something to work on.',
            apply: function (s) { s.range += 30 } },
          { name: 'Field Repairs', cost: 1265,
            desc: 'The overclocked tower also gets +35 range and sees Veiled balloons while the overclock lasts.',
            apply: function (s) { s.boostRange += 35; s.boostCamo = true } },
          { name: 'Two Toolkits', cost: 4950,
            desc: 'Overclocks 2 towers at once, and adds +2 damage to each.',
            apply: function (s) { s.boostCount += 1; s.boostDamage += 2 } },
          { name: 'Whole Workshop', cost: 37400,
            desc: 'Overclocks 5 towers at once, each losing at least 70% of its cooldown and gaining +6 damage, +3 pierce and +60 range. Each overclock lasts 3 seconds longer.',
            apply: function (s) {
              s.boostCount += 3
              s.boostCd = Math.min(s.boostCd, 0.30)
              s.boostDamage += 4
              s.boostPierce += 3
              s.boostRange += 25
              s.boostTime += 3
            } }
        ]
      },
      {
        name: 'Tinker Turrets',
        tiers: [
          { name: 'Scrap Bin', cost: 275,
            desc: 'The shrew reaches 20 units further for something to work on.',
            apply: function (s) { s.range += 20 } },
          { name: 'Sturdier Braces', cost: 605,
            desc: 'The overclock lasts 4 seconds instead of 3.',
            apply: function (s) { s.boostTime += 1 } },
          { name: 'Tinker Turrets', cost: 1540,
            desc: 'Builds 2 little spring turrets beside itself. Each fires a bolt every 1.1 seconds for 1 damage with 2 pierce, out to 120 range.',
            apply: function (s) {
              s.turrets = 2
              s.turretDamage = 1
              s.turretPierce = 2
              s.turretRange = 120
            } },
          { name: 'Bolt Throwers', cost: 6050,
            desc: '4 turrets, each firing every 0.7 seconds for 3 damage with 4 pierce.',
            apply: function (s) {
              s.turrets += 2
              s.turretDamage += 2
              s.turretPierce += 2
              s.turretCd *= 0.64
            } },
          { name: 'Workshop Yard', cost: 41250,
            desc: '8 turrets, each firing every 0.35 seconds for 9 damage with 8 pierce, and their bolts deal shatter damage so Lead cracks open.',
            apply: function (s) {
              s.turrets += 4
              s.turretDamage += 6
              s.turretPierce += 4
              s.turretCd *= 0.5
              s.turretDmgType = D.SHATTER
            } }
        ]
      }
    ],

    /* The only registrar. `tower.s` is the UNBUFFED block here. */
    buffs: function (sim, tower) {
      const s = tower.s
      const list = tower.data.boost
      if (!list || !list.length) return
      for (let i = 0; i < list.length; i++) {
        const target = sim.towerById.get(list[i].id)
        if (!target) continue
        const mods = { cooldownMul: s.boostCd }
        if (s.boostDamage) mods.damageAdd = s.boostDamage
        if (s.boostPierce) mods.pierceAdd = s.boostPierce
        if (s.boostRange) mods.rangeAdd = s.boostRange
        if (s.boostCamo) mods.camoDetect = true
        OP.Buffs.register(sim, {
          id: 'shrew-overclock:' + tower.id + ':' + i,
          sourceId: tower.id,
          x: target.x, y: target.y, radius: 1,
          priority: 5,
          excludeSelf: true,
          mods: mods
        })
      }
    },

    onPlace: function (sim, tower) {
      const d = tower.data
      d.boost = []
      d.cd = 0
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      if (!d.boost) d.boost = []
      let changed = false

      // Expire running overclocks, and drop any whose tower has been sold.
      let w = 0
      for (let i = 0; i < d.boost.length; i++) {
        const b = d.boost[i]
        b.t -= dt
        if (b.t <= 0 || !sim.towerById.get(b.id)) { changed = true; continue }
        d.boost[w++] = b
      }
      d.boost.length = w

      d.cd = (d.cd === undefined ? 0 : d.cd) - dt
      if (d.cd <= 0) {
        if (d.boost.length < s.boostCount) {
          const target = pickBoostTarget(sim, tower, s, d.boost)
          if (target) {
            d.boost.push({ id: target.id, t: s.boostTime })
            changed = true
            // Fill every slot before starting the recharge, or a shrew with two
            // toolkits would never actually have two towers wound up at once —
            // the first would lapse before the second was ever started.
            d.cd = d.boost.length >= s.boostCount ? s.boostPeriod : 0
          } else {
            d.cd = 0.25       // nothing worth winding up; look again shortly
          }
        } else {
          d.cd = 0.25
        }
      }

      // Never register here — only ask for a restat, so `buffs()` stays the one
      // place a buff comes from.
      if (changed) sim.buffsDirty = true

      if (s.turrets > 0) runTurrets(sim, tower, s, dt)
    }
  })

  /** Nearest tower this shrew is willing to wind up. Ties break on lowest id. */
  function pickBoostTarget (sim, tower, s, held) {
    const r2 = s.range * s.range
    let best = null
    let bestD = Infinity
    for (let i = 0; i < sim.towers.length; i++) {
      const other = sim.towers[i]
      if (other.id === tower.id) continue
      if (other.key === tower.key) continue      // shrews do not wind each other up
      if (other.def.income) continue             // a berry patch gains nothing
      let taken = false
      for (let h = 0; h < held.length; h++) if (held[h].id === other.id) { taken = true; break }
      if (taken) continue
      const dd = M.dist2(tower.x, tower.y, other.x, other.y)
      if (dd > r2) continue
      if (dd < bestD || (dd === bestD && best && other.id < best.id)) { best = other; bestD = dd }
    }
    return best
  }

  /** The autonomous turrets. Each acquires from its OWN position, so the camo
      gate and line of sight are resolved where the bolt actually leaves from. */
  function runTurrets (sim, tower, s, dt) {
    const d = tower.data
    if (!d.turrets || d.turrets.length !== s.turrets) {
      d.turrets = []
      for (let i = 0; i < s.turrets; i++) {
        const a = i / s.turrets * M.TAU + 0.35
        d.turrets.push({
          x: M.clamp(tower.x + Math.cos(a) * 30, 4, OP.FIELD_W - 4),
          y: M.clamp(tower.y + Math.sin(a) * 30, 4, OP.FIELD_H - 4),
          cd: i * 0.05
        })
      }
    }

    // A stand-in tower for targeting, built fresh and thrown away: it is never
    // stored on an entity, so nothing unserialisable enters sim state.
    const eye = {
      range: s.turretRange,
      camoDetect: !!s.camoDetect,
      ignoresLOS: false,
      onlyBlimps: false,
      noBlimps: false
    }
    const proxy = { id: tower.id, x: 0, y: 0, def: tower.def, targetId: -1, s: eye }

    for (let i = 0; i < d.turrets.length; i++) {
      const g = d.turrets[i]
      g.cd -= dt
      if (g.cd > 0) continue
      proxy.x = g.x; proxy.y = g.y
      const id = OP.Targeting.acquire(sim, proxy, 'first')
      if (id < 0) { g.cd = 0; continue }
      const b = sim.byId.get(id)
      if (!b) { g.cd = 0; continue }
      g.cd = s.turretCd
      const aim = OP.Targeting.leadPoint(sim, proxy, b, s.projSpeed)
      OP.Projectiles.fireAt(sim, {
        x: g.x, y: g.y,
        kind: 'shrew-bolt',
        damage: s.turretDamage,
        dmgType: s.turretDmgType || s.dmgType,
        pierce: s.turretPierce,
        radius: s.projRadius,
        life: 1.0,
        maxRange: s.turretRange * 1.25,
        ownerId: tower.id,
        camoDetect: !!s.camoDetect
      }, M.angleTo(g.x, g.y, aim.x, aim.y), s.projSpeed)
    }
  }

  /* ============================================================================
     5. FALCONER FERRET — a bird that hunts on its own.

     The bird is not an entity. It is three numbers in `tower.data` (bx, by and a
     patrol phase) that `update()` integrates, plus real projectiles spawned from
     wherever the bird happens to be. That keeps it serialisable, keeps it out of
     the projectile pool for a hundred rounds at a time, and lets it strike from
     a position the tower is not standing in.

     Snatching uses the engine's instaKill path, which the OMEN refuses because
     it is `abilityImmune`. On top of that, `s.snatch` is a simple-tier index and
     no upgrade ever raises it into the blimp class, so no build can carry off a
     blimp of any size.
     ==========================================================================*/

  const SNATCH_PINK = OP.tierIndex('pink')
  const SNATCH_ZEBRA = OP.tierIndex('zebra')
  const SNATCH_CERAMIC = OP.tierIndex('ceramic')

  OP.defineTower({
    key: 'falconer-ferret',
    name: 'Falconer Ferret',
    family: 'support',
    blurb: 'Stands very still with a glove on and lets the bird do the work. The bird decides where it is needed.',

    cost: 900,
    footprint: 15,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 200,              // the bird's patrol territory
      cooldown: 0.8,           // seconds between strikes
      damage: 2,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 380,
      projLife: 0.35,          // a strike is a swipe, not a shot
      projRadius: 6,
      camoDetect: false,
      targetModes: ['first', 'last', 'close', 'strong'],

      birdSpeed: 300,          // units per second
      strikeRange: 26,         // how close the bird must be to strike
      snatch: -1,              // highest simple tier it can carry off; -1 = none
      blimpBonus: 0            // extra damage torn out of a blimp per strike
    },

    paths: [
      {
        name: 'Hunting Bird',
        tiers: [
          { name: 'Sharpened Talons', cost: 495,
            desc: '+1 damage a strike, for 3.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Faster Wings', cost: 945,
            desc: 'The bird flies 30% faster and strikes every 0.64 seconds instead of 0.8.',
            apply: function (s) { s.birdSpeed *= 1.3; s.cooldown *= 0.8 } },
          { name: 'Stooping Dive', cost: 2340,
            desc: '+3 damage and +2 pierce a strike, for 6 damage and 4 pierce.',
            apply: function (s) { s.damage += 3; s.pierce += 2 } },
          { name: 'Iron Beak', cost: 9000,
            desc: 'Strikes deal shatter damage, which nothing in the air resists — Lead included — and +6 damage.',
            apply: function (s) { s.dmgType = D.SHATTER; s.damage += 6 } },
          { name: 'Skyfall', cost: 64800,
            desc: '+22 damage, +6 pierce, and strikes every 0.27 seconds. Adds Skyfall: the bird drops on the strongest balloon in reach for 400 shatter damage in a 90 unit radius, every 35 seconds.',
            apply: function (s) {
              s.damage += 22
              s.pierce += 6
              s.cooldown *= 0.42
              s.ability = { name: 'Skyfall', cooldown: 35, duration: 0, key: 'falcon-stoop' }
            } }
        ]
      },
      {
        name: 'Snatch and Carry',
        tiers: [
          { name: 'Keen Eye', cost: 405,
            desc: 'The bird patrols 35 units further out.',
            apply: function (s) { s.range += 35 } },
          { name: 'Strong Grip', cost: 855,
            desc: '+1 damage and +1 pierce a strike, for 3 and 3.',
            apply: function (s) { s.damage += 1; s.pierce += 1 } },
          { name: 'Snatch and Carry', cost: 2070,
            desc: 'The bird carries off Red, Blue, Green, Yellow and Pink balloons outright — nothing is left behind. Anything tougher is struck as normal.',
            apply: function (s) { s.snatch = SNATCH_PINK } },
          { name: 'Talon Basket', cost: 8100,
            desc: 'Carries off anything up to and including Zebra, and the bird sees Veiled balloons.',
            apply: function (s) { s.snatch = SNATCH_ZEBRA; s.camoDetect = true } },
          { name: 'Sky Burial', cost: 61200,
            desc: 'Carries off anything up to and including Ceramic, +12 damage, +4 pierce, and grabs one every 0.32 seconds. Blimps are far too heavy to lift, at any tier.',
            apply: function (s) {
              s.snatch = SNATCH_CERAMIC
              s.damage += 12
              s.pierce += 4
              s.cooldown *= 0.4
            } }
        ]
      },
      {
        name: 'Blimp Hunter',
        tiers: [
          { name: 'Broad Wings', cost: 450,
            desc: 'The bird flies 25% faster.',
            apply: function (s) { s.birdSpeed *= 1.25 } },
          { name: 'Hooked Talons', cost: 990,
            desc: '+2 damage a strike, for 4.',
            apply: function (s) { s.damage += 2 } },
          { name: 'Blimp Hunter', cost: 2520,
            desc: 'Every strike tears an extra 20 damage out of a blimp. Ordinary balloons are unaffected.',
            apply: function (s) { s.blimpBonus = 20; s.behaviour = 'support-shred' } },
          { name: 'Hull Breaker', cost: 9900,
            desc: 'Extra blimp damage rises to 120, and the bird sees Veiled balloons so a WRAITH can be targeted at all — though a WRAITH still shrugs off sharp damage.',
            apply: function (s) { s.blimpBonus += 100; s.camoDetect = true } },
          { name: 'Sky Reaper', cost: 67500,
            desc: 'Extra blimp damage rises to 700, +18 damage, +5 pierce, and strikes become shatter damage so a WRAITH can no longer shrug them off.',
            apply: function (s) {
              s.blimpBonus += 580
              s.damage += 18
              s.pierce += 5
              s.dmgType = D.SHATTER
            } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      const d = tower.data
      d.bx = tower.x
      d.by = tower.y - 24
      d.bang = 0
      d.orbit = 0
      d.cd = 0
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      if (d.bx === undefined) { d.bx = tower.x; d.by = tower.y - 24; d.orbit = 0; d.cd = 0 }
      d.cd = (d.cd === undefined ? 0 : d.cd) - dt

      // Targeting runs from the tower, so the camo gate and the player's chosen
      // priority still apply; the bird is the delivery mechanism, not the eyes.
      const id = OP.Targeting.acquire(sim, tower, tower.targetMode)
      const target = id >= 0 ? sim.byId.get(id) : null

      let tx, ty
      if (target) {
        tx = target.x; ty = target.y
      } else {
        d.orbit = (d.orbit === undefined ? 0 : d.orbit) + dt * 1.1
        const r = s.range * 0.45
        tx = tower.x + Math.cos(d.orbit) * r
        ty = tower.y + Math.sin(d.orbit) * r
      }

      const dx = tx - d.bx
      const dy = ty - d.by
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 1e-6) {
        const step = Math.min(dist, s.birdSpeed * dt)
        d.bx += dx / dist * step
        d.by += dy / dist * step
        d.bang = Math.atan2(dy, dx)
      }
      d.hunting = target ? 1 : 0

      if (!target || d.cd > 0 || dist > s.strikeRange) return
      d.cd = s.cooldown
      birdStrike(sim, tower, s, target)
    }
  })

  function birdStrike (sim, tower, s, b) {
    const d = tower.data
    const tier = OP.BALLOON_TIERS[b.tier]

    // Carry it off. Blimps are excluded outright, and the OMEN would refuse this
    // anyway because the engine honours `abilityImmune` on instaKill.
    if (s.snatch >= 0 && !tier.blimp && b.tier <= s.snatch) {
      OP.Damage.hit(sim, b, {
        damage: 0,
        dmgType: s.dmgType,
        sourceId: tower.id,
        instaKill: true,
        deleteChildren: true
      })
      return
    }

    OP.Projectiles.fireAt(sim, {
      x: d.bx, y: d.by,
      kind: 'falcon-claw',
      damage: s.damage,
      dmgType: s.dmgType,
      pierce: s.pierce,
      radius: s.projRadius,
      life: s.projLife,
      maxRange: s.strikeRange * 3,
      ownerId: tower.id,
      camoDetect: s.camoDetect,
      behaviour: s.behaviour || '',
      data: s.blimpBonus > 0 ? { shred: s.blimpBonus } : null
    }, M.angleTo(d.bx, d.by, b.x, b.y), s.projSpeed)
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

;(function (OP) {
  'use strict'

  /* PRIMARY — the cheap, always-available backbone.
   *
   * Seven towers a player leans on from round 1 and can still make work at round
   * 80 with the right crosspath. Nothing here is clever: each tower does one
   * readable thing, and its three branches say plainly which one thing they make
   * bigger.
   *
   * Where the family answers the type chart:
   *   lead   (ignores sharp)      — Acorn Fox "Flint Caps" converts to shatter;
   *                                 Cannon Boar, Frost Hare and Sap Snail were
   *                                 never sharp to begin with.
   *   camo   (VEILED)             — Acorn Fox "Keen Eyes", Boomer Badger
   *                                 "Keen Nose".
   *   black/zebra (ignore explosive) — Cannon Boar "Ironwood Slug" trades the
   *                                 explosion for blunt impact.
   *   blimps                      — Cannon Boar "Ironwood Shell" and Sixgun
   *                                 Stoat "Heavy Calibre" are the single-target
   *                                 branches. Frost Hare deliberately is not:
   *                                 blimps resist slows.
   *
   * No single tower answers everything, which is the point of a family.
   */

  const M = OP.M
  const D = OP.DMG
  const E = OP.Effects

  /* ---------- projectile art kinds ----------
     Every `kind` emitted anywhere in this file, including from abilities. An
     undeclared kind renders as nothing. */

  OP.declareProjKind('primary-acorn', { shape: 'dart', tint: '#c9a227', size: 4, trail: true })
  OP.declareProjKind('primary-acorn-heavy', { shape: 'dart', tint: '#e8c14a', size: 6, trail: true, spin: true })
  OP.declareProjKind('primary-branch', { shape: 'blade', tint: '#8a6b3c', size: 7, spin: true })
  OP.declareProjKind('primary-pinecone', { shape: 'bomb', tint: '#7a5230', size: 6, trail: true })
  OP.declareProjKind('primary-cone-shard', { shape: 'bomb', tint: '#a97a44', size: 3 })
  OP.declareProjKind('primary-ironwood-slug', { shape: 'bomb', tint: '#4a3520', size: 9, trail: true })
  OP.declareProjKind('primary-spine', { shape: 'spike', tint: '#d8cbb0', size: 3 })
  OP.declareProjKind('primary-frost', { shape: 'puff', tint: '#9fd8ef', size: 6, trail: true })
  OP.declareProjKind('primary-sap', { shape: 'blob', tint: '#b9c93a', size: 6, trail: true })
  OP.declareProjKind('primary-slug', { shape: 'bullet', tint: '#e2e6ea', size: 3, trail: true })

  /* ---------- small shared helpers ---------- */

  /** Life long enough to actually cover `dist` at `speed`, never shorter than the
      tower's own projLife. Range-multiplying upgrades otherwise kill a shot
      halfway to the edge of the circle the range ring promised. */
  function flightLife (s, dist) {
    const speed = s.projSpeed > 1 ? s.projSpeed : 1
    return Math.max(s.projLife, dist / speed * 1.2 + 0.05)
  }

  /** Symmetric fan offset for shot `i` of `n` across `spread` radians. */
  function fanOffset (i, n, spread) {
    return n <= 1 ? 0 : spread * (i / (n - 1) - 0.5)
  }

  /* ---------- projectile behaviours, registered once by key ----------
     String keys, never closures on the entity: the sim has to serialise. */

  /* Acorn Fox "Ricochet": a bounce refunds the pierce it just spent and scatters
     the shot toward whatever else is nearby. */
  OP.PROJ_BEHAVIOURS['primary-acorn-ricochet'] = {
    onHit: function (sim, p, balloon, res) {
      const d = p.data
      if (!d || !(d.bounces > 0)) return
      d.bounces--
      const angle = Math.atan2(p.vy, p.vx) + sim.rng.range(-0.7, 0.7)
      const speed = Math.hypot(p.vx, p.vy)
      p.vx = Math.cos(angle) * speed
      p.vy = Math.sin(angle) * speed
      p.pierce++
      if (p.maxRange > 0) p.maxRange += 40
      p.life += 0.25
    }
  }

  /* Boomer Badger: the branch flies out straight, then swings wide and comes
     back through a different corridor. `bend` is what makes the return leg a
     second sweep rather than a retrace of the first — a retrace would hit
     nothing, because every balloon on it is already in the projectile's hit set. */
  OP.PROJ_BEHAVIOURS['primary-branch-arc'] = {
    onStep: function (sim, p, dt) {
      const d = p.data
      if (!d || d.turned) return
      if (p.travelled < d.out) return
      d.turned = 1
      const speed = Math.hypot(p.vx, p.vy)
      const angle = Math.atan2(p.vy, p.vx) + Math.PI + (d.bend || 0)
      p.vx = Math.cos(angle) * speed
      p.vy = Math.sin(angle) * speed
      if (d.retMul > 1) p.damage = Math.max(1, Math.round(p.damage * d.retMul))
      if (d.retPierce > 0) p.pierce += d.retPierce
    }
  }

  /* Cannon Boar "Scattering Cone": the pinecone bursts into smaller cones.
     Fires from both hooks because a bomb resolves either on contact (onHit) or on
     expiry (onExpire), never both — the `split` flag makes that belt-and-braces. */
  function scatterCones (sim, p) {
    const d = p.data
    if (!d || d.split || !(d.n > 0)) return
    d.split = 1
    const n = d.n | 0
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * M.TAU + sim.rng.range(-0.28, 0.28)
      const speed = sim.rng.range(110, 190)
      OP.Projectiles.spawn(sim, {
        x: p.x, y: p.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        kind: 'primary-cone-shard',
        damage: d.dmg, dmgType: p.dmgType, pierce: 3,
        radius: 4, life: 0.34,
        ownerId: p.ownerId, camoDetect: p.camoDetect,
        blastRadius: d.br, blastOnExpiry: true
      })
    }
  }

  OP.PROJ_BEHAVIOURS['primary-cone-cluster'] = {
    onHit: function (sim, p, balloon, res) { scatterCones(sim, p) },
    onExpire: function (sim, p) { scatterCones(sim, p) }
  }

  /* Sap Snail "Sap Splash": the sap the shot was carrying spreads to neighbours.
     Copies the effects only — no extra damage, so this cannot double-dip. */
  OP.PROJ_BEHAVIOURS['primary-sap-spread'] = {
    onHit: function (sim, p, balloon, res) {
      const d = p.data
      if (!d || !(d.r > 0) || !(d.max > 0) || !p.effects) return
      const near = sim._sapSpreadScratch || (sim._sapSpreadScratch = [])
      OP.Grid.queryCircle(sim.grid, balloon.x, balloon.y, d.r, near)
      let n = 0
      for (let i = 0; i < near.length && n < d.max; i++) {
        const b = near[i]
        if (!b.alive || b.id === balloon.id) continue
        if ((b.props & OP.PROP.VEILED) && !p.camoDetect) continue
        for (let e = 0; e < p.effects.length; e++) E.apply(b, p.effects[e])
        n++
      }
    }
  }

  /* Sap Snail "Plate Etcher": eats the armour off PLATED balloons.
     Only the property is touched — never hp or tier, which belong to
     OP.Damage.hit alone. Stripping the flag means every layer underneath, and
     every child, comes apart at normal thickness. */
  function stripPlate (b) {
    if (!b || !b.alive) return 0
    if (!(b.props & OP.PROP.PLATED)) return 0
    b.props &= ~OP.PROP.PLATED
    return 1
  }

  OP.PROJ_BEHAVIOURS['primary-sap-etch'] = {
    onHit: function (sim, p, balloon, res) {
      stripPlate(balloon)
      if (res && res.spawned) {
        for (let i = 0; i < res.spawned.length; i++) stripPlate(sim.byId.get(res.spawned[i]))
      }
      const d = p.data
      if (!d || !(d.r > 0)) return
      const near = sim._sapEtchScratch || (sim._sapEtchScratch = [])
      OP.Grid.queryCircle(sim.grid, balloon.x, balloon.y, d.r, near)
      for (let i = 0; i < near.length; i++) {
        const b = near[i]
        if ((b.props & OP.PROP.VEILED) && !p.camoDetect) continue
        stripPlate(b)
      }
    }
  }

  /* ---------- abilities, registered once by key ---------- */

  OP.ABILITIES['primary-acorn-storm'] = function (sim, tower) {
    const s = tower.s
    const ids = []
    OP.Targeting.acquireMany(sim, tower, tower.targetMode, 14, ids)
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-acorn-heavy',
        damage: s.damage * 3, dmgType: s.dmgType, pierce: s.pierce + 4,
        radius: s.projRadius + 2, life: 2.4,
        ownerId: tower.id, camoDetect: s.camoDetect,
        homing: 13, turnRate: 13, targetId: b.id
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
  }

  OP.ABILITIES['primary-badger-cyclone'] = function (sim, tower) {
    const s = tower.s
    const n = 10
    for (let i = 0; i < n; i++) {
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-branch',
        damage: Math.max(1, Math.round(s.damage * 2)), dmgType: s.dmgType,
        pierce: s.pierce + 10, radius: s.projRadius + 2,
        life: flightLife(s, s.range * 2.4),
        maxRange: s.range * 2.4,
        ownerId: tower.id, camoDetect: s.camoDetect,
        behaviour: 'primary-branch-arc',
        data: { out: s.range * 1.05, bend: (i % 2 ? 1 : -1) * 0.5, retMul: 2, retPierce: 6, turned: 0 }
      }, (i / n) * M.TAU, s.projSpeed)
    }
  }

  OP.ABILITIES['primary-boar-timber-breaker'] = function (sim, tower) {
    const s = tower.s
    const ids = []
    OP.Targeting.acquireMany(sim, tower, 'strong', 3, ids)
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-ironwood-slug',
        damage: s.damage * 6, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius + 4, life: 2.4,
        ownerId: tower.id, camoDetect: s.camoDetect,
        blastRadius: s.blastRadius * 1.6, blastOnExpiry: true,
        homing: 10, turnRate: 10, targetId: b.id
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
  }

  OP.ABILITIES['primary-hedgehog-bristle'] = function (sim, tower) {
    const s = tower.s
    const n = 44
    const reach = s.range * 1.3
    for (let i = 0; i < n; i++) {
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-spine',
        damage: Math.max(1, s.damage * 3), dmgType: s.dmgType, pierce: s.pierce + 4,
        radius: s.projRadius + 1,
        life: flightLife(s, reach), maxRange: reach,
        ownerId: tower.id, camoDetect: s.camoDetect
      }, (i / n) * M.TAU, s.projSpeed)
    }
  }

  OP.ABILITIES['primary-hare-absolute-zero'] = function (sim, tower) {
    const s = tower.s
    OP.Damage.blast(sim, tower.x, tower.y, s.range * 1.7, {
      damage: Math.max(1, s.damage * 2),
      dmgType: s.dmgType,
      sourceId: tower.id,
      effects: [
        E.make('cold', 7, 0.95, tower.id, D.COLD),
        E.make('stun', 3, 1, tower.id, D.COLD)
      ]
    }, { camoDetect: s.camoDetect, maxTargets: 400 })
  }

  OP.ABILITIES['primary-snail-dissolution'] = function (sim, tower) {
    const s = tower.s
    OP.Damage.blast(sim, tower.x, tower.y, s.range * 1.6, {
      damage: Math.max(1, s.damage),
      dmgType: s.dmgType,
      sourceId: tower.id,
      effects: [
        E.make('glue', 10, Math.max(0.6, s.glueMag), tower.id, D.ACID),
        E.make('acid', 10, Math.max(8, s.acidMag), tower.id, D.ACID),
        E.make('brittle', 10, Math.max(1, s.brittleMag), tower.id, D.ACID)
      ]
    }, { camoDetect: s.camoDetect, maxTargets: 400 })
  }

  OP.ABILITIES['primary-stoat-fan-fire'] = function (sim, tower) {
    const s = tower.s
    const ids = []
    OP.Targeting.acquireMany(sim, tower, tower.targetMode, 12, ids)
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-slug',
        damage: Math.max(1, Math.round(s.damage * 1.5)), dmgType: s.dmgType,
        pierce: s.pierce + 2, radius: s.projRadius + 1,
        life: flightLife(s, s.range * 1.4), maxRange: s.range * 1.4,
        ownerId: tower.id, camoDetect: s.camoDetect
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
    // The fan empties the cylinder into the crowd and reloads it in one motion.
    tower.data.left = s.burst
    tower.data.reload = 0
  }

  /* ---------- the declared roster ---------- */

  OP.FAMILY_ROSTERS.primary = [
    'acorn-fox',
    'boomer-badger',
    'cannon-boar',
    'thistle-hedgehog',
    'frost-hare',
    'sap-snail',
    'sixgun-stoat'
  ]

  /* ======================================================================
     1. ACORN FOX — the honest starter
     ====================================================================== */

  OP.defineTower({
    key: 'acorn-fox',
    name: 'Acorn Fox',
    family: 'primary',
    blurb: 'Throws acorns. The cheapest tower there is, and with a flint cap on the tip it still cracks lead at round 60.',

    cost: 170,
    footprint: 12,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 108,
      cooldown: 0.95,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 380,
      projLife: 1.3,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      bounces: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Sharpened',
        tiers: [
          { name: 'Whittled Points', cost: 100,
            desc: 'Each acorn passes through 1 more balloon (2 becomes 3).',
            apply: function (s) { s.pierce += 1 } },
          { name: 'Hardened Shells', cost: 180,
            desc: '+1 damage per acorn.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Flint Caps', cost: 450,
            desc: 'A chip of flint on every tip. Damage becomes shatter, which nothing resists — Lead cracks open. +1 damage.',
            apply: function (s) { s.dmgType = D.SHATTER; s.damage += 1 } },
          { name: 'Splitting Grain', cost: 1900,
            desc: '+3 damage and +2 pierce.',
            apply: function (s) { s.damage += 3; s.pierce += 2 } },
          { name: 'Stonefall', cost: 12000,
            desc: '+9 damage, +5 pierce, and an ability: hurl 14 heavy homing acorns at everything in range, each for triple damage. 40 second cooldown.',
            apply: function (s) {
              s.damage += 9
              s.pierce += 5
              s.ability = { name: 'Stonefall', cooldown: 40, duration: 0, key: 'primary-acorn-storm' }
            } }
        ]
      },
      {
        name: 'Quick Paws',
        tiers: [
          { name: 'Loose Grip', cost: 95,
            desc: 'Throws 15% faster.',
            apply: function (s) { s.cooldown *= 0.85 } },
          { name: 'Practised Throw', cost: 150,
            desc: 'Throws another 18% faster.',
            apply: function (s) { s.cooldown *= 0.82 } },
          { name: 'Keen Eyes', cost: 400,
            desc: 'Sees Veiled balloons and can target and hit them, and +8 range.',
            apply: function (s) { s.camoDetect = true; s.range += 8 } },
          { name: 'Blur', cost: 1500,
            desc: 'Throws 40% faster and two acorns at a time in a narrow fan.',
            apply: function (s) { s.cooldown *= 0.60; s.shots = 2; s.spread = 0.18 } },
          { name: 'Ten Paws', cost: 10500,
            desc: 'Throws 58% faster again and 2 more acorns per throw, in a wider fan.',
            apply: function (s) { s.cooldown *= 0.42; s.shots += 2; s.spread = 0.30 } }
        ]
      },
      {
        name: 'Long Throw',
        tiers: [
          { name: 'Wind Read', cost: 70,
            desc: 'Reads the breeze before throwing: +18 range.',
            apply: function (s) { s.range += 18 } },
          { name: 'Overarm', cost: 130,
            desc: '+24 range and acorns fly 20% faster.',
            apply: function (s) { s.range += 24; s.projSpeed *= 1.20 } },
          { name: 'Ricochet', cost: 420,
            desc: 'Acorns bounce off 2 balloons onto something else nearby, keeping their pierce.',
            apply: function (s) { s.behaviour = 'primary-acorn-ricochet'; s.bounces = 2 } },
          { name: 'Far Sight', cost: 1600,
            desc: '+50 range and +2 pierce.',
            apply: function (s) { s.range += 50; s.pierce += 2 } },
          { name: 'Across The Valley', cost: 11000,
            desc: 'Range increased by 80%, acorns lob over rock and cliff, 3 more bounces, and +3 damage.',
            apply: function (s) {
              s.range *= 1.8
              s.ignoresLOS = true
              s.bounces += 3
              s.damage += 3
              if (!s.behaviour) s.behaviour = 'primary-acorn-ricochet'
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.35
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'primary-acorn',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: s.camoDetect,
          behaviour: s.behaviour || '',
          data: s.bounces > 0 ? { bounces: s.bounces } : null
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     2. BOOMER BADGER — out, wide, and back
     ====================================================================== */

  OP.defineTower({
    key: 'boomer-badger',
    name: 'Boomer Badger',
    family: 'primary',
    blurb: 'Throws a curved branch that flies out, swings wide and sweeps back through on a second line. Huge pierce, modest damage.',

    cost: 400,
    footprint: 14,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 130,
      cooldown: 1.3,
      damage: 2,
      pierce: 5,
      dmgType: D.SHARP,
      projSpeed: 300,
      projLife: 1.9,
      projRadius: 6,
      camoDetect: false,
      shots: 1,
      spread: 0,
      behaviour: 'primary-branch-arc',
      bend: 0.42,
      retMul: 1,
      retPierce: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Wide Arc',
        tiers: [
          { name: 'Twin Notch', cost: 180,
            desc: 'Throws 2 branches per swing, spread across a wide fan.',
            apply: function (s) { s.shots = 2; s.spread = 0.50 } },
          { name: 'Deep Groove', cost: 300,
            desc: 'Each branch cuts through 2 more balloons (5 becomes 7).',
            apply: function (s) { s.pierce += 2 } },
          { name: 'Triple Toss', cost: 1100,
            desc: 'Throws 3 branches per swing across a wider fan.',
            apply: function (s) { s.shots = 3; s.spread = 0.75 } },
          { name: 'Sweeping Arc', cost: 4200,
            desc: '4 branches per swing, +2 pierce and +2 damage.',
            apply: function (s) { s.shots = 4; s.spread = 0.95; s.pierce += 2; s.damage += 2 } },
          { name: 'Whirl Of Branches', cost: 30000,
            desc: '6 branches per swing across a 75 degree fan, +6 damage and +6 pierce.',
            apply: function (s) { s.shots = 6; s.spread = 1.30; s.damage += 6; s.pierce += 6 } }
        ]
      },
      {
        name: 'Heavy Return',
        tiers: [
          { name: 'Backswing', cost: 170,
            desc: 'On the way back the branch bites for 50% more damage.',
            apply: function (s) { s.retMul = 1.5 } },
          { name: 'Weighted Tip', cost: 290,
            desc: '+1 damage on both legs of the throw.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Hard Return', cost: 980,
            desc: 'The return leg now hits for 140% more damage, and +1 damage overall.',
            apply: function (s) { s.retMul = 2.4; s.damage += 1 } },
          { name: 'Second Bite', cost: 3800,
            desc: 'Return leg damage tripled, and it regains 3 pierce as it turns. +4 damage.',
            apply: function (s) { s.retMul = 3.2; s.retPierce = 3; s.damage += 4 } },
          { name: 'Homecoming', cost: 28000,
            desc: 'Return leg damage multiplied by 4.5 and it regains 6 pierce, +10 damage, and an ability: 10 branches thrown in a full circle, each for double damage. 45 second cooldown.',
            apply: function (s) {
              s.retMul = 4.5
              s.retPierce = 6
              s.damage += 10
              s.ability = { name: 'Homecoming', cooldown: 45, duration: 0, key: 'primary-badger-cyclone' }
            } }
        ]
      },
      {
        name: 'Keen Nose',
        tiers: [
          { name: 'Wide Nostrils', cost: 150,
            desc: 'Sniffs balloons out further away: +20 range.',
            apply: function (s) { s.range += 20 } },
          { name: 'Keen Nose', cost: 280,
            desc: 'Smells Veiled balloons, so it can target and hit them, and +1 pierce.',
            apply: function (s) { s.camoDetect = true; s.pierce += 1 } },
          { name: 'Truffle Sense', cost: 760,
            desc: '+2 pierce and +25 range.',
            apply: function (s) { s.pierce += 2; s.range += 25 } },
          { name: 'Long Sniff', cost: 3200,
            desc: '+3 damage, branches fly 30% faster, and the return leg swings 35 degrees wide instead of 24.',
            apply: function (s) { s.damage += 3; s.projSpeed *= 1.30; s.bend = 0.62 } },
          { name: 'Nose For Trouble', cost: 26000,
            desc: '+8 damage, +5 pierce, and 50% more range.',
            apply: function (s) { s.damage += 8; s.pierce += 5; s.range *= 1.5 } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 2.2
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'primary-branch',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: s.camoDetect,
          behaviour: s.behaviour,
          data: {
            out: s.range * 0.95,
            // Alternate which way each branch swings, by index — deterministic,
            // and it costs the sim no randomness.
            bend: (i % 2 ? 1 : -1) * s.bend,
            retMul: s.retMul,
            retPierce: s.retPierce,
            turned: 0
          }
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     3. CANNON BOAR — pinecone bombs
     ====================================================================== */

  OP.defineTower({
    key: 'cannon-boar',
    name: 'Cannon Boar',
    family: 'primary',
    blurb: 'Lobs pinecone bombs. Explosive damage, so Black and Zebra balloons ignore it entirely until you give it something blunter.',

    cost: 550,
    footprint: 16,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 145,
      cooldown: 1.6,
      damage: 3,
      pierce: 8,
      dmgType: D.EXPLOSIVE,
      projSpeed: 300,
      projLife: 2.0,
      projRadius: 6,
      camoDetect: false,
      shots: 1,
      spread: 0,
      blastRadius: 34,
      blastFalloff: 0.30,
      cluster: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Ironwood Shell',
        tiers: [
          { name: 'Packed Cone', cost: 300,
            desc: '+2 damage per bomb.',
            apply: function (s) { s.damage += 2 } },
          { name: 'Hard Core', cost: 560,
            desc: '+3 damage per bomb.',
            apply: function (s) { s.damage += 3 } },
          { name: 'Ironwood Slug', cost: 1600,
            desc: 'The cone is replaced by a solid ironwood slug. Damage becomes blunt impact rather than an explosion, so Black and Zebra balloons can no longer shrug it off. +4 damage.',
            apply: function (s) { s.dmgType = D.NORMAL; s.damage += 4 } },
          { name: 'Siege Load', cost: 6000,
            desc: '+18 damage, and the blast keeps 85% of its damage out at the edge instead of 70%.',
            apply: function (s) { s.damage += 18; s.blastFalloff = 0.15 } },
          { name: 'Timber Breaker', cost: 45000,
            desc: '+90 damage, and an ability: three homing siege slugs, each for six times damage with a 60% wider blast. 50 second cooldown.',
            apply: function (s) {
              s.damage += 90
              s.ability = { name: 'Timber Breaker', cooldown: 50, duration: 0, key: 'primary-boar-timber-breaker' }
            } }
        ]
      },
      {
        name: 'Cone Cluster',
        tiers: [
          { name: 'Wide Burst', cost: 260,
            desc: 'Blast radius 34 becomes 42.',
            apply: function (s) { s.blastRadius += 8 } },
          { name: 'Loose Scales', cost: 500,
            desc: 'Each blast catches 4 more balloons, and blast radius grows another 6.',
            apply: function (s) { s.pierce += 4; s.blastRadius += 6 } },
          { name: 'Scattering Cone', cost: 1500,
            desc: 'Every bomb bursts into 4 smaller cones that scatter outward and explode for half damage.',
            apply: function (s) { s.behaviour = 'primary-cone-cluster'; s.cluster = 4 } },
          { name: 'Seed Shower', cost: 5500,
            desc: '7 scattered cones instead of 4, and +3 damage.',
            apply: function (s) { s.cluster = 7; s.damage += 3 } },
          { name: 'Forest Fall', cost: 42000,
            desc: '12 scattered cones, +8 damage, +20 blast radius, and each blast catches 8 more balloons.',
            apply: function (s) { s.cluster = 12; s.damage += 8; s.blastRadius += 20; s.pierce += 8 } }
        ]
      },
      {
        name: 'Long Fuse',
        tiers: [
          { name: 'Deep Lungs', cost: 220,
            desc: 'A harder puff behind every bomb: +25 range.',
            apply: function (s) { s.range += 25 } },
          { name: 'Quick Ram', cost: 460,
            desc: 'Reloads 15% faster.',
            apply: function (s) { s.cooldown *= 0.85 } },
          { name: 'High Lob', cost: 1400,
            desc: '+35 range, another 15% faster, and bombs arc over rock and cliff instead of needing a clear line.',
            apply: function (s) { s.range += 35; s.cooldown *= 0.85; s.ignoresLOS = true } },
          { name: 'Double Ram', cost: 5200,
            desc: 'Reloads 30% faster and +2 damage.',
            apply: function (s) { s.cooldown *= 0.70; s.damage += 2 } },
          { name: 'Repeating Cannon', cost: 38000,
            desc: 'Reloads twice as fast, fires 2 bombs at once, and +10 damage.',
            apply: function (s) { s.cooldown *= 0.50; s.shots = 2; s.spread = 0.22; s.damage += 10 } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      // A lobbed bomb detonates where it lands, so cap its travel at the target.
      const reach = M.clamp(M.dist(tower.x, tower.y, aim.x, aim.y), 30, s.range)
      const cluster = s.cluster > 0
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'primary-pinecone',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: s.camoDetect,
          blastRadius: s.blastRadius, blastOnExpiry: true, blastFalloff: s.blastFalloff,
          behaviour: cluster ? s.behaviour : '',
          data: cluster
            ? {
                n: s.cluster,
                dmg: Math.max(1, Math.round(s.damage * 0.5)),
                br: Math.max(10, Math.round(s.blastRadius * 0.5)),
                split: 0
              }
            : null
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     4. THISTLE HEDGEHOG — spines in every direction
     ====================================================================== */

  OP.defineTower({
    key: 'thistle-hedgehog',
    name: 'Thistle Hedgehog',
    family: 'primary',
    blurb: 'Flings spines in every direction at once. Very short reach, very fast, and it does not care which way the track runs.',

    cost: 380,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 80,
      cooldown: 0.55,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 260,
      projLife: 0.6,
      projRadius: 3,
      camoDetect: false,
      shots: 8,
      // A full circle: fire() divides by `shots`, not `shots - 1`, or the first
      // and last spine land on the same bearing and leave a gap opposite.
      spread: M.TAU,
      burnMag: 0,
      burnTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'More Spines',
        tiers: [
          { name: 'Bristled', cost: 150,
            desc: '10 spines per burst instead of 8.',
            apply: function (s) { s.shots += 2 } },
          { name: 'Sharpened Quills', cost: 300,
            desc: '+1 damage per spine.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Full Coat', cost: 900,
            desc: '4 more spines per burst and +1 pierce.',
            apply: function (s) { s.shots += 4; s.pierce += 1 } },
          { name: 'Iron Quills', cost: 3200,
            desc: '+3 damage and 4 more spines per burst.',
            apply: function (s) { s.damage += 3; s.shots += 4 } },
          { name: 'Thicket', cost: 26000,
            desc: '+10 damage, 8 more spines per burst, and +3 pierce.',
            apply: function (s) { s.damage += 10; s.shots += 8; s.pierce += 3 } }
        ]
      },
      {
        name: 'Long Quills',
        tiers: [
          { name: 'Stretched Spines', cost: 140,
            desc: 'Longer spines reach a little further: +14 range.',
            apply: function (s) { s.range += 14 } },
          { name: 'Loose Coat', cost: 280,
            desc: '+18 range and spines fly 20% faster.',
            apply: function (s) { s.range += 18; s.projSpeed *= 1.20 } },
          { name: 'Launcher Quills', cost: 850,
            desc: 'Range increased by 80%.',
            apply: function (s) { s.range *= 1.8 } },
          { name: 'Volley Quills', cost: 3000,
            desc: 'Range increased by another 50%, and +2 pierce.',
            apply: function (s) { s.range *= 1.5; s.pierce += 2 } },
          { name: 'Bristle Storm', cost: 24000,
            desc: 'Range doubled, +6 damage, and an ability: 44 spines at once for triple damage, thrown 30% further than normal. 35 second cooldown.',
            apply: function (s) {
              s.range *= 2.0
              s.damage += 6
              s.ability = { name: 'Bristle Storm', cooldown: 35, duration: 0, key: 'primary-hedgehog-bristle' }
            } }
        ]
      },
      {
        name: 'Burning Thistle',
        tiers: [
          { name: 'Warm Tips', cost: 160,
            desc: 'Spines set balloons burning for 1.5 damage a second over 2 seconds. Purple balloons are unbothered by fire.',
            apply: function (s) { s.burnMag = 1.5; s.burnTime = 2.0 } },
          { name: 'Ember Tips', cost: 310,
            desc: 'Burning raised to 3 damage a second over 2.5 seconds.',
            apply: function (s) { s.burnMag = 3; s.burnTime = 2.5 } },
          { name: 'Kindling', cost: 920,
            desc: 'Burning raised to 7 damage a second over 3 seconds, and +1 damage per spine.',
            apply: function (s) { s.burnMag = 7; s.burnTime = 3.0; s.damage += 1 } },
          { name: 'Blazing Coat', cost: 3300,
            desc: 'Burning raised to 16 damage a second over 3.5 seconds, and +4 damage per spine.',
            apply: function (s) { s.burnMag = 16; s.burnTime = 3.5; s.damage += 4 } },
          { name: 'Wildfire', cost: 25000,
            desc: 'Burning raised to 40 damage a second over 4.5 seconds, +10 damage per spine, and +2 pierce.',
            apply: function (s) { s.burnMag = 40; s.burnTime = 4.5; s.damage += 10; s.pierce += 2 } }
        ]
      }
    ],

    fire: function (sim, tower) {
      const s = tower.s
      const n = Math.max(1, Math.round(s.shots))
      const reach = s.range
      const effects = s.burnMag > 0
        ? [E.make('burn', s.burnTime, s.burnMag, tower.id, D.FIRE)]
        : null
      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'primary-spine',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: effects
        }, tower.angle + (i / n) * M.TAU, s.projSpeed)
      }
    }
  })

  /* ======================================================================
     5. FROST HARE — slows things down
     ====================================================================== */

  OP.defineTower({
    key: 'frost-hare',
    name: 'Frost Hare',
    family: 'primary',
    blurb: 'Breathes a puff of frost that chills everything it touches. White and Zebra balloons are already cold, and blimps only half feel it.',

    cost: 500,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 115,
      cooldown: 1.5,
      damage: 1,
      pierce: 6,
      dmgType: D.COLD,
      projSpeed: 320,
      projLife: 1.2,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      blastRadius: 22,
      coldMag: 0.40,
      coldTime: 2.2,
      stunTime: 0,
      brittleMag: 0,
      brittleTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Permafrost',
        tiers: [
          { name: 'Bitter Chill', cost: 250,
            desc: 'Chilled balloons lose 58% of their speed instead of 40%, and stay chilled for 3 seconds instead of 2.2.',
            apply: function (s) { s.coldMag = 0.58; s.coldTime = 3.0 } },
          { name: 'Hoarfrost', cost: 480,
            desc: '+1 damage per puff.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Flash Freeze', cost: 1500,
            desc: 'Chill deepened to a 75% slow, and every puff freezes balloons solid for 0.35 seconds. Blimps are far too big to freeze.',
            apply: function (s) { s.coldMag = 0.75; s.stunTime = 0.35 } },
          { name: 'Deep Winter', cost: 5500,
            desc: '+4 damage, an 88% slow lasting 4 seconds, and balloons freeze solid for 0.6 seconds.',
            apply: function (s) { s.damage += 4; s.coldMag = 0.88; s.coldTime = 4.0; s.stunTime = 0.6 } },
          { name: 'Absolute Zero', cost: 40000,
            desc: '+14 damage, 6 second chill, 1.1 second freeze, and an ability: everything within 170% of range takes double damage, a 95% slow for 7 seconds and a 3 second freeze. 60 second cooldown.',
            apply: function (s) {
              s.damage += 14
              s.coldTime = 6.0
              s.stunTime = 1.1
              s.ability = { name: 'Absolute Zero', cooldown: 60, duration: 0, key: 'primary-hare-absolute-zero' }
            } }
        ]
      },
      {
        name: 'Wider Chill',
        tiers: [
          { name: 'Frost Puff', cost: 230,
            desc: 'Puff radius 22 becomes 32.',
            apply: function (s) { s.blastRadius += 10 } },
          { name: 'Cold Front', cost: 450,
            desc: 'Puff radius grows another 10, and each puff chills 3 more balloons.',
            apply: function (s) { s.blastRadius += 10; s.pierce += 3 } },
          { name: 'Snow Squall', cost: 1400,
            desc: '+18 puff radius and +20 range.',
            apply: function (s) { s.blastRadius += 18; s.range += 20 } },
          { name: 'Whiteout', cost: 5000,
            desc: '+26 puff radius, 6 more balloons chilled per puff, and +2 damage.',
            apply: function (s) { s.blastRadius += 26; s.pierce += 6; s.damage += 2 } },
          { name: 'Endless Winter', cost: 36000,
            desc: '+55 puff radius, 24 more balloons chilled per puff, +8 damage and +40 range.',
            apply: function (s) { s.blastRadius += 55; s.pierce += 24; s.damage += 8; s.range += 40 } }
        ]
      },
      {
        name: 'Frostbite',
        tiers: [
          { name: 'Sharp Ice', cost: 220,
            desc: '+1 damage per puff.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Icicles', cost: 440,
            desc: '+1 damage and +15 range.',
            apply: function (s) { s.damage += 1; s.range += 15 } },
          { name: 'Frostbite', cost: 1300,
            desc: '+2 damage, and chilled balloons turn brittle for 3 seconds: everything that hits them, from any tower, deals 40% more damage.',
            apply: function (s) { s.damage += 2; s.brittleMag = 0.40; s.brittleTime = 3.0 } },
          { name: 'Shattering Cold', cost: 4800,
            desc: '+6 damage, and brittle balloons take 80% more damage for 4 seconds.',
            apply: function (s) { s.damage += 6; s.brittleMag = 0.80; s.brittleTime = 4.0 } },
          { name: 'Glacial Fracture', cost: 34000,
            desc: '+20 damage, +6 balloons chilled per puff, and brittle balloons take 160% more damage for 5 seconds.',
            apply: function (s) { s.damage += 20; s.pierce += 6; s.brittleMag = 1.60; s.brittleTime = 5.0 } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = M.clamp(M.dist(tower.x, tower.y, aim.x, aim.y), 24, s.range)

      const effects = [E.make('cold', s.coldTime, s.coldMag, tower.id, D.COLD)]
      if (s.stunTime > 0) effects.push(E.make('stun', s.stunTime, 1, tower.id, D.COLD))
      if (s.brittleMag > 0) effects.push(E.make('brittle', s.brittleTime, s.brittleMag, tower.id, D.COLD))

      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-frost',
        damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
        ownerId: tower.id, camoDetect: s.camoDetect,
        blastRadius: s.blastRadius, blastOnExpiry: true,
        effects: effects
      }, centre, s.projSpeed)
    }
  })

  /* ======================================================================
     6. SAP SNAIL — force multiplier
     ====================================================================== */

  OP.defineTower({
    key: 'sap-snail',
    name: 'Sap Snail',
    family: 'primary',
    blurb: 'Spits tree sap. It barely scratches anything on its own; what it does is hold balloons still and soften them up for everything else you own.',

    cost: 300,
    footprint: 14,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 120,
      cooldown: 1.4,
      damage: 1,
      pierce: 4,
      dmgType: D.ACID,
      projSpeed: 280,
      projLife: 1.3,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      glueMag: 0.50,
      glueTime: 5.0,
      acidMag: 0,
      acidTime: 0,
      brittleMag: 0,
      brittleTime: 0,
      behR: 0,
      behMax: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Corrosive Sap',
        tiers: [
          { name: 'Sour Sap', cost: 140,
            desc: 'Sapped balloons corrode for 1 damage a second over 4 seconds.',
            apply: function (s) { s.acidMag = 1; s.acidTime = 4.0 } },
          { name: 'Fermented', cost: 280,
            desc: 'Corrosion raised to 2.5 damage a second over 5 seconds.',
            apply: function (s) { s.acidMag = 2.5; s.acidTime = 5.0 } },
          { name: 'Caustic Trail', cost: 900,
            desc: 'Corrosion raised to 6 damage a second over 6 seconds, and +1 direct damage.',
            apply: function (s) { s.acidMag = 6; s.acidTime = 6.0; s.damage += 1 } },
          { name: 'Digestive Acid', cost: 3200,
            desc: 'Corrosion raised to 14 damage a second over 7 seconds, and +2 direct damage.',
            apply: function (s) { s.acidMag = 14; s.acidTime = 7.0; s.damage += 2 } },
          { name: 'Dissolution', cost: 24000,
            desc: 'Corrosion raised to 34 damage a second over 9 seconds, +6 direct damage, and an ability: floods everything within 160% of range with sap, corrosion and brittleness for 10 seconds. 50 second cooldown.',
            apply: function (s) {
              s.acidMag = 34
              s.acidTime = 9.0
              s.damage += 6
              s.ability = { name: 'Dissolution', cooldown: 50, duration: 0, key: 'primary-snail-dissolution' }
            } }
        ]
      },
      {
        name: 'Spreading Sap',
        tiers: [
          { name: 'Stickier', cost: 130,
            desc: 'Sapped balloons lose 62% of their speed instead of 50%.',
            apply: function (s) { s.glueMag = 0.62 } },
          { name: 'Long Pull', cost: 260,
            desc: 'Sap lasts 8 seconds instead of 5, and each shot coats 1 more balloon.',
            apply: function (s) { s.glueTime = 8.0; s.pierce += 1 } },
          { name: 'Sap Splash', cost: 850,
            desc: 'Sap splashes off whatever it hits onto 3 more balloons within 42 units.',
            apply: function (s) { s.behaviour = 'primary-sap-spread'; s.behR = 42; s.behMax = 3 } },
          { name: 'Sap Wave', cost: 3000,
            desc: 'Splash reaches 7 balloons within 75 units, and sap slows by 74%.',
            apply: function (s) { s.behR = 75; s.behMax = 7; s.glueMag = 0.74 } },
          { name: 'Tide Of Sap', cost: 22000,
            desc: 'Splash reaches 14 balloons within 115 units, sap slows by 85%, and +4 direct damage.',
            apply: function (s) { s.behR = 115; s.behMax = 14; s.glueMag = 0.85; s.damage += 4 } }
        ]
      },
      {
        name: 'Etching Sap',
        tiers: [
          { name: 'Thin Solvent', cost: 120,
            desc: 'Sapped balloons turn brittle for 4 seconds: everything that hits them, from any tower, deals 25% more damage.',
            apply: function (s) { s.brittleMag = 0.25; s.brittleTime = 4.0 } },
          { name: 'Biting Solvent', cost: 250,
            desc: 'Brittleness raised to 45% extra damage over 5 seconds.',
            apply: function (s) { s.brittleMag = 0.45; s.brittleTime = 5.0 } },
          { name: 'Plate Etcher', cost: 800,
            desc: 'The sap eats armour: Plated balloons lose their plating, so every layer beneath the one you are shooting comes apart at normal thickness. Brittleness raised to 70%.',
            apply: function (s) { s.behaviour = 'primary-sap-etch'; s.behR = 0; s.brittleMag = 0.70 } },
          { name: 'Deep Etch', cost: 2900,
            desc: 'Brittleness raised to 110% extra damage, +2 direct damage, and plating is stripped from every balloon within 55 units of the hit.',
            apply: function (s) { s.brittleMag = 1.10; s.damage += 2; s.behR = 55 } },
          { name: 'Universal Solvent', cost: 21000,
            desc: 'Brittleness raised to 220% extra damage, +6 direct damage, +4 pierce, and plating is stripped within 110 units.',
            apply: function (s) { s.brittleMag = 2.20; s.damage += 6; s.pierce += 4; s.behR = 110 } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.25

      const effects = [E.make('glue', s.glueTime, s.glueMag, tower.id, D.ACID)]
      if (s.acidMag > 0) effects.push(E.make('acid', s.acidTime, s.acidMag, tower.id, D.ACID))
      if (s.brittleMag > 0) effects.push(E.make('brittle', s.brittleTime, s.brittleMag, tower.id, D.ACID))

      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-sap',
        damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
        ownerId: tower.id, camoDetect: s.camoDetect,
        effects: effects,
        behaviour: s.behaviour || '',
        data: s.behaviour ? { r: s.behR, max: s.behMax } : null
      }, centre, s.projSpeed)
    }
  })

  /* ======================================================================
     7. SIXGUN STOAT — six shots, then a reload
     ====================================================================== */

  OP.defineTower({
    key: 'sixgun-stoat',
    name: 'Sixgun Stoat',
    family: 'primary',
    blurb: 'Empties six hard-hitting shots as fast as it can pull, then spends nearly two seconds reloading. All the damage is in the burst.',

    cost: 600,
    footprint: 12,
    placement: 'land',
    unlockRound: 0,
    income: false,

    base: {
      range: 135,
      cooldown: 0.13,      // the gap BETWEEN shots inside a burst
      damage: 3,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 720,
      projLife: 0.9,
      projRadius: 3,
      camoDetect: false,
      shots: 1,
      spread: 0,
      burst: 6,            // shots per cylinder
      reload: 1.8,         // seconds to refill it
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Heavy Calibre',
        tiers: [
          { name: 'Hard Cast', cost: 260,
            desc: '+2 damage per shot (3 becomes 5).',
            apply: function (s) { s.damage += 2 } },
          { name: 'Long Barrel', cost: 540,
            desc: '+3 damage per shot, and shots pass through 1 more balloon.',
            apply: function (s) { s.damage += 3; s.pierce += 1 } },
          { name: 'Big Bore', cost: 1800,
            desc: '+6 damage per shot.',
            apply: function (s) { s.damage += 6 } },
          { name: 'Elephant Load', cost: 6600,
            desc: '+20 damage per shot and +2 pierce.',
            apply: function (s) { s.damage += 20; s.pierce += 2 } },
          { name: 'One Shot', cost: 48000,
            desc: 'One enormous round instead of six: +120 damage and +6 pierce, but the cylinder holds a single shot and takes 2.2 seconds to reload. Ability: three quick shots at whatever has the most layers left, for one and a half times damage each. 45 second cooldown.',
            apply: function (s) {
              s.damage += 120
              s.pierce += 6
              s.burst = 1
              s.reload = 2.2
              s.ability = { name: 'Fan The Hammer', cooldown: 45, duration: 0, key: 'primary-stoat-fan-fire' }
            } }
        ]
      },
      {
        name: 'Quick Hands',
        tiers: [
          { name: 'Fast Fingers', cost: 250,
            desc: 'Reload drops from 1.8 seconds to 1.3.',
            apply: function (s) { s.reload *= 0.72 } },
          { name: 'Oiled Action', cost: 520,
            desc: 'Shots inside a burst come 20% closer together.',
            apply: function (s) { s.cooldown *= 0.80 } },
          { name: 'Extended Cylinder', cost: 1700,
            desc: '9 shots per burst instead of 6.',
            apply: function (s) { s.burst += 3 } },
          { name: 'Speed Load', cost: 6200,
            desc: 'Reload cut by another 55%, and shots come 20% closer together again.',
            apply: function (s) { s.reload *= 0.45; s.cooldown *= 0.80 } },
          { name: 'Bottomless', cost: 46000,
            desc: 'Never reloads again — one endless stream instead of bursts. Shots are spaced twice as far apart and each does 6 more damage.',
            apply: function (s) { s.reload = 0; s.cooldown *= 2.0; s.damage += 6 } }
        ]
      },
      {
        name: 'Steady Aim',
        tiers: [
          { name: 'Notched Sight', cost: 230,
            desc: 'A filed notch on the barrel: +20 range.',
            apply: function (s) { s.range += 20 } },
          { name: 'Rifled', cost: 500,
            desc: '+1 pierce and shots fly 25% faster.',
            apply: function (s) { s.pierce += 1; s.projSpeed *= 1.25 } },
          { name: 'Dead Eye', cost: 1600,
            desc: '+3 damage and +30 range.',
            apply: function (s) { s.damage += 3; s.range += 30 } },
          { name: 'Marksman', cost: 5800,
            desc: '+8 damage and +40 range.',
            apply: function (s) { s.damage += 8; s.range += 40 } },
          { name: 'Thousand Yard', cost: 44000,
            desc: '+40 damage, +4 pierce, and 60% more range.',
            apply: function (s) { s.damage += 40; s.pierce += 4; s.range *= 1.6 } }
        ]
      }
    ],

    /* The burst is modelled honestly: a very short cooldown between shots, a
       counter in tower.data, and a reload timer that holds the cooldown up while
       it runs. Everything in `data` is a plain number, so mid-round save works. */
    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      if (typeof d.reload !== 'number') d.reload = 0
      if (typeof d.left !== 'number' || d.left > s.burst) d.left = s.burst

      if (d.reload > 0) {
        d.reload = Math.max(0, d.reload - dt)
        if (d.reload > 0) {
          // Hold the gun closed. Towers.step subtracts dt right after this, so
          // the two timers walk down together and the shot lands the tick the
          // reload finishes.
          if (tower.cooldown < d.reload) tower.cooldown = d.reload
        } else {
          d.left = s.burst
        }
      }
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const d = tower.data
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const reach = s.range * 1.25

      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'primary-slug',
        damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
        ownerId: tower.id, camoDetect: s.camoDetect
      }, M.angleTo(tower.x, tower.y, aim.x, aim.y), s.projSpeed)

      if (s.reload > 0 && s.burst > 0) {
        d.left = (typeof d.left === 'number' ? d.left : s.burst) - 1
        if (d.left <= 0) {
          d.left = 0
          d.reload = s.reload
        }
      }
    },

    onPlace: function (sim, tower) {
      tower.data.left = tower.s.burst
      tower.data.reload = 0
    }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

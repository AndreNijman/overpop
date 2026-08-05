;(function (OP) {
  'use strict'

  /* PARAGONS — the tier-6 fusions.
   *
   * Six of the twenty-five towers have one. Promotion consumes every other tower
   * of that type on the board and derives a `degree` (1..100) from the cash,
   * upgrade tiers and pops sacrificed (js/core/paragon.js). README.md lists the
   * six, and tools/suites/paragon-roster.mjs cross-checks that list against this
   * file — so the README cannot quietly become a false claim.
   *
   *   acorn-fox       Stonecrown Vulpine   primary damage    the archetype
   *   frost-hare      Rimecrown Hare       primary control   stops the track
   *   longshot-lynx   Horizonshot Lynx     military reach    the whole map
   *   howitzer-mole   Bastion Mole         military area     screen clearing
   *   elder-owl       Eclipse Owl          magic             the spectacle
   *   berry-warren    Thornhold Warren     support economy   scale is the point
   *
   * FOUR THINGS TO KNOW BEFORE EDITING THIS FILE.
   *
   * 1. `apply(s, tower, sim, degree)` runs AFTER OP.Paragon.applyStats has already
   *    scaled damage, pierce, cooldown and range and forced camo detection on.
   *    Everything here is IDENTITY. If a paragon reads as "the same tower with a
   *    bigger number", the shared baseline was doing all the work.
   *
   * 2. `apply` must be PURE. Restat runs an unpredictable number of times — on
   *    place, on every purchase, on every buff change, on deserialize — so no
   *    sim.rng, no Math.random, no writing to `sim` or `tower.data`, no counters.
   *    An impure apply breaks determinism and the mid-round save, and does it
   *    silently. Randomness belongs in fire(), in abilities and in projectile
   *    behaviours, and it comes from sim.rng there.
   *
   * 3. Scale by `degree / OP.Paragon.MAX_DEGREE`, PER STAT. `Math.max(s.x, f(d))`
   *    looks like scaling and is not: if the tower already exceeds the floor the
   *    stat goes flat and degree stops mattering for it. Write
   *    `Math.max(s.x, floor) + g(d)` instead.
   *
   * 4. Promotion sets `tower.tiers = [5, 5, 5]`, so a promoted tower resolves with
   *    ALL FIFTEEN upgrades applied, not just the legal 5-2-0 it was bought as.
   *    That is the engine's design — a paragon is beyond the tree — and it means
   *    every `apply` below sees a stat block that already has every branch's
   *    tier-5 effect in it. Floors are written with that in mind.
   *
   * VOID is used by exactly two of the six: the Rimecrown Hare, whose whole job
   * is control and which would be blanked by the two cold-immune tiers, and the
   * Eclipse Owl, whose plasma would be blanked by Purple. The other four answer
   * the type chart the way the rest of the game does — shatter, or acid alongside
   * an explosion — because a paragon roster where everything ignores everything
   * makes the type chart pointless for the whole late game.
   *
   * One thing a paragon CANNOT do: change an aura. Towers.restat snapshots
   * `tower.sBase` BEFORE the paragon stats are applied, and `def.buffs` is called
   * against that snapshot so aura geometry never depends on placement order. So a
   * paragon of a support tower has to express itself through its own stats, which
   * is the reason the support slot here is the income tower and not the hall.
   */

  const M = OP.M
  const D = OP.DMG
  const E = OP.Effects
  const MAX = OP.Paragon.MAX_DEGREE

  /* Every paragon costs about 2.6x a full 5-2-0 of its base tower — including
     that tower's own price. Expressed here as round numbers rather than computed,
     because a shop price the player reads should be a number a human chose, but
     the ratio is audited in tools/suites/paragon-roster.mjs so the six stay in
     the same economy as each other. */

  /* ---------- projectile art ---------- */

  OP.declareProjKind('paragon-stone-acorn', { shape: 'dart', tint: '#dcc47e', size: 8, trail: true, spin: true })
  OP.declareProjKind('paragon-stone-splinter', { shape: 'spike', tint: '#b6a577', size: 4, trail: true })
  OP.declareProjKind('paragon-rime-front', { shape: 'puff', tint: '#e2f4ff', size: 13, trail: true })
  OP.declareProjKind('paragon-horizon-round', { shape: 'spike', tint: '#f4e08c', size: 6, trail: true })
  OP.declareProjKind('paragon-siege-shell', { shape: 'shell', tint: '#cbbd8e', size: 10, trail: true })
  OP.declareProjKind('paragon-eclipse-bolt', { shape: 'orb', tint: '#8f6ce0', size: 7, trail: true, spin: true })
  OP.declareProjKind('paragon-thorn-berry', { shape: 'spike', tint: '#94303f', size: 6, trail: true })
  OP.declareProjKind('paragon-thorn-bramble', { shape: 'blob', tint: '#43602c', size: 9 })

  /* ---------- shared helpers ----------
     Module scope, never stored on an entity, so nothing here can make the sim
     unserialisable. */

  const IDS = []
  const AIM = { x: 0, y: 0 }

  /** 0..1. Every scaling term below is written against this. */
  function norm (degree) { return M.clamp01(degree / MAX) }

  /** Life long enough to actually cross `dist`, never shorter than projLife. */
  function flightLife (s, dist) {
    const speed = s.projSpeed > 1 ? s.projSpeed : 1
    return Math.max(s.projLife, dist / speed * 1.2 + 0.05)
  }

  /** Symmetric fan offset for shot `i` of `n` across `spread` radians. */
  function fanOffset (i, n, spread) {
    return n <= 1 ? 0 : spread * (i / (n - 1) - 0.5)
  }

  function isBlimp (b) { return !!OP.BALLOON_TIERS[b.tier].blimp }

  /**
   * Every live balloon a paragon is allowed to touch, as ids.
   *
   * Snapshotted as ids before anything is damaged: a hit can split a balloon and
   * append its children to sim.balloons, and a field-wide effect must not then
   * hit the children it just created. The camo gate applies here too — VEILED is
   * a targeting restriction and an area effect that skipped the check would leak
   * camo straight through (every paragon detects camo, but the gate is written
   * once and correctly rather than assumed away).
   */
  function fieldIds (sim, camoDetect, out) {
    out.length = 0
    const list = sim.balloons
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !camoDetect) continue
      out.push(b.id)
    }
    return out
  }

  /* ---------- projectile behaviours ----------
     String keys into OP.PROJ_BEHAVIOURS, never closures on the projectile. */

  /* Stonecrown Vulpine. A stone-cored acorn does two things an ordinary one does
     not: it cracks and throws splinters, and it keeps going. The bounce refunds
     the pierce it just spent, which is what turns "wide fan" into "the corner is
     covered". Both budgets live in `p.data` as plain numbers, so a mid-round save
     round-trips them. */
  OP.PROJ_BEHAVIOURS['paragon-stone-split'] = {
    onHit: function (sim, p, balloon, res) {
      const d = p.data
      if (!d) return

      if (d.spl > 0 && res && res.layersPopped > 0) {
        d.spl--
        for (let i = 0; i < 2; i++) {
          const a = sim.rng.range(0, M.TAU)
          const speed = sim.rng.range(170, 300)
          OP.Projectiles.spawn(sim, {
            x: p.x, y: p.y,
            vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
            kind: 'paragon-stone-splinter',
            damage: d.sdmg, dmgType: p.dmgType, pierce: 3,
            radius: 4, life: 0.45,
            ownerId: p.ownerId, camoDetect: true
          })
        }
      }

      if (d.bounces > 0) {
        d.bounces--
        const angle = Math.atan2(p.vy, p.vx) + sim.rng.range(-0.8, 0.8)
        const speed = Math.hypot(p.vx, p.vy)
        p.vx = Math.cos(angle) * speed
        p.vy = Math.sin(angle) * speed
        p.pierce++
        p.life += 0.2
        if (p.maxRange > 0) p.maxRange += 70
      }
    }
  }

  /* ---------- abilities ----------
     Registered by string key, as OP.ABILITIES entries. OP.Paragon.applyStats
     attaches `def.ability` AFTER apply() runs, which deliberately replaces
     whatever tier-5 ability the base tower had: a promoted tower has one button,
     and it is the paragon's.

     None of these pass `ignoreAbilityImmunity`. OMEN is `abilityImmune`, and the
     point of that flag is that no single button press removes the last blimp —
     paragon or not. */

  /* Stonecrown Vulpine: a hail of stone on the heaviest things in reach. One
     shared exclude set across the whole volley, so a balloon caught by three
     overlapping impacts still only takes one. */
  OP.ABILITIES['paragon-vulpine-stonefall'] = function (sim, tower) {
    const s = tower.s
    const degree = tower.paragonDegree
    const d = norm(degree)
    const count = 6 + Math.floor(degree / 7)
    const radius = 60 + degree * 0.9
    const damage = Math.round(s.damage * (3 + d * 5))
    const seen = new Set()

    OP.Targeting.acquireMany(sim, tower, 'strong', count, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      const x = b.x
      const y = b.y
      OP.Damage.blast(sim, x, y, radius, {
        damage: damage, dmgType: D.SHATTER, sourceId: tower.id
      }, { camoDetect: true, maxTargets: 60, exclude: seen })
      sim.blastEvents.push({ x: x, y: y, radius: radius, kind: 'paragon-stone-acorn', hits: 0 })
    }
  }

  /* Rimecrown Hare: the whole field goes quiet. Rime damage ignores every
     immunity, and the slow is delivered as glue as well as cold so the two
     cold-immune tiers are held too. */
  OP.ABILITIES['paragon-hare-white-silence'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const damage = Math.round(s.damage * (1 + d * 3))
    const hold = 5 + d * 7
    const freeze = 1.5 + d * 3.5
    const grip = Math.min(0.95, 0.60 + d * 0.35)

    fieldIds(sim, true, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, {
        damage: damage,
        dmgType: D.VOID,
        sourceId: tower.id,
        effects: [
          E.make('glue', hold, grip, tower.id, D.NORMAL),
          E.make('cold', hold, Math.min(0.95, 0.70 + d * 0.25), tower.id, D.COLD),
          E.make('stun', freeze, 1, tower.id, D.COLD),
          E.make('brittle', hold, 1 + d * 2, tower.id, D.NORMAL)
        ]
      })
    }
    sim.blastEvents.push({
      x: tower.x, y: tower.y, radius: s.range, kind: 'paragon-rime-front', hits: IDS.length
    })
  }

  /* Horizonshot Lynx: names its shots and they land, anywhere on the map. This is
     the roster's one instant-kill, which is exactly why OMEN carries
     `abilityImmune` — the last blimp is not something one bullet takes off the
     board, and nothing here asks the engine to pretend otherwise. */
  OP.ABILITIES['paragon-lynx-called-shot'] = function (sim, tower) {
    const count = 4 + Math.floor(tower.paragonDegree / 9)
    OP.Targeting.acquireMany(sim, tower, 'strong', count, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, {
        damage: 0, dmgType: D.SHATTER, sourceId: tower.id, instaKill: true
      })
    }
  }

  /* Bastion Mole: walks a crater down every track on the map. Craters are laid at
     even spacing along each path, and one shared exclude set means a balloon in
     the overlap of four of them is still only shelled once — which is what keeps
     the ability a screen-clear rather than an accidental multiplier. */
  OP.ABILITIES['paragon-mole-barrage'] = function (sim, tower) {
    const s = tower.s
    const degree = tower.paragonDegree
    const d = norm(degree)
    const per = 6 + Math.floor(degree / 9)
    const radius = Math.round(70 + d * 130)
    const damage = Math.round(s.damage * (0.25 + d * 0.35))
    const effects = siegeEffects(s, tower.id)
    const seen = new Set()
    const paths = sim.map.paths

    for (let pi = 0; pi < paths.length; pi++) {
      const track = paths[pi]
      for (let k = 0; k < per; k++) {
        const at = track.posAt(track.length * (k + 0.5) / per)
        OP.Damage.blast(sim, at.x, at.y, radius, {
          damage: damage, dmgType: s.dmgType, sourceId: tower.id, effects: effects
        }, { camoDetect: true, maxTargets: 80, exclude: seen })
        sim.blastEvents.push({ x: at.x, y: at.y, radius: radius, kind: 'paragon-siege-shell', hits: 0 })
      }
    }
  }

  /* Eclipse Owl: the light goes out. Every balloon on the field takes rime-black
     damage nothing resists, and the heaviest one gets the sky dropped on it. */
  OP.ABILITIES['paragon-owl-eclipse'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const wide = Math.round(s.damage * (0.5 + d * 1.5))

    fieldIds(sim, true, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, { damage: wide, dmgType: D.VOID, sourceId: tower.id })
    }

    // And the eclipse itself, centred on whatever is worst.
    let x = tower.x
    let y = tower.y
    const focus = OP.Targeting.acquire(sim, tower, 'strong')
    if (focus >= 0) {
      const b = sim.byId.get(focus)
      if (b && b.alive) { x = b.x; y = b.y }
    }
    const radius = s.diveRadius || 120
    OP.Damage.blast(sim, x, y, radius, {
      damage: Math.round(s.damage * (2 + d * 6)), dmgType: D.VOID, sourceId: tower.id
    }, { camoDetect: true, maxTargets: 200 })
    sim.blastEvents.push({ x: x, y: y, radius: radius, kind: 'paragon-eclipse-bolt', hits: 0 })
  }

  /* Thornhold Warren: the year's whole crop at once, and the bramble comes up
     with it. The payout is the ability; the thorn patches are what stops you
     regretting the button while a round is running. */
  OP.ABILITIES['paragon-warren-great-harvest'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    OP.Economy.earn(sim, s.tithe || 1, tower.id)

    const count = s.thorns || 8
    const ring = s.range * 0.72
    for (let i = 0; i < count; i++) {
      const a = (i / count) * M.TAU
      OP.Projectiles.spawn(sim, {
        x: tower.x + Math.cos(a) * ring,
        y: tower.y + Math.sin(a) * ring,
        vx: 0, vy: 0,
        kind: 'paragon-thorn-bramble',
        damage: Math.max(1, Math.round(s.damage * (0.6 + d * 0.9))),
        dmgType: D.SHARP,
        pierce: 12 + Math.round(d * 60),
        radius: 16 + Math.round(d * 18),
        life: s.thornLife || 5,
        ownerId: tower.id, camoDetect: true
      })
    }
  }

  /** Burn / acid / brittle carried by a siege shell, built from the stat block. */
  function siegeEffects (s, sourceId) {
    const out = []
    if (s.burnDps > 0) out.push(E.make('burn', s.burnTime, s.burnDps, sourceId, D.FIRE))
    if (s.acidDps > 0) out.push(E.make('acid', s.acidTime, s.acidDps, sourceId, D.ACID))
    if (s.brittleMag > 0) out.push(E.make('brittle', s.brittleTime, s.brittleMag, sourceId, D.NORMAL))
    return out.length ? out : null
  }

  /* ======================================================================
     1. STONECROWN VULPINE  ·  acorn-fox  ·  the archetype

     The $170 starter, taken as far as it goes. It is still throwing acorns —
     that is the point of the archetypal paragon. They are just stone now, they
     come in a wide fan, they bounce until they run out of track, and they crack
     into splinters on every pop. Shatter, so nothing in the air resists it.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'acorn-fox',
    name: 'Stonecrown Vulpine',
    blurb: 'The whole grove\'s worth of foxes in one. Throws a fan of stone-cored acorns that ricochet until there is nothing left to hit and split into splinters on every pop. Shatter damage, so nothing in the air resists it.',
    cost: 40000,

    ability: {
      name: 'Stonefall',
      cooldown: 40,
      duration: 0,
      key: 'paragon-vulpine-stonefall'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.SHATTER
      s.ignoresLOS = true

      s.shots = Math.max(s.shots, 1) + 1 + Math.round(d * 4)
      s.spread = Math.max(s.spread, 0.24) + d * 0.30
      s.damage += Math.round(5 + d * 60)
      s.pierce += Math.round(3 + d * 15)
      s.range += 40 + d * 160
      s.projSpeed = Math.max(s.projSpeed, 380) * (1.25 + d * 0.50)
      s.projRadius += 2

      s.behaviour = 'paragon-stone-split'
      s.bounces = Math.max(s.bounces || 0, 2) + 1 + Math.round(d * 6)
      s.splinters = 1 + Math.round(d * 2)
      s.splinterDamage = Math.round(4 + d * 40)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.4
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-stone-acorn',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-stone-split',
          data: { bounces: s.bounces, spl: s.splinters, sdmg: s.splinterDamage }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     2. RIMECROWN HARE  ·  frost-hare  ·  control

     The control paragon. A single breath covers a whole track corner, and what
     it leaves behind is held twice over: cold, and rime that clings. The second
     one matters — White and Zebra cannot be chilled at all, and a control
     paragon that simply does not work on two tiers is not a control paragon. The
     damage is VOID for the same reason.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'frost-hare',
    name: 'Rimecrown Hare',
    blurb: 'Breathes a front of rime wide enough to swallow a track corner. Everything inside is frozen, slowed twice over and left brittle — and White and Zebra, which cannot be chilled at all, are held by the rime instead.',
    cost: 130000,

    ability: {
      name: 'White Silence',
      cooldown: 55,
      duration: 0,
      key: 'paragon-hare-white-silence'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      // Rime is not cold. Nothing is immune to it, which is the whole reason a
      // control paragon is allowed one of the two VOID slots on the roster.
      s.dmgType = D.VOID
      s.ignoresLOS = true
      s.shots = 1

      s.damage += Math.round(4 + d * 40)
      s.pierce += Math.round(10 + d * 60)
      s.range += 30 + d * 90
      s.projRadius += 3
      s.blastRadius = Math.max(s.blastRadius || 0, 22) + Math.round(28 + d * 92)

      s.coldMag = Math.min(0.95, Math.max(s.coldMag || 0, 0.80) + d * 0.15)
      s.coldTime = Math.max(s.coldTime || 0, 4) + d * 6
      s.stunTime = Math.max(s.stunTime || 0, 0.4) + d * 1.4
      s.brittleMag = Math.max(s.brittleMag || 0, 0.8) + d * 1.6
      s.brittleTime = Math.max(s.brittleTime || 0, 4) + d * 4

      // The rime itself: a slow delivered as glue, which no tier resists.
      s.glueMag = Math.min(0.92, 0.50 + d * 0.42)
      s.glueTime = 3 + d * 6
    },

    /* The base tower's puff carries cold, stun and brittle. This one has to add
       the glue, so it needs its own emitter. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = M.clamp(M.dist(tower.x, tower.y, aim.x, aim.y), 24, s.range)

      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-rime-front',
        damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
        ownerId: tower.id, camoDetect: true,
        blastRadius: s.blastRadius, blastOnExpiry: true,
        effects: [
          E.make('cold', s.coldTime, s.coldMag, tower.id, D.COLD),
          E.make('glue', s.glueTime, s.glueMag, tower.id, D.NORMAL),
          E.make('stun', s.stunTime, 1, tower.id, D.COLD),
          E.make('brittle', s.brittleTime, s.brittleMag, tower.id, D.NORMAL)
        ]
      }, centre, s.projSpeed)
    }
  })

  /* ======================================================================
     3. HORIZONSHOT LYNX  ·  longshot-lynx  ·  global reach

     The base tower already shoots the whole map from anywhere. A paragon cannot
     make "unlimited range" more unlimited, so the identity goes the other way:
     it stops being one shot at one balloon. Every volley picks a fresh set of
     targets anywhere on the field and the rounds steer, so nothing is out of
     reach and nothing is missed.

     Note what is NOT here: the spotter network. `def.buffs` is called against
     the pre-paragon stat block (see the header), so setting `s.netTier` in apply
     would be a silent no-op. Better to leave it out than to ship a stat nobody
     reads.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'longshot-lynx',
    name: 'Horizonshot Lynx',
    blurb: 'One shot was never the limit — the target list was. Fires a steering shatter round at every worst thing on the map at once, over any distance and over anything in the way.',
    cost: 240000,

    ability: {
      name: 'Called Shot',
      cooldown: 55,
      duration: 0,
      key: 'paragon-lynx-called-shot'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      // Range is already the whole field several times over; the baseline widens
      // it again. What degree buys here is targets, damage and steering.
      s.dmgType = D.SHATTER
      s.ignoresLOS = true
      s.multiTarget = true

      s.shots = Math.max(s.shots, 3) + 1 + Math.round(d * 5)
      s.damage += Math.round(30 + d * 300)
      s.pierce += Math.round(2 + d * 12)
      s.projSpeed = Math.max(s.projSpeed, 1500) * (1.20 + d * 0.60)
      s.homing = 5 + d * 7
      s.turnRate = 5 + d * 7
      s.roundBlast = Math.round(16 + d * 44)
      s.blimpBonus = (s.blimpBonus || 0) + Math.round(80 + d * 1100)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const n = Math.max(1, Math.round(s.shots))
      OP.Targeting.acquireMany(sim, tower, tower.targetMode, n, IDS)
      const found = IDS.length

      for (let i = 0; i < n; i++) {
        // Spare rounds beyond the target list double up on the primary target.
        let b = target
        if (i < found) {
          const cand = sim.byId.get(IDS[i])
          if (cand && cand.alive) b = cand
        }
        if (!b || !b.alive) continue

        OP.Targeting.leadPoint(sim, tower, b, s.projSpeed, AIM)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-horizon-round',
          damage: s.damage + (isBlimp(b) ? s.blimpBonus : 0),
          dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius + 1, life: 2.5, maxRange: 4000,
          blastRadius: s.roundBlast, blastOnExpiry: false, blastFalloff: 0,
          homing: s.homing, turnRate: s.turnRate, targetId: b.id,
          ownerId: tower.id, camoDetect: true
        }, M.angleTo(tower.x, tower.y, AIM.x, AIM.y), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     4. BASTION MOLE  ·  howitzer-mole  ·  screen clearing

     Still a gun in a hole pointed at a spot the player chose. What changes is
     how much of the map that spot covers: a salvo instead of a shell, scattered
     across a wide footprint, craters that do full damage edge to edge instead of
     falling off, and acid on everything caught — which is how it still hurts the
     Black and Zebra tiers that ignore the explosion itself. No VOID needed.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'howitzer-mole',
    name: 'Bastion Mole',
    blurb: 'A whole battery in one dug-in position. Drops a scattered salvo on its aim point, craters that do full damage edge to edge, and acid that eats the tiers which shrug off an explosion.',
    cost: 200000,

    ability: {
      name: 'Rolling Barrage',
      cooldown: 50,
      duration: 0,
      key: 'paragon-mole-barrage'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.ignoresLOS = true
      s.shots = Math.max(s.shots, 2) + 2 + Math.round(d * 8)
      s.aimSpread = Math.max(s.aimSpread || 0, 40) + Math.round(d * 130)
      s.blastRadius = Math.max(s.blastRadius || 0, 42) + Math.round(28 + d * 112)
      s.blastFalloff = 0                 // full damage across the crater
      s.pierce += Math.round(10 + d * 70)
      s.damage += Math.round(60 + d * 900)
      s.range += 60 + d * 240
      s.projSpeed = Math.max(s.projSpeed, 340) * (1.30 + d * 0.50)

      // Acid is the answer to the explosive-immune tiers, and no tier resists it.
      s.acidDps = (s.acidDps || 0) + Math.round(50 + d * 450)
      s.acidTime = Math.max(s.acidTime || 0, 5) + d * 5
      s.brittleMag = Math.max(s.brittleMag || 0, 0.9) + d * 1.4
      s.brittleTime = Math.max(s.brittleTime || 0, 4) + d * 4
      s.blimpBonus = (s.blimpBonus || 0) + Math.round(200 + d * 2600)
    },

    /* `target` only proved something was in range — where the shells land is the
       aim point, exactly as on the base tower. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const data = tower.data
      if (data.aimX === undefined && OP.Military && OP.Military.defaultAimPoint) {
        OP.Military.defaultAimPoint(sim, tower)
      }
      const ax = data.aimX === undefined ? tower.x : data.aimX
      const ay = data.aimY === undefined ? tower.y : data.aimY

      const effects = siegeEffects(s, tower.id)
      const damage = s.damage + (target && isBlimp(target) ? s.blimpBonus : 0)
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        const x = M.clamp(ax + sim.rng.range(-s.aimSpread, s.aimSpread), 4, OP.FIELD_W - 4)
        const y = M.clamp(ay + sim.rng.range(-s.aimSpread, s.aimSpread), 4, OP.FIELD_H - 4)
        const dist = Math.max(12, M.dist(tower.x, tower.y, x, y))
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-siege-shell',
          damage: damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: dist / s.projSpeed + 0.05, maxRange: dist,
          blastRadius: s.blastRadius, blastOnExpiry: true, blastFalloff: s.blastFalloff,
          ownerId: tower.id, camoDetect: true,
          effects: effects
        }, M.angleTo(tower.x, tower.y, x, y), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     5. ECLIPSE OWL  ·  elder-owl  ·  the spectacle

     The loudest of the six. A full ring of bolts in every direction at once,
     every one of them detonating, and the light goes out when the ability fires.
     The damage is VOID: the owl's plasma is stopped dead by Purple, and the most
     expensive thing in the game having a tier it cannot touch is the one place
     the type chart stops being interesting.

     `fire` is deliberately absent. The magic family's volley already reads
     `s.projKind`, `s.shots`, `s.spread`, `s.blastRadius` and `s.pierce`, so the
     ring, the art and the detonation all come from `apply` — an override would
     be a copy of code that already works.

     The cooldown gets a degree-scaled floor rather than the baseline's raw value.
     Twenty-six bolts every sixteen milliseconds is a projectile blizzard nobody
     can see; the volley pays for its rate in size instead. The floor still moves
     with degree, so degree is never ignored.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'elder-owl',
    name: 'Eclipse Owl',
    blurb: 'Out of patience, out of daylight. Fires a complete ring of detonating bolts in every direction at once, and its ability puts the whole field under shadow that nothing is immune to.',
    cost: 1100000,

    ability: {
      name: 'Eclipse',
      cooldown: 60,
      duration: 0,
      key: 'paragon-owl-eclipse'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.VOID
      s.projKind = 'paragon-eclipse-bolt'
      s.ignoresLOS = true

      s.shots = Math.max(s.shots, 10) + Math.round(d * 8)
      s.spread = M.TAU * (s.shots - 1) / s.shots      // a closed ring
      s.damage += Math.round(30 + d * 420)
      s.pierce += Math.round(3 + d * 20)
      s.blastRadius = Math.max(s.blastRadius || 0, 24) + Math.round(10 + d * 50)
      s.blastFalloff = 0
      s.projLife *= 1.4
      s.projSpeed *= 1.15
      s.projRadius += 2
      s.range += 60 + d * 340

      // Read by the ability, not by the attack.
      s.diveRadius = Math.round(120 + d * 220)

      const floor = 0.16 - d * 0.06
      if (s.cooldown < floor) s.cooldown = floor
    }
  })

  /* ======================================================================
     6. THORNHOLD WARREN  ·  berry-warren  ·  scale is the point

     The economy paragon. A burrow that pays out a few dollars every couple of
     seconds becomes one that pays out hundreds several times a second, and the
     gap between a degree-10 fusion and a degree-100 one is the whole reason to
     hold off promoting until the board is worth sacrificing.

     Two deliberate changes beyond the numbers:

     - The bank is closed. Harvests are paid straight into your hand instead of
       filling a cellar that empties at a cap, because a paragon whose income is
       invisible for two minutes reads as broken. Whatever was already in the
       cellar went into the fusion.
     - It fights. The base tower's blurb says the rabbits will not help you, and
       that is true right up until the bramble is the size of the hill. It is not
       a damage tower — it is a support tower with thorns — but it is no longer
       zero.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'berry-warren',
    name: 'Thornhold Warren',
    blurb: 'The bramble has taken the whole hillside. Pays out a fortune several times a second instead of a handful every two, and the thorns finally do the one thing the rabbits always refused to.',
    cost: 90000,

    ability: {
      name: 'Great Harvest',
      cooldown: 45,
      duration: 0,
      key: 'paragon-warren-great-harvest'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      /* ---- the economy ---- */
      s.yield = Math.round(Math.max(s.yield || 0, 5) * (1.6 + d * 3.0)) + Math.round(30 + d * 170)
      s.harvest = Math.max(0.15, Math.max(s.harvest || 2, 0.4) * (0.70 - d * 0.35))
      // Closed cellar: every harvest is paid straight out.
      s.bankCap = 0
      s.bankRate = 0
      s.lump = Math.round((s.lump || 0) * (1.5 + d * 2.5)) + Math.round(400 + d * 4600)
      s.lumpPerRound = Math.round((s.lumpPerRound || 0) * (1.2 + d * 0.8)) + Math.round(10 + d * 90)
      s.tithe = Math.round(1500 + d * 26000)

      /* ---- and it fights ---- */
      // The base tower has damage 0 and projSpeed 0, so these are ASSIGNED, not
      // multiplied: the shared baseline cannot scale a zero, and a projectile
      // with speed 0 would sit on the burrow and still register hits.
      s.dmgType = D.SHARP
      s.damage += Math.round(10 + d * 150)
      s.pierce = Math.max(s.pierce, 3) + Math.round(2 + d * 18)
      s.projSpeed = 420 + d * 260
      s.projLife = 1.4
      s.projRadius = 5
      s.shots = Math.max(s.shots, 3) + Math.round(d * 7)
      s.spread = M.TAU * 0.9
      s.range += 70 + d * 150
      s.targetModes = OP.TARGET_MODES.slice()

      // Read by the ability.
      s.thorns = 8 + Math.round(d * 16)
      s.thornLife = 4 + d * 6
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.2
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-thorn-berry',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

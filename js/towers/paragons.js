;(function (OP) {
  'use strict'

  /* PARAGONS — the tier-6 fusions.
   *
   * Sixteen of the thirty-one towers have one. Promotion consumes every other tower
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
  OP.declareProjKind('paragon-honey-bee', { shape: 'circle', tint: '#f0d060', size: 4, trail: true })
  OP.declareProjKind('paragon-boom-crown', { shape: 'dart', tint: '#e8a040', size: 8, trail: true, spin: true })
  OP.declareProjKind('paragon-shadow-bolt', { shape: 'dart', tint: '#604080', size: 7, trail: true, spin: true })
  OP.declareProjKind('paragon-cannon-shell', { shape: 'shell', tint: '#d06030', size: 10, trail: true })
  OP.declareProjKind('paragon-tidal-bolt', { shape: 'orb', tint: '#40a0d0', size: 7, trail: true, spin: true })
  OP.declareProjKind('paragon-thorn-nova', { shape: 'circle', tint: '#a0c040', size: 1, trail: false })
  OP.declareProjKind('paragon-brew-deluge', { shape: 'circle', tint: '#60c080', size: 1, trail: false })
  OP.declareProjKind('paragon-gear-turret', { shape: 'circle', tint: '#c0a040', size: 1, trail: false })
  OP.declareProjKind('paragon-rotavolt-overdrive', { shape: 'circle', tint: '#e06040', size: 1, trail: false })

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

  /* Swarmspire Warren bees. A bee homes in on the nearest balloon, damages it,
     and then homes in on the next. The bee has a turn rate so it curves rather
     than snapping, which looks like a swarm and not a teleport. */
  OP.PROJ_BEHAVIOURS['paragon-bee-hunt'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data) return
      p.life = Math.max(p.life, 0.1)
    },
    onTick: function (sim, p, dt) {
      if (!p.data) return
      const speed = p.data.speed || 300
      const turnRate = p.data.turnRate || 3.0

      let best = null
      let bestDist = 200
      for (const t of sim.balloons) {
        if (!t.alive) continue
        const dx = t.x - p.x
        const dy = t.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < bestDist) {
          bestDist = dist
          best = t
        }
      }
      if (!best) return

      const targetAngle = Math.atan2(best.y - p.y, best.x - p.x)
      const currentAngle = Math.atan2(p.vy, p.vx)
      let diff = targetAngle - currentAngle
      while (diff > Math.PI) diff -= Math.TAU
      while (diff < -Math.PI) diff += Math.TAU
      const clamp = Math.min(Math.abs(diff), turnRate * dt)
      const newAngle = currentAngle + Math.sign(diff) * clamp
      p.vx = Math.cos(newAngle) * speed
      p.vy = Math.sin(newAngle) * speed
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

  /* Echo Crown Weasel: a storm of runes rains down on the strongest targets,
     each one chaining to nearby balloons. The chains overlap, covering the
     entire screen in bouncing magical projectiles. */
  OP.ABILITIES['paragon-weasel-rune-storm'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const count = 8 + Math.floor(tower.paragonDegree / 5)
    const chainLen = 4 + Math.round(d * 10)

    OP.Targeting.acquireMany(sim, tower, 'strong', count, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-rune-echo',
        damage: Math.round(s.damage * (2 + d * 4)),
        dmgType: D.VOID, pierce: 1,
        radius: 6, life: 1.5, maxRange: s.range * 1.5,
        ownerId: tower.id, camoDetect: true,
        behaviour: 'paragon-rune-chain',
        data: { hits: 0, maxChain: chainLen }
      }, M.angleTo(tower.x, tower.y, b.x, b.y), 500)
    }
  }

  /* Swarmspire Warren: a massive burst of bees floods the track, each one
     homing independently. The bees persist for a long time and turn fast,
     creating an inescapable cloud of damage. */
  OP.ABILITIES['paragon-badger-hive-mind'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const count = 20 + Math.round(d * 40)

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * M.TAU
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-honey-bee',
        damage: Math.round(s.beeDamage * (1.5 + d * 2)),
        dmgType: D.NORMAL, pierce: 3,
        radius: 5, life: s.beeLife * 1.5, maxRange: 9999,
        ownerId: tower.id, camoDetect: true,
        behaviour: 'paragon-bee-hunt',
        data: { speed: s.beeSpeed * 1.2, turnRate: 5.0 }
      }, angle, s.beeSpeed * 1.2)
    }
  }

  /* Ricochet Crown: a hail of ricocheting boomerangs that bounce between
     balloons, each one growing stronger with each hit. The densest group
     cannot survive. */
  OP.ABILITIES['paragon-boom-storm'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const count = 8 + Math.floor(tower.paragonDegree / 6)

    OP.Targeting.acquireMany(sim, tower, 'strong', count, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-boom-crown',
        damage: Math.round(s.damage * (2 + d * 3)),
        dmgType: D.SHARP, pierce: 1,
        radius: s.projRadius, life: 2, maxRange: s.range * 1.5,
        ownerId: tower.id, camoDetect: true,
        behaviour: 'paragon-boom-ricochet',
        data: { hits: 0, maxBounces: 6 + Math.round(d * 10) }
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
  }

  /* Shadow Crown: a wave of void energy hits every balloon on the field,
     applying brittle and dealing massive damage. Nothing is immune. */
  OP.ABILITIES['paragon-shadow-domination'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const damage = Math.round(s.damage * (3 + d * 5))

    fieldIds(sim, true, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, {
        damage: damage,
        dmgType: D.VOID,
        sourceId: tower.id,
        effects: [
          E.make('brittle', 3 + d * 3, 2 + d * 3, tower.id, D.NORMAL)
        ]
      })
    }
  }

  /* Siege Crown: a carpet of explosive shells rains down across the entire track,
      each one exploding on impact and leaving burning craters. */
  OP.ABILITIES['paragon-cannon-bombardment'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const count = 12 + Math.floor(tower.paragonDegree / 4)
    const damage = Math.round(s.damage * (1 + d * 1.5))
    const blastRadius = s.blastRadius || 80

    for (let i = 0; i < count; i++) {
      const x = sim.rng.range(100, OP.FIELD_W - 100)
      const y = sim.rng.range(100, OP.FIELD_H - 100)
      OP.Damage.blast(sim, x, y, blastRadius, {
        damage: damage, dmgType: D.EXPLOSIVE, sourceId: tower.id
      }, { camoDetect: true, maxTargets: 60 })
      sim.blastEvents.push({ x: x, y: y, radius: blastRadius, kind: 'paragon-cannon-shell', hits: 0 })
    }
  }

  /* Tidal Crown: a massive wave sweeps across the entire track, slowing all
      balloons and dealing damage over time. The whole track becomes a pool. */
  OP.ABILITIES['paragon-tidal-surge'] = function (sim, tower) {
    const s = tower.s
    const d = norm(tower.paragonDegree)
    const damage = Math.round(s.damage * (1 + d * 1.5))
    const hold = 3 + d * 3

    fieldIds(sim, true, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, {
        damage: damage,
        dmgType: D.NORMAL,
        sourceId: tower.id,
        effects: [
          E.make('glue', hold, 0.8, tower.id, D.NORMAL),
          E.make('brittle', hold, 1 + d * 2, tower.id, D.NORMAL)
        ]
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

  /* ======================================================================
     7. ECHO CROWN WEASEL  ·  rune-weasel  ·  magic chain

     The chain-caster paragon. Every rune fires from the tower and chains to
     nearby targets, hitting more balloons with each bounce. At high degree the
     chain length is enormous and each link applies a random debuff. The magic
     family's answer to late-game mass popping.
     ====================================================================== */

  OP.declareProjKind('paragon-rune-echo', { shape: 'circle', tint: '#f0d870', size: 6, trail: true })

  OP.PROJ_BEHAVIOURS['paragon-rune-chain'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data) return
      const hits = p.data.hits || 0
      const maxChain = p.data.maxChain || 0
      if (hits >= maxChain) return

      const range = 180
      let best = null
      let bestDist = range
      for (const t of sim.balloons) {
        if (!t.alive || t.id === b.id) continue
        const dx = t.x - b.x
        const dy = t.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < bestDist) {
          bestDist = dist
          best = t
        }
      }
      if (!best) return

      OP.Projectiles.fireAt(sim, {
        x: b.x, y: b.y,
        kind: 'paragon-rune-echo',
        damage: Math.round(p.damage * 0.8),
        dmgType: p.dmgType, pierce: 1,
        radius: p.radius, life: 0.8, maxRange: range,
        ownerId: p.ownerId, camoDetect: true,
        behaviour: 'paragon-rune-chain',
        data: { hits: hits + 1, maxChain: maxChain }
      }, M.angleTo(b.x, b.y, best.x, best.y), 420)
    }
  }

  OP.defineParagon({
    towerKey: 'rune-weasel',
    name: 'Echo Crown Weasel',
    blurb: 'Channels the wisdom of every weasel into a single staff. Fires chain-lightning runes that bounce between balloons, each link applying a random debuff. The chain grows longer with degree.',
    cost: 130000,

    ability: {
      name: 'Rune Storm',
      cooldown: 45,
      duration: 0,
      key: 'paragon-weasel-rune-storm'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.VOID
      s.ignoresLOS = true
      s.camoDetect = true

      s.shots = Math.max(s.shots, 1) + Math.round(d * 3)
      s.damage += Math.round(8 + d * 50)
      s.pierce += Math.round(4 + d * 20)
      s.range += 60 + d * 200
      s.projSpeed = Math.max(s.projSpeed, 400) * (1.3 + d * 0.4)
      s.projRadius += 3

      s.behaviour = 'paragon-rune-chain'
      s.maxChain = 3 + Math.round(d * 12)
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
          kind: 'paragon-rune-echo',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-rune-chain',
          data: { hits: 0, maxChain: s.maxChain }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     8. SWARMSPIRE WARREN  ·  honey-badger  ·  support swarm

     The swarm paragon. Spawns an endless cloud of bees that hunt independently,
     and its aura buffs every tower on the board with massive attack speed and
     damage. The support family's capstone: scale IS the point.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'honey-badger',
    name: 'Swarmspire Warren',
    blurb: 'A thousand hives in one. Its bees blanket the entire track while its aura grants every tower on the board a surge of fury. The swarm does not stop.',
    cost: 180000,

    ability: {
      name: 'Hive Mind',
      cooldown: 35,
      duration: 10,
      key: 'paragon-badger-hive-mind'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.NORMAL
      s.camoDetect = true
      s.beeCount = 4 + Math.round(d * 20)
      s.beeDamage = Math.round(3 + d * 30)
      s.beeSpeed = 300 + d * 100
      s.beeLife = 3 + d * 4

      s.range = 9999
      s.damage += Math.round(2 + d * 10)
      s.pierce += Math.round(1 + d * 5)

      s.auraDamageMul = 1.0 + d * 0.8
      s.auraAttackSpeedMul = 1.0 + d * 0.6
      s.auraPierceMul = 1.0 + d * 0.4

      // Initialize honeyTowers if not present (needed by update function)
      if (!tower.data.honeyTowers) tower.data.honeyTowers = new Map()
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const count = Math.max(1, Math.round(s.beeCount))

      for (let i = 0; i < count; i++) {
        const angle = M.TAU * (i / count)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-honey-bee',
          damage: s.beeDamage, dmgType: s.dmgType, pierce: 2,
          radius: 4, life: s.beeLife, maxRange: 9999,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-bee-hunt',
          data: { speed: s.beeSpeed, turnRate: 4.0 }
        }, angle, s.beeSpeed)
      }
    }
  })

  /* ======================================================================
     9. RICOCHET CROWN  ·  boomer-badger  ·  primary bounce

     The bounce paragon. Every boomerang ricochets between balloons endlessly,
     and each bounce increases its damage. At high degree the ricochet count is
     enormous and the damage scaling makes each hit harder than the last. The
     primary family's answer to dense grouped balloons.
     ====================================================================== */

  OP.PROJ_BEHAVIOURS['paragon-boom-ricochet'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data) return
      const hits = p.data.hits || 0
      const maxBounces = p.data.maxBounces || 0
      if (hits >= maxBounces) return

      const range = 200
      let best = null
      let bestDist = range
      for (const t of sim.balloons) {
        if (!t.alive || t.id === b.id) continue
        const dx = t.x - b.x
        const dy = t.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < bestDist) {
          bestDist = dist
          best = t
        }
      }
      if (!best) return

      p.data.hits = hits + 1
      p.damage = Math.round(p.damage * 1.15)

      OP.Projectiles.fireAt(sim, {
        x: b.x, y: b.y,
        kind: 'paragon-boom-crown',
        damage: p.damage,
        dmgType: p.dmgType, pierce: 1,
        radius: p.radius, life: 1.2, maxRange: range,
        ownerId: p.ownerId, camoDetect: true,
        behaviour: 'paragon-boom-ricochet',
        data: { hits: hits + 1, maxBounces: maxBounces }
      }, M.angleTo(b.x, b.y, best.x, best.y), 450)
    }
  }

  OP.defineParagon({
    towerKey: 'boomer-badger',
    name: 'Ricochet Crown',
    blurb: 'Every boomerang becomes a crown that bounces between balloons, growing stronger with each hit. The densest group cannot survive.',
    cost: 120000,

    ability: {
      name: 'Crown Storm',
      cooldown: 40,
      duration: 0,
      key: 'paragon-boom-storm'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.SHARP
      s.camoDetect = true

      s.shots = Math.max(s.shots, 1) + Math.round(d * 3)
      s.spread = Math.max(s.spread, 0.3) + d * 0.2
      s.damage += Math.round(4 + d * 40)
      s.pierce += Math.round(3 + d * 12)
      s.range += 50 + d * 180
      s.projSpeed = Math.max(s.projSpeed, 350) * (1.2 + d * 0.4)
      s.projRadius += 3

      s.behaviour = 'paragon-boom-ricochet'
      s.maxBounces = 4 + Math.round(d * 14)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-boom-crown',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-boom-ricochet',
          data: { hits: 0, maxBounces: s.maxBounces }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     10. SHADOW CROWN  ·  shadow-marten  ·  magic stealth

     The stealth paragon. Every shot ignores all immunities and can hit any
     balloon regardless of camo/lead/white status. The marten's sabotage
     becomes total: no balloon is safe from its empowered strikes.
     ====================================================================== */

  OP.PROJ_BEHAVIOURS['paragon-shadow-pierce'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data) return
      OP.Effects.apply(b, OP.Effects.make('brittle', 2, 2, p.ownerId, D.VOID))
    }
  }

  OP.defineParagon({
    towerKey: 'shadow-marten',
    name: 'Shadow Crown',
    blurb: 'The shadow that cannot be escaped. Every bolt ignores all immunities and leaves balloons brittle and vulnerable. No camo, no lead, no white can stop it.',
    cost: 150000,

    ability: {
      name: 'Shadow Domination',
      cooldown: 45,
      duration: 0,
      key: 'paragon-shadow-domination'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.VOID
      s.ignoresLOS = true
      s.camoDetect = true

      s.shots = Math.max(s.shots, 1) + Math.round(d * 4)
      s.damage += Math.round(6 + d * 55)
      s.pierce += Math.round(4 + d * 18)
      s.range += 60 + d * 200
      s.projSpeed = Math.max(s.projSpeed, 400) * (1.3 + d * 0.5)
      s.projRadius += 2

      s.behaviour = 'paragon-shadow-pierce'
      s.brittleTime = 2 + d * 2
      s.brittleMag = 2 + d * 3
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.4
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-shadow-bolt',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-shadow-pierce',
          data: { brittleTime: s.brittleTime, brittleMag: s.brittleMag }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     11. SIEGE CROWN  ·  cannon-boar  ·  primary explosive

     The explosive paragon. Every shell is a massive cannonball that explodes
     on impact, dealing area damage and leaving burning craters. At high degree
     the explosions chain, creating a carpet of fire across the track.
     ====================================================================== */

  OP.defineParagon({
    towerKey: 'cannon-boar',
    name: 'Siege Crown',
    blurb: 'Every shell is a volcanic eruption. The explosions chain across the track, leaving burning craters that damage everything they touch. The densest groups turn to ash.',
    cost: 140000,

    ability: {
      name: 'Carpet Bombardment',
      cooldown: 50,
      duration: 0,
      key: 'paragon-cannon-bombardment'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.EXPLOSIVE
      s.camoDetect = true

      s.shots = Math.max(s.shots, 1) + Math.round(d * 2)
      s.damage += Math.round(10 + d * 80)
      s.pierce += Math.round(5 + d * 20)
      s.range += 50 + d * 180
      s.projSpeed = Math.max(s.projSpeed, 320) * (1.2 + d * 0.4)
      s.projRadius += 4

      s.burnDps = 15 + Math.round(d * 20)
      s.burnTime = 3 + d * 2
      s.blastRadius = 60 + Math.round(d * 80)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-cannon-shell',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-cannon-explode',
          data: { blastRadius: s.blastRadius, burnDps: s.burnDps, burnTime: s.burnTime }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     12. TIDAL CROWN  ·  diver-otter  ·  military depth

     The depth paragon. Every projectile creates a water vortex that pulls
     balloons inward and deals damage over time. The otter's mastery of
     water becomes total: the whole track is a killing pool.
     ====================================================================== */

  OP.PROJ_BEHAVIOURS['paragon-tidal-vortex'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data) return
      OP.Effects.apply(b, OP.Effects.make('glue', 2, 0.6, p.ownerId, D.NORMAL))
    }
  }

  OP.defineParagon({
    towerKey: 'diver-otter',
    name: 'Tidal Crown',
    blurb: 'The ocean answers to no one but the otter. Every bolt creates a vortex that pulls balloons inward, and the whole track becomes a killing pool.',
    cost: 160000,

    ability: {
      name: 'Tidal Surge',
      cooldown: 45,
      duration: 0,
      key: 'paragon-tidal-surge'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.NORMAL
      s.camoDetect = true
      s.ignoresLOS = true
      s.onlyBlimps = false

      s.shots = Math.max(s.shots, 1) + Math.round(d * 4)
      s.damage += Math.round(5 + d * 50)
      s.pierce += Math.round(4 + d * 16)
      s.range += 60 + d * 200
      s.projSpeed = Math.max(s.projSpeed, 380) * (1.3 + d * 0.5)
      s.projRadius += 3

      s.behaviour = 'paragon-tidal-vortex'
      s.vortexRadius = 80 + Math.round(d * 60)
      s.vortexDps = 10 + Math.round(d * 25)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.4
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-tidal-bolt',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-tidal-vortex',
          data: { vortexRadius: s.vortexRadius, vortexDps: s.vortexDps }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     13. THORNSPIRE CROWN  ·  thistle-hedgehog  ·  primary crowd-control

     The bouncing-crowd-control paragon. Every thorn splits and bounces
     between targets, covering the entire track in a web of damage. At high
     degree the thorns apply slow and stun, making it a control powerhouse.
     ====================================================================== */

  OP.declareProjKind('paragon-thorn-spire', { shape: 'spike', tint: '#a0c040', size: 7, trail: true, spin: true })
  OP.declareProjKind('paragon-thorn-shard', { shape: 'spike', tint: '#80a030', size: 4, trail: true })

  OP.PROJ_BEHAVIOURS['paragon-thorn-bounce'] = {
    onHit: function (sim, p, balloon, res) {
      if (!p.data) return
      const bounces = p.data.bounces || 0
      if (bounces <= 0) return
      p.data.bounces--

      const range = 200
      let best = null
      let bestDist = range
      const list = sim.balloons
      for (let i = 0; i < list.length; i++) {
        const b = list[i]
        if (!b.alive || b.id === balloon.id) continue
        if ((b.props & OP.PROP.VEILED) && !p.camoDetect) continue
        const dx = b.x - p.x, dy = b.y - p.y
        const dist = dx * dx + dy * dy
        if (dist < bestDist) { bestDist = dist; best = b }
      }
      if (!best) return

      const a = Math.atan2(best.y - p.y, best.x - p.x)
      const speed = p.data.speed || 350
      OP.Projectiles.spawn(sim, {
        x: p.x, y: p.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        kind: 'paragon-thorn-shard',
        damage: p.damage * 0.7, dmgType: p.dmgType, pierce: 2,
        radius: 3, life: 0.8,
        ownerId: p.ownerId, camoDetect: true,
        behaviour: 'paragon-thorn-bounce',
        data: { bounces: p.data.bounces, speed: speed }
      })
    }
  }

  OP.ABILITIES['paragon-thorn-nova'] = function (sim, tower) {
    const s = tower.s
    const n = 12 + Math.round(s.pierce)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * M.TAU
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-thorn-spire',
        damage: s.damage * 1.5, dmgType: s.dmgType, pierce: 4,
        radius: s.projRadius, life: 1.2,
        maxRange: s.range * 1.6,
        ownerId: tower.id, camoDetect: true,
        behaviour: 'paragon-thorn-bounce',
        data: { bounces: 3, speed: s.projSpeed }
      }, a, s.projSpeed)
    }
    sim.blastEvents.push({ x: tower.x, y: tower.y, radius: s.range * 1.6, kind: 'paragon-thorn-nova', hits: 0 })
  }

  OP.defineParagon({
    towerKey: 'thistle-hedgehog',
    name: 'Thornspire Crown',
    blurb: 'Bouncing thorns cover the entire track. At high degree, every thorn slows and stuns on contact.',
    cost: 75000,

    ability: {
      name: 'Thorn Nova',
      cooldown: 45,
      duration: 0,
      key: 'paragon-thorn-nova'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.SHARP
      s.damage += Math.round(4 + d * 40)
      s.pierce = Math.max(s.pierce, 3) + Math.round(4 + d * 16)
      s.projSpeed = Math.max(s.projSpeed, 360) * (1.2 + d * 0.6)
      s.projRadius += 3
      s.range += 50 + d * 140
      s.shots = Math.max(s.shots, 2) + Math.round(d * 6)
      s.spread = 0.35 + d * 0.3
      s.targetModes = OP.TARGET_MODES.slice()

      s.bounceCount = 2 + Math.round(d * 6)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-thorn-spire',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-thorn-bounce',
          data: { bounces: s.bounceCount, speed: s.projSpeed }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     14. ROTAVOLT CROWN  ·  gatling-raccoon  ·  military suppression

     The rapid-fire suppression paragon. A stream of high-velocity bolts
     that applies suppression to every balloon it touches. At high degree
     the fire rate is insane and the suppression stacks.
     ====================================================================== */

  OP.declareProjKind('paragon-rotavolt-bolt', { shape: 'bolt', tint: '#e06040', size: 5, trail: true })

  OP.PROJ_BEHAVIOURS['paragon-rotavolt-suppress'] = {
    onHit: function (sim, p, balloon, res) {
      if (!balloon.alive) return
      balloon.speedMul *= 0.7
      balloon.effects.push({ type: 'slow', dur: 0.3, id: p.ownerId })
    }
  }

  OP.ABILITIES['paragon-rotavolt-overdrive'] = function (sim, tower) {
    tower.data.overdriveT = 5
    sim.blastEvents.push({ x: tower.x, y: tower.y, radius: 60, kind: 'paragon-rotavolt-overdrive', hits: 0 })
  }

  OP.defineParagon({
    towerKey: 'gatling-raccoon',
    name: 'Rotavolt Crown',
    blurb: 'An unrelenting stream of suppression fire. At high degree the fire rate is overwhelming and slows everything it touches.',
    cost: 160000,

    ability: {
      name: 'Overdrive',
      cooldown: 40,
      duration: 5,
      key: 'paragon-rotavolt-overdrive'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.SHARP
      s.damage += Math.round(1 + d * 12)
      s.pierce = Math.max(s.pierce, 2) + Math.round(1 + d * 6)
      s.cooldown *= Math.max(0.15, 0.5 - d * 0.35)
      s.projSpeed = Math.max(s.projSpeed, 500) * (1.1 + d * 0.4)
      s.projRadius += 2
      s.range += 40 + d * 100
      s.shots = Math.max(s.shots, 4) + Math.round(d * 8)
      s.spread = 0.15 + d * 0.15
      s.targetModes = OP.TARGET_MODES.slice()
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))
      const overdrive = (tower.data.overdriveT || 0) > 0

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-rotavolt-bolt',
          damage: overdrive ? s.damage * 2 : s.damage,
          dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-rotavolt-suppress'
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    },

    update: function (sim, tower, dt) {
      if (tower.data.overdriveT > 0) tower.data.overdriveT = Math.max(0, tower.data.overdriveT - dt)
    }
  })

  /* ======================================================================
     15. BREWING CROWN  ·  brewer-toad  ·  magic zone-control

     The zone-control paragon. Every shot creates a lingering potion cloud
     that damages and debuffs foes inside. At high degree the clouds
     cover the entire track and apply every debuff.
     ====================================================================== */

  OP.declareProjKind('paragon-brew-potion', { shape: 'orb', tint: '#60c080', size: 8, trail: true, spin: true })

  OP.PROJ_BEHAVIOURS['paragon-brew-cloud'] = {
    onHit: function (sim, p, balloon, res) {
      if (!p.data || !balloon.alive) return
      const d = p.data
      if (d.cloudRadius && d.cloudDps) {
        sim.dotEvents = sim.dotEvents || []
        sim.dotEvents.push({ x: p.x, y: p.y, radius: d.cloudRadius, dps: d.cloudDps, ownerId: p.ownerId, dur: 2.0 })
      }
    }
  }

  OP.ABILITIES['paragon-brew-deluge'] = function (sim, tower) {
    const s = tower.s
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = (i / n) * M.TAU
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: 'paragon-brew-potion',
        damage: s.damage * 2, dmgType: D.ACID, pierce: 8,
        radius: s.projRadius + 4, life: 1.5,
        maxRange: s.range * 1.5,
        ownerId: tower.id, camoDetect: true,
        behaviour: 'paragon-brew-cloud',
        data: { cloudRadius: 80, cloudDps: 20 + Math.round(s.damage) }
      }, a, s.projSpeed * 0.8)
    }
    sim.blastEvents.push({ x: tower.x, y: tower.y, radius: s.range * 1.5, kind: 'paragon-brew-deluge', hits: 0 })
  }

  OP.defineParagon({
    towerKey: 'brewer-toad',
    name: 'Brewing Crown',
    blurb: 'Potion clouds blanket the track, damaging and debuffing every foe inside. At high degree the clouds cover everything.',
    cost: 220000,

    ability: {
      name: 'Deluge',
      cooldown: 50,
      duration: 0,
      key: 'paragon-brew-deluge'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.ACID
      s.damage += Math.round(3 + d * 25)
      s.pierce = Math.max(s.pierce, 4) + Math.round(3 + d * 12)
      s.projSpeed = Math.max(s.projSpeed, 300) * (1.2 + d * 0.5)
      s.projRadius += 4
      s.range += 60 + d * 160
      s.shots = Math.max(s.shots, 2) + Math.round(d * 4)
      s.spread = 0.3 + d * 0.2
      s.targetModes = OP.TARGET_MODES.slice()

      s.cloudRadius = 50 + Math.round(d * 40)
      s.cloudDps = 8 + Math.round(d * 20)
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-brew-potion',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true,
          behaviour: 'paragon-brew-cloud',
          data: { cloudRadius: s.cloudRadius, cloudDps: s.cloudDps }
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    }
  })

  /* ======================================================================
     16. GEARSPUN CROWN  ·  tinker-shrew  ·  support mastery

     The support mastery paragon. Every shot buffs nearby towers, and the
     ability creates a field of rapid-fire support turrets. At high degree
     the buffs are enormous and the turrets are numerous.
     ====================================================================== */

  OP.declareProjKind('paragon-gear-bolt', { shape: 'bolt', tint: '#c0a040', size: 6, trail: true })

  OP.ABILITIES['paragon-gear-turrets'] = function (sim, tower) {
    const s = tower.s
    const n = 4 + Math.round(s.shots)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * M.TAU
      const x = tower.x + Math.cos(a) * 60
      const y = tower.y + Math.sin(a) * 60
      sim.blastEvents.push({ x: x, y: y, radius: 40, kind: 'paragon-gear-turret', hits: 0 })
      OP.Damage.blast(sim, x, y, 40, {
        damage: s.damage * 3,
        dmgType: D.SHARP,
        sourceId: tower.id,
        effects: [OP.Effects.make('slow', 0.5, 2, tower.id, D.NORMAL)]
      }, { camoDetect: true, maxTargets: 20 })
    }
  }

  OP.defineParagon({
    towerKey: 'tinker-shrew',
    name: 'Gearspun Crown',
    blurb: 'Mechanical mastery that empowers every tower on the field. Support turrets create overlapping fields of damage and control.',
    cost: 130000,

    ability: {
      name: 'Deploy Turrets',
      cooldown: 40,
      duration: 0,
      key: 'paragon-gear-turrets'
    },

    apply: function (s, tower, sim, degree) {
      const d = norm(degree)

      s.dmgType = D.NORMAL
      s.damage += Math.round(5 + d * 50)
      s.pierce = Math.max(s.pierce, 3) + Math.round(3 + d * 14)
      s.projSpeed = Math.max(s.projSpeed, 400) * (1.2 + d * 0.5)
      s.projRadius += 3
      s.range += 50 + d * 120
      s.shots = Math.max(s.shots, 2) + Math.round(d * 5)
      s.spread = 0.25 + d * 0.2
      s.targetModes = OP.TARGET_MODES.slice()

      s.supportRange = 150 + Math.round(d * 100)
      s.supportDamageMul = 1.3 + d * 0.7
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
      const reach = s.range * 1.3
      const n = Math.max(1, Math.round(s.shots))

      for (let i = 0; i < n; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'paragon-gear-bolt',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: flightLife(s, reach), maxRange: reach,
          ownerId: tower.id, camoDetect: true
        }, centre + fanOffset(i, n, s.spread), s.projSpeed)
      }
    },

    buffs: function (sim, tower) {
      const s = tower.s
      const range = s.supportRange || 150
      const mul = s.supportDamageMul || 1.5
      for (let i = 0; i < sim.towers.length; i++) {
        const t = sim.towers[i]
        if (!t.alive || t.id === tower.id) continue
        if (M.dist2(tower.x, tower.y, t.x, t.y) > range * range) continue
        OP.Buffs.register(sim, {
          id: 'paragon-gearspun:' + tower.id + ':' + t.id,
          sourceId: tower.id,
          x: t.x, y: t.y, radius: 1,
          priority: 8,
          excludeSelf: false,
          mods: { damageMul: mul, cooldownMul: 0.85 }
        })
      }
    }
  })

})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

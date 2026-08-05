;(function (OP) {
  'use strict'

  /* The magic family — six towers.
   *
   * The highest-ceiling, highest-cost family, and the one allowed to bend the
   * rules: exotic damage types, effects nothing else has, and the strongest
   * single towers in the game at tier 5.
   *
   * The brake on all of it is Purple, which ignores fire, plasma and energy —
   * exactly the three types this family reaches for first. Every tower here
   * either lives with that or buys its way out of it with an upgrade, and the
   * upgrade text says so.
   *
   * Answers the family provides, and where:
   *   Lead   — Shadow Marten "Obsidian Edges" (shatter), Thornroot Stag
   *            "Ironwood"/"Ancient Wood" (shatter), and Brewer Toad "Solvent
   *            Brew", which converts a NEIGHBOUR's damage to shatter.
   *   Veiled — Shadow Marten sees it from the moment it is placed. Elder Owl
   *            buys it cheaply on "Night Vision". Brewer Toad can hand it out.
   *   Blimps — Elder Owl "Sunstrike" / "All-Seeing", Thornroot Stag's storm,
   *            Tidecaller Newt's wave (a heavy slow, because blimps cannot be
   *            stunned).
   */

  const M = OP.M
  const D = OP.DMG

  /* ---------- projectile art kinds ---------- */

  OP.declareProjKind('rune-bolt', { shape: 'orb', tint: '#7de8c6', size: 5, trail: true })
  OP.declareProjKind('rune-lance', { shape: 'beam', tint: '#aef7e2', size: 7, trail: true })
  OP.declareProjKind('rune-ember', { shape: 'orb', tint: '#e2632c', size: 6, trail: true })
  OP.declareProjKind('rune-familiar', { shape: 'orb', tint: '#c9f7ff', size: 4, trail: true, spin: true })

  OP.declareProjKind('owl-bolt', { shape: 'orb', tint: '#d7e8ff', size: 6, trail: true })
  OP.declareProjKind('owl-plasma', { shape: 'orb', tint: '#b678e8', size: 8, trail: true, spin: true })

  OP.declareProjKind('marten-star', { shape: 'star', tint: '#cfd6cc', size: 4, spin: true })
  OP.declareProjKind('marten-obsidian', { shape: 'star', tint: '#e8d67d', size: 5, spin: true })

  OP.declareProjKind('toad-flask', { shape: 'flask', tint: '#a8e04a', size: 5 })
  OP.declareProjKind('toad-vitriol', { shape: 'flask', tint: '#d4ff3c', size: 6, trail: true })

  OP.declareProjKind('stag-thorn', { shape: 'spike', tint: '#8fbf6a', size: 5, spin: true })
  OP.declareProjKind('stag-ironthorn', { shape: 'spike', tint: '#cbb26a', size: 6, spin: true })

  OP.declareProjKind('newt-jet', { shape: 'droplet', tint: '#7fc6e8', size: 5, trail: true })
  OP.declareProjKind('newt-frost', { shape: 'droplet', tint: '#cdeeff', size: 6, trail: true })

  /* ---------- shared projectile behaviour ---------- */

  /* Knockback. Pushes a balloon back along its own track by `data.shove` units.
     Blimps are immune to knockback (ARCHITECTURE.md §2), so they are skipped —
     that is what stops the Newt from parking a COLOSSUS at the entrance. */
  OP.PROJ_BEHAVIOURS['magic-shove'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data || !(p.data.shove > 0)) return
      if (!b || !b.alive) return
      if (OP.BALLOON_TIERS[b.tier].blimp) return
      b.t = Math.max(0, b.t - p.data.shove)
      sim.map.paths[b.path].posInto(b.t, b)
    }
  }

  /* ---------- shared helpers ---------- */

  /** Status effects a shot carries, built from the resolved stat block. */
  function shotEffects (tower) {
    const s = tower.s
    let out = null
    if (s.chillT > 0) {
      out = out || []
      out.push(OP.Effects.make('cold', s.chillT, s.chillMag, tower.id, D.COLD))
    }
    if (s.burnT > 0) {
      out = out || []
      out.push(OP.Effects.make('burn', s.burnT, s.burnDps, tower.id, D.FIRE))
    }
    if (s.acidT > 0) {
      out = out || []
      out.push(OP.Effects.make('acid', s.acidT, s.acidDps, tower.id, D.ACID))
    }
    if (s.brittleT > 0) {
      out = out || []
      out.push(OP.Effects.make('brittle', s.brittleT, s.brittleMag, tower.id, D.NORMAL))
    }
    return out
  }

  /**
   * The shared firing routine. Emits `s.shots` projectiles spread symmetrically
   * around the lead point.
   *
   * The effect templates are built once per volley and shared between its shots:
   * Effects.apply copies before it stores, and copies again before scaling a
   * blimp's slow resistance, so nothing here is ever mutated.
   */
  function volley (sim, tower, target, defaultKind, damageBonus) {
    const s = tower.s
    const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
    const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)
    const shots = Math.max(1, Math.round(s.shots))
    const effects = shotEffects(tower)
    const damage = s.damage + (damageBonus || 0)
    const data = s.shove > 0 ? { shove: s.shove } : null

    for (let i = 0; i < shots; i++) {
      const offset = shots === 1 ? 0 : s.spread * (i / (shots - 1) - 0.5)
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y,
        kind: s.projKind || defaultKind,
        damage: damage,
        dmgType: s.dmgType,
        pierce: s.pierce,
        radius: s.projRadius,
        life: s.projLife,
        maxRange: s.range * 1.4,
        ownerId: tower.id,
        camoDetect: s.camoDetect,
        blastRadius: s.blastRadius || 0,
        blastFalloff: s.blastFalloff || 0,
        behaviour: s.behaviour || '',
        effects: effects,
        data: data
      }, centre + offset, s.projSpeed)
    }
  }

  /** Every live balloon this tower is allowed to affect, as ids.
      Snapshotted before anything is damaged: a hit can split a balloon and
      append its children to sim.balloons, and a screen-wide ability must not
      then hit the children it just created. */
  function screenTargets (sim, camoDetect, out) {
    out.length = 0
    const list = sim.balloons
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue
      // The camo gate applies to area effects too, or Veiled leaks through them.
      if ((b.props & OP.PROP.VEILED) && !camoDetect) continue
      out.push(b.id)
    }
    return out
  }

  /* ---------- abilities ---------- */

  /* Rune Weasel: summons short-lived familiars. They are not entities — they are
     a duration, an angle and a cadence in tower.data, and the tower's update()
     fires their bolts from their own positions. Plain numbers, so mid-round save
     round-trips them for free. */
  OP.ABILITIES['rune-familiar-call'] = function (sim, tower) {
    const s = tower.s
    const d = tower.data
    d.famT = s.famDuration > 0 ? s.famDuration : 8
    d.famCd = 0
    // The only randomness here, and it comes from sim.rng.
    d.famA = sim.rng.range(0, M.TAU)
  }

  /* Elder Owl: a diving strike centred on its current target. */
  OP.ABILITIES['owl-talon-dive'] = function (sim, tower) {
    const s = tower.s
    let x = tower.x
    let y = tower.y
    const id = OP.Targeting.acquire(sim, tower, tower.targetMode)
    if (id >= 0) {
      const b = sim.byId.get(id)
      if (b) { x = b.x; y = b.y }
    }
    OP.Damage.blast(sim, x, y, s.diveRadius || 60, {
      damage: s.diveDamage || 1,
      dmgType: s.dmgType,
      sourceId: tower.id
    }, { camoDetect: s.camoDetect, maxTargets: 120 })
  }

  /* Shadow Marten: tars the whole track. Slows everything on screen. */
  OP.ABILITIES['marten-sabotage'] = function (sim, tower) {
    const s = tower.s
    const ids = screenTargets(sim, s.camoDetect, [])
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue
      OP.Effects.apply(b, OP.Effects.make('glue', s.sabT, s.sabMag, tower.id, D.NORMAL))
      if (s.sabBrittle > 0) {
        OP.Effects.apply(b, OP.Effects.make('brittle', s.sabT, s.sabBrittle, tower.id, D.NORMAL))
      }
    }
  }

  /* Thornroot Stag: lightning over the whole field. */
  OP.ABILITIES['stag-storm'] = function (sim, tower) {
    const s = tower.s
    const ids = screenTargets(sim, s.camoDetect, [])
    const eff = s.stormStun > 0
      ? [OP.Effects.make('stun', s.stormStun, 1, tower.id, D.NORMAL)]
      : null
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue
      OP.Damage.hit(sim, b, {
        damage: s.stormDamage || 1,
        dmgType: D.ENERGY,
        sourceId: tower.id,
        effects: eff
      })
    }
  }

  /* Tidecaller Newt: a wave that sweeps the field backwards.
     Blimps are stunImmune and knockback-immune, so they get a heavy slow
     instead — the only honest way to "stop" one. */
  OP.ABILITIES['newt-tidecall'] = function (sim, tower) {
    const s = tower.s
    const ids = screenTargets(sim, s.camoDetect, [])
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue

      if (s.waveDamage > 0) {
        OP.Damage.hit(sim, b, { damage: s.waveDamage, dmgType: D.COLD, sourceId: tower.id })
        if (!b.alive) continue
      }

      // Re-read the tier: the hit above may have cascaded this balloon down.
      if (OP.BALLOON_TIERS[b.tier].blimp) {
        if (s.waveBlimpSlow > 0) {
          OP.Effects.apply(b, OP.Effects.make('glue', s.waveBlimpT, s.waveBlimpSlow, tower.id, D.NORMAL))
        }
      } else if (s.waveShove > 0) {
        b.t = Math.max(0, b.t - s.waveShove)
        sim.map.paths[b.path].posInto(b.t, b)
      }

      if (s.waveChillT > 0) {
        OP.Effects.apply(b, OP.Effects.make('cold', s.waveChillT, s.waveChillMag, tower.id, D.COLD))
      }
    }
  }

  /* ---------- the roster ---------- */

  OP.FAMILY_ROSTERS.magic = [
    'rune-weasel',
    'elder-owl',
    'shadow-marten',
    'brewer-toad',
    'thornroot-stag',
    'tidecaller-newt'
  ]

  /* ================================================================= *
   * 1. Rune Weasel — bolts of energy                                  *
   * ================================================================= */

  OP.defineTower({
    key: 'rune-weasel',
    name: 'Rune Weasel',
    family: 'magic',
    blurb: 'Scratches runes in the air and flicks them off as bolts of raw energy. Purple balloons are unimpressed.',

    cost: 500,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 130,
      cooldown: 0.75,
      damage: 2,
      pierce: 2,
      dmgType: D.ENERGY,
      projSpeed: 420,
      projLife: 1.1,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Runeline',
        tiers: [
          { name: 'Etched Bolt', cost: 250,
            desc: 'Bolts carry through 2 more balloons: pierce 2 becomes 4.',
            apply: function (s) { s.pierce += 2 } },
          { name: 'Long Rune', cost: 550,
            desc: '+1 damage, and bolts travel 40% faster so they reach further before fading.',
            apply: function (s) { s.damage += 1; s.projSpeed *= 1.4 } },
          { name: 'Runeline', cost: 1300,
            desc: 'The bolt stretches into a lance that rips down a whole line: pierce 30, more than twice the speed, and a longer flight. +25 range.',
            apply: function (s) {
              s.pierce = Math.max(s.pierce, 30)
              s.projSpeed *= 2.2
              s.projLife += 0.7
              s.range += 25
              s.projKind = 'rune-lance'
              s.projRadius += 2
            } },
          { name: 'Piercing Script', cost: 5000,
            desc: '+4 damage and pierce 50. One lance clears a packed line on its own.',
            apply: function (s) { s.damage += 4; s.pierce = Math.max(s.pierce, 50) } },
          { name: 'Endless Line', cost: 41000,
            desc: '+18 damage, pierce 120, sees Veiled balloons, and the lance passes straight through terrain.',
            apply: function (s) {
              s.damage += 18
              s.pierce = Math.max(s.pierce, 120)
              s.camoDetect = true
              s.ignoresLOS = true
            } }
        ]
      },
      {
        name: 'Emberscript',
        tiers: [
          { name: 'Warm Ink', cost: 225,
            desc: '+1 damage.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Kindling Glyph', cost: 475,
            desc: 'Attacks 20% faster.',
            apply: function (s) { s.cooldown *= 0.80 } },
          { name: 'Emberscript', cost: 1200,
            desc: 'Damage becomes fire and sets balloons alight: 4 burn damage per second for 3 seconds. Purple ignores fire entirely.',
            apply: function (s) {
              s.dmgType = D.FIRE
              s.burnDps = 4
              s.burnT = 3
              s.projKind = 'rune-ember'
            } },
          { name: 'Wildfire Glyph', cost: 4500,
            desc: '+3 damage. Bolts burst in a 28-unit fireball and the burn rises to 10 per second for 4 seconds.',
            apply: function (s) {
              s.damage += 3
              s.burnDps = 10
              s.burnT = 4
              s.blastRadius = 28
            } },
          { name: 'Conflagration', cost: 38000,
            desc: '+16 damage, a 55-unit fireball, and 30 burn damage per second for 6 seconds. Still nothing at all to Purple.',
            apply: function (s) {
              s.damage += 16
              s.burnDps = 30
              s.burnT = 6
              s.blastRadius = 55
              s.blastFalloff = 0.35
            } }
        ]
      },
      {
        name: 'Summoning',
        tiers: [
          { name: 'Chalk Circle', cost: 200,
            desc: '+18 range.',
            apply: function (s) { s.range += 18 } },
          { name: 'Bound Sigil', cost: 425,
            desc: '+1 damage and +22 range.',
            apply: function (s) { s.damage += 1; s.range += 22 } },
          { name: 'Lesser Familiar', cost: 1100,
            desc: 'Ability: calls a familiar that fights beside the weasel for 8 seconds, throwing a 4-damage energy bolt every 0.5s. 45 second cooldown.',
            apply: function (s) {
              s.famDuration = 8
              s.famCooldown = 0.5
              s.famCount = 1
              s.famDamage = 4
              s.famPierce = 2
              s.ability = { name: 'Lesser Familiar', cooldown: 45, duration: 8, key: 'rune-familiar-call' }
            } },
          { name: 'Twin Familiars', cost: 4000,
            desc: 'Two familiars, lasting 12 seconds, throwing a 7-damage bolt every 0.28s. +2 damage on the weasel itself.',
            apply: function (s) {
              s.famDuration = 12
              s.famCooldown = 0.28
              s.famCount = 2
              s.famDamage = 7
              s.famPierce = 3
              s.damage += 2
              if (s.ability) { s.ability.name = 'Twin Familiars'; s.ability.duration = 12 }
            } },
          { name: 'Greater Familiar', cost: 35000,
            desc: 'Three familiars for 20 seconds, each throwing a 26-damage bolt with 6 pierce every 0.18s, and they see Veiled balloons. +10 damage on the weasel.',
            apply: function (s) {
              s.famDuration = 20
              s.famCooldown = 0.18
              s.famCount = 3
              s.famDamage = 26
              s.famPierce = 6
              s.famCamo = true
              s.damage += 10
              if (s.ability) { s.ability.name = 'Greater Familiar'; s.ability.duration = 20 }
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      volley(sim, tower, target, 'rune-bolt', 0)
    },

    /* The familiars. A duration and a cadence in tower.data, nothing more. */
    update: function (sim, tower, dt) {
      const d = tower.data
      if (!(d.famT > 0)) return
      const s = tower.s

      d.famT = Math.max(0, d.famT - dt)
      d.famCd = (d.famCd || 0) - dt
      if (d.famCd > 0) return
      d.famCd = s.famCooldown > 0 ? s.famCooldown : 0.5

      const id = OP.Targeting.acquire(sim, tower, tower.targetMode)
      if (id < 0) return
      const b = sim.byId.get(id)
      if (!b) return

      const n = Math.max(1, s.famCount | 0)
      for (let i = 0; i < n; i++) {
        const a = (d.famA || 0) + M.TAU * i / n
        const fx = tower.x + Math.cos(a) * 26
        const fy = tower.y + Math.sin(a) * 26
        OP.Projectiles.fireAt(sim, {
          x: fx, y: fy,
          kind: 'rune-familiar',
          damage: s.famDamage || 4,
          dmgType: D.ENERGY,
          pierce: s.famPierce || 2,
          radius: 5,
          life: 1.2,
          maxRange: s.range * 1.5,
          ownerId: tower.id,
          camoDetect: !!(s.camoDetect || s.famCamo)
        }, M.angleTo(fx, fy, b.x, b.y), 520)
      }
    }
  })

  /* ================================================================= *
   * 2. Elder Owl — the expensive powerhouse                           *
   * ================================================================= */

  OP.defineTower({
    key: 'elder-owl',
    name: 'Elder Owl',
    family: 'magic',
    blurb: 'Very old, very expensive, and entirely out of patience. Fires faster than anything else in the game.',

    cost: 2800,
    footprint: 16,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 150,
      cooldown: 0.30,
      damage: 4,
      pierce: 1,
      dmgType: D.ENERGY,
      projSpeed: 700,
      projLife: 0.9,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Arcane Fury',
        tiers: [
          { name: 'Sharper Focus', cost: 1540,
            desc: '+2 damage.',
            apply: function (s) { s.damage += 2 } },
          { name: 'Quickened Word', cost: 3360,
            desc: 'Attacks 25% faster.',
            apply: function (s) { s.cooldown *= 0.75 } },
          { name: 'Arclight', cost: 7840,
            desc: '+4 damage and +2 pierce.',
            apply: function (s) { s.damage += 4; s.pierce += 2 } },
          { name: 'Plasma Word', cost: 36400,
            desc: 'Damage becomes plasma: +8 damage and it sees Veiled balloons. Purple ignores plasma, so keep something physical nearby.',
            apply: function (s) {
              s.dmgType = D.PLASMA
              s.damage += 8
              s.camoDetect = true
              s.projKind = 'owl-plasma'
              s.projRadius += 3
            } },
          { name: 'Sunstrike', cost: 369600,
            desc: '+60 damage, +6 pierce, three times the attack speed, and every bolt detonates in a 40-unit plasma burst. This melts blimps.',
            apply: function (s) {
              s.damage += 60
              s.pierce += 6
              s.cooldown *= 0.34
              s.blastRadius = 40
            } }
        ]
      },
      {
        name: 'Farsight',
        tiers: [
          { name: 'Wide Eyes', cost: 1680,
            desc: '+30 range.',
            apply: function (s) { s.range += 30 } },
          { name: 'Night Vision', cost: 3640,
            desc: 'Sees Veiled balloons, and +20 range. Owls hunt at night.',
            apply: function (s) { s.camoDetect = true; s.range += 20 } },
          { name: 'Horizon', cost: 8400,
            desc: '+70 range and 30% faster bolts.',
            apply: function (s) { s.range += 70; s.projSpeed *= 1.3 } },
          { name: 'Talon Dive', cost: 33600,
            desc: '+90 range. Ability: dives on the current target for 250 energy damage in a 70-unit radius. 40 second cooldown.',
            apply: function (s) {
              s.range += 90
              s.diveDamage = 250
              s.diveRadius = 70
              s.ability = { name: 'Talon Dive', cooldown: 40, duration: 0, key: 'owl-talon-dive' }
            } },
          { name: 'All-Seeing', cost: 358400,
            desc: '+300 range — most of the map — +25 damage, and the dive hits for 1200 damage in a 130-unit radius.',
            apply: function (s) {
              s.range += 300
              s.damage += 25
              s.diveDamage = 1200
              s.diveRadius = 130
              s.ignoresLOS = true
              if (s.ability) s.ability.name = 'All-Seeing Dive'
            } }
        ]
      },
      {
        name: 'Manyshot',
        tiers: [
          { name: 'Split Focus', cost: 1624,
            desc: 'Fires 2 bolts instead of 1, in a narrow fan.',
            apply: function (s) { s.shots = 2; s.spread = Math.max(s.spread, 0.22) } },
          { name: 'Fan Of Bolts', cost: 3500,
            desc: 'Fires 4 bolts across a wider fan.',
            apply: function (s) { s.shots = 4; s.spread = Math.max(s.spread, 0.55) } },
          { name: 'Storm Of Bolts', cost: 8120,
            desc: 'Fires 7 bolts and +1 pierce.',
            apply: function (s) { s.shots = 7; s.spread = Math.max(s.spread, 0.95); s.pierce += 1 } },
          { name: 'Every Direction', cost: 39200,
            desc: '12 bolts in a full ring around the owl, and +4 damage. Nothing walks past on either side.',
            apply: function (s) {
              s.shots = 12
              s.spread = M.TAU * 11 / 12
              s.damage += 4
            } },
          { name: 'Ten Thousand Bolts', cost: 364000,
            desc: '20 bolts in a ring, +20 damage, +4 pierce, and twice the attack speed.',
            apply: function (s) {
              s.shots = 20
              s.spread = M.TAU * 19 / 20
              s.damage += 20
              s.pierce += 4
              s.cooldown *= 0.5
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      volley(sim, tower, target, 'owl-bolt', 0)
    }
  })

  /* ================================================================= *
   * 3. Shadow Marten — the family's answer to Veiled                  *
   * ================================================================= */

  OP.defineTower({
    key: 'shadow-marten',
    name: 'Shadow Marten',
    family: 'magic',
    blurb: 'Throws paired stars out of the dark. Sees Veiled balloons from the moment you place it.',

    cost: 550,
    footprint: 12,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 120,
      cooldown: 0.55,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 460,
      projLife: 0.9,
      projRadius: 4,
      camoDetect: true,
      shots: 2,
      spread: 0.28,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Windthrow',
        tiers: [
          { name: 'Weighted Stars', cost: 248,
            desc: '+1 damage.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Shoving Stars', cost: 550,
            desc: 'Stars shove balloons 15 units back down the track. Blimps are far too heavy to move.',
            apply: function (s) { s.behaviour = 'magic-shove'; s.shove = 15 } },
          { name: 'Gale Throw', cost: 1375,
            desc: 'Shoves 40 units back, and +1 damage.',
            apply: function (s) { s.behaviour = 'magic-shove'; s.shove = 40; s.damage += 1 } },
          { name: 'Whirlwind', cost: 4950,
            desc: 'Shoves 90 units back, +3 damage and +2 pierce.',
            apply: function (s) {
              s.behaviour = 'magic-shove'
              s.shove = 90
              s.damage += 3
              s.pierce += 2
            } },
          { name: 'Backdraft', cost: 39600,
            desc: 'Shoves 220 units back — most of a lap — with +12 damage and +6 pierce. Blimps still will not budge.',
            apply: function (s) {
              s.behaviour = 'magic-shove'
              s.shove = 220
              s.damage += 12
              s.pierce += 6
            } }
        ]
      },
      {
        name: 'Sabotage',
        tiers: [
          { name: 'Quiet Paws', cost: 275,
            desc: 'Attacks 15% faster.',
            apply: function (s) { s.cooldown *= 0.85 } },
          { name: 'Smoke Pouch', cost: 578,
            desc: '+18 range and another 10% attack speed.',
            apply: function (s) { s.range += 18; s.cooldown *= 0.90 } },
          { name: 'Sabotage', cost: 1430,
            desc: 'Ability: greases the whole track. Every balloon on screen is slowed 50% for 8 seconds. Blimps resist slows, so they lose about half of that. 60 second cooldown.',
            apply: function (s) {
              s.sabMag = 0.50
              s.sabT = 8
              s.ability = { name: 'Sabotage', cooldown: 60, duration: 8, key: 'marten-sabotage' }
            } },
          { name: 'Grease The Rails', cost: 6050,
            desc: 'Sabotage slows 70% and lasts 12 seconds. +2 damage.',
            apply: function (s) {
              s.sabMag = 0.70
              s.sabT = 12
              s.damage += 2
              if (s.ability) s.ability.duration = 12
            } },
          { name: 'Total Shutdown', cost: 42900,
            desc: 'Sabotage slows 85% for 18 seconds and leaves everything brittle, taking 60% more damage from every tower you own. +8 damage.',
            apply: function (s) {
              s.sabMag = 0.85
              s.sabT = 18
              s.sabBrittle = 0.6
              s.damage += 8
              if (s.ability) { s.ability.name = 'Total Shutdown'; s.ability.duration = 18 }
            } }
        ]
      },
      {
        name: 'Starfall',
        tiers: [
          { name: 'Three At Once', cost: 231,
            desc: 'Throws 3 stars per attack instead of 2.',
            apply: function (s) { s.shots = 3; s.spread = Math.max(s.spread, 0.34) } },
          { name: 'Handful', cost: 523,
            desc: 'Throws 4 stars per attack.',
            apply: function (s) { s.shots = 4; s.spread = Math.max(s.spread, 0.44) } },
          { name: 'Fan Of Blades', cost: 1265,
            desc: 'Throws 6 stars per attack, and +1 pierce.',
            apply: function (s) { s.shots = 6; s.spread = Math.max(s.spread, 0.62); s.pierce += 1 } },
          { name: 'Obsidian Edges', cost: 5500,
            desc: 'Stars become shatter damage, which nothing in the sky resists — including Lead. +2 damage.',
            apply: function (s) {
              s.dmgType = D.SHATTER
              s.damage += 2
              s.projKind = 'marten-obsidian'
            } },
          { name: 'Storm Of Stars', cost: 40700,
            desc: 'Throws 12 shatter stars per attack, +8 damage and +4 pierce.',
            apply: function (s) {
              s.shots = 12
              s.spread = Math.max(s.spread, 0.95)
              s.damage += 8
              s.pierce += 4
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      volley(sim, tower, target, 'marten-star', 0)
    }
  })

  /* ================================================================= *
   * 4. Brewer Toad — buffs its neighbours                             *
   * ================================================================= */

  OP.defineTower({
    key: 'brewer-toad',
    name: 'Brewer Toad',
    family: 'magic',
    blurb: 'Barely fights. Brews tonics that make every tower around it hit harder, and eventually hit through Lead.',

    cost: 900,
    footprint: 14,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 105,
      cooldown: 1.5,
      damage: 1,
      pierce: 1,
      dmgType: D.ACID,
      projSpeed: 300,
      projLife: 1.0,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Tonics',
        tiers: [
          { name: 'Strength Tonic', cost: 405,
            desc: 'Every other tower in range gets +1 damage. The toad does not drink its own brew.',
            apply: function (s) { s.tonicDamage = 1 } },
          { name: 'Sharpening Tonic', cost: 855,
            desc: 'Towers in range also get +1 pierce.',
            apply: function (s) { s.tonicDamage = 1; s.tonicPierce = 1 } },
          { name: 'Double Brew', cost: 2160,
            desc: 'Towers in range get +2 damage and +2 pierce. The toad itself gets +1 damage and +15 range.',
            apply: function (s) {
              s.tonicDamage = 2
              s.tonicPierce = 2
              s.damage += 1
              s.range += 15
            } },
          { name: 'Solvent Brew', cost: 9900,
            desc: 'Towers in range get +3 damage, +3 pierce, and their damage becomes shatter — which cracks Lead open no matter what they normally throw.',
            apply: function (s) {
              s.tonicDamage = 3
              s.tonicPierce = 3
              s.tonicType = D.SHATTER
              s.damage += 1
            } },
          { name: 'Grand Distillation', cost: 76500,
            desc: 'Towers in range get +8 damage, +5 pierce, shatter damage and 25% faster attacks. The toad gets +12 damage of its own.',
            apply: function (s) {
              s.tonicDamage = 8
              s.tonicPierce = 5
              s.tonicType = D.SHATTER
              s.tonicCooldownMul = 0.75
              s.damage += 12
              s.pierce += 2
            } }
        ]
      },
      {
        name: 'Alchemy',
        tiers: [
          { name: 'Bitter Mix', cost: 450,
            desc: '+1 damage on the toad itself.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Caustic Mix', cost: 990,
            desc: 'Flasks leave corrosion: 3 acid damage per second for 4 seconds. Nothing in the sky resists acid.',
            apply: function (s) { s.acidDps = 3; s.acidT = 4 } },
          { name: 'Vitriol', cost: 2250,
            desc: '+2 damage, +18 range, and corrosion rises to 8 per second for 5 seconds.',
            apply: function (s) {
              s.damage += 2
              s.range += 18
              s.acidDps = 8
              s.acidT = 5
              s.projKind = 'toad-vitriol'
            } },
          { name: 'Acid Rain', cost: 10800,
            desc: 'Flasks burst in a 45-unit splash. +4 damage and corrosion of 16 per second for 6 seconds.',
            apply: function (s) {
              s.damage += 4
              s.acidDps = 16
              s.acidT = 6
              s.blastRadius = 45
            } },
          { name: 'Universal Solvent', cost: 72000,
            desc: '+25 damage, +4 pierce, an 80-unit splash, and corrosion of 35 per second for 8 seconds.',
            apply: function (s) {
              s.damage += 25
              s.pierce += 4
              s.acidDps = 35
              s.acidT = 8
              s.blastRadius = 80
            } }
        ]
      },
      {
        name: 'Wider Cellar',
        tiers: [
          { name: 'Long Ladle', cost: 378,
            desc: '+25 range, which is also +25 to how far the tonics reach.',
            apply: function (s) { s.range += 25 } },
          { name: 'Bigger Vat', cost: 810,
            desc: '+30 more range and reach.',
            apply: function (s) { s.range += 30 } },
          { name: 'Cellar Doors', cost: 1980,
            desc: '+45 more reach, and the tonic grants Veiled detection to every tower it touches.',
            apply: function (s) { s.range += 45; s.tonicCamo = true } },
          { name: 'Distribution Cart', cost: 9000,
            desc: '+90 more reach, and towers in range gain 12% more range of their own.',
            apply: function (s) { s.range += 90; s.tonicRangeMul = 1.12 } },
          { name: 'Whole Grove', cost: 63000,
            desc: 'The tonic reaches every tower on the map, wherever it is. +20 range on the toad.',
            apply: function (s) { s.range += 20; s.tonicGlobal = true } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      volley(sim, tower, target, 'toad-flask', 0)
    },

    /* The buff registration.
       `tower.s` here is the UNBUFFED stat block — the engine swaps it in — so the
       aura radius is derived from base + upgrades only. Two overlapping toads
       therefore register identical radii no matter which was placed first. */
    buffs: function (sim, tower) {
      const s = tower.s
      const mods = {}
      let any = false

      if (s.tonicDamage > 0) { mods.damageAdd = s.tonicDamage; any = true }
      if (s.tonicPierce > 0) { mods.pierceAdd = s.tonicPierce; any = true }
      if (s.tonicCooldownMul > 0) { mods.cooldownMul = s.tonicCooldownMul; any = true }
      if (s.tonicRangeMul > 0) { mods.rangeMul = s.tonicRangeMul; any = true }
      if (s.tonicCamo) { mods.camoDetect = true; any = true }
      if (s.tonicType) { mods.dmgTypeSet = s.tonicType; any = true }
      if (!any) return

      OP.Buffs.register(sim, {
        id: 'brewer-tonic:' + tower.id,
        sourceId: tower.id,
        x: tower.x, y: tower.y,
        radius: s.tonicGlobal ? 'global' : s.range,
        priority: 4,
        excludeSelf: true,
        mods: mods
      })
    }
  })

  /* ================================================================= *
   * 5. Thornroot Stag — nature magic                                  *
   * ================================================================= */

  OP.defineTower({
    key: 'thornroot-stag',
    name: 'Thornroot Stag',
    family: 'magic',
    blurb: 'Roots itself where you put it and throws thorns. The longer a round runs, the angrier it gets.',

    cost: 1400,
    footprint: 15,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 135,
      cooldown: 1.1,
      damage: 3,
      pierce: 3,
      dmgType: D.SHARP,
      projSpeed: 380,
      projLife: 1.3,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: "Season's Growth",
        tiers: [
          { name: 'First Shoots', cost: 630,
            desc: '+1 damage.',
            apply: function (s) { s.damage += 1 } },
          { name: "Season's Growth", cost: 1470,
            desc: 'Gains +1 damage for every 6 seconds a round has been running, up to +4. Resets when the next round starts.',
            apply: function (s) { s.growRate = 1 / 6; s.growCap = 4 } },
          { name: 'Deep Roots', cost: 3640,
            desc: 'Growth speeds up to +1 damage every 4 seconds and climbs to +10. +1 pierce.',
            apply: function (s) { s.growRate = 1 / 4; s.growCap = 10; s.pierce += 1 } },
          { name: 'Old Growth', cost: 15400,
            desc: 'Growth reaches +1 damage every 2.5 seconds, up to +30, and +2 pierce.',
            apply: function (s) { s.growRate = 1 / 2.5; s.growCap = 30; s.pierce += 2 } },
          { name: 'Ancient Wood', cost: 123200,
            desc: '+1 damage every second, up to +140. Thorns become shatter damage, so Lead is no longer a problem. +12 damage and +4 pierce.',
            apply: function (s) {
              s.growRate = 1
              s.growCap = 140
              s.dmgType = D.SHATTER
              s.projKind = 'stag-ironthorn'
              s.damage += 12
              s.pierce += 4
            } }
        ]
      },
      {
        name: 'Wall Of Thorns',
        tiers: [
          { name: 'Bramble Skin', cost: 672,
            desc: '+12 range.',
            apply: function (s) { s.range += 12 } },
          { name: 'Thorn Ring', cost: 1540,
            desc: 'A ring of thorns around the stag deals 2 damage to everything within 60 units, twice a second. No aiming, no projectile.',
            apply: function (s) { s.thornDamage = 2; s.thornRadius = 60; s.thornPeriod = 0.5 } },
          { name: 'Wall Of Thorns', cost: 3780,
            desc: 'The ring reaches 95 units and deals 5 damage four times a second.',
            apply: function (s) { s.thornDamage = 5; s.thornRadius = 95; s.thornPeriod = 0.25 } },
          { name: 'Ironwood', cost: 16800,
            desc: 'The ring deals 14 shatter damage five times a second inside 120 units. Shatter cracks Lead, so the wall stops it dead.',
            apply: function (s) {
              s.thornDamage = 14
              s.thornRadius = 120
              s.thornPeriod = 0.2
              s.thornType = D.SHATTER
            } },
          { name: 'Thornheart', cost: 126000,
            desc: 'The ring deals 60 shatter damage ten times a second inside 170 units, and thrown thorns get +20 damage.',
            apply: function (s) {
              s.thornDamage = 60
              s.thornRadius = 170
              s.thornPeriod = 0.1
              s.thornType = D.SHATTER
              s.damage += 20
            } }
        ]
      },
      {
        name: 'Storm Caller',
        tiers: [
          { name: 'Rain Scent', cost: 616,
            desc: '+20 range.',
            apply: function (s) { s.range += 20 } },
          { name: 'Gathering Clouds', cost: 1400,
            desc: '+1 damage and 15% faster attacks.',
            apply: function (s) { s.damage += 1; s.cooldown *= 0.85 } },
          { name: 'Thunderhead', cost: 3500,
            desc: 'Ability: lightning strikes every balloon on the screen for 20 energy damage. Purple ignores energy. 50 second cooldown.',
            apply: function (s) {
              s.stormDamage = 20
              s.ability = { name: 'Thunderhead', cooldown: 50, duration: 0, key: 'stag-storm' }
            } },
          { name: 'Storm Front', cost: 14000,
            desc: 'The storm hits for 90 damage and stuns for 2 seconds. Blimps cannot be stunned, so they only take the damage. +3 damage.',
            apply: function (s) {
              s.stormDamage = 90
              s.stormStun = 2
              s.damage += 3
              if (s.ability) s.ability.name = 'Storm Front'
            } },
          { name: 'Wrath Of The Grove', cost: 114800,
            desc: 'The storm hits every balloon on screen for 700 energy damage and stuns for 3 seconds. +25 damage and +4 pierce on thrown thorns.',
            apply: function (s) {
              s.stormDamage = 700
              s.stormStun = 3
              s.damage += 25
              s.pierce += 4
              if (s.ability) { s.ability.name = 'Wrath Of The Grove'; s.ability.cooldown = 45 }
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      // The round-long growth is a damage bonus read from tower.data, never
      // written into tower.s — s must stay a pure function of base + upgrades.
      volley(sim, tower, target, 'stag-thorn', Math.floor(tower.data.growth || 0))
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data

      // Growth is per-round. The round counter is the reset signal, so a stag
      // that sat through five rounds does not start round six at full power.
      if (d.growRound !== sim.roundIndex) {
        d.growRound = sim.roundIndex
        d.growth = 0
      }
      if (s.growRate > 0) d.growth = Math.min(s.growCap, (d.growth || 0) + s.growRate * dt)
      else d.growth = 0

      // The thorn ring: a periodic blast centred on the stag itself.
      if (s.thornDamage > 0 && s.thornPeriod > 0) {
        d.thornCd = (d.thornCd || 0) - dt
        if (d.thornCd <= 0) {
          // Assign rather than accumulate when the debt is larger than a whole
          // period — a retuned period must never leave this spinning.
          d.thornCd = d.thornCd < -s.thornPeriod ? s.thornPeriod : d.thornCd + s.thornPeriod
          OP.Damage.blast(sim, tower.x, tower.y, s.thornRadius, {
            damage: s.thornDamage,
            dmgType: s.thornType || s.dmgType,
            sourceId: tower.id
          }, { camoDetect: s.camoDetect, maxTargets: 80 })
        }
      }
    }
  })

  /* ================================================================= *
   * 6. Tidecaller Newt — land or water                                *
   * ================================================================= */

  OP.defineTower({
    key: 'tidecaller-newt',
    name: 'Tidecaller Newt',
    family: 'magic',
    blurb: 'Sits on land or water and calls the tide up at the track. Shoves balloons backwards and freezes what it cannot shove.',

    cost: 1100,
    footprint: 13,
    placement: 'any',
    unlockRound: 0,

    base: {
      range: 125,
      cooldown: 0.9,
      damage: 2,
      pierce: 3,
      dmgType: D.COLD,
      projSpeed: 400,
      projLife: 1.1,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Undertow',
        tiers: [
          { name: 'Cold Spray', cost: 495,
            desc: '+1 damage.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Undertow', cost: 1155,
            desc: 'The jet shoves balloons 20 units back down the track. Blimps are too heavy to move.',
            apply: function (s) { s.behaviour = 'magic-shove'; s.shove = 20 } },
          { name: 'Riptide', cost: 2750,
            desc: 'Shoves 55 units back, +2 damage and +1 pierce.',
            apply: function (s) {
              s.behaviour = 'magic-shove'
              s.shove = 55
              s.damage += 2
              s.pierce += 1
            } },
          { name: 'Whirlpool', cost: 12100,
            desc: 'Shoves 130 units back, +5 damage and +3 pierce.',
            apply: function (s) {
              s.behaviour = 'magic-shove'
              s.shove = 130
              s.damage += 5
              s.pierce += 3
            } },
          { name: 'Maelstrom', cost: 85800,
            desc: 'Shoves 300 units back with +22 damage and +8 pierce. A packed track simply stops advancing.',
            apply: function (s) {
              s.behaviour = 'magic-shove'
              s.shove = 300
              s.damage += 22
              s.pierce += 8
            } }
        ]
      },
      {
        name: 'Deep Cold',
        tiers: [
          { name: 'Chill Touch', cost: 528,
            desc: 'Hits chill for 1.5 seconds, slowing 25%. White and Zebra ignore cold entirely.',
            apply: function (s) { s.chillMag = 0.25; s.chillT = 1.5; s.projKind = 'newt-frost' } },
          { name: 'Deep Freeze', cost: 1210,
            desc: 'Chill slows 45% for 2.5 seconds, and +1 damage.',
            apply: function (s) { s.chillMag = 0.45; s.chillT = 2.5; s.damage += 1 } },
          { name: 'Glacier', cost: 2860,
            desc: 'Chill slows 65% for 3.5 seconds and the jet bursts across 40 units, so whole clumps freeze at once. +2 damage.',
            apply: function (s) {
              s.chillMag = 0.65
              s.chillT = 3.5
              s.damage += 2
              s.blastRadius = 40
            } },
          { name: 'Hoarfrost', cost: 13200,
            desc: 'Chill slows 85% for 5 seconds and leaves balloons brittle, taking 50% more damage from every tower. +6 damage.',
            apply: function (s) {
              s.chillMag = 0.85
              s.chillT = 5
              s.brittleMag = 0.5
              s.brittleT = 5
              s.damage += 6
            } },
          { name: 'Absolute Zero', cost: 88000,
            desc: 'Chill slows 95% for 8 seconds, brittleness rises to 150% extra damage, the burst reaches 90 units, and +28 damage.',
            apply: function (s) {
              s.chillMag = 0.95
              s.chillT = 8
              s.brittleMag = 1.5
              s.brittleT = 8
              s.damage += 28
              s.blastRadius = 90
              s.blastFalloff = 0.3
            } }
        ]
      },
      {
        name: 'Tidecaller',
        tiers: [
          { name: 'Deeper Well', cost: 484,
            desc: '+22 range.',
            apply: function (s) { s.range += 22 } },
          { name: 'Wave Crest', cost: 1100,
            desc: '+1 damage and 15% faster attacks.',
            apply: function (s) { s.damage += 1; s.cooldown *= 0.85 } },
          { name: 'Tidecall', cost: 2640,
            desc: 'Ability: a wave shoves every balloon on screen 120 units back and chills them 60% for 4 seconds. 55 second cooldown.',
            apply: function (s) {
              s.waveShove = 120
              s.waveChillMag = 0.6
              s.waveChillT = 4
              s.ability = { name: 'Tidecall', cooldown: 55, duration: 0, key: 'newt-tidecall' }
            } },
          { name: 'Standing Wave', cost: 12100,
            desc: 'The wave shoves 220 units. Blimps cannot be stunned and cannot be shoved, so instead the water drags them: a 90% slow for 5 seconds, of which a blimp resists roughly half. +4 damage.',
            apply: function (s) {
              s.waveShove = 220
              s.waveChillT = 6
              s.waveBlimpSlow = 0.9
              s.waveBlimpT = 5
              s.damage += 4
              if (s.ability) s.ability.name = 'Standing Wave'
            } },
          { name: 'Drown The Sky', cost: 83600,
            desc: 'The wave shoves 400 units, deals 400 cold damage to everything on screen, and drags blimps with a 97% slow for 9 seconds — about half after their resistance. +20 damage.',
            apply: function (s) {
              s.waveShove = 400
              s.waveDamage = 400
              s.waveChillT = 9
              s.waveChillMag = 0.95
              s.waveBlimpSlow = 0.97
              s.waveBlimpT = 9
              s.damage += 20
              if (s.ability) { s.ability.name = 'Drown The Sky'; s.ability.cooldown = 50 }
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      volley(sim, tower, target, 'newt-jet', 0)
    }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

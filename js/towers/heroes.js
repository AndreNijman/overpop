;(function (OP) {
  'use strict'

  /* The hero roster — eight heroes.
   *
   * A hero is a tower that levels on XP from pops and round survival instead of
   * on cash, and you get exactly one per game. That makes the pick a real
   * decision, and a real decision needs eight genuinely different answers — so
   * every hero here owns a mechanic no tower and no other hero has:
   *
   *   Bramble Hare        a lance that spears an entire queue in one line
   *   Vesper Bat          hands its own detection (and later its sight lines) to
   *                       every tower standing near it
   *   Tally Squirrel      prints cash, and can double every pop payout on the
   *                       whole board for a window (income: true, so PURIST bans it)
   *   Anvil Woodpecker    bores into one blimp hull, ramping damage the longer it
   *                       stays on the same target
   *   Rimefur Lynx        does almost no damage; its chill spreads from balloon to
   *                       balloon and it can hold a stretch of track still
   *   Emberspine Hedgehog useless until it molts at level 12, then the strongest
   *                       hero in the game — its quills split on impact
   *   Cantor Wren         its song buffs EVERY tower on the board for a window,
   *                       and can knock ten seconds off every tower's ability
   *   Tinder Magpie       barely scratches a balloon; its levels are permanent
   *                       upgrades for the whole board, and it can hand lives back
   *
   * Contract notes that shaped this file:
   *   - Every level from 2 to 20 grants something. defineHero rejects a gap.
   *   - Every `apply` is idempotent: levels are re-applied from scratch on each
   *     restat, so a level either assigns an absolute value or adds to the value
   *     the base block already carried.
   *   - Abilities and projectile behaviours are STRING KEYS. Nothing here stores a
   *     closure or an object reference in sim state; hero.data holds numbers only,
   *     so mid-round save round-trips it.
   *   - Randomness: none. Not one hero reads sim.rng, because none of them needs
   *     to — every spread, ring and split angle is derived arithmetically, which
   *     is strictly better for determinism than spending rolls.
   *   - Every registry key here is prefixed `hero-` so it cannot collide with a
   *     tower family file. declareProjKind throws on a duplicate (which would take
   *     the whole bundle down); ABILITIES and PROJ_BEHAVIOURS would collide
   *     silently, which is worse.
   */

  const M = OP.M
  const D = OP.DMG

  /* ---------- projectile art kinds ---------- */

  OP.declareProjKind('hero-hare-dart', { shape: 'dart', tint: '#d8e4a8', size: 4, trail: true })
  OP.declareProjKind('hero-hare-shard', { shape: 'dart', tint: '#f2f0d6', size: 5, trail: true })
  OP.declareProjKind('hero-hare-lance', { shape: 'beam', tint: '#ffe9a8', size: 8, trail: true })

  OP.declareProjKind('hero-vesper-pulse', { shape: 'ring', tint: '#b9c9ff', size: 5 })
  OP.declareProjKind('hero-vesper-shriek', { shape: 'ring', tint: '#e6ecff', size: 7 })

  OP.declareProjKind('hero-tally-acorn', { shape: 'dart', tint: '#b98b46', size: 4, spin: true })
  OP.declareProjKind('hero-tally-goldnut', { shape: 'orb', tint: '#f2d06b', size: 5, spin: true })

  OP.declareProjKind('hero-anvil-bore', { shape: 'spike', tint: '#8d8f96', size: 5 })
  OP.declareProjKind('hero-anvil-tempered', { shape: 'spike', tint: '#e0c98a', size: 6, trail: true })

  OP.declareProjKind('hero-rimefur-shard', { shape: 'droplet', tint: '#cdeeff', size: 5 })
  OP.declareProjKind('hero-rimefur-rime', { shape: 'droplet', tint: '#ffffff', size: 6, trail: true })

  OP.declareProjKind('hero-emberspine-quill', { shape: 'spike', tint: '#a89078', size: 4, spin: true })
  OP.declareProjKind('hero-emberspine-ironquill', { shape: 'spike', tint: '#d9d2c4', size: 5, spin: true })

  OP.declareProjKind('hero-cantor-note', { shape: 'orb', tint: '#ffd6e8', size: 4, trail: true })

  OP.declareProjKind('hero-magpie-tack', { shape: 'dart', tint: '#cfd6e0', size: 3 })

  /* ---------- shared projectile behaviours ---------- */

  /* Rimefur Lynx: the chill jumps. On contact, every balloon within `spreadR` of
     the one that was hit is chilled too — which is how a hero with one damage per
     shot still changes the shape of a rush. The camo gate is honoured: a spread
     from a non-detecting shot must not touch a veiled balloon. */
  OP.PROJ_BEHAVIOURS['hero-rimefur-chill-spread'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data || !(p.data.spreadR > 0) || !b) return
      const near = sim._heroSpread || (sim._heroSpread = [])
      OP.Grid.queryCircle(sim.grid, b.x, b.y, p.data.spreadR, near)
      for (let i = 0; i < near.length; i++) {
        const o = near[i]
        if (!o.alive || o.id === b.id) continue
        if ((o.props & OP.PROP.VEILED) && !p.camoDetect) continue
        OP.Effects.apply(o, OP.Effects.make('cold', p.data.spreadT, p.data.spreadMag, p.ownerId, D.COLD))
      }
    }
  }

  /* Emberspine Hedgehog: a molted quill breaks apart on impact into smaller
     quills that fan forward. The fragments carry `split: 0`, so the chain stops
     one generation deep — an unbounded split would fill the projectile pool. */
  OP.PROJ_BEHAVIOURS['hero-emberspine-quill-split'] = {
    onHit: function (sim, p, b, res) {
      if (!p.data || !(p.data.split > 0) || !b) return
      const n = Math.min(4, Math.max(1, p.data.split | 0))
      const heading = Math.atan2(p.vy, p.vx)
      const speed = Math.max(60, Math.hypot(p.vx, p.vy) * 0.75)
      for (let i = 0; i < n; i++) {
        const a = heading + (i - (n - 1) / 2) * 0.42
        OP.Projectiles.fireAt(sim, {
          x: b.x, y: b.y,
          kind: p.kind,
          damage: Math.max(1, Math.round(p.damage * 0.45)),
          dmgType: p.dmgType,
          pierce: 2,
          radius: p.radius,
          life: 0.45,
          ownerId: p.ownerId,
          camoDetect: p.camoDetect,
          data: { split: 0 },
          behaviour: 'hero-emberspine-quill-split'
        }, a, speed)
      }
    }
  }

  /* ---------- shared helpers ---------- */

  /** Status effects a shot carries, built from the resolved stat block. */
  function shotEffects (hero) {
    const s = hero.s
    let out = null
    if (s.coldT > 0 && s.coldMag > 0) { out = out || []; out.push(OP.Effects.make('cold', s.coldT, s.coldMag, hero.id, D.COLD)) }
    if (s.glueT > 0 && s.glueMag > 0) { out = out || []; out.push(OP.Effects.make('glue', s.glueT, s.glueMag, hero.id, D.NORMAL)) }
    if (s.acidT > 0 && s.acidDps > 0) { out = out || []; out.push(OP.Effects.make('acid', s.acidT, s.acidDps, hero.id, D.ACID)) }
    if (s.brittleT > 0 && s.brittleMag > 0) { out = out || []; out.push(OP.Effects.make('brittle', s.brittleT, s.brittleMag, hero.id, D.NORMAL)) }
    if (s.shotStunT > 0) { out = out || []; out.push(OP.Effects.make('stun', s.shotStunT, 1, hero.id, D.NORMAL)) }
    return out
  }

  /**
   * The shared firing routine: `shots` projectiles fanned symmetrically about the
   * lead point. `opts` overrides a stat for this volley only — used by the heroes
   * whose ability windows change what a shot is, without ever touching `hero.s`
   * (which is rebuilt by restat and must stay a pure function of level).
   */
  function volley (sim, hero, target, defaultKind, opts) {
    opts = opts || {}
    const s = hero.s
    const shots = Math.max(1, Math.round(opts.shots === undefined ? s.shots : opts.shots))
    const spread = opts.spread === undefined ? s.spread : opts.spread
    const damage = Math.max(0, Math.round(opts.damage === undefined ? s.damage : opts.damage))
    const pierce = Math.max(1, Math.round(opts.pierce === undefined ? s.pierce : opts.pierce))
    const aim = OP.Targeting.leadPoint(sim, hero, target, s.projSpeed)
    const centre = M.angleTo(hero.x, hero.y, aim.x, aim.y)
    const effects = shotEffects(hero)

    for (let i = 0; i < shots; i++) {
      const offset = shots === 1 ? 0 : spread * (i / (shots - 1) - 0.5)
      OP.Projectiles.fireAt(sim, {
        x: hero.x, y: hero.y,
        kind: s.projKind || defaultKind,
        damage: damage,
        dmgType: s.dmgType,
        pierce: pierce,
        radius: s.projRadius,
        life: s.projLife,
        maxRange: s.range * 1.5,
        ownerId: hero.id,
        camoDetect: s.camoDetect || !!opts.camoDetect,
        behaviour: opts.behaviour || s.behaviour || '',
        data: opts.data || null,
        effects: effects
      }, centre + offset, s.projSpeed)
    }
  }

  /**
   * Every balloon a screen-wide effect may touch, as ids.
   * Snapshotted first: a hit can split a balloon and append its children to
   * sim.balloons, and a screen-wide ability must not then hit the children it
   * just created.
   */
  function screenTargets (sim, camoDetect, out) {
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

  /** Tick a countdown stored in hero.data down to zero. Returns true on the tick
      it reaches zero, so a caller can clean up exactly once. */
  function countdown (d, key, dt) {
    if (!(d[key] > 0)) return false
    d[key] = Math.max(0, d[key] - dt)
    return d[key] === 0
  }

  /* ================================================================= *
   * 1. Bramble Hare — the all-rounder                                 *
   * ================================================================= */

  /* Thistle Lance: one shot down the sightline with absurd pierce, as shatter so
     nothing on the board can shrug it off. The identity of the safe pick is that
     its ultimate has no counter — just a cooldown. */
  OP.ABILITIES['hero-hare-lance'] = function (sim, hero) {
    const s = hero.s
    let angle = hero.angle
    const id = OP.Targeting.acquire(sim, hero, hero.targetMode)
    if (id >= 0) {
      const b = sim.byId.get(id)
      if (b) angle = M.angleTo(hero.x, hero.y, b.x, b.y)
    }
    OP.Projectiles.fireAt(sim, {
      x: hero.x, y: hero.y,
      kind: 'hero-hare-lance',
      damage: s.lanceDamage || 8,
      dmgType: D.SHATTER,
      pierce: s.lancePierce || 30,
      radius: 8,
      life: 2.4,
      maxRange: 1800,
      ownerId: hero.id,
      camoDetect: true
    }, angle, 900)
  }

  /* Second Wind: a self window. Read in fire(), never written into hero.s. */
  OP.ABILITIES['hero-hare-second-wind'] = function (sim, hero) {
    hero.data.windT = hero.s.windT || 5
  }

  OP.defineHero({
    key: 'bramble-hare',
    name: 'Bramble Hare',
    title: 'the Steady Paw',
    blurb: 'Good at everything and bad at nothing — the hero to take on your first run. ' +
      'Its Thistle Lance spears a whole queue in one line, and shatter damage means no balloon tier can ignore it.',

    cost: 750,
    footprint: 14,
    placement: 'land',

    base: {
      range: 135,
      cooldown: 0.75,
      damage: 2,
      pierce: 3,
      dmgType: D.SHARP,
      projSpeed: 480,
      projLife: 1.4,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    levels: [
      { level: 2, desc: '+1 pierce, so each dart pops 4 balloons.', apply: function (s) { s.pierce += 1 } },
      { level: 3, desc: '+10 range.', apply: function (s) { s.range += 10 } },
      {
        level: 4,
        desc: 'Unlocks Thistle Lance: a shatter lance with 8 damage and 30 pierce that runs the length of the track.',
        apply: function (s) {
          s.lanceDamage = 8
          s.lancePierce = 30
          s.ability = { name: 'Thistle Lance', cooldown: 26, duration: 0, key: 'hero-hare-lance' }
        }
      },
      { level: 5, desc: '+1 damage (3 per dart).', apply: function (s) { s.damage += 1 } },
      { level: 6, desc: '10% faster attack.', apply: function (s) { s.cooldown *= 0.90 } },
      { level: 7, desc: '+2 pierce and +10 more range.', apply: function (s) { s.pierce += 2; s.range += 10 } },
      { level: 8, desc: '+1 damage (4 per dart).', apply: function (s) { s.damage += 1 } },
      { level: 9, desc: 'Sees through Veiled balloons.', apply: function (s) { s.camoDetect = true } },
      {
        level: 10,
        desc: '+12 range, and the Lance climbs to 16 damage and 40 pierce.',
        apply: function (s) { s.range += 12; s.lanceDamage = 16; s.lancePierce = 40 }
      },
      { level: 11, desc: '10% faster attack again.', apply: function (s) { s.cooldown *= 0.90 } },
      { level: 12, desc: '+2 damage (6 per dart).', apply: function (s) { s.damage += 2 } },
      {
        level: 13,
        desc: 'Unlocks Second Wind: 5 seconds of one extra dart per shot at 50% more damage.',
        apply: function (s) {
          s.windT = 5
          s.ability2 = { name: 'Second Wind', cooldown: 34, duration: 5, key: 'hero-hare-second-wind' }
        }
      },
      { level: 14, desc: 'Throws two darts per shot in a narrow arc.', apply: function (s) { s.shots = 2; s.spread = 0.14 } },
      { level: 15, desc: '+3 damage and +2 pierce.', apply: function (s) { s.damage += 3; s.pierce += 2 } },
      {
        level: 16,
        desc: 'Darts become flint shards — shatter damage, which cracks Lead open.',
        apply: function (s) { s.dmgType = D.SHATTER; s.projKind = 'hero-hare-shard' }
      },
      { level: 17, desc: '12% faster attack.', apply: function (s) { s.cooldown *= 0.88 } },
      { level: 18, desc: '+18 range and 25% faster darts.', apply: function (s) { s.range += 18; s.projSpeed *= 1.25 } },
      { level: 19, desc: '+4 damage (13 per dart).', apply: function (s) { s.damage += 4 } },
      {
        level: 20,
        desc: '+8 damage, +6 pierce, the Lance hits for 40 with 60 pierce, and it recharges twice as fast.',
        apply: function (s) {
          s.damage += 8
          s.pierce += 6
          s.lanceDamage = 40
          s.lancePierce = 60
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      const windy = (hero.data.windT || 0) > 0
      volley(sim, hero, target, 'hero-hare-dart', windy
        ? { shots: s.shots + 1, spread: Math.max(0.16, s.spread), damage: s.damage * 1.5 }
        : null)
    },

    update: function (sim, hero, dt) { countdown(hero.data, 'windT', dt) },
    onPlace: function (sim, hero) { hero.data.windT = 0 }
  })

  /* ================================================================= *
   * 2. Vesper Bat — the detection specialist                          *
   * ================================================================= */

  /* Echo Strike: a sound pulse centred on the bat. Always detects, so it is the
     one ability in the roster that reliably lands on a veiled rush, and it leaves
     everything brittle for whatever shoots next. */
  OP.ABILITIES['hero-vesper-echo-strike'] = function (sim, hero) {
    const s = hero.s
    const radius = s.range * 1.2
    OP.Damage.blast(sim, hero.x, hero.y, radius, {
      damage: s.strikeDamage || 8,
      dmgType: D.NORMAL,
      sourceId: hero.id,
      effects: [OP.Effects.make('brittle', 4, s.strikeBrittle || 0.25, hero.id, D.NORMAL)]
    }, { camoDetect: true, maxTargets: 80 })
    sim.blastEvents.push({ x: hero.x, y: hero.y, radius: radius, kind: 'hero-vesper-echo', hits: 0 })
  }

  /* Night Hunt: a self window of triple shots that all detect. */
  OP.ABILITIES['hero-vesper-night-hunt'] = function (sim, hero) {
    hero.data.huntT = hero.s.huntT || 8
  }

  OP.defineHero({
    key: 'vesper-bat',
    name: 'Vesper Bat',
    title: 'the Night Ear',
    blurb: 'Hears Veiled balloons from the moment you place it, and as it levels it lends that hearing to every tower ' +
      'standing near it. At level 18 those towers shoot over terrain as well. Pure sound damage, so nothing is immune.',

    cost: 800,
    footprint: 13,
    placement: 'land',

    base: {
      range: 145,
      cooldown: 0.62,
      damage: 1,
      pierce: 2,
      dmgType: D.NORMAL,
      projSpeed: 430,
      projLife: 1.2,
      projRadius: 5,
      camoDetect: true,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'close', 'last', 'strong']
    },

    levels: [
      { level: 2, desc: '+1 pierce (3 balloons per pulse).', apply: function (s) { s.pierce += 1 } },
      {
        level: 3,
        desc: 'Towers within 70 units start seeing Veiled balloons too.',
        apply: function (s) { s.echoRadius = 70 }
      },
      { level: 4, desc: '+10 range.', apply: function (s) { s.range += 10 } },
      { level: 5, desc: '+1 damage (2 per pulse).', apply: function (s) { s.damage += 1 } },
      {
        level: 6,
        desc: 'Unlocks Echo Strike: 8 sound damage to everything within 1.2x range, Veiled included, and 4 seconds of +25% damage taken.',
        apply: function (s) {
          s.strikeDamage = 8
          s.strikeBrittle = 0.25
          s.ability = { name: 'Echo Strike', cooldown: 30, duration: 0, key: 'hero-vesper-echo-strike' }
        }
      },
      { level: 7, desc: 'The detection aura widens to 110 units.', apply: function (s) { s.echoRadius = 110 } },
      { level: 8, desc: '12% faster attack.', apply: function (s) { s.cooldown *= 0.88 } },
      { level: 9, desc: '+1 pierce and +12 range.', apply: function (s) { s.pierce += 1; s.range += 12 } },
      { level: 10, desc: '+2 damage (4 per pulse).', apply: function (s) { s.damage += 2 } },
      { level: 11, desc: 'The detection aura widens to 150 units.', apply: function (s) { s.echoRadius = 150 } },
      { level: 12, desc: 'Emits two pulses per shot.', apply: function (s) { s.shots = 2; s.spread = 0.18 } },
      { level: 13, desc: '12% faster attack again.', apply: function (s) { s.cooldown *= 0.88 } },
      {
        level: 14,
        desc: '+2 damage, +2 pierce, and Echo Strike hits for 24.',
        apply: function (s) { s.damage += 2; s.pierce += 2; s.strikeDamage = 24 }
      },
      {
        level: 15,
        desc: 'Unlocks Night Hunt: 8 seconds of three pulses per shot at double pierce.',
        apply: function (s) {
          s.huntT = 8
          s.ability2 = { name: 'Night Hunt', cooldown: 45, duration: 8, key: 'hero-vesper-night-hunt' }
        }
      },
      { level: 16, desc: 'The detection aura widens to 200 units.', apply: function (s) { s.echoRadius = 200 } },
      { level: 17, desc: '15% faster attack.', apply: function (s) { s.cooldown *= 0.85 } },
      {
        level: 18,
        desc: 'Towers in the aura also ignore line of sight — they shoot straight through rock.',
        apply: function (s) { s.echoLOS = true }
      },
      {
        level: 19,
        desc: '+3 damage and 20% faster pulses.',
        apply: function (s) { s.damage += 3; s.projSpeed *= 1.2; s.projKind = 'hero-vesper-shriek' }
      },
      {
        level: 20,
        desc: '+6 damage, +4 pierce, the aura covers the whole map, and Echo Strike (now 60 damage) recharges twice as fast.',
        apply: function (s) {
          s.damage += 6
          s.pierce += 4
          s.echoGlobal = true
          s.strikeDamage = 60
          s.strikeBrittle = 0.4
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      const hunting = (hero.data.huntT || 0) > 0
      volley(sim, hero, target, 'hero-vesper-pulse', hunting
        ? { shots: s.shots + 1, spread: Math.max(0.22, s.spread), pierce: s.pierce * 2, camoDetect: true }
        : null)
    },

    update: function (sim, hero, dt) { countdown(hero.data, 'huntT', dt) },
    onPlace: function (sim, hero) { hero.data.huntT = 0 },

    /* `hero.s` here is the UNBUFFED block — the engine swaps it in — so the aura
       radius never depends on what other supports are already buffing this bat. */
    buffs: function (sim, hero) {
      const s = hero.s
      if (!(s.echoRadius > 0) && !s.echoGlobal) return
      const mods = { camoDetect: true }
      if (s.echoLOS) mods.ignoresLOS = true
      OP.Buffs.register(sim, {
        id: 'hero-vesper-echo:' + hero.id,
        sourceId: hero.id,
        x: hero.x, y: hero.y,
        radius: s.echoGlobal ? 'global' : s.echoRadius,
        priority: 5,
        excludeSelf: true,
        mods: mods
      })
    }
  })

  /* ================================================================= *
   * 3. Tally Squirrel — the economy hero          (income: true)      *
   * ================================================================= */

  /* Buried Cache: a lump of cash. Gated on rules.allowIncome, like every payout
     this hero makes — Heroes.canPlace does not consult Economy.towerAllowed, so
     the hero has to keep PURIST honest itself. */
  OP.ABILITIES['hero-tally-cache'] = function (sim, hero) {
    if (!sim.rules.allowIncome) return
    OP.Economy.earn(sim, hero.s.cacheCash || 150, hero.id)
  }

  /* Bounty Season: doubles the cash every pop on the board pays, for a window.
     Implemented as a temporary change to sim.cashPerPopMul with the previous
     value parked in hero.data — one number each, so it round-trips through a
     mid-round save without a special case. */
  OP.ABILITIES['hero-tally-bounty'] = function (sim, hero) {
    if (!sim.rules.allowIncome) return
    const d = hero.data
    if (d.bountyT > 0) return
    d.bountyPrev = sim.cashPerPopMul
    d.bountyT = hero.s.bountyT || 12
    sim.cashPerPopMul = sim.cashPerPopMul * (hero.s.bountyMul || 2)
  }

  OP.defineHero({
    key: 'tally-squirrel',
    name: 'Tally Squirrel',
    title: 'the Hoarder',
    blurb: 'Prints money instead of damage: a trickle every second, a pile every round, and a window where every pop ' +
      'on the whole board pays double. Counts as an income tower, so PURIST will not let you take it.',

    cost: 700,
    footprint: 14,
    placement: 'land',
    income: true,

    base: {
      range: 120,
      cooldown: 0.95,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 420,
      projLife: 1.3,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    levels: [
      { level: 2, desc: '+12 range.', apply: function (s) { s.range += 12 } },
      { level: 3, desc: 'Pays $40 every time you clear a round.', apply: function (s) { s.hoardPerRound = 40 } },
      { level: 4, desc: '+1 damage (2 per acorn).', apply: function (s) { s.damage += 1 } },
      {
        level: 5,
        desc: 'Unlocks Buried Cache: $150 on the spot, every 45 seconds.',
        apply: function (s) {
          s.cacheCash = 150
          s.ability = { name: 'Buried Cache', cooldown: 45, duration: 0, key: 'hero-tally-cache' }
        }
      },
      { level: 6, desc: 'Earns $0.6 per second, all round long.', apply: function (s) { s.hoardPerSecond = 0.6 } },
      { level: 7, desc: '+1 pierce and 10% faster attack.', apply: function (s) { s.pierce += 1; s.cooldown *= 0.90 } },
      { level: 8, desc: 'The round payout rises to $90.', apply: function (s) { s.hoardPerRound = 90 } },
      { level: 9, desc: '+1 damage (3 per acorn).', apply: function (s) { s.damage += 1 } },
      {
        level: 10,
        desc: '$1.2 per second, and Buried Cache pays $400.',
        apply: function (s) { s.hoardPerSecond = 1.2; s.cacheCash = 400 }
      },
      { level: 11, desc: 'Sees through Veiled balloons.', apply: function (s) { s.camoDetect = true } },
      { level: 12, desc: 'The round payout rises to $160.', apply: function (s) { s.hoardPerRound = 160 } },
      { level: 13, desc: 'Throws two acorns per shot.', apply: function (s) { s.shots = 2; s.spread = 0.20 } },
      { level: 14, desc: '+2 damage and 12% faster attack.', apply: function (s) { s.damage += 2; s.cooldown *= 0.88 } },
      { level: 15, desc: '$2 per second.', apply: function (s) { s.hoardPerSecond = 2 } },
      {
        level: 16,
        desc: 'Unlocks Bounty Season: for 12 seconds every pop anywhere on the map pays double.',
        apply: function (s) {
          s.bountyT = 12
          s.bountyMul = 2
          s.ability2 = { name: 'Bounty Season', cooldown: 90, duration: 12, key: 'hero-tally-bounty' }
        }
      },
      {
        level: 17,
        desc: 'The round payout rises to $260, and +14 range.',
        apply: function (s) { s.hoardPerRound = 260; s.range += 14 }
      },
      { level: 18, desc: '+3 damage and +2 pierce.', apply: function (s) { s.damage += 3; s.pierce += 2 } },
      {
        level: 19,
        desc: '$3 per second, Buried Cache pays $900, and the acorns are gilded.',
        apply: function (s) { s.hoardPerSecond = 3; s.cacheCash = 900; s.projKind = 'hero-tally-goldnut' }
      },
      {
        level: 20,
        desc: '$420 per round, +5 damage, and Buried Cache recharges twice as fast.',
        apply: function (s) {
          s.hoardPerRound = 420
          s.damage += 5
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) { volley(sim, hero, target, 'hero-tally-acorn', null) },

    update: function (sim, hero, dt) {
      const s = hero.s
      const d = hero.data

      // Bounty Season expiry: put the payout multiplier back exactly as found.
      if (d.bountyT > 0 && countdown(d, 'bountyT', dt)) {
        sim.cashPerPopMul = d.bountyPrev === undefined ? sim.rules.cashPerPopMul : d.bountyPrev
      }

      if (!sim.rules.allowIncome) return

      if (s.hoardPerSecond > 0) {
        // Accumulate fractionally, pay whole dollars — a 0.6/s trickle must not
        // round to nothing sixty times a second.
        d.hoardAcc = (d.hoardAcc || 0) + s.hoardPerSecond * dt
        if (d.hoardAcc >= 1) {
          const whole = Math.floor(d.hoardAcc)
          d.hoardAcc -= whole
          OP.Economy.earn(sim, whole, hero.id)
        }
      }

      const cleared = sim.stats.roundsCleared
      if (d.hoardMark === undefined) d.hoardMark = cleared
      if (cleared > d.hoardMark) {
        if (s.hoardPerRound > 0) OP.Economy.earn(sim, (cleared - d.hoardMark) * s.hoardPerRound, hero.id)
        d.hoardMark = cleared
      }
    },

    onPlace: function (sim, hero) {
      hero.data.hoardAcc = 0
      hero.data.hoardMark = sim.stats.roundsCleared
      hero.data.bountyT = 0
    }
  })

  /* ================================================================= *
   * 4. Anvil Woodpecker — the blimp specialist                        *
   * ================================================================= */

  /* Hull Crack: one enormous blow to the biggest blimp in range, plus a long
     brittle window so the rest of your board finishes the job. Falls back to the
     strongest balloon in range when there is no blimp — for a lot less. */
  OP.ABILITIES['hero-anvil-hull-crack'] = function (sim, hero) {
    const s = hero.s
    const ids = sim._heroAim || (sim._heroAim = [])
    OP.Targeting.acquireMany(sim, hero, 'strong', 6, ids)
    if (!ids.length) return

    let victim = null
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue
      if (!victim) victim = b
      if (OP.BALLOON_TIERS[b.tier].blimp) { victim = b; break }
    }
    if (!victim) return

    const blimp = OP.BALLOON_TIERS[victim.tier].blimp
    OP.Damage.hit(sim, victim, {
      damage: blimp ? (s.crackDamage || 60) : Math.ceil((s.crackDamage || 60) / 6),
      dmgType: s.dmgType,
      sourceId: hero.id,
      effects: [OP.Effects.make('brittle', 6, s.crackBrittle || 0.3, hero.id, D.NORMAL)]
    })
    sim.blastEvents.push({ x: victim.x, y: victim.y, radius: 30, kind: 'hero-anvil-crack', hits: 1 })
  }

  /* Rivet Storm: hammers every blimp on the field at once and ignores everything
     smaller. The answer to a wave that sends four blimps down four lanes. */
  OP.ABILITIES['hero-anvil-rivet-storm'] = function (sim, hero) {
    const s = hero.s
    const ids = screenTargets(sim, true, [])
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue
      if (!OP.BALLOON_TIERS[b.tier].blimp) continue
      OP.Damage.hit(sim, b, {
        damage: s.rivetDamage || 80,
        dmgType: s.dmgType,
        sourceId: hero.id,
        effects: [OP.Effects.make('brittle', 5, 0.25, hero.id, D.NORMAL)]
      })
    }
  }

  OP.defineHero({
    key: 'anvil-woodpecker',
    name: 'Anvil Woodpecker',
    title: 'the Hull-Breaker',
    blurb: 'Slow, single-target, and close to useless against a crowd — then it puts its beak through a blimp hull. ' +
      'Bonus damage against blimps, and the longer it stays on one blimp the harder every strike lands.',

    cost: 950,
    footprint: 14,
    placement: 'land',

    base: {
      range: 130,
      cooldown: 1.25,
      damage: 4,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 560,
      projLife: 1.1,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      // Defaults to Strong, because a blimp specialist pointed at the first red
      // balloon in the queue is a blimp specialist doing nothing.
      targetModes: ['strong', 'first', 'last', 'close']
    },

    levels: [
      { level: 2, desc: '+1 damage (5 per strike).', apply: function (s) { s.damage += 1 } },
      { level: 3, desc: '+6 bonus damage against blimps.', apply: function (s) { s.hullBonus = 6 } },
      { level: 4, desc: '+10 range.', apply: function (s) { s.range += 10 } },
      {
        level: 5,
        desc: 'Boring in: every consecutive strike on the same blimp adds +2 damage, up to 5 stacks.',
        apply: function (s) { s.hullDrill = 2; s.hullDrillCap = 5 }
      },
      { level: 6, desc: '10% faster attack.', apply: function (s) { s.cooldown *= 0.90 } },
      {
        level: 7,
        desc: 'Unlocks Hull Crack: 60 damage to the biggest blimp in range and 6 seconds of +30% damage taken.',
        apply: function (s) {
          s.crackDamage = 60
          s.crackBrittle = 0.3
          s.ability = { name: 'Hull Crack', cooldown: 35, duration: 0, key: 'hero-anvil-hull-crack' }
        }
      },
      {
        level: 8,
        desc: 'A tempered beak: damage becomes shatter, which no balloon or blimp resists.',
        apply: function (s) { s.dmgType = D.SHATTER; s.projKind = 'hero-anvil-tempered' }
      },
      { level: 9, desc: 'Blimp bonus rises to +14, and +10 range.', apply: function (s) { s.hullBonus = 14; s.range += 10 } },
      { level: 10, desc: '+3 damage (8 per strike).', apply: function (s) { s.damage += 3 } },
      { level: 11, desc: 'Sees through Veiled balloons — including veiled blimps.', apply: function (s) { s.camoDetect = true } },
      { level: 12, desc: 'Boring in gets deeper: +4 per stack, up to 8 stacks.', apply: function (s) { s.hullDrill = 4; s.hullDrillCap = 8 } },
      { level: 13, desc: '12% faster attack.', apply: function (s) { s.cooldown *= 0.88 } },
      {
        level: 14,
        desc: 'Unlocks Rivet Storm: 80 damage to every blimp on the map at once.',
        apply: function (s) {
          s.rivetDamage = 80
          s.ability2 = { name: 'Rivet Storm', cooldown: 60, duration: 0, key: 'hero-anvil-rivet-storm' }
        }
      },
      { level: 15, desc: '+4 damage (12 per strike).', apply: function (s) { s.damage += 4 } },
      { level: 16, desc: 'Blimp bonus rises to +30.', apply: function (s) { s.hullBonus = 30 } },
      { level: 17, desc: '12% faster attack and +12 range.', apply: function (s) { s.cooldown *= 0.88; s.range += 12 } },
      { level: 18, desc: '+1 pierce and +4 damage — it finally hits two things at once.', apply: function (s) { s.pierce += 1; s.damage += 4 } },
      {
        level: 19,
        desc: 'Boring in caps at 10 stacks of +7, and Hull Crack hits for 200.',
        apply: function (s) { s.hullDrill = 7; s.hullDrillCap = 10; s.crackDamage = 200; s.rivetDamage = 200 }
      },
      {
        level: 20,
        desc: '+10 damage, +70 against blimps, and Hull Crack recharges twice as fast.',
        apply: function (s) {
          s.damage += 10
          s.hullBonus = 70
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      const d = hero.data
      let bonus = 0

      if (OP.BALLOON_TIERS[target.tier].blimp) {
        bonus += s.hullBonus || 0
        // The drill only ramps while the target does not change — switching
        // blimps starts the hole again, which is the whole point of the mechanic.
        if (d.drillId === target.id) d.drillStack = Math.min(s.hullDrillCap || 0, (d.drillStack || 0) + 1)
        else { d.drillId = target.id; d.drillStack = 0 }
        bonus += (d.drillStack || 0) * (s.hullDrill || 0)
      } else {
        d.drillId = -1
        d.drillStack = 0
      }

      volley(sim, hero, target, 'hero-anvil-bore', { damage: s.damage + bonus })
    },

    onPlace: function (sim, hero) { hero.data.drillId = -1; hero.data.drillStack = 0 }
  })

  /* ================================================================= *
   * 5. Rimefur Lynx — the controller                                  *
   * ================================================================= */

  /* Deep Freeze: stops the whole board. Blimps cannot be stunned, so they get a
     heavy glue instead — the only honest way to "stop" one. */
  OP.ABILITIES['hero-rimefur-deep-freeze'] = function (sim, hero) {
    const s = hero.s
    const ids = screenTargets(sim, s.camoDetect, [])
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b || !b.alive) continue
      if (OP.BALLOON_TIERS[b.tier].blimp) {
        OP.Effects.apply(b, OP.Effects.make('glue', s.freezeT || 3, s.freezeGlue || 0.6, hero.id, D.NORMAL))
      } else {
        OP.Effects.apply(b, OP.Effects.make('stun', s.freezeStun || 1.5, 1, hero.id, D.NORMAL))
      }
      OP.Effects.apply(b, OP.Effects.make('cold', s.freezeT || 3, s.coldMag || 0.35, hero.id, D.COLD))
    }
  }

  /* White Out: the lynx holds a stretch of track. While it runs, everything in
     range is re-glued every tick, so nothing walks out of the slow. */
  OP.ABILITIES['hero-rimefur-white-out'] = function (sim, hero) {
    hero.data.whiteT = hero.s.whiteT || 10
  }

  OP.defineHero({
    key: 'rimefur-lynx',
    name: 'Rimefur Lynx',
    title: 'the Long Winter',
    blurb: 'Barely scratches anything. What it does is chill and glue — and its chill jumps from balloon to balloon, ' +
      'so one shot slows a whole clump. White balloons ignore the cold; that is the price of the best slow in the game.',

    cost: 850,
    footprint: 14,
    placement: 'land',

    base: {
      range: 150,
      cooldown: 0.85,
      damage: 1,
      pierce: 3,
      dmgType: D.COLD,
      projSpeed: 400,
      projLife: 1.5,
      projRadius: 5,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'close', 'last', 'strong']
    },

    levels: [
      { level: 2, desc: 'Shots chill: 35% slower for 1.6 seconds.', apply: function (s) { s.coldT = 1.6; s.coldMag = 0.35 } },
      { level: 3, desc: '+12 range.', apply: function (s) { s.range += 12 } },
      { level: 4, desc: 'Shots also glue: a further 25% slow for 2.5 seconds.', apply: function (s) { s.glueT = 2.5; s.glueMag = 0.25 } },
      {
        level: 5,
        desc: 'Unlocks Deep Freeze: stuns every balloon on the map for 1.5 seconds. Blimps get a 60% glue instead.',
        apply: function (s) {
          s.freezeStun = 1.5
          s.freezeGlue = 0.6
          s.freezeT = 3
          s.ability = { name: 'Deep Freeze', cooldown: 40, duration: 0, key: 'hero-rimefur-deep-freeze' }
        }
      },
      { level: 6, desc: '+1 damage and 8% faster attack.', apply: function (s) { s.damage += 1; s.cooldown *= 0.92 } },
      { level: 7, desc: 'The chill deepens to 45% for 2.2 seconds.', apply: function (s) { s.coldT = 2.2; s.coldMag = 0.45 } },
      {
        level: 8,
        desc: 'The chill spreads 40 units from whatever it hits — one shot slows a clump.',
        apply: function (s) { s.rimeSpread = 40; s.spreadMag = 0.35; s.behaviour = 'hero-rimefur-chill-spread' }
      },
      { level: 9, desc: '+1 pierce and +12 range.', apply: function (s) { s.pierce += 1; s.range += 12 } },
      { level: 10, desc: 'The glue deepens to 40% for 3.5 seconds.', apply: function (s) { s.glueT = 3.5; s.glueMag = 0.40 } },
      { level: 11, desc: '+2 damage (4 per shard).', apply: function (s) { s.damage += 2 } },
      {
        level: 12,
        desc: 'Unlocks White Out: for 10 seconds nothing in range escapes a 60% slow.',
        apply: function (s) {
          s.whiteT = 10
          s.whiteMag = 0.6
          s.ability2 = { name: 'White Out', cooldown: 70, duration: 10, key: 'hero-rimefur-white-out' }
        }
      },
      { level: 13, desc: 'Sees through Veiled balloons.', apply: function (s) { s.camoDetect = true } },
      { level: 14, desc: 'Fires two shards per shot, 8% faster.', apply: function (s) { s.shots = 2; s.spread = 0.20; s.cooldown *= 0.92 } },
      { level: 15, desc: 'The chill spreads 70 units at 50% strength.', apply: function (s) { s.rimeSpread = 70; s.spreadMag = 0.50; s.projKind = 'hero-rimefur-rime' } },
      { level: 16, desc: 'Chilled balloons turn brittle: +30% damage taken from everything, for 3 seconds.', apply: function (s) { s.brittleT = 3; s.brittleMag = 0.30 } },
      { level: 17, desc: '+2 damage and 10% faster attack.', apply: function (s) { s.damage += 2; s.cooldown *= 0.90 } },
      { level: 18, desc: 'Fires three shards per shot.', apply: function (s) { s.shots = 3; s.spread = 0.30 } },
      { level: 19, desc: 'Shards briefly stun what they hit (0.5 seconds, blimps excepted).', apply: function (s) { s.shotStunT = 0.5 } },
      {
        level: 20,
        desc: '+3 damage, +3 pierce, a 60% chill and a 55% glue, and Deep Freeze recharges twice as fast.',
        apply: function (s) {
          s.damage += 3
          s.pierce += 3
          s.coldMag = 0.60
          s.glueMag = 0.55
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      volley(sim, hero, target, 'hero-rimefur-shard', s.rimeSpread > 0
        ? { data: { spreadR: s.rimeSpread, spreadT: s.coldT || 1.6, spreadMag: s.spreadMag || 0.35 } }
        : null)
    },

    update: function (sim, hero, dt) {
      const d = hero.data
      if (!(d.whiteT > 0)) return
      countdown(d, 'whiteT', dt)

      const s = hero.s
      const near = sim._heroWhite || (sim._heroWhite = [])
      OP.Grid.queryCircle(sim.grid, hero.x, hero.y, s.range * 1.35, near)
      for (let i = 0; i < near.length; i++) {
        const b = near[i]
        if (!b.alive) continue
        if ((b.props & OP.PROP.VEILED) && !s.camoDetect) continue
        OP.Effects.apply(b, OP.Effects.make('glue', 0.5, s.whiteMag || 0.6, hero.id, D.NORMAL))
      }
    },

    onPlace: function (sim, hero) { hero.data.whiteT = 0 }
  })

  /* ================================================================= *
   * 6. Emberspine Hedgehog — the late bloomer                         *
   * ================================================================= */

  /* Quill Burst: a ring of quills in every direction. The only thing this hero
     can do before it molts, and still useful after. */
  OP.ABILITIES['hero-emberspine-quill-burst'] = function (sim, hero) {
    const s = hero.s
    const n = Math.max(6, Math.round(s.burstCount || 18))
    for (let i = 0; i < n; i++) {
      OP.Projectiles.fireAt(sim, {
        x: hero.x, y: hero.y,
        kind: s.projKind || 'hero-emberspine-quill',
        damage: s.burstDamage || 3,
        dmgType: s.dmgType,
        pierce: 3,
        radius: 4,
        life: 0.8,
        maxRange: s.range * 1.3,
        ownerId: hero.id,
        camoDetect: true
      }, (i / n) * M.TAU, 430)
    }
  }

  /* Molt Storm: the spine-shedding blast. Big radius, shatter, and it leaves
     everything brittle. */
  OP.ABILITIES['hero-emberspine-molt-storm'] = function (sim, hero) {
    const s = hero.s
    const radius = s.range * 1.6
    OP.Damage.blast(sim, hero.x, hero.y, radius, {
      damage: s.stormDamage || 90,
      dmgType: D.SHATTER,
      sourceId: hero.id,
      effects: [OP.Effects.make('brittle', 5, 0.35, hero.id, D.NORMAL)]
    }, { camoDetect: true, maxTargets: 120 })
    sim.blastEvents.push({ x: hero.x, y: hero.y, radius: radius, kind: 'hero-emberspine-storm', hits: 0 })
  }

  OP.defineHero({
    key: 'emberspine-hedgehog',
    name: 'Emberspine Hedgehog',
    title: 'the Slow Fuse',
    blurb: 'READ THIS FIRST: it is deliberately feeble until level 12. One quill, no range, nothing clever. ' +
      'At 12 it molts — shatter quills, seven per shot, splitting on impact — and from there it is the strongest hero in the game. ' +
      'Take it when you have a board that can carry it for twelve rounds.',

    cost: 1000,
    footprint: 15,
    placement: 'land',

    base: {
      range: 105,
      cooldown: 1.50,
      damage: 1,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 330,
      projLife: 1.0,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'close', 'last', 'strong']
    },

    levels: [
      { level: 2, desc: '+6 range. (Still curled up.)', apply: function (s) { s.range += 6 } },
      { level: 3, desc: '+1 pierce (2 balloons per quill).', apply: function (s) { s.pierce += 1 } },
      { level: 4, desc: '5% faster attack.', apply: function (s) { s.cooldown *= 0.95 } },
      { level: 5, desc: '+1 damage (2 per quill).', apply: function (s) { s.damage += 1 } },
      { level: 6, desc: '+8 range.', apply: function (s) { s.range += 8 } },
      { level: 7, desc: '+1 pierce (3 balloons per quill).', apply: function (s) { s.pierce += 1 } },
      {
        level: 8,
        desc: 'Unlocks Quill Burst: 18 quills in every direction for 3 damage each. Its first real trick.',
        apply: function (s) {
          s.burstCount = 18
          s.burstDamage = 3
          s.ability = { name: 'Quill Burst', cooldown: 30, duration: 0, key: 'hero-emberspine-quill-burst' }
        }
      },
      { level: 9, desc: '6% faster attack.', apply: function (s) { s.cooldown *= 0.94 } },
      { level: 10, desc: '+1 damage (3 per quill).', apply: function (s) { s.damage += 1 } },
      { level: 11, desc: '+10 range, and it starts seeing Veiled balloons.', apply: function (s) { s.range += 10; s.camoDetect = true } },
      {
        level: 12,
        desc: 'THE MOLT: +8 damage, +4 pierce, three iron quills per shot 40% faster, and shatter damage that nothing resists.',
        apply: function (s) {
          s.molted = true
          s.damage += 8
          s.pierce += 4
          s.shots = 3
          s.spread = 0.40
          s.cooldown *= 0.60
          s.projSpeed *= 1.40
          s.dmgType = D.SHATTER
          s.projKind = 'hero-emberspine-ironquill'
        }
      },
      { level: 13, desc: '+5 damage (16 per quill).', apply: function (s) { s.damage += 5 } },
      {
        level: 14,
        desc: 'Quills split into two on impact, each fragment dealing 45% damage.',
        apply: function (s) { s.splitCount = 2; s.behaviour = 'hero-emberspine-quill-split' }
      },
      { level: 15, desc: 'Five quills per shot, and +20 range.', apply: function (s) { s.shots = 5; s.spread = 0.55; s.range += 20 } },
      {
        level: 16,
        desc: 'Unlocks Molt Storm: 90 shatter damage in a huge radius, plus 5 seconds of +35% damage taken.',
        apply: function (s) {
          s.stormDamage = 90
          s.ability2 = { name: 'Molt Storm', cooldown: 55, duration: 0, key: 'hero-emberspine-molt-storm' }
        }
      },
      { level: 17, desc: '+8 damage and +4 pierce.', apply: function (s) { s.damage += 8; s.pierce += 4 } },
      { level: 18, desc: '20% faster attack.', apply: function (s) { s.cooldown *= 0.80 } },
      { level: 19, desc: 'Seven quills per shot, splitting into three.', apply: function (s) { s.shots = 7; s.spread = 0.70; s.splitCount = 3 } },
      {
        level: 20,
        desc: '+14 damage, +8 pierce, Quill Burst becomes 40 quills, and it recharges twice as fast.',
        apply: function (s) {
          s.damage += 14
          s.pierce += 8
          s.burstCount = 40
          s.burstDamage = 20
          s.stormDamage = 240
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      volley(sim, hero, target, 'hero-emberspine-quill', s.splitCount > 0
        ? { data: { split: s.splitCount } }
        : null)
    }
  })

  /* ================================================================= *
   * 7. Cantor Wren — the rally hero                                   *
   * ================================================================= */

  /* Dawn Chorus: for a window, EVERY tower on the board gets stronger.
     The window is a number in hero.data, and `buffs()` below registers the global
     modifier only while that number is above zero. Marking sim.buffsDirty makes
     the next tower step re-resolve auras, which is also exactly what happens
     after a mid-round load — so the rally survives a save with no special case. */
  OP.ABILITIES['hero-cantor-dawn-chorus'] = function (sim, hero) {
    hero.data.rallyT = hero.s.rallyT || 8
    sim.buffsDirty = true
  }

  /* Second Verse: knocks seconds off every ability cooldown on the board. Nothing
     else in the game accelerates other towers' abilities. */
  OP.ABILITIES['hero-cantor-second-verse'] = function (sim, hero) {
    const cut = hero.s.verseCut || 10
    const list = sim.towers
    for (let i = 0; i < list.length; i++) {
      const tower = list[i]
      if (tower.abilityCd > 0) tower.abilityCd = Math.max(0, tower.abilityCd - cut)
      if (tower.id !== hero.id && tower.ability2Cd > 0) tower.ability2Cd = Math.max(0, tower.ability2Cd - cut)
    }
  }

  OP.defineHero({
    key: 'cantor-wren',
    name: 'Cantor Wren',
    title: 'the Rally Call',
    blurb: 'A small bird with a loud song. Dawn Chorus makes every tower on the board hit harder, reload faster and ' +
      'reach further for a window, and Second Verse hands ten seconds back to every ability you own. Purple balloons ignore its notes.',

    cost: 800,
    footprint: 13,
    placement: 'land',

    base: {
      range: 125,
      cooldown: 0.70,
      damage: 1,
      pierce: 2,
      dmgType: D.ENERGY,
      projSpeed: 450,
      projLife: 1.2,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    levels: [
      { level: 2, desc: '+1 pierce (3 balloons per note).', apply: function (s) { s.pierce += 1 } },
      { level: 3, desc: '+10 range.', apply: function (s) { s.range += 10 } },
      {
        level: 4,
        desc: 'Unlocks Dawn Chorus: 8 seconds of +1 damage and 15% faster attacks for every tower on the map.',
        apply: function (s) {
          s.rallyT = 8
          s.rallyDamage = 1
          s.rallyCooldownMul = 0.85
          s.ability = { name: 'Dawn Chorus', cooldown: 40, duration: 8, key: 'hero-cantor-dawn-chorus' }
        }
      },
      { level: 5, desc: '+1 damage (2 per note).', apply: function (s) { s.damage += 1 } },
      { level: 6, desc: 'The chorus runs 9 seconds and speeds towers up by 22%.', apply: function (s) { s.rallyT = 9; s.rallyCooldownMul = 0.78 } },
      { level: 7, desc: '10% faster attack and +10 range.', apply: function (s) { s.cooldown *= 0.90; s.range += 10 } },
      { level: 8, desc: 'The chorus grants +2 damage.', apply: function (s) { s.rallyDamage = 2 } },
      { level: 9, desc: '+1 damage and +1 pierce.', apply: function (s) { s.damage += 1; s.pierce += 1 } },
      { level: 10, desc: 'The chorus runs 10 seconds and grants +12% range.', apply: function (s) { s.rallyT = 10; s.rallyRangeMul = 1.12 } },
      { level: 11, desc: 'Sees through Veiled balloons.', apply: function (s) { s.camoDetect = true } },
      { level: 12, desc: 'The chorus grants +2 pierce as well.', apply: function (s) { s.rallyPierce = 2 } },
      { level: 13, desc: 'Sings two notes per shot.', apply: function (s) { s.shots = 2; s.spread = 0.16 } },
      { level: 14, desc: '+2 damage and 10% faster attack.', apply: function (s) { s.damage += 2; s.cooldown *= 0.90 } },
      {
        level: 15,
        desc: 'Unlocks Second Verse: takes 10 seconds off every ability cooldown on the board.',
        apply: function (s) {
          s.verseCut = 10
          s.ability2 = { name: 'Second Verse', cooldown: 75, duration: 0, key: 'hero-cantor-second-verse' }
        }
      },
      {
        level: 16,
        desc: 'The chorus grants +4 damage, and every tower sees Veiled balloons while it lasts.',
        apply: function (s) { s.rallyDamage = 4; s.rallyCamo = true }
      },
      { level: 17, desc: '+2 damage and 12% faster attack.', apply: function (s) { s.damage += 2; s.cooldown *= 0.88 } },
      { level: 18, desc: 'The chorus runs 12 seconds and speeds towers up by 35%.', apply: function (s) { s.rallyT = 12; s.rallyCooldownMul = 0.65 } },
      { level: 19, desc: '+3 damage, +2 pierce, 20% faster notes.', apply: function (s) { s.damage += 3; s.pierce += 2; s.projSpeed *= 1.2 } },
      {
        level: 20,
        desc: '+5 damage, the chorus grants +7 damage and +25% range, and Dawn Chorus recharges twice as fast.',
        apply: function (s) {
          s.damage += 5
          s.rallyDamage = 7
          s.rallyRangeMul = 1.25
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) { volley(sim, hero, target, 'hero-cantor-note', null) },

    update: function (sim, hero, dt) {
      // The window closing must re-resolve auras too, or the rally never ends.
      if (countdown(hero.data, 'rallyT', dt)) sim.buffsDirty = true
    },

    onPlace: function (sim, hero) { hero.data.rallyT = 0 },

    buffs: function (sim, hero) {
      if (!(hero.data.rallyT > 0)) return
      const s = hero.s                  // unbuffed: base + levels only
      const mods = {}
      if (s.rallyDamage > 0) mods.damageAdd = s.rallyDamage
      if (s.rallyPierce > 0) mods.pierceAdd = s.rallyPierce
      if (s.rallyCooldownMul > 0) mods.cooldownMul = s.rallyCooldownMul
      if (s.rallyRangeMul > 0) mods.rangeMul = s.rallyRangeMul
      if (s.rallyCamo) mods.camoDetect = true

      OP.Buffs.register(sim, {
        id: 'hero-cantor-rally:' + hero.id,
        sourceId: hero.id,
        radius: 'global',
        priority: 6,
        mods: mods
      })
    }
  })

  /* ================================================================= *
   * 8. Tinder Magpie — the support hero                               *
   * ================================================================= */

  /* Requisition: every tower on the board fires this instant, cooldown or not.
     A board-wide free volley, which is worth most exactly where a support hero
     wants to be — behind a wall of expensive towers. */
  OP.ABILITIES['hero-magpie-requisition'] = function (sim, hero) {
    const list = sim.towers
    for (let i = 0; i < list.length; i++) list[i].cooldown = 0
  }

  /* Salvage: hands lives back. Economy.gainLives honours rules.livesRegain, so
     PURIST turns this into nothing without this file having to know about PURIST. */
  OP.ABILITIES['hero-magpie-salvage'] = function (sim, hero) {
    OP.Economy.gainLives(sim, hero.s.salvageLives || 3)
  }

  OP.defineHero({
    key: 'tinder-magpie',
    name: 'Tinder Magpie',
    title: 'the Quartermaster',
    blurb: 'Its own tacks barely dent a balloon. Every level it gains is a permanent upgrade for every OTHER tower ' +
      'you own — damage, pierce, reload and projectile speed — reaching the whole map at level 17. It can also buy lives back.',

    cost: 900,
    footprint: 15,
    placement: 'land',

    base: {
      range: 160,
      cooldown: 1.60,
      damage: 1,
      pierce: 1,
      dmgType: D.NORMAL,
      projSpeed: 380,
      projLife: 1.4,
      projRadius: 3,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    levels: [
      { level: 2, desc: 'Every other tower in range gains +1 damage.', apply: function (s) { s.stockDamage = 1 } },
      { level: 3, desc: '+12 range — which is also +12 to the supply radius.', apply: function (s) { s.range += 12 } },
      { level: 4, desc: 'Supplied towers gain +1 pierce.', apply: function (s) { s.stockPierce = 1 } },
      { level: 5, desc: 'Supplied towers reload 8% faster.', apply: function (s) { s.stockCooldownMul = 0.92 } },
      {
        level: 6,
        desc: 'Unlocks Requisition: every tower on the map fires immediately, whatever its cooldown says.',
        apply: function (s) {
          s.ability = { name: 'Requisition', cooldown: 32, duration: 0, key: 'hero-magpie-requisition' }
        }
      },
      { level: 7, desc: '+14 range on the supply radius.', apply: function (s) { s.range += 14 } },
      { level: 8, desc: 'The damage handout rises to +2.', apply: function (s) { s.stockDamage = 2 } },
      { level: 9, desc: 'Supplied towers fire 15% faster projectiles.', apply: function (s) { s.stockProjSpeedMul = 1.15 } },
      { level: 10, desc: 'Supplied towers reload 14% faster.', apply: function (s) { s.stockCooldownMul = 0.86 } },
      { level: 11, desc: '+16 range, and +1 damage on its own tacks.', apply: function (s) { s.range += 16; s.damage += 1 } },
      { level: 12, desc: 'The pierce handout rises to +2.', apply: function (s) { s.stockPierce = 2 } },
      {
        level: 13,
        desc: 'Unlocks Salvage: buys back 3 lives. Nothing else in the roster can do that.',
        apply: function (s) {
          s.salvageLives = 3
          s.ability2 = { name: 'Salvage', cooldown: 120, duration: 0, key: 'hero-magpie-salvage' }
        }
      },
      { level: 14, desc: 'Supplied towers gain +12 range of their own.', apply: function (s) { s.stockRangeAdd = 12 } },
      { level: 15, desc: 'The damage handout rises to +3.', apply: function (s) { s.stockDamage = 3 } },
      { level: 16, desc: 'Supplied towers reload 20% faster.', apply: function (s) { s.stockCooldownMul = 0.80 } },
      { level: 17, desc: 'The supply line reaches every tower on the map, wherever it stands.', apply: function (s) { s.stockGlobal = true } },
      { level: 18, desc: 'The pierce handout rises to +3, and +1 damage on its own tacks.', apply: function (s) { s.stockPierce = 3; s.damage += 1 } },
      { level: 19, desc: '+5 damage handout and +20 range for supplied towers.', apply: function (s) { s.stockDamage = 5; s.stockRangeAdd = 20 } },
      {
        level: 20,
        desc: '+8 damage handout, 28% faster reloads, Salvage buys 8 lives, and Requisition recharges twice as fast.',
        apply: function (s) {
          s.stockDamage = 8
          s.stockCooldownMul = 0.72
          s.salvageLives = 8
          s.damage += 2
          if (s.ability) {
            s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
          }
        }
      }
    ],

    fire: function (sim, hero, target) { volley(sim, hero, target, 'hero-magpie-tack', null) },

    /* Flat adds and a cooldown multiplier, deliberately: Buffs.apply rounds a
       damageMul, so a percentage handout is invisible to exactly the cheap towers
       a support hero exists to lift. */
    buffs: function (sim, hero) {
      const s = hero.s                  // unbuffed: base + levels only
      const mods = {}
      let any = false
      if (s.stockDamage > 0) { mods.damageAdd = s.stockDamage; any = true }
      if (s.stockPierce > 0) { mods.pierceAdd = s.stockPierce; any = true }
      if (s.stockCooldownMul > 0) { mods.cooldownMul = s.stockCooldownMul; any = true }
      if (s.stockProjSpeedMul > 0) { mods.projSpeedMul = s.stockProjSpeedMul; any = true }
      if (s.stockRangeAdd > 0) { mods.rangeAdd = s.stockRangeAdd; any = true }
      if (!any) return

      OP.Buffs.register(sim, {
        id: 'hero-magpie-stock:' + hero.id,
        sourceId: hero.id,
        x: hero.x, y: hero.y,
        radius: s.stockGlobal ? 'global' : s.range,
        priority: 4,
        excludeSelf: true,          // the magpie keeps nothing for itself
        mods: mods
      })
    }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

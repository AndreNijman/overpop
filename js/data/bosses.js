;(function (OP) {
  'use strict'

  /* Boss Bloon definitions.

     Each boss has five tiers, escalating in HP. A boss event spawns the boss at
     round 40 (tier 1), then every 20 rounds (tier 2 at 60, tier 3 at 80,
     tier 4 at 100, tier 5 at 120). If the boss reaches the exit or is not
     killed before 20 rounds elapse, the player loses.

     Bosses have special properties: high HP, minion spawns, and unique abilities.
     They are NOT standard balloon tiers — they live in a parallel entity system
     (OP.Boss) because their lifecycle (spawn, health bar, timeout) differs from
     the layer-cascade model.

     Elite variants multiply HP and add speed/minion modifiers.

     Names and mechanics are original — no BTD6 boss names are used. */

  OP.BOSSES = {}

  /**
   * Boss definition.
   *   key          {string}   unique id
   *   name         {string}   display name
   *   blurb        {string}   flavour text
   *   colour       {string}   primary sprite colour
   *   shade        {string}   darker accent
   *   radius       {number}   collision radius at tier 1, scales up
   *   baseSpeed    {number}   movement speed multiplier (relative to BASE_SPEED)
   *   baseHP       {number}   HP at tier 1; each tier multiplies this
   *   tierScale    {number}   HP multiplier per tier (tier 2 = baseHP * tierScale, etc.)
   *   eliteHPMul   {number}   elite HP multiplier (applied after tier scaling)
   *   eliteSpeedMul{number}   elite speed multiplier
   *   slowResist   {number}   0-1, fraction of slow resisted
   *   stunImmune  {boolean}  cannot be stunned
   *   abilityImmune{boolean}  immune to instakill abilities
   *   minions      {Array}    minion spawn schedule: [{ round, tier, count, spacing }]
   *   ability      {object|null} boss-specific triggered ability
   *     key        {string}   ability key for the sim
   *     cooldown   {number}   seconds between triggers
   *     desc       {string}   description
   *   spawnsOnRound{number}   which round the tier 1 boss appears
   *   tierInterval {number}   rounds between tiers
   *   maxTiers     {number}   how many tiers (usually 5)
   */

  OP.BOSSES.elderWorm = {
    key: 'elder-worm',
    name: 'Elder Worm',
    analogue: 'Bloonarius the Summoner',
    analogueNote: 'same identity: spawns swarms of lesser bloons as it advances',
    blurb: 'A burrowing leviathan that surfaces every twenty rounds, spawning swarms of lesser worms as it advances.',
    colour: '#6b4a2e',
    shade: '#3d2a18',
    radius: 48,
    baseSpeed: 0.2,
    baseHP: 50000,
    tierScale: 4,
    eliteHPMul: 20,
    eliteSpeedMul: 1.3,
    slowResist: 0.6,
    stunImmune: true,
    abilityImmune: true,
    minions: [
      { tier: 'ceramic', count: 6, spacing: 1.0 },
      { tier: 'rainbow', count: 10, spacing: 0.5 },
      { tier: 'zebra', count: 15, spacing: 0.3 },
      { tier: 'lead', count: 20, spacing: 0.2 },
      { tier: 'ceramic', count: 25, spacing: 0.15 }
    ],
    ability: {
      key: 'elder-worm-summon',
      cooldown: 15,
      desc: 'Summons a wave of lesser worms from the ground.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  OP.BOSSES.stormDrake = {
    key: 'storm-drake',
    name: 'Storm Drake',
    analogue: 'Vortex: Deadly Master of Air',
    analogueNote: 'same identity: disables towers and speeds the assault up',
    blurb: 'A winged terror that cloaks itself in lightning, shocking towers in range and summoning gales to speed its spawn.',
    colour: '#4a6fa5',
    shade: '#2a4060',
    radius: 44,
    baseSpeed: 0.4,
    baseHP: 40000,
    tierScale: 4.5,
    eliteHPMul: 18,
    eliteSpeedMul: 1.25,
    slowResist: 0.5,
    stunImmune: true,
    abilityImmune: true,
    minions: [
      { tier: 'goliath', count: 2, spacing: 3 },
      { tier: 'ceramic', count: 8, spacing: 0.8 },
      { tier: 'rainbow', count: 12, spacing: 0.4 },
      { tier: 'ceramic', count: 15, spacing: 0.5 },
      { tier: 'goliath', count: 4, spacing: 2 }
    ],
    ability: {
      key: 'storm-drake-shock',
      cooldown: 12,
      desc: 'Lightning strike disables the nearest tower for 3 seconds.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  OP.BOSSES.voidMaw = {
    key: 'void-maw',
    name: 'Void Maw',
    analogue: 'Phayze',
    analogueNote: 'same identity: reality-warping presence that weakens tower sight',
    blurb: 'A rift in the track itself, consuming everything it touches. Its presence warps reality, making towers less effective.',
    colour: '#2a1a3e',
    shade: '#150d22',
    radius: 52,
    baseSpeed: 0.15,
    baseHP: 80000,
    tierScale: 3.5,
    eliteHPMul: 25,
    eliteSpeedMul: 1.2,
    slowResist: 0.7,
    stunImmune: true,
    abilityImmune: true,
    minions: [
      { tier: 'wraith', count: 3, spacing: 2 },
      { tier: 'goliath', count: 4, spacing: 2 },
      { tier: 'ceramic', count: 20, spacing: 0.2 },
      { tier: 'wraith', count: 6, spacing: 1.5 },
      { tier: 'goliath', count: 8, spacing: 1.5 }
    ],
    ability: {
      key: 'void-maw-warp',
      cooldown: 20,
      desc: 'Reduces range of all towers within 150 units by 30% for 5 seconds.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  /* ---------- lookup ---------- */

  OP.bossByKey = function (key) {
    for (const k in OP.BOSSES) {
      if (OP.BOSSES[k].key === key) return OP.BOSSES[k]
    }
    return null
  }

  /* ---------- weekly event rotation ----------

     The Boss Event features one boss per week, cycling through the roster in a
     fixed order — the same "which boss is on the poster this week" idea BTD6
     runs. The order is explicit (rather than derived from insertion) so it is a
     single, reviewable sentence, and it is deep-frozen with the rest of the
     registry. The rotation arithmetic lives in OP.BossEvent (js/core/bossevent.js),
     which reads this order lazily at call time. */

  OP.BOSS_ORDER = ['elder-worm', 'storm-drake', 'void-maw', 'cinder-toad', 'gloom-warden', 'ridge-colossus']

  OP.BOSSES.cinderToad = {
    key: 'cinder-toad',
    name: 'Cinder Toad',
    analogue: 'Bloonarius the Summoner (ember aspect)',
    analogueNote: 'shares Bloonarius summon identity with Elder Worm; hatches armoured broods in flight',
    blurb: 'A bloated ember-beast that hatches broods of burning balloons as it crawls. Kill the spawn fast or drown in them.',
    colour: '#8a3b1e',
    shade: '#4a1f0e',
    radius: 50,
    baseSpeed: 0.13,
    baseHP: 90000,
    tierScale: 3.4,
    eliteHPMul: 22,
    eliteSpeedMul: 1.15,
    slowResist: 0.5,
    stunImmune: false,
    abilityImmune: false,
    minions: [
      { tier: 'ceramic', count: 10, spacing: 0.3 },
      { tier: 'rainbow', count: 16, spacing: 0.25 },
      { tier: 'ceramic', count: 14, spacing: 0.25 },
      { tier: 'leviathan', count: 2, spacing: 3 },
      { tier: 'ceramic', count: 18, spacing: 0.2 }
    ],
    ability: {
      key: 'cinder-toad-bloom',
      cooldown: 24,
      desc: 'Spits a bloom of burning balloons onto the track behind it.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  OP.BOSSES.gloomWarden = {
    key: 'gloom-warden',
    name: 'Gloom Warden',
    analogue: 'Lych',
    analogueNote: 'same identity: drains the board to knit its own hull back on',
    blurb: 'It does not attack — it feeds. Every balloon it drains in passing knits hull back onto itself.',
    colour: '#1e3d2f',
    shade: '#0f2018',
    radius: 55,
    baseSpeed: 0.11,
    baseHP: 110000,
    tierScale: 3.2,
    eliteHPMul: 24,
    eliteSpeedMul: 1.1,
    slowResist: 0.6,
    stunImmune: false,
    abilityImmune: true,
    minions: [
      { tier: 'zebra', count: 20, spacing: 0.3 },
      { tier: 'ceramic', count: 8, spacing: 0.5 },
      { tier: 'goliath', count: 4, spacing: 2 },
      { tier: 'ceramic', count: 12, spacing: 0.3 },
      { tier: 'wraith', count: 4, spacing: 2 }
    ],
    ability: {
      key: 'gloom-warden-drain',
      cooldown: 18,
      desc: 'Drains every balloon near it, healing itself for what it takes.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  OP.BOSSES.ridgeColossus = {
    key: 'ridge-colossus',
    name: 'Ridge Colossus',
    analogue: 'Dreadbloon: Armored Behemoth',
    analogueNote: 'same identity: armoured shell, slow-resistant, punishes unprepared boards',
    blurb: 'A walking quarry. Its shell shrugs off slow effects, and when it moves it MOVES.',
    colour: '#3f3a2e',
    shade: '#221f18',
    radius: 58,
    baseSpeed: 0.09,
    baseHP: 130000,
    tierScale: 3.0,
    eliteHPMul: 26,
    eliteSpeedMul: 1.25,
    slowResist: 0.8,
    stunImmune: true,
    abilityImmune: true,
    minions: [
      { tier: 'goliath', count: 2, spacing: 3 },
      { tier: 'ceramic', count: 16, spacing: 0.25 },
      { tier: 'leviathan', count: 1, spacing: 3 },
      { tier: 'goliath', count: 6, spacing: 1.5 },
      { tier: 'colossus', count: 1, spacing: 3 }
    ],
    ability: {
      key: 'ridge-colossus-haste',
      cooldown: 26,
      desc: 'Quakes into a lumbering sprint — nearly twice as fast for three seconds.'
    },
    spawnsOnRound: 40,
    tierInterval: 20,
    maxTiers: 5
  }

  /** The boss keys in weekly rotation order. */
  OP.bossOrder = function () {
    return OP.BOSS_ORDER.slice()
  }

  /** The full boss roster as an array of definitions, in rotation order. */
  OP.bossRoster = function () {
    const out = []
    for (const key of OP.BOSS_ORDER) {
      const def = OP.bossByKey(key)
      if (def) out.push(def)
    }
    return out
  }

  /** HP of a boss at a given tier, elite or normal. */
  OP.bossHP = function (boss, tier, elite) {
    let hp = boss.baseHP
    for (let i = 1; i < tier; i++) hp *= boss.tierScale
    if (elite) hp *= boss.eliteHPMul
    return Math.round(hp)
  }

  /** Speed of a boss at a given tier, elite or normal. */
  OP.bossSpeed = function (boss, tier, elite) {
    let speed = boss.baseSpeed
    if (elite) speed *= boss.eliteSpeedMul
    return speed
  }

  /** Radius of a boss at a given tier. */
  OP.bossRadius = function (boss, tier) {
    return boss.radius + (tier - 1) * 6
  }

  /** The boss ability for a given tier (tier 1-2 = none, 3+ = active). */
  OP.bossAbility = function (boss, tier) {
    if (!boss.ability || tier < 3) return null
    return boss.ability
  }

  /** Minion schedule for a given tier. */
  OP.bossMinions = function (boss, tier) {
    const idx = tier - 1
    if (idx < 0 || idx >= boss.minions.length) return null
    return boss.minions[idx]
  }

  /* ---------- immutability ---------- */

  function deepFreeze (obj) {
    Object.freeze(obj)
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
    }
    return obj
  }

  deepFreeze(OP.BOSSES)
  Object.freeze(OP.BOSS_ORDER)
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

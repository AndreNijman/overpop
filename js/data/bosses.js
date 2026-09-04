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

  OP.BOSS_ORDER = ['elder-worm', 'storm-drake', 'void-maw']

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

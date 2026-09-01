;(function (OP) {
  'use strict'

  /* Trial definitions.

     A trial is a curated challenge scenario with unique starting rules,
     constraints, and goals. Unlike expeditions (which chain standard maps)
     or daily challenges (which are generated), trials are hand-crafted
     with specific tower selections, balloon mixes, and win conditions. */

  var Trials = {}

  /* ---------- definitions ---------- */

  var TRIAL_DEFS = [
    {
      key: 'sniper-only',
      name: 'Marksman',
      desc: 'Only sniper towers. No selling, no abilities. Can you hold the line with precision alone?',
      difficulty: 'hard',
      mode: 'standard',
      mapKey: 'twinbrook-fork',
      rules: { allowSell: false, allowAbilities: false, startCash: 1200 },
      towerFilter: ['sniper'],
      goal: 'Clear round 40',
      goalRound: 40
    },
    {
      key: 'hedge-maze',
      name: 'Hedge Maze',
      desc: 'Dense forest, tight paths. Only magic towers allowed. The trees whisper danger.',
      difficulty: 'medium',
      mode: 'standard',
      mapKey: 'knotwood-crossing',
      rules: { allowSell: true, allowAbilities: true, startCash: 800 },
      towerFilter: ['magic'],
      goal: 'Clear round 50',
      goalRound: 50
    },
    {
      key: 'iron-will',
      name: 'Iron Will',
      desc: 'No continues, no selling, no income. One life. Every decision matters.',
      difficulty: 'hard',
      mode: 'purist',
      mapKey: 'fernway-hollow',
      rules: { allowSell: false, allowAbilities: true, startCash: 1500, lives: 1 },
      goal: 'Clear round 60',
      goalRound: 60
    },
    {
      key: 'speed-demon',
      name: 'Speed Demon',
      desc: 'Forced autostart, double speed. The balloons never stop coming.',
      difficulty: 'medium',
      mode: 'rush-trial',
      mapKey: 'windrow-fields',
      rules: { allowSell: true, allowAbilities: true, startCash: 1000 },
      goal: 'Clear all 60 rounds as fast as possible',
      goalRound: 60
    },
    {
      key: 'swarm-defense',
      name: 'Swarm Defense',
      desc: 'Massive balloon rushes every round. Primary towers only. Hold the swarm at bay.',
      difficulty: 'hard',
      mode: 'standard',
      mapKey: 'harebell-dash',
      rules: { allowSell: true, allowAbilities: false, startCash: 2000, balloonSpacing: 0.15 },
      towerFilter: ['primary'],
      goal: 'Clear round 45',
      goalRound: 45
    },
    {
      key: 'glass-cannon',
      name: 'Glass Cannon',
      desc: 'Towers cost half but you have only one life. One leak and it is over.',
      difficulty: 'hard',
      mode: 'standard',
      mapKey: 'dewdrop-lane',
      rules: { allowSell: true, allowAbilities: true, startCash: 1000, lives: 1, towerCostMul: 0.5 },
      goal: 'Clear round 55',
      goalRound: 55
    },
    {
      key: 'bloonarius-trial',
      name: 'Titan Slayer',
      desc: 'Face a boss balloon at round 30 with limited resources. Prepare your defenses.',
      difficulty: 'hard',
      mode: 'boss-event',
      mapKey: 'clover-commons',
      rules: { allowSell: true, allowAbilities: true, startCash: 2500 },
      goal: 'Defeat the boss balloon',
      goalRound: 35
    },
    {
      key: 'military-operation',
      name: 'Military Operation',
      desc: 'Military towers only. Helicopters, submarines, and artillery. The full arsenal.',
      difficulty: 'medium',
      mode: 'standard',
      mapKey: 'mossy-creek',
      rules: { allowSell: true, allowAbilities: true, startCash: 1500 },
      towerFilter: ['military'],
      goal: 'Clear round 50',
      goalRound: 50
    }
  ]

  /* ---------- lookup ---------- */

  /**
   * Get a trial definition by key.
   */
  Trials.get = function (key) {
    for (var i = 0; i < TRIAL_DEFS.length; i++) {
      if (TRIAL_DEFS[i].key === key) return TRIAL_DEFS[i]
    }
    return null
  }

  /**
   * All trial definitions.
   */
  Trials.all = function () { return TRIAL_DEFS }

  /**
   * All trial keys.
   */
  Trials.keys = function () {
    return TRIAL_DEFS.map(function (t) { return t.key })
  }

  /**
   * The number of defined trials.
   */
  Trials.count = function () { return TRIAL_DEFS.length }

  /* ---------- helpers ---------- */

  /**
   * Check if a tower key is allowed in a trial.
   */
  Trials.isTowerAllowed = function (trialKey, towerKey) {
    var def = Trials.get(trialKey)
    if (!def) return true
    if (!def.towerFilter || def.towerFilter.length === 0) return true
    var towerDef = OP.TOWERS && OP.TOWERS[towerKey]
    if (!towerDef) return false
    for (var i = 0; i < def.towerFilter.length; i++) {
      if (towerDef.family === def.towerFilter[i]) return true
    }
    return false
  }

  /**
   * Get the goal description for a trial.
   */
  Trials.goalDescription = function (trialKey) {
    var def = Trials.get(trialKey)
    return def ? def.goal : null
  }

  /* ---------- deep freeze ---------- */

  function deepFreeze (obj) {
    Object.freeze(obj)
    for (var k = 0; k < Object.keys(obj).length; k++) {
      var v = obj[Object.keys(obj)[k]]
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
    }
    return obj
  }

  deepFreeze(TRIAL_DEFS)

  OP.Trials = Trials
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

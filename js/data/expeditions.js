;(function (OP) {
  'use strict'

  /* Expedition definitions.

     An expedition is a series of maps played in sequence with shared rules.
     Lives and cash carry over between maps, plus a completion bonus. The
     expedition state is saved in the profile so a run can be resumed later. */

  var Expeditions = {}

  /* ---------- definitions ---------- */

  var EXPEDITION_DEFS = [
    {
      key: 'verdant-pass',
      name: 'Verdant Pass',
      desc: 'A gentle march through beginner woodlands. Three short maps to ease you in.',
      difficulty: 'easy',
      mode: 'standard',
      maps: [
        { key: 'fernway-hollow', bonusCash: 300, bonusLives: 5 },
        { key: 'clover-commons', bonusCash: 400, bonusLives: 5 },
        { key: 'windrow-fields', bonusCash: 500, bonusLives: 10 }
      ]
    },
    {
      key: 'iron-circuit',
      name: 'Iron Circuit',
      desc: 'Intermediate maps with tighter paths and tougher waves. Manage your cash wisely.',
      difficulty: 'medium',
      mode: 'standard',
      maps: [
        { key: 'twinbrook-fork', bonusCash: 400, bonusLives: 5 },
        { key: 'knotwood-crossing', bonusCash: 500, bonusLives: 5 },
        { key: 'kettle-hollow', bonusCash: 600, bonusLives: 10 }
      ]
    },
    {
      key: 'frost-route',
      name: 'Frost Route',
      desc: 'Hard mode across three maps. Every life counts when the cold sets in.',
      difficulty: 'hard',
      mode: 'standard',
      maps: [
        { key: 'whisper-glade', bonusCash: 500, bonusLives: 3 },
        { key: 'dewdrop-lane', bonusCash: 600, bonusLives: 5 },
        { key: 'sunlit-glade', bonusCash: 700, bonusLives: 5 }
      ]
    },
    {
      key: 'shadow-trail',
      name: 'Shadow Trail',
      desc: 'Alternate Waves through beginner terrain. The unpredictable keeps you sharp.',
      difficulty: 'easy',
      mode: 'alternate-waves',
      maps: [
        { key: 'harebell-dash', bonusCash: 400, bonusLives: 5 },
        { key: 'mossy-creek', bonusCash: 500, bonusLives: 5 },
        { key: 'birch-straight', bonusCash: 600, bonusLives: 10 }
      ]
    },
    {
      key: 'double-time',
      name: 'Double Time',
      desc: 'Half Cash, three maps, no room for waste. Stretch every dollar.',
      difficulty: 'medium',
      mode: 'half-cash',
      maps: [
        { key: 'millrace-bend', bonusCash: 600, bonusLives: 5 },
        { key: 'split-oak-pass', bonusCash: 700, bonusLives: 5 },
        { key: 'stump-circle', bonusCash: 800, bonusLives: 10 }
      ]
    }
  ]

  /* ---------- lookup ---------- */

  /**
   * Get an expedition definition by key.
   */
  Expeditions.get = function (key) {
    for (var i = 0; i < EXPEDITION_DEFS.length; i++) {
      if (EXPEDITION_DEFS[i].key === key) return EXPEDITION_DEFS[i]
    }
    return null
  }

  /**
   * All expedition definitions.
   */
  Expeditions.all = function () { return EXPEDITION_DEFS }

  /**
   * All expedition keys.
   */
  Expeditions.keys = function () {
    return EXPEDITION_DEFS.map(function (e) { return e.key })
  }

  /**
   * The number of defined expeditions.
   */
  Expeditions.count = function () { return EXPEDITION_DEFS.length }

  /* ---------- helpers ---------- */

  /**
   * Get the map key for a specific stage in an expedition.
   */
  Expeditions.mapKey = function (expeditionKey, stageIndex) {
    var def = Expeditions.get(expeditionKey)
    if (!def || stageIndex < 0 || stageIndex >= def.maps.length) return null
    return def.maps[stageIndex].key
  }

  /**
   * Get the bonus for completing a specific stage.
   */
  Expeditions.bonus = function (expeditionKey, stageIndex) {
    var def = Expeditions.get(expeditionKey)
    if (!def || stageIndex < 0 || stageIndex >= def.maps.length) return null
    return def.maps[stageIndex]
  }

  /**
   * Total maps in an expedition.
   */
  Expeditions.length = function (expeditionKey) {
    var def = Expeditions.get(expeditionKey)
    return def ? def.maps.length : 0
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

  deepFreeze(EXPEDITION_DEFS)

  OP.Expeditions = Expeditions
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

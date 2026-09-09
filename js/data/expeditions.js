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
    },

    /* ---------- VOYAGES — the odyssey-shaped campaigns ----------
       Five legs, escalating restrictions. The restriction ladder lives in the
       per-leg `mode` override (Expedition.currentMode prefers it), so the
       engine, not the data, enforces every leg's rules. Cash and lives carry
       between legs exactly like an expedition. */
    {
      key: 'voyage-driftwood',
      name: 'Voyage: Driftwood',
      desc: 'Five beginner legs that tighten as they go. Carry your purse and your lives the whole way.',
      difficulty: 'easy',
      mode: 'standard',
      maps: [
        { key: 'fernway-hollow', bonusCash: 300, bonusLives: 4 },
        { key: 'clover-commons', bonusCash: 350, bonusLives: 4, mode: 'primary-only' },
        { key: 'harebell-dash', bonusCash: 400, bonusLives: 4, mode: 'alternate-waves' },
        { key: 'mossy-creek', bonusCash: 450, bonusLives: 4, mode: 'reverse' },
        { key: 'birch-straight', bonusCash: 600, bonusLives: 6, mode: 'half-cash' }
      ]
    },
    {
      key: 'voyage-triangle',
      name: 'Voyage: Broken Triangle',
      desc: 'Five intermediate legs. The middle of the run gets hostile: only magic, then nothing but luck.',
      difficulty: 'medium',
      mode: 'standard',
      maps: [
        { key: 'twinbrook-fork', bonusCash: 400, bonusLives: 3 },
        { key: 'knotwood-crossing', bonusCash: 450, bonusLives: 3, mode: 'magic-only' },
        { key: 'kettle-hollow', bonusCash: 500, bonusLives: 3, mode: 'half-cash' },
        { key: 'millrace-bend', bonusCash: 500, bonusLives: 3, mode: 'alternate-waves' },
        { key: 'split-oak-pass', bonusCash: 700, bonusLives: 5, mode: 'purist' }
      ]
    },
    {
      key: 'voyage-northreach',
      name: 'Voyage: Northreach',
      desc: 'Five hard legs for a veteran board. Every restriction the roster has, in one campaign.',
      difficulty: 'hard',
      mode: 'standard',
      maps: [
        { key: 'whisper-glade', bonusCash: 400, bonusLives: 2 },
        { key: 'dewdrop-lane', bonusCash: 450, bonusLives: 2, mode: 'military-only' },
        { key: 'sunlit-glade', bonusCash: 500, bonusLives: 2, mode: 'alternate-waves' },
        { key: 'bogwood-crossing', bonusCash: 500, bonusLives: 2, mode: 'double-hp-blimps' },
        { key: 'stump-circle', bonusCash: 800, bonusLives: 4, mode: 'purist' }
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

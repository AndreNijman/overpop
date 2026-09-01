;(function (OP) {
  'use strict'

  /* Daily Challenge generation.

     A daily challenge is a deterministic combination of map, difficulty, mode and
     optional modifiers, derived from a date string. The same date always produces
     the same challenge, so every player faces identical conditions. The RNG is
     seeded from the date, not from real time — replays of a past daily are
     possible but the score is already recorded. */

  var Daily = {}

  /* ---------- date helpers ---------- */

  /**
   * Format a Date object as 'YYYY-MM-DD' in local time.
   * Avoids toISOString() which gives UTC and can shift the day.
   */
  Daily.dateKey = function (d) {
    var y = d.getFullYear()
    var m = d.getMonth() + 1
    var day = d.getDate()
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day
  }

  /**
   * Today's date key in local time. Separated from Daily.seed() so tests can
   * override the date without touching Date.now.
   */
  Daily.todayKey = function () { return Daily.dateKey(new Date()) }

  /**
   * The seed string for a given date key. Always deterministic.
   */
  Daily.seed = function (dateKey) { return 'daily-' + dateKey }

  /* ---------- generation pools ---------- */

  var DIFF_POOL = ['easy', 'medium', 'medium', 'hard', 'hard', 'hard', 'relentless']

  var MODE_POOL = [
    'standard', 'standard', 'standard',
    'primary-only', 'military-only', 'magic-only',
    'deflation', 'half-cash', 'double-hp-blimps',
    'alternate-waves', 'reverse', 'onslaught'
  ]

  var MODIFIERS = [
    {
      key: 'bonus-cash',
      name: 'Bonus Cash',
      desc: 'Start with extra cash.',
      rules: { startCash: 2500 }
    },
    {
      key: 'reduced-lives',
      name: 'Reduced Lives',
      desc: 'Only one life to spare.',
      rules: { startLives: 1 }
    },
    {
      key: 'fast-balloons',
      name: 'Speed Burst',
      desc: 'Balloons move faster.',
      rules: { speedScale: 1.2 }
    },
    {
      key: 'limited-towers',
      name: 'Limited Arsenal',
      desc: 'Only two tower families allowed.',
      family: true
    },
    {
      key: 'tough-blimps',
      name: 'Tough Blimps',
      desc: 'Blimps have extra health.',
      rules: { blimpHpMul: 1.5 }
    }
  ]

  /* ---------- modifiers ---------- */

  var FAMILIES = ['primary', 'military', 'magic', 'support']

  /**
   * Pick two distinct families for the limited-towers modifier.
   * The selection is seeded from the RNG so it is deterministic for a given day.
   */
  function pickFamilies (rng) {
    var copy = FAMILIES.slice()
    rng.shuffle(copy)
    return copy.slice(0, 2)
  }

  /**
   * Resolve modifier objects into a config delta and a readable list.
   * Returns { rules: {...}, labels: [{key, name}] }.
   */
  function resolveModifiers (rng, modeKey) {
    var count = rng.chance(0.4) ? 0 : (rng.chance(0.6) ? 1 : 2)
    var chosen = []
    var pool = MODIFIERS.slice()

    for (var i = 0; i < count && pool.length > 0; i++) {
      var idx = rng.int(pool.length)
      var mod = pool[idx]
      pool.splice(idx, 1)

      // Skip family-only modifier when the mode already restricts families
      if (mod.family && modeKey.indexOf('-only') >= 0) continue

      chosen.push(mod)
    }

    var rules = {}
    var labels = []
    var families = null

    for (var j = 0; j < chosen.length; j++) {
      var m = chosen[j]
      if (m.family) {
        families = pickFamilies(rng)
        labels.push({ key: m.key, name: m.name, detail: families.join(' & ') })
      } else {
        // Copy rule fields, but skip startLives if mode already sets it to 1
        var r = m.rules || {}
        for (var k in r) {
          if (!Object.prototype.hasOwnProperty.call(r, k)) continue
          if (k === 'startLives' && r[k] <= 1) continue
          rules[k] = r[k]
        }
        labels.push({ key: m.key, name: m.name })
      }
    }

    return { rules: rules, labels: labels, families: families }
  }

  /* ---------- map selection ---------- */

  /**
   * Pick a map from the available maps. Prefer intermediate/advanced for
   * variety but allow any tier. The selection is seeded from the RNG.
   */
  function pickMap (rng) {
    var keys = OP.MAP_ORDER || []
    if (keys.length === 0) return null

    // Weight intermediate and advanced maps higher for variety
    var weighted = []
    for (var i = 0; i < keys.length; i++) {
      var def = OP.MAPS[keys[i]]
      if (!def) continue
      var w = 1
      if (def.tier === 'intermediate') w = 3
      else if (def.tier === 'advanced') w = 3
      else if (def.tier === 'expert') w = 2
      for (var j = 0; j < w; j++) weighted.push(keys[i])
    }

    if (weighted.length === 0) return keys[rng.int(keys.length)]
    return weighted[rng.int(weighted.length)]
  }

  /* ---------- main generation ---------- */

  /**
   * Generate a daily challenge for the given date key.
   *
   * @param {string} dateKey  'YYYY-MM-DD'
   * @returns {object|null} the challenge definition, or null if maps are missing
   */
  Daily.generate = function (dateKey) {
    if (!OP.MAP_ORDER || OP.MAP_ORDER.length === 0) return null

    var rng = new OP.RNG(Daily.seed(dateKey))

    var mapKey = pickMap(rng)
    var difficulty = DIFF_POOL[rng.int(DIFF_POOL.length)]
    var modeKey = MODE_POOL[rng.int(MODE_POOL.length)]
    var mod = resolveModifiers(rng, modeKey)

    // Apply family restriction via rules if the modifier selected it
    var extraRules = {}
    for (var k in mod.rules) {
      if (Object.prototype.hasOwnProperty.call(mod.rules, k)) extraRules[k] = mod.rules[k]
    }
    if (mod.families) extraRules.families = mod.families

    // Build a readable description
    var mapDef = OP.MAPS[mapKey]
    var mapName = mapDef ? mapDef.name : mapKey
    var diffName = difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
    var modeName = ''
    var modeDef = OP.MODES && OP.MODES[modeKey]
    if (modeDef) modeName = modeDef.name
    else modeName = modeKey.split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1) }).join(' ')

    var desc = diffName + ' ' + modeName + ' on ' + mapName
    if (mod.labels.length > 0) {
      desc += ' (' + mod.labels.map(function (l) { return l.name }).join(', ') + ')'
    }

    // End of day timestamp (midnight next day)
    var parts = dateKey.split('-')
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
    var endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()

    return {
      dateKey: dateKey,
      seed: Daily.seed(dateKey),
      mapKey: mapKey,
      mapName: mapName,
      difficulty: difficulty,
      mode: modeKey,
      modifiers: mod.labels,
      rules: extraRules,
      families: mod.families,
      description: desc,
      endTime: endOfDay
    }
  }

  /**
   * Generate the current daily challenge (today).
   * Convenience wrapper around Daily.generate.
   */
  Daily.today = function () {
    return Daily.generate(Daily.todayKey())
  }

  OP.Daily = Daily
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

;(function (OP) {
  'use strict'

  /* Race mode state management.

     Rush Trial is a speed challenge: rounds auto-start immediately, the timer
     is the score, and best times are tracked per map/difficulty. The sim.time
     field already ticks every DT, so we use it as the race clock — no separate
     timer needed. */

  var Race = {}

  /**
   * True when the current sim is a Rush Trial run.
   */
  Race.isActive = function (sim) {
    return sim && sim.mode === 'rush-trial'
  }

  /**
   * Force autostart for Rush Trial mode. Called from App.startGame after
   * Sim.create, so the mode's autostart override takes effect regardless of
   * the player's saved setting.
   */
  Race.applyForcedAutostart = function (sim) {
    if (Race.isActive(sim)) sim.autostart = true
  }

  /**
   * The elapsed race time in seconds, from the sim clock.
   * Returns 0 when no sim is active.
   */
  Race.elapsed = function (sim) {
    if (!sim || !sim.time) return 0
    return sim.time
  }

  /**
   * Format seconds as M:SS.ss for display.
   * @param {number} seconds
   * @returns {string}
   */
  Race.formatTime = function (seconds) {
    if (!(seconds > 0) || !isFinite(seconds)) return '—'
    var mins = Math.floor(seconds / 60)
    var secs = seconds - mins * 60
    var s = String(secs.toFixed(2))
    // Ensure at least M:SS.xx format
    if (s.indexOf('.') < 0) s = s + '.00'
    if (secs < 10) s = '0' + s
    return mins + ':' + s
  }

  /* ---------- profile integration ---------- */

  /**
   * Read the race best times from a profile.
   * Structure: { mapKey: { difficulty: { won, time, pops, cash } } }
   */
  Race.bestTimes = function (profile) {
    if (!profile || typeof profile.raceBests !== 'object' || profile.raceBests === null) return {}
    return profile.raceBests
  }

  /**
   * Get the best time for a specific map and difficulty.
   * @returns {object|null} { won, time, pops, cash } or null
   */
  Race.bestFor = function (profile, mapKey, difficulty) {
    var all = Race.bestTimes(profile)
    if (!all[mapKey] || !all[mapKey][difficulty]) return null
    return all[mapKey][difficulty]
  }

  /**
   * True when this map/difficulty has been completed in Rush Trial.
   */
  Race.isDone = function (profile, mapKey, difficulty) {
    var best = Race.bestFor(profile, mapKey, difficulty)
    return !!(best && best.won)
  }

  /**
   * Record a race result. Only updates if the new time is better (lower)
   * or the new result is a win and the old one was a loss.
   *
   * @param {object} profile   the player profile (mutated in place)
   * @param {string} mapKey
   * @param {string} difficulty
   * @param {object} result    { won, time, pops, cash }
   * @param {object} [rng]     a seeded RNG for the draft lottery (tests)
   * @returns {object} the updated profile
   */
  Race.record = function (profile, mapKey, difficulty, result, rng) {
    if (!profile || !mapKey || !difficulty || !result) return profile
    if (typeof profile.raceBests !== 'object' || profile.raceBests === null) profile.raceBests = {}

    if (!profile.raceBests[mapKey]) profile.raceBests[mapKey] = {}

    var prev = profile.raceBests[mapKey][difficulty]
    var entry = {
      won: !!result.won,
      time: result.time || 0,
      pops: result.pops || 0,
      cash: result.cash || 0
    }

    // If previous exists, keep the better result
    if (prev && typeof prev === 'object') {
      // A win is always better than a loss
      if (entry.won && !prev.won) {
        // New win replaces old loss — keep the entry as-is
      } else if (!entry.won && prev.won) {
        // New loss, old win — keep the win
        entry = prev
      } else if (entry.won && prev.won) {
        // Both wins — keep the faster time
        if (prev.time > 0 && (entry.time <= 0 || prev.time < entry.time)) {
          entry = prev
        }
      } else {
        // Both losses — keep higher pops
        if (prev.pops > entry.pops) entry = prev
      }
    }

    profile.raceBests[mapKey][difficulty] = entry

    // A first beat that sets a WINNING best earns a Draft Token; nothing that
    // merely matches or loses does. `entry !== prev` is true exactly when this
    // attempt actually replaced the stored record.
    if (entry.won && prev !== entry && OP.Drafts && OP.Drafts.grantRandom) {
      OP.Drafts.grantRandom(profile, rng)
    }

    return profile
  }

  /**
   * Build a result object from a finished sim, suitable for Race.record().
   */
  Race.resultFromSim = function (sim, won) {
    return {
      won: !!won,
      time: sim ? sim.time || 0 : 0,
      pops: sim && sim.stats ? sim.stats.popped : 0,
      cash: sim && sim.stats ? sim.stats.cashEarned : 0
    }
  }

  /**
   * Build a summary for the race info panel.
   */
  Race.summary = function (profile, mapKey, difficulty) {
    var best = Race.bestFor(profile, mapKey, difficulty)
    return {
      best: best,
      done: !!(best && best.won),
      bestTime: best && best.time ? Race.formatTime(best.time) : null
    }
  }

  OP.Race = Race
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

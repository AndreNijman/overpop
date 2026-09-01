;(function (OP) {
  'use strict'

  /* Daily Challenge state management.

     Manages the active daily challenge, profile integration, scoring, and
     streak tracking. Works with OP.Daily (generation) and OP.Save (persistence). */

  var DailyCore = {}

  /* ---------- active challenge state ---------- */

  var activeChallenge = null
  var challengeCompleted = false

  /**
   * Start a daily challenge. Stores the challenge definition so the result
   * screen can look it up.
   * @param {object} challenge  from OP.Daily.generate()
   */
  DailyCore.start = function (challenge) {
    activeChallenge = challenge
    challengeCompleted = false
  }

  /**
   * @returns {object|null} the currently active daily challenge, if any.
   */
  DailyCore.active = function () { return activeChallenge }

  /**
   * Mark the current daily challenge as completed.
   *
   * Completion also deactivates the challenge: recording is gated on
   * `DailyCore.active()`, so a run that goes on to end again — a won challenge
   * continued into freeplay, whose second game-over re-enters the same
   * onGameOver block — must not re-record the day's result with freeplay-inflated
   * stats. The menu already falls back to OP.Daily.today() when active() is null.
   */
  DailyCore.complete = function () {
    challengeCompleted = true
    activeChallenge = null
  }

  /**
   * True when a daily challenge result has been recorded this session.
   */
  DailyCore.isCompleted = function () { return challengeCompleted }

  /**
   * Clear the active challenge (e.g. when quitting to menu).
   */
  DailyCore.clear = function () {
    activeChallenge = null
    challengeCompleted = false
  }

  /* ---------- profile integration ---------- */

  /**
   * Read the daily challenge history from a profile.
   * Returns a plain object mapping dateKey -> { won, bestRound, pops, cash }.
   */
  DailyCore.history = function (profile) {
    if (!profile || typeof profile.daily !== 'object' || profile.daily === null) return {}
    return profile.daily
  }

  /**
   * Read the result for a specific date.
   */
  DailyCore.resultFor = function (profile, dateKey) {
    var h = DailyCore.history(profile)
    return h[dateKey] || null
  }

  /**
   * True when the given date's challenge has already been completed.
   */
  DailyCore.isDone = function (profile, dateKey) {
    return !!DailyCore.resultFor(profile, dateKey)
  }

  /**
   * Record the outcome of a daily challenge into the profile.
   *
   * @param {object} profile   the player profile (mutated in place)
   * @param {string} dateKey   the challenge date key
   * @param {object} result    { won, bestRound, pops, cash }
   * @returns {object} the updated profile
   */
  DailyCore.record = function (profile, dateKey, result) {
    if (!profile || !dateKey || !result) return profile
    if (typeof profile.daily !== 'object' || profile.daily === null) profile.daily = {}

    var prev = profile.daily[dateKey]
    var entry = {
      won: !!result.won,
      bestRound: result.bestRound || 0,
      pops: result.pops || 0,
      cash: result.cash || 0
    }

    // Ratchet best round upward
    if (prev && typeof prev === 'object') {
      entry.bestRound = Math.max(entry.bestRound, prev.bestRound || 0)
      entry.pops = Math.max(entry.pops, prev.pops || 0)
      entry.cash = Math.max(entry.cash, prev.cash || 0)
      if (prev.won) entry.won = true
    }

    profile.daily[dateKey] = entry
    return profile
  }

  /* ---------- streak ---------- */

  /**
   * Calculate the current streak from daily history.
   * The streak counts consecutive days ending today (or yesterday) where the
   * challenge was completed. A win extends the streak; a loss or missing day
   * breaks it.
   *
   * @param {object} profile
   * @returns {{ current: number, best: number }}
   */
  DailyCore.streak = function (profile) {
    var h = DailyCore.history(profile)
    var keys = Object.keys(h).sort().reverse() // newest first

    if (keys.length === 0) return { current: 0, best: profile && profile.dailyStreak ? profile.dailyStreak : 0 }

    // Walk backwards from today
    var today = new Date()
    var current = 0
    var expected = OP.Daily.dateKey(today)

    // Allow yesterday if today hasn't been played yet
    if (!h[expected]) {
      var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      expected = OP.Daily.dateKey(yesterday)
    }

    for (var i = 0; i < 365; i++) {
      var entry = h[expected]
      if (!entry || typeof entry !== 'object') break
      if (!entry.won) break
      current++

      // Move to previous day
      var parts = expected.split('-')
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) - 1)
      expected = OP.Daily.dateKey(d)
    }

    var best = Math.max(current, profile && profile.dailyStreak ? profile.dailyStreak : 0)
    return { current: current, best: best }
  }

  /**
   * Persist the streak best into the profile. Called after recording a result.
   */
  DailyCore.updateStreak = function (profile) {
    var s = DailyCore.streak(profile)
    if (s.best > 0) profile.dailyStreak = s.best
    return profile
  }

  /* ---------- summary ---------- */

  /**
   * Build a summary object for the title screen or daily screen.
   */
  DailyCore.summary = function (profile) {
    var today = OP.Daily && OP.Daily.today ? OP.Daily.today() : null
    var done = today ? DailyCore.isDone(profile, today.dateKey) : false
    var result = today ? DailyCore.resultFor(profile, today.dateKey) : null
    var streak = DailyCore.streak(profile)
    var totalCompleted = Object.keys(DailyCore.history(profile)).length

    return {
      challenge: today,
      done: done,
      result: result,
      streak: streak,
      totalCompleted: totalCompleted
    }
  }

  /* ---------- result object ---------- */

  /**
   * Build a result object from a finished sim, suitable for DailyCore.record().
   */
  DailyCore.resultFromSim = function (sim, won) {
    return {
      won: !!won,
      bestRound: sim ? sim.roundIndex || 0 : 0,
      pops: sim && sim.stats ? sim.stats.popped : 0,
      cash: sim && sim.stats ? sim.stats.cashEarned : 0
    }
  }

  OP.DailyCore = DailyCore
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

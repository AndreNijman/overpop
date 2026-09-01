;(function (OP) {
  'use strict'

  /* Trial — active trial state management.

     A trial is a curated challenge scenario with specific rules, constraints,
     and goals. The trial state tracks which trial is active and the result. */

  var Trial = {}

  /**
   * Start a trial. Sets the active trial in the profile.
   */
  Trial.start = function (profile, trialKey) {
    var def = OP.Trials && OP.Trials.get(trialKey)
    if (!def) return false
    profile.activeTrial = {
      trialKey: trialKey,
      startTime: Date.now()
    }
    return true
  }

  /**
   * Is there an active trial in this profile?
   */
  Trial.isActive = function (profile) {
    return !!(profile && profile.activeTrial && profile.activeTrial.trialKey)
  }

  /**
   * Get the active trial definition.
   */
  Trial.activeDef = function (profile) {
    if (!Trial.isActive(profile)) return null
    return OP.Trials && OP.Trials.get(profile.activeTrial.trialKey)
  }

  /**
   * Get the active trial key.
   */
  Trial.activeKey = function (profile) {
    return (profile && profile.activeTrial && profile.activeTrial.trialKey) || null
  }

  /**
   * Record game-over for the current trial. Returns the trial result:
   * { won, goalMet, trialKey }.
   */
  Trial.recordGameOver = function (profile, won, roundIndex) {
    if (!Trial.isActive(profile)) return null
    var trial = profile.activeTrial
    var def = Trial.activeDef(profile)
    if (!def) return null

    var result = {
      won: won,
      goalMet: false,
      trialKey: trial.trialKey
    }

    if (won && def.goalRound && roundIndex >= def.goalRound) {
      result.goalMet = true
    }

    // Record completion
    if (result.goalMet) {
      profile.completedTrials = profile.completedTrials || {}
      profile.completedTrials[trial.trialKey] = {
        completed: true,
        bestTime: Date.now() - trial.startTime,
        completedAt: Date.now()
      }
    }

    // Clear active trial
    profile.activeTrial = null
    return result
  }

  /**
   * Abandon the current trial.
   */
  Trial.abandon = function (profile) {
    if (!profile) return
    profile.activeTrial = null
  }

  /**
   * Check if a trial has been completed.
   */
  Trial.isCompleted = function (profile, trialKey) {
    return !!(profile && profile.completedTrials &&
              profile.completedTrials[trialKey] &&
              profile.completedTrials[trialKey].completed)
  }

  /**
   * Get the completion info for a trial.
   */
  Trial.completionInfo = function (profile, trialKey) {
    return (profile && profile.completedTrials &&
            profile.completedTrials[trialKey]) || null
  }

  /**
   * Get a summary for a trial.
   */
  Trial.summary = function (profile, trialKey) {
    var def = OP.Trials && OP.Trials.get(trialKey)
    if (!def) return null
    var active = Trial.isActive(profile) && profile.activeTrial.trialKey === trialKey
    var completed = Trial.isCompleted(profile, trialKey)
    var info = Trial.completionInfo(profile, trialKey)
    return {
      key: trialKey,
      name: def.name,
      desc: def.desc,
      difficulty: def.difficulty,
      mode: def.mode,
      mapKey: def.mapKey,
      goal: def.goal,
      goalRound: def.goalRound,
      towerFilter: def.towerFilter || null,
      active: active,
      completed: completed,
      bestTime: info ? info.bestTime : null
    }
  }

  /**
   * Get all trial summaries.
   */
  Trial.allSummaries = function (profile) {
    var keys = OP.Trials ? OP.Trials.keys() : []
    return keys.map(function (k) { return Trial.summary(profile, k) }).filter(Boolean)
  }

  /**
   * Get the rules for a trial.
   */
  Trial.getRules = function (trialKey) {
    var def = OP.Trials && OP.Trials.get(trialKey)
    if (!def) return null
    return def.rules || {}
  }

  /**
   * Format a time in milliseconds to a readable string.
   */
  Trial.formatTime = function (ms) {
    if (!ms || ms <= 0) return '—'
    var seconds = Math.floor(ms / 1000)
    var minutes = Math.floor(seconds / 60)
    seconds = seconds % 60
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
  }

  OP.Trial = Trial
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

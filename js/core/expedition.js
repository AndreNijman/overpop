;(function (OP) {
  'use strict'

  /* Expedition — active expedition state management.

     An expedition is a multi-map campaign. Lives and cash carry over between
     maps, plus a completion bonus after each map. The expedition state is
     saved in the profile so a run can be resumed later. */

  var Expedition = {}

  /**
   * Start a new expedition from the given definition key.
   * Creates an active expedition entry in the profile with starting resources.
   */
  Expedition.start = function (profile, expeditionKey, startCash, startLives) {
    var def = OP.Expeditions && OP.Expeditions.get(expeditionKey)
    if (!def) return false
    profile.expedition = {
      expeditionKey: expeditionKey,
      stageIndex: 0,
      cash: startCash || 650,
      lives: startLives || 20,
      time: 0,
      maps: def.maps.length
    }
    return true
  }

  /**
   * Is there an active expedition in this profile?
   */
  Expedition.isActive = function (profile) {
    return !!(profile && profile.expedition && profile.expedition.expeditionKey)
  }

  /**
   * Get the active expedition definition.
   */
  Expedition.activeDef = function (profile) {
    if (!Expedition.isActive(profile)) return null
    return OP.Expeditions && OP.Expeditions.get(profile.expedition.expeditionKey)
  }

  /**
   * Get the current stage index.
   */
  Expedition.stageIndex = function (profile) {
    return (profile && profile.expedition && profile.expedition.stageIndex) || 0
  }

  /**
   * Get the map key for the current stage.
   */
  Expedition.currentMapKey = function (profile) {
    var def = Expedition.activeDef(profile)
    if (!def) return null
    var idx = Expedition.stageIndex(profile)
    if (idx >= def.maps.length) return null
    return def.maps[idx].key
  }

  /**
   * Get the current difficulty for the expedition.
   */
  Expedition.currentDifficulty = function (profile) {
    var def = Expedition.activeDef(profile)
    return def ? def.difficulty : null
  }

  /**
   * Get the current mode for the expedition.
   */
  Expedition.currentMode = function (profile) {
    var def = Expedition.activeDef(profile)
    return def ? def.mode : null
  }

  /**
   * Get the current cash for the expedition.
   */
  Expedition.currentCash = function (profile) {
    return (profile && profile.expedition && profile.expedition.cash) || 0
  }

  /**
   * Get the current lives for the expedition.
   */
  Expedition.currentLives = function (profile) {
    return (profile && profile.expedition && profile.expedition.lives) || 0
  }

  /**
   * Record game-over for the current stage. If won, apply the completion
   * bonus and advance to the next stage. Returns the expedition result:
   * { won, stageComplete, expeditionComplete, nextMapKey }.
   */
  Expedition.recordGameOver = function (profile, won) {
    if (!Expedition.isActive(profile)) return null
    var exp = profile.expedition
    var def = Expedition.activeDef(profile)
    if (!def) return null

    var result = {
      won: won,
      stageComplete: false,
      expeditionComplete: false,
      nextMapKey: null
    }

    if (!won) {
      Expedition.abandon(profile)
      return result
    }

    /* Stage complete — apply bonus. */
    var bonus = def.maps[exp.stageIndex]
    if (bonus) {
      exp.cash += bonus.bonusCash || 0
      exp.lives += bonus.bonusLives || 0
    }
    exp.stageIndex++
    result.stageComplete = true

    /* Check if expedition is complete. */
    if (exp.stageIndex >= def.maps.length) {
      result.expeditionComplete = true
      Expedition.finish(profile)
    } else {
      result.nextMapKey = def.maps[exp.stageIndex].key
    }

    return result
  }

  /**
   * Mark an expedition as completed and clear the active state.
   */
  Expedition.finish = function (profile) {
    if (!profile) return
    var exp = profile.expedition
    if (!exp) return
    var key = exp.expeditionKey
    profile.expedition = null
    if (key) {
      profile.completedExpeditions = profile.completedExpeditions || {}
      profile.completedExpeditions[key] = (profile.completedExpeditions[key] || 0) + 1
    }
  }

  /**
   * Cancel/abandon the current expedition and clear the active state.
   */
  Expedition.abandon = function (profile) {
    if (!profile) return
    profile.expedition = null
  }

  /**
   * Check if an expedition has been completed at least once.
   */
  Expedition.isCompleted = function (profile, expeditionKey) {
    return !!(profile && profile.completedExpeditions &&
              profile.completedExpeditions[expeditionKey] &&
              profile.completedExpeditions[expeditionKey] > 0)
  }

  /**
   * Get the completion count for an expedition.
   */
  Expedition.completionCount = function (profile, expeditionKey) {
    return (profile && profile.completedExpeditions &&
            profile.completedExpeditions[expeditionKey]) || 0
  }

  /**
   * Get a summary for an expedition.
   */
  Expedition.summary = function (profile, expeditionKey) {
    var def = OP.Expeditions && OP.Expeditions.get(expeditionKey)
    if (!def) return null
    var active = Expedition.isActive(profile) && profile.expedition.expeditionKey === expeditionKey
    return {
      key: expeditionKey,
      name: def.name,
      desc: def.desc,
      difficulty: def.difficulty,
      mode: def.mode,
      maps: def.maps.length,
      completed: Expedition.isCompleted(profile, expeditionKey),
      completions: Expedition.completionCount(profile, expeditionKey),
      active: active,
      stageIndex: active ? profile.expedition.stageIndex : 0
    }
  }

  /**
   * Get all expedition summaries.
   */
  Expedition.allSummaries = function (profile) {
    var keys = OP.Expeditions ? OP.Expeditions.keys() : []
    return keys.map(function (k) { return Expedition.summary(profile, k) }).filter(Boolean)
  }

  /* ---------- state transfer ---------- */

  /**
   * Prepare game state for the current expedition stage.
   * This is called before starting each map in the expedition.
   */
  Expedition.applyState = function (profile, sim) {
    if (!Expedition.isActive(profile)) return
    var exp = profile.expedition
    sim.cash = exp.cash
    sim.lives = exp.lives
  }

  /**
   * Extract the state after a map is completed, for carry-over
   * to the next stage. Called after game-over with won=true.
   */
  Expedition.extractState = function (profile, sim) {
    if (!Expedition.isActive(profile)) return
    profile.expedition.cash = sim.cash
    profile.expedition.lives = sim.lives
    profile.expedition.time = sim.time
  }

  /* ---------- serialization helpers ---------- */

  /**
   * Serialise expedition state into an object suitable for the profile.
   */
  Expedition.serialise = function (profile) {
    if (!Expedition.isActive(profile)) return null
    return {
      expeditionKey: profile.expedition.expeditionKey,
      stageIndex: profile.expedition.stageIndex,
      cash: profile.expedition.cash,
      lives: profile.expedition.lives,
      time: profile.expedition.time,
      maps: profile.expedition.maps
    }
  }

  /**
   * Restore expedition state from a serialised object.
   */
  Expedition.restore = function (profile, data) {
    if (!data || !data.expeditionKey) return
    profile.expedition = {
      expeditionKey: data.expeditionKey,
      stageIndex: data.stageIndex || 0,
      cash: data.cash || 0,
      lives: data.lives || 0,
      time: data.time || 0,
      maps: data.maps || 0
    }
  }

  OP.Expedition = Expedition
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

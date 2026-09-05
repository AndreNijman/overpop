;(function (OP) {
  'use strict'

  /* Boss Event — the weekly rotating boss challenge.

     The "base game boss events like BTD6" feature. A weekly rotating Boss Event
     features one boss (cycling in OP.BOSS_ORDER), lets the player pick any of the
     three bosses to fight, and records durable per-boss, per-difficulty tier
     progression that pays out Knowledge Points for each newly-beaten tier.

     The sim work is already done — the boss-event / boss-event-elite modes spawn
     the configured boss (sim.rules.bossKey) every 20 rounds at escalating tiers.
     This module is the *framing* around that mode: the weekly calendar, the
     roster progression ledger on the profile, and the reward recorder that
     onGameOver calls after a boss-event run ends. Mirrors OP.DailyCore's role for
     the Daily Challenge, and the profile storage follows profile.daily's shape.

     Everything reads OP.BOSSES / OP.bossOrder() lazily at call time, so this core
     file may load before js/data/bosses.js without caring about load order. */

  var BossEvent = {}

  /* ---------- weekly calendar ---------- */

  /* A fixed epoch Monday. The week number is days-since-epoch div 7, so a week
     boundary lands on a Monday and the count is stable across timezones the same
     way the Daily dateKey is (it uses local time, computed per call). */
  var EPOCH = new Date(2026, 0, 5)  // Monday 2026-01-05

  /** The integer week index for a date (0 = the epoch week). Detects the passed
      value by capability rather than `instanceof Date`, because suite harnesses
      load the bundle in a VM whose Date shadows the outer one — the Daily avoids
      the same trap by only calling getFullYear/getMonth/getDate on its input. */
  BossEvent.weekIndex = function (d) {
    var date
    if (d && typeof d.getFullYear === 'function' && typeof d.getTime === 'function') {
      date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    } else {
      date = new Date()
    }
    return Math.max(0, Math.floor((date.getTime() - EPOCH.getTime()) / (7 * 86400000)))
  }

  /** The stable key for a date's week, e.g. 'boss-week-17'. */
  BossEvent.weekKey = function (d) {
    return 'boss-week-' + BossEvent.weekIndex(d)
  }

  /** The boss key featured this week (cycles the rotation order). */
  BossEvent.featuredBoss = function (d) {
    var order = (OP.bossOrder && OP.bossOrder()) || []
    if (!order.length) return null
    return order[BossEvent.weekIndex(d) % order.length]
  }

  /** The deterministic map key for the week (everyone faces the same event). */
  BossEvent.mapKey = function (d) {
    var keys = (OP.MAP_ORDER && OP.MAP_ORDER.slice()) || []
    if (!keys.length) return null
    // Weight intermediate/advanced maps higher, matching the Daily's variety aim.
    var weighted = []
    for (var i = 0; i < keys.length; i++) {
      var def = OP.MAPS && OP.MAPS[keys[i]]
      var w = 1
      if (def && def.tier === 'intermediate') w = 3
      else if (def && def.tier === 'advanced') w = 3
      else if (def && def.tier === 'expert') w = 2
      for (var j = 0; j < w; j++) weighted.push(keys[i])
    }
    if (!weighted.length) weighted = keys
    return weighted[BossEvent.weekIndex(d) % weighted.length]
  }

  /** The deterministic seed for a week's event on a given boss. */
  BossEvent.seed = function (d, bossKey) {
    return 'boss-week-' + BossEvent.weekIndex(d) + '-' + (bossKey || 'any')
  }

  /* ---------- profile ledger ---------- */

  function enumerateBossKeys (profile) {
    var seen = {}
    var base = (OP.bossOrder && OP.bossOrder()) || []
    var recorded = profile && profile.bossEvent && profile.bossEvent.roster
      ? Object.keys(profile.bossEvent.roster) : []
    // Rotation order first, then any extra keys recorded but since unshipped
    // (so a save with a retired boss does not silently lose its rack).
    for (var i = 0; i < base.length; i++) seen[base[i]] = true
    var all = base.slice()
    for (var j = 0; j < recorded.length; j++) {
      if (recorded[j] && !seen[recorded[j]]) { seen[recorded[j]] = true; all.push(recorded[j]) }
    }
    return all
  }

  /** Normalise a bossKey to a safe string, or null when it is not a bosses key. */
  BossEvent.validBoss = function (bossKey) {
    return (OP.bossByKey && OP.bossByKey(bossKey)) ? bossKey : null
  }

  function rosterCell (profile, bossKey, elite) {
    var root = profile.bossEvent.roster
    if (!root[bossKey]) root[bossKey] = {}
    var diff = elite ? 'elite' : 'normal'
    var cell = root[bossKey][diff]
    if (!cell || typeof cell !== 'object') { cell = root[bossKey][diff] = { tiers: 0 } }
    return cell
  }

  /** Best tiers beaten, per boss and difficulty, as a plain { bossKey: { normal, elite } }. */
  BossEvent.progress = function (profile) {
    var out = {}
    var keys = enumerateBossKeys(profile)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      var rootMap = profile && profile.bossEvent && profile.bossEvent.roster ? profile.bossEvent.roster : null
      var rec = rootMap && rootMap[k] ? rootMap[k] : null
      out[k] = {
        normal: rec && typeof rec.normal === 'object' && rec.normal ? (rec.normal.tiers || 0) : 0,
        elite: rec && typeof rec.elite === 'object' && rec.elite ? (rec.elite.tiers || 0) : 0
      }
    }
    return out
  }

  /** The weekly result for a given week key, or null. */
  BossEvent.weekResult = function (profile, weekKey) {
    var w = profile && profile.bossEvent && profile.bossEvent.weekly ? profile.bossEvent.weekly : null
    return (w && w[weekKey]) || null
  }

  /** Summary object the menu/event screen reads to build its layout. */
  BossEvent.summary = function (profile, d) {
    var bossKey = BossEvent.featuredBoss(d)
    var weekKey = BossEvent.weekKey(d)
    var featured = bossKey ? OP.bossByKey(bossKey) : null
    var result = BossEvent.weekResult(profile, weekKey)
    return {
      bossKey: bossKey,
      featured: featured,
      weekKey: weekKey,
      mapKey: BossEvent.mapKey(d),
      seed: BossEvent.seed(d, bossKey),
      won: !!(result && result.won),
      bestTier: result ? (result.bestTier || 0) : 0,
      progress: BossEvent.progress(profile)
    }
  }

  /* ---------- recording + rewards ---------- */

  /* KP granted per newly-beaten normal tier, elite tier, and the one-time bonus
     for clearing all five tiers of a boss in one run. */
  BossEvent.KP_NORMAL = 2
  BossEvent.KP_ELITE = 3
  BossEvent.KP_FULL_CLEAR = 5

  /* Draft Tokens granted per newly-beaten tier (elite pays more), plus a bonus
     for a one-run full clear. */
  BossEvent.DRAFT_NORMAL = 1
  BossEvent.DRAFT_ELITE = 2
  BossEvent.DRAFT_FULL_CLEAR = 2

  /** Build a result object from a finished sim. Tiers killed is tracked on the
      sim's stats as the run plays (see js/core/boss.js); default 0. */
  BossEvent.resultFromSim = function (sim) {
    if (!sim) return { bossKey: null, elite: false, tiersKilled: 0, won: false }
    var bossKey = sim.rules && sim.rules.bossKey ? BossEvent.validBoss(sim.rules.bossKey) : null
    return {
      bossKey: bossKey,
      elite: !!(sim.rules && sim.rules.bossElite),
      tiersKilled: Math.max(0, (sim.stats && sim.stats.bossTiersKilled) || 0),
      won: sim.outcome === 'won'
    }
  }

  /**
   * Record a finished boss-event run into the profile ledger and pay KP for
   * every newly-beaten tier. Mutates profile in place; the caller persists.
   *
   * @param {object} profile
   * @param {object} sim       the finished sim
   * @param {Date}   [d]       the event date (defaults to now), for the weekly stamp
   * @param {object} [rng]     a seeded RNG for the draft lottery (tests)
   * @returns {object|null}    result descriptor, or null when this was not a boss-event run
   */
  BossEvent.recordResult = function (profile, sim, d, rng) {
    if (!profile) return null
    var res = BossEvent.resultFromSim(sim)
    if (!res.bossKey) return null  // not a boss-event run — leave it alone

    if (typeof profile.bossEvent !== 'object' || profile.bossEvent === null) {
      profile.bossEvent = { roster: {}, weekly: {} }
    }
    if (typeof profile.bossEvent.roster !== 'object' || profile.bossEvent.roster === null) {
      profile.bossEvent.roster = {}
    }
    if (typeof profile.bossEvent.weekly !== 'object' || profile.bossEvent.weekly === null) {
      profile.bossEvent.weekly = {}
    }

    var known = profile.bossEvent.roster[res.bossKey]
    if (!known) known = profile.bossEvent.roster[res.bossKey] = {}

    var diff = res.elite ? 'elite' : 'normal'
    var cell = known[diff]
    if (!cell || typeof cell !== 'object') cell = known[diff] = { tiers: 0 }

    var prev = cell.tiers || 0
    var now = Math.max(prev, res.tiersKilled)
    var newTiers = Math.max(0, now - prev)
    cell.tiers = now

    // Reward: KP per newly-beaten tier, plus a bonus for clearing the whole boss.
    var kp = newTiers * (res.elite ? BossEvent.KP_ELITE : BossEvent.KP_NORMAL)
    if (res.won && res.tiersKilled >= 5 && prev < 5) kp += BossEvent.KP_FULL_CLEAR
    profile.knowledgePoints = (profile.knowledgePoints || 0) + kp

    // Drafts: one token per newly-beaten tier (elite pays a richer rate) plus a
    // bonus for a one-run full clear. A token is a lottery pick, so an RNG can be
    // passed to keep tests deterministic.
    var draftCount = newTiers * (res.elite ? BossEvent.DRAFT_ELITE : BossEvent.DRAFT_NORMAL)
    if (res.won && res.tiersKilled >= 5 && prev < 5) draftCount += BossEvent.DRAFT_FULL_CLEAR
    var draftsEarned = 0
    if (OP.Drafts && OP.Drafts.grantRandom && draftCount > 0) {
      for (var di = 0; di < draftCount; di++) {
        if (OP.Drafts.grantRandom(profile, rng)) draftsEarned++
      }
    }

    // Weekly stamp (best-of ratchet, like the Daily).
    var weekKey = BossEvent.weekKey(d)
    var existing = profile.bossEvent.weekly[weekKey]
    var weekEntry = {
      bossKey: res.bossKey,
      elite: res.elite,
      // A week already won stays won — a later leak cannot wipe the earlier win.
      won: !!(existing && existing.won) || !!res.won,
      bestTier: Math.max(existing ? (existing.bestTier || 0) : 0, res.tiersKilled)
    }
    profile.bossEvent.weekly[weekKey] = weekEntry

    return {
      bossKey: res.bossKey,
      elite: res.elite,
      won: res.won,
      tiersPrev: prev,
      tiersKilled: res.tiersKilled,
      tiersNow: now,
      newTiers: newTiers,
      kpEarned: kp,
      draftsEarned: draftsEarned,
      fullClear: res.won && res.tiersKilled >= 5 && prev < 5
    }
  }

  /* ---------- elite gate ---------- */

  /** May the player fight a boss on Elite? BTD6 locks Elite until Normal is beaten.
      This gates per-boss: any normal tier beaten unlocks that boss's elite. */
  BossEvent.eliteUnlocked = function (profile, bossKey) {
    var p = BossEvent.progress(profile)
    var rec = p[bossKey]
    return !!(rec && rec.normal > 0)
  }

  OP.BossEvent = BossEvent
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
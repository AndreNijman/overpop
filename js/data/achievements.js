/**
 * ACHIEVEMENTS — persistent milestones.
 *
 * Achievements are one-shot rewards granted when a condition is met.
 * They are checked at game-over time via Save.recordResult. The data is a
 * plain IIFE on OP.
 *
 * Each achievement has:
 *   key        unique id
 *   name       display name
 *   blurb      flavour text
 *   condition  a function(profile, result) returning true when earned
 *   kp         bonus knowledge points awarded on unlock
 */
;(function () {
  'use strict'

  /** @type {Object<string, AchievementDef>} */
  const DEFS = {

    /* ---- first steps ---- */
    'first-win': {
      key: 'first-win',
      name: 'First Blood',
      blurb: 'Win your first game. The forest remembers.',
      kp: 2,
      check: function (p) { return p.stats.gamesWon >= 1 }
    },
    'ten-wins': {
      key: 'ten-wins',
      name: 'Veteran',
      blurb: 'Win ten games across any difficulty.',
      kp: 3,
      check: function (p) { return p.stats.gamesWon >= 10 }
    },
    'fifty-wins': {
      key: 'fifty-wins',
      name: 'Campaigner',
      blurb: 'Win fifty games. You know these woods well.',
      kp: 5,
      check: function (p) { return p.stats.gamesWon >= 50 }
    },

    /* ---- difficulty mastery ---- */
    'clear-hard': {
      key: 'clear-hard',
      name: 'Hard Road',
      blurb: 'Win a game on Hard difficulty.',
      kp: 2,
      check: function (p) {
        return p.completions && Object.values(p.completions).some(
          d => d && d.hard && Object.values(d.hard).some(v => v === true)
        )
      }
    },
    'clear-relentless': {
      key: 'clear-relentless',
      name: 'Unyielding',
      blurb: 'Win a game on Relentless. Only the best survive.',
      kp: 4,
      check: function (p) {
        return p.completions && Object.values(p.completions).some(
          d => d && d.relentless && Object.values(d.relentless).some(v => v === true)
        )
      }
    },

    /* ---- mode mastery ---- */
    'clear-purist': {
      key: 'clear-purist',
      name: 'Purist',
      blurb: 'Win a game in Purist mode — no selling, no income, no continues.',
      kp: 3,
      check: function (p) {
        return p.completions && Object.values(p.completions).some(
          d => d && Object.values(d).some(m => m && m.purist === true)
        )
      }
    },
    'clear-grim': {
      key: 'clear-grim',
      name: 'Grim Resolve',
      blurb: 'Win a game in Grim mode — one life, no abilities, no mercy.',
      kp: 4,
      check: function (p) {
        return p.completions && Object.values(p.completions).some(
          d => d && Object.values(d).some(m => m && m.grim === true)
        )
      }
    },
    'clear-boss': {
      key: 'clear-boss',
      name: 'Boss Slayer',
      blurb: 'Win a Boss Event mode.',
      kp: 3,
      check: function (p) {
        return p.completions && Object.values(p.completions).some(
          d => d && Object.values(d).some(m => m &&
            (m['boss-event'] === true || m['boss-event-elite'] === true))
        )
      }
    },

    /* ---- pop milestones ---- */
    'pop-1000': {
      key: 'pop-1000',
      name: 'Popper',
      blurb: 'Pop 1,000 total balloons across all games.',
      kp: 1,
      check: function (p) { return p.stats.totalPops >= 1000 }
    },
    'pop-100000': {
      key: 'pop-100000',
      name: 'Popcorn',
      blurb: 'Pop 100,000 total balloons.',
      kp: 3,
      check: function (p) { return p.stats.totalPops >= 100000 }
    },
    'pop-1000000': {
      key: 'pop-1000000',
      name: 'Pop Master',
      blurb: 'Pop 1,000,000 total balloons. The forest is quiet.',
      kp: 5,
      check: function (p) { return p.stats.totalPops >= 1000000 }
    },

    /* ---- round milestones ---- */
    'round-50': {
      key: 'round-50',
      name: 'Halfway There',
      blurb: 'Reach round 50 in any game.',
      kp: 1,
      check: function (p) {
        return p.stats.bestRound && Object.values(p.stats.bestRound).some(r => r >= 50)
      }
    },
    'round-100': {
      key: 'round-100',
      name: 'Centurion',
      blurb: 'Reach round 100 in any game.',
      kp: 2,
      check: function (p) {
        return p.stats.bestRound && Object.values(p.stats.bestRound).some(r => r >= 100)
      }
    },

    /* ---- collection ---- */
    'all-towers': {
      key: 'all-towers',
      name: 'Full Forest',
      blurb: 'Unlock every tower at least once.',
      kp: 4,
      check: function (p, OP) {
        if (!OP || !OP.TOWERS) return false
        const all = Object.keys(OP.TOWERS)
        return all.length > 0 && all.every(k => OP.Save && OP.Save.towerUnlocked
          ? OP.Save.towerUnlocked(p, OP.TOWERS[k])
          : p.unlockedTowers.indexOf(k) >= 0)
      }
    },
    'all-maps': {
      key: 'all-maps',
      name: 'Cartographer',
      blurb: 'Complete at least one game on every map.',
      kp: 5,
      check: function (p, OP) {
        if (!OP || !OP.MAPS) return false
        const all = Object.keys(OP.MAPS)
        return all.length > 0 && all.every(k => {
          if (!p.completions || !p.completions[k]) return false
          return Object.values(p.completions[k]).some(
            d => d && Object.values(d).some(v => v === true)
          )
        })
      }
    }
  }

  const ORDER = Object.keys(DEFS)

  OP.ACHIEVEMENTS = DEFS
  OP.ACHIEVEMENTS_ORDER = ORDER

  /**
   * Check all achievements against a profile and return newly earned ones.
   *
   * @param {Object} profile  the player profile
   * @param {Object} [OPRef]  reference to OP for live data access
   * @returns {string[]}      keys of newly earned achievements
   */
  OP.achievementsCheck = function (profile, OPRef) {
    if (!profile) return []
    const unlocked = new Set(profile.achievements || [])
    const newlyEarned = []
    for (const k of ORDER) {
      if (unlocked.has(k)) continue
      const def = DEFS[k]
      if (def.check(profile, OPRef || OP)) {
        newlyEarned.push(k)
      }
    }
    return newlyEarned
  }

  /**
   * Award newly earned achievements to the profile. Returns the profile
   * with achievements updated and knowledgePoints increased.
   *
   * @param {Object} profile
   * @param {string[]} earned  keys of newly earned achievements
   * @returns {Object}         the mutated profile
   */
  OP.achievementsAward = function (profile, earned) {
    if (!profile || !earned || !earned.length) return profile
    if (!Array.isArray(profile.achievements)) profile.achievements = []
    for (const k of earned) {
      const def = DEFS[k]
      if (!def) continue
      if (profile.achievements.indexOf(k) >= 0) continue
      profile.achievements.push(k)
      if (def.kp) {
        profile.knowledgePoints = (profile.knowledgePoints || 0) + def.kp
      }
    }
    profile.achievements.sort()
    return profile
  }
})()

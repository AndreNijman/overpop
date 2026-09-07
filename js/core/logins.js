/**
 * LOGINS — the daily login calendar.
 *
 * BTD6's daily-login contract, in Overpop terms: show up each day, collect an
 * escalating reward, and keep a consecutive-day streak. The cycle is 7 days;
 * day 7 is the jackpot (a Draft Token on top of the KP). A missed day does not
 * bankrupt you — the streak resets to 1 and the calendar starts over, which is
 * how every calendar system in the genre behaves.
 *
 * ARCHITECTURE
 * ============
 * Pure logic over the profile object — no DOM, no storage. The caller (the
 * menu boot in js/main.js) asks status() and calls claim() on the profile it
 * already owns, then persists it through OP.Save the way every other
 * progression system does.
 *
 * Fields added to the profile (migrated in js/save.js):
 *   loginStreak   current consecutive-day streak, >= 0
 *   loginTotal    lifetime days claimed (feeds achievements)
 *   lastLoginDay  date key of the most recent claim, '' when none
 *
 * Determinism rules: no Math.random anywhere. The day-7 token draw seeds a
 * deterministic LCG from the date key, so the same day always grants the same
 * token for the same profile, and a reloaded profile replays it identically.
 */
;(function (OP) {
  'use strict'

  const MS_PER_DAY = 86400000
  const CYCLE = 7

  /* The calendar. Day 1..7 within the streak cycle; day 7 is the jackpot.
     kp is knowledge points; token is a draft-token payout on top of KP. */
  const CALENDAR = [
    { kp: 2 },                    // day 1
    { kp: 3 },                    // day 2
    { kp: 4 },                    // day 3
    { kp: 5 },                    // day 4
    { kp: 6 },                    // day 5
    { kp: 8 },                    // day 6
    { kp: 12, token: true }       // day 7 — the jackpot
  ]

  /* ---------- date keys (YYYY-MM-DD) ---------- */

  function parseKey (key) {
    const parts = String(key).split('-')
    if (parts.length !== 3) return NaN
    const y = Number(parts[0])
    const m = Number(parts[1])
    const d = Number(parts[2])
    if (!(y >= 1 && y <= 9999) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return NaN
    return Date.UTC(y, m - 1, d)
  }

  function keyOf (utcMillis) {
    const dt = new Date(utcMillis)
    const p = n => String(n).padStart(2, '0')
    return dt.getUTCFullYear() + '-' + p(dt.getUTCMonth() + 1) + '-' + p(dt.getUTCDate())
  }

  /** The day before a date key. */
  function yesterdayOf (key) {
    const ms = parseKey(key)
    if (!isFinite(ms)) return ''
    return keyOf(ms - MS_PER_DAY)
  }

  OP.Logins = {
    CYCLE: CYCLE,

    /** Whether a string is a well-formed date key. */
    isKey: function (key) {
      return isFinite(parseKey(key))
    },

    /** The date key of the day before `key` (YYYY-MM-DD). */
    yesterdayOf: yesterdayOf,

    /** The calendar row a streak of `streak` days is currently on, 1..7. */
    dayOf: function (streak) {
      const s = Number.isInteger(streak) && streak > 0 ? streak : 1
      return ((s - 1) % CYCLE) + 1
    },

    /* ---------- claiming ---------- */

    /**
     * Claim today's login reward for this profile.
     * @param {object} profile the persisted profile; mutated in place
     * @param {string} todayKey the local date key of the day being claimed
     * @returns {{claimed:boolean, day:number, streak:number, kp:number,
     *            token:object|null, first:boolean}|null}
     *   claimed=false when the day was already claimed; null for bad input.
     */
    claim: function (profile, todayKey) {
      if (!profile || !todayKey || !isFinite(parseKey(todayKey))) return null

      const last = typeof profile.lastLoginDay === 'string' ? profile.lastLoginDay : ''
      if (last === todayKey) {
        // Already claimed today. Never double-pay, even if the caller retries.
        return { claimed: false, day: this.dayOf(profile.loginStreak), streak: normalStreak(profile), kp: 0, token: null, first: false }
      }

      // Clock rollback (lastLoginDay is in the future relative to todayKey):
      // treat as already-claimed rather than paying twice, and never reset.
      if (last && parseKey(last) > parseKey(todayKey)) {
        return { claimed: false, day: this.dayOf(profile.loginStreak), streak: normalStreak(profile), kp: 0, token: null, first: false }
      }

      // Consecutive-day detection: yesterday claimed means the streak grows;
      // anything else starts a fresh streak.
      let streak
      if (last && yesterdayOf(todayKey) === last) streak = normalStreak(profile) + 1
      else streak = 1

      const day = this.dayOf(streak)
      const row = CALENDAR[day - 1]
      const kp = row.kp
      let token = null
      if (row.token) {
        // Deterministic draw: same date, same token — a reload or a re-run of
        // the harness must reproduce it exactly.
        const rng = seededRng(dateHash(todayKey))
        token = OP.Drafts && OP.Drafts.grantRandom ? OP.Drafts.grantRandom(profile, rng) : null
      }

      profile.knowledgePoints = (typeof profile.knowledgePoints === 'number' ? profile.knowledgePoints : 0) + kp
      profile.loginStreak = streak
      profile.loginTotal = (typeof profile.loginTotal === 'number' && profile.loginTotal > 0 ? profile.loginTotal : 0) + 1
      profile.lastLoginDay = todayKey

      return { claimed: true, day: day, streak: streak, kp: kp, token: token, first: !last }
    },

    /* ---------- status ---------- */

    /**
     * What the calendar owes this profile right now.
     * @param {object} profile
     * @param {string} todayKey
     * @returns {{available:boolean, day:number, streak:number, kp:number, hasToken:boolean}}
     */
    status: function (profile, todayKey) {
      if (!profile || !todayKey || !isFinite(parseKey(todayKey))) {
        return { available: false, day: 0, streak: 0, kp: 0, hasToken: false }
      }
      const last = typeof profile.lastLoginDay === 'string' ? profile.lastLoginDay : ''
      const available = last !== todayKey
      const nextStreak = available
        ? (last && yesterdayOf(todayKey) === last ? normalStreak(profile) + 1 : 1)
        : normalStreak(profile)
      const day = this.dayOf(nextStreak)
      const row = CALENDAR[day - 1]
      return { available: available, day: available ? day : 0, streak: nextStreak, kp: available ? row.kp : 0, hasToken: available && !!row.token }
    }
  }

  function normalStreak (profile) {
    const v = profile && profile.loginStreak
    return typeof v === 'number' && v > 0 ? v : 0
  }

  /* ---------- determinism ---------- */

  function dateHash (key) {
    let h = 2166136261
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = (h * 16777619) >>> 0
    }
    return h
  }

  /** A minimal deterministic LCG with the `.int(n)` shape Drafts.grantRandom
      expects — never Math.random, so the same day always draws the same token. */
  function seededRng (seed) {
    let state = seed >>> 0 || 0x9e3779b9
    return {
      int: function (n) {
        state = (state * 1664525 + 1013904223) >>> 0
        return state % Math.max(1, n)
      }
    }
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

;(function (OP) {
  'use strict'

  /* Persistence: the settings/progression profile, and the mid-round run save.

     Two independent localStorage entries:

       overpop.profile   settings, lifetime stats, completions, bestiary unlocks
       overpop.run       one in-progress run: OP.Sim.serialize output + its mapKey

     The single most important property of this file is that it CANNOT THROW on
     load. A corrupt entry — a truncated string from a killed tab, a JSON `null`
     from an older build, a quota-exhausted half-write, a browser that denies
     storage entirely — must degrade to a fresh profile, because a throw here
     means the game does not boot at all. Every storage touch therefore goes
     through the four guarded helpers below, and every read is funnelled through
     migrate(), which treats "I do not recognise this" as "use defaults".

     Nothing stored is anything but plain JSON: no functions, no Map, no Set, no
     object references. The run save stores `mapKey` and never a Track — tracks
     are derived geometry, rebuilt from OP.MAPS by the loader (ARCHITECTURE.md §7
     and §1). Storing 300 interpolated polyline points per path would bloat the
     save and pin it to one version of the smoothing code. */

  const Save = {}

  /* Bump when the profile shape changes, and add the from-version step to
     MIGRATIONS. The storage KEYS never change — a migration has to be able to
     find the old data. */
  Save.SCHEMA_VERSION = 7

  Save.PROFILE_KEY = 'overpop.profile'
  Save.RUN_KEY = 'overpop.run'

  /* ---------- settings ----------
     One table, so defaults(), normalise() and setSetting() cannot drift apart.
       unit  — 0..1 volume slider
       bool  — a toggle
       speed — the sim speed selector; clamped exactly like OP.Sim.setSpeed, so a
               stored value can be handed straight to it */
  const SETTINGS = [
    { key: 'musicVolume', kind: 'unit', def: 0.6 },
    { key: 'sfxVolume', kind: 'unit', def: 0.8 },
    { key: 'showTrails', kind: 'bool', def: true },
    { key: 'confirmSell', kind: 'bool', def: true },
    { key: 'autostart', kind: 'bool', def: false },
    { key: 'gameSpeed', kind: 'speed', def: 1 }
  ]

  // Lifetime counters. bestRound is handled separately: it is a per-map map.
  const STAT_COUNTERS = ['gamesPlayed', 'gamesWon', 'roundsCleared', 'totalPops', 'totalCash']

  /* ---------- tiny type guards ----------
     Deliberately paranoid: every one of these is reading data that a user could
     have hand-edited in devtools, or that a previous build wrote in a shape this
     build has never seen. */

  function own (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key) }

  function isPlainObject (v) {
    return !!v && typeof v === 'object' && !Array.isArray(v)
  }

  /* Stored data supplies object KEYS — map keys, difficulty keys, mode keys, tower
     keys — and two things go wrong if they are trusted blindly.

     1. `obj.__proto__ = {}` does not store anything. It reaches the inherited
        setter on Object.prototype and REPLACES the object's prototype. A profile
        hand-edited to `completions: {"__proto__": {"easy": {"standard": true}}}`
        therefore walks straight into `Object.prototype.easy = {}` — every object
        in the running game gains an `.easy` property, permanently, and the game
        is unrecoverable until the tab is closed. JSON.parse makes `__proto__` a
        genuine own enumerable property, so hasOwnProperty does NOT filter it.
     2. A key that already exists on Object.prototype ('toString', 'constructor',
        …) makes a truthiness test like `if (!out[k]) out[k] = {}` believe the
        branch is already there, so the write lands on the inherited value and the
        real entry is silently dropped.

     (2) is fixed by testing existence with own() rather than truthiness — the
     subsequent plain assignment then creates a shadowing own property, which is
     safe. (1) cannot be fixed that way, because the assignment itself is the
     unsafe act, so `__proto__` is rejected outright. No map, difficulty, mode,
     tower or balloon tier in this game is named `__proto__`; rejecting it loses
     nothing real. Both guards are needed — neither covers the other. */
  function safeKey (k) {
    return typeof k === 'string' && k !== '' && k !== '__proto__'
  }

  /** A JSON round-trip. Doubles as the "is this actually storable?" test. */
  function jsonClone (v) {
    try { return JSON.parse(JSON.stringify(v)) } catch (e) { return null }
  }

  function finite (v) { return typeof v === 'number' && isFinite(v) }

  /** A non-negative integer counter. Anything unusable becomes 0.
      Clamped to MAX_SAFE_INTEGER: past that, `+= 1` stops changing the value and
      a lifetime counter silently freezes, so a hand-edited 1e308 would jam
      totalCash forever. Clamping keeps every counter in the range where integer
      arithmetic is still exact. */
  function counter (v) {
    if (!finite(v) || v <= 0) return 0
    if (v >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
    return Math.floor(v)
  }

  /** Counter addition that cannot leave the exact-integer range. */
  function addCounter (a, b) { return counter(counter(a) + counter(b)) }

  function unit (v, fallback) {
    if (!finite(v)) return fallback
    return v < 0 ? 0 : (v > 1 ? 1 : v)
  }

  /** Tolerant on read (0/1 and "true"/"false" happen), strict about the result. */
  function bool (v, fallback) {
    if (typeof v === 'boolean') return v
    if (v === 1 || v === 'true') return true
    if (v === 0 || v === 'false') return false
    return fallback
  }

  function speed (v, fallback) {
    if (!finite(v)) return fallback
    const n = Math.round(v)
    return n < 1 ? 1 : (n > 3 ? 3 : n)
  }

  function settingSpec (key) {
    for (let i = 0; i < SETTINGS.length; i++) if (SETTINGS[i].key === key) return SETTINGS[i]
    return null
  }

  function coerceSetting (spec, value, fallback) {
    if (spec.kind === 'unit') return unit(value, fallback)
    if (spec.kind === 'bool') return bool(value, fallback)
    if (spec.kind === 'speed') return speed(value, fallback)
    return fallback
  }

  /** Deduped, sorted list of usable string keys. Sorted so the stored JSON is
      stable and normalise() is idempotent. Reserved keys are dropped here too:
      these lists get turned into lookup objects by the shop and the bestiary, and
      a `__proto__` entry surviving to that point is the same hazard as above. */
  function keyList (v) {
    const out = []
    if (!Array.isArray(v)) return out
    for (let i = 0; i < v.length; i++) {
      const k = v[i]
      if (!safeKey(k)) continue
      if (out.indexOf(k) < 0) out.push(k)
    }
    out.sort()
    return out
  }

  function mergeKeys (existing, add) {
    const out = keyList(existing)
    if (!Array.isArray(add)) return out
    for (let i = 0; i < add.length; i++) {
      const k = add[i]
      if (safeKey(k) && out.indexOf(k) < 0) out.push(k)
    }
    out.sort()
    return out
  }

  /** Canonical plain-object inventory: safe keys and positive integer counts. */
  function powerInventory (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    const keys = Object.keys(raw).sort()
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (!safeKey(key)) continue
      const n = counter(raw[key])
      if (n > 0) out[key] = n
    }
    return out
  }

  /* ---------- storage access ----------
     Resolved lazily, never at load time: some browsers throw merely on touching
     window.localStorage (private mode, third-party-cookie blocking), and a throw
     while this file evaluates would take the whole bundle down. */

  function storage () {
    try {
      const g = typeof window !== 'undefined' ? window
        : (typeof globalThis !== 'undefined' ? globalThis : null)
      const s = g && g.localStorage
      if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function' ||
          typeof s.removeItem !== 'function') return null
      return s
    } catch (e) { return null }
  }

  function readKey (key) {
    const s = storage()
    if (!s) return null
    try { return s.getItem(key) } catch (e) { return null }
  }

  /** @returns {boolean} false on a quota error or a denied store — never throws. */
  function writeKey (key, str) {
    const s = storage()
    if (!s) return false
    try { s.setItem(key, str); return true } catch (e) { return false }
  }

  function dropKey (key) {
    const s = storage()
    if (!s) return false
    try { s.removeItem(key); return true } catch (e) { return false }
  }

  /* ---------- the profile ---------- */

  /**
   * A fresh profile. Pure — a new object every call, sharing nothing.
   */
  Save.defaults = function () {
    const settings = {}
    for (let i = 0; i < SETTINGS.length; i++) settings[SETTINGS[i].key] = SETTINGS[i].def

    const stats = { bestRound: {} }
    for (let i = 0; i < STAT_COUNTERS.length; i++) stats[STAT_COUNTERS[i]] = 0

    return {
      schemaVersion: Save.SCHEMA_VERSION,
      settings: settings,
      stats: stats,
      playerXp: 0,
      completions: {},   // mapKey -> difficulty -> mode -> true
      unlockedTowers: [],
      seenBalloons: [],
      knowledge: [],     // unlocked knowledge node keys
      knowledgePoints: 0, // unspent KP
      achievements: [],   // unlocked achievement keys
      powers: {},         // power key -> remaining uses
      daily: {},          // dateKey -> { won, bestRound, pops, cash }
      dailyStreak: 0,     // best daily challenge streak
      raceBests: {},       // mapKey -> difficulty -> { won, time, pops, cash }
      expedition: null,     // active expedition state or null
      completedExpeditions: {}, // expeditionKey -> completion count
      activeTrial: null,    // active trial state or null
      completedTrials: {}   // trialKey -> { completed, bestTime, completedAt }
    }
  }

  /**
   * Shape and type repair. Builds a fresh profile and copies across only what it
   * recognises, so an unknown-shaped object degrades to defaults field by field
   * instead of all at once — a save with good stats and a mangled settings block
   * keeps its stats.
   *
   * Idempotent: normalise(normalise(x)) deep-equals normalise(x). That is what
   * makes save/load lossless.
   */
  function normalise (raw) {
    const out = Save.defaults()
    if (!isPlainObject(raw)) return out

    const settings = isPlainObject(raw.settings) ? raw.settings : {}
    for (let i = 0; i < SETTINGS.length; i++) {
      const spec = SETTINGS[i]
      out.settings[spec.key] = coerceSetting(spec, settings[spec.key], spec.def)
    }

    const stats = isPlainObject(raw.stats) ? raw.stats : {}
    for (let i = 0; i < STAT_COUNTERS.length; i++) {
      out.stats[STAT_COUNTERS[i]] = counter(stats[STAT_COUNTERS[i]])
    }
    const best = isPlainObject(stats.bestRound) ? stats.bestRound : {}
    for (const mapKey in best) {
      if (!own(best, mapKey) || !safeKey(mapKey)) continue
      const round = counter(best[mapKey])
      if (round > 0) out.stats.bestRound[mapKey] = round
    }
    out.playerXp = counter(raw.playerXp)

    out.completions = normaliseCompletions(raw.completions)
    out.unlockedTowers = keyList(raw.unlockedTowers)
    out.seenBalloons = keyList(raw.seenBalloons)
    out.knowledge = keyList(raw.knowledge)
    out.knowledgePoints = typeof raw.knowledgePoints === 'number' && raw.knowledgePoints >= 0
      ? Math.floor(raw.knowledgePoints) : 0
    out.achievements = keyList(raw.achievements)
    out.powers = powerInventory(raw.powers)
    out.daily = normaliseDaily(raw.daily)
    out.dailyStreak = counter(raw.dailyStreak)
    out.raceBests = normaliseRaceBests(raw.raceBests)
    out.expedition = normaliseExpedition(raw.expedition)
    out.completedExpeditions = normaliseCompletedExpeditions(raw.completedExpeditions)
    out.activeTrial = normaliseActiveTrial(raw.activeTrial)
    out.completedTrials = normaliseCompletedTrials(raw.completedTrials)
    out.schemaVersion = Save.SCHEMA_VERSION
    return out
  }

  /**
   * Normalise the daily challenge history. Keys are date strings like
   * '2026-08-31'; values are { won: bool, bestRound: int, pops: int, cash: int }.
   */
  function normaliseDaily (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    for (const key in raw) {
      if (!own(raw, key) || typeof key !== 'string' || key === '' || key === '__proto__') continue
      const entry = raw[key]
      if (!isPlainObject(entry)) continue
      out[key] = {
        won: !!entry.won,
        bestRound: counter(entry.bestRound),
        pops: counter(entry.pops),
        cash: counter(entry.cash)
      }
    }
    return out
  }

  /**
   * Normalise race best times. mapKey -> difficulty -> { won, time, pops, cash }.
   */
  function normaliseRaceBests (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    for (const mapKey in raw) {
      if (!own(raw, mapKey) || !safeKey(mapKey)) continue
      const diffs = raw[mapKey]
      if (!isPlainObject(diffs)) continue
      for (const diff in diffs) {
        if (!own(diffs, diff) || !safeKey(diff)) continue
        const entry = diffs[diff]
        if (!isPlainObject(entry)) continue
        out[mapKey] = out[mapKey] || {}
        out[mapKey][diff] = {
          won: !!entry.won,
          time: finite(entry.time) ? entry.time : 0,
          pops: counter(entry.pops),
          cash: counter(entry.cash)
        }
      }
    }
    return out
  }

  /**
   * Normalise active expedition state. null or { expeditionKey, stageIndex, cash, lives, time, maps }.
   */
  function normaliseExpedition (raw) {
    if (!isPlainObject(raw)) return null
    if (!safeKey(raw.expeditionKey)) return null
    return {
      expeditionKey: raw.expeditionKey,
      stageIndex: counter(raw.stageIndex),
      cash: counter(raw.cash),
      lives: counter(raw.lives),
      time: finite(raw.time) ? raw.time : 0,
      maps: counter(raw.maps)
    }
  }

  /**
   * Normalise completed expeditions. expeditionKey -> count.
   */
  function normaliseCompletedExpeditions (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    for (const key in raw) {
      if (!own(raw, key) || !safeKey(key)) continue
      const n = counter(raw[key])
      if (n > 0) out[key] = n
    }
    return out
  }

  /**
   * Normalise active trial state. null or { trialKey, startTime }.
   */
  function normaliseActiveTrial (raw) {
    if (!isPlainObject(raw)) return null
    if (!safeKey(raw.trialKey)) return null
    return {
      trialKey: raw.trialKey,
      startTime: finite(raw.startTime) ? raw.startTime : Date.now()
    }
  }

  /**
   * Normalise completed trials. trialKey -> { completed, bestTime, completedAt }.
   */
  function normaliseCompletedTrials (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    for (const key in raw) {
      if (!own(raw, key) || !safeKey(key)) continue
      const entry = raw[key]
      if (!isPlainObject(entry)) continue
      out[key] = {
        completed: !!entry.completed,
        bestTime: finite(entry.bestTime) ? entry.bestTime : 0,
        completedAt: finite(entry.completedAt) ? entry.completedAt : 0
      }
    }
    return out
  }

  /** mapKey -> difficulty -> mode -> true. Only literal `true` leaves survive,
      and a branch with no surviving leaf is dropped rather than left empty.
      Every key is safeKey()-screened and every "does this branch exist?" test is
      own(), never truthiness — see safeKey above for why both matter. */
  function normaliseCompletions (raw) {
    const out = {}
    if (!isPlainObject(raw)) return out
    for (const mapKey in raw) {
      if (!own(raw, mapKey) || !safeKey(mapKey)) continue
      const diffs = raw[mapKey]
      if (!isPlainObject(diffs)) continue
      for (const diff in diffs) {
        if (!own(diffs, diff) || !safeKey(diff)) continue
        const modes = diffs[diff]
        if (!isPlainObject(modes)) continue
        for (const mode in modes) {
          if (!own(modes, mode) || !safeKey(mode)) continue
          if (modes[mode] !== true) continue
          if (!own(out, mapKey)) out[mapKey] = {}
          if (!own(out[mapKey], diff)) out[mapKey][diff] = {}
          out[mapKey][diff][mode] = true
        }
      }
    }
    return out
  }

  /* ---------- migration ----------
     Keyed by the version being migrated FROM. Each step takes the profile at
     version N and returns it at version N+1; the loop stamps the version, and
     normalise() does the shape repair afterwards, so a step only has to move the
     fields it actually cares about.

     Adding version 2 is therefore one entry:
       1: function (p) { p.settings.newThing = derive(p); return p }
     ...plus bumping SCHEMA_VERSION.

     Exposed as Save.MIGRATIONS below so the harness can prove the loop really
     steps — with a single version there is no hop to observe otherwise, and an
     unexercised migration engine is one that breaks on the day it is first
     needed. */
  const MIGRATIONS = {
    // An unversioned profile — written before the schema existed, or hand-made.
    // Nothing to move; normalise() repairs it.
    0: function (p) { return p },
    // Version 1 → 2: add knowledge fields
    1: function (p) {
      if (!Array.isArray(p.knowledge)) p.knowledge = []
      if (typeof p.knowledgePoints !== 'number') p.knowledgePoints = 0
      return p
    },
    // Version 2 → 3: add daily challenge fields
    2: function (p) {
      if (typeof p.daily !== 'object' || p.daily === null) p.daily = {}
      if (typeof p.dailyStreak !== 'number') p.dailyStreak = 0
      return p
    },
    // Version 3 → 4: add race best times
    3: function (p) {
      if (typeof p.raceBests !== 'object' || p.raceBests === null) p.raceBests = {}
      return p
    },
    // Version 4 → 5: add expedition fields
    4: function (p) {
      if (typeof p.expedition !== 'object') p.expedition = null
      if (typeof p.completedExpeditions !== 'object' || p.completedExpeditions === null) p.completedExpeditions = {}
      return p
    },
    // Version 5 → 6: add trial fields
    5: function (p) {
      if (typeof p.activeTrial !== 'object') p.activeTrial = null
      if (typeof p.completedTrials !== 'object' || p.completedTrials === null) p.completedTrials = {}
      return p
    },
    // Version 6 → 7: add player XP, reconstructed from lifetime play.
    6: function (p) {
      const stats = isPlainObject(p.stats) ? p.stats : {}
      if (!finite(p.playerXp) || p.playerXp < 0) {
        const roundXp = counter(counter(stats.roundsCleared) * 10)
        const winXp = counter(counter(stats.gamesWon) * 500)
        p.playerXp = addCounter(roundXp, winXp)
      }
      return p
    }
  }

  Save.MIGRATIONS = MIGRATIONS

  /**
   * Bring any raw parsed value up to the current schema.
   *
   * Pure: clones its input first, so calling it twice on the same object gives
   * equal results and never mutates the caller's data.
   *
   * Returns defaults() rather than guessing when it cannot see a path forward:
   * a non-object, a version from the future (a newer build wrote it — its fields
   * mean things this build does not know), or a version with no migration step.
   */
  Save.migrate = function (raw) {
    let data = jsonClone(raw)
    if (!isPlainObject(data)) return Save.defaults()

    // A missing or non-integer version means "unversioned": start at 0 and walk
    // up. Only a genuine integer above the current schema is from the future.
    let v = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0
    if (v < 0) v = 0
    if (v > Save.SCHEMA_VERSION) return Save.defaults()

    while (v < Save.SCHEMA_VERSION) {
      const step = MIGRATIONS[v]
      if (typeof step !== 'function') return Save.defaults()
      // A future step is ordinary code operating on data it has never seen. If it
      // throws, that is a lost profile — not a game that refuses to boot.
      try { data = step(data) } catch (e) { return Save.defaults() }
      if (!isPlainObject(data)) return Save.defaults()
      v++
      data.schemaVersion = v
    }

    return normalise(data)
  }

  /** The profile from storage, migrated. Never throws, always returns a profile. */
  Save.load = function () {
    const raw = readKey(Save.PROFILE_KEY)
    if (typeof raw !== 'string' || raw === '') return Save.defaults()
    let parsed
    try { parsed = JSON.parse(raw) } catch (e) { return Save.defaults() }
    return Save.migrate(parsed)
  }

  /**
   * Write the profile. Runs it through migrate() first, so nothing unstorable can
   * reach the entry and what comes back out of load() is what went in.
   *
   * migrate() rather than normalise() on purpose. normalise() *stamps* the current
   * schema version without running any migration step, so handing save() a profile
   * that is still at an older version would relabel it as current and skip its
   * migration permanently — the data would be silently frozen in the old shape
   * with a new version number on it, and no later load() could ever repair it,
   * because load() trusts the stamp. migrate() is idempotent and ends in
   * normalise(), so for an already-current profile this is byte-identical.
   *
   * @returns {boolean} false if storage refused it (quota, denied, absent) or if
   *   `profile` is not a profile at all. A caller bug must not silently overwrite
   *   a real profile with defaults, and a full disk must not throw mid-round.
   */
  Save.save = function (profile) {
    if (!isPlainObject(profile)) return false
    let str
    try { str = JSON.stringify(Save.migrate(profile)) } catch (e) { return false }
    return writeKey(Save.PROFILE_KEY, str)
  }

  /** Wipe all local state and hand back a fresh profile. The in-progress run
      belongs to the profile that started it, so it goes too. */
  Save.reset = function () {
    dropKey(Save.PROFILE_KEY)
    dropKey(Save.RUN_KEY)
    return Save.defaults()
  }

  /**
   * Set one setting, coercing and clamping it. Unknown keys are ignored — the
   * settings table is the authority on what a profile may contain. A value that
   * cannot be coerced leaves the current one alone.
   *
   * Mutates and returns `profile`; persisting is the caller's decision.
   */
  Save.setSetting = function (profile, key, value) {
    const p = isPlainObject(profile) ? repair(profile) : Save.defaults()
    const spec = settingSpec(key)
    if (!spec) return p
    const current = coerceSetting(spec, p.settings[spec.key], spec.def)
    p.settings[spec.key] = coerceSetting(spec, value, current)
    return p
  }

  /** In-place structural repair, so recordResult/setSetting can work on a
      profile a caller assembled by hand without returning a different object. */
  function repair (p) {
    const d = Save.defaults()
    if (!Number.isInteger(p.schemaVersion)) p.schemaVersion = Save.SCHEMA_VERSION
    if (!isPlainObject(p.settings)) p.settings = d.settings
    for (let i = 0; i < SETTINGS.length; i++) {
      const spec = SETTINGS[i]
      p.settings[spec.key] = coerceSetting(spec, p.settings[spec.key], spec.def)
    }
    if (!isPlainObject(p.stats)) p.stats = d.stats
    for (let i = 0; i < STAT_COUNTERS.length; i++) {
      p.stats[STAT_COUNTERS[i]] = counter(p.stats[STAT_COUNTERS[i]])
    }
    if (!isPlainObject(p.stats.bestRound)) p.stats.bestRound = {}
    p.playerXp = counter(p.playerXp)
    if (!isPlainObject(p.completions)) p.completions = {}
    if (!Array.isArray(p.unlockedTowers)) p.unlockedTowers = []
    if (!Array.isArray(p.seenBalloons)) p.seenBalloons = []
    if (!Array.isArray(p.knowledge)) p.knowledge = []
    if (typeof p.knowledgePoints !== 'number' || p.knowledgePoints < 0) p.knowledgePoints = 0
    if (!Array.isArray(p.achievements)) p.achievements = []
    p.powers = powerInventory(p.powers)
    if (!isPlainObject(p.daily)) p.daily = {}
    if (typeof p.dailyStreak !== 'number' || p.dailyStreak < 0) p.dailyStreak = 0
    if (!isPlainObject(p.raceBests)) p.raceBests = {}
    if (p.expedition !== null && !isPlainObject(p.expedition)) p.expedition = null
    if (!isPlainObject(p.completedExpeditions)) p.completedExpeditions = {}
    if (p.activeTrial !== null && !isPlainObject(p.activeTrial)) p.activeTrial = null
    if (!isPlainObject(p.completedTrials)) p.completedTrials = {}
    return p
  }

  /**
   * Fold the outcome of a finished game into the profile.
   *
   * `result` is plain data assembled by the results screen:
   *   mapKey, difficulty, mode   strings — together they name the completion cell
   *   won                        true only if the last authored round was cleared
   *   round                      highest round reached (defaults to roundsCleared)
   *   roundsCleared, pops, cash  added to the lifetime counters
   *   unlockedTowers: [key]      towers this game unlocked
   *   seenBalloons: [tierKey]    tiers the bestiary may now show
   *
   * A completion flag is only ever set on a win, and bestRound only ratchets
   * upward. Unrelated maps, difficulties and modes are untouched.
   *
   * Mutates and returns `profile`; the caller saves, and the caller clears the
   * run save. Junk in `result` records nothing rather than throwing.
   */
  Save.recordResult = function (profile, result) {
    const p = isPlainObject(profile) ? repair(profile) : Save.defaults()
    if (!isPlainObject(result)) return p

    p.stats.gamesPlayed = addCounter(p.stats.gamesPlayed, 1)
    if (result.won === true) p.stats.gamesWon = addCounter(p.stats.gamesWon, 1)
    p.stats.roundsCleared = addCounter(p.stats.roundsCleared, result.roundsCleared)
    p.stats.totalPops = addCounter(p.stats.totalPops, result.pops)
    p.stats.totalCash = addCounter(p.stats.totalCash, result.cash)
    p.playerXp = addCounter(p.playerXp, Save.xpForResult(result))

    // safeKey, not just a string test: a result naming its map `__proto__` would
    // otherwise reach the prototype setter below.
    const mapKey = safeKey(result.mapKey) ? result.mapKey : ''
    const reached = counter(result.round === undefined ? result.roundsCleared : result.round)
    if (mapKey && reached > counter(p.stats.bestRound[mapKey])) {
      p.stats.bestRound[mapKey] = reached
    }

    const diff = safeKey(result.difficulty) ? result.difficulty : ''
    const mode = safeKey(result.mode) ? result.mode : ''
    if (result.won === true && mapKey && diff && mode) {
      // own(), not isPlainObject(): Object.prototype IS a plain object, so an
      // inherited branch would pass the type test and the write would land on it.
      if (!own(p.completions, mapKey) || !isPlainObject(p.completions[mapKey])) p.completions[mapKey] = {}
      if (!own(p.completions[mapKey], diff) || !isPlainObject(p.completions[mapKey][diff])) p.completions[mapKey][diff] = {}
      p.completions[mapKey][diff][mode] = true
    }

    p.unlockedTowers = mergeKeys(p.unlockedTowers, result.unlockedTowers)
    p.seenBalloons = mergeKeys(p.seenBalloons, result.seenBalloons)
    if (own(result, 'powers')) p.powers = powerInventory(result.powers)

    // Knowledge points: earned on win, scaled by difficulty and mode
    if (result.won === true && OP.knowledgeEarn) {
      const kp = OP.knowledgeEarn(result)
      if (kp > 0) p.knowledgePoints = (p.knowledgePoints || 0) + kp
    }

    // Check achievements
    if (OP.achievementsCheck && OP.achievementsAward) {
      const earned = OP.achievementsCheck(p, OP)
      if (earned.length) OP.achievementsAward(p, earned)
    }

    // Each win awards one consumable, cycling through the roster deterministically.
    if (result.won === true && OP.Powers && OP.Powers.rewardKey) {
      const powerKey = OP.Powers.rewardKey(p)
      if (safeKey(powerKey)) p.powers[powerKey] = addCounter(p.powers[powerKey], 1)
    }

    return p
  }

  /* ---------- player progression ---------- */

  Save.XP_PER_LEVEL = 1000

  Save.xpForResult = function (result) {
    if (!isPlainObject(result)) return 0
    const roundXp = counter(counter(result.roundsCleared) * 10)
    return addCounter(roundXp, result.won === true ? 500 : 0)
  }

  Save.playerLevel = function (profile) {
    return 1 + Math.floor(counter(profile && profile.playerXp) / Save.XP_PER_LEVEL)
  }

  Save.xpProgress = function (profile) {
    const total = counter(profile && profile.playerXp)
    return {
      level: Save.playerLevel(profile),
      total: total,
      current: total % Save.XP_PER_LEVEL,
      needed: Save.XP_PER_LEVEL
    }
  }

  Save.towerUnlocked = function (profile, def) {
    if (!def || !safeKey(def.key)) return false
    const legacy = profile && Array.isArray(profile.unlockedTowers) ? profile.unlockedTowers : []
    if (legacy.indexOf(def.key) >= 0) return true
    const level = Number.isInteger(def.unlockLevel) && def.unlockLevel > 0 ? def.unlockLevel : 1
    return Save.playerLevel(profile) >= level
  }

  Save.availableTowerKeys = function (profile) {
    const out = []
    const order = Array.isArray(OP.TOWER_ORDER) ? OP.TOWER_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.TOWERS && OP.TOWERS[order[i]]
      if (Save.towerUnlocked(profile, def)) out.push(order[i])
    }
    return out
  }

  Save.mapWon = function (profile, mapKey) {
    const diffs = profile && profile.completions && profile.completions[mapKey]
    if (!isPlainObject(diffs)) return false
    for (const diff in diffs) {
      if (!own(diffs, diff) || !isPlainObject(diffs[diff])) continue
      for (const mode in diffs[diff]) {
        if (own(diffs[diff], mode) && diffs[diff][mode] === true) return true
      }
    }
    return false
  }

  Save.tierWins = function (profile, tier) {
    const order = Array.isArray(OP.MAP_ORDER) ? OP.MAP_ORDER : []
    let wins = 0
    for (let i = 0; i < order.length; i++) {
      const def = OP.MAPS && OP.MAPS[order[i]]
      if (def && def.tier === tier && Save.mapWon(profile, def.key)) wins++
    }
    return wins
  }

  Save.mapUnlockInfo = function (profile, def) {
    if (!def || !safeKey(def.key)) return { unlocked: false, reason: 'Unknown map.' }
    if (Save.mapWon(profile, def.key)) return { unlocked: true, reason: '', required: 0, wins: 0 }

    const tiers = OP.Maps && Array.isArray(OP.Maps.TIERS)
      ? OP.Maps.TIERS
      : ['beginner', 'intermediate', 'advanced', 'expert']
    const tierIndex = tiers.indexOf(def.tier)
    if (tierIndex <= 0) return { unlocked: true, reason: '', required: 0, wins: 0 }

    const peers = []
    const order = Array.isArray(OP.MAP_ORDER) ? OP.MAP_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const peer = OP.MAPS && OP.MAPS[order[i]]
      if (peer && peer.tier === def.tier) peers.push(peer)
    }
    const mapIndex = peers.indexOf(def)
    if (mapIndex < 0) return { unlocked: true, reason: '', required: 0, wins: 0 }

    const previousTier = tiers[tierIndex - 1]
    const required = mapIndex + 1
    const wins = Save.tierWins(profile, previousTier)
    const missing = Math.max(0, required - wins)
    const label = previousTier.charAt(0).toUpperCase() + previousTier.slice(1)
    return {
      unlocked: missing === 0,
      reason: missing ? 'Win ' + missing + ' more ' + label + ' map' + (missing === 1 ? '' : 's') + '.' : '',
      required: required,
      wins: wins
    }
  }

  Save.mapUnlocked = function (profile, def) {
    return Save.mapUnlockInfo(profile, def).unlocked
  }

  Save.availableMapKeys = function (profile) {
    const out = []
    const order = Array.isArray(OP.MAP_ORDER) ? OP.MAP_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.MAPS && OP.MAPS[order[i]]
      if (def && Save.mapUnlocked(profile, def)) out.push(def.key)
    }
    return out
  }

  /* ---------- the run save ----------
     One slot. A run is a snapshot of a live sim plus the key of the map it is
     being played on; the loader rebuilds the Tracks from OP.MAPS and calls
     OP.Sim.deserialize(snapshot, map). */

  /**
   * Store the in-progress run.
   * @returns {boolean} false if storage refused it, or if there is nothing
   *   resumable — a finished game is not a run. A refusal leaves any previously
   *   stored run alone rather than destroying it.
   */
  Save.saveRun = function (sim, mapKey) {
    if (!isPlainObject(sim) || sim.over) return false
    if (!OP.Sim || typeof OP.Sim.serialize !== 'function') return false

    let str
    try {
      const snapshot = OP.Sim.serialize(sim)
      if (!isPlainObject(snapshot)) return false
      const key = String(mapKey || (sim.map && sim.map.key) || snapshot.mapKey || '')
      if (!key) return false
      snapshot.mapKey = key
      str = JSON.stringify({
        schemaVersion: Save.SCHEMA_VERSION,
        version: OP.VERSION,
        savedAt: Date.now(),
        mapKey: key,
        snapshot: snapshot
      })
    } catch (e) { return false }

    return writeKey(Save.RUN_KEY, str)
  }

  /**
   * @returns {?{snapshot:object, mapKey:string, savedAt:number}} null when there
   *   is no run, or when the stored bytes are unusable: unparseable, not an
   *   object, a schema from a newer build, no snapshot, no RNG state, a tick that
   *   is not a whole non-negative count, an already-finished game, two map keys
   *   that disagree, or no map key to rebuild geometry from. "No resumable run" is
   *   a menu state.
   *
   * This validates the *stored data*, not the world it will be restored into.
   * OP.Sim.deserialize still throws for a mid-game snapshot whose `roundSetKey`
   * is not registered in OP.ROUND_SETS (sim.js), and it needs a map built from
   * OP.MAPS[mapKey] — neither of which this file can check without pinning itself
   * to registry load order. The resume path must therefore try/catch the
   * deserialize and fall back to the menu (plus Save.clearRun()) on failure.
   */
  Save.loadRun = function () {
    const raw = readKey(Save.RUN_KEY)
    if (typeof raw !== 'string' || raw === '') return null

    let payload
    try { payload = JSON.parse(raw) } catch (e) { return null }
    if (!isPlainObject(payload)) return null

    const v = Number.isInteger(payload.schemaVersion) ? payload.schemaVersion : 0
    if (v > Save.SCHEMA_VERSION) return null

    const snapshot = payload.snapshot
    if (!isPlainObject(snapshot)) return null
    // A tick is a whole count of fixed steps. A fractional or negative one is not
    // merely odd — Sim.deserialize assigns it verbatim, and every `tick % n` gate
    // in the sim then never fires again.
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) return null
    if (!isPlainObject(snapshot.rng)) return null

    // saveRun refuses to WRITE a finished sim; the read path has to refuse one
    // too, or an entry from an older build, a hand-edit, or a second tab still
    // offers "continue" on a game that is already over — and resuming it drops the
    // player onto a dead board with no way back through the results screen.
    if (snapshot.over === true) return null

    const payloadKey = typeof payload.mapKey === 'string' ? payload.mapKey : ''
    const snapKey = typeof snapshot.mapKey === 'string' ? snapshot.mapKey : ''
    // saveRun always writes these two equal. If they disagree, the entry is not
    // trustworthy: the caller rebuilds geometry from the envelope key while the
    // snapshot's balloon `t` values belong to the other map's track lengths, so
    // resuming would silently play one save on another map's paths. Refuse rather
    // than pick a winner.
    if (payloadKey && snapKey && payloadKey !== snapKey) return null
    const mapKey = payloadKey || snapKey
    if (!mapKey) return null

    return {
      snapshot: snapshot,
      mapKey: mapKey,
      savedAt: finite(payload.savedAt) ? payload.savedAt : 0
    }
  }

  Save.clearRun = function () { return dropKey(Save.RUN_KEY) }

  /** True exactly when loadRun() would return something usable. */
  Save.hasRun = function () { return Save.loadRun() !== null }

  OP.Save = Save
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

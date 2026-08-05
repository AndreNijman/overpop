// The save system: profile, settings, progression, and the mid-round run save.
//
// The load path is the thing under test here more than anything else. A throw
// while reading localStorage means the game does not boot at all, so every
// hostile input a real browser can hand us — a truncated write from a killed
// tab, a JSON null from an older build, a hand-edited devtools string, a denied
// or absent storage object, a quota-exhausted write — is asserted to degrade to
// a complete default profile rather than to raise.

export const name = 'save'
export const needs = ['js/save.js']

import { makeSim, straightTrack } from './_fixture.mjs'

/* ---------- local helpers ---------- */

/** Recursively key-sorted clone, so deep comparison ignores property order. */
function canon (v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k])
    return out
  }
  return v
}

const SETTING_KEYS = ['musicVolume', 'sfxVolume', 'showTrails', 'confirmSell', 'autostart', 'gameSpeed']
const COUNTERS = ['gamesPlayed', 'gamesWon', 'roundsCleared', 'totalPops', 'totalCash']

function isObj (v) { return !!v && typeof v === 'object' && !Array.isArray(v) }

/** Every field a profile must have, with a usable type and range. */
function completeProfile (OP, p) {
  if (!isObj(p)) return false
  if (p.schemaVersion !== OP.Save.SCHEMA_VERSION) return false

  const s = p.settings
  if (!isObj(s)) return false
  for (const k of SETTING_KEYS) if (s[k] === undefined) return false
  if (typeof s.musicVolume !== 'number' || s.musicVolume < 0 || s.musicVolume > 1) return false
  if (typeof s.sfxVolume !== 'number' || s.sfxVolume < 0 || s.sfxVolume > 1) return false
  if (typeof s.showTrails !== 'boolean') return false
  if (typeof s.confirmSell !== 'boolean') return false
  if (typeof s.autostart !== 'boolean') return false
  if (!Number.isInteger(s.gameSpeed) || s.gameSpeed < 1 || s.gameSpeed > 3) return false

  const st = p.stats
  if (!isObj(st)) return false
  for (const k of COUNTERS) if (!Number.isInteger(st[k]) || st[k] < 0) return false
  if (!isObj(st.bestRound)) return false

  if (!isObj(p.completions)) return false
  if (!Array.isArray(p.unlockedTowers) || !Array.isArray(p.seenBalloons)) return false
  return true
}

/**
 * Cross-realm JSON-safety walk. Values come from the VM context, so `instanceof`
 * is useless — a Map built in there is not the host's Map. The object tag is.
 * @returns {string} '' when safe, otherwise the offending path.
 */
function jsonUnsafe (v, path) {
  path = path || '$'
  if (v === null) return ''
  const ty = typeof v
  if (ty === 'string' || ty === 'boolean') return ''
  if (ty === 'number') return isFinite(v) ? '' : path + ' is a non-finite number'
  if (ty === 'function' || ty === 'symbol' || ty === 'undefined' || ty === 'bigint') {
    return path + ' is a ' + ty
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const bad = jsonUnsafe(v[i], path + '[' + i + ']')
      if (bad) return bad
    }
    return ''
  }
  const tag = Object.prototype.toString.call(v)
  if (tag !== '[object Object]') return path + ' is a ' + tag
  for (const k of Object.keys(v)) {
    const bad = jsonUnsafe(v[k], path + '.' + k)
    if (bad) return bad
  }
  return ''
}

export function run (t, OP, env) {
  const S = OP.Save
  const store = env.ctx.localStorage
  const wipe = () => { store.clear() }
  const plant = (k, v) => { store.setItem(k, v) }

  wipe()

  /* ---------- defaults ---------- */

  t.section('a fresh profile is complete and storable')
  const d = S.defaults()
  t.eq(S.SCHEMA_VERSION, 1, 'the schema starts at version 1')
  t.ok(Number.isInteger(S.SCHEMA_VERSION) && S.SCHEMA_VERSION >= 1, 'and is a positive integer')
  t.ok(completeProfile(OP, d), 'defaults() has every field the game reads')
  t.eq(d.settings.gameSpeed, 1, 'the game starts at normal speed')
  t.eq(d.settings.showTrails, true, 'trails on by default')
  t.eq(d.settings.confirmSell, true, 'selling asks for confirmation by default')
  t.eq(d.settings.autostart, false, 'autostart is opt-in')
  t.between(d.settings.musicVolume, 0, 1, 'music volume is a unit value')
  t.between(d.settings.sfxVolume, 0, 1, 'sfx volume is a unit value')
  t.eq(Object.keys(d.settings).length, SETTING_KEYS.length, 'and there are no surprise settings')
  for (const k of COUNTERS) t.eq(d.stats[k], 0, `stats.${k} starts at zero`)
  t.deep(d.stats.bestRound, {}, 'no best rounds yet')
  t.deep(d.completions, {}, 'nothing completed')
  t.deep(d.unlockedTowers, [], 'nothing unlocked')
  t.deep(d.seenBalloons, [], 'the bestiary is empty')
  t.eq(jsonUnsafe(d), '', 'a default profile contains nothing but JSON — no functions, Maps or Sets')
  t.deep(canon(JSON.parse(JSON.stringify(d))), canon(d), 'and survives a JSON round-trip unchanged')

  t.section('defaults() shares no state between calls')
  const d2 = S.defaults()
  t.neq(d2.settings, d.settings, 'each call gets its own settings object')
  t.neq(d2.stats.bestRound, d.stats.bestRound, 'and its own bestRound map')
  d.settings.musicVolume = 0.123
  d.stats.gamesPlayed = 99
  d.unlockedTowers.push('acorn-fox')
  t.eq(S.defaults().settings.musicVolume, d2.settings.musicVolume, 'mutating one does not poison the next')
  t.eq(S.defaults().stats.gamesPlayed, 0, 'counters stay fresh')
  t.deep(S.defaults().unlockedTowers, [], 'and so do the unlock lists')

  /* ---------- absent and corrupt storage ---------- */

  t.section('an absent entry loads defaults')
  wipe()
  t.eq(store.getItem(S.PROFILE_KEY), null, 'nothing is stored')
  let loaded = null
  t.noThrow(() => { loaded = S.load() }, 'load() on empty storage does not throw')
  t.deep(canon(loaded), canon(S.defaults()), 'and returns exactly the defaults')

  t.section('every corrupt entry falls back to defaults instead of throwing')
  const validStr = JSON.stringify(S.defaults())
  const CORRUPT = [
    ['an unterminated object', '{'],
    ['a truncated write', validStr.slice(0, Math.floor(validStr.length / 2))],
    ['a JSON null', 'null'],
    ['an empty array', '[]'],
    ['an array of profiles', '[{"schemaVersion":1,"stats":{"gamesPlayed":3}}]'],
    ['a bare JSON string', '"profile"'],
    ['a bare JSON number', '5'],
    ['a JSON false', 'false'],
    ['the literal text undefined', 'undefined'],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['HTML from a captive portal', '<!doctype html><html><body>login</body></html>'],
    ['an object of unknown shape', '{"hello":"there","list":[1,2,3]}'],
    ['known keys with wrong types', '{"settings":"nope","stats":[],"completions":3,"unlockedTowers":{},"seenBalloons":7}'],
    ['a settings block full of junk', '{"schemaVersion":1,"settings":{"musicVolume":"loud","gameSpeed":[],"showTrails":null}}'],
    ['a version from the future', '{"schemaVersion":99,"stats":{"gamesPlayed":42},"settings":{"warpDrive":true}}'],
    ['a negative version', '{"schemaVersion":-4,"stats":{"gamesPlayed":2}}']
  ]
  for (const [label, raw] of CORRUPT) {
    wipe()
    plant(S.PROFILE_KEY, raw)
    let got = null
    t.noThrow(() => { got = S.load() }, `${label} does not throw`)
    t.ok(completeProfile(OP, got), `${label} yields a complete profile`)
  }

  t.section('a future-version profile is replaced, not partially believed')
  wipe()
  plant(S.PROFILE_KEY, '{"schemaVersion":99,"stats":{"gamesPlayed":42,"bestRound":{"glade":60}}}')
  const future = S.load()
  t.eq(future.stats.gamesPlayed, 0, 'no counter is carried over from a schema this build cannot read')
  t.deep(future.stats.bestRound, {}, 'and neither is progression')
  t.deep(canon(future), canon(S.defaults()), 'the whole profile is the default one')

  /* ---------- migrate ---------- */

  t.section('migrate rejects anything that is not a profile')
  for (const junk of [null, undefined, 0, 7, '', 'profile', true, [], [1, 2], NaN]) {
    t.deep(canon(S.migrate(junk)), canon(S.defaults()), `migrate(${JSON.stringify(junk) || String(junk)}) gives defaults`)
  }

  t.section('migrate is a pure function of its input')
  const legacy = {
    stats: { gamesPlayed: 4, gamesWon: 1, totalPops: 900, bestRound: { glade: 12 } },
    settings: { musicVolume: 0.25, autostart: true },
    completions: { glade: { easy: { standard: true } } },
    unlockedTowers: ['elder-owl', 'acorn-fox'],
    seenBalloons: ['red', 'ceramic']
  }
  const before = JSON.stringify(legacy)
  const m1 = S.migrate(legacy)
  const m2 = S.migrate(legacy)
  t.eq(JSON.stringify(legacy), before, 'migrate does not mutate its input')
  t.deep(canon(m2), canon(m1), 'migrating the same input twice gives equal output')
  t.neq(m1, m2, 'and a distinct object each time')
  t.neq(m1.stats, legacy.stats, 'the result shares no sub-object with the input')
  m1.stats.gamesPlayed = 1234
  t.eq(legacy.stats.gamesPlayed, 4, 'so mutating the result cannot reach back into the input')

  t.section('migrate is idempotent, which is what makes save/load lossless')
  const once = S.migrate(legacy)
  t.deep(canon(S.migrate(once)), canon(once), 'migrate(migrate(x)) equals migrate(x)')

  t.section('a missing version is treated as unversioned and upgraded in place')
  t.eq(once.schemaVersion, S.SCHEMA_VERSION, 'the result is stamped with the current version')
  t.eq(once.stats.gamesPlayed, 4, 'recognised counters survive')
  t.eq(once.stats.gamesWon, 1, 'all of them')
  t.eq(once.stats.totalPops, 900, 'including pops')
  t.eq(once.stats.roundsCleared, 0, 'and an absent counter defaults to zero')
  t.eq(once.stats.bestRound.glade, 12, 'per-map progression survives')
  t.eq(once.settings.musicVolume, 0.25, 'stored settings survive')
  t.eq(once.settings.autostart, true, 'including booleans')
  t.eq(once.settings.sfxVolume, S.defaults().settings.sfxVolume, 'and an absent setting takes its default')
  t.eq(once.completions.glade.easy.standard, true, 'completions survive')
  t.deep(once.unlockedTowers, ['acorn-fox', 'elder-owl'], 'unlocks survive, deduped and sorted')

  t.section('a non-integer version takes the migrate path rather than the reject path')
  const fractional = S.migrate({ schemaVersion: 1.5, stats: { gamesPlayed: 6 } })
  t.eq(fractional.stats.gamesPlayed, 6, 'its data is kept')
  t.eq(fractional.schemaVersion, S.SCHEMA_VERSION, 'and the version is normalised')

  t.section('the migration engine really steps — proved by pretending to be version 2')
  // With one live version there is no hop to observe, and an unexercised
  // migration loop is one that breaks the day it is first needed. So stand up a
  // version 2 the way a future build would: one MIGRATIONS entry plus the bump.
  const realVersion = S.SCHEMA_VERSION
  try {
    let ran = 0
    S.SCHEMA_VERSION = 2
    S.MIGRATIONS[1] = function (old) {
      ran++
      old.stats = old.stats || {}
      old.stats.totalCash = (old.stats.totalCash || 0) + 500
      return old
    }
    const stepped = S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 2, totalCash: 100 } })
    t.eq(ran, 1, 'the from-version-1 step ran exactly once')
    t.eq(stepped.schemaVersion, 2, 'the result is stamped with the new version')
    t.eq(stepped.stats.totalCash, 600, "and carries the step's change")
    t.eq(stepped.stats.gamesPlayed, 2, 'while fields the step ignored came across untouched')

    const already = S.migrate({ schemaVersion: 2, stats: { gamesPlayed: 9 } })
    t.eq(already.stats.gamesPlayed, 9, 'a profile already at the current version is kept')
    t.eq(ran, 1, 'and no step re-runs on it')

    const chained = S.migrate({ stats: { gamesPlayed: 1 } })
    t.eq(chained.schemaVersion, 2, 'an unversioned profile walks the whole chain')
    t.eq(ran, 2, 'running every step on the way')

    S.MIGRATIONS[1] = function () { throw new Error('a future migration step with a bug in it') }
    let thrown = null
    t.noThrow(() => { thrown = S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 5 } }) },
      'a migration step that throws does not take the boot down with it')
    t.deep(canon(thrown), canon(S.defaults()), 'it loses the profile instead')

    S.MIGRATIONS[1] = function () { return 'not a profile' }
    t.deep(canon(S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 5 } })), canon(S.defaults()),
      'and a step that returns junk is caught too')

    delete S.MIGRATIONS[1]
    t.deep(canon(S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 5 } })), canon(S.defaults()),
      'a version with no registered step gives defaults rather than a guess')
  } finally {
    S.SCHEMA_VERSION = realVersion
    delete S.MIGRATIONS[1]
  }
  t.eq(S.SCHEMA_VERSION, realVersion, 'the real schema version is restored')
  t.eq(S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 5 } }).stats.gamesPlayed, 5,
    'and the real migration path still works')

  t.section('an unknown-shaped object degrades field by field, not all at once')
  const partial = S.migrate({ schemaVersion: 1, stats: { gamesPlayed: 3 }, settings: 'broken', completions: [1, 2] })
  t.eq(partial.stats.gamesPlayed, 3, 'good data in a bad object is still kept')
  t.deep(canon(partial.settings), canon(S.defaults().settings), 'the mangled settings block falls back wholesale')
  t.deep(partial.completions, {}, 'and so does a mangled completions block')

  t.section('normalisation is strict about ranges and shapes')
  const dirty = S.migrate({
    schemaVersion: 1,
    settings: { musicVolume: 5, sfxVolume: -2, gameSpeed: 9, showTrails: 'yes', confirmSell: 0, autostart: 1 },
    stats: {
      gamesPlayed: -3, gamesWon: 2.7, roundsCleared: 'lots', totalPops: Infinity, totalCash: 1e6,
      bestRound: { glade: 40, hollow: 0, ridge: -5, marsh: 'x', '': 9 }
    },
    completions: {
      glade: { hard: { standard: true, purist: false, deflation: 'yes' } },
      hollow: { easy: {} },
      ridge: 'nope'
    },
    unlockedTowers: ['fox', 'fox', 7, null, '', 'badger'],
    seenBalloons: 'red'
  })
  t.eq(dirty.settings.musicVolume, 1, 'a volume above range clamps to 1')
  t.eq(dirty.settings.sfxVolume, 0, 'and below range clamps to 0')
  t.eq(dirty.settings.gameSpeed, 3, 'game speed clamps to 3')
  t.eq(dirty.settings.showTrails, true, 'an uncoercible boolean takes its default')
  t.eq(dirty.settings.confirmSell, false, '0 reads as false')
  t.eq(dirty.settings.autostart, true, 'and 1 as true')
  t.eq(dirty.stats.gamesPlayed, 0, 'a negative counter becomes 0')
  t.eq(dirty.stats.gamesWon, 2, 'a fractional counter is floored')
  t.eq(dirty.stats.roundsCleared, 0, 'a non-numeric counter becomes 0')
  t.eq(dirty.stats.totalPops, 0, 'Infinity is not a counter')
  t.eq(dirty.stats.totalCash, 1e6, 'and a large honest number is kept')
  t.eq(dirty.stats.bestRound.glade, 40, 'a real best round is kept')
  t.eq(dirty.stats.bestRound.hollow, undefined, 'round 0 is not a best round')
  t.eq(dirty.stats.bestRound.ridge, undefined, 'nor is a negative one')
  t.eq(dirty.stats.bestRound.marsh, undefined, 'nor a non-numeric one')
  t.eq(dirty.stats.bestRound[''], undefined, 'and an empty map key is dropped')
  t.eq(dirty.completions.glade.hard.standard, true, 'a true completion is kept')
  t.eq(dirty.completions.glade.hard.purist, undefined, 'false is not a completion')
  t.eq(dirty.completions.glade.hard.deflation, undefined, 'and neither is a truthy non-true value')
  t.eq(dirty.completions.hollow, undefined, 'a branch with no surviving leaf is dropped entirely')
  t.eq(dirty.completions.ridge, undefined, 'and so is a non-object branch')
  t.deep(dirty.unlockedTowers, ['badger', 'fox'], 'unlock lists are deduped, cleaned and sorted')
  t.deep(dirty.seenBalloons, [], 'a non-array bestiary list becomes empty')
  t.eq(jsonUnsafe(dirty), '', 'and the whole result is still pure JSON')

  /* ---------- hostile object keys ---------- */

  t.section('a __proto__ key in stored data cannot reach Object.prototype')
  // The profile supplies object KEYS — map, difficulty and mode names. Two traps:
  //
  //   `obj.__proto__ = {}` stores nothing. It reaches the inherited setter and
  //   REPLACES the object's prototype, so `if (!out[k]) out[k] = {}` followed by
  //   `out[k][d] = {}` writes onto Object.prototype itself. Every object in the
  //   running game then carries that property, permanently. JSON.parse makes
  //   `__proto__` a genuine own enumerable property, so hasOwnProperty does NOT
  //   filter it out.
  //
  // The discriminating assertion is NOT a deep-compare of `completions` — that
  // passes even when the write escaped, because the escaped value never lands in
  // `completions` at all. It has to be a fresh object built INSIDE the game,
  // asked whether it inherited anything. `{}` built here is the wrong realm: the
  // harness VM has its own Object.prototype, so a host-realm literal would show
  // nothing either way and the assertion would be vacuous.
  const POISON = [
    ['a poisoned map key', '{"schemaVersion":1,"completions":{"__proto__":{"easy":{"standard":true}}}}', 'easy'],
    ['a poisoned difficulty key', '{"schemaVersion":1,"completions":{"glade":{"__proto__":{"standard":true}}}}', 'standard'],
    ['a poisoned bestRound key', '{"schemaVersion":1,"stats":{"bestRound":{"__proto__":{"leaked":1}}}}', 'leaked']
  ]
  for (const [label, raw, probeKey] of POISON) {
    wipe()
    plant(S.PROFILE_KEY, raw)
    let got = null
    t.noThrow(() => { got = S.load() }, `${label} does not throw`)
    t.ok(completeProfile(OP, got), `${label} still yields a complete profile`)
    t.eq(S.defaults()[probeKey], undefined,
      `${label} leaks no "${probeKey}" onto every object the game builds`)
    t.eq(S.migrate({})[probeKey], undefined, `and none onto a migrated one either`)
  }

  t.section('a poisoned mode key drops the leaf instead of writing through it')
  wipe()
  plant(S.PROFILE_KEY, '{"schemaVersion":1,"completions":{"glade":{"easy":{"__proto__":true,"standard":true}}}}')
  const poisonLeaf = S.load()
  t.eq(poisonLeaf.completions.glade.easy.standard, true, 'the honest sibling leaf survives')
  t.eq(own(poisonLeaf.completions.glade.easy, '__proto__'), false, 'and the poisoned one was not stored')
  t.eq(S.defaults().standard, undefined, 'with nothing leaked onto the prototype')

  t.section('recordResult cannot be talked into poisoning the prototype either')
  // A second, independent code path: recordResult writes completions directly and
  // has its own existence tests.
  for (const [field, res] of [
    ['mapKey', { mapKey: '__proto__', difficulty: 'medium', mode: 'standard', won: true, round: 5 }],
    ['difficulty', { mapKey: 'glade', difficulty: '__proto__', mode: 'standard', won: true, round: 5 }],
    ['mode', { mapKey: 'glade', difficulty: 'medium', mode: '__proto__', won: true, round: 5 }]
  ]) {
    let rec = null
    t.noThrow(() => { rec = S.recordResult(S.defaults(), res) }, `a result with a __proto__ ${field} does not throw`)
    t.eq(rec.stats.gamesPlayed, 1, `the game is still counted despite the __proto__ ${field}`)
    t.eq(S.defaults().medium, undefined, `no "medium" leaked onto the prototype via ${field}`)
    t.eq(S.defaults().standard, undefined, `and no "standard" either via ${field}`)
    t.eq(jsonUnsafe(rec), '', `and the profile is still pure JSON after a __proto__ ${field}`)
  }
  const pKey = S.recordResult(S.defaults(), { mapKey: '__proto__', difficulty: 'medium', mode: 'standard', won: true, round: 5 })
  t.deep(pKey.completions, {}, 'a completion named __proto__ is refused, not stored')
  t.deep(pKey.stats.bestRound, {}, 'and so is a best round on it')

  t.section('an inherited-name key is stored honestly rather than written through')
  // `constructor`, `toString` and friends are truthy on any plain object, so a
  // truthiness existence test skips creating the branch and writes onto the
  // inherited value — mutating something global AND losing the entry. Assignment
  // to these is safe once existence is tested with hasOwnProperty, so the correct
  // behaviour is to keep them, not to drop them.
  wipe()
  plant(S.PROFILE_KEY, '{"schemaVersion":1,"completions":{"constructor":{"toString":{"valueOf":true}}}}')
  const inherited = S.load()
  t.eq(own(inherited.completions, 'constructor'), true, 'a map key named "constructor" became a real own key')
  t.eq(inherited.completions.constructor.toString.valueOf, true, 'and its whole branch survived intact')
  t.eq(S.defaults().toString(), '[object Object]', 'while Object.prototype.toString still works')
  t.eq(S.defaults().valueOf, Object.getPrototypeOf(S.migrate({})).valueOf, 'and valueOf was not replaced')
  t.eq(jsonUnsafe(inherited), '', 'and the profile is still pure JSON')
  t.eq(S.save(inherited), true, 'it stores')
  t.eq(own(S.load().completions, 'constructor'), true, 'and survives a full round-trip')

  t.section('a __proto__ entry in a key list is dropped')
  // These lists get turned into lookup objects by the shop and the bestiary.
  const listPoison = S.migrate({ schemaVersion: 1, unlockedTowers: ['__proto__', 'acorn-fox'], seenBalloons: ['__proto__'] })
  t.deep(listPoison.unlockedTowers, ['acorn-fox'], 'the reserved key is gone, the real one kept')
  t.deep(listPoison.seenBalloons, [], 'and a list of nothing but reserved keys is empty')
  const listMerge = S.recordResult(S.defaults(), { unlockedTowers: ['__proto__', 'elder-owl'], seenBalloons: ['__proto__', 'red'] })
  t.deep(listMerge.unlockedTowers, ['elder-owl'], 'merging drops it too')
  t.deep(listMerge.seenBalloons, ['red'], 'on both lists')

  /* ---------- counter range ---------- */

  t.section('lifetime counters stay inside the exact-integer range')
  // Past MAX_SAFE_INTEGER, `+= 1` stops changing the number: a counter that gets
  // there is frozen for the life of the profile, and one hand-edited to 1e308
  // freezes on its first save.
  const huge = S.migrate({
    schemaVersion: 1,
    stats: { totalCash: 1e308, totalPops: 1e21, gamesPlayed: Number.MAX_SAFE_INTEGER + 4096, roundsCleared: 9e15 }
  })
  for (const k of COUNTERS) {
    t.ok(Number.isSafeInteger(huge.stats[k]), `stats.${k} is a safe integer however absurd the stored value`)
  }
  t.eq(huge.stats.totalCash, Number.MAX_SAFE_INTEGER, 'an absurd stored counter clamps rather than freezing')
  t.eq(huge.stats.roundsCleared, 9e15, 'a large-but-exact counter is kept as it is')
  t.eq(jsonUnsafe(huge), '', 'and the result is still pure JSON')

  const saturated = S.defaults()
  saturated.stats.totalPops = Number.MAX_SAFE_INTEGER
  saturated.stats.totalCash = 1e308
  S.recordResult(saturated, { pops: 1000, cash: 1000, roundsCleared: 5 })
  for (const k of COUNTERS) {
    t.ok(Number.isSafeInteger(saturated.stats[k]), `accumulating keeps stats.${k} a safe integer`)
  }
  t.eq(saturated.stats.gamesPlayed, 1, 'while an unsaturated counter still counts normally')
  t.eq(saturated.stats.roundsCleared, 5, 'and still accumulates honestly')

  /* ---------- save / load round-trip ---------- */

  t.section('save/load round-trips losslessly')
  wipe()
  const p = S.defaults()
  p.settings.musicVolume = 0.35
  p.settings.sfxVolume = 0
  p.settings.showTrails = false
  p.settings.autostart = true
  p.settings.gameSpeed = 3
  p.stats.gamesPlayed = 11
  p.stats.gamesWon = 4
  p.stats.roundsCleared = 512
  p.stats.totalPops = 98765
  p.stats.totalCash = 43210
  p.stats.bestRound = { glade: 60, hollow: 34 }
  p.completions = { glade: { medium: { standard: true }, hard: { purist: true } } }
  p.unlockedTowers = ['acorn-fox', 'elder-owl']
  p.seenBalloons = ['ceramic', 'red', 'wraith']
  t.eq(S.save(p), true, 'saving reports success')
  t.ok(typeof store.getItem(S.PROFILE_KEY) === 'string', 'a string landed in localStorage')
  t.noThrow(() => JSON.parse(store.getItem(S.PROFILE_KEY)), 'and it is valid JSON')
  const back = S.load()
  t.deep(canon(back), canon(p), 'everything came back exactly as it went in')
  t.eq(back.settings.gameSpeed, 3, 'including game speed')
  t.eq(back.stats.bestRound.hollow, 34, 'and per-map best rounds')
  t.eq(back.completions.glade.hard.purist, true, 'and completion flags')
  t.deep(back.seenBalloons, ['ceramic', 'red', 'wraith'], 'and the bestiary')
  t.eq(S.save(back), true, 'saving what was loaded works')
  t.deep(canon(S.load()), canon(back), 'and a second round-trip changes nothing')

  t.section('save refuses a caller bug instead of overwriting a real profile with defaults')
  for (const junk of [null, undefined, 'profile', 42, [], true]) {
    t.eq(S.save(junk), false, `save(${JSON.stringify(junk) || String(junk)}) reports failure`)
  }
  t.deep(canon(S.load()), canon(p), 'and the stored profile is untouched')

  t.section('settings persist across a save/load cycle')
  wipe()
  let prof = S.load()
  t.eq(S.setSetting(prof, 'sfxVolume', 0.4), prof, 'setSetting returns the same profile object')
  S.setSetting(prof, 'confirmSell', false)
  S.setSetting(prof, 'gameSpeed', 2)
  S.save(prof)
  prof = S.load()
  t.eq(prof.settings.sfxVolume, 0.4, 'a volume persisted')
  t.eq(prof.settings.confirmSell, false, 'a toggle persisted')
  t.eq(prof.settings.gameSpeed, 2, 'and the speed persisted')
  t.eq(prof.settings.musicVolume, S.defaults().settings.musicVolume, 'untouched settings kept their defaults')

  t.section('setSetting coerces, clamps and refuses to invent keys')
  prof = S.defaults()
  S.setSetting(prof, 'musicVolume', 5)
  t.eq(prof.settings.musicVolume, 1, 'a volume above 1 clamps')
  S.setSetting(prof, 'musicVolume', -3)
  t.eq(prof.settings.musicVolume, 0, 'and below 0 clamps')
  S.setSetting(prof, 'musicVolume', 0.5)
  S.setSetting(prof, 'musicVolume', 'loud')
  t.eq(prof.settings.musicVolume, 0.5, 'an uncoercible value leaves the current one alone')
  S.setSetting(prof, 'gameSpeed', 99)
  t.eq(prof.settings.gameSpeed, 3, 'game speed clamps to 3')
  S.setSetting(prof, 'gameSpeed', 0)
  t.eq(prof.settings.gameSpeed, 1, 'and up to 1')
  S.setSetting(prof, 'gameSpeed', 2.6)
  t.eq(prof.settings.gameSpeed, 3, 'and rounds to a whole step')
  S.setSetting(prof, 'showTrails', 0)
  t.eq(prof.settings.showTrails, false, '0 sets a toggle off')
  S.setSetting(prof, 'showTrails', 1)
  t.eq(prof.settings.showTrails, true, 'and 1 sets it on')
  S.setSetting(prof, 'autostart', 'false')
  t.eq(prof.settings.autostart, false, 'and the string "false" reads as off')
  S.setSetting(prof, 'nonsense', 42)
  t.eq(prof.settings.nonsense, undefined, 'an unknown setting key is ignored')
  t.eq(Object.keys(prof.settings).length, SETTING_KEYS.length, 'and adds nothing to the profile')
  t.eq(jsonUnsafe(prof), '', 'the profile is still storable')

  t.section('a stored game speed can be handed straight to the sim')
  const speedSim = makeSim(OP, {})
  S.setSetting(prof, 'gameSpeed', 7)
  t.eq(OP.Sim.setSpeed(speedSim, prof.settings.gameSpeed), prof.settings.gameSpeed,
    'Save clamps game speed exactly the way Sim.setSpeed does')

  t.section('setSetting on a non-profile hands back a usable one')
  let rescued = null
  t.noThrow(() => { rescued = S.setSetting(null, 'gameSpeed', 2) }, 'no throw')
  t.ok(completeProfile(OP, rescued), 'and the result is a complete profile')
  t.eq(rescued.settings.gameSpeed, 2, 'with the setting applied')

  /* ---------- recordResult ---------- */

  t.section('recording a win updates the right counters and nothing else')
  const prog = S.defaults()
  prog.settings.musicVolume = 0.11
  prog.stats.bestRound = { hollow: 45 }
  prog.completions = { hollow: { easy: { standard: true } } }
  prog.unlockedTowers = ['elder-owl']
  prog.seenBalloons = ['red']
  const returned = S.recordResult(prog, {
    mapKey: 'glade', difficulty: 'hard', mode: 'standard', won: true,
    round: 80, roundsCleared: 78, pops: 12000, cash: 34000,
    unlockedTowers: ['acorn-fox', 'elder-owl'], seenBalloons: ['ceramic', 'red']
  })
  t.eq(returned, prog, 'recordResult mutates and returns the profile it was given')
  t.eq(prog.stats.gamesPlayed, 1, 'one game played')
  t.eq(prog.stats.gamesWon, 1, 'and won')
  t.eq(prog.stats.roundsCleared, 78, 'rounds cleared accumulated')
  t.eq(prog.stats.totalPops, 12000, 'pops accumulated')
  t.eq(prog.stats.totalCash, 34000, 'cash accumulated')
  t.eq(prog.stats.bestRound.glade, 80, 'the best round for this map was recorded')
  t.eq(prog.stats.bestRound.hollow, 45, 'and another map was left alone')
  t.eq(prog.completions.glade.hard.standard, true, 'the completion cell was flagged')
  t.eq(prog.completions.hollow.easy.standard, true, 'an unrelated completion survived')
  t.eq(prog.settings.musicVolume, 0.11, 'settings were not touched')
  t.deep(prog.unlockedTowers, ['acorn-fox', 'elder-owl'], 'unlocks merged without duplicating')
  t.deep(prog.seenBalloons, ['ceramic', 'red'], 'and so did the bestiary')
  t.eq(jsonUnsafe(prog), '', 'the profile is still pure JSON')

  t.section('a loss counts as a game but flags no completion')
  S.recordResult(prog, {
    mapKey: 'glade', difficulty: 'easy', mode: 'deflation', won: false,
    round: 12, roundsCleared: 11, pops: 500, cash: 900
  })
  t.eq(prog.stats.gamesPlayed, 2, 'the game was counted')
  t.eq(prog.stats.gamesWon, 1, 'but not as a win')
  t.eq(prog.completions.glade.easy, undefined, 'and no completion cell was created')
  t.eq(prog.stats.roundsCleared, 89, 'rounds cleared still accumulate on a loss')
  t.eq(prog.stats.totalPops, 12500, 'as do pops')
  t.eq(prog.stats.bestRound.glade, 80, 'and a worse run does not lower the best round')

  t.section('best round ratchets upward only')
  S.recordResult(prog, { mapKey: 'glade', difficulty: 'hard', mode: 'standard', won: false, round: 95 })
  t.eq(prog.stats.bestRound.glade, 95, 'a better run raises it')
  S.recordResult(prog, { mapKey: 'glade', difficulty: 'hard', mode: 'standard', won: false, round: 3 })
  t.eq(prog.stats.bestRound.glade, 95, 'a worse one does not')

  t.section('a second mode on the same map and difficulty adds a cell')
  S.recordResult(prog, { mapKey: 'glade', difficulty: 'hard', mode: 'purist', won: true, round: 100, roundsCleared: 95 })
  t.eq(prog.completions.glade.hard.purist, true, 'the new mode is flagged')
  t.eq(prog.completions.glade.hard.standard, true, 'and the old one is still there')
  t.eq(prog.stats.gamesWon, 2, 'the win was counted')

  t.section('a result missing its identity still counts the game')
  const noMap = S.recordResult(S.defaults(), { won: true, roundsCleared: 5, pops: 10, cash: 20 })
  t.eq(noMap.stats.gamesPlayed, 1, 'the game was counted')
  t.eq(noMap.stats.gamesWon, 1, 'and the win')
  t.deep(noMap.stats.bestRound, {}, 'but no best round was invented')
  t.deep(noMap.completions, {}, 'and no completion cell')

  t.section('round defaults to rounds cleared when the result does not say')
  const implied = S.recordResult(S.defaults(), { mapKey: 'ridge', roundsCleared: 27 })
  t.eq(implied.stats.bestRound.ridge, 27, 'the best round falls back to the rounds cleared')

  t.section('a junk result records nothing rather than throwing')
  const guard = S.recordResult(S.defaults(), { mapKey: 'glade', difficulty: 'hard', mode: 'standard', won: true, round: 40, roundsCleared: 39 })
  const guardStr = JSON.stringify(canon(guard))
  for (const junk of [undefined, null, 'won', 42, [], true]) {
    t.noThrow(() => S.recordResult(guard, junk), `recordResult with ${String(junk)} does not throw`)
  }
  t.eq(JSON.stringify(canon(guard)), guardStr, 'and the profile is byte-identical afterwards')

  t.section('recordResult repairs a hand-made profile instead of throwing')
  let hand = null
  t.noThrow(() => { hand = S.recordResult({ stats: 'gone', completions: null }, { mapKey: 'glade', difficulty: 'easy', mode: 'standard', won: true, round: 40, roundsCleared: 40 }) },
    'a mangled profile does not throw')
  t.ok(completeProfile(OP, hand), 'it is repaired into a complete profile')
  t.eq(hand.stats.gamesWon, 1, 'and the result was still recorded')
  t.eq(hand.completions.glade.easy.standard, true, 'including the completion')
  let fromNothing = null
  t.noThrow(() => { fromNothing = S.recordResult(null, { mapKey: 'glade', won: true, roundsCleared: 1 }) }, 'so does no profile at all')
  t.ok(completeProfile(OP, fromNothing), 'which produces a fresh complete profile')
  t.eq(fromNothing.stats.gamesPlayed, 1, 'with the game counted')

  t.section('progression survives storage')
  wipe()
  t.eq(S.save(prog), true, 'a progressed profile saves')
  t.deep(canon(S.load()), canon(prog), 'and loads back identically')

  /* ---------- the run save ---------- */

  const SET = {
    1: { groups: [{ tier: 'red', count: 10, spacing: 0.3 }] },
    2: { groups: [{ tier: 'green', count: 12, spacing: 0.25 }] },
    3: { groups: [{ tier: 'ceramic', count: 4, spacing: 0.6 }] }
  }
  const upPath = n => ({
    name: n,
    tiers: [1, 2, 3, 4, 5].map(i => ({ name: n + i, cost: i * 100, desc: 'x', apply: s => { s.damage += 1 } }))
  })
  if (!OP.PROJ_KINDS['save-pellet']) OP.declareProjKind('save-pellet', { shape: 'dart', tint: '#c9a227', size: 4 })
  if (!OP.TOWERS['save-gun']) {
    OP.Towers.define({
      key: 'save-gun', name: 'Save Gun', family: 'primary', cost: 200, footprint: 12,
      base: { range: 220, cooldown: 0.4, damage: 1, pierce: 2, dmgType: OP.DMG.SHARP, projSpeed: 600 },
      paths: [upPath('A'), upPath('B'), upPath('C')],
      fire: function (sim, tower, target) {
        const s = tower.s
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'save-pellet', damage: s.damage, dmgType: s.dmgType,
          pierce: s.pierce, radius: 4, life: 2, ownerId: tower.id, camoDetect: s.camoDetect
        }, OP.M.angleTo(tower.x, tower.y, target.x, target.y), s.projSpeed)
      }
    })
  }

  // A distinct round-set key: makeSim registers whatever key it is handed, and
  // other suites in an --all run also write 'fixture'.
  function liveSim () {
    return makeSim(OP, { trackLength: 2400, cash: 100000, roundSet: SET, roundSetKey: 'save-fixture', seed: 'run-save' })
  }
  const rebuiltMap = () => ({ key: 'test', paths: [straightTrack(OP, 2400)], placement: null, blockers: null })

  t.section('a mid-round run is stored as a snapshot plus a map key')
  wipe()
  const sim = liveSim()
  OP.Towers.place(sim, 'save-gun', 420, 300)
  OP.Towers.place(sim, 'save-gun', 900, 420)
  OP.Sim.startRound(sim, 2)
  OP.Sim.run(sim, 240)
  t.ok(sim.balloons.some(b => b.alive), 'the board has live balloons to save')
  t.ok(sim.round && !sim.round.done, 'and a round in flight')
  t.gt(sim.stats.popped, 0, 'and something has already been popped')

  t.notOk(S.hasRun(), 'no run is stored yet')
  t.eq(S.loadRun(), null, 'and loadRun says so')
  t.eq(S.saveRun(sim, 'test'), true, 'saving the run reports success')
  t.ok(S.hasRun(), 'hasRun now reflects reality')

  const rawRun = store.getItem(S.RUN_KEY)
  t.ok(typeof rawRun === 'string' && rawRun.length > 0, 'a string landed in localStorage')
  t.notOk(/"points"/.test(rawRun), 'the stored run contains no polyline points — Tracks are derived geometry')
  t.notOk(/"paths"/.test(rawRun), 'and no path list at all')

  const runEntry = S.loadRun()
  t.ok(runEntry !== null, 'loadRun returns an entry')
  t.eq(runEntry.mapKey, 'test', 'naming the map to rebuild')
  t.ok(isObj(runEntry.snapshot), 'and carrying the snapshot')
  t.eq(runEntry.snapshot.map, undefined, 'the snapshot holds no map object')
  t.eq(typeof runEntry.snapshot.mapKey, 'string', 'only its key')
  t.eq(runEntry.snapshot.roundSetKey, 'save-fixture', 'the round SET KEY is recorded')
  t.eq(runEntry.snapshot.roundSet, undefined, 'and never the round table itself')
  t.eq(runEntry.snapshot.version, OP.VERSION, 'the build version is recorded')
  t.gt(runEntry.savedAt, 0, 'and a timestamp')
  t.eq(jsonUnsafe(runEntry.snapshot), '', 'the snapshot is pure JSON')

  t.section('a stored run resumes a live sim exactly')
  const resumed = OP.Sim.deserialize(runEntry.snapshot, rebuiltMap())
  t.eq(resumed.tick, sim.tick, 'the tick matches')
  t.eq(resumed.cash, sim.cash, 'cash matches')
  t.eq(resumed.lives, sim.lives, 'lives match')
  t.eq(resumed.roundIndex, sim.roundIndex, 'the round index matches')
  t.eq(resumed.towers.length, sim.towers.length, 'the towers are back')
  t.eq(resumed.balloons.length, sim.balloons.length, 'and the balloons')
  t.eq(resumed.nextEntityId, sim.nextEntityId, 'the id counter resumes where it left off')
  t.eq(OP.Sim.checksum(resumed), OP.Sim.checksum(sim), 'and the checksums are identical')

  // A static compare can pass while a dropped rng field or round group makes the
  // two diverge on the next tick, so run both on and compare again.
  OP.Sim.run(sim, 400)
  OP.Sim.run(resumed, 400)
  t.eq(OP.Sim.checksum(resumed), OP.Sim.checksum(sim), 'and stay identical after four hundred more ticks')
  t.eq(resumed.stats.popped, sim.stats.popped, 'with the same pops')
  t.eq(resumed.cash, sim.cash, 'the same cash')
  t.eq(resumed.lives, sim.lives, 'and the same lives')

  t.section('the map key falls back to the sim map when the caller omits it')
  wipe()
  const noArg = liveSim()
  t.eq(S.saveRun(noArg), true, 'saving with no map key works')
  t.eq(S.loadRun().mapKey, 'test', 'and takes the key off the sim map')

  t.section('clearRun removes it')
  t.eq(S.clearRun(), true, 'clearing reports success')
  t.notOk(S.hasRun(), 'hasRun is false again')
  t.eq(S.loadRun(), null, 'loadRun returns null')
  t.eq(store.getItem(S.RUN_KEY), null, 'and the entry is gone from storage')
  t.eq(S.clearRun(), true, 'clearing again is harmless')

  t.section('a finished game is not a resumable run, and refusing does not destroy the stored one')
  wipe()
  S.saveRun(liveSim(), 'keeper')
  t.eq(S.loadRun().mapKey, 'keeper', 'a good run is stored')
  const dead = liveSim()
  OP.Economy.endGame(dead, 'leaked')
  t.eq(S.saveRun(dead, 'test'), false, 'saving a finished game is refused')
  t.eq(S.loadRun().mapKey, 'keeper', 'and the previously stored run survives')

  t.section('saveRun refuses nonsense without throwing')
  for (const junk of [null, undefined, 'sim', 42, [], {}]) {
    let got = true
    t.noThrow(() => { got = S.saveRun(junk, 'test') }, `saveRun(${String(junk)}) does not throw`)
    t.eq(got, false, 'and reports failure')
  }
  t.eq(S.loadRun().mapKey, 'keeper', 'the stored run is still intact')

  t.section('an unusable run entry reads as no run at all')
  const goodSnap = JSON.parse(store.getItem(S.RUN_KEY)).snapshot
  const BAD_RUNS = [
    ['an unterminated object', '{'],
    ['a JSON null', 'null'],
    ['an array', '[]'],
    ['a bare string', '"run"'],
    ['an empty string', ''],
    ['no snapshot', '{"schemaVersion":1,"mapKey":"test"}'],
    ['a null snapshot', '{"schemaVersion":1,"mapKey":"test","snapshot":null}'],
    ['an empty snapshot', '{"schemaVersion":1,"mapKey":"test","snapshot":{}}'],
    ['a snapshot with no rng state', JSON.stringify({ schemaVersion: 1, mapKey: 'test', snapshot: { tick: 5 } })],
    ['no map key anywhere', JSON.stringify({ schemaVersion: 1, snapshot: { tick: 5, rng: { a: 1 } } })],
    ['a run schema from the future', JSON.stringify({ schemaVersion: 99, mapKey: 'test', snapshot: goodSnap })]
  ]
  for (const [label, raw] of BAD_RUNS) {
    wipe()
    plant(S.RUN_KEY, raw)
    let got
    t.noThrow(() => { got = S.loadRun() }, `${label} does not throw`)
    t.eq(got, null, `${label} reads as no run`)
    t.notOk(S.hasRun(), `${label} leaves hasRun false`)
  }

  t.section('a run whose map key lives only on the snapshot is still usable')
  wipe()
  plant(S.RUN_KEY, JSON.stringify({ schemaVersion: 1, snapshot: { tick: 5, rng: { a: 1, b: 2 }, mapKey: 'hollow' } }))
  const inferred = S.loadRun()
  t.ok(inferred !== null, 'it loads')
  t.eq(inferred.mapKey, 'hollow', 'taking the key from the snapshot')
  t.eq(inferred.savedAt, 0, 'and a missing timestamp reads as 0')

  /* ---------- storage failures ---------- */

  t.section('a storage read that throws still boots the game')
  wipe()
  S.save(S.defaults())
  S.saveRun(liveSim(), 'test')
  const realGet = store.getItem
  try {
    store.getItem = () => { throw new Error('SecurityError: access denied') }
    let got = null
    t.noThrow(() => { got = S.load() }, 'load() survives a throwing getItem')
    t.ok(completeProfile(OP, got), 'and returns a complete default profile')
    t.noThrow(() => S.loadRun(), 'loadRun() survives it too')
    t.eq(S.loadRun(), null, 'reporting no run')
    t.notOk(S.hasRun(), 'and hasRun agrees')
  } finally { store.getItem = realGet }
  t.ok(S.hasRun(), 'once storage works again the run is visible')

  t.section('a quota error is reported, not thrown')
  const realSet = store.setItem
  try {
    store.setItem = () => { throw new Error('QuotaExceededError') }
    let ok = true
    t.noThrow(() => { ok = S.save(S.defaults()) }, 'save() survives a full disk')
    t.eq(ok, false, 'and reports failure through its return value')
    let okRun = true
    t.noThrow(() => { okRun = S.saveRun(liveSim(), 'test') }, 'saveRun() survives it too')
    t.eq(okRun, false, 'and reports failure')
  } finally { store.setItem = realSet }
  t.eq(S.save(S.defaults()), true, 'and writing works again afterwards')

  t.section('no localStorage at all is survivable')
  const realStore = env.ctx.localStorage
  try {
    env.ctx.localStorage = null
    let got = null
    t.noThrow(() => { got = S.load() }, 'load() survives storage being absent')
    t.ok(completeProfile(OP, got), 'returning a complete profile')
    t.eq(S.save(S.defaults()), false, 'save() reports failure')
    t.eq(S.saveRun(liveSim(), 'test'), false, 'saveRun() reports failure')
    t.eq(S.loadRun(), null, 'loadRun() reports no run')
    t.notOk(S.hasRun(), 'hasRun() is false')
    t.eq(S.clearRun(), false, 'clearRun() reports failure')
    let reset = null
    t.noThrow(() => { reset = S.reset() }, 'reset() survives')
    t.ok(completeProfile(OP, reset), 'and still hands back a fresh profile')

    // A half-implemented storage object is just as fatal as none.
    env.ctx.localStorage = { getItem: () => '{}' }
    t.noThrow(() => S.load(), 'a storage object missing setItem/removeItem is refused, not used')
    t.eq(S.save(S.defaults()), false, 'and writes report failure')
  } finally { env.ctx.localStorage = realStore }
  t.eq(S.save(S.defaults()), true, 'real storage is back')

  /* ---------- reset ---------- */

  t.section('reset wipes the profile and the run it belonged to')
  wipe()
  S.save(prog)
  S.saveRun(liveSim(), 'test')
  t.ok(S.hasRun(), 'there is a run to lose')
  const afterReset = S.reset()
  t.deep(canon(afterReset), canon(S.defaults()), 'reset returns a fresh profile')
  t.eq(store.getItem(S.PROFILE_KEY), null, 'the stored profile is gone')
  t.notOk(S.hasRun(), 'and so is the run')
  t.deep(canon(S.load()), canon(S.defaults()), 'a subsequent load gets defaults')

  wipe()
}

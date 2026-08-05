// The difficulty x mode matrix.
//
// The single most valuable thing in here is the unknown-rule-key check. A mode or
// difficulty that misspells a rule field does not throw and does not warn: the key
// lands on sim.rules, nothing ever reads it, and the mode silently does nothing.
// That failure survives a full playthrough looking like a balance problem. So the
// checker is written here, tested against deliberate typos to prove it has teeth,
// and then run over every difficulty and every mode.
//
// Everything else follows from ARCHITECTURE.md §8: a mode is a config delta, never
// a code path. The suite asserts the deltas through the engine sites that honour
// them (Economy, Rounds, Damage) rather than only reading the data back.

export const name = 'modes'
export const needs = ['js/data/difficulties.js', 'js/data/modes.js']

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../loadgame.mjs'
import { straightTrack } from './_fixture.mjs'

export function run (t, OP, env) {
  const D = OP.DIFFICULTIES
  const M = OP.MODES
  const E = OP.Economy
  const S = OP.Sim

  const DIFF_KEYS = ['easy', 'medium', 'hard', 'relentless']
  const MODE_KEYS = ['standard', 'primary-only', 'military-only', 'magic-only', 'deflation',
    'onslaught', 'half-cash', 'double-hp-blimps', 'alternate-waves', 'reverse', 'purist']

  /** A readable label for the junk values fed to the fallback paths below. */
  function fmtJunk (v) {
    if (typeof v === 'number' && Number.isNaN(v)) return 'NaN'
    if (Array.isArray(v)) return '[]'
    if (v && typeof v === 'object') return '{}'
    return JSON.stringify(v) === undefined ? String(v) : JSON.stringify(v)
  }

  /** A fresh sim for a difficulty/mode pair, with a long straight track. */
  function simFor (difficulty, mode, extra) {
    return S.create(OP.modeConfig(mode, difficulty, Object.assign({
      map: { key: 'test', paths: [straightTrack(OP, 4000)], placement: null, blockers: null },
      seed: 'modes'
    }, extra || {})))
  }

  /* ================= registries ================= */

  t.section('both registries exist and are shaped as declared')
  t.ok(D && typeof D === 'object', 'OP.DIFFICULTIES exists')
  t.ok(M && typeof M === 'object', 'OP.MODES exists')
  t.eq(Object.keys(D).length, 4, 'exactly four difficulties')
  t.eq(Object.keys(M).length, 11, 'exactly eleven modes')
  t.deep(OP.DIFFICULTY_ORDER, DIFF_KEYS, 'DIFFICULTY_ORDER is easiest-first')
  t.eq(OP.MODE_ORDER.length, 11, 'MODE_ORDER lists eleven modes')

  // The order arrays are what the menus render. A mode missing from one is a mode
  // the player can never pick; a mode listed twice renders twice.
  t.deep(OP.MODE_ORDER.slice().sort(), Object.keys(M).sort(), 'MODE_ORDER is a permutation of the registry')
  t.eq(new Set(OP.MODE_ORDER).size, 11, 'MODE_ORDER has no duplicates')
  t.deep(OP.DIFFICULTY_ORDER.slice().sort(), Object.keys(D).sort(), 'DIFFICULTY_ORDER is a permutation of the registry')
  t.eq(new Set(OP.DIFFICULTY_ORDER).size, 4, 'DIFFICULTY_ORDER has no duplicates')
  t.deep(OP.MODE_ORDER, MODE_KEYS, 'the eleven modes are exactly the ones §8 names, in menu order')

  t.section('every entry agrees with the key it is registered under')
  for (const k of DIFF_KEYS) {
    t.ok(D[k], `difficulty "${k}" exists`)
    t.eq(D[k].key, k, `difficulty "${k}" carries its own key`)
  }
  for (const k of MODE_KEYS) {
    t.ok(M[k], `mode "${k}" exists`)
    t.eq(M[k].key, k, `mode "${k}" carries its own key`)
  }

  t.section('names and blurbs are real content, not placeholders')
  const allEntries = DIFF_KEYS.map(k => D[k]).concat(MODE_KEYS.map(k => M[k]))
  const names = allEntries.map(e => e.name)
  t.eq(new Set(names).size, names.length, 'every difficulty and mode name is unique')
  const blurbs = allEntries.map(e => e.blurb)
  t.eq(new Set(blurbs).size, blurbs.length, 'no two entries share a blurb')
  for (const e of allEntries) {
    t.ok(typeof e.name === 'string' && e.name.length >= 4, `${e.key} has a display name`)
    t.ok(typeof e.blurb === 'string' && e.blurb.length >= 40, `${e.key} has a non-trivial blurb`)
    t.neq(e.blurb, e.name, `${e.key} blurb is not just the name again`)
    // "reads as a sentence" spelled out, because a lone /[a-z]/ passes on "a".
    // The menu renders these verbatim, so the shape is part of the contract.
    const words = e.blurb.trim().split(/\s+/)
    t.gte(words.length, 10, `${e.key} blurb is prose, not a label`, e.blurb)
    t.ok(/^[A-Z]/.test(e.blurb), `${e.key} blurb opens with a capital`, e.blurb)
    t.ok(/[.!?]$/.test(e.blurb), `${e.key} blurb is punctuated to the end`, e.blurb)
    t.notOk(/\b(TODO|TBD|FIXME|lorem|placeholder|xxx)\b/i.test(e.blurb), `${e.key} blurb is finished copy`)
    t.notOk(/\b(\w+) \1\b/i.test(e.blurb), `${e.key} blurb has no doubled word`, e.blurb)
    // A blurb that just restates the key tells the player nothing they cannot read
    // off the button. Require at least one word that is not in the display name.
    const nameWords = new Set(e.name.toLowerCase().split(/\s+/))
    t.gte(words.filter(w => !nameWords.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length, 8,
      `${e.key} blurb says something the name does not`, e.blurb)
  }

  t.section('no borrowed proper nouns anywhere in the matrix')
  // Same two regexes the shared family floor uses. The acronyms collide with
  // ordinary English, so they are matched case-sensitively.
  const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?|impoppable|apopalypse|chimps)\b/i
  const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/
  for (const e of allEntries) {
    const blob = JSON.stringify({ key: e.key, name: e.name, blurb: e.blurb })
    const found = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(found, `${e.key} uses no borrowed proper nouns` + (found ? ` — found "${found}"` : ''))
  }

  // §11 bans a borrowed name "including in comments", and both these files are
  // mostly comment: the design notes explaining why each mode is a config delta run
  // longer than the data. Reading the entries back through JSON.stringify cannot see
  // any of that, so the two files are scanned whole, as text.
  const DATA_FILES = ['js/data/difficulties.js', 'js/data/modes.js']
  for (const rel of DATA_FILES) {
    t.ok(env.present.indexOf(rel) >= 0, `${rel} ships in the bundle`)
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    const hit = (src.match(BANNED_ANY) || src.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${rel} names no commercial game anywhere, comments included` + (hit ? ` — found "${hit}"` : ''))
    const commentChars = (src.match(/\/\*[\s\S]*?\*\//g) || []).concat(src.match(/\/\/[^\n]*/g) || [])
      .reduce((n, s) => n + s.length, 0)
    t.gt(commentChars, 800,
      `${rel} carries the design prose the scan above is there to police`, `${commentChars} comment chars`)
  }
  // The scan has teeth: the same two regexes catch a planted name.
  const PLANTED = 'js/data/modes.js // a Dart Monkey pops a Bloon'
  t.ok(BANNED_ANY.test(PLANTED) , 'the file scanner would catch a borrowed noun dropped into a comment')
  t.ok(BANNED_CAPS.test('spawns a MOAB at round 40'), 'and the case-sensitive one catches the acronyms')
  t.notOk(BANNED_CAPS.test('a bad build leaks'), 'while ordinary lowercase English is left alone')

  t.section('entries carry no stray top-level fields')
  // ARCHITECTURE §8 sketches the flat shape { lives, cash, rounds } but
  // Sim.resolveRules reads `entry.rules` when it exists, so a flat field sitting
  // beside a `rules` block is dead data that looks live.
  for (const k of DIFF_KEYS) {
    const extra = Object.keys(D[k]).filter(f => ['key', 'name', 'blurb', 'rules'].indexOf(f) < 0)
    t.eq(extra.length, 0, `difficulty ${k} has no fields outside key/name/blurb/rules`, extra.join(','))
    t.ok(D[k].rules && typeof D[k].rules === 'object' && !Array.isArray(D[k].rules), `difficulty ${k} has a rules block`)
  }
  for (const k of MODE_KEYS) {
    const extra = Object.keys(M[k]).filter(f => ['key', 'name', 'blurb', 'rules', 'roundSetKey'].indexOf(f) < 0)
    t.eq(extra.length, 0, `mode ${k} has no fields outside key/name/blurb/rules/roundSetKey`, extra.join(','))
    t.ok(M[k].rules && typeof M[k].rules === 'object' && !Array.isArray(M[k].rules), `mode ${k} has a rules block`)
  }

  /* ================= the unknown-rule-key check ================= */

  t.section('THE typo gate: every rule field named is a field the engine reads')
  const KNOWN = new Set(Object.keys(E.defaultRules()))

  // Rule fields the engine honours that defaultRules() does not pre-declare.
  // Keeping this list here rather than in the data means an author cannot legalise
  // their own typo by adding it. Every entry has to earn its place twice below:
  // it must be genuinely absent from defaultRules(), and a named file in the
  // shipped bundle has to be shown reading it. Nothing is admitted on a promise.
  const EXTRA = ['heroXpMul', 'reversePaths']
  // The file that consumes each one, asserted by name. A substring scan over the
  // whole bundle is satisfied by a comment, so for each field the reader is pinned
  // to the exact file and the exact expression that acts on it.
  const CONSUMER = {
    heroXpMul: { file: 'js/core/heroes.js', needles: ['rules.heroXpMul', 'Heroes.xpRate'] },
    reversePaths: { file: 'js/main.js', needles: ['rules.reversePaths', 'Maps.reversePaths('] }
  }

  /** Rule keys on `obj` that the engine would silently ignore. */
  function unknownKeys (obj) {
    return Object.keys(obj || {}).filter(k => !KNOWN.has(k) && EXTRA.indexOf(k) < 0)
  }

  /** Does the shipped bundle actually read sim.rules.<key> anywhere? */
  function readsRuleField (key) {
    const needle = 'rules.' + key
    for (const rel of env.present) {
      if (readFileSync(resolve(ROOT, rel), 'utf8').indexOf(needle) >= 0) return rel
    }
    return null
  }

  t.gt(KNOWN.size, 10, 'Economy.defaultRules() declares a real vocabulary')

  // EXTRA is derived from the data, not asserted against itself. Every rule key
  // any difficulty or mode actually names, minus the engine's own vocabulary, must
  // be exactly EXTRA — which fails in both directions: a data file that invents a
  // twelfth field, and an EXTRA entry no data file uses (so the gate quietly
  // stopped covering something).
  const namedRuleKeys = new Set()
  for (const k of DIFF_KEYS) for (const f of Object.keys(D[k].rules)) namedRuleKeys.add(f)
  for (const k of MODE_KEYS) for (const f of Object.keys(M[k].rules)) namedRuleKeys.add(f)
  const outsideVocabulary = [...namedRuleKeys].filter(f => !KNOWN.has(f)).sort()
  t.deep(outsideVocabulary, EXTRA.slice().sort(),
    'the rule fields the data names outside defaultRules() are exactly the documented extras')
  t.gt(namedRuleKeys.size, EXTRA.length,
    'and the data names real engine fields too, so the check above is not comparing two empty sets')

  for (const k of EXTRA) {
    t.notOk(KNOWN.has(k), `${k} is genuinely absent from defaultRules() — otherwise drop it from EXTRA`)
    const spec = CONSUMER[k]
    t.ok(spec, `${k} names the file that consumes it`)
    const src = spec ? readFileSync(resolve(ROOT, spec.file), 'utf8') : ''
    for (const needle of (spec ? spec.needles : [])) {
      t.ok(src.indexOf(needle) >= 0, `${spec.file} contains "${needle}", so ${k} has a live consumer`)
    }
    t.ok(env.present.indexOf(spec ? spec.file : '') >= 0,
      `and ${spec ? spec.file : '?'} actually ships in the bundle`)
  }
  t.eq(readsRuleField('heroXpMul'), 'js/core/heroes.js', 'heroXpMul is read by the heroes module')
  t.notOk(readsRuleField('heroXpMull'), 'the scanner does not report a field nothing reads')
  t.notOk(readsRuleField('spacingMul'), 'and it does not report the density field Onslaught deliberately omits')
  t.deep(Object.keys(CONSUMER).sort(), EXTRA.slice().sort(), 'every extra has a named consumer, and no consumer is orphaned')

  // Prove the gate rejects what it is supposed to reject. A checker that passes
  // everything is worse than no checker, because it reads as coverage.
  t.deep(unknownKeys({ startCash: 1, costMul: 2 }), [], 'real fields pass')
  t.deep(unknownKeys({ heroXpMul: 2 }), [], 'the documented extras pass')
  t.deep(unknownKeys({ startCashh: 1 }), ['startCashh'], 'a doubled letter is caught')
  t.deep(unknownKeys({ familes: ['primary'] }), ['familes'], 'a transposed name is caught')
  t.deep(unknownKeys({ allowSelling: false }), ['allowSelling'], 'a plausible-but-wrong name is caught')
  t.deep(unknownKeys({ cashPerPop: 0.5, lives: 1, rounds: [1, 40] }).sort(),
    ['cashPerPop', 'lives', 'rounds'], 'the flat §8 sketch field names are caught too')
  t.deep(unknownKeys({}), [], 'an empty delta has nothing unknown')
  t.deep(unknownKeys(null), [], 'and neither does a missing one')

  t.section('no difficulty or mode names a field the engine ignores')
  for (const k of DIFF_KEYS) {
    const bad = unknownKeys(D[k].rules)
    t.eq(bad.length, 0, `difficulty ${k} sets only real rule fields`, bad.join(','))
  }
  for (const k of MODE_KEYS) {
    const bad = unknownKeys(M[k].rules)
    t.eq(bad.length, 0, `mode ${k} sets only real rule fields`, bad.join(','))
  }

  /* ================= the difficulty table ================= */

  t.section('the table matches ARCHITECTURE §8 exactly')
  const TABLE = {
    easy: { startLives: 200, startCash: 650, costMul: 0.85, firstRound: 1, lastRound: 40 },
    medium: { startLives: 150, startCash: 650, costMul: 1.00, firstRound: 1, lastRound: 60 },
    hard: { startLives: 100, startCash: 650, costMul: 1.08, firstRound: 3, lastRound: 80 },
    relentless: { startLives: 1, startCash: 650, costMul: 1.20, firstRound: 6, lastRound: 100 }
  }
  for (const k of DIFF_KEYS) {
    for (const field of ['startLives', 'startCash', 'costMul', 'firstRound', 'lastRound']) {
      t.eq(D[k].rules[field], TABLE[k][field], `${k}.${field} is ${TABLE[k][field]}`)
    }
  }

  t.section('income scaling: harder pays less, and the ladder is monotonic')
  const ladder = OP.DIFFICULTY_ORDER.map(k => D[k].rules)
  for (let i = 1; i < ladder.length; i++) {
    const from = OP.DIFFICULTY_ORDER[i - 1], to = OP.DIFFICULTY_ORDER[i]
    t.gt(ladder[i].costMul, ladder[i - 1].costMul, `costMul rises ${from} -> ${to}`)
    t.lt(ladder[i].startLives, ladder[i - 1].startLives, `startLives falls ${from} -> ${to}`)
    t.lt(ladder[i].cashPerPopMul, ladder[i - 1].cashPerPopMul, `cash per pop falls ${from} -> ${to}`)
    t.lt(ladder[i].roundBonusMul, ladder[i - 1].roundBonusMul, `round bonus falls ${from} -> ${to}`)
    t.lt(ladder[i].heroXpMul, ladder[i - 1].heroXpMul, `hero XP rate falls ${from} -> ${to}`)
    t.gt(ladder[i].lastRound, ladder[i - 1].lastRound, `the run gets longer ${from} -> ${to}`)
    t.gte(ladder[i].firstRound, ladder[i - 1].firstRound, `and starts no earlier ${from} -> ${to}`)
    t.eq(ladder[i].startCash, ladder[i - 1].startCash, `starting cash is equal ${from} -> ${to}`)
  }
  t.ok(ladder.every(r => r.cashPerPopMul > 0), 'no difficulty zeroes pop income — that is a mode delta, not a difficulty')

  t.section('medium is the identity delta, so it cannot silently retune the engine')
  // Every existing suite runs on medium through the shared fixture. If medium
  // names a value that differs from the default, it retunes all of them at once.
  const defaults = E.defaultRules()
  for (const field of Object.keys(D.medium.rules)) {
    // A field outside defaultRules() has no declared default; the engine's
    // fallback for the forward-declared ones is 1 (see Heroes.xpRate).
    const dflt = KNOWN.has(field) ? defaults[field] : 1
    t.eq(D.medium.rules[field], dflt, `medium.${field} equals the engine default`)
  }
  t.eq(Object.keys(M.standard.rules).length, 0, 'Standard is the empty delta')

  /* ================= mode semantics ================= */

  t.section('family restrictions name exactly one real family')
  const onlyModes = { 'primary-only': 'primary', 'military-only': 'military', 'magic-only': 'magic' }
  for (const mk of Object.keys(onlyModes)) {
    const fams = M[mk].rules.families
    t.ok(Array.isArray(fams), `${mk} sets a families array`)
    t.deep(fams, [onlyModes[mk]], `${mk} allows only ${onlyModes[mk]}`)
    t.ok(fams.every(f => OP.FAMILIES.indexOf(f) >= 0), `${mk} names a family that exists`)
  }
  t.eq(M.standard.rules.families, undefined, 'Standard restricts nothing')

  t.section('Deflation: one fixed pile of cash and no way to refill it')
  const defl = M.deflation.rules
  t.gt(defl.startCash, 650, 'the starting pile is far larger than a normal start')
  t.ok(DIFF_KEYS.every(k => defl.startCash > D[k].rules.startCash), 'and larger than every difficulty start')
  t.eq(defl.cashPerPopMul, 0, 'pops pay nothing')
  t.eq(defl.roundBonusMul, 0, 'surviving a round pays nothing')
  t.eq(defl.allowIncome, false, 'income towers are forbidden, so the tap cannot be reopened')
  t.eq(defl.firstRound, 31, 'and it starts mid-game')
  t.eq(defl.lastRound, undefined, 'the far end of the run is left to the difficulty')
  t.eq(defl.allowSell, undefined, 'selling stays legal — recovering a misplacement is the puzzle')

  t.section('Onslaught: tougher and quicker, via the scale rules only')
  t.gt(M.onslaught.rules.hpScale, 1, 'hpScale is raised')
  t.gt(M.onslaught.rules.speedScale, 1, 'speedScale is raised')
  t.deep(Object.keys(M.onslaught.rules).sort(), ['hpScale', 'speedScale'],
    'and nothing else — density belongs to the round set, there is no spacingMul rule')

  t.section('Half Cash halves both income sources')
  t.eq(M['half-cash'].rules.cashPerPopMul, 0.5, 'pop income is halved')
  t.eq(M['half-cash'].rules.roundBonusMul, 0.5, 'round bonus is halved')
  t.eq(M['half-cash'].rules.costMul, undefined, 'prices are untouched')

  t.section('Double HP Blimps touches blimps and only blimps')
  t.eq(M['double-hp-blimps'].rules.blimpHpMul, 2, 'blimpHpMul is 2')
  t.eq(M['double-hp-blimps'].rules.hpScale, undefined, 'ordinary balloon HP is untouched')
  t.eq(Object.keys(M['double-hp-blimps'].rules).length, 1, 'that one field is the whole mode')

  t.section('Alternate Waves swaps the round table, which is not a rule')
  t.eq(M['alternate-waves'].roundSetKey, 'alternate', 'the mode declares its round-set key')
  t.eq(Object.keys(M['alternate-waves'].rules).length, 0, 'and changes no rules at all')
  for (const mk of MODE_KEYS) {
    if (mk === 'alternate-waves') continue
    t.eq(M[mk].roundSetKey, undefined, `${mk} does not declare a round set`)
  }

  t.section('Reverse is a declared flag, not a code path')
  t.eq(M.reverse.rules.reversePaths, true, 'reversePaths is true')
  t.eq(Object.keys(M.reverse.rules).length, 1, 'and it is the only thing Reverse changes')
  const reverseSetters = MODE_KEYS.filter(k => M[k].rules.reversePaths !== undefined)
  t.deep(reverseSetters, ['reverse'], 'no other mode names the flag, so it cannot be a stray typo')

  t.section('PURIST removes every safety net')
  const pur = M.purist.rules
  t.eq(pur.startLives, 1, 'one life')
  t.eq(pur.allowSell, false, 'no selling')
  t.eq(pur.allowIncome, false, 'no income towers')
  t.eq(pur.allowContinue, false, 'no continues')
  t.eq(pur.livesRegain, false, 'no lives regained')
  t.eq(pur.allowAbilities, undefined, 'tower and hero abilities are deliberately still allowed')
  t.eq(pur.costMul, undefined, 'and prices are the difficulty\'s, not inflated on top')
  t.eq(M.purist.name, 'PURIST', 'the mode is named PURIST, per §11')

  /* ================= resolveRules layering ================= */

  t.section('layer order: defaults, difficulty, mode, explicit overrides')
  const asDefault = S.resolveRules({})
  for (const field of Object.keys(defaults)) {
    t.eq(asDefault[field], defaults[field], `an unspecified game resolves ${field} to the engine default (medium is neutral)`)
  }

  t.eq(S.resolveRules({ difficulty: 'relentless' }).startLives, 1, 'difficulty beats defaults')
  t.eq(S.resolveRules({ difficulty: 'easy' }).costMul, 0.85, 'for every field it names')
  t.eq(S.resolveRules({ difficulty: 'easy', mode: 'purist' }).startLives, 1,
    'mode beats difficulty — PURIST on Easy is still one life')
  t.eq(S.resolveRules({ difficulty: 'easy', mode: 'purist' }).costMul, 0.85,
    'while fields the mode does not name keep the difficulty value')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'deflation' }).firstRound, 31,
    'Deflation overrides Relentless\'s round-6 start')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'deflation' }).lastRound, 100,
    'and leaves the far end to the difficulty')
  // The two edges of that choice, pinned so a retune sees both at once: Deflation
  // shortens a run from the front only, so counting inclusively it is ten rounds on
  // Easy (31-40) and seventy on Relentless (31-100), off one fixed pile of cash
  // either way. sim.roundIndex === firstRound - 1, so firstRound is played.
  t.eq(S.resolveRules({ difficulty: 'easy', mode: 'deflation' }).lastRound, 40,
    'Easy Deflation is a ten-round scenario, by design')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'deflation' }).lastRound -
       S.resolveRules({ difficulty: 'relentless', mode: 'deflation' }).firstRound + 1, 70,
    'and Relentless Deflation is seventy rounds off the same pile')
  t.eq(S.resolveRules({ difficulty: 'easy', mode: 'deflation' }).firstRound, 31,
    'starting where every other difficulty starts it')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'purist', rules: { startLives: 99 } }).startLives, 99,
    'an explicit override beats the mode')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'purist', rules: { startLives: 99 } }).allowSell, false,
    'without disturbing the rest of the mode delta')

  t.section('assignment, not composition — the surprise is pinned here')
  // applyRules assigns, so a mode figure REPLACES the difficulty figure. Hard's
  // 0.9 pop income does not stack with Half Cash's 0.5 into 0.45.
  // The overlap is the whole hazard, so it is enumerated rather than described: any
  // field named by BOTH a difficulty and a mode is a field where the mode's absolute
  // value silently discards the difficulty's. A new mode field that joins this set
  // fails here, which is the moment to check the number is written absolute.
  const diffFields = new Set()
  for (const k of DIFF_KEYS) for (const f of Object.keys(D[k].rules)) diffFields.add(f)
  const modeFields = new Set()
  for (const k of MODE_KEYS) for (const f of Object.keys(M[k].rules)) modeFields.add(f)
  const overlap = [...modeFields].filter(f => diffFields.has(f)).sort()
  t.deep(overlap, ['cashPerPopMul', 'firstRound', 'roundBonusMul', 'startCash', 'startLives'],
    'exactly these five fields are contested between a difficulty and a mode')
  // The scale fields are the other half of the argument: no difficulty names them,
  // so Onslaught and Double HP Blimps cannot have their figures replaced from below.
  for (const f of ['hpScale', 'speedScale', 'blimpHpMul']) {
    t.notOk(diffFields.has(f), `no difficulty names ${f}, so a mode's value stands alone`)
    t.ok(modeFields.has(f), `and a mode does name ${f}`)
  }

  t.eq(S.resolveRules({ difficulty: 'hard' }).cashPerPopMul, 0.9, 'Hard alone pays 0.9 per pop')
  t.eq(S.resolveRules({ difficulty: 'hard', mode: 'half-cash' }).cashPerPopMul, 0.5,
    'Hard + Half Cash pays 0.5, not 0.45 — mode values are absolute')
  t.eq(S.resolveRules({ difficulty: 'easy', mode: 'half-cash' }).cashPerPopMul, 0.5,
    'and the same 0.5 on Easy, which is a real cut there')
  t.lt(S.resolveRules({ difficulty: 'hard', mode: 'half-cash' }).cashPerPopMul,
    S.resolveRules({ difficulty: 'hard' }).cashPerPopMul, 'so Half Cash still hurts on Hard')

  t.section('unknown difficulty or mode names fall through instead of throwing')
  t.noThrow(() => S.resolveRules({ difficulty: 'nope', mode: 'nope' }), 'resolving nonsense does not throw')
  t.eq(S.resolveRules({ difficulty: 'nope' }).startLives, defaults.startLives, 'an unknown difficulty applies nothing')
  t.eq(S.resolveRules({ difficulty: 'medium', mode: 'nope' }).allowSell, true, 'an unknown mode applies nothing')

  /* ================= the 44 combinations ================= */

  t.section('every difficulty x mode resolves to internally consistent rules')
  const bad = { lives: [], cost: [], rounds: [], pop: [], families: [], sell: [], cash: [], keys: [] }
  let combos = 0
  for (const dk of DIFF_KEYS) {
    for (const mk of MODE_KEYS) {
      combos++
      const r = S.resolveRules({ difficulty: dk, mode: mk })
      const label = `${dk} x ${mk}`
      if (!(r.startLives >= 1)) bad.lives.push(label)
      if (!(r.costMul > 0)) bad.cost.push(label)
      if (!(r.firstRound <= r.lastRound)) bad.rounds.push(label)
      if (!(r.cashPerPopMul >= 0)) bad.pop.push(label)
      if (!(r.families === null || (Array.isArray(r.families) && r.families.length &&
            r.families.every(f => OP.FAMILIES.indexOf(f) >= 0)))) bad.families.push(label)
      if (!(r.sellRate > 0 && r.sellRate <= 1)) bad.sell.push(label)
      if (!(r.startCash >= 0 && Number.isFinite(r.startCash))) bad.cash.push(label)
      if (unknownKeys(r).length) bad.keys.push(label + ': ' + unknownKeys(r).join(','))
    }
  }
  t.eq(combos, 44, 'there are 44 combinations')
  t.eq(bad.lives.length, 0, 'startLives >= 1 everywhere', bad.lives.join('; '))
  t.eq(bad.cost.length, 0, 'costMul > 0 everywhere', bad.cost.join('; '))
  t.eq(bad.rounds.length, 0, 'firstRound <= lastRound everywhere', bad.rounds.join('; '))
  t.eq(bad.pop.length, 0, 'cashPerPopMul >= 0 everywhere', bad.pop.join('; '))
  t.eq(bad.families.length, 0, 'families is null or a non-empty subset of OP.FAMILIES everywhere', bad.families.join('; '))
  t.eq(bad.sell.length, 0, 'sellRate stays a sane fraction everywhere', bad.sell.join('; '))
  t.eq(bad.cash.length, 0, 'startCash is a finite non-negative number everywhere', bad.cash.join('; '))
  t.eq(bad.keys.length, 0, 'no resolved ruleset carries a field the engine ignores', bad.keys.join('; '))

  t.section('Sim.create succeeds for all 44 combinations')
  for (const dk of DIFF_KEYS) {
    for (const mk of MODE_KEYS) {
      const r = S.resolveRules({ difficulty: dk, mode: mk })
      let detail = ''
      let sim = null
      try { sim = simFor(dk, mk) } catch (e) { detail = 'threw ' + e.message }
      if (sim) {
        if (sim.cash !== r.startCash) detail = `cash ${sim.cash} != startCash ${r.startCash}`
        else if (sim.lives !== r.startLives) detail = `lives ${sim.lives} != startLives ${r.startLives}`
        else if (sim.roundIndex !== r.firstRound - 1) detail = `roundIndex ${sim.roundIndex} is not firstRound-1`
        else if (sim.difficulty !== dk || sim.mode !== mk) detail = 'the sim forgot which game it is'
        else if (sim.cashPerPopMul !== r.cashPerPopMul) detail = 'cashPerPopMul was not carried onto the sim'
      }
      t.eq(detail, '', `${dk} x ${mk} creates and starts from its own rules`)
    }
  }

  /* ================= the deltas, through the engine that honours them ================= */

  t.section('PURIST genuinely forbids selling, income and continues once resolved')
  for (const dk of DIFF_KEYS) {
    const r = S.resolveRules({ difficulty: dk, mode: 'purist' })
    t.eq(r.startLives, 1, `PURIST on ${dk} resolves to one life`)
    t.eq(r.allowSell, false, `PURIST on ${dk} forbids selling`)
    t.eq(r.allowIncome, false, `PURIST on ${dk} forbids income`)
    t.eq(r.allowContinue, false, `PURIST on ${dk} forbids continues`)
    t.eq(r.livesRegain, false, `PURIST on ${dk} forbids regaining lives`)
  }
  const purSim = simFor('hard', 'purist')
  t.eq(purSim.lives, 1, 'a PURIST sim starts on one life')
  t.eq(E.sellValue(purSim, { invested: 1000 }), 0, 'selling a 1000-cash tower returns nothing')
  t.eq(E.gainLives(purSim, 25), 0, 'lives cannot be regained')
  t.eq(purSim.lives, 1, 'so the life total is unchanged')
  t.notOk(E.towerAllowed(purSim, { key: 'berry-warren', family: 'support', income: true }),
    'an income tower is refused')
  t.ok(E.towerAllowed(purSim, { key: 'acorn-fox', family: 'primary' }), 'an ordinary tower is not')
  t.ok(purSim.rules.allowAbilities, 'abilities still work — PURIST is about safety nets, not power')
  E.loseLives(purSim, 1)
  t.ok(purSim.over, 'and a single leak ends the run')
  t.eq(purSim.outcome, 'leaked', 'with the reason recorded')

  t.section('a PURIST save cannot come back with selling switched on')
  const purSnap = JSON.parse(JSON.stringify(S.serialize(simFor('relentless', 'purist'))))
  t.eq(purSnap.mode, 'purist', 'the mode is recorded in the save')
  t.eq(purSnap.difficulty, 'relentless', 'so is the difficulty')
  const purBack = S.deserialize(purSnap, { key: 'test', paths: [straightTrack(OP, 4000)] })
  t.eq(purBack.rules.allowSell, false, 'the restored game still forbids selling')
  t.eq(purBack.lives, 1, 'and still has one life')

  t.section('Deflation, end to end')
  const deflSim = simFor('medium', 'deflation')
  t.eq(deflSim.cash, 20000, 'the fixed pile is banked at creation')
  t.eq(deflSim.roundIndex, 30, 'and play is positioned to open on round 31')
  t.eq(E.roundBonus(deflSim, 40), 0, 'surviving round 40 pays nothing')
  const deflBefore = deflSim.cash
  OP.Damage.hit(deflSim, OP.Balloons.spawn(deflSim, { tier: 'pink', path: 0, t: 0 }),
    { damage: 5, dmgType: OP.DMG.NORMAL, sourceId: -1 })
  t.eq(deflSim.cash, deflBefore, 'and clearing a pink chain pays nothing either')
  t.notOk(E.towerAllowed(deflSim, { key: 'berry-warren', family: 'support', income: true }),
    'income towers are refused')
  t.ok(E.towerAllowed(deflSim, { key: 'acorn-fox', family: 'primary' }), 'ordinary towers are fine')

  // Control: the same pop on Standard does pay, so the assertion above is testing
  // the mode and not a broken damage path.
  const ctrlSim = simFor('medium', 'standard')
  const ctrlBefore = ctrlSim.cash
  OP.Damage.hit(ctrlSim, OP.Balloons.spawn(ctrlSim, { tier: 'pink', path: 0, t: 0 }),
    { damage: 5, dmgType: OP.DMG.NORMAL, sourceId: -1 })
  t.gt(ctrlSim.cash, ctrlBefore, 'the same pink pays on Standard')

  t.section('Half Cash, end to end')
  const halfSim = simFor('medium', 'half-cash')
  const fullSim = simFor('medium', 'standard')
  t.eq(E.roundBonus(halfSim, 20), Math.floor(E.roundBonus(fullSim, 20) * 0.5), 'the round bonus is halved')
  const hb = halfSim.cash, fb = fullSim.cash
  const hitSpec = { damage: 5, dmgType: OP.DMG.NORMAL, sourceId: -1 }
  OP.Damage.hit(halfSim, OP.Balloons.spawn(halfSim, { tier: 'pink', path: 0, t: 0 }), hitSpec)
  OP.Damage.hit(fullSim, OP.Balloons.spawn(fullSim, { tier: 'pink', path: 0, t: 0 }), hitSpec)
  t.eq(halfSim.cash - hb, (fullSim.cash - fb) * 0.5, 'and so is pop income')

  t.section('Double HP Blimps, through the round runner')
  const blimpSim = simFor('medium', 'double-hp-blimps')
  blimpSim.roundSet = { 1: { groups: [{ tier: 'goliath', count: 1, spacing: 0 }, { tier: 'ceramic', count: 1, spacing: 0 }] } }
  OP.Rounds.begin(blimpSim, 1)
  OP.Rounds.tick(blimpSim)
  const gol = blimpSim.balloons.find(b => OP.BALLOON_TIERS[b.tier].key === 'goliath')
  const cer = blimpSim.balloons.find(b => OP.BALLOON_TIERS[b.tier].key === 'ceramic')
  t.ok(gol && cer, 'both spawned')
  t.eq(gol.hp, OP.BALLOON_TIERS[OP.tierIndex('goliath')].hp * 2, 'the GOLIATH hull is doubled')
  t.eq(cer.hp, OP.BALLOON_TIERS[OP.tierIndex('ceramic')].hp, 'the ceramic is untouched')

  t.section('Onslaught, through the round runner')
  const onsSim = simFor('medium', 'onslaught')
  onsSim.roundSet = { 1: { groups: [{ tier: 'ceramic', count: 1, spacing: 0 }] } }
  OP.Rounds.begin(onsSim, 1)
  OP.Rounds.tick(onsSim)
  const onsCer = onsSim.balloons[0]
  t.eq(onsCer.hp, Math.round(OP.BALLOON_TIERS[OP.tierIndex('ceramic')].hp * 1.2), 'ceramic shells are 20% thicker')
  t.close(onsCer.speedScale, 1.15, 1e-9, 'and every balloon carries the speed scale')
  const stdSim = simFor('medium', 'standard')
  stdSim.roundSet = { 1: { groups: [{ tier: 'ceramic', count: 1, spacing: 0 }] } }
  OP.Rounds.begin(stdSim, 1)
  OP.Rounds.tick(stdSim)
  for (let i = 0; i < 60; i++) { OP.Balloons.move(onsSim); OP.Balloons.move(stdSim) }
  t.gt(onsSim.balloons[0].t, stdSim.balloons[0].t, 'so an Onslaught balloon is further along after a second')

  t.section('family-only modes, through Economy.familyAllowed')
  for (const mk of Object.keys(onlyModes)) {
    const s = simFor('medium', mk)
    for (const fam of OP.FAMILIES) {
      const want = fam === onlyModes[mk]
      t.eq(E.familyAllowed(s, fam), want, `${mk}: ${fam} is ${want ? 'allowed' : 'refused'}`)
    }
  }
  const anySim = simFor('medium', 'standard')
  t.ok(OP.FAMILIES.every(f => E.familyAllowed(anySim, f)), 'Standard allows all four families')

  t.section('difficulty pricing, through Economy.price')
  t.eq(E.price(simFor('easy', 'standard'), 200), 170, 'a 200-cost tower is 170 on Easy')
  t.eq(E.price(simFor('medium', 'standard'), 200), 200, '200 on Medium')
  t.eq(E.price(simFor('hard', 'standard'), 200), 216, '216 on Hard')
  t.eq(E.price(simFor('relentless', 'standard'), 200), 240, 'and 240 on Relentless')
  t.eq(E.price(simFor('relentless', 'half-cash'), 200), 240, 'Half Cash does not touch prices')

  t.section('hero XP rate follows the difficulty')
  t.close(OP.Heroes.xpRate(simFor('easy', 'standard')), 1.35, 1e-9, 'Easy levels a hero fastest')
  t.close(OP.Heroes.xpRate(simFor('medium', 'standard')), 1, 1e-9, 'Medium is the reference rate')
  t.close(OP.Heroes.xpRate(simFor('relentless', 'standard')), 0.7, 1e-9, 'Relentless is slowest per pop')
  t.gt(OP.Heroes.xpRate(simFor('easy', 'standard')), OP.Heroes.xpRate(simFor('hard', 'standard')),
    'so a short run still levels a hero')

  /* ================= availability gate ================= */

  t.section('modeAllowedOn is a menu gate with exactly one restriction')
  for (const dk of DIFF_KEYS) {
    t.ok(OP.modeAllowedOn('standard', dk), `Standard is offered on ${dk}`)
  }
  t.notOk(OP.modeAllowedOn('purist', 'easy'), 'PURIST is not offered on Easy')
  t.notOk(OP.modeAllowedOn('purist', 'medium'), 'nor on Medium')
  t.ok(OP.modeAllowedOn('purist', 'hard'), 'but it is on Hard')
  t.ok(OP.modeAllowedOn('purist', 'relentless'), 'and on Relentless')

  const restricted = []
  for (const mk of MODE_KEYS) {
    for (const dk of DIFF_KEYS) if (!OP.modeAllowedOn(mk, dk)) restricted.push(`${mk}/${dk}`)
  }
  t.deep(restricted, ['purist/easy', 'purist/medium'], 'PURIST on the two lower difficulties is the only restriction')
  t.ok(MODE_KEYS.every(mk => DIFF_KEYS.some(dk => OP.modeAllowedOn(mk, dk))), 'every mode is playable somewhere')
  t.eq(MODE_KEYS.filter(mk => OP.modeAllowedOn(mk, 'relentless')).length, 11, 'Relentless offers all eleven')
  t.eq(MODE_KEYS.filter(mk => OP.modeAllowedOn(mk, 'easy')).length, 10, 'Easy offers ten')
  t.notOk(OP.modeAllowedOn('nope', 'medium'), 'an unknown mode is refused')
  t.notOk(OP.modeAllowedOn('standard', 'nope'), 'an unknown difficulty is refused')
  t.notOk(OP.modeAllowedOn(undefined, undefined), 'and so is nothing at all')
  // Unlike modeConfig, this one must NOT default: a menu that silently substitutes
  // Standard would offer a combination the player did not choose.
  for (const junk of [null, '', 0, 7, [], {}, true, NaN]) {
    t.notOk(OP.modeAllowedOn(junk, 'medium'), `mode ${fmtJunk(junk)} is refused, not defaulted`)
    t.notOk(OP.modeAllowedOn('standard', junk), `difficulty ${fmtJunk(junk)} is refused, not defaulted`)
    t.noThrow(() => OP.modeAllowedOn(junk, junk), `and ${fmtJunk(junk)} on both sides does not throw`)
  }
  t.notOk(OP.modeAllowedOn('purist', 'Hard'), 'the gate is case-sensitive, like every other key in the project')

  // The gate is advisory: a save from a future ruleset must still load.
  t.noThrow(() => S.create({ map: { key: 'test', paths: [straightTrack(OP, 1000)] }, difficulty: 'easy', mode: 'purist' }),
    'the sim itself still honours a restricted combination')

  /* ================= game-start config ================= */

  t.section('modeConfig is the bridge from a mode to its round set')
  t.eq(OP.modeConfig('alternate-waves', 'medium').roundSetKey, 'alternate', 'Alternate Waves resolves to the alternate table')
  for (const mk of MODE_KEYS) {
    if (mk === 'alternate-waves') continue
    t.eq(OP.modeConfig(mk, 'medium').roundSetKey, 'standard', `${mk} resolves to the standard table`)
  }
  const cfg = OP.modeConfig('onslaught', 'hard', { seed: 7, map: 'm' })
  t.eq(cfg.difficulty, 'hard', 'the difficulty is carried through')
  t.eq(cfg.mode, 'onslaught', 'and the mode')
  t.eq(cfg.seed, 7, 'extra config survives')
  t.eq(cfg.map, 'm', 'including the map')
  t.eq(OP.modeConfig('alternate-waves', 'medium', { roundSetKey: 'fixture' }).roundSetKey, 'fixture',
    'an explicit round set still wins, mirroring the rules layering')
  t.eq(OP.modeConfig('nope', 'medium').mode, 'standard', 'an unknown mode falls back rather than throwing')
  t.eq(OP.modeConfig('standard', 'nope').difficulty, 'medium', 'and so does an unknown difficulty')

  t.section('modeConfig on absent, empty and corrupt input')
  // These are menu selections and save fields, so every one of them is reachable:
  // a fresh profile with nothing chosen, a save written by an older build, a form
  // field that came back empty. None may throw and none may produce a config that
  // Sim.create cannot use.
  t.noThrow(() => OP.modeConfig(), 'calling with no arguments at all does not throw')
  const blank = OP.modeConfig()
  t.eq(blank.mode, 'standard', 'no mode means Standard')
  t.eq(blank.difficulty, 'medium', 'no difficulty means Medium')
  t.eq(blank.roundSetKey, 'standard', 'and the standard table')
  for (const junk of [null, '', 0, 7, [], {}, true, NaN]) {
    const c = OP.modeConfig(junk, junk)
    t.eq(c.mode, 'standard', `mode ${fmtJunk(junk)} falls back to Standard`)
    t.eq(c.difficulty, 'medium', `difficulty ${fmtJunk(junk)} falls back to Medium`)
    t.ok(M[c.mode] && D[c.difficulty], `and ${fmtJunk(junk)} still yields a config naming real entries`)
  }
  t.noThrow(() => S.create(Object.assign(OP.modeConfig(null, null),
    { map: { key: 'test', paths: [straightTrack(OP, 500)] } })), 'a config built from junk still creates a sim')

  // A falsy round-set key must fall back to the MODE'S table, not to standard.
  // Sim.create resolves `config.roundSetKey || 'standard'`, so handing it null here
  // would put Alternate Waves back on the standard waves without a word — the exact
  // silent nothing modeConfig exists to prevent.
  for (const falsy of [null, undefined, '', 0, false, NaN]) {
    t.eq(OP.modeConfig('alternate-waves', 'medium', { roundSetKey: falsy }).roundSetKey, 'alternate',
      `a falsy roundSetKey (${fmtJunk(falsy)}) falls back to the mode's own table, not standard`)
  }
  t.eq(simFor('medium', 'alternate-waves', { roundSetKey: null }).roundSet, OP.ROUND_SETS.alternate,
    'and the sim built that way really is on the alternate table')

  // extra is copied, not adopted. A caller that reuses one options object across
  // several starts must not find difficulty/mode/roundSetKey welded onto it.
  const reused = { seed: 3, map: 'm' }
  const frozenCopy = JSON.stringify(reused)
  OP.modeConfig('alternate-waves', 'relentless', reused)
  t.eq(JSON.stringify(reused), frozenCopy, 'modeConfig does not mutate the extra object it was handed')
  t.eq(reused.difficulty, undefined, 'so no difficulty is welded onto it')
  t.eq(reused.roundSetKey, undefined, 'and no round-set key either')

  // The positional arguments win over same-named fields in extra. Pinned rather
  // than changed: roundSetKey is deliberately the one field extra may override,
  // mirroring the explicit-overrides layer in resolveRules.
  const clash = OP.modeConfig('onslaught', 'hard', { difficulty: 'easy', mode: 'purist' })
  t.eq(clash.difficulty, 'hard', 'extra.difficulty loses to the positional difficulty')
  t.eq(clash.mode, 'onslaught', 'and extra.mode loses to the positional mode')
  t.eq(OP.modeConfig('standard', 'medium', { roundSetKey: 'alternate' }).roundSetKey, 'alternate',
    'while extra.roundSetKey is the one field allowed to win')

  t.section('the shipped shell actually bridges mode -> roundSetKey and mode -> reversed map')
  // Sim.create ignores mode.roundSetKey and mode.rules.reversePaths by design, so
  // both facts have to be applied at game start or Alternate Waves and Reverse are
  // silent no-ops. js/main.js currently hand-rolls what OP.modeConfig does, which
  // means the same fact lives in two places — so it is pinned in both. If
  // App.startGame is ever collapsed onto OP.modeConfig, this assertion should be
  // relaxed to "main.js calls OP.modeConfig", not deleted.
  t.ok(env.present.indexOf('js/main.js') >= 0, 'js/main.js ships in the bundle')
  const shell = readFileSync(resolve(ROOT, 'js/main.js'), 'utf8')
  t.ok(/roundSetKey/.test(shell), 'the shell names roundSetKey at game start')
  t.ok(/modeConfig|modeDef\s*&&\s*modeDef\.roundSetKey|MODES\[[^\]]*\][\s\S]{0,80}roundSetKey/.test(shell),
    'and derives it from the mode definition rather than hardcoding one table')
  t.ok(shell.indexOf('Maps.reversePaths(') >= 0, 'the shell reverses the map itself')
  t.ok(/rules\.reversePaths/.test(shell), 'gated on the mode flag rather than on a mode name')
  t.notOk(/mode\s*===\s*['"]reverse['"]/.test(shell), 'and not on a mode name — §8 forbids branching on one')
  // Ordering, not proximity: the map has to be reversed before the Track reaches
  // Sim.create, because Sim.create keeps the map object it is handed.
  const iRev = shell.indexOf('Maps.reversePaths(')
  const iCreate = shell.indexOf('Sim.create(')
  t.gt(iCreate, 0, 'the shell calls Sim.create')
  t.lt(iRev, iCreate, 'and reverses the map BEFORE that call, because Sim.create keeps the map it is handed')

  t.section('a mode with roundSetKey "alternate" yields sim.roundSetKey === "alternate"')
  const altSim = simFor('medium', 'alternate-waves')
  t.eq(altSim.roundSetKey, 'alternate', 'the sim is playing the alternate waves')
  t.eq(altSim.mode, 'alternate-waves', 'and knows which mode asked for them')
  t.eq(simFor('medium', 'standard').roundSetKey, 'standard', 'while Standard plays the standard table')
  t.eq(JSON.parse(JSON.stringify(S.serialize(altSim))).roundSetKey, 'alternate',
    'and the key is what the save records, so a resumed run keeps the same waves')

  t.section('the key resolves to a REGISTERED table, not the silent standard fallback')
  // The assertions above only prove a string survived a copy: Sim.create writes
  // config.roundSetKey onto the sim verbatim, and then resolves the table with
  //   OP.ROUND_SETS[key] || OP.ROUNDS_STANDARD
  // so an unregistered key gives a sim that SAYS "alternate" and PLAYS standard.
  // That is precisely the silent-nothing this suite exists to catch, and reading
  // the key back cannot see it. The table itself has to be compared.
  const altKey = M['alternate-waves'].roundSetKey
  // Defaulted to {} rather than left undefined so that an unregistered table fails
  // every check below by name instead of throwing on the first property read and
  // taking the remaining sections of the suite down with it.
  const stdTable = (OP.ROUND_SETS && OP.ROUND_SETS.standard) || {}
  t.ok(OP.ROUND_SETS && OP.ROUND_SETS[altKey], `the declared key "${altKey}" is registered in OP.ROUND_SETS`)
  t.ok(Object.keys(stdTable).length, 'and so is "standard", the fallback it must not be confused with')
  t.eq(altSim.roundSet, OP.ROUND_SETS[altKey], 'the sim holds exactly the registered alternate table')
  t.neq(altSim.roundSet, stdTable, 'which is not the standard table — no silent fallback')
  t.neq(altSim.roundSet, OP.ROUNDS_STANDARD, 'nor the last-resort ROUNDS_STANDARD reference')
  t.eq(simFor('medium', 'standard').roundSet, stdTable, 'while Standard really is on the standard table')

  // Identity is necessary but not sufficient: two distinct objects could still hold
  // identical data, which would make Alternate Waves a mode that changes nothing.
  const altTable = (OP.ROUND_SETS && OP.ROUND_SETS[altKey]) || {}
  let differing = 0, missingAlt = [], missingStd = []
  for (let r = 1; r <= 100; r++) {
    if (!altTable[r]) missingAlt.push(r)
    if (!stdTable[r]) missingStd.push(r)
    if (altTable[r] && stdTable[r] &&
        JSON.stringify(altTable[r]) !== JSON.stringify(stdTable[r])) differing++
  }
  t.eq(missingStd.length, 0, 'the standard table covers rounds 1-100', missingStd.join(','))
  t.eq(missingAlt.length, 0, 'and so does the alternate table', missingAlt.join(','))
  t.gt(differing, 50, 'most rounds genuinely differ, so Alternate Waves is not a relabelled reprint',
    `${differing}/100 differ`)
  t.neq(JSON.stringify(altTable[1]), JSON.stringify(stdTable[1]), 'including round 1, the first thing a player sees')

  // Every difficulty x Alternate Waves must have data for every round it will play.
  // Relentless runs to 100 and Deflation opens on 31, so the mode is only safe if
  // the alternate table spans the union of every difficulty's range.
  const uncovered = []
  for (const dk of DIFF_KEYS) {
    for (const mk of MODE_KEYS) {
      const r = S.resolveRules({ difficulty: dk, mode: mk })
      const table = mk === 'alternate-waves' ? altTable : stdTable
      for (let n = r.firstRound; n <= r.lastRound; n++) {
        if (!table[n]) { uncovered.push(`${dk} x ${mk} round ${n}`); break }
      }
    }
  }
  t.eq(uncovered.length, 0, 'every difficulty x mode has round data for every round it will play',
    uncovered.slice(0, 6).join('; '))

  // And the round runner actually spawns from the alternate table, not just holds it.
  const altRun = simFor('medium', 'alternate-waves')
  OP.Rounds.begin(altRun, 1)
  for (let i = 0; i < 240 && !altRun.round.done; i++) OP.Rounds.tick(altRun)
  t.gt(altRun.stats.spawned, 0, 'beginning round 1 on Alternate Waves releases balloons')
  const stdRun = simFor('medium', 'standard')
  OP.Rounds.begin(stdRun, 1)
  for (let i = 0; i < 240 && !stdRun.round.done; i++) OP.Rounds.tick(stdRun)
  t.neq(altRun.stats.spawned, stdRun.stats.spawned,
    'and releases a different number of them than round 1 of the standard table')

  // Pins the trap: Sim.create does NOT read mode.roundSetKey. Every game start has
  // to route through modeConfig or Alternate Waves silently plays standard waves.
  const bareAlt = S.create({ map: { key: 'test', paths: [straightTrack(OP, 1000)] }, mode: 'alternate-waves' })
  t.eq(bareAlt.roundSetKey, 'standard',
    'Sim.create alone ignores mode.roundSetKey — game start must go through OP.modeConfig')

  t.section('difficultyRank orders the ladder and rejects nonsense')
  t.eq(OP.difficultyRank('easy'), 0, 'easy is first')
  t.eq(OP.difficultyRank('relentless'), 3, 'relentless is last')
  t.lt(OP.difficultyRank('medium'), OP.difficultyRank('hard'), 'medium sits below hard')
  t.eq(OP.difficultyRank('nope'), -1, 'an unknown difficulty has no rank')
  // rank is what gates PURIST, so every non-key has to land below every key rather
  // than throwing or coming back undefined and comparing false in both directions.
  for (const junk of [undefined, null, '', 0, 3, [], {}, 'Easy', 'EASY', ' easy']) {
    t.eq(OP.difficultyRank(junk), -1, `${fmtJunk(junk)} has no rank`)
  }
  t.deep(OP.DIFFICULTY_ORDER.map(k => OP.difficultyRank(k)), [0, 1, 2, 3],
    'and every real key ranks at its own index in the order array')

  /* ================= corrupt and absent payloads ================= */

  t.section('resolveRules survives absent and corrupt input')
  t.noThrow(() => S.resolveRules({}), 'an empty config resolves')
  for (const junk of [null, 0, 7, [], true, 'nope']) {
    t.noThrow(() => S.resolveRules({ difficulty: junk, mode: junk }), `a ${fmtJunk(junk)} key resolves`)
    const r = S.resolveRules({ difficulty: junk, mode: junk })
    // Falsy keys default to medium/standard inside resolveRules; truthy nonsense
    // matches nothing and applies nothing. Either way the result must be playable.
    t.eq(r.startLives, 150, `and yields Medium's lives for ${fmtJunk(junk)}`)
    t.eq(unknownKeys(r).length, 0, `with no junk keys on the ruleset for ${fmtJunk(junk)}`)
  }
  t.noThrow(() => S.resolveRules({ difficulty: 'hard', mode: 'purist', rules: null }),
    'a null explicit-override block is ignored rather than fatal')
  t.eq(S.resolveRules({ difficulty: 'hard', mode: 'purist', rules: {} }).allowSell, false,
    'and an empty one leaves the mode delta intact')

  /* ================= the registry is not shared mutable state ================= */

  t.section('the registries cannot be mutated through a running sim')
  // resolveRules copies field VALUES, so any array a mode names lands on sim.rules
  // as the registry's own instance: sim.rules.families for Primary Only IS
  // OP.MODES['primary-only'].rules.families. One push() through sim.rules would
  // retune every game started later in the session, and the corruption would
  // outlive the run that caused it. The data files freeze the registries so that
  // becomes a throw at the mutation site instead.
  const famSim = simFor('medium', 'primary-only')
  t.eq(famSim.rules.families, M['primary-only'].rules.families,
    'the resolved families array IS the registry instance — this is why the freeze matters')
  t.ok(Object.isFrozen(M['primary-only'].rules.families), 'so the registry array is frozen')
  t.throws(() => { famSim.rules.families.push('magic') },
    'pushing a family through sim.rules throws instead of silently widening Primary Only')
  t.deep(M['primary-only'].rules.families, ['primary'], 'and the registry is unchanged after the attempt')
  t.eq(OP.Economy.familyAllowed(simFor('medium', 'primary-only'), 'magic'), false,
    'so a later Primary Only game is still Primary Only')

  for (const mk of MODE_KEYS) {
    t.ok(Object.isFrozen(M[mk]), `mode ${mk} is frozen`)
    t.ok(Object.isFrozen(M[mk].rules), `and so is its rules block`)
  }
  for (const dk of DIFF_KEYS) {
    t.ok(Object.isFrozen(D[dk]), `difficulty ${dk} is frozen`)
    t.ok(Object.isFrozen(D[dk].rules), `and so is its rules block`)
  }
  t.ok(Object.isFrozen(M), 'the mode registry itself is frozen, so a mode cannot be added at runtime')
  t.ok(Object.isFrozen(D), 'and so is the difficulty registry')
  t.ok(Object.isFrozen(OP.MODE_ORDER), 'MODE_ORDER cannot be sorted in place by a menu')
  t.ok(Object.isFrozen(OP.DIFFICULTY_ORDER), 'nor can DIFFICULTY_ORDER')
  t.throws(() => { M.purist.rules.allowSell = true }, 'PURIST cannot have selling switched back on at runtime')
  t.eq(M.purist.rules.allowSell, false, 'and the attempt changed nothing')
  t.throws(() => { D.relentless.rules.startLives = 100 }, 'nor can Relentless be handed more lives')
  t.eq(D.relentless.rules.startLives, 1, 'and that attempt changed nothing either')

  // Freezing the registry must not freeze the resolved ruleset — explicit overrides
  // and any future in-run rule change still have to work.
  const mutSim = simFor('medium', 'primary-only')
  t.notOk(Object.isFrozen(mutSim.rules), 'the resolved ruleset itself is a fresh, writable object')
  t.noThrow(() => { mutSim.rules.costMul = 2 }, 'so a scalar rule can still be overridden per sim')
  t.eq(D.medium.rules.costMul, 1, 'without leaking back into the difficulty')

  /* ================= Reverse, through the map it actually changes ================= */

  t.section('Reverse produces a genuinely reversed map, and only when the flag is set')
  // The sim never reads sim.rules.reversePaths; the shell applies it to the map
  // before Sim.create. Reproduced here, because a mode whose only assertion is
  // "the flag is true" is a mode that could be a no-op forever.
  function shellMap (modeKey) {
    const base = { key: 'test', paths: [straightTrack(OP, 1200)] }
    const def = M[modeKey]
    return (def && def.rules && def.rules.reversePaths) ? OP.Maps.reversePaths(base) : base
  }
  const plainMap = shellMap('standard')
  const revMap = shellMap('reverse')
  t.eq(plainMap.paths[0], plainMap.paths[0], 'Standard hands the map through untouched')
  t.notOk(plainMap.reversed, 'and does not mark it reversed')
  t.ok(revMap.reversed, 'Reverse marks the map reversed')
  t.neq(revMap.paths[0], plainMap.paths[0], 'and hands over a different Track object')
  const fwd = plainMap.paths[0], back = revMap.paths[0]
  t.close(fwd.length, back.length, 1e-6, 'the reversed track is the same length')
  t.close(back.posAt(0).x, fwd.posAt(fwd.length).x, 1e-6, 'the reversed entry is the forward exit (x)')
  t.close(back.posAt(0).y, fwd.posAt(fwd.length).y, 1e-6, 'and (y)')
  t.close(back.posAt(back.length).x, fwd.posAt(0).x, 1e-6, 'and the reversed exit is the forward entry (x)')

  // End to end: a Reverse sim built on the reversed map walks balloons the other way.
  const revSim = S.create(OP.modeConfig('reverse', 'medium', { map: revMap, seed: 'rev' }))
  const fwdSim = S.create(OP.modeConfig('standard', 'medium', { map: plainMap, seed: 'rev' }))
  const rb = OP.Balloons.spawn(revSim, { tier: 'red', path: 0, t: 0 })
  const fb2 = OP.Balloons.spawn(fwdSim, { tier: 'red', path: 0, t: 0 })
  t.close(rb.x, fwdSim.map.paths[0].posAt(fwd.length).x, 1e-6, 'a Reverse balloon enters at the forward exit')
  t.neq(Math.round(rb.x), Math.round(fb2.x), 'so the two modes start a balloon in different places')
  for (let i = 0; i < 60; i++) { OP.Balloons.move(revSim); OP.Balloons.move(fwdSim) }
  t.gt(rb.t, 0, 'and it still advances along its own t')
  t.close(rb.t, fb2.t, 1e-6, 'at the same rate — Reverse costs no second movement path')
  t.eq(revSim.rules.reversePaths, true, 'the flag rides along on sim.rules for the save to restore')
  t.eq(fwdSim.rules.reversePaths, undefined, 'and is absent on every other mode')
}

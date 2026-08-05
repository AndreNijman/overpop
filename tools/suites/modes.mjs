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
    t.ok(/[a-z]/.test(e.blurb) && /\s/.test(e.blurb), `${e.key} blurb reads as a sentence`)
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
  // their own typo by adding it. Exactly two, and each one is justified below.
  const EXTRA = ['heroXpMul', 'reversePaths']
  // Of those, the ones nothing consumes YET, with the phase that will.
  const PENDING = { reversePaths: 'P5.1 — the map loader reverses the polyline' }

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
  t.eq(EXTRA.length, 2, 'exactly two rule fields live outside defaultRules()')
  for (const k of EXTRA) {
    t.notOk(KNOWN.has(k), `${k} is genuinely absent from defaultRules() — otherwise drop it from EXTRA`)
    const site = readsRuleField(k)
    t.ok(site || PENDING[k], `${k} is either read by the shipped bundle (${site}) or documented as pending (${PENDING[k] || 'no'})`)
  }
  t.eq(readsRuleField('heroXpMul'), 'js/core/heroes.js', 'heroXpMul is read by the hero XP rate')
  t.deep(Object.keys(PENDING), ['reversePaths'], 'only reversePaths is forward-declared')

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
    const dflt = field === 'heroXpMul' ? 1 : defaults[field]
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
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'purist', rules: { startLives: 99 } }).startLives, 99,
    'an explicit override beats the mode')
  t.eq(S.resolveRules({ difficulty: 'relentless', mode: 'purist', rules: { startLives: 99 } }).allowSell, false,
    'without disturbing the rest of the mode delta')

  t.section('assignment, not composition — the surprise is pinned here')
  // applyRules assigns, so a mode figure REPLACES the difficulty figure. Hard's
  // 0.9 pop income does not stack with Half Cash's 0.5 into 0.45.
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

  t.section('a mode with roundSetKey "alternate" yields sim.roundSetKey === "alternate"')
  const altSim = simFor('medium', 'alternate-waves')
  t.eq(altSim.roundSetKey, 'alternate', 'the sim is playing the alternate waves')
  t.eq(altSim.mode, 'alternate-waves', 'and knows which mode asked for them')
  t.eq(simFor('medium', 'standard').roundSetKey, 'standard', 'while Standard plays the standard table')
  t.eq(JSON.parse(JSON.stringify(S.serialize(altSim))).roundSetKey, 'alternate',
    'and the key is what the save records, so a resumed run keeps the same waves')

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
}

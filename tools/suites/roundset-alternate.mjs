export const name = 'roundset-alternate'
export const needs = ['js/data/rounds-alternate.js', 'js/core/freeplay.js']

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../loadgame.mjs'
import { makeSim, ticks, straightTrack } from './_fixture.mjs'

/* Two things are under test here.

   1. OP.ROUNDS_ALTERNATE — the Alternate Waves table. The interesting assertions
      are not "it has a hundred entries" but "it is a genuinely different hundred
      rounds": blimps earlier and in packs, more VEILED, tighter clumps, and a
      handful of rounds no single tower type answers. A copy of the standard set
      would satisfy a shape check and fail the mode.

   2. OP.Freeplay — rounds 101+. The load-bearing property is determinism from the
      round index alone. A generator that rolled from sim.rng would pass every
      "is it a valid round" check and then silently diverge the first time a
      player saved mid-freeplay and reloaded, because the RNG would have been
      advanced a different number of times. So this suite checks the round is
      identical across seeds, across sims, across a save/reload, and that
      generating consumes no randomness at all. */

export function run (t, OP) {
  const R = OP.Rounds
  const P = OP.PROP
  const ALT = OP.ROUNDS_ALTERNATE
  const isBlimp = key => OP.tierByKey(key).blimp
  const rbeOf = n => R.roundRBE(ALT[n])
  const norm = def => def.groups.map(R.normalizeGroup)

  /* ---------------------------------------------------------------- registration */

  t.section('the set registers itself by key')
  t.eq(typeof ALT, 'object', 'OP.ROUNDS_ALTERNATE is an object')
  t.ok(ALT !== null, 'and not null')
  t.eq(OP.ROUND_SETS.alternate, ALT, 'OP.ROUND_SETS.alternate points at the same table')
  t.neq(OP.ROUND_SETS.alternate, undefined, 'so a save can name the set rather than embed it')

  // Guarded: js/data/modes.js belongs to another step, so its absence must not
  // fail this suite — but if it is loaded, the key it names has to resolve, or
  // picking Alternate Waves silently starts a standard game.
  const altMode = OP.MODES && OP.MODES['alternate-waves']
  if (altMode) {
    t.eq(altMode.roundSetKey, 'alternate', 'the Alternate Waves mode names this set by key')
    t.eq(OP.ROUND_SETS[altMode.roundSetKey], ALT, 'and that key resolves to this table')
  } else {
    t.ok(true, 'OP.MODES is not loaded yet — skipping the mode wiring check')
  }

  t.section('it covers exactly rounds 1..100')
  const keys = Object.keys(ALT)
  t.eq(keys.length, 100, 'a hundred entries')
  const missing = []
  for (let n = 1; n <= 100; n++) if (!ALT[n]) missing.push(n)
  t.eq(missing.length, 0, 'every index 1..100 is present', 'missing: ' + missing.join(','))
  t.eq(ALT[0], undefined, 'no round 0')
  t.eq(ALT[101], undefined, 'and no round 101 — that is the freeplay generator')
  t.ok(keys.every(k => /^[1-9][0-9]*$/.test(k)), 'every key is a plain positive integer')

  /* ------------------------------------------------------------------ structure */

  t.section('every group is structurally valid')
  const problems = { tier: [], count: [], spacing: [], delay: [], props: [], path: [], scale: [], empty: [] }
  for (let n = 1; n <= 100; n++) {
    const def = ALT[n]
    if (!def || !Array.isArray(def.groups)) { problems.empty.push(n); continue }
    if (!def.groups.length) problems.empty.push(n)
    for (const raw of def.groups) {
      if (OP.BALLOON_INDEX[raw.tier] === undefined) problems.tier.push(n + ':' + raw.tier)
      const g = R.normalizeGroup(raw)
      if (!Number.isInteger(g.count) || g.count < 1) problems.count.push(n + ':' + g.count)
      if (!(g.spacing >= 0) || !isFinite(g.spacing)) problems.spacing.push(n + ':' + g.spacing)
      if (!(g.delay >= 0) || !isFinite(g.delay)) problems.delay.push(n + ':' + g.delay)
      if ((g.props & ~(P.VEILED | P.REGEN | P.PLATED)) !== 0) problems.props.push(n + ':' + g.props)
      if (!Number.isInteger(g.path) || g.path < -1 || g.path > 3) problems.path.push(n + ':' + g.path)
      // Authored rounds must NOT pin their own scaling: leaving hpScale at 0 is
      // what lets sim.rules (difficulty, Double HP Blimps, Deflation) apply.
      if (g.hpScale !== 0 || g.speedScale !== 0) problems.scale.push(n)
    }
  }
  t.eq(problems.empty.length, 0, 'no round is empty', problems.empty.join(','))
  t.eq(problems.tier.length, 0, 'every group names a tier from the roster', problems.tier.join(' '))
  t.eq(problems.count.length, 0, 'every count is a positive integer', problems.count.join(' '))
  t.eq(problems.spacing.length, 0, 'every spacing is a finite non-negative number', problems.spacing.join(' '))
  t.eq(problems.delay.length, 0, 'every delay is a finite non-negative number', problems.delay.join(' '))
  t.eq(problems.props.length, 0, 'props only ever use VEILED / REGEN / PLATED', problems.props.join(' '))
  t.eq(problems.path.length, 0, 'path is -1 or a small path index', problems.path.join(' '))
  t.eq(problems.scale.length, 0, 'no authored group overrides hpScale/speedScale', problems.scale.join(','))

  t.section('every round is servable by the runner')
  let worstDuration = 0
  let zeroRBE = 0
  for (let n = 1; n <= 100; n++) {
    const d = R.roundDuration(ALT[n])
    if (!(d >= 0) || !isFinite(d)) worstDuration = Infinity
    else if (d > worstDuration) worstDuration = d
    if (!(rbeOf(n) > 0)) zeroRBE++
  }
  t.eq(zeroRBE, 0, 'no round has zero RBE')
  t.ok(isFinite(worstDuration), 'every round has a finite release window')
  t.lt(worstDuration, 120, `the longest round releases inside two minutes (${worstDuration.toFixed(1)}s)`)
  t.noThrow(() => { for (let n = 1; n <= 100; n++) R.roundRBE(ALT[n]) }, 'RBE is computable for all 100 rounds')

  /* ---------------------------------------------------------------- the curve */

  t.section('the RBE trajectory')
  t.gt(rbeOf(1), 0, 'round 1 has something in it')
  t.lt(rbeOf(1), 30, `round 1 is gentle: ${rbeOf(1)} RBE`)
  t.between(rbeOf(100), 150000, 400000, `round 100 lands in the target band: ${rbeOf(100)} RBE`)

  const regressions = []
  let steepest = 0
  let steepestAt = 0
  for (let n = 2; n <= 100; n++) {
    const prev = rbeOf(n - 1)
    const cur = rbeOf(n)
    if (cur <= prev) regressions.push(n)
    const ratio = cur / prev
    if (ratio > steepest) { steepest = ratio; steepestAt = n }
  }
  t.eq(regressions.length, 0, 'RBE is strictly increasing across all 100 rounds',
    'regressed at: ' + regressions.join(','))
  t.lt(steepest, 2, `no round more than doubles the previous one (worst ${steepest.toFixed(2)}x at round ${steepestAt})`)
  t.gt(rbeOf(100) / rbeOf(50), 5, 'the second half is a real escalation, not a plateau')
  t.gt(rbeOf(50) / rbeOf(20), 5, 'and so is the middle')
  t.gt(rbeOf(20), 300, `round 20 already has weight: ${rbeOf(20)} RBE`)
  t.lt(rbeOf(10), 400, `round 10 is still an early round: ${rbeOf(10)} RBE`)

  /* ------------------------------------------------ mode identity: early blimps */

  t.section('blimps arrive early, and in groups')
  const firstRoundWith = pred => {
    for (let n = 1; n <= 100; n++) if (ALT[n].groups.some(pred)) return n
    return -1
  }
  const firstBlimp = firstRoundWith(g => isBlimp(g.tier))
  const firstPack = firstRoundWith(g => isBlimp(g.tier) && g.count >= 2)
  t.gt(firstBlimp, 0, `the first blimp is round ${firstBlimp}`)
  t.lte(firstBlimp, 25, 'and it lands by round 25 — much earlier than a standard game')
  t.lte(firstPack, 30, `a grouped blimp arrives by round 30 (round ${firstPack})`)
  t.gte(firstPack, firstBlimp, 'a pack never precedes the first single blimp')

  for (const [tier, latest] of [['goliath', 22], ['wraith', 34], ['leviathan', 40], ['colossus', 62], ['omen', 82]]) {
    const at = firstRoundWith(g => g.tier === tier)
    t.between(at, 1, latest, `${OP.tierByKey(tier).name} debuts by round ${latest} (round ${at})`)
  }

  let blimpRounds = 0
  const blimpGaps = []
  for (let n = 1; n <= 100; n++) {
    const hasBlimp = ALT[n].groups.some(g => isBlimp(g.tier))
    if (hasBlimp) blimpRounds++
    else if (n >= 30) blimpGaps.push(n)
  }
  t.gte(blimpRounds, 55, `most of the set has blimps in it (${blimpRounds} rounds)`)
  t.eq(blimpGaps.length, 0, 'from round 30 on, every round has at least one blimp', blimpGaps.join(','))

  const simultaneous = []
  for (let n = 1; n <= 100; n++) {
    if (ALT[n].groups.some(g => isBlimp(g.tier) && g.count >= 2 && R.normalizeGroup(g).spacing === 0)) simultaneous.push(n)
  }
  t.gte(simultaneous.length, 4, `several rounds drop multiple blimps on one tick (rounds ${simultaneous.join(',')})`)

  /* ------------------------------------------------- mode identity: camo & props */

  t.section('VEILED shows up early and often')
  const firstCamo = firstRoundWith(g => (R.normalizeGroup(g).props & P.VEILED) !== 0)
  let camoRounds = 0
  let camoBlimpGroups = 0
  let regenRounds = 0
  let platedRounds = 0
  for (let n = 1; n <= 100; n++) {
    const gs = norm(ALT[n])
    if (gs.some(g => g.props & P.VEILED)) camoRounds++
    if (gs.some(g => g.props & P.REGEN)) regenRounds++
    if (gs.some(g => g.props & P.PLATED)) platedRounds++
    camoBlimpGroups += gs.filter(g => isBlimp(g.tier) && (g.props & P.VEILED)).length
  }
  t.between(firstCamo, 1, 12, `camo appears by round 12 (round ${firstCamo})`)
  t.gte(camoRounds, 12, `and recurs throughout (${camoRounds} rounds carry VEILED)`)
  t.gte(camoBlimpGroups, 2, `including on blimp packs (${camoBlimpGroups} veiled blimp groups)`)
  t.gte(regenRounds, 3, `REGEN is used as a real threat (${regenRounds} rounds)`)
  t.gte(platedRounds, 1, `and PLATED at least once (${platedRounds} rounds)`)

  t.section('tighter clumps than a standard game')
  let clumpRounds = 0
  let tightest = Infinity
  for (let n = 1; n <= 100; n++) {
    const gs = norm(ALT[n])
    if (gs.some(g => g.spacing === 0 && g.count >= 2)) clumpRounds++
    for (const g of gs) if (g.spacing > 0 && g.spacing < tightest) tightest = g.spacing
  }
  t.gte(clumpRounds, 15, `many rounds dump a whole group on one tick (${clumpRounds} rounds)`)
  t.lte(tightest, 0.16, `and the tightest stream is ${tightest}s apart`)
  const earlyClump = firstRoundWith(g => R.normalizeGroup(g).spacing === 0 && g.count >= 2)
  t.lte(earlyClump, 10, `clumping starts in the first ten rounds (round ${earlyClump})`)

  /* ------------------------------------ mode identity: rounds a mono-build fails */

  t.section('several rounds punish a defence built from one tower type')
  let soupRound = -1
  let soupCount = 0
  for (let n = 1; n <= 100; n++) {
    const tiers = new Set(ALT[n].groups.map(g => g.tier).filter(k => OP.tierByKey(k).immune.length > 0))
    if (tiers.size > soupCount) { soupCount = tiers.size; soupRound = n }
  }
  t.gte(soupCount, 3, `round ${soupRound} mixes ${soupCount} different immunity tiers in one round`)

  const veiledLead = firstRoundWith(g => g.tier === 'lead' && (R.normalizeGroup(g).props & P.VEILED))
  t.gt(veiledLead, 0, `a veiled lead round exists (round ${veiledLead}) — needs detection AND the right damage type`)
  const platedLead = firstRoundWith(g => g.tier === 'lead' && (R.normalizeGroup(g).props & P.PLATED))
  t.gt(platedLead, 0, `a plated lead round exists (round ${platedLead}) — double hull for no extra RBE`)
  const purpleWall = firstRoundWith(g => g.tier === 'purple' && g.count >= 14)
  t.gt(purpleWall, 0, `a purple wall exists (round ${purpleWall}) — fire, plasma and energy all blank`)
  t.lte(purpleWall, 40, 'and it lands while a magic-only board is still committing')

  const flankRounds = []
  for (let n = 1; n <= 100; n++) {
    const named = new Set(norm(ALT[n]).map(g => g.path).filter(p => p >= 0))
    if (named.size > 1) flankRounds.push(n)
  }
  t.gte(flankRounds.length, 1,
    `at least one round pins groups to two different paths (rounds ${flankRounds.join(',')})`)
  t.ok(flankRounds.every(n => norm(ALT[n]).every(g => g.path < 4)),
    'and never names a path index no map could have')

  /* ----------------------------------------------------------- naming hygiene */

  t.section('naming: nothing borrowed leaks into the content files')
  // Positive list rather than a blocklist: the acronym-shaped names other games
  // use for their blimps would show up as unexpected all-caps tokens here, and a
  // blocklist would mean writing them into this repo to test for them.
  const ALLOWED_CAPS = new Set([
    'ALTERNATE', 'WAVES', 'AND', 'THE', 'ONE', 'RULE', 'THAT', 'MATTERS', 'OVERRIDE',
    'GOLIATH', 'WRAITH', 'LEVIATHAN', 'COLOSSUS', 'OMEN',
    'VEILED', 'REGEN', 'PLATED', 'PURIST', 'RBE', 'HP', 'HUD', 'RNG', 'KEY', 'CAP',
    'OP', 'PROP', 'ROUNDS', 'ROUNDS_ALTERNATE', 'ROUND_SETS', 'FIRST', 'LAST_AUTHORED',
    'MAX_BALLOONS', 'DT', 'MODES', 'DMG'
  ])
  for (const rel of ['js/data/rounds-alternate.js', 'js/core/freeplay.js']) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    // No trailing \b, so a plural such as "OMENs" is still checked as "OMEN".
    const tokens = [...new Set(src.match(/\b[A-Z][A-Z0-9_]+/g) || [])]
    const unexpected = tokens.filter(x => !ALLOWED_CAPS.has(x))
    t.eq(unexpected.length, 0, `${rel} contains no unexpected capitalised names`, unexpected.join(' '))
    t.ok(/^;\(function \(OP\) \{\n {2}'use strict'/.test(src), `${rel} uses the standard IIFE preamble`)
    t.notOk(/\bMath\.random\b/.test(src), `${rel} never reaches for Math.random`)
    t.notOk(/\b(import|export)\s/.test(src), `${rel} is a classic script, not an ES module`)
  }

  /* ---------------------------------- it is genuinely different from the standard */

  t.section('it is not a copy of the standard set')
  const signature = def => norm(def)
    .map(g => [g.tier, g.count, g.spacing, g.delay, g.props, g.path].join(':'))
    .join('|')
  const STD = OP.ROUNDS_STANDARD
  if (STD && STD[1] && STD[100]) {
    let differing = 0
    let comparable = 0
    for (let n = 1; n <= 100; n++) {
      if (!STD[n] || !Array.isArray(STD[n].groups)) continue
      comparable++
      if (signature(ALT[n]) !== signature(STD[n])) differing++
    }
    t.gte(comparable, 90, `the standard set is complete enough to compare (${comparable} rounds)`)
    t.gte(differing, 60, `at least 60 of 100 rounds differ from the standard set (${differing} differ)`)
    t.neq(OP.ROUND_SETS.alternate, OP.ROUND_SETS.standard, 'the two sets are distinct objects')
  } else {
    // Another agent owns js/data/rounds-standard.js. Its absence must not fail
    // this suite, but the fact that the comparison did not run gets recorded.
    t.ok(true, 'OP.ROUNDS_STANDARD is not loaded yet — skipping the cross-set comparison')
  }

  /* ------------------------------------------------- the set actually simulates */

  t.section('round 1 of the alternate set runs end to end')
  let sim = makeSim(OP, { trackLength: 400, lives: 5000, roundSet: ALT, roundSetKey: 'alt-suite' })
  R.begin(sim, 1)
  t.eq(sim.round.rbe, rbeOf(1), 'the armed round reports the derived RBE')
  ticks(OP, sim, 1)
  t.eq(sim.stats.spawned, 8, 'the opening clump comes out on the first tick')
  ticks(OP, sim, 60 * 40)
  t.ok(R.allReleased(sim), 'everything was released')
  t.eq(sim.stats.spawned, 20, 'twenty balloons in total')
  t.eq(sim.stats.leaked, rbeOf(1), 'and with no defence the whole round leaks exactly its RBE')

  t.section('authored rounds inherit HP scaling from the rules')
  sim = makeSim(OP, { trackLength: 4000, roundSet: ALT, roundSetKey: 'alt-suite', rules: { hpScale: 3 } })
  R.begin(sim, 21)
  ticks(OP, sim, 1)
  const cer = sim.balloons.find(b => OP.BALLOON_TIERS[b.tier].key === 'ceramic')
  t.ok(cer, 'round 21 opens with ceramics')
  t.eq(cer.hp, 30, 'and hpScale 3 triples the shell, because the group does not pin its own scale')

  t.section('a sim can select the set by key, and a save round-trips it')
  const altMap = () => ({ key: 'alt-map', paths: [straightTrack(OP, 3000)], placement: null, blockers: null })
  const bySet = OP.Sim.create({
    map: altMap(), seed: 'alt', roundSetKey: 'alternate',
    rules: { startCash: 2000, startLives: 900 }
  })
  t.eq(bySet.roundSet, ALT, 'roundSetKey "alternate" resolves to the alternate table')
  t.eq(bySet.roundSetKey, 'alternate', 'and the key is what gets recorded')
  OP.Sim.startRound(bySet, 24)
  OP.Sim.run(bySet, 240)
  const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(bySet)))
  t.eq(snap.roundSetKey, 'alternate', 'the save names the set')
  const reloaded = OP.Sim.deserialize(snap, altMap())
  t.eq(reloaded.roundSet, ALT, 'and the reload resolves it from OP.ROUND_SETS')
  t.eq(OP.Sim.checksum(reloaded), OP.Sim.checksum(bySet), 'the reloaded game is bit-identical')

  /* ====================================================================== */
  /* freeplay                                                               */
  /* ====================================================================== */

  const F = OP.Freeplay

  t.section('the freeplay generator exposes what the shell and HUD need')
  t.eq(typeof F, 'object', 'OP.Freeplay is an object')
  t.eq(typeof F.generate, 'function', 'OP.Freeplay.generate is a function')
  t.eq(typeof F.scaleFor, 'function', 'OP.Freeplay.scaleFor is a function')
  t.eq(F.FIRST, 101, 'the first generated round is 101 — one past the authored table')
  t.eq(F.LAST_AUTHORED, 100, 'and the authored table is declared as 100 rounds')

  t.section('generated rounds are valid rounds')
  const fpSim = makeSim(OP, { trackLength: 3000, roundSet: ALT, roundSetKey: 'alt-suite' })
  for (const n of [101, 150, 250, 500]) {
    const def = F.generate(fpSim, n)
    t.ok(def && Array.isArray(def.groups), `round ${n} produces a groups array`)
    t.gt(def.groups.length, 0, `round ${n} is not empty`)
    t.gt(R.roundRBE(def), 0, `round ${n} has non-zero RBE (${R.roundRBE(def)})`)
    const bad = def.groups.filter(g => OP.BALLOON_INDEX[g.tier] === undefined ||
      !Number.isInteger(g.count) || g.count < 1 || !(g.spacing >= 0) || !(g.delay >= 0))
    t.eq(bad.length, 0, `round ${n} groups are all well-formed`, JSON.stringify(bad))
    t.ok(def.groups.some(g => isBlimp(g.tier)), `round ${n} contains blimps`)
    t.ok(isFinite(R.roundDuration(def)), `round ${n} has a finite release window`)
    t.noThrow(() => R.begin(makeSim(OP, { trackLength: 1000 }), n), `round ${n} can be armed by the runner`)
  }

  t.section('no generated round is ever empty or weightless')
  let emptyRounds = 0
  let weightless = 0
  let longest = 0
  for (let n = 101; n <= 400; n++) {
    const def = F.generate(fpSim, n)
    if (!def.groups.length) emptyRounds++
    if (!(R.roundRBE(def) > 0)) weightless++
    const d = R.roundDuration(def)
    if (d > longest) longest = d
  }
  t.eq(emptyRounds, 0, 'rounds 101..400: none empty')
  t.eq(weightless, 0, 'rounds 101..400: none with zero RBE')
  t.lt(longest, 90, `and none takes more than 90s to release (worst ${longest.toFixed(1)}s)`)

  t.section('determinism: the same index gives the same round, twice')
  const once = JSON.stringify(F.generate(fpSim, 137))
  const twice = JSON.stringify(F.generate(fpSim, 137))
  t.eq(once, twice, 'generate(sim, 137) is stable across calls')
  t.neq(once, JSON.stringify(F.generate(fpSim, 138)), 'and round 138 is a different round — not vacuous')

  t.section('determinism: the seed cannot influence a generated round')
  const seedA = makeSim(OP, { seed: 'aaa', trackLength: 3000 })
  const seedB = makeSim(OP, { seed: 'zzz-completely-different', trackLength: 3000 })
  t.neq(seedA.rng.next(), seedB.rng.next(), 'the two sims really do have different RNG streams')
  t.eq(JSON.stringify(F.generate(seedA, 137)), JSON.stringify(F.generate(seedB, 137)),
    'two sims with different seeds generate an identical round 137')

  t.section('determinism: generating consumes no randomness')
  const drawSim = makeSim(OP, { seed: 'draws', trackLength: 3000 })
  const callsBefore = drawSim.rng.calls
  F.generate(drawSim, 137)
  F.generate(drawSim, 512)
  F.scaleFor(300)
  t.eq(drawSim.rng.calls, callsBefore, 'generate() never touches sim.rng')

  const advanced = makeSim(OP, { seed: 'draws', trackLength: 3000 })
  for (let i = 0; i < 1000; i++) advanced.rng.next()
  t.gt(advanced.rng.calls, 999, 'the second sim has burned a thousand draws')
  t.eq(JSON.stringify(F.generate(advanced, 137)), JSON.stringify(F.generate(drawSim, 137)),
    'a sim mid-stream generates the same round as a fresh one — this is what survives a save')

  t.section('determinism: a reloaded save generates the round it was going to')
  const before = OP.Sim.create({
    map: altMap(), seed: 'freeplay-save', roundSetKey: 'alternate',
    rules: { startCash: 2000, startLives: 900 }
  })
  OP.Sim.startRound(before, 30)
  OP.Sim.run(before, 300)
  const wouldHave = JSON.stringify(F.generate(before, 137))
  const after = OP.Sim.deserialize(JSON.parse(JSON.stringify(OP.Sim.serialize(before))), altMap())
  t.eq(JSON.stringify(F.generate(after, 137)), wouldHave,
    'the reloaded sim generates exactly the round the un-interrupted run would have')
  t.eq(JSON.stringify(F.generate(null, 137)), wouldHave,
    'and so does a call with no sim at all — the round is a function of its index')

  t.section('determinism: a nonsense index degrades instead of exploding')
  t.noThrow(() => F.generate(fpSim, NaN), 'NaN does not throw')
  t.gt(F.generate(fpSim, NaN).groups.length, 0, 'and still produces a round')
  t.deep(F.generate(fpSim, 50), F.generate(fpSim, 101),
    'an index inside the authored range clamps to the first freeplay round')
  t.deep(F.generate(fpSim, 101.7), F.generate(fpSim, 101), 'a fractional index floors')

  /* ------------------------------------------------------------------ scaling */

  t.section('scaleFor grows smoothly and monotonically')
  const s101 = F.scaleFor(101)
  t.gt(s101.hpScale, 1, `round 101 already scales HP (${s101.hpScale})`)
  t.lt(s101.hpScale, 1.05, 'but only just — the seam with round 100 is not a cliff')
  t.gt(s101.speedScale, 1, `and speed too (${s101.speedScale})`)
  t.lt(s101.speedScale, 1.05, 'gently')

  let hpRegress = 0
  let speedRegress = 0
  let prev = F.scaleFor(101)
  for (let n = 102; n <= 500; n++) {
    const cur = F.scaleFor(n)
    if (!(cur.hpScale > prev.hpScale)) hpRegress++
    if (!(cur.speedScale > prev.speedScale)) speedRegress++
    prev = cur
  }
  t.eq(hpRegress, 0, 'hpScale strictly increases every round from 101 to 500')
  t.eq(speedRegress, 0, 'speedScale strictly increases every round from 101 to 500')

  const s120 = F.scaleFor(120)
  const s150 = F.scaleFor(150)
  const s500 = F.scaleFor(500)
  t.between(s120.hpScale, 1.15, 2.5, `round 120 HP scaling stays survivable (${s120.hpScale}x)`)
  t.gt(s150.hpScale, s120.hpScale, 'round 150 is harder than round 120')
  t.gt(s500.hpScale, s150.hpScale, 'and 500 harder than 150')
  t.lt(s120.speedScale, 1.4, `round 120 speed is still readable (${s120.speedScale}x)`)
  t.lt(s500.speedScale, 2, `speed is bounded even at round 500 (${s500.speedScale}x)`)
  t.gt(s500.speedScale, s150.speedScale, 'while still climbing')

  t.section('the generator writes the scaling into every group')
  const g150 = F.generate(fpSim, 150)
  t.ok(g150.groups.every(g => g.hpScale === s150.hpScale), 'every group carries scaleFor()\'s hpScale')
  t.ok(g150.groups.every(g => g.speedScale === s150.speedScale), 'and its speedScale')
  t.ok(g150.groups.every(g => g.hpScale > 1 && g.speedScale > 1), 'both are above 1, so the round is actually scaled')

  t.section('a rules-level scale multiplies through instead of being overwritten')
  // OP.Rounds.tick reads `g.hpScale || rules.hpScale` — a per-group scale is an
  // OVERRIDE. If the generator ignored rules.hpScale, a mode that scaled HP would
  // silently stop applying the moment freeplay started.
  const doubled = makeSim(OP, { trackLength: 3000, rules: { hpScale: 2, speedScale: 1.5 } })
  const dg = F.generate(doubled, 150)
  t.close(dg.groups[0].hpScale, s150.hpScale * 2, 1e-5, 'rules.hpScale 2 doubles the generated hpScale')
  t.close(dg.groups[0].speedScale, s150.speedScale * 1.5, 1e-5, 'and rules.speedScale multiplies too')
  t.deep(dg.groups.map(g => g.tier), g150.groups.map(g => g.tier), 'without changing the composition')

  t.section('blimp density climbs with the round index')
  const blimpCount = n => F.generate(fpSim, n).groups
    .filter(g => isBlimp(g.tier)).reduce((a, g) => a + g.count, 0)
  const b101 = blimpCount(101)
  const b150 = blimpCount(150)
  const b250 = blimpCount(250)
  const b500 = blimpCount(500)
  t.gt(b101, 0, `round 101 already has ${b101} blimps`)
  t.gt(b150, b101, `round 150 has more (${b150})`)
  t.gt(b250, b150, `round 250 more again (${b250})`)
  t.gt(b500, b250, `and round 500 the most (${b500})`)
  let densityRegress = 0
  let prevBlimps = blimpCount(101)
  for (let n = 102; n <= 300; n++) {
    const cur = blimpCount(n)
    if (cur < prevBlimps) densityRegress++
    prevBlimps = cur
  }
  t.eq(densityRegress, 0, 'blimp count never drops from one freeplay round to the next')
  t.ok(F.generate(fpSim, 101).groups.some(g => g.tier === 'omen'),
    'the hardest blimp is present from the first freeplay round')

  t.section('nominal RBE climbs too, and the seam with round 100 has no dip')
  const fpRBE = n => R.roundRBE(F.generate(fpSim, n))
  t.gt(fpRBE(101), rbeOf(100), `round 101 (${fpRBE(101)}) is heavier than authored round 100 (${rbeOf(100)})`)
  t.gt(fpRBE(150), fpRBE(101), 'round 150 heavier than 101')
  t.gt(fpRBE(250), fpRBE(150), 'round 250 heavier than 150')
  t.gt(fpRBE(500), fpRBE(250), 'round 500 heavier than 250')
  let rbeRegress = 0
  let prevRBE = fpRBE(101)
  for (let n = 102; n <= 300; n++) {
    const cur = fpRBE(n)
    if (cur < prevRBE) rbeRegress++
    prevRBE = cur
  }
  t.eq(rbeRegress, 0, 'and never dips between consecutive freeplay rounds')
  t.lt(fpRBE(120) / fpRBE(101), 2, 'the twenty rounds after the table are a ramp, not a wall')

  t.section('generated props stay inside the property mask')
  let badProps = 0
  let camoSeen = 0
  for (let n = 101; n <= 240; n++) {
    for (const g of F.generate(fpSim, n).groups) {
      const props = g.props || 0
      if ((props & ~(P.VEILED | P.REGEN | P.PLATED)) !== 0) badProps++
      if (props & P.VEILED) camoSeen++
    }
  }
  t.eq(badProps, 0, 'no generated group invents a property bit')
  t.gt(camoSeen, 0, 'and camo still turns up in freeplay')

  /* --------------------------------------------------- freeplay actually runs */

  t.section('a generated round runs on a sim whose round set does not have it')
  const run = makeSim(OP, {
    trackLength: 250, lives: 50000000,
    roundSet: { 1: { groups: [{ tier: 'red', count: 4, spacing: 0.3 }] } },
    roundSetKey: 'fp-short'
  })
  run.freeplay = true
  t.eq(run.roundSet[101], undefined, 'the round set has no entry for 101')
  const expected = F.generate(run, 101).groups.reduce((a, g) => a + g.count, 0)
  const armed = R.begin(run, 101)
  t.ok(armed, 'the runner armed something')
  t.gt(armed.groups.length, 0, 'with groups')
  t.gt(armed.rbe, 0, `and an RBE the HUD can show (${armed.rbe})`)
  t.eq(armed.index, 101, 'recorded as round 101')
  t.notOk(run.events.some(e => e.kind === 'error'), 'no error event was recorded')

  ticks(OP, run, 1)
  t.gt(run.stats.spawned, 0, 'balloons are released on the first tick')
  ticks(OP, run, 60 * 120)
  t.ok(R.allReleased(run), 'everything was eventually released')
  t.eq(run.stats.spawned, expected, `every balloon the definition asked for was spawned (${expected})`)
  t.lt(expected, OP.MAX_BALLOONS, 'and the round never asks for more than the entity ceiling allows')
  t.ok(run.round.done, 'and the round terminated rather than hanging')
  t.notOk(run.over, 'with lives to spare, the run continues')
  t.gt(run.stats.leaked, 0, 'the undefended round leaked')

  t.section('Rounds.next past the end of the table generates rather than erroring')
  const chain = makeSim(OP, {
    trackLength: 200, lives: 50000000, cash: 0,
    roundSet: { 1: { groups: [{ tier: 'red', count: 3, spacing: 0.2 }] } },
    roundSetKey: 'fp-chain',
    rules: { lastRound: 1 }
  })
  chain.freeplay = true
  R.begin(chain, 1)
  ticks(OP, chain, 60 * 30)
  t.ok(chain.round.done, 'the last authored round completed')
  t.notOk(chain.over, 'and freeplay kept the game alive past rules.lastRound')
  const nextRound = R.next(chain)
  t.ok(nextRound, 'next() armed a round past the table')
  t.eq(chain.roundIndex, 2, 'the index advanced')
  t.gt(nextRound.groups.length, 0, 'the generated round has groups')
  t.gt(nextRound.rbe, 0, `and non-zero RBE (${nextRound.rbe})`)
  const errs = chain.events.filter(e => e.kind === 'error')
  t.eq(errs.length, 0, 'no error event was emitted', JSON.stringify(errs))
  t.notOk(chain.events.some(e => e.kind === 'error' && e.what === 'missing-round'),
    'and specifically no missing-round error — the generator, not the fallback, served it')
  const spawnedBefore = chain.stats.spawned
  ticks(OP, chain, 60)
  t.gt(chain.stats.spawned - spawnedBefore, 0, 'and the generated round is really spawning')

  t.section('the missing-round fallback is what freeplay is displacing')
  // Vacuity check: with the generator removed, the very same call records the
  // error. Restored immediately — the bundle context is shared across suites.
  const saved = OP.Freeplay
  try {
    delete OP.Freeplay
    const bare = makeSim(OP, {
      trackLength: 200, lives: 1000,
      roundSet: { 1: { groups: [{ tier: 'red', count: 3, spacing: 0.2 }] } },
      roundSetKey: 'fp-bare'
    })
    R.begin(bare, 101)
    t.ok(bare.events.some(e => e.kind === 'error' && e.what === 'missing-round'),
      'without OP.Freeplay the runner falls back and records missing-round')
  } finally {
    OP.Freeplay = saved
  }
  t.eq(OP.Freeplay, saved, 'and the generator is put back for every later suite')
}

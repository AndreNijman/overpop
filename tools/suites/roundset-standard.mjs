// The standard 100-round table.
//
// This suite audits the DATA, not the runner (that is `rounds`). It asserts the
// shape of every group, the RBE curve across all one hundred rounds, the round
// each balloon tier first appears, where the properties start, the personality
// rounds the table is supposed to contain, and — the part that cannot be checked
// by reading — that a sample of rounds actually releases every balloon it claims
// when handed to the real runner with no towers on the board.

export const name = 'roundset-standard'
export const needs = ['js/data/rounds-standard.js', 'js/core/rounds.js', 'js/core/sim.js']

import { makeSim, ticks } from './_fixture.mjs'

export function run (t, OP) {
  const R = OP.Rounds
  const SET = OP.ROUNDS_STANDARD
  const P = OP.PROP

  // Every round index in ascending numeric order. Object key order is insertion
  // order for integer-like keys, but sorting numerically makes the curve scan
  // independent of how the literal was written.
  const nums = Object.keys(SET).map(Number).sort(function (a, b) { return a - b })

  /** Raw (un-normalised) groups, so "the author left this field alone" is testable. */
  const rawGroups = n => SET[n].groups
  const groupsOf = n => SET[n].groups.map(R.normalizeGroup)
  const countOf = n => groupsOf(n).reduce((s, g) => s + g.count, 0)
  const rbeOf = n => R.roundRBE(SET[n])

  /* A missing personality round must not abort the rest of the suite — the whole
     point of a hundred-round audit is to see every failure in one run, not the
     first one. */
  function pick (list, label) {
    if (list && list.length) return list[0]
    t.fail(`no ${label} round exists to exercise`, 'the data-level assertion above has the detail')
    return null
  }

  /* Aggregate scans report the FIRST offending round in the message. One
     assertion per rule beats one hundred near-identical assertions: the failure
     message carries the round number, so it is no less diagnostic. */
  function scan (msg, fn) {
    let bad = null
    for (let i = 0; i < nums.length && bad === null; i++) {
      const detail = fn(nums[i])
      if (detail) bad = 'round ' + nums[i] + ': ' + detail
    }
    return t.ok(bad === null, bad === null ? msg : msg + ' — ' + bad)
  }

  /* ---------- registration ---------- */

  t.section('the table registers itself')
  t.ok(SET && typeof SET === 'object', 'OP.ROUNDS_STANDARD exists')
  t.eq(OP.ROUND_SETS.standard, SET, 'and is registered as the "standard" round set')
  t.eq(typeof OP.roundSetRBE, 'function', 'OP.roundSetRBE is exported')

  t.section('exactly rounds 1 to 100, no gaps and no extras')
  t.eq(nums.length, 100, 'one hundred rounds are defined')
  let gap = null
  for (let i = 1; i <= 100 && gap === null; i++) if (!SET[i]) gap = i
  t.ok(gap === null, gap === null ? 'every round from 1 to 100 is present' : `round ${gap} is missing`)
  const extra = nums.filter(n => !(Number.isInteger(n) && n >= 1 && n <= 100))
  t.eq(extra.length, 0, 'no round outside 1..100' + (extra.length ? ': ' + extra.join(',') : ''))
  t.eq(nums[0], 1, 'the table starts at round 1')
  t.eq(nums[nums.length - 1], 100, 'and ends at round 100')

  /* ---------- group shape ---------- */

  t.section('every group is authored in the shape the runner reads')
  scan('every round has at least one group', n =>
    Array.isArray(SET[n].groups) && SET[n].groups.length > 0 ? null : 'no groups array')
  scan('every tier is a real key in OP.BALLOON_INDEX', n => {
    for (const g of rawGroups(n)) {
      if (OP.BALLOON_INDEX[g.tier] === undefined) return 'unknown tier ' + JSON.stringify(g.tier)
    }
    return null
  })
  scan('every count is a positive integer', n => {
    for (const g of groupsOf(n)) {
      if (!Number.isInteger(g.count) || g.count < 1) return 'bad count ' + g.count + ' on ' + g.tier
    }
    return null
  })
  scan('every spacing is zero or positive', n => {
    for (const g of groupsOf(n)) if (!(g.spacing >= 0)) return 'bad spacing ' + g.spacing + ' on ' + g.tier
    return null
  })
  // The runner quantises spacing to whole ticks with Math.max(1, ...), so any
  // spacing between 0 and one tick releases faster than roundDuration claims.
  // Authoring either 0 (a deliberate clump) or something a tick can express
  // keeps duration honest.
  scan('spacing is either exactly 0 or at least 0.05s, so duration never lies', n => {
    for (const g of groupsOf(n)) {
      if (g.spacing > 0 && g.spacing < 0.05) return 'sub-tick spacing ' + g.spacing + ' on ' + g.tier
    }
    return null
  })
  scan('every delay is zero or positive', n => {
    for (const g of groupsOf(n)) if (!(g.delay >= 0)) return 'bad delay ' + g.delay + ' on ' + g.tier
    return null
  })
  scan('every path is -1 (spread) or a real path index', n => {
    for (const g of groupsOf(n)) {
      if (!Number.isInteger(g.path) || g.path < -1) return 'bad path ' + g.path + ' on ' + g.tier
    }
    return null
  })
  const PROP_MASK = P.VEILED | P.REGEN | P.PLATED | P.FORTIFIED
  scan('props use only VEILED, REGEN, PLATED and FORTIFIED bits', n => {
    for (const g of groupsOf(n)) {
      if (!Number.isInteger(g.props) || (g.props & ~PROP_MASK)) return 'stray prop bits ' + g.props
    }
    return null
  })
  // Rounds.tick reads `g.hpScale || rules.hpScale` — an authored value REPLACES
  // the rule instead of multiplying it, so a scale baked into the standard table
  // would silently opt those balloons out of Onslaught, Deflation and freeplay
  // scaling forever.
  scan('no group hardcodes hpScale or speedScale — those belong to the rules', n => {
    for (const g of rawGroups(n)) {
      if (g.hpScale !== undefined) return 'authored hpScale on ' + g.tier
      if (g.speedScale !== undefined) return 'authored speedScale on ' + g.tier
    }
    return null
  })
  scan('normalising a group never throws and never yields NaN', n => {
    for (const raw of rawGroups(n)) {
      let g
      try { g = R.normalizeGroup(raw) } catch (e) { return 'normalizeGroup threw: ' + e.message }
      if ([g.count, g.spacing, g.delay, g.path, g.props].some(v => typeof v !== 'number' || Number.isNaN(v))) {
        return 'NaN field on ' + g.tier
      }
    }
    return null
  })
  scan('no round authors more balloons than the entity ceiling allows', n =>
    countOf(n) < OP.MAX_BALLOONS ? null : countOf(n) + ' balloons exceeds MAX_BALLOONS')

  /* ---------- the RBE curve ---------- */

  t.section('the curve starts small and ends enormous')
  // An unknown tier key throws out of OP.balloonRBE. Catching it here keeps that
  // one authoring slip from swallowing the other ninety-nine rounds' worth of
  // findings; the tier-validity scan above already named it.
  const rbe = {}
  let rbeThrew = null
  for (const n of nums) {
    try { rbe[n] = rbeOf(n) } catch (e) { rbe[n] = 0; if (rbeThrew === null) rbeThrew = n + ': ' + e.message }
  }
  t.ok(rbeThrew === null, rbeThrew === null
    ? 'every round can be costed from the balloon tree'
    : 'a round could not be costed — round ' + rbeThrew)

  t.lt(rbe[1], 25, `round 1 is a handful of reds (${rbe[1]} RBE)`)
  t.gte(rbe[1], 5, 'but it is not empty')
  t.ok(groupsOf(1).every(g => g.tier === 'red'), 'and it is nothing but reds')
  t.between(rbe[100], 40000, 80000, `round 100 is a single OMEN, as in BTD6 (${rbe[100]} RBE)`)
  const heaviest = Math.max(...nums.map(n => rbe[n]))
  t.between(heaviest, 120000, 260000, `the heaviest round is the pre-climax fortified wall (${heaviest} RBE)`)

  t.section('the BTD6 milestone rounds are pinned to their solo-blimp weights')
  // BTD6 does not climb monotonically — the famous post-GOLIATH dip is part of
  // the game's texture (a 616-RBE MOAB right after a 1620-RBE round 39). What
  // gets pinned instead is the shape of the milestone rounds themselves.
  t.between(rbe[40], 500, 800, `round 40 is one GOLIATH alone (${rbe[40]})`)
  t.between(rbe[60], 2500, 4000, `round 60 is one LEVIATHAN alone (${rbe[60]})`)
  t.between(rbe[80], 12000, 22000, `round 80 is one COLOSSUS alone (${rbe[80]})`)
  t.between(rbe[90], 2500, 5000, `round 90 is a lead wall escorting the first WRAITHs (${rbe[90]})`)
  t.gt(rbe[100], 40 * rbe[40], `round 100 outweighs round 40 forty-fold (${rbe[100]})`)

  t.section('each blimp era out-scales the one before')
  t.gt(rbe[60] / rbe[40], 4, 'the LEVIATHAN era is four-plus times the GOLIATH era')
  t.gt(rbe[80] / rbe[60], 4, 'and the COLOSSUS era out-scales the LEVIATHAN era again')
  t.gt(rbe[100] / rbe[80], 3, 'and the OMEN era out-scales the COLOSSUS era')
  t.lt(rbe[20] / rbe[100], 0.01, 'round 20 is under 1% of round 100 — the early game is genuinely gentle')

  t.section('cliffs are blimp-era, and bounded')
  let worst = 1, worstAt = 0
  for (let n = 2; n <= 100; n++) {
    const ratio = rbe[n] / rbe[n - 1]
    if (ratio > worst) { worst = ratio; worstAt = n }
  }
  t.lt(worst, 25, `the biggest single-round jump is ${worst.toFixed(2)}x, at round ${worstAt}`)
  t.gte(worstAt, 40, 'and it is a blimp-era wall, not an ambush in the early game')
  t.gt(worst, 5, 'the table still has real cliffs — the BTD6 texture, not a smooth ramp')

  /* ---------- OP.roundSetRBE ---------- */

  t.section('OP.roundSetRBE reports the whole set')
  const summary = OP.roundSetRBE(SET)
  t.ok(summary && typeof summary === 'object', 'it returns an object')
  t.eq(typeof summary.total, 'number', 'with a numeric total')
  t.eq(Object.keys(summary.byRound).length, 100, 'and one entry per round')
  let sum = 0
  for (const n of nums) sum += summary.byRound[n]
  t.eq(summary.total, sum, 'the total is exactly the sum of byRound')
  let mismatch = null
  for (const n of nums) if (summary.byRound[n] !== rbe[n] && mismatch === null) mismatch = n
  t.ok(mismatch === null, mismatch === null
    ? 'every byRound entry equals Rounds.roundRBE of that round'
    : `byRound[${mismatch}] disagrees with Rounds.roundRBE`)
  t.eq(OP.roundSetRBE().total, summary.total, 'called with no argument it defaults to the standard set')
  // Freshness, tested by trying to poison it: if the function ever memoised and
  // handed back a shared table, a caller scribbling on the result would corrupt
  // every later call. Comparing object identity would not catch that.
  summary.byRound[1] = -1
  summary.total = -1
  const again = OP.roundSetRBE(SET)
  t.eq(again.byRound[1], rbe[1], 'a caller mutating the result cannot corrupt the next call')
  t.eq(again.total, sum, 'and the total is recomputed rather than shared')

  const tiny = { 1: { groups: [{ tier: 'red', count: 4 }] }, 2: { groups: [{ tier: 'ceramic', count: 3 }, { tier: 'blue', count: 1 }] } }
  const tinySum = OP.roundSetRBE(tiny)
  t.eq(tinySum.byRound[1], 4, 'on a hand-built set: four reds are 4 RBE')
  t.eq(tinySum.byRound[2], 3 * OP.balloonRBE('ceramic') + 2, 'three ceramics and a blue are computed from the tree')
  t.eq(tinySum.total, 4 + 3 * OP.balloonRBE('ceramic') + 2, 'and the total adds up')

  /* ---------- first appearances ---------- */

  t.section('every tier first appears when it is meant to')
  const firstAt = {}
  for (const n of nums) {
    for (const g of groupsOf(n)) if (firstAt[g.tier] === undefined) firstAt[g.tier] = n
  }
  // BTD6's exact debut rounds. The mirror is faithful, so every tier lands on
  // its source round precisely — a drift of even one round is a bug now, not
  // pacing.
  const INTENDED = {
    red: 1, blue: 3, green: 6, yellow: 11, pink: 15, black: 20, white: 22,
    purple: 25, zebra: 26, lead: 28, rainbow: 35, ceramic: 38,
    goliath: 40, leviathan: 60, colossus: 80, wraith: 90, omen: 100
  }
  for (const key of Object.keys(INTENDED)) {
    t.eq(firstAt[key], INTENDED[key],
      `${key} first appears exactly at round ${INTENDED[key]} (got ${firstAt[key]})`)
  }
  t.eq(Object.keys(firstAt).length, OP.BALLOON_TIERS.length,
    'every tier in the roster is used somewhere in the table')
  t.eq(Object.keys(INTENDED).length, OP.BALLOON_TIERS.length,
    'and the intended-round list covers the whole roster, so no tier escapes the check')

  t.section('the blimp ladder arrives in BTD6 order')
  const blimps = ['goliath', 'leviathan', 'colossus', 'wraith', 'omen']
  for (let i = 1; i < blimps.length; i++) {
    t.gt(firstAt[blimps[i]], firstAt[blimps[i - 1]],
      `${blimps[i]} debuts after ${blimps[i - 1]}`)
  }
  // RBE order differs from debut order at exactly one step: the WRAITH is a
  // fast special-delivery blimp whose hull is far lighter than the COLOSSUS
  // class it shares the late game with, yet it debuts after one.
  const ladder = ['goliath', 'wraith', 'leviathan', 'colossus', 'omen']
  for (let i = 1; i < ladder.length; i++) {
    t.gt(OP.balloonRBE(ladder[i]), OP.balloonRBE(ladder[i - 1]),
      `${ladder[i]} is worth more RBE than ${ladder[i - 1]}`)
  }

  /* ---------- properties ---------- */

  t.section('properties start where the player can answer them')
  const propFirst = {}
  const propRounds = { VEILED: [], REGEN: [], PLATED: [], FORTIFIED: [] }
  for (const n of nums) {
    for (const g of groupsOf(n)) {
      for (const key of ['VEILED', 'REGEN', 'PLATED', 'FORTIFIED']) {
        if (g.props & P[key]) {
          if (propFirst[key] === undefined) propFirst[key] = n
          if (propRounds[key][propRounds[key].length - 1] !== n) propRounds[key].push(n)
        }
      }
    }
  }
  t.eq(propFirst.VEILED, 24, `VEILED debuts at round ${propFirst.VEILED} — the BTD6 camo round`)
  t.eq(propFirst.REGEN, 17, `REGEN debuts at round ${propFirst.REGEN} — the BTD6 regrow round`)
  t.eq(propFirst.PLATED, 45, `PLATED debuts at round ${propFirst.PLATED} — the BTD6 fortified round`)
  t.eq(propFirst.FORTIFIED, undefined,
    'FORTIFIED (plated-but-slower, an Overpop variant) stays out of the standard table — BTD6 fortified only doubles HP')
  let earlyProp = null
  for (const n of nums) {
    if (n >= Math.min(propFirst.VEILED, propFirst.REGEN)) break
    for (const g of groupsOf(n)) if (g.props && earlyProp === null) earlyProp = n
  }
  t.ok(earlyProp === null, 'no round carries a property before the first property round')
  t.gte(propRounds.VEILED.length, 10, `VEILED recurs (${propRounds.VEILED.length} rounds), so detection stays required`)
  t.gte(propRounds.REGEN.length, 5, `REGEN recurs (${propRounds.REGEN.length} rounds)`)
  t.between(propRounds.PLATED.length, 4, 40, `PLATED recurs through the fortified era (${propRounds.PLATED.length} rounds)`)
  t.ok(propRounds.VEILED.some(n => n > 60), 'VEILED is still in play in the late game')
  t.ok(propRounds.PLATED.every(n => n >= 45), 'and no PLATED balloon arrives before round 45')

  /* ---------- personality rounds ---------- */

  t.section('early rounds are single-tier teaching floods')
  const greens = nums.filter(n => n <= 15 &&
    groupsOf(n).length === 1 && groupsOf(n)[0].tier === 'green' && countOf(n) >= 25)
  t.gte(greens.length, 1, `a greens-only teaching round exists in the first fifteen: round ${greens.join(',') || 'none'}`)
  const blueFlood = nums.filter(n => n < 15 &&
    countOf(n) >= 100 && groupsOf(n).every(g => g.tier === 'blue'))
  t.gte(blueFlood.length, 1, `and a hundred-strong blue flood lands before round 15: round ${blueFlood.join(',') || 'none'}`)

  t.section('a grouped ceramic wall')
  const walls = nums.filter(n => groupsOf(n).some(g => g.tier === 'ceramic' && g.count >= 40))
  t.gte(walls.length, 1, `a wall of 40+ ceramics pours through in one round: round ${walls.join(',') || 'none'}`)
  t.ok(walls.every(n => n > firstAt.ceramic), 'and it is not the round ceramics are introduced')

  t.section('a round that is one blimp, alone')
  const solo = nums.filter(n => countOf(n) === 1 && OP.BALLOON_INDEX[groupsOf(n)[0].tier] !== undefined &&
    OP.tierByKey(groupsOf(n)[0].tier).blimp)
  t.gte(solo.length, 1, `exactly one balloon, and it is a blimp: round ${solo.join(',') || 'none'}`)
  t.ok(solo.includes(firstAt.goliath), 'the first GOLIATH is the one that arrives alone')
  const soloRound = pick(solo, 'lone-blimp')
  if (soloRound) t.gte(R.roundDuration(SET[soloRound]), 3, 'and it still takes long enough to see coming')

  t.section('a camo-heavy round')
  const camoShare = n => {
    const gs = groupsOf(n)
    const total = gs.reduce((s, g) => s + g.count, 0)
    const veiled = gs.reduce((s, g) => s + ((g.props & P.VEILED) ? g.count : 0), 0)
    return total ? veiled / total : 0
  }
  const camo = nums.filter(n => camoShare(n) >= 0.7)
  t.gte(camo.length, 1, `at least one round is 70%+ veiled: ${camo.join(',') || 'none'}`)
  t.ok(camo.every(n => n >= propFirst.VEILED), 'and no camo-heavy round precedes the VEILED introduction')

  t.section('the WRAITH round is a real spike')
  const wr = firstAt.wraith
  t.ok(groupsOf(wr).some(g => g.tier === 'wraith'), `round ${wr} contains a WRAITH`)
  t.ok((OP.tierByKey('wraith').props & P.VEILED) !== 0, 'which is born veiled, so that round needs detection')
  t.gt(rbe[wr + 1] / rbe[wr], 5, 'and the fortified wall right after it is the real spike — the WRAITH round itself is a teaser')

  t.section('round 100 is a climax')
  const last = groupsOf(100)
  t.ok(last.some(g => g.tier === 'omen'), 'round 100 sends OMENs')
  t.eq(last.filter(g => g.tier === 'omen')[0].count, 1, 'exactly one of them, alone — the BTD6 BAD finale')
  t.eq(Math.max(...nums.map(n => rbe[n])), rbe[98], 'and the heaviest round of the table is the fortified blimp wall at 98')

  /* ---------- durations ---------- */

  t.section('every round takes a sane amount of time to release')
  scan('roundDuration is between 3 and 90 seconds', n => {
    const d = R.roundDuration(SET[n])
    if (!(d >= 3)) return 'duration ' + d.toFixed(2) + 's is too short to react to'
    if (!(d <= 90)) return 'duration ' + d.toFixed(2) + 's drags'
    return null
  })
  const durations = nums.map(n => R.roundDuration(SET[n]))
  t.gt(Math.max(...durations), 20, 'the longest rounds are genuinely long')
  t.lt(Math.min(...durations), 8, 'and the shortest are short and sharp')

  /* ---------- the runner actually finishes them ---------- */

  t.section('a sample of rounds releases exactly what it authors, and terminates')
  // Every 7th round, plus round 1 and every blimp debut. No towers, an absurd
  // number of lives so a leak cannot end the game before the round finishes
  // releasing, and lastRound raised so completing round 60/80/100 does not win
  // the game out from under the runner.
  const sample = []
  for (let n = 7; n <= 100; n += 7) sample.push(n)
  for (const n of [1, 40, 60, 80, 90, 100]) if (!sample.includes(n)) sample.push(n)
  sample.sort((a, b) => a - b)

  function releaseRound (n) {
    const sim = makeSim(OP, {
      trackLength: 4000,
      lives: 5000000,
      cash: 0,
      rules: { lastRound: 100 }
    })
    R.begin(sim, n)
    const budget = Math.ceil(R.roundDuration(SET[n]) / OP.DT) + 120
    let ran = 0
    while (ran < budget && !R.allReleased(sim) && !sim.over) { ticks(OP, sim, 1); ran++ }
    return { sim: sim, ran: ran, budget: budget }
  }

  const runs = {}
  for (const n of sample) runs[n] = releaseRound(n)

  function sampleScan (msg, fn) {
    let bad = null
    for (let i = 0; i < sample.length && bad === null; i++) {
      const detail = fn(sample[i], runs[sample[i]])
      if (detail) bad = 'round ' + sample[i] + ': ' + detail
    }
    return t.ok(bad === null, bad === null ? msg : msg + ' — ' + bad)
  }

  t.gte(sample.length, 20, `the sample covers ${sample.length} rounds: ${sample.join(',')}`)
  t.ok([1, 40, 60, 80, 90, 100].every(n => sample.includes(n)),
    'and includes round 1 and every blimp debut')
  sampleScan('the round set resolved without falling through to the missing-round path', (n, r) =>
    r.sim.events.some(e => e.kind === 'error') ? 'an error event was emitted' : null)
  sampleScan('every sampled round reports everything released', (n, r) =>
    R.allReleased(r.sim) ? null : 'still had balloons queued after ' + r.ran + ' ticks')
  sampleScan('and releases exactly the authored balloon count', (n, r) =>
    r.sim.stats.spawned === countOf(n) ? null : `spawned ${r.sim.stats.spawned}, authored ${countOf(n)}`)
  sampleScan('inside a tick budget derived from its own duration', (n, r) =>
    r.ran < r.budget ? null : `used the whole ${r.budget}-tick budget`)
  sampleScan('without the run ending mid-release', (n, r) =>
    r.sim.over ? 'the game ended during release' : null)
  sampleScan('and every released balloon is on a real path', (n, r) => {
    for (const b of r.sim.balloons) {
      if (b.path < 0 || b.path >= r.sim.map.paths.length) return 'balloon on path ' + b.path
    }
    return null
  })
  sampleScan('with the round RBE the HUD shows matching the table', (n, r) =>
    r.sim.round.rbe === rbe[n] ? null : `runner said ${r.sim.round.rbe}, table says ${rbe[n]}`)

  t.section('the marquee rounds behave exactly as authored')
  t.eq(runs[1].sim.stats.spawned, countOf(1), 'round 1 releases its handful of reds')
  t.ok(runs[1].sim.balloons.every(b => OP.BALLOON_TIERS[b.tier].key === 'red'), 'all of them red')

  if (soloRound) {
    const soloRun = releaseRound(soloRound)
    t.eq(soloRun.sim.stats.spawned, 1, 'the lone-blimp round releases exactly one balloon')
    t.ok(OP.BALLOON_TIERS[soloRun.sim.balloons[0].tier].blimp, 'and it is a blimp')
    t.gt(soloRun.ran, 60, 'after a delay of more than a second, so it is not sprung on the player')
  }

  const wallRound = pick(walls, 'ceramic-wall')
  if (wallRound) {
    const wallRun = releaseRound(wallRound)
    const wallGroup = groupsOf(wallRound).filter(g => g.tier === 'ceramic')
      .reduce((a, g) => (g.count > a.count ? g : a))
    let peak = 0
    for (const b of wallRun.sim.balloons) if (OP.BALLOON_TIERS[b.tier].key === 'ceramic') peak++
    t.gte(peak, Math.min(wallGroup.count, 12), 'the ceramic wall sits thick on the board, not a trickle')
  }

  const camoRound = pick(camo, 'camo-heavy')
  if (camoRound) {
    const camoRun = releaseRound(camoRound)
    const veiledLive = camoRun.sim.balloons.filter(b => b.props & P.VEILED).length
    t.gte(veiledLive / camoRun.sim.balloons.length, 0.7, 'the camo round really does arrive mostly veiled')
  }

  const lastRun = releaseRound(100)
  t.eq(lastRun.sim.stats.spawned, countOf(100), 'round 100 releases every one of its balloons')
  t.ok(lastRun.sim.balloons.some(b => OP.BALLOON_TIERS[b.tier].key === 'omen'), 'including the OMENs')
  t.lt(lastRun.sim.balloons.length, OP.MAX_BALLOONS, 'and it never comes close to the entity ceiling on release alone')

  t.section('release timing is data, not randomness')
  function trace (n, seed) {
    const sim = makeSim(OP, { trackLength: 4000, lives: 5000000, cash: 0, seed: seed, rules: { lastRound: 100 } })
    R.begin(sim, n)
    const out = []
    const budget = Math.ceil(R.roundDuration(SET[n]) / OP.DT) + 120
    for (let i = 0; i < budget; i++) {
      const before = sim.stats.spawned
      ticks(OP, sim, 1)
      if (sim.stats.spawned !== before) out.push(i + ':' + (sim.stats.spawned - before))
    }
    return out.join(' ')
  }
  const traceA = trace(52, 'seed-a')
  const traceB = trace(52, 'seed-b')
  t.eq(traceA, traceB, 'two seeds release round 52 on identical ticks')
  t.ok(traceA.length > 0, 'and something was actually released')

  t.section('authored properties reach the balloons')
  if (propFirst.VEILED) {
    const veilRun = releaseRound(propFirst.VEILED)
    t.ok(veilRun.sim.balloons.some(b => b.props & P.VEILED), 'the VEILED introduction spawns veiled balloons')
    t.ok(veilRun.sim.balloons.some(b => !(b.props & P.VEILED)), 'alongside ordinary ones, so detection is a choice not a wall')
  }
  if (propFirst.REGEN) {
    const regenRun = releaseRound(propFirst.REGEN)
    t.ok(regenRun.sim.balloons.some(b => b.props & P.REGEN), 'the REGEN introduction spawns regrowing balloons')
  }
  if (propFirst.PLATED) {
    const platedRun = releaseRound(propFirst.PLATED)
    const plated = platedRun.sim.balloons.filter(b => b.props & P.PLATED)
    t.gt(plated.length, 0, 'the PLATED introduction spawns plated balloons')
    if (plated.length) {
      t.eq(plated[0].hp, OP.BALLOON_TIERS[plated[0].tier].hp * 2,
        'and a plated layer really does carry double HP')
    }
  }
}

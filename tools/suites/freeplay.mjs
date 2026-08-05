export const name = 'freeplay'
export const needs = ['js/core/freeplay.js', 'js/core/rounds.js', 'js/core/sim.js']

import { makeSim, ticks, straightTrack } from './_fixture.mjs'

/* Freeplay, from the engine's side rather than the content's side.

   tools/suites/roundset-alternate.mjs checks that generated rounds are valid and
   deterministic. This suite checks the things that only show up once a generated
   round is actually being simulated:

     - a generated round is plain, freshly-allocated data. If generate() handed
       back a cached object, OP.Rounds.begin would mutate the cache and the same
       round would come out different the second time it was played.
     - generating must not touch the sim at all — not the RNG, not the round, not
       the checksum.
     - a mid-freeplay save must resume bit-identically, which is the entire
       reason the generator is index-derived in the first place.
     - rounds must keep chaining forever without an error event or an entity
       explosion. */

export function run (t, OP) {
  const F = OP.Freeplay
  const R = OP.Rounds
  const S = OP.Sim

  /* ------------------------------------------------------------- the HUD curve */

  t.section('scaleFor is a plain, safe value object')
  const sc = F.scaleFor(150)
  t.eq(typeof sc, 'object', 'it returns an object')
  t.eq(Object.keys(sc).sort().join(','), 'hpScale,speedScale', 'with exactly the two documented fields')
  t.ok(isFinite(sc.hpScale) && isFinite(sc.speedScale), 'both are finite numbers')
  t.neq(F.scaleFor(150), sc, 'each call returns a fresh object, not a shared one')
  sc.hpScale = 999
  t.neq(F.scaleFor(150).hpScale, 999, 'so a caller cannot poison the curve by writing to the result')

  t.section('indices at or below the authored table clamp to the first freeplay round')
  t.deep(F.scaleFor(1), F.scaleFor(101), 'round 1 clamps')
  t.deep(F.scaleFor(100), F.scaleFor(101), 'round 100 clamps')
  t.deep(F.scaleFor(0), F.scaleFor(101), 'round 0 clamps')
  t.deep(F.scaleFor(-50), F.scaleFor(101), 'a negative index clamps rather than inverting the curve')
  t.gt(F.scaleFor(101).hpScale, 1, 'and the clamped value is still a scale-up, never a scale-down')
  t.gt(F.scaleFor(101).speedScale, 1, 'for speed as well')

  t.section('the curve is smooth over a long horizon')
  let hpBreaks = 0
  let speedBreaks = 0
  let jumpiest = 0
  let prev = F.scaleFor(101)
  for (let n = 102; n <= 800; n++) {
    const cur = F.scaleFor(n)
    if (!(cur.hpScale > prev.hpScale)) hpBreaks++
    if (!(cur.speedScale > prev.speedScale)) speedBreaks++
    const jump = cur.hpScale / prev.hpScale
    if (jump > jumpiest) jumpiest = jump
    prev = cur
  }
  t.eq(hpBreaks, 0, 'hpScale never flattens or dips between rounds 101 and 800')
  t.eq(speedBreaks, 0, 'nor does speedScale')
  t.lt(jumpiest, 1.05, `and no single round jumps HP by more than 5% (worst ${((jumpiest - 1) * 100).toFixed(2)}%)`)
  t.lt(F.scaleFor(800).speedScale, 2, 'speed stays under 2x even at round 800 — bounded by construction')
  t.gt(F.scaleFor(800).hpScale, F.scaleFor(500).hpScale, 'while HP keeps climbing without a ceiling')

  /* ------------------------------------------------------ plain, fresh, no cache */

  t.section('a generated round is freshly allocated plain data')
  const sim = makeSim(OP, { trackLength: 2400 })
  const a = F.generate(sim, 210)
  const b = F.generate(sim, 210)
  t.neq(a, b, 'two calls return two objects')
  t.neq(a.groups, b.groups, 'with two group arrays')
  t.neq(a.groups[0], b.groups[0], 'and two group objects')
  t.deep(a, b, 'that are nevertheless value-identical')

  a.groups[0].count = 1
  a.groups.length = 1
  t.gt(F.generate(sim, 210).groups.length, 1,
    'mutating a returned round does not corrupt the next one — nothing is cached')

  t.section('every field is serialisable — no closures, no references')
  const fields = new Set()
  let unserialisable = 0
  for (const g of F.generate(sim, 210).groups) {
    for (const k in g) {
      fields.add(k)
      const v = g[k]
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') unserialisable++
    }
  }
  t.eq(unserialisable, 0, 'every group field is a string, number or boolean')
  t.ok(['tier', 'count', 'spacing', 'delay', 'path', 'props', 'hpScale', 'speedScale']
    .every(k => fields.has(k)), 'and the full group shape is populated: ' + [...fields].join(','))
  const round = F.generate(sim, 210)
  t.deep(JSON.parse(JSON.stringify(round)), round, 'the whole definition round-trips through JSON unchanged')

  t.section('generating touches nothing on the sim')
  const before = { checksum: S.checksum(sim), calls: sim.rng.calls, tick: sim.tick, round: sim.round, index: sim.roundIndex }
  F.generate(sim, 210)
  F.generate(sim, 999)
  t.eq(S.checksum(sim), before.checksum, 'the checksum is unchanged')
  t.eq(sim.rng.calls, before.calls, 'no randomness was consumed')
  t.eq(sim.tick, before.tick, 'the clock did not move')
  t.eq(sim.round, before.round, 'no round was armed as a side effect')
  t.eq(sim.roundIndex, before.index, 'and the round index is untouched')

  /* ----------------------------------------------------------------- the mix */

  t.section('every blimp tier is represented, and density climbs')
  const tiersAt = n => new Set(F.generate(sim, n).groups.map(g => g.tier))
  for (const tier of ['goliath', 'wraith', 'leviathan', 'colossus', 'omen']) {
    t.ok(tiersAt(101).has(tier), `${OP.tierByKey(tier).name} appears in the first freeplay round`)
  }
  t.ok(tiersAt(700).has('omen'), 'and the hardest blimp is still there at round 700')
  const countOf = (n, tier) => {
    const g = F.generate(sim, n).groups.find(x => x.tier === tier)
    return g ? g.count : 0
  }
  t.gt(countOf(200, 'goliath'), countOf(101, 'goliath'), 'GOLIATH count grows')
  t.gt(countOf(200, 'colossus'), countOf(101, 'colossus'), 'COLOSSUS count grows')
  t.gt(countOf(300, 'omen'), countOf(101, 'omen'), 'OMEN count grows')
  t.gte(countOf(102, 'omen'), countOf(101, 'omen'), 'and never shrinks between adjacent rounds')

  t.section('the entity ceiling is respected however far freeplay runs')
  let biggest = 0
  let biggestAt = 0
  let smallest = Infinity
  for (let n = 101; n <= 900; n++) {
    let total = 0
    for (const g of F.generate(sim, n).groups) total += g.count
    if (total > biggest) { biggest = total; biggestAt = n }
    if (total < smallest) smallest = total
  }
  t.gt(smallest, 0, 'no round in 101..900 is empty')
  t.lt(biggest, OP.MAX_BALLOONS, `the largest release is ${biggest} balloons at round ${biggestAt}, under the ${OP.MAX_BALLOONS} ceiling`)
  t.lt(biggest, OP.MAX_BALLOONS / 2, 'with headroom left for the children a blimp becomes on the way down')

  t.section('the seam with the authored table')
  const rbeAt = n => R.roundRBE(F.generate(sim, n))
  t.gt(rbeAt(102), rbeAt(101), 'round 102 is heavier than 101')
  t.gt(rbeAt(103), rbeAt(102), 'and 103 than 102')
  for (const set of [OP.ROUNDS_STANDARD, OP.ROUNDS_ALTERNATE]) {
    if (set && set[100]) {
      t.gt(rbeAt(101), R.roundRBE(set[100]),
        `round 101 (${rbeAt(101)}) outweighs the last authored round (${R.roundRBE(set[100])})`)
    } else {
      t.ok(true, 'an authored set is not loaded — skipping that seam check')
    }
  }

  /* ------------------------------------------------------- it runs, and chains */

  t.section('freeplay chains round after round without erroring')
  const chain = makeSim(OP, {
    trackLength: 200, lives: 900000000, cash: 0, autostart: true,
    roundSet: { 1: { groups: [{ tier: 'red', count: 3, spacing: 0.2 }] } },
    roundSetKey: 'fp-chain-suite',
    rules: { lastRound: 1 }
  })
  chain.freeplay = true
  S.startRound(chain, 1)
  ticks(OP, chain, 60 * 220)
  t.notOk(chain.over, 'the run is still alive')
  t.gte(chain.roundIndex, 3, `autostart chained into generated rounds (reached round ${chain.roundIndex})`)
  t.gte(chain.stats.roundsCleared, 2, `and cleared ${chain.stats.roundsCleared} of them`)
  t.eq(chain.events.filter(e => e.kind === 'error').length, 0, 'with no error events at all')
  t.gt(chain.cash, 0, 'round bonuses were paid for the generated rounds')
  t.gt(chain.stats.leaked, 100000, 'and the undefended board leaked a freeplay-sized amount of RBE')
  t.lte(chain.balloons.length, OP.MAX_BALLOONS, 'the balloon list never exceeded the ceiling')

  t.section('generated balloons carry the generated scaling')
  const scaled = makeSim(OP, {
    trackLength: 3000, lives: 900000000,
    roundSet: { 1: { groups: [{ tier: 'red', count: 1 }] } },
    roundSetKey: 'fp-scale-suite'
  })
  scaled.freeplay = true
  R.begin(scaled, 400)
  ticks(OP, scaled, 1)
  const s400 = F.scaleFor(400)
  const first = scaled.balloons[0]
  t.ok(first, 'the round released something on tick one')
  t.close(first.hpScale, s400.hpScale, 1e-6, 'the spawned balloon carries the round-400 hpScale')
  t.close(first.speedScale, s400.speedScale, 1e-6, 'and its speedScale')
  const tierHp = OP.tierByKey(OP.BALLOON_TIERS[first.tier].key).hp
  t.eq(first.hp, Math.max(1, Math.round(tierHp * s400.hpScale)), 'and its HP is the scaled layer HP')
  t.gt(first.hp, tierHp, 'which is strictly more than the unscaled tier')

  /* ------------------------------------------- mid-freeplay save must be exact */

  t.section('a mid-freeplay save resumes bit-identically')
  // The point of an index-derived generator. A tower that consumes randomness is
  // deliberately on the board: without one, the RNG would never advance and the
  // test would pass even for a generator that rolled its rounds.
  if (!OP.TOWERS['fp-pinner']) {
    OP.Towers.define({
      key: 'fp-pinner',
      name: 'Freeplay Pinner',
      family: 'primary',
      cost: 200,
      footprint: 12,
      base: { range: 240, cooldown: 0.4, damage: 2, pierce: 2, dmgType: OP.DMG.SHARP, projSpeed: 600 },
      paths: [0, 1, 2].map(i => ({
        name: 'P' + i,
        tiers: [1, 2, 3, 4, 5].map(k => ({
          name: 'P' + i + 'T' + k, cost: k * 120, desc: 'x', apply: s => { s.damage += 1 }
        }))
      })),
      fire: function (s, tower, target) {
        const st = tower.s
        const aim = OP.M.angleTo(tower.x, tower.y, target.x, target.y)
        OP.Projectiles.fireAt(s, {
          x: tower.x, y: tower.y, kind: 'fp-shard',
          damage: st.damage, dmgType: st.dmgType, pierce: st.pierce,
          radius: 4, life: 1.4, ownerId: tower.id, camoDetect: st.camoDetect
        }, aim + s.rng.range(-0.2, 0.2), st.projSpeed * s.rng.range(0.9, 1.1))
      }
    })
  }

  const FP_SET = { 1: { groups: [{ tier: 'red', count: 3, spacing: 0.3 }] } }
  OP.ROUND_SETS['fp-save-suite'] = FP_SET
  const snakeMap = () => ({
    key: 'fp-snake',
    paths: [new OP.Track([
      { x: 40, y: 140 }, { x: 1240, y: 140 }, { x: 1240, y: 340 },
      { x: 40, y: 340 }, { x: 40, y: 560 }, { x: 1240, y: 560 }
    ], { smooth: 3 })],
    placement: null,
    blockers: null
  })
  const newRun = () => {
    const s = S.create({
      map: snakeMap(), seed: 'fp-det', roundSetKey: 'fp-save-suite',
      rules: { startCash: 40000, startLives: 900000000, lastRound: 1 }
    })
    s.freeplay = true
    // One of these has to cover the ENTRY, or a round-140 wave spends the whole
    // run walking toward towers that never get a shot off. The earlier version
    // placed all three mid-track and measured an idle board: 50 RNG draws across
    // three towers over seven seconds.
    OP.Towers.place(s, 'fp-pinner', 150, 250)
    OP.Towers.place(s, 'fp-pinner', 600, 240)
    OP.Towers.place(s, 'fp-pinner', 1100, 240)
    S.startRound(s, 140)
    return s
  }

  const control = newRun()
  const forked = newRun()
  t.eq(control.round.index, 140, 'both runs are inside generated round 140')
  t.gt(control.round.rbe, 0, 'which has real weight')
  // 30 seconds: long enough for the wave to reach the board and for the towers to
  // grind through a scaled ceramic's shell, which is what makes the RNG-consumption
  // and pop assertions below mean anything.
  S.run(control, 1800)
  S.run(forked, 1800)
  t.eq(S.checksum(control), S.checksum(forked), 'the two runs are in step before the save')
  t.gt(control.rng.calls, 100, `and randomness was genuinely consumed (${control.rng.calls} draws)`)
  t.gt(control.stats.layersPopped, 0, 'with balloons actually being popped')

  const snap = JSON.parse(JSON.stringify(S.serialize(forked)))
  t.eq(snap.freeplay, true, 'the save records that this is a freeplay run')
  t.eq(snap.round.index, 140, 'and which generated round was in flight')
  const resumed = S.deserialize(snap, snakeMap())
  t.eq(S.checksum(resumed), S.checksum(control), 'the reloaded run matches immediately')

  let diverged = -1
  for (let i = 0; i < 900; i++) {
    S.step(control)
    S.step(resumed)
    if (S.checksum(control) !== S.checksum(resumed)) { diverged = i; break }
  }
  t.eq(diverged, -1, diverged < 0
    ? '900 further ticks with no divergence — the generated round is not in the save, and does not need to be'
    : `diverged ${diverged} ticks after loading`)
  t.eq(control.stats.popped, resumed.stats.popped, 'identical pop totals')
  t.eq(control.rng.calls, resumed.rng.calls, 'and identical RNG consumption')

  t.section('and the round it advances to next is the same on both sides')
  R.next(control)
  R.next(resumed)
  t.eq(control.roundIndex, resumed.roundIndex, 'both advanced to the same index')
  t.deep(R.serialize(resumed), R.serialize(control),
    'and armed an identical round — the save cannot change what freeplay sends next')
}

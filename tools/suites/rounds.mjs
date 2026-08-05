export const name = 'rounds'
export const needs = ['js/core/rounds.js', 'js/core/economy.js', 'js/core/balloons.js']

import { makeSim, ticks, census, straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  const R = OP.Rounds

  // A tiny round set, so this suite tests the runner rather than the round data.
  const SET = {
    1: { groups: [{ tier: 'red', count: 5, spacing: 0.5 }] },
    2: { groups: [{ tier: 'blue', count: 4, spacing: 0.25 }] },
    3: {
      groups: [
        { tier: 'red', count: 3, spacing: 0.2, delay: 0 },
        { tier: 'green', count: 2, spacing: 0.2, delay: 1.0 }
      ]
    },
    4: { groups: [{ tier: 'ceramic', count: 6, spacing: 0 }] },       // a tight clump
    5: { groups: [{ tier: 'goliath', count: 1, spacing: 0, delay: 0.5 }] }
  }

  function simFor (opts) {
    return makeSim(OP, Object.assign({ trackLength: 4000, roundSet: SET }, opts || {}))
  }

  t.section('group normalisation fills in defaults')
  const g = R.normalizeGroup({ tier: 'red' })
  t.eq(g.count, 1, 'count defaults to 1')
  t.gt(g.spacing, 0, 'spacing has a sensible default')
  t.eq(g.delay, 0, 'delay defaults to 0')
  t.eq(g.path, -1, 'path defaults to spread-across-paths')
  t.eq(g.props, 0, 'no properties by default')

  t.section('round RBE and duration are derived from the definition')
  t.eq(R.roundRBE(SET[1]), 5, 'five reds are 5 RBE')
  t.eq(R.roundRBE(SET[2]), 8, 'four blues are 8 RBE')
  t.eq(R.roundRBE(SET[4]), 6 * 104, 'six ceramics are 624 RBE')
  t.eq(R.roundRBE(SET[5]), 616, 'one GOLIATH is 616 RBE')
  t.close(R.roundDuration(SET[1]), 2.0, 1e-9, 'five balloons 0.5s apart span 2s')
  t.eq(R.roundDuration(SET[4]), 0, 'a zero-spacing clump has no duration')
  // Group 2: delay 1.0 + (2-1) gaps of 0.2 = 1.2. Gaps, not balloons.
  t.close(R.roundDuration(SET[3]), 1.2, 1e-9, 'duration is the latest group finish, not the sum')

  t.section('beginning a round arms it without spawning')
  let sim = simFor()
  const r = R.begin(sim, 1)
  t.eq(sim.roundIndex, 1, 'the round index is set')
  t.eq(r.rbe, 5, 'the round knows its RBE for the HUD')
  t.eq(sim.balloons.length, 0, 'nothing has spawned yet')
  t.ok(sim.events.some(e => e.kind === 'roundstart' && e.round === 1), 'a roundstart event fired')

  t.section('releases happen over time at the authored spacing')
  sim = simFor()
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  t.eq(sim.stats.spawned, 1, 'the first balloon is out on the first tick')
  // The first release is on tick 0, so the second is on tick 30 — the 31st call.
  ticks(OP, sim, 30)
  t.eq(sim.stats.spawned, 2, 'a second after half a second')
  ticks(OP, sim, 150)
  t.eq(sim.stats.spawned, 5, 'all five eventually, and no more')
  t.ok(R.allReleased(sim), 'the runner reports everything released')

  t.section('a zero-spacing group dumps its whole count at once')
  sim = simFor()
  R.begin(sim, 4)
  ticks(OP, sim, 1)
  t.eq(sim.stats.spawned, 6, 'all six ceramics arrive on the same tick')
  t.eq(census(OP, sim).ceramic, 6, 'and they are all ceramics')

  t.section('delays are honoured')
  sim = simFor()
  R.begin(sim, 5)
  ticks(OP, sim, 20)
  t.eq(sim.stats.spawned, 0, 'a delayed group has not started at 0.33s')
  ticks(OP, sim, 20)
  t.eq(sim.stats.spawned, 1, 'and releases once the delay elapses')

  t.section('multiple groups run independently')
  sim = simFor()
  R.begin(sim, 3)
  ticks(OP, sim, 40)
  let c = census(OP, sim)
  t.eq(c.red, 3, 'the immediate group finished')
  t.eq(c.green, undefined, 'the delayed group has not started')
  ticks(OP, sim, 45)
  c = census(OP, sim)
  t.eq(c.green, 2, 'and then it does')

  t.section('release timing is tick-quantised and reproducible')
  function releaseTrace (seed) {
    const s = simFor({ seed })
    R.begin(s, 1)
    const trace = []
    for (let i = 0; i < 180; i++) {
      const before = s.stats.spawned
      ticks(OP, s, 1)
      if (s.stats.spawned !== before) trace.push(i)
    }
    return trace.join(',')
  }
  const traceA = releaseTrace('a')
  const traceB = releaseTrace('b')
  t.eq(traceA, traceB, 'release ticks do not depend on the RNG at all')
  t.eq(traceA.split(',').length, 5, 'and there were five distinct release ticks: ' + traceA)

  t.section('balloons spread across paths when the group does not name one')
  sim = makeSim(OP, {
    tracks: [straightTrack(OP, 3000, 200), straightTrack(OP, 3000, 500)],
    roundSet: { 1: { groups: [{ tier: 'red', count: 8, spacing: 0 }] } }
  })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  const byPath = { 0: 0, 1: 0 }
  for (const b of sim.balloons) byPath[b.path]++
  t.eq(byPath[0], 4, 'four went down path 0')
  t.eq(byPath[1], 4, 'and four down path 1')

  t.section('a group can pin itself to one path')
  sim = makeSim(OP, {
    tracks: [straightTrack(OP, 3000, 200), straightTrack(OP, 3000, 500)],
    roundSet: { 1: { groups: [{ tier: 'red', count: 6, spacing: 0, path: 1 }] } }
  })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  t.ok(sim.balloons.every(b => b.path === 1), 'all six took path 1')

  t.section('a path index beyond the map clamps instead of crashing')
  sim = makeSim(OP, {
    tracks: [straightTrack(OP, 3000, 200)],
    roundSet: { 1: { groups: [{ tier: 'red', count: 3, spacing: 0, path: 7 }] } }
  })
  R.begin(sim, 1)
  t.noThrow(() => ticks(OP, sim, 1), 'no crash')
  t.ok(sim.balloons.every(b => b.path === 0), 'they all use the only path there is')

  t.section('properties and scaling flow from the group')
  sim = simFor({ roundSet: { 1: { groups: [{ tier: 'red', count: 2, spacing: 0, props: OP.PROP.REGEN | OP.PROP.VEILED }] } } })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  t.ok(sim.balloons.every(b => (b.props & OP.PROP.REGEN) && (b.props & OP.PROP.VEILED)),
    'authored properties are applied')

  t.section('rules scale HP and speed for every balloon in a round')
  sim = simFor({ rules: { hpScale: 3 }, roundSet: { 1: { groups: [{ tier: 'ceramic', count: 1, spacing: 0 }] } } })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  t.eq(sim.balloons[0].hp, 30, 'hpScale 3 triples ceramic shell')

  t.section('Double HP Blimps applies only to blimps')
  sim = simFor({
    rules: { blimpHpMul: 2 },
    roundSet: { 1: { groups: [{ tier: 'ceramic', count: 1, spacing: 0 }, { tier: 'goliath', count: 1, spacing: 0 }] } }
  })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  const cer = sim.balloons.find(b => OP.BALLOON_TIERS[b.tier].key === 'ceramic')
  const gol = sim.balloons.find(b => OP.BALLOON_TIERS[b.tier].key === 'goliath')
  t.eq(cer.hp, 10, 'the ceramic is untouched')
  t.eq(gol.hp, 400, 'the GOLIATH has doubled hull')

  t.section('completion requires everything released AND the board clear')
  sim = simFor({ trackLength: 200 })
  R.begin(sim, 1)
  ticks(OP, sim, 1)
  t.notOk(R.isComplete(sim), 'not complete while balloons are still to come')
  ticks(OP, sim, 150)
  t.ok(R.allReleased(sim), 'everything released')
  ticks(OP, sim, 300)
  t.eq(sim.balloons.length, 0, 'and the board is clear (they leaked)')
  t.ok(sim.round.done, 'the round auto-completed')

  t.section('completing a round pays the bonus once')
  sim = simFor({ trackLength: 100, cash: 0 })
  R.begin(sim, 1)
  ticks(OP, sim, 400)
  const cashAfter = sim.cash
  t.gt(cashAfter, 0, 'the round bonus was paid')
  t.eq(sim.stats.roundsCleared, 1, 'one round cleared')
  R.complete(sim)
  t.eq(sim.cash, cashAfter, 'calling complete again pays nothing extra')
  t.eq(sim.stats.roundsCleared, 1, 'and does not double-count')

  t.section('clearing the last round wins the game')
  sim = simFor({ trackLength: 100, rules: { lastRound: 1 } })
  R.begin(sim, 1)
  ticks(OP, sim, 400)
  t.ok(sim.over, 'the game ended')
  t.eq(sim.outcome, 'won', 'with a win')

  t.section('freeplay keeps going past the last round')
  sim = simFor({ trackLength: 100, rules: { lastRound: 1 } })
  sim.freeplay = true
  R.begin(sim, 1)
  ticks(OP, sim, 400)
  t.notOk(sim.over, 'freeplay does not end at the last authored round')

  t.section('advancing to the next round')
  sim = simFor({ trackLength: 4000 })
  R.begin(sim, 1)
  ticks(OP, sim, 200)
  R.next(sim)
  t.eq(sim.roundIndex, 2, 'the index advanced')
  ticks(OP, sim, 60)
  t.gt(census(OP, sim).blue || 0, 0, 'and round 2 content is arriving')

  t.section('a finished game will not start another round')
  sim = simFor()
  sim.over = true
  t.eq(R.next(sim), null, 'next() refuses once the game is over')

  t.section('an unauthored round falls through rather than crashing')
  sim = simFor()
  t.noThrow(() => R.begin(sim, 999), 'beginning a round past the table does not throw')
  t.ok(sim.round.groups.length > 0, 'and produces something spawnable')

  t.section('serialisation round-trips mid-round')
  sim = simFor({ trackLength: 4000 })
  R.begin(sim, 3)
  ticks(OP, sim, 45)
  const snap = JSON.parse(JSON.stringify(R.serialize(sim)))
  t.eq(snap.index, 3, 'the round index round-trips')
  t.eq(snap.groups.length, 2, 'both groups round-trip')

  const restored = simFor({ trackLength: 4000 })
  R.deserialize(restored, snap)
  t.eq(restored.roundIndex, 3, 'index restored')
  t.deep(restored.round.groups.map(x => x.remaining), sim.round.groups.map(x => x.remaining),
    'each group resumes with the right number still to come')
  t.eq(restored.round.tick, sim.round.tick, 'and at the same tick, so timing resumes exactly')

  // Continuing from the restored state must produce the same releases.
  const contA = []
  const contB = []
  for (let i = 0; i < 120; i++) { const b = sim.stats.spawned; ticks(OP, sim, 1); if (sim.stats.spawned !== b) contA.push(i) }
  for (let i = 0; i < 120; i++) { const b = restored.stats.spawned; ticks(OP, restored, 1); if (restored.stats.spawned !== b) contB.push(i) }
  t.deep(contB, contA, 'a resumed round releases on exactly the same ticks')

  t.section('serialising with no round in flight')
  sim = simFor()
  t.eq(R.serialize(sim), null, 'nothing to save before a round starts')
  t.noThrow(() => R.deserialize(sim, null), 'and loading that back is fine')
  t.eq(sim.round, null, 'leaving no round armed')
}

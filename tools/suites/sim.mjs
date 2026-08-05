export const name = 'sim'
export const needs = ['js/core/sim.js', 'js/core/towers.js', 'js/core/rounds.js']

import { makeSim, spawn, straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  const S = OP.Sim
  const D = OP.DMG

  const path = n => ({
    name: n,
    tiers: [1, 2, 3, 4, 5].map(i => ({ name: n + i, cost: i * 100, desc: 'x', apply: s => { s.damage += 1 } }))
  })
  if (!OP.TOWERS['sim-gun']) {
    OP.Towers.define({
      key: 'sim-gun', name: 'Sim Gun', family: 'primary', cost: 200, footprint: 12,
      base: { range: 200, cooldown: 0.5, damage: 2, pierce: 3, dmgType: D.SHARP, projSpeed: 700 },
      paths: [path('A'), path('B'), path('C')],
      fire: function (sim, tower, target) {
        const s = tower.s
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'sim-dart', damage: s.damage, dmgType: s.dmgType,
          pierce: s.pierce, radius: 4, life: 2, ownerId: tower.id, camoDetect: s.camoDetect
        }, OP.M.angleTo(tower.x, tower.y, target.x, target.y), s.projSpeed)
      }
    })
  }

  const ROUNDS = {
    1: { groups: [{ tier: 'red', count: 10, spacing: 0.3 }] },
    2: { groups: [{ tier: 'green', count: 12, spacing: 0.25 }] },
    3: { groups: [{ tier: 'ceramic', count: 4, spacing: 0.6 }] }
  }

  function fresh (extra) {
    return makeSim(OP, Object.assign({ trackLength: 2400, roundSet: ROUNDS, cash: 100000 }, extra))
  }

  /* ---------- creation ---------- */

  t.section('creation')
  t.throws(() => S.create({}), 'a sim without a map is refused')
  t.throws(() => S.create({ map: { paths: [] } }), 'a map with no paths is refused')

  let sim = fresh()
  t.eq(sim.tick, 0, 'starts at tick 0')
  t.eq(sim.time, 0, 'and time 0')
  t.eq(sim.speed, 1, 'at normal speed')
  t.notOk(sim.paused, 'not paused')
  t.notOk(sim.over, 'not over')
  t.ok(sim.rng, 'with an RNG')
  t.ok(sim.grid, 'and a spatial grid')
  t.eq(sim.balloons.length, 0, 'no balloons')
  t.eq(sim.towers.length, 0, 'no towers')
  t.eq(sim.roundIndex, sim.rules.firstRound - 1, 'positioned before the first round')

  t.section('rules layer: defaults, then difficulty, then mode, then overrides')
  const layered = S.resolveRules({ rules: { costMul: 3.5, startLives: 7 } })
  t.eq(layered.costMul, 3.5, 'an explicit override wins')
  t.eq(layered.startLives, 7, 'for every field it names')
  t.ok(layered.sellRate !== undefined, 'and untouched fields keep their defaults')

  /* ---------- stepping ---------- */

  t.section('stepping advances the clock by exactly one fixed tick')
  sim = fresh()
  S.step(sim)
  t.eq(sim.tick, 1, 'one tick')
  t.close(sim.time, OP.DT, 1e-12, 'and exactly DT of time')
  S.step(sim)
  t.eq(sim.tick, 2, 'two ticks')
  t.close(sim.time, OP.DT * 2, 1e-12, 'and 2 DT')

  t.section('a finished game stops stepping')
  sim = fresh({ lives: 1 })
  OP.Economy.endGame(sim, 'leaked')
  const frozenTick = sim.tick
  S.step(sim)
  S.step(sim)
  t.eq(sim.tick, frozenTick, 'the clock does not advance once the game is over')

  t.section('effects tick before movement, as documented')
  sim = fresh()
  const chilled = spawn(OP, sim, 'red', 100)
  OP.Effects.apply(chilled, OP.Effects.make('stun', 1, 1, -1, D.NORMAL))
  S.step(sim)
  t.eq(chilled.t, 100, 'a stun applied before the first step means no movement at all on that step')

  t.section('run advances many ticks')
  sim = fresh()
  S.run(sim, 100)
  t.eq(sim.tick, 100, 'a hundred ticks ran')

  /* ---------- the accumulator ---------- */

  t.section('advance runs whole ticks from wall time')
  sim = fresh()
  const ran = S.advance(sim, OP.DT * 3.5)
  t.eq(ran, 3, 'three and a half ticks of wall time runs three ticks')
  t.close(sim.accumulator, OP.DT * 0.5, 1e-9, 'and banks the remainder')
  t.close(S.alpha(sim), 0.5, 1e-6, 'which becomes the render interpolation alpha')

  t.section('advance never runs more than the per-frame ceiling')
  sim = fresh()
  const many = S.advance(sim, 10)
  t.lte(many, OP.MAX_STEPS_PER_FRAME, 'a ten-second hitch runs at most the ceiling')
  // Wall time is clamped to 0.25s before it reaches the accumulator, so a
  // backgrounded tab cannot bank thirty seconds of simulation.
  t.lte(sim.accumulator, 0.25, 'the banked remainder is bounded by the input clamp')
  // It drains over the next couple of frames rather than being thrown away —
  // smoother, and provably convergent because each frame runs 8 and banks less.
  let drainFrames = 0
  while (sim.accumulator >= OP.DT && drainFrames < 10) { S.advance(sim, 0); drainFrames++ }
  t.lt(sim.accumulator, OP.DT, 'and it fully drains')
  t.lte(drainFrames, 3, `within a few frames (took ${drainFrames})`)

  t.section('a hitch at 3x speed discards the part it will never catch up on')
  sim = fresh()
  S.setSpeed(sim, 3)
  S.advance(sim, 10)
  t.eq(sim.accumulator, 0, 'a backlog larger than the per-frame ceiling is dropped, not stuttered through')

  t.section('speed multiplies ticks, never tick size')
  sim = fresh()
  S.setSpeed(sim, 3)
  t.eq(sim.speed, 3, 'speed 3 is set')
  sim.accumulator = 0
  const fast = S.advance(sim, OP.DT)
  t.eq(fast, 3, 'one tick of wall time runs three sim ticks')
  t.close(OP.DT, 1 / 60, 1e-12, 'and DT is untouched')

  t.eq(S.setSpeed(sim, 99), 3, 'speed clamps to 3')
  t.eq(S.setSpeed(sim, 0), 1, 'and to 1')

  t.section('pausing')
  sim = fresh()
  t.ok(S.togglePause(sim), 'toggle pauses')
  t.eq(S.advance(sim, 1), 0, 'and advance does nothing while paused')
  t.eq(sim.tick, 0, 'the clock stands still')
  t.notOk(S.togglePause(sim), 'toggle unpauses')
  t.gt(S.advance(sim, OP.DT * 2), 0, 'and time flows again')

  /* ---------- integration: a real round ---------- */

  t.section('a round with no defence leaks and costs lives')
  sim = fresh({ lives: 200, trackLength: 400 })
  S.startRound(sim, 1)
  const result = S.runRound(sim, 60 * 60)
  t.ok(result.completed, 'the round completed')
  t.eq(result.leaked, 10, 'all ten reds leaked')
  t.eq(sim.lives, 190, 'costing ten lives')

  t.section('a round with adequate defence does not leak')
  sim = fresh({ lives: 200, trackLength: 2400 })
  OP.Towers.place(sim, 'sim-gun', 300, 300)
  OP.Towers.place(sim, 'sim-gun', 800, 420)
  S.startRound(sim, 1)
  const defended = S.runRound(sim, 60 * 120)
  t.ok(defended.completed, 'the round completed')
  t.eq(defended.leaked, 0, 'nothing got through')
  t.eq(sim.lives, 200, 'no lives lost')
  t.gt(sim.stats.popped, 0, 'and things were actually popped')

  t.section('autostart chains rounds')
  sim = fresh({ trackLength: 300, autostart: true })
  S.startRound(sim, 1)
  S.run(sim, 60 * 90)
  t.gte(sim.roundIndex, 2, 'the next round armed itself')
  t.gte(sim.stats.roundsCleared, 1, 'and at least one round was cleared')

  t.section('pressure reports live RBE')
  sim = fresh()
  t.eq(S.pressure(sim), 0, 'an empty board has no pressure')
  spawn(OP, sim, 'ceramic', 100)
  t.eq(S.pressure(sim), 104, 'one ceramic is 104')

  /* ---------- checksum ---------- */

  t.section('the checksum is stable for identical state')
  const a = fresh({ seed: 'chk' })
  const b = fresh({ seed: 'chk' })
  t.eq(S.checksum(a), S.checksum(b), 'two fresh identical sims match')
  S.run(a, 50); S.run(b, 50)
  t.eq(S.checksum(a), S.checksum(b), 'and still match after fifty ticks')

  t.section('the checksum notices every kind of change')
  function variant (mutate) {
    const s = fresh({ seed: 'chk' })
    mutate(s)
    return S.checksum(s)
  }
  const baseline = variant(() => {})
  t.neq(variant(s => { s.cash += 1 }), baseline, 'cash')
  t.neq(variant(s => { s.lives -= 1 }), baseline, 'lives')
  t.neq(variant(s => { s.tick += 1 }), baseline, 'tick')
  t.neq(variant(s => { spawn(OP, s, 'red', 10) }), baseline, 'a new balloon')
  t.neq(variant(s => { spawn(OP, s, 'red', 10.5) }), variant(s => { spawn(OP, s, 'red', 10) }), 'a balloon position')
  t.neq(variant(s => { spawn(OP, s, 'blue', 10) }), variant(s => { spawn(OP, s, 'red', 10) }), 'a balloon tier')
  t.neq(variant(s => { const x = spawn(OP, s, 'ceramic', 10); x.hp = 5 }),
    variant(s => { spawn(OP, s, 'ceramic', 10) }), 'balloon HP')
  t.neq(variant(s => { OP.Towers.place(s, 'sim-gun', 400, 300) }), baseline, 'a new tower')
  t.neq(variant(s => { s.rng.next() }), baseline,
    'RNG consumption — two boards that look alike but consumed different randomness are NOT the same state')

  t.section('the checksum is order-sensitive by design')
  const swapped = fresh({ seed: 'chk' })
  spawn(OP, swapped, 'red', 10)
  spawn(OP, swapped, 'blue', 20)
  const normal = S.checksum(swapped)
  const tmp = swapped.balloons[0]
  swapped.balloons[0] = swapped.balloons[1]
  swapped.balloons[1] = tmp
  t.neq(S.checksum(swapped), normal, 'reordering the entity list changes the checksum, so accidental reordering is caught')

  /* ---------- serialisation ---------- */

  t.section('a sim round-trips through serialise and deserialise')
  sim = fresh({ seed: 'save', trackLength: 2400, lives: 123 })
  const gun = OP.Towers.place(sim, 'sim-gun', 400, 300)
  OP.Upgrades.buy(sim, gun, 0)
  OP.Towers.setTargetMode(sim, gun, 'strong')
  S.startRound(sim, 2)
  S.run(sim, 200)

  const snap = JSON.parse(JSON.stringify(S.serialize(sim)))
  t.eq(snap.version, OP.VERSION, 'the save records the version')
  t.eq(snap.mapKey, 'test', 'and the map key, so the loader knows what to rebuild')
  t.ok(snap.balloons.length > 0, 'mid-round balloons are in the save')

  const map = { key: 'test', paths: [straightTrack(OP, 2400)], placement: null, blockers: null }
  const loaded = S.deserialize(snap, map)
  t.eq(loaded.tick, sim.tick, 'the tick matches')
  t.eq(loaded.cash, sim.cash, 'cash matches')
  t.eq(loaded.lives, sim.lives, 'lives match')
  t.eq(loaded.balloons.length, sim.balloons.length, 'the same balloons are present')
  t.eq(loaded.towers.length, sim.towers.length, 'and the same towers')
  t.eq(loaded.towers[0].tiers.join('-'), gun.tiers.join('-'), 'with their upgrades')
  t.eq(loaded.towers[0].targetMode, 'strong', 'and their target mode')
  t.eq(loaded.nextEntityId, sim.nextEntityId, 'the id counter resumes where it left off')
  t.eq(S.checksum(loaded), S.checksum(sim), 'and the checksums are identical — a true round-trip')

  t.section('deserialise without a map is refused rather than half-working')
  t.throws(() => S.deserialize(snap, null), 'a save cannot be loaded without its map')

  t.section('a save taken with no round in flight loads cleanly')
  sim = fresh()
  const preRound = JSON.parse(JSON.stringify(S.serialize(sim)))
  const preLoaded = S.deserialize(preRound, { key: 'test', paths: [straightTrack(OP, 2400)] })
  t.eq(preLoaded.round, null, 'no round armed')
  t.eq(S.checksum(preLoaded), S.checksum(sim), 'and the checksum still matches')

  t.section('the event queues are capped, so a long headless run cannot grow without bound')
  sim = fresh({ trackLength: 200, autostart: true })
  S.startRound(sim, 1)
  S.run(sim, 60 * 400)
  t.lte(sim.popEvents.length, 4096, 'pop events are capped')
  t.lte(sim.events.length, 4096, 'game events are capped')
  t.lte(sim.leakEvents.length, 4096, 'leak events are capped')
}

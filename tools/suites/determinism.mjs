export const name = 'determinism'
export const needs = ['js/core/sim.js', 'js/core/towers.js', 'js/core/rounds.js']

import { straightTrack } from './_fixture.mjs'

/* Determinism is the load-bearing claim of this whole project. Every statement
   of the form "rounds 1-100 verified on Relentless" is worth nothing unless a
   seed reproduces exactly, so this suite is deliberately harsh:

   1. Same seed twice -> identical checksum, tick by tick.
   2. Save mid-run, reload, continue -> identical to the run that was never
      interrupted. This is the strict test: it catches any state that lives
      outside the save (a scratch buffer, a memo, an unserialised counter).
   3. A different seed -> a different result, so we know the seed is actually
      being used and the test is not passing vacuously. */

export function run (t, OP) {
  const S = OP.Sim
  const D = OP.DMG

  const path = n => ({
    name: n,
    tiers: [1, 2, 3, 4, 5].map(i => ({
      name: n + i, cost: i * 120, desc: 'x',
      apply: s => { s.damage += 1; s.pierce += 1 }
    }))
  })

  // A tower that deliberately consumes randomness, so the RNG is genuinely part
  // of the simulation rather than incidental to it.
  if (!OP.TOWERS['det-scatter']) {
    OP.Towers.define({
      key: 'det-scatter', name: 'Det Scatter', family: 'primary', cost: 200, footprint: 12,
      base: { range: 220, cooldown: 0.35, damage: 2, pierce: 3, dmgType: D.SHARP, projSpeed: 620 },
      paths: [path('A'), path('B'), path('C')],
      fire: function (sim, tower, target) {
        const s = tower.s
        const aim = OP.M.angleTo(tower.x, tower.y, target.x, target.y)
        for (let i = 0; i < 3; i++) {
          OP.Projectiles.fireAt(sim, {
            x: tower.x, y: tower.y, kind: 'det-shard',
            damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
            radius: 4, life: 1.6, ownerId: tower.id, camoDetect: s.camoDetect
          }, aim + sim.rng.range(-0.25, 0.25), s.projSpeed * sim.rng.range(0.9, 1.1))
        }
      }
    })
  }
  if (!OP.TOWERS['det-bomber']) {
    OP.Towers.define({
      key: 'det-bomber', name: 'Det Bomber', family: 'military', cost: 400, footprint: 14,
      base: { range: 260, cooldown: 1.1, damage: 3, pierce: 8, dmgType: D.EXPLOSIVE, projSpeed: 400 },
      paths: [path('A'), path('B'), path('C')],
      fire: function (sim, tower, target) {
        const s = tower.s
        const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'det-bomb',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: 6, life: 2.5, ownerId: tower.id, camoDetect: s.camoDetect,
          blastRadius: 55, blastFalloff: 0.4
        }, OP.M.angleTo(tower.x, tower.y, aim.x, aim.y), s.projSpeed)
      }
    })
  }

  const ROUNDS = {
    1: { groups: [{ tier: 'red', count: 20, spacing: 0.22 }] },
    2: { groups: [{ tier: 'green', count: 24, spacing: 0.2 }] },
    3: {
      groups: [
        { tier: 'black', count: 10, spacing: 0.3 },
        { tier: 'white', count: 10, spacing: 0.3, delay: 1.5 }
      ]
    },
    4: { groups: [{ tier: 'ceramic', count: 12, spacing: 0.35 }, { tier: 'lead', count: 8, spacing: 0.4, delay: 2 }] },
    5: { groups: [{ tier: 'goliath', count: 2, spacing: 3 }, { tier: 'rainbow', count: 16, spacing: 0.25 }] }
  }

  // A serpentine track inside the field, so the grid behaves as it would in play.
  function makeMap () {
    const pts = []
    for (let row = 0; row < 4; row++) {
      const y = 120 + row * 160
      if (row % 2 === 0) pts.push({ x: 40, y }, { x: 1240, y })
      else pts.push({ x: 1240, y }, { x: 40, y })
    }
    return { key: 'det-snake', paths: [new OP.Track(pts, { smooth: 3 })], placement: null, blockers: null }
  }

  const BUILD = [
    ['det-scatter', 200, 60], ['det-scatter', 700, 60],
    ['det-bomber', 400, 220], ['det-scatter', 1000, 220],
    ['det-bomber', 250, 380], ['det-scatter', 850, 380]
  ]

  function build (sim) {
    const towers = []
    for (const [key, x, y] of BUILD) {
      const tower = OP.Towers.place(sim, key, x, y)
      if (tower) towers.push(tower)
    }
    // Upgrade unevenly, so stat resolution and crosspath rules are exercised.
    if (towers[0]) { OP.Upgrades.buy(sim, towers[0], 0); OP.Upgrades.buy(sim, towers[0], 0) }
    if (towers[2]) { OP.Upgrades.buy(sim, towers[2], 1); OP.Upgrades.buy(sim, towers[2], 0) }
    if (towers[4]) { OP.Upgrades.buy(sim, towers[4], 2) }
    return towers
  }

  OP.ROUND_SETS['det-test'] = ROUNDS

  function newSim (seed) {
    const sim = S.create({
      map: makeMap(),
      seed: seed,
      roundSetKey: 'det-test',
      autostart: true,
      rules: { startCash: 60000, startLives: 400, lastRound: 5 }
    })
    build(sim)
    S.startRound(sim, 1)
    return sim
  }

  /* ---------- 1. same seed, same result ---------- */

  t.section('the same seed produces an identical run, tick by tick')
  const a = newSim('alpha')
  const b = newSim('alpha')
  let firstDivergence = -1
  const TICKS = 60 * 60
  for (let i = 0; i < TICKS; i++) {
    S.step(a); S.step(b)
    if (S.checksum(a) !== S.checksum(b)) { firstDivergence = i; break }
  }
  t.eq(firstDivergence, -1, firstDivergence < 0
    ? `3600 ticks with no divergence`
    : `diverged at tick ${firstDivergence}`)
  t.gt(a.stats.popped, 100, `the run was substantial: ${a.stats.popped} pops, ${a.stats.shotsFired} shots`)
  t.gt(a.rng.calls, 1000, `and consumed real randomness: ${a.rng.calls} draws`)

  t.section('and the same final checksum')
  t.eq(S.checksum(a), S.checksum(b), 'identical after 3600 ticks')
  t.eq(a.stats.popped, b.stats.popped, 'identical pop counts')
  t.eq(Math.round(a.cash), Math.round(b.cash), 'identical cash')
  t.eq(a.lives, b.lives, 'identical lives')
  t.eq(a.rng.calls, b.rng.calls, 'and consumed exactly the same amount of randomness')

  /* ---------- 2. a different seed diverges ---------- */

  t.section('a different seed produces a different run — the test is not vacuous')
  const c = newSim('beta')
  S.run(c, TICKS)
  t.neq(S.checksum(c), S.checksum(a), 'a different seed gives a different checksum')

  /* ---------- 3. save, reload, continue ---------- */

  t.section('save mid-run, reload, and continue identically')
  // This is the strict one: any state living outside the save shows up here.
  const control = newSim('gamma')
  const forked = newSim('gamma')

  S.run(control, 900)
  S.run(forked, 900)
  t.eq(S.checksum(control), S.checksum(forked), 'both are in step before the save')

  const snap = JSON.parse(JSON.stringify(S.serialize(forked)))
  const resumed = S.deserialize(snap, makeMap())
  t.eq(S.checksum(resumed), S.checksum(control), 'the reloaded sim matches immediately after loading')

  let divergedAfterLoad = -1
  for (let i = 0; i < 1800; i++) {
    S.step(control); S.step(resumed)
    if (S.checksum(control) !== S.checksum(resumed)) { divergedAfterLoad = i; break }
  }
  t.eq(divergedAfterLoad, -1, divergedAfterLoad < 0
    ? '1800 further ticks with no divergence — nothing important lives outside the save'
    : `diverged ${divergedAfterLoad} ticks after loading`)
  t.eq(control.stats.popped, resumed.stats.popped, 'and the same pop totals')
  t.eq(control.rng.calls, resumed.rng.calls, 'and the same RNG consumption')

  t.section('a save round-trip mid-projectile-flight preserves the hit sets')
  const flight = newSim('delta')
  S.run(flight, 400)
  t.gt(flight.projectiles.length, 0, 'projectiles are in the air at the moment of saving')
  const flightSnap = JSON.parse(JSON.stringify(S.serialize(flight)))
  const flightBack = S.deserialize(flightSnap, makeMap())
  t.eq(S.checksum(flightBack), S.checksum(flight), 'checksum matches with projectiles mid-flight')
  const totalHits = flight.projectiles.reduce((n, p) => n + p.hits.size, 0)
  const backHits = flightBack.projectiles.reduce((n, p) => n + p.hits.size, 0)
  t.eq(backHits, totalHits, 'and every projectile remembers what it has already hit')

  /* ---------- 4. the renderer cannot influence the sim ---------- */

  t.section('draining the FX queues does not change the simulation')
  const drained = newSim('epsilon')
  const untouched = newSim('epsilon')
  for (let i = 0; i < 600; i++) {
    S.step(drained)
    S.step(untouched)
    // Simulate what a renderer does every frame.
    drained.popEvents.length = 0
    drained.leakEvents.length = 0
    drained.blastEvents.length = 0
  }
  t.eq(S.checksum(drained), S.checksum(untouched),
    'the event queues are output only — consuming them cannot feed back into state')

  t.section('Math.random cannot affect the sim')
  // Called between steps: if any sim code reached for the global RNG, the two
  // runs would diverge.
  const withNoise = newSim('zeta')
  const withoutNoise = newSim('zeta')
  for (let i = 0; i < 600; i++) {
    for (let k = 0; k < 5; k++) Math.random()
    S.step(withNoise)
    S.step(withoutNoise)
  }
  t.eq(S.checksum(withNoise), S.checksum(withoutNoise), 'the sim reads only sim.rng')

  /* ---------- 5. speed and framing cannot change outcomes ---------- */

  t.section('running via advance() at any frame rate matches running ticks directly')
  const byTicks = newSim('eta')
  const byFrames = newSim('eta')
  S.run(byTicks, 600)
  // Uneven frame times, as a real browser delivers.
  const frameTimes = [0.0166, 0.0333, 0.008, 0.05, 0.0166, 0.0166, 0.021, 0.012]
  let ticksRun = 0
  let fi = 0
  while (ticksRun < 600) {
    const want = Math.min(frameTimes[fi++ % frameTimes.length], (600 - ticksRun) * OP.DT)
    ticksRun += S.advance(byFrames, want)
    if (fi > 5000) break
  }
  t.eq(byFrames.tick, byTicks.tick, `both reached tick ${byTicks.tick}`)
  t.eq(S.checksum(byFrames), S.checksum(byTicks), 'and the state is identical — frame pacing cannot affect outcomes')

  t.section('game speed cannot change outcomes either')
  const normal = newSim('theta')
  const tripled = newSim('theta')
  S.run(normal, 600)
  S.setSpeed(tripled, 3)
  let fastTicks = 0
  while (fastTicks < 600) {
    const before = tripled.tick
    S.advance(tripled, OP.DT)
    fastTicks += tripled.tick - before
    if (tripled.tick > 5000) break
  }
  t.eq(tripled.tick, normal.tick, 'both reached the same tick')
  t.eq(S.checksum(tripled), S.checksum(normal), '3x speed is the same simulation, run sooner')
}

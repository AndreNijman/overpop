export const name = 'targeting'
export const needs = ['js/core/targeting.js', 'js/core/grid.js', 'js/core/balloons.js']

import { makeSim, spawn, straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  const T = OP.Targeting

  // A minimal tower: targeting only reads x, y and the resolved stat object.
  function tower (x, y, s) {
    return { id: 1, x, y, targetId: -1, s: Object.assign({ range: 200, camoDetect: false }, s) }
  }
  function prep (sim) { OP.Grid.rebuild(sim.grid, sim.balloons) }

  /* ---------- the four base modes ---------- */

  t.section('the four base modes exist and are labelled')
  for (const mode of OP.TARGET_MODES) {
    t.ok(T.hasMode(mode), `${mode} is registered`)
    t.ok(T.modeLabel(mode).length > 0, `${mode} has a label for the UI`)
    t.ok(T.modeHint(mode).length > 0, `${mode} has a hint explaining it`)
  }

  t.section('first and last')
  let sim = makeSim(OP, { trackLength: 1000 })
  const behind = spawn(OP, sim, 'red', 400)
  const ahead = spawn(OP, sim, 'red', 500)
  prep(sim)
  const tw = tower(450, 360, { range: 300 })
  t.eq(T.acquire(sim, tw, 'first'), ahead.id, 'first picks the one closest to leaking')
  t.eq(T.acquire(sim, tw, 'last'), behind.id, 'last picks the one furthest from the exit')

  t.section('close')
  sim = makeSim(OP, { trackLength: 1000 })
  const near = spawn(OP, sim, 'red', 300)
  const far = spawn(OP, sim, 'red', 480)
  prep(sim)
  t.eq(T.acquire(sim, tower(290, 360, { range: 400 }), 'close'), near.id, 'close picks the nearest to the tower')
  t.eq(T.acquire(sim, tower(290, 360, { range: 400 }), 'first'), far.id, 'while first picks the leader')

  t.section('strong')
  sim = makeSim(OP, { trackLength: 1000 })
  const weakLeader = spawn(OP, sim, 'red', 500)
  const strongTrailer = spawn(OP, sim, 'ceramic', 400)
  prep(sim)
  const st = tower(450, 360, { range: 300 })
  t.eq(T.acquire(sim, st, 'strong'), strongTrailer.id, 'strong picks the most remaining RBE')
  t.eq(T.acquire(sim, st, 'first'), weakLeader.id, 'first still picks the leader')

  t.section('strong compares REMAINING rbe, not the tier it spawned as')
  sim = makeSim(OP, { trackLength: 1000 })
  const chewed = spawn(OP, sim, 'ceramic', 400)
  chewed.tier = OP.tierIndex('red')     // as if fully peeled
  chewed.hp = 1
  const intact = spawn(OP, sim, 'black', 420)
  prep(sim)
  t.eq(T.acquire(sim, tower(410, 360, { range: 300 }), 'strong'), intact.id,
    'a peeled ceramic is no longer the strong target')

  t.section('strong breaks ties on first, then on id')
  sim = makeSim(OP, { trackLength: 1000 })
  const tieA = spawn(OP, sim, 'ceramic', 400)
  const tieB = spawn(OP, sim, 'ceramic', 450)
  prep(sim)
  t.eq(T.acquire(sim, tower(425, 360, { range: 300 }), 'strong'), tieB.id,
    'two equal ceramics: the one nearer the exit wins')
  t.ok(tieA.id < tieB.id, 'ids differ so the tiebreak was actually exercised')

  /* ---------- determinism of ties ---------- */

  t.section('ties break on id, not on grid geometry')
  // Two balloons at the identical position on two identical-length paths.
  sim = makeSim(OP, { tracks: [straightTrack(OP, 1000, 360), straightTrack(OP, 1000, 360)] })
  const p0 = OP.Balloons.spawn(sim, { tier: 'red', path: 0, t: 500 })
  const p1 = OP.Balloons.spawn(sim, { tier: 'red', path: 1, t: 500 })
  prep(sim)
  const tie = tower(500, 360, { range: 300 })
  t.eq(T.acquire(sim, tie, 'first'), Math.min(p0.id, p1.id), 'the lower id wins a perfect tie')
  let stable = true
  for (let i = 0; i < 50; i++) {
    OP.Grid.rebuild(sim.grid, sim.balloons)
    if (T.acquire(sim, tie, 'first') !== Math.min(p0.id, p1.id)) stable = false
  }
  t.ok(stable, 'and it stays the same across 50 grid rebuilds')

  /* ---------- range ---------- */

  t.section('range is respected')
  sim = makeSim(OP, { trackLength: 2000 })
  spawn(OP, sim, 'red', 100)
  prep(sim)
  t.eq(T.acquire(sim, tower(600, 360, { range: 100 }), 'first'), -1, 'nothing in range gives -1')
  t.neq(T.acquire(sim, tower(600, 360, { range: 600 }), 'first'), -1, 'a wider range finds it')

  t.section('range is measured from the tower, in a circle')
  sim = makeSim(OP, { trackLength: 2000 })
  const onLine = spawn(OP, sim, 'red', 500)
  prep(sim)
  t.neq(T.acquire(sim, tower(500, 360 - 99, { range: 100 }), 'first'), -1, 'just inside vertically')
  t.eq(T.acquire(sim, tower(500, 360 - 101, { range: 100 }), 'first'), -1, 'just outside vertically')
  t.ok(onLine.alive, 'the balloon was never touched by a targeting query')

  /* ---------- the camo gate ---------- */

  t.section('the camo gate')
  sim = makeSim(OP, { trackLength: 1000 })
  const veiled = spawn(OP, sim, 'red', 500, OP.PROP.VEILED)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'first'), -1,
    'a tower without detection cannot see a veiled balloon')
  t.eq(T.acquire(sim, tower(500, 360, { range: 300, camoDetect: true }), 'first'), veiled.id,
    'a tower with detection can')

  t.section('a veiled balloon does not hide its neighbours')
  sim = makeSim(OP, { trackLength: 1000 })
  spawn(OP, sim, 'red', 480, OP.PROP.VEILED)
  const visible = spawn(OP, sim, 'red', 520)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'first'), visible.id,
    'the visible balloon is still targeted')

  t.section('WRAITH needs detection like anything else veiled')
  sim = makeSim(OP, { trackLength: 1000 })
  const wraith = spawn(OP, sim, 'wraith', 500)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'strong'), -1, 'invisible without detection')
  t.eq(T.acquire(sim, tower(500, 360, { range: 300, camoDetect: true }), 'strong'), wraith.id, 'visible with it')

  /* ---------- line of sight ---------- */

  t.section('line of sight')
  sim = makeSim(OP, { trackLength: 1000 })
  sim.map.blockers = [{ x: 400, y: 200, w: 40, h: 300 }]
  const behindRock = spawn(OP, sim, 'red', 600)
  prep(sim)
  t.eq(T.acquire(sim, tower(200, 360, { range: 600 }), 'first'), -1, 'a blocker hides what is behind it')
  t.eq(T.acquire(sim, tower(200, 360, { range: 600, ignoresLOS: true }), 'first'), behindRock.id,
    'a tower that lobs over terrain ignores the blocker')
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'first'), behindRock.id,
    'and a tower on the far side of the blocker sees it fine')

  t.section('no blockers means no line-of-sight cost')
  sim = makeSim(OP, { trackLength: 1000 })
  spawn(OP, sim, 'red', 500)
  prep(sim)
  t.ok(T.hasLineOfSight(sim, 0, 0, 1280, 720), 'an unobstructed map always has line of sight')

  /* ---------- blimp filters ---------- */

  t.section('blimp-only and blimp-blind towers')
  sim = makeSim(OP, { trackLength: 1000 })
  const smallOne = spawn(OP, sim, 'red', 480)
  const blimp = spawn(OP, sim, 'goliath', 520)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300, onlyBlimps: true }), 'first'), blimp.id,
    'an anti-blimp tower ignores small balloons')
  t.eq(T.acquire(sim, tower(500, 360, { range: 300, noBlimps: true }), 'first'), smallOne.id,
    'and a blimp-blind tower ignores the blimp')

  /* ---------- candidate lists ---------- */

  t.section('candidates and acquireMany')
  sim = makeSim(OP, { trackLength: 2000 })
  for (let i = 0; i < 10; i++) spawn(OP, sim, 'red', 400 + i * 15)
  prep(sim)
  const many = tower(475, 360, { range: 400 })
  const out = []
  T.candidates(sim, many, out)
  t.eq(out.length, 10, 'all ten are candidates')
  let idSorted = true
  for (let i = 1; i < out.length; i++) if (out[i].id <= out[i - 1].id) idSorted = false
  t.ok(idSorted, 'the candidate list is id-sorted')

  const ids = []
  T.acquireMany(sim, many, 'first', 3, ids)
  t.eq(ids.length, 3, 'acquireMany respects its cap')
  // Closest to leaking = largest t on a single-path map.
  const leaders = sim.balloons.slice().sort((a, b) => b.t - a.t).slice(0, 3).map(b => b.id)
  t.deep(ids.slice().sort((x, y) => x - y), leaders.slice().sort((x, y) => x - y),
    'and returns the three closest to leaking')

  T.acquireMany(sim, many, 'first', 99, ids)
  t.eq(ids.length, 10, 'asking for more than exist returns everything')

  t.section('acquireMany does not disturb the shared scratch buffer')
  const before = T.acquire(sim, many, 'first')
  T.acquireMany(sim, many, 'last', 5, ids)
  t.eq(T.acquire(sim, many, 'first'), before, 'a later acquire still gives the same answer')

  t.section('hasTarget is a cheap pre-check')
  t.ok(T.hasTarget(sim, many), 'true when something is in range')
  t.notOk(T.hasTarget(sim, tower(50, 50, { range: 30 })), 'false when nothing is')

  /* ---------- target retention ---------- */

  t.section('retainOrAcquire holds a still-valid target')
  sim = makeSim(OP, { trackLength: 2000 })
  const held = spawn(OP, sim, 'red', 500)
  spawn(OP, sim, 'ceramic', 520)
  prep(sim)
  const holder = tower(510, 360, { range: 300 })
  const firstPick = T.retainOrAcquire(sim, holder, 'first')
  t.eq(T.retainOrAcquire(sim, holder, 'strong'),
    firstPick, 'a held target is kept even when the mode would now prefer another')
  // Kill whatever it actually latched onto, not whichever one we happened to name.
  OP.Balloons.kill(sim, sim.byId.get(firstPick))
  prep(sim)
  t.neq(T.retainOrAcquire(sim, holder, 'first'), firstPick, 'but a dead target is replaced')
  t.ok(held, 'both balloons existed for this check')

  t.section('retainOrAcquire drops a target that left range')
  sim = makeSim(OP, { trackLength: 4000 })
  const runner = spawn(OP, sim, 'pink', 500)
  prep(sim)
  const watcher = tower(500, 360, { range: 60 })
  t.eq(T.retainOrAcquire(sim, watcher, 'first'), runner.id, 'acquired in range')
  runner.t = 3000
  sim.map.paths[0].posInto(runner.t, runner)
  prep(sim)
  t.eq(T.retainOrAcquire(sim, watcher, 'first'), -1, 'dropped once it is out of range')

  t.section('retainOrAcquire drops a target that becomes veiled')
  sim = makeSim(OP, { trackLength: 2000 })
  const sneaky = spawn(OP, sim, 'red', 500)
  prep(sim)
  const eye = tower(500, 360, { range: 200 })
  t.eq(T.retainOrAcquire(sim, eye, 'first'), sneaky.id, 'visible at first')
  sneaky.props |= OP.PROP.VEILED
  t.eq(T.retainOrAcquire(sim, eye, 'first'), -1, 'and dropped once veiled')

  /* ---------- lead prediction ---------- */

  t.section('lead prediction aims ahead of a moving balloon')
  sim = makeSim(OP, { trackLength: 3000 })
  const moving = spawn(OP, sim, 'pink', 500)
  prep(sim)
  const shooter = tower(500, 100, { range: 500 })
  const lead = T.leadPoint(sim, shooter, moving, 400)
  t.gt(lead.x, moving.x, 'the aim point is ahead of the balloon')
  t.close(lead.y, 360, 1e-6, 'and still on the track')

  const slowLead = T.leadPoint(sim, shooter, moving, 60)
  t.gt(slowLead.x, lead.x, 'a slower projectile needs more lead')

  const noLead = T.leadPoint(sim, shooter, moving, 0)
  t.close(noLead.x, moving.x, 1e-6, 'zero projectile speed falls back to the current position')

  t.section('lead prediction does not aim past the exit')
  sim = makeSim(OP, { trackLength: 600 })
  const nearlyOut = spawn(OP, sim, 'pink', 590)
  prep(sim)
  const p = T.leadPoint(sim, tower(300, 100, { range: 600 }), nearlyOut, 30)
  t.lte(p.x, 600.0001, 'the aim point is clamped to the end of the track')

  t.section('a stopped balloon needs no lead')
  sim = makeSim(OP, { trackLength: 3000 })
  const frozen = spawn(OP, sim, 'pink', 500)
  frozen.speedMul = 0
  prep(sim)
  const fp = T.leadPoint(sim, tower(500, 100, { range: 500 }), frozen, 400)
  t.close(fp.x, frozen.x, 1e-6, 'aim is on the balloon itself')

  /* ---------- extensibility ---------- */

  t.section('families can register their own modes')
  t.notOk(T.hasMode('test-farthest-blimp'), 'the mode does not exist yet')
  T.registerMode('test-farthest-blimp', {
    label: 'Blimp',
    hint: 'Biggest blimp first.',
    compare: function (s, a, b) {
      const ab = OP.BALLOON_TIERS[a.tier].blimp ? 0 : 1
      const bb = OP.BALLOON_TIERS[b.tier].blimp ? 0 : 1
      if (ab !== bb) return ab - bb
      return a.id - b.id
    }
  })
  t.ok(T.hasMode('test-farthest-blimp'), 'and now it does')
  sim = makeSim(OP, { trackLength: 1000 })
  spawn(OP, sim, 'red', 480)
  const bigOne = spawn(OP, sim, 'leviathan', 520)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'test-farthest-blimp'), bigOne.id,
    'the custom mode is honoured')
  t.throws(() => T.registerMode('first', { compare: function () { return 0 } }),
    'registering over an existing mode throws rather than silently replacing it')
  t.throws(() => T.registerMode('test-bad', {}), 'a mode without compare() is rejected')
  delete OP.TARGET_COMPARATORS['test-farthest-blimp']

  t.section('an unknown mode falls back to first rather than crashing')
  sim = makeSim(OP, { trackLength: 1000 })
  const only = spawn(OP, sim, 'red', 500)
  prep(sim)
  t.eq(T.acquire(sim, tower(500, 360, { range: 300 }), 'nonsense-mode'), only.id, 'falls back to first')

  /* ---------- multi-path correctness ---------- */

  t.section('first and last are correct across paths of different length')
  sim = makeSim(OP, {
    tracks: [straightTrack(OP, 400, 300), straightTrack(OP, 1600, 420)]
  })
  const shortNearExit = OP.Balloons.spawn(sim, { tier: 'red', path: 0, t: 380 })   // 20 to go
  const longFarAlong = OP.Balloons.spawn(sim, { tier: 'red', path: 1, t: 800 })    // 800 to go
  prep(sim)
  const both = tower(500, 360, { range: 600 })
  t.eq(T.acquire(sim, both, 'first'), shortNearExit.id,
    'first picks the balloon nearest its own exit, despite a much smaller t')
  t.eq(T.acquire(sim, both, 'last'), longFarAlong.id, 'and last picks the other one')

  /* ---------- performance ---------- */

  t.section('performance under a heavy board')
  // A serpentine track that stays inside the 1280x720 field. A track running off
  // the field would clamp hundreds of balloons into the grid's edge cells and
  // measure a linear scan instead of a spatial query.
  const snake = []
  for (let row = 0; row < 6; row++) {
    const y = 80 + row * 112
    if (row % 2 === 0) { snake.push({ x: 50, y }, { x: 1230, y }) }
    else { snake.push({ x: 1230, y }, { x: 50, y }) }
  }
  sim = makeSim(OP, { tracks: [new OP.Track(snake)] })
  const trackLen = sim.map.paths[0].length
  t.gt(trackLen, 6000, `the serpentine track is ${Math.round(trackLen)} units long`)
  for (let i = 0; i < 900; i++) spawn(OP, sim, i % 5 === 0 ? 'ceramic' : 'red', (i * 7.7) % trackLen)
  prep(sim)
  const towers = []
  for (let i = 0; i < 120; i++) towers.push(tower(100 + (i % 12) * 90, 120 + Math.floor(i / 12) * 55, { range: 180 }))
  const started = Date.now()
  let acquired = 0
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 0; i < towers.length; i++) if (T.acquire(sim, towers[i], 'first') >= 0) acquired++
  }
  const ms = Date.now() - started
  t.lt(ms, 2500, `2400 acquires over 900 balloons in ${ms}ms`)
  t.gt(acquired, 0, 'and they actually found targets')
  t.lt(OP.Grid.maxBucket(sim.grid), 200, 'no grid bucket degenerated into a linear scan')
}

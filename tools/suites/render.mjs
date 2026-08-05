export const name = 'render'
export const needs = ['js/render/renderer.js', 'js/render/camera.js', 'js/render/fx.js']

import { makeSim, spawn, hit, ticks } from './_fixture.mjs'

export function run (t, OP, env) {
  const R = OP.Render
  const C = OP.Camera
  const FX = OP.FX

  // A recording context: every draw call is captured, so the suite can assert that
  // drawing actually happened without needing a real canvas.
  function recorder () {
    const calls = []
    const noop = name => function () { calls.push(name); return undefined }
    const ctx = {
      calls,
      save: noop('save'), restore: noop('restore'),
      setTransform: noop('setTransform'), translate: noop('translate'),
      rotate: noop('rotate'), scale: noop('scale'),
      clearRect: noop('clearRect'), fillRect: noop('fillRect'), strokeRect: noop('strokeRect'),
      beginPath: noop('beginPath'), closePath: noop('closePath'),
      moveTo: noop('moveTo'), lineTo: noop('lineTo'), arc: noop('arc'),
      ellipse: noop('ellipse'), rect: noop('rect'), roundRect: noop('roundRect'),
      quadraticCurveTo: noop('quadraticCurveTo'), bezierCurveTo: noop('bezierCurveTo'),
      fill: noop('fill'), stroke: noop('stroke'), clip: noop('clip'),
      drawImage: noop('drawImage'), fillText: noop('fillText'), strokeText: noop('strokeText'),
      setLineDash: noop('setLineDash'), getLineDash: () => [],
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop () {} }),
      createRadialGradient: () => ({ addColorStop () {} }),
      getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
    }
    return ctx
  }

  function view () {
    const v = C.create()
    const canvas = env.ctx.document.createElement('canvas')
    C.resize(v, canvas, 1280, 720, 1)
    return v
  }

  function sim (opts) {
    return makeSim(OP, Object.assign({ trackLength: 2000, cash: 100000 }, opts || {}))
  }

  /* ---------- the camera ---------- */

  t.section('the camera letterboxes rather than stretching')
  const canvas = env.ctx.document.createElement('canvas')

  let v = C.create()
  C.resize(v, canvas, 1280, 720, 1)
  t.close(v.scale, 1, 1e-9, 'an exact-size viewport is scale 1')
  t.eq(v.ox, 0, 'with no horizontal letterbox')
  t.eq(v.oy, 0, 'and none vertical')

  v = C.create()
  C.resize(v, canvas, 2560, 1440, 1)
  t.close(v.scale, 2, 1e-9, 'a double-size viewport is scale 2')
  t.eq(v.ox, 0, 'still no letterbox at the same aspect')

  v = C.create()
  C.resize(v, canvas, 1600, 720, 1)   // wider than 16:9
  t.close(v.scale, 1, 1e-9, 'a wide viewport is limited by height')
  t.gt(v.ox, 0, 'and gets horizontal bars')
  t.eq(v.oy, 0, 'but not vertical ones')

  v = C.create()
  C.resize(v, canvas, 1280, 1000, 1)  // taller than 16:9
  t.close(v.scale, 1, 1e-9, 'a tall viewport is limited by width')
  t.gt(v.oy, 0, 'and gets vertical bars')

  t.section('devicePixelRatio is honoured but capped')
  v = C.create()
  C.resize(v, canvas, 800, 450, 3)
  t.lte(v.dpr, 2.5, 'dpr is capped — beyond ~2.5 the cost buys nothing visible')
  t.eq(canvas.width, Math.round(800 * v.dpr), 'the backing store matches css size times dpr')

  t.section('screen and world coordinates round-trip')
  v = C.create()
  C.resize(v, canvas, 1600, 900, 2)
  const cases = [[0, 0], [640, 360], [1279, 719], [37, 611]]
  let worst = 0
  for (const [wx, wy] of cases) {
    const scr = C.toScreen(v, wx, wy)
    const back = C.toWorld(v, scr.x, scr.y)
    worst = Math.max(worst, Math.abs(back.x - wx), Math.abs(back.y - wy))
  }
  t.lt(worst, 1e-6, 'world -> screen -> world is lossless')

  t.section('a click in the letterbox maps outside the field')
  v = C.create()
  C.resize(v, canvas, 1600, 720, 1)
  const inBar = C.toWorld(v, 5, 360)
  t.lt(inBar.x, 0, 'a click in the left bar has a negative world x')
  t.notOk(C.inField(inBar.x, inBar.y), 'and inField rejects it')
  t.ok(C.inField(640, 360), 'while the middle of the field is accepted')

  t.section('interpolation reads prev positions and never advances the sim')
  const s = sim()
  const b = spawn(OP, s, 'red', 100)
  ticks(OP, s, 10)
  const mid = { x: C.lerpX(b, 0.5), y: C.lerpY(b, 0.5) }
  t.between(mid.x, Math.min(b.prevX, b.x) - 1e-9, Math.max(b.prevX, b.x) + 1e-9,
    'alpha 0.5 lands between the last two ticks')
  t.close(C.lerpX(b, 0), b.prevX, 1e-9, 'alpha 0 is the previous position')
  t.close(C.lerpX(b, 1), b.x, 1e-9, 'alpha 1 is the current position')

  t.section('screen shake is bounded and respects reduced motion')
  v = view()
  C.shake(v, 8, 0.3)
  C.stepShake(v, 0.016, false)
  t.lte(Math.abs(v.shakeX), 8, 'shake stays within its magnitude')
  for (let i = 0; i < 60; i++) C.stepShake(v, 0.016, false)
  t.eq(v.shakeX, 0, 'and decays to nothing')
  C.shake(v, 8, 0.3)
  C.stepShake(v, 0.016, true)
  t.eq(v.shakeX, 0, 'reduced motion suppresses it entirely')
  t.eq(v.shakeT, 0, 'and clears the timer')

  /* ---------- the frame ---------- */

  t.section('a frame draws without a real canvas')
  const s2 = sim()
  for (let i = 0; i < 12; i++) spawn(OP, s2, i % 3 === 0 ? 'ceramic' : 'red', 100 + i * 40)
  OP.Grid.rebuild(s2.grid, s2.balloons)
  const ctx = recorder()
  t.noThrow(() => R.frame(s2, ctx, view(), {}), 'frame() runs')
  t.gt(ctx.calls.length, 20, `and issued ${ctx.calls.length} draw calls`)
  // Assert that painting happened, not HOW. Asserting `arc` specifically broke the
  // moment real sprites landed and drew with paths and ellipses instead.
  t.ok(ctx.calls.includes('fill') || ctx.calls.includes('stroke') || ctx.calls.includes('drawImage'),
    'and actually painted something')

  t.section('RENDERING NEVER MUTATES SIM STATE')
  // The whole determinism story depends on this. The harness runs the sim with no
  // renderer at all and the checksums must match either way.
  const drawn = sim({ seed: 'render' })
  const plain = sim({ seed: 'render' })
  for (let i = 0; i < 120; i++) {
    if (i % 8 === 0) { spawn(OP, drawn, 'green', 0); spawn(OP, plain, 'green', 0) }
    OP.Sim.step(drawn)
    OP.Sim.step(plain)
    R.frame(drawn, recorder(), view(), {})     // only one of the two is drawn
  }
  t.eq(OP.Sim.checksum(drawn), OP.Sim.checksum(plain),
    'drawing 120 frames leaves the simulation bit-identical')

  t.section('a frame with an empty board still draws the terrain')
  const bare = sim()
  const bctx = recorder()
  t.noThrow(() => R.frame(bare, bctx, view(), {}), 'no entities is fine')
  t.gt(bctx.calls.length, 5, 'terrain was still painted')

  t.section('a frame at every game speed and alpha')
  const speeds = sim()
  spawn(OP, speeds, 'ceramic', 200)
  for (const alpha of [0, 0.5, 1]) {
    speeds.accumulator = alpha * OP.DT
    t.noThrow(() => R.frame(speeds, recorder(), view(), {}), `alpha ${alpha} draws`)
  }

  /* ---------- sprite registries ---------- */

  t.section('registered sprites are used')
  let balloonDrawn = 0
  // Stash the real sprite: suites share one bundle, so deleting it outright would
  // leave every later suite drawing reds as placeholders.
  const realRed = R.balloonSprites.red
  R.registerBalloon('red', function () { balloonDrawn++ })
  const s3 = sim()
  spawn(OP, s3, 'red', 100)
  spawn(OP, s3, 'red', 200)
  R.frame(s3, recorder(), view(), {})
  t.eq(balloonDrawn, 2, 'the registered balloon sprite drew both reds')
  if (realRed) R.balloonSprites.red = realRed; else delete R.balloonSprites.red

  t.section('a missing sprite draws a placeholder and is reported once')
  // Temporarily remove a real sprite rather than relying on one being absent: once
  // the sprite files landed there were no gaps left, and an assertion that only
  // passes while the project is unfinished is worse than none.
  const stashed = R.balloonSprites.zebra
  delete R.balloonSprites.zebra
  const s4 = sim()
  spawn(OP, s4, 'zebra', 100)
  const c4 = recorder()
  t.noThrow(() => R.frame(s4, c4, view(), {}), 'a tier with no sprite does not crash the frame')
  t.gt(c4.calls.length, 5, 'and something was still drawn — an invisible balloon is the worse bug')
  t.ok(R.missingSprites()['balloon:zebra'] !== undefined, 'and the gap was recorded by key')
  if (stashed) R.balloonSprites.zebra = stashed

  t.section('a sprite that throws does not kill the frame')
  R.registerBalloon('blue', function () { throw new Error('bad sprite') })
  const s5 = sim()
  spawn(OP, s5, 'blue', 100)
  spawn(OP, s5, 'red', 200)
  t.noThrow(() => R.frame(s5, recorder(), view(), {}), 'the frame survives a throwing sprite')
  delete R.balloonSprites.blue

  t.section('an undeclared projectile kind still renders visibly')
  const s6 = sim()
  OP.Projectiles.spawn(s6, {
    x: 100, y: 100, vx: 10, vy: 0, kind: 'render-test-undeclared',
    damage: 1, pierce: 1, radius: 4, life: 5, ownerId: -1
  })
  const c6 = recorder()
  R.frame(s6, c6, view(), {})
  t.ok(c6.calls.includes('arc'), 'an unknown kind falls back to a visible mark')

  /* ---------- layers ---------- */

  t.section('extra layers')
  let hudDrawn = 0
  R.registerLayer('test-hud', R.LAYER.HUD, function () { hudDrawn++ })
  R.frame(sim(), recorder(), view(), {})
  t.eq(hudDrawn, 1, 'a registered layer is drawn once per frame')
  t.ok(R.layerNames().includes('test-hud'), 'and is listed')

  t.section('layer order is by declared order, then name — never insertion order')
  const seen = []
  R.registerLayer('zzz-early', 5, function () { seen.push('zzz-early') })
  R.registerLayer('aaa-late', 900, function () { seen.push('aaa-late') })
  R.registerLayer('mmm-mid', 50, function () { seen.push('mmm-mid') })
  R.frame(sim(), recorder(), view(), {})
  t.deep(seen.filter(x => x !== 'test-hud'), ['zzz-early', 'mmm-mid', 'aaa-late'],
    'drawn in order value, regardless of the order they were registered')

  t.section('two layers with the same order break the tie on name, deterministically')
  R.unregisterLayer('zzz-early'); R.unregisterLayer('aaa-late'); R.unregisterLayer('mmm-mid')
  const tie = []
  R.registerLayer('b-tie', 300, function () { tie.push('b') })
  R.registerLayer('a-tie', 300, function () { tie.push('a') })
  R.frame(sim(), recorder(), view(), {})
  t.deep(tie, ['a', 'b'], 'alphabetical, not insertion order')
  R.unregisterLayer('a-tie'); R.unregisterLayer('b-tie')

  t.section('re-registering a layer name replaces rather than duplicating')
  let count = 0
  R.registerLayer('dup', 100, function () { count++ })
  R.registerLayer('dup', 100, function () { count++ })
  R.frame(sim(), recorder(), view(), {})
  t.eq(count, 1, 'drawn once, not twice')
  R.unregisterLayer('dup')

  t.section('a layer that throws is removed rather than breaking every frame')
  R.registerLayer('bad-layer', 100, function () { throw new Error('nope') })
  const s7 = sim()
  t.noThrow(() => R.frame(s7, recorder(), view(), {}), 'the frame survives')
  t.notOk(R.layerNames().includes('bad-layer'), 'and the offending layer was unregistered')
  t.noThrow(() => R.frame(s7, recorder(), view(), {}), 'the next frame is clean')

  R.unregisterLayer('test-hud')
  t.notOk(R.layerNames().includes('test-hud'), 'layers can be removed')
  t.notOk(R.unregisterLayer('never-registered'), 'removing an absent layer reports false')

  /* ---------- terrain cache ---------- */

  t.section('the terrain is cached, not repainted every frame')
  const cv = view()
  const s8 = sim()
  const first = R.terrainCache(cv, s8)
  const second = R.terrainCache(cv, s8)
  t.ok(first, 'a terrain canvas was produced')
  t.ok(first === second, 'and the second call returns the same object')

  t.section('the cache invalidates on resize')
  C.resize(cv, canvas, 800, 450, 1)
  const resized = R.terrainCache(cv, s8)
  t.notOk(resized === first, 'a different viewport produces a new cache')

  t.section('and when an obstacle is cleared')
  const cv2 = view()
  const s9 = sim()
  s9.map.cleared = []
  const a = R.terrainCache(cv2, s9)
  s9.map.cleared = [0]
  const bb = R.terrainCache(cv2, s9)
  t.notOk(a === bb, 'clearing an obstacle repaints the terrain')

  t.section('the cache can be invalidated by hand')
  R.invalidateTerrain(cv2)
  t.notOk(cv2._terrain, 'invalidateTerrain drops it')

  /* ---------- FX ---------- */

  t.section('FX are driven by draining the sim event queues')
  FX.reset()
  const s10 = sim({ cash: 0 })
  hit(OP, s10, spawn(OP, s10, 'pink', 100), 5)
  t.gt(s10.popEvents.length, 0, 'the sim recorded pops')
  FX.consume(FX.state, s10)
  t.gt(FX.count(), 0, 'and FX spawned particles from them')

  t.section('consuming twice does not double-spawn')
  const n1 = FX.count()
  FX.consume(FX.state, s10)
  t.eq(FX.count(), n1, 'the cursor prevented a replay')

  t.section('FX particles are hard-capped')
  FX.reset()
  const s11 = sim({ cash: 0 })
  for (let i = 0; i < 400; i++) {
    const bb2 = spawn(OP, s11, 'ceramic', 50 + (i % 30) * 10)
    hit(OP, s11, bb2, 99)
  }
  FX.consume(FX.state, s11)
  t.lte(FX.state.particles.length, 1000, `capped at ${FX.state.particles.length} particles`)
  t.gt(FX.state.dropped, 0, 'and the excess was counted as dropped, not queued')

  t.section('FX decay to nothing')
  FX.reset()
  const s12 = sim({ cash: 0 })
  hit(OP, s12, spawn(OP, s12, 'goliath', 100), 99999)
  FX.consume(FX.state, s12)
  t.gt(FX.count(), 0, 'a blimp pop makes a lot of particles')
  for (let i = 0; i < 200; i++) FX.step(FX.state, 0.016)
  t.eq(FX.count(), 0, 'and after three seconds they are all gone')
  t.gt(FX.state.pool.length, 0, 'returned to the pool for reuse')

  t.section('a trimmed queue resyncs rather than replaying stale events')
  FX.reset()
  const s13 = sim({ cash: 0 })
  hit(OP, s13, spawn(OP, s13, 'pink', 100), 5)
  FX.consume(FX.state, s13)
  s13.popEvents.length = 0
  t.noThrow(() => FX.consume(FX.state, s13), 'a shorter queue does not throw')
  t.eq(FX.state.lastPopIndex, 0, 'and the cursor resyncs')

  t.section('a leak flashes the screen')
  FX.reset()
  const s14 = makeSim(OP, { trackLength: 80, lives: 500 })
  spawn(OP, s14, 'ceramic', 75)
  ticks(OP, s14, 20)
  FX.consume(FX.state, s14)
  t.gt(FX.state.flash, 0, 'the flash was raised')
  for (let i = 0; i < 100; i++) FX.step(FX.state, 0.016)
  t.eq(FX.state.flash, 0, 'and fades')

  t.section('reduced motion cuts particle counts')
  FX.reset()
  FX.state.reducedMotion = true
  const s15 = sim({ cash: 0 })
  hit(OP, s15, spawn(OP, s15, 'goliath', 100), 99999)
  FX.consume(FX.state, s15)
  const reduced = FX.state.particles.length
  FX.reset()
  FX.state.reducedMotion = false
  const s16 = sim({ cash: 0 })
  hit(OP, s16, spawn(OP, s16, 'goliath', 100), 99999)
  FX.consume(FX.state, s16)
  t.lt(reduced, FX.state.particles.length, `reduced motion emits fewer (${reduced} vs ${FX.state.particles.length})`)

  t.section('FX cannot influence the simulation')
  const fxSim = sim({ seed: 'fx' })
  const noFx = sim({ seed: 'fx' })
  FX.reset()
  for (let i = 0; i < 150; i++) {
    if (i % 6 === 0) { spawn(OP, fxSim, 'green', 0); spawn(OP, noFx, 'green', 0) }
    OP.Sim.step(fxSim)
    OP.Sim.step(noFx)
    FX.consume(FX.state, fxSim)
    FX.step(FX.state, 0.016)
  }
  t.eq(OP.Sim.checksum(fxSim), OP.Sim.checksum(noFx),
    'running FX every tick leaves the simulation bit-identical')

  t.section('floating text')
  FX.reset()
  FX.say(100, 100, '+250', '#fff')
  t.eq(FX.state.floaters.length, 1, 'a floater was added')
  for (let i = 0; i < 120; i++) FX.step(FX.state, 0.016)
  t.eq(FX.state.floaters.length, 0, 'and expires')

  t.section('FX drawing does not throw on an empty state')
  FX.reset()
  t.noThrow(() => FX.draw(recorder(), sim(), view(), {}), 'nothing to draw is fine')

  /* ---------- diagnostics ---------- */

  t.section('render stats')
  const s17 = sim()
  spawn(OP, s17, 'red', 100)
  const stats = R.stats(s17)
  t.eq(stats.balloons, 1, 'reports balloon count')
  t.eq(typeof stats.layers, 'number', 'reports layer count')
  t.eq(typeof stats.missingSprites, 'number', 'reports missing sprite count')

  FX.reset()
}

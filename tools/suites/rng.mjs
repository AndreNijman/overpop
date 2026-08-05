// Determinism is the foundation of every other claim this project makes about
// itself — "rounds 1-100 verified" means nothing if the sim can't reproduce a
// seed. So this suite is deliberately paranoid.

export const name = 'rng'
export const needs = ['js/core/const.js', 'js/core/rng.js', 'js/core/math.js']

export function run (t, OP) {
  const { RNG, M } = OP

  t.section('constants')
  t.close(OP.DT, 1 / 60, 1e-12, 'DT is exactly 1/60')
  t.eq(OP.PROP.VEILED | OP.PROP.REGEN | OP.PROP.PLATED, 7, 'the three properties are distinct bits')
  t.eq(OP.TARGET_MODES.length, 4, 'four base targeting modes')
  t.ok(Array.isArray(OP.FAMILIES) && OP.FAMILIES.length === 4, 'four tower families')
  for (const reg of ['TOWERS', 'HEROES', 'MAPS', 'ABILITIES', 'PROJ_BEHAVIOURS']) {
    t.ok(OP[reg] && typeof OP[reg] === 'object', `registry OP.${reg} is pre-declared`)
  }

  t.section('reproducibility')
  const a = new RNG(1337), b = new RNG(1337)
  let same = true
  for (let i = 0; i < 5000; i++) if (a.u32() !== b.u32()) { same = false; break }
  t.ok(same, 'two generators on the same seed produce an identical 5000-draw sequence')

  const c = new RNG(1338)
  t.neq(new RNG(1337).u32(), c.u32(), 'adjacent integer seeds diverge immediately')

  const s1 = new RNG('overpop').u32()
  const s2 = new RNG('overpop').u32()
  t.eq(s1, s2, 'string seeds are stable')
  t.neq(new RNG('overpop').u32(), new RNG('overpop ').u32(), 'string seeds are sensitive')

  t.section('range guarantees')
  const r = new RNG(42)
  let min = 1, max = 0, badInt = 0, badRange = 0
  for (let i = 0; i < 60000; i++) {
    const f = r.next()
    if (f < min) min = f
    if (f > max) max = f
    if (f < 0 || f >= 1) badRange++
    const n = r.int(7)
    if (!Number.isInteger(n) || n < 0 || n > 6) badInt++
  }
  t.eq(badRange, 0, 'next() never leaves [0,1)')
  t.eq(badInt, 0, 'int(7) always returns an integer in [0,6]')
  t.lt(min, 0.001, 'next() reaches near 0')
  t.gt(max, 0.999, 'next() reaches near 1')
  t.eq(new RNG(1).int(0), 0, 'int(0) is 0 rather than NaN')

  t.section('distribution is not obviously broken')
  const buckets = new Array(10).fill(0)
  const d = new RNG('dist')
  const N = 200000
  for (let i = 0; i < N; i++) buckets[Math.floor(d.next() * 10)]++
  const expect = N / 10
  let worst = 0
  for (const n of buckets) worst = Math.max(worst, Math.abs(n - expect) / expect)
  t.lt(worst, 0.05, 'ten uniform buckets are each within 5% of expectation')

  // intRange must be inclusive on both ends, which is the classic off-by-one.
  const seen = new Set()
  const ir = new RNG('ir')
  for (let i = 0; i < 4000; i++) seen.add(ir.intRange(3, 6))
  t.deep([...seen].sort(), [3, 4, 5, 6], 'intRange(3,6) hits exactly 3,4,5,6')

  t.section('serialisation round-trips')
  const src = new RNG('save-me')
  for (let i = 0; i < 1234; i++) src.u32()
  const snapshot = JSON.parse(JSON.stringify(src.state()))
  const expectNext = []
  const probe = RNG.fromState(snapshot)
  for (let i = 0; i < 50; i++) expectNext.push(probe.u32())
  const restored = RNG.fromState(snapshot)
  let ok = true
  for (let i = 0; i < 50; i++) if (restored.u32() !== expectNext[i]) { ok = false; break }
  t.ok(ok, 'a JSON-round-tripped state resumes the exact sequence')
  t.ok(Object.values(snapshot).every(v => typeof v === 'number' || typeof v === 'string'),
    'the whole state is primitive — no closures, so the sim stays serialisable')

  const cl = new RNG(9).clone()
  t.eq(cl.u32(), new RNG(9).u32(), 'clone() matches a fresh generator on the same seed')

  const forkA = new RNG(5).fork('towers')
  const forkB = new RNG(5).fork('towers')
  t.eq(forkA.u32(), forkB.u32(), 'fork(label) is deterministic')
  t.neq(new RNG(5).fork('towers').u32(), new RNG(5).fork('balloons').u32(), 'different labels give different streams')

  t.section('helpers')
  const h = new RNG('helpers')
  t.eq(h.pick([]), undefined, 'pick([]) is undefined rather than a crash')
  t.eq(h.pick(['only']), 'only', 'pick of one element')
  const arr = [1, 2, 3, 4, 5, 6, 7, 8]
  const shuffled = new RNG('sh').shuffle(arr.slice())
  t.deep(shuffled.slice().sort((x, y) => x - y), arr, 'shuffle is a permutation, loses nothing')
  t.eq(new RNG('sh').shuffle(arr.slice()).join(), shuffled.join(), 'shuffle is deterministic per seed')
  t.eq(h.weighted(['a', 'b'], [0, 0]), undefined, 'weighted with no positive weight is undefined')
  t.eq(h.weighted(['a', 'b'], [1, 0]), 'a', 'weighted ignores zero-weight entries')
  let heads = 0
  const cr = new RNG('coin')
  for (let i = 0; i < 20000; i++) if (cr.chance(0.25)) heads++
  t.between(heads / 20000, 0.235, 0.265, 'chance(0.25) fires about a quarter of the time')

  t.section('math — scalars')
  t.eq(M.clamp(5, 0, 3), 3, 'clamp upper')
  t.eq(M.clamp(-5, 0, 3), 0, 'clamp lower')
  t.eq(M.lerp(10, 20, 0.5), 15, 'lerp midpoint')
  t.eq(M.invLerp(10, 20, 15), 0.5, 'invLerp is the inverse')
  t.eq(M.invLerp(5, 5, 5), 0, 'invLerp on a zero span is 0, not NaN')
  t.eq(M.approach(0, 10, 3), 3, 'approach steps toward')
  t.eq(M.approach(9, 10, 3), 10, 'approach does not overshoot')
  t.eq(M.approach(10, 0, 3), 7, 'approach steps down')

  t.section('math — angles')
  t.close(M.angleDiff(0, Math.PI / 2), Math.PI / 2, 1e-9, 'angleDiff quarter turn')
  t.close(M.angleDiff(0.1, -0.1), -0.2, 1e-9, 'angleDiff signs correctly')
  t.close(Math.abs(M.angleDiff(0, Math.PI * 1.9)), Math.PI * 0.1, 1e-9, 'angleDiff takes the short way round')
  t.close(M.rotateToward(0, 1, 0.25), 0.25, 1e-9, 'rotateToward is rate-limited')
  t.close(M.rotateToward(0, 0.1, 0.25), 0.1, 1e-9, 'rotateToward snaps when within reach')
  t.gte(M.normalizeAngle(-0.5), 0, 'normalizeAngle returns a positive angle')

  t.section('math — sweep collision')
  // A balloon 40 units wide, moving 200 units in one tick, must still be hit.
  t.gte(M.sweepCircle(0, 0, 200, 0, 100, 0, 8), 0, 'a fast sweep through a small circle hits')
  t.eq(M.sweepCircle(0, 0, 200, 0, 100, 50, 8), -1, 'a sweep that passes wide misses')
  t.eq(M.sweepCircle(0, 0, 10, 0, 5, 0, 20), 0, 'starting inside the circle hits at t=0')
  t.eq(M.sweepCircle(5, 5, 5, 5, 100, 100, 3), -1, 'a zero-length sweep outside the circle misses')
  t.eq(M.sweepCircle(5, 5, 5, 5, 6, 6, 3), 0, 'a zero-length sweep inside the circle hits')
  const tHit = M.sweepCircle(0, 0, 100, 0, 50, 0, 10)
  t.close(tHit, 0.4, 1e-6, 'the returned t is the entry point, not the centre')
  t.eq(M.sweepCircle(0, 0, 30, 0, 100, 0, 10), -1, 'a sweep stopping short of the circle misses')

  t.section('math — segments and areas')
  t.eq(M.pointSegDist2(0, 5, -10, 0, 10, 0), 25, 'perpendicular distance to a segment')
  t.eq(M.pointSegDist2(20, 0, -10, 0, 10, 0), 100, 'distance clamps to the segment end')
  t.ok(M.segSegHit(0, 0, 10, 10, 0, 10, 10, 0), 'crossing segments intersect')
  t.notOk(M.segSegHit(0, 0, 1, 1, 5, 5, 6, 6), 'colinear-but-apart segments do not')
  t.ok(M.segRectHit(-5, 5, 15, 5, 0, 0, 10, 10), 'a segment crossing a rect hits')
  t.ok(M.segRectHit(2, 2, 3, 3, 0, 0, 10, 10), 'a segment inside a rect hits')
  t.notOk(M.segRectHit(-5, -5, -1, -1, 0, 0, 10, 10), 'a segment outside a rect misses')
  t.ok(M.circleRectOverlap(12, 5, 3, 0, 0, 10, 10), 'a circle overlapping a rect edge')
  t.notOk(M.circleRectOverlap(20, 5, 3, 0, 0, 10, 10), 'a circle clear of a rect')
  const square = [0, 0, 10, 0, 10, 10, 0, 10]
  t.ok(M.pointInPoly(5, 5, square), 'point inside polygon')
  t.notOk(M.pointInPoly(15, 5, square), 'point outside polygon')

  t.section('math — stable jitter never touches sim randomness')
  t.eq(M.jitter(7, 1), M.jitter(7, 1), 'jitter is stable for the same id and channel')
  t.neq(M.jitter(7, 1), M.jitter(7, 2), 'jitter varies by channel')
  t.neq(M.jitter(7, 1), M.jitter(8, 1), 'jitter varies by id')
  t.between(M.jitter(12345, 3), -1, 1, 'jitter stays in [-1,1]')

  t.section('formatting')
  t.eq(M.money(0), '$0', 'money zero')
  t.eq(M.money(999), '$999', 'money below 1k is exact')
  t.eq(M.money(1500), '$1.5k', 'money thousands')
  t.eq(M.money(2000000), '$2m', 'money millions drops trailing zeros')
  t.eq(M.compact(999), '999', 'compact below 1k')
  t.eq(M.time(0), '0:00', 'time zero pads')
  t.eq(M.time(125), '2:05', 'time pads seconds')
  t.eq(M.time(-5), '0:00', 'negative time clamps')
}

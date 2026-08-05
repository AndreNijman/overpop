export const name = 'track'
export const needs = ['js/core/track.js']

export function run (t, OP) {
  const { Track, M } = OP

  t.section('construction')
  const line = new Track([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  t.close(line.length, 100, 1e-9, 'a straight 100-unit line measures 100')
  t.eq(line.n, 2, 'no smoothing means no extra points')

  const L = new Track([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
  t.close(L.length, 200, 1e-9, 'an L of two 100-unit legs measures 200')

  t.throws(() => new Track([{ x: 0, y: 0 }]), 'a one-point track is rejected')
  t.throws(() => new Track([]), 'an empty track is rejected')
  t.throws(() => new Track([{ x: 5, y: 5 }, { x: 5, y: 5 }]), 'a track that collapses to a point is rejected')

  const dup = new Track([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])
  t.eq(dup.n, 3, 'consecutive duplicate points are dropped')
  t.close(dup.length, 100, 1e-9, 'dropping duplicates does not change length')

  t.section('position at distance')
  const p0 = line.posAt(0)
  t.close(p0.x, 0, 1e-9, 'posAt(0) is the entry point')
  const pMid = line.posAt(50)
  t.close(pMid.x, 50, 1e-9, 'posAt(50) is halfway along')
  t.close(pMid.y, 0, 1e-9, 'posAt stays on the line')
  t.close(line.posAt(-20).x, 0, 1e-9, 'negative t clamps to the entry')
  t.close(line.posAt(500).x, 100, 1e-9, 't past the end clamps to the exit')

  const corner = L.posAt(100)
  t.close(corner.x, 100, 1e-6, 'the corner of the L is reached at t=100 (x)')
  t.close(corner.y, 0, 1e-6, 'the corner of the L is reached at t=100 (y)')
  const upLeg = L.posAt(150)
  t.close(upLeg.x, 100, 1e-6, 'past the corner, x holds')
  t.close(upLeg.y, 50, 1e-6, 'past the corner, y advances')

  t.section('posInto allocates nothing')
  const out = { x: -1, y: -1 }
  const same = L.posInto(150, out)
  t.ok(same === out, 'posInto returns the object it was given')
  t.close(out.y, 50, 1e-6, 'posInto writes the right value')

  t.section('monotonic advance — no jitter, no backtracking')
  const curvy = new Track([
    { x: 20, y: 360 }, { x: 200, y: 120 }, { x: 500, y: 600 },
    { x: 800, y: 150 }, { x: 1100, y: 500 }, { x: 1260, y: 300 }
  ], { smooth: 6 })
  let prev = curvy.posAt(0)
  let travelled = 0
  let regressions = 0
  for (let d = 1; d <= curvy.length; d += 1) {
    const p = curvy.posAt(d)
    const step = M.dist(prev.x, prev.y, p.x, p.y)
    travelled += step
    if (step > 2.5) regressions++   // a 1-unit t step must not move >1 unit by much
    prev = p
  }
  t.eq(regressions, 0, 'stepping t by 1 never moves the point by more than ~1 unit')
  t.close(travelled, curvy.length, curvy.length * 0.02, 'summed movement matches the reported length within 2%')

  t.section('smoothing')
  const raw = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
  const sharp = new Track(raw)
  const soft = new Track(raw, { smooth: 8 })
  t.gt(soft.n, sharp.n, 'smoothing subdivides the polyline')
  t.close(soft.length, sharp.length, sharp.length * 0.05, 'smoothing stays within 5% of the raw length')
  // Catmull-Rom interpolates *through* its control points rather than cutting
  // corners. That is the property a map author needs: waypoints are honoured
  // exactly, and the curve between them is what gets softened.
  let offTrack = 0
  for (const cp of raw) if (soft.nearest(cp.x, cp.y).dist > 1e-6) offTrack++
  t.eq(offTrack, 0, 'the smoothed curve still passes exactly through every waypoint')
  t.close(soft.posAt(0).x, 0, 1e-6, 'smoothing preserves the entry point')
  t.close(soft.posAt(soft.length).x, 100, 1e-6, 'smoothing preserves the exit point (x)')
  t.close(soft.posAt(soft.length).y, 100, 1e-6, 'smoothing preserves the exit point (y)')

  t.section('heading')
  t.close(line.angleAt(50), 0, 1e-9, 'a rightward line has heading 0')
  t.close(new Track([{ x: 0, y: 0 }, { x: 0, y: 100 }]).angleAt(50), Math.PI / 2, 1e-9, 'a downward line has heading PI/2')
  t.close(L.angleAt(150), Math.PI / 2, 1e-9, 'heading follows the second leg')

  t.section('segment lookup')
  t.eq(L.segmentAt(-5), 0, 'negative t is in segment 0')
  t.eq(L.segmentAt(0), 0, 't=0 is in segment 0')
  t.eq(L.segmentAt(50), 0, 'mid-first-leg is segment 0')
  t.eq(L.segmentAt(150), 1, 'mid-second-leg is segment 1')
  t.eq(L.segmentAt(9999), 1, 'past the end is the last segment')
  // Binary search must agree with a linear scan at every integer distance.
  let mismatch = 0
  for (let d = 0; d <= curvy.length; d += 3) {
    const bs = curvy.segmentAt(d)
    let lin = curvy.n - 2
    for (let i = 0; i < curvy.n - 1; i++) if (curvy.cum[i] <= d && d < curvy.cum[i + 1]) { lin = i; break }
    if (bs !== lin) mismatch++
  }
  t.eq(mismatch, 0, 'binary-search segment lookup agrees with a linear scan everywhere')

  t.section('derived facts have one definition')
  t.close(OP.remaining(L, 0), 200, 1e-9, 'remaining at the entry is the full length')
  t.close(OP.remaining(L, 200), 0, 1e-9, 'remaining at the exit is zero')
  t.notOk(OP.hasLeaked(L, 199.9), 'not leaked just before the exit')
  t.ok(OP.hasLeaked(L, 200), 'leaked exactly at the exit')
  t.ok(OP.hasLeaked(L, 250), 'leaked past the exit')

  t.section('First and Last derive from remaining, not raw t — multi-path safety')
  const shortPath = new Track([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const longPath = new Track([{ x: 0, y: 100 }, { x: 900, y: 100 }])
  // A balloon 90 along the short path is nearly out. One 200 along the long path
  // has travelled further but is far from leaking. "First" must pick the former.
  const aRemaining = OP.remaining(shortPath, 90)
  const bRemaining = OP.remaining(longPath, 200)
  t.lt(aRemaining, bRemaining, 'the balloon closer to its own exit is First even with a smaller t')

  t.section('nearest point')
  const near = line.nearest(50, 30)
  t.close(near.dist, 30, 1e-6, 'perpendicular distance to the line')
  t.close(near.t, 50, 1e-6, 'nearest reports the right t')
  const off = line.nearest(-40, 0)
  t.close(off.t, 0, 1e-6, 'a point behind the entry clamps to t=0')
  t.close(off.dist, 40, 1e-6, 'and reports the true distance')
  t.close(L.nearest(100, 100).t, 200, 1e-6, 'nearest finds the far end of an L')
  // Sampling the track and asking for the nearest point should give back ~that t.
  let worst = 0
  for (let d = 0; d < curvy.length; d += 17) {
    const p = curvy.posAt(d)
    worst = Math.max(worst, curvy.nearest(p.x, p.y).dist)
  }
  t.lt(worst, 0.001, 'points taken from the track report ~zero distance to it')

  t.section('segmentWithin')
  t.ok(line.segmentWithin(50, -10, 50, 10, 1), 'a segment crossing the track is within')
  t.ok(line.segmentWithin(50, 5, 60, 5, 6), 'a parallel segment inside the radius is within')
  t.notOk(line.segmentWithin(50, 40, 60, 40, 6), 'a parallel segment outside the radius is not')
  t.ok(line.segmentWithin(-20, 0, -5, 0, 6), 'a segment ending near the entry is within')

  t.section('bounds and sampling')
  const b = L.bounds()
  t.eq(b.x0, 0, 'bounds x0'); t.eq(b.x1, 100, 'bounds x1')
  t.eq(b.y0, 0, 'bounds y0'); t.eq(b.y1, 100, 'bounds y1')
  const s = L.sample(25)
  t.gte(s.length, 9, 'sample(25) over a 200-unit track yields at least 9 points')
  t.close(s[s.length - 1].x, 100, 1e-6, 'the last sample is the exit (x)')
  t.close(s[s.length - 1].y, 100, 1e-6, 'the last sample is the exit (y)')

  t.section('long track performance')
  const started = Date.now()
  const big = new Track(Array.from({ length: 300 }, (_, i) => ({ x: i * 4, y: 300 + Math.sin(i / 6) * 200 })))
  let acc = 0
  const tmp = { x: 0, y: 0 }
  for (let i = 0; i < 200000; i++) { big.posInto((i * 7) % big.length, tmp); acc += tmp.x }
  t.lt(Date.now() - started, 2000, '200k posInto lookups on a 300-point track stay under 2s')
  t.gt(acc, 0, 'the lookups produced real values')
}

;(function (OP) {
  'use strict'

  const M = OP.M

  /* A track is a polyline plus a cumulative-length table. Every positional fact
     in the game derives from one scalar per balloon: `t`, the distance it has
     travelled along its track.

       leak            t >= track.length
       remaining       track.length - t          (First = min, Last = max)
       child spawn     parent's t, fanned by CHILD_SPREAD

     Getting this right once is why targeting, leaks and cascades don't each need
     their own notion of "where is this balloon". See ARCHITECTURE.md §1.

     Control points are optionally smoothed with a centripetal Catmull-Rom spline
     so a map author can write eight readable waypoints and still get a curve
     that looks hand-drawn. Smoothing happens once, at construction. */

  function catmullRom (p0, p1, p2, p3, tt, out) {
    const t2 = tt * tt, t3 = t2 * tt
    out.x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * tt +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
    out.y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * tt +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    return out
  }

  function smoothPoints (pts, subdiv) {
    if (subdiv < 1 || pts.length < 3) return pts.slice()
    const out = []
    const tmp = { x: 0, y: 0 }
    const at = i => pts[M.clamp(i, 0, pts.length - 1)]
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
      const steps = subdiv + 1
      for (let s = 0; s < steps; s++) {
        catmullRom(p0, p1, p2, p3, s / steps, tmp)
        out.push({ x: tmp.x, y: tmp.y })
      }
    }
    out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
    return out
  }

  /**
   * @param {Array<{x:number,y:number}>} points  entry first, exit last
   * @param {{smooth?:number, name?:string}} [opts]
   */
  function Track (points, opts) {
    if (!(this instanceof Track)) return new Track(points, opts)
    opts = opts || {}
    if (!points || points.length < 2) throw new Error('Track needs at least two points')

    this.name = opts.name || ''
    this.smooth = opts.smooth || 0

    const pts = smoothPoints(points, this.smooth)

    // Drop consecutive duplicates — a zero-length segment breaks angleAt and
    // wastes a binary-search slot.
    const kept = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = kept[kept.length - 1]
      if (M.dist2(p.x, p.y, q.x, q.y) > 1e-8) kept.push(p)
    }
    if (kept.length < 2) throw new Error('Track collapsed to a single point')

    const n = kept.length
    this.n = n
    this.xs = new Float64Array(n)
    this.ys = new Float64Array(n)
    this.cum = new Float64Array(n)      // cum[i] = distance from start to point i
    this.ang = new Float64Array(n - 1)  // heading of segment i

    for (let i = 0; i < n; i++) { this.xs[i] = kept[i].x; this.ys[i] = kept[i].y }
    let acc = 0
    for (let i = 0; i < n - 1; i++) {
      const dx = this.xs[i + 1] - this.xs[i]
      const dy = this.ys[i + 1] - this.ys[i]
      this.ang[i] = Math.atan2(dy, dx)
      acc += Math.hypot(dx, dy)
      this.cum[i + 1] = acc
    }
    this.length = acc
    this.points = kept
  }

  /** Index of the segment containing distance t. Binary search over `cum`. */
  Track.prototype.segmentAt = function (t) {
    const cum = this.cum
    if (!(t > 0)) return 0
    const last = this.n - 2
    if (t >= this.length) return last
    let lo = 0, hi = last
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (cum[mid] <= t) lo = mid; else hi = mid - 1
    }
    return lo
  }

  /** Write the position at distance t into `out` (avoids allocating in the hot loop). */
  Track.prototype.posInto = function (t, out) {
    const i = this.segmentAt(t)
    const segLen = this.cum[i + 1] - this.cum[i]
    let f = segLen > 0 ? (t - this.cum[i]) / segLen : 0
    f = f < 0 ? 0 : f > 1 ? 1 : f
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * f
    out.y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * f
    return out
  }

  Track.prototype.posAt = function (t) { return this.posInto(t, { x: 0, y: 0 }) }

  Track.prototype.angleAt = function (t) { return this.ang[this.segmentAt(t)] }

  /** Even-ish samples along the track, for the terrain painter and previews. */
  Track.prototype.sample = function (step) {
    step = step || 12
    const out = []
    for (let t = 0; t < this.length; t += step) out.push(this.posAt(t))
    out.push(this.posAt(this.length))
    return out
  }

  /**
   * Closest point on the track to (x,y).
   * Used for placement masks ("not on the path") and by the map tooling.
   * @returns {{t:number, x:number, y:number, dist:number}}
   */
  Track.prototype.nearest = function (x, y) {
    let bestD2 = Infinity, bestT = 0, bx = 0, by = 0
    for (let i = 0; i < this.n - 1; i++) {
      const ax = this.xs[i], ay = this.ys[i]
      const cx = this.xs[i + 1], cy = this.ys[i + 1]
      const abx = cx - ax, aby = cy - ay
      const denom = abx * abx + aby * aby
      let f = denom === 0 ? 0 : ((x - ax) * abx + (y - ay) * aby) / denom
      f = f < 0 ? 0 : f > 1 ? 1 : f
      const px = ax + abx * f, py = ay + aby * f
      const d2 = M.dist2(x, y, px, py)
      if (d2 < bestD2) {
        bestD2 = d2
        bestT = this.cum[i] + Math.sqrt(denom) * f
        bx = px; by = py
      }
    }
    return { t: bestT, x: bx, y: by, dist: Math.sqrt(bestD2) }
  }

  /** Shortest distance from (x,y) to the track. */
  Track.prototype.distanceTo = function (x, y) { return this.nearest(x, y).dist }

  /** Does the segment (ax,ay)-(bx,by) come within `r` of the track?
      Segment-to-segment distance is the min of the four point-to-segment
      distances, unless they actually cross. */
  Track.prototype.segmentWithin = function (ax, ay, bx, by, r) {
    const r2 = r * r
    for (let i = 0; i < this.n - 1; i++) {
      const cx = this.xs[i], cy = this.ys[i]
      const dx = this.xs[i + 1], dy = this.ys[i + 1]
      if (M.segSegHit(ax, ay, bx, by, cx, cy, dx, dy)) return true
      if (M.pointSegDist2(cx, cy, ax, ay, bx, by) <= r2) return true
      if (M.pointSegDist2(dx, dy, ax, ay, bx, by) <= r2) return true
      if (M.pointSegDist2(ax, ay, cx, cy, dx, dy) <= r2) return true
      if (M.pointSegDist2(bx, by, cx, cy, dx, dy) <= r2) return true
    }
    return false
  }

  Track.prototype.bounds = function () {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < this.n; i++) {
      if (this.xs[i] < x0) x0 = this.xs[i]
      if (this.xs[i] > x1) x1 = this.xs[i]
      if (this.ys[i] < y0) y0 = this.ys[i]
      if (this.ys[i] > y1) y1 = this.ys[i]
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
  }

  /* ---------- derived facts — the single definition of each ---------- */

  /** Distance still to travel. First = smallest, Last = largest. Multi-path safe. */
  OP.remaining = function (track, t) { return track.length - t }

  /** Has this reached the exit? */
  OP.hasLeaked = function (track, t) { return t >= track.length }

  OP.Track = Track
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

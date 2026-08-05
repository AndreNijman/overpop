;(function (OP) {
  'use strict'

  const M = {}

  M.TAU = Math.PI * 2
  M.DEG = Math.PI / 180

  /* ---------- scalars ---------- */

  M.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
  M.clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v }
  M.lerp = function (a, b, t) { return a + (b - a) * t }
  M.invLerp = function (a, b, v) { return a === b ? 0 : (v - a) / (b - a) }
  M.sign = function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0 }

  /** Move `v` toward `target` by at most `step`. */
  M.approach = function (v, target, step) {
    if (v < target) return Math.min(v + step, target)
    if (v > target) return Math.max(v - step, target)
    return target
  }

  /* ---------- vectors ---------- */

  M.dist2 = function (ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    return dx * dx + dy * dy
  }
  M.dist = function (ax, ay, bx, by) { return Math.sqrt(M.dist2(ax, ay, bx, by)) }

  M.angleTo = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax) }

  /** Signed smallest difference between two angles, in (-PI, PI]. */
  M.angleDiff = function (from, to) {
    let d = (to - from) % M.TAU
    if (d > Math.PI) d -= M.TAU
    if (d <= -Math.PI) d += M.TAU
    return d
  }

  /** Rotate `from` toward `to` by at most `maxStep` radians. */
  M.rotateToward = function (from, to, maxStep) {
    const d = M.angleDiff(from, to)
    if (Math.abs(d) <= maxStep) return to
    return from + Math.sign(d) * maxStep
  }

  M.normalizeAngle = function (a) {
    a = a % M.TAU
    return a < 0 ? a + M.TAU : a
  }

  /* ---------- geometry used by collision ---------- */

  /** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
  M.pointSegDist2 = function (px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay
    const apx = px - ax, apy = py - ay
    const denom = abx * abx + aby * aby
    let t = denom === 0 ? 0 : (apx * abx + apy * aby) / denom
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = ax + abx * t - px
    const cy = ay + aby * t - py
    return cx * cx + cy * cy
  }

  /**
   * Earliest intersection of the moving-point sweep (ax,ay)->(bx,by) with the
   * circle (cx,cy,r). Returns t in [0,1], or -1 for no hit.
   *
   * This is what makes fast balloons hittable. A per-frame point-in-circle test
   * misses anything travelling further than its own diameter in one tick, which
   * at round 80+ is most of the board.
   */
  M.sweepCircle = function (ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay
    const fx = ax - cx, fy = ay - cy
    const a = dx * dx + dy * dy

    // Degenerate sweep: fall back to a containment test.
    if (a < 1e-12) return (fx * fx + fy * fy <= r * r) ? 0 : -1

    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r

    if (c <= 0) return 0   // started already overlapping

    const disc = b * b - 4 * a * c
    if (disc < 0) return -1

    const sq = Math.sqrt(disc)
    const t1 = (-b - sq) / (2 * a)
    if (t1 >= 0 && t1 <= 1) return t1
    const t2 = (-b + sq) / (2 * a)
    if (t2 >= 0 && t2 <= 1) return t2
    return -1
  }

  /** Does segment (ax,ay)-(bx,by) intersect segment (cx,cy)-(dx,dy)? */
  M.segSegHit = function (ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay
    const d2x = dx - cx, d2y = dy - cy
    const denom = d1x * d2y - d1y * d2x
    if (Math.abs(denom) < 1e-12) return false
    const s = ((cx - ax) * d2y - (cy - ay) * d2x) / denom
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom
    return s >= 0 && s <= 1 && u >= 0 && u <= 1
  }

  /** Does segment (ax,ay)-(bx,by) cross the axis-aligned rect? */
  M.segRectHit = function (ax, ay, bx, by, rx, ry, rw, rh) {
    // Trivially inside.
    if (ax >= rx && ax <= rx + rw && ay >= ry && ay <= ry + rh) return true
    if (bx >= rx && bx <= rx + rw && by >= ry && by <= ry + rh) return true
    const x2 = rx + rw, y2 = ry + rh
    return M.segSegHit(ax, ay, bx, by, rx, ry, x2, ry) ||
           M.segSegHit(ax, ay, bx, by, x2, ry, x2, y2) ||
           M.segSegHit(ax, ay, bx, by, x2, y2, rx, y2) ||
           M.segSegHit(ax, ay, bx, by, rx, y2, rx, ry)
  }

  M.circleRectOverlap = function (cx, cy, r, rx, ry, rw, rh) {
    const nx = M.clamp(cx, rx, rx + rw)
    const ny = M.clamp(cy, ry, ry + rh)
    return M.dist2(cx, cy, nx, ny) <= r * r
  }

  /** Even-odd point-in-polygon. poly is a flat [x0,y0,x1,y1,...] array. */
  M.pointInPoly = function (px, py, poly) {
    let inside = false
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1]
      const xj = poly[j], yj = poly[j + 1]
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  /* ---------- easing, for UI and FX only ---------- */

  M.easeOutCubic = function (t) { const u = 1 - t; return 1 - u * u * u }
  M.easeInCubic = function (t) { return t * t * t }
  M.easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t) }
  M.easeOutBack = function (t) {
    const c = 1.70158
    const u = t - 1
    return 1 + (c + 1) * u * u * u + c * u * u
  }
  M.easeOutElastic = function (t) {
    if (t === 0 || t === 1) return t
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (M.TAU / 3)) + 1
  }

  /* ---------- integer hashing, for stable jitter without touching sim.rng ----------
     Render code needs per-entity variation (a sprite's idle wobble phase) that
     must be stable across frames but must never consume sim randomness. */

  M.hash1 = function (n) {
    n = (n ^ 61) ^ (n >>> 16)
    n = n + (n << 3)
    n = n ^ (n >>> 4)
    n = Math.imul(n, 0x27d4eb2d)
    n = n ^ (n >>> 15)
    return (n >>> 0) / 4294967296
  }

  /** Stable pseudo-random in [-1,1] from an integer id and channel. */
  M.jitter = function (id, channel) {
    return M.hash1((id * 73856093) ^ ((channel | 0) * 19349663)) * 2 - 1
  }

  /* ---------- formatting, shared by HUD and bestiary ---------- */

  // Strips trailing zeros *and* a bare trailing dot: "1.50" -> "1.5", "2.00" -> "2".
  function trim (s) { return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, '') }

  M.money = function (n) {
    n = Math.floor(n)
    if (n < 1000) return '$' + n
    if (n < 1e6) return '$' + trim((n / 1000).toFixed(n < 1e4 ? 2 : 1)) + 'k'
    return '$' + trim((n / 1e6).toFixed(2)) + 'm'
  }

  M.compact = function (n) {
    if (n < 1000) return String(Math.floor(n))
    if (n < 1e6) return trim((n / 1000).toFixed(1)) + 'k'
    if (n < 1e9) return trim((n / 1e6).toFixed(2)) + 'm'
    return trim((n / 1e9).toFixed(2)) + 'b'
  }

  M.time = function (seconds) {
    const s = Math.max(0, Math.floor(seconds))
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  OP.M = M
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

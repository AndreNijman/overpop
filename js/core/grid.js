;(function (OP) {
  'use strict'

  const M = OP.M

  /* Uniform spatial hash over live balloons.

     Every tower asks "what is in my range" once per shot, and at round 90 that's
     hundreds of towers against a thousand balloons. A flat scan is 10^6
     distance tests per tick; a 64-unit grid turns it into a handful of buckets.

     Rebuilt from scratch each tick (step 6) rather than maintained
     incrementally. Rebuilding is O(n) and cannot desynchronise; incremental
     maintenance has to be right at every mutation site, including the ones
     added later by content phases, and it silently isn't. */

  const Grid = {}

  const CELL = 64

  Grid.create = function (w, h, cell) {
    cell = cell || CELL
    const cols = Math.ceil((w || OP.FIELD_W) / cell) + 2
    const rows = Math.ceil((h || OP.FIELD_H) / cell) + 2
    const buckets = new Array(cols * rows)
    for (let i = 0; i < buckets.length; i++) buckets[i] = []
    return {
      cell: cell, cols: cols, rows: rows, buckets: buckets,
      // Offset by one cell so entities slightly off-field still land in a bucket
      // rather than being clamped into the edge cells and distorting queries.
      ox: cell, oy: cell,
      count: 0
    }
  }

  Grid.clear = function (g) {
    const b = g.buckets
    for (let i = 0; i < b.length; i++) if (b[i].length) b[i].length = 0
    g.count = 0
  }

  function cellIndex (g, x, y) {
    let cx = Math.floor((x + g.ox) / g.cell)
    let cy = Math.floor((y + g.oy) / g.cell)
    cx = cx < 0 ? 0 : cx >= g.cols ? g.cols - 1 : cx
    cy = cy < 0 ? 0 : cy >= g.rows ? g.rows - 1 : cy
    return cy * g.cols + cx
  }
  Grid.cellIndex = cellIndex

  Grid.insert = function (g, b) {
    g.buckets[cellIndex(g, b.x, b.y)].push(b)
    g.count++
  }

  Grid.rebuild = function (g, list) {
    Grid.clear(g)
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (b.alive) Grid.insert(g, b)
    }
  }

  /**
   * Balloons whose centre is within `r` of (x,y), appended to `out`.
   *
   * `out` is caller-owned so the hot path allocates nothing. Results are sorted
   * by ascending id before returning: bucket iteration order is an
   * implementation detail, and letting it leak into targeting would make the sim
   * depend on grid geometry. Deterministic tie-breaks require a stable order.
   */
  Grid.queryCircle = function (g, x, y, r, out) {
    out.length = 0
    const cell = g.cell
    const minCx = Math.max(0, Math.floor((x - r + g.ox) / cell))
    const maxCx = Math.min(g.cols - 1, Math.floor((x + r + g.ox) / cell))
    const minCy = Math.max(0, Math.floor((y - r + g.oy) / cell))
    const maxCy = Math.min(g.rows - 1, Math.floor((y + r + g.oy) / cell))
    const r2 = r * r

    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * g.cols
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = g.buckets[row + cx]
        for (let i = 0; i < bucket.length; i++) {
          const b = bucket[i]
          if (!b.alive) continue
          const dx = b.x - x, dy = b.y - y
          if (dx * dx + dy * dy <= r2) out.push(b)
        }
      }
    }
    if (out.length > 1) out.sort(byId)
    return out
  }

  /** As queryCircle, but the balloon's own radius counts — for blast damage,
      where a big blimp clipped by the edge of an explosion should be hit. */
  Grid.queryCircleFat = function (g, x, y, r, out) {
    out.length = 0
    const cell = g.cell
    const pad = r + 56   // largest balloon radius, so no blimp is missed
    const minCx = Math.max(0, Math.floor((x - pad + g.ox) / cell))
    const maxCx = Math.min(g.cols - 1, Math.floor((x + pad + g.ox) / cell))
    const minCy = Math.max(0, Math.floor((y - pad + g.oy) / cell))
    const maxCy = Math.min(g.rows - 1, Math.floor((y + pad + g.oy) / cell))

    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * g.cols
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = g.buckets[row + cx]
        for (let i = 0; i < bucket.length; i++) {
          const b = bucket[i]
          if (!b.alive) continue
          const reach = r + OP.BALLOON_TIERS[b.tier].radius
          const dx = b.x - x, dy = b.y - y
          if (dx * dx + dy * dy <= reach * reach) out.push(b)
        }
      }
    }
    if (out.length > 1) out.sort(byId)
    return out
  }

  /** Balloons a swept segment could touch. Used by projectile collision. */
  Grid.querySegment = function (g, ax, ay, bx, by, pad, out) {
    out.length = 0
    const cell = g.cell
    const reach = pad + 56
    const minCx = Math.max(0, Math.floor((Math.min(ax, bx) - reach + g.ox) / cell))
    const maxCx = Math.min(g.cols - 1, Math.floor((Math.max(ax, bx) + reach + g.ox) / cell))
    const minCy = Math.max(0, Math.floor((Math.min(ay, by) - reach + g.oy) / cell))
    const maxCy = Math.min(g.rows - 1, Math.floor((Math.max(ay, by) + reach + g.oy) / cell))

    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * g.cols
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = g.buckets[row + cx]
        for (let i = 0; i < bucket.length; i++) {
          const b = bucket[i]
          if (!b.alive) continue
          out.push(b)
        }
      }
    }
    // A cell can be visited once only, so no dedupe is needed — but a balloon
    // can sit in a cell the segment merely passes near, so callers still run the
    // precise sweep test.
    if (out.length > 1) out.sort(byId)
    return out
  }

  function byId (a, b) { return a.id - b.id }

  /** Diagnostic: worst-case bucket occupancy, for the perf suite. */
  Grid.maxBucket = function (g) {
    let max = 0
    for (let i = 0; i < g.buckets.length; i++) if (g.buckets[i].length > max) max = g.buckets[i].length
    return max
  }

  OP.Grid = Grid
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

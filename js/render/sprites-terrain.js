;(function (OP) {
  'use strict'

  const M = OP.M
  const TAU = M.TAU

  /* ============================================================================
     TERRAIN PAINTER — OP.Terrain.paint(ctx, map, sim)

     Called exactly once per (map, viewport, cleared-set) by
     Render.terrainCache(), which paints into an offscreen canvas and blits the
     result every frame. So this file is allowed to be expensive: gradients,
     texture loops and per-pebble paths are all fine here, and none of it costs
     anything at 500 entities.

     Three rules this file lives by.

     1. IT NEVER READS `sim`. The terrain cache key is
        `map.key + viewport + map.cleared` and nothing else, so anything paint()
        read out of the sim would go stale the moment it changed and would only
        repaint on a resize. `sim` is accepted for signature compatibility and
        deliberately unused. The suite asserts two sims with different cash,
        lives and tick paint byte-identical call sequences.

     2. NO Math.random, EVER. The cache is rebuilt on every resize; a random
        scatter would make the grass jump on window drag. All variation comes
        from OP.M.hash1 seeded off the map key and an index, so a given map paints
        the same way forever.

     3. IT NEVER MUTATES `map`. The palette is resolved into a fresh object —
        `map.palette` is read, never written, never filled in.

     Two structural invariants, load-bearing for the suite. Break either and the
     tests silently get weaker rather than failing:

       · `ctx.translate` is used ONLY by the entry/exit markers. The suite locates
         every marker by reading the recorded translate calls back, and asserts
         there are exactly two per path.
       · The raw palette strings `pal.entry` and `pal.exit` are assigned ONLY
         inside those markers. Everything else that wants a related colour goes
         through shade()/rgba(), which produce a different string. The suite
         counts exact assignments of those two colours to prove every path got
         both markers.

     Defensive about map shape on purpose: the harness fixtures pass bare maps
     like `{ key, paths, blockers: null }` with no trackWidth, no palette and no
     region lists. Every optional field is guarded with Array.isArray (not
     truthiness — `map.blockers` is legitimately `null` in fixtures), and every
     numeric default is a literal, because a NaN lineWidth draws nothing at all
     and never throws.
     ============================================================================ */

  const Terrain = {}

  /* ---------- palette ----------
     A map author may supply none, some or all of these. Whatever is missing must
     still look deliberate, so the defaults are a complete woodland scheme rather
     than placeholders: #0e1410 forest floor, mossy greens for buildable ground,
     warm damp earth for the road. */

  Terrain.DEFAULT_PALETTE = {
    base: '#0e1410',       // the deepest shade; the shell background
    grass: '#31482d',      // buildable ground
    grassAlt: '#3d5837',   // the second green, for mottling and tufts
    path: '#6d5a41',       // the walked road
    pathEdge: '#48381f',   // its trodden-down rim
    water: '#25485c',      // water regions — no land tower may stand here
    rock: '#4d4c45',       // blocked terrain, LOS blockers, removable boulders
    accent: '#c9a227',     // the "you can pay to clear this" ring
    fog: '#0e1410',        // edge vignette and the field frame
    entry: '#d8c06a',      // entry markers ONLY (see invariants above)
    exit: '#b8503c'        // exit markers ONLY
  }

  /** The colours this map will actually be painted with. Never mutates `map`. */
  Terrain.palette = function (map) {
    const out = {}
    const d = Terrain.DEFAULT_PALETTE
    for (const k in d) out[k] = d[k]
    const p = map && map.palette
    if (p && typeof p === 'object') {
      for (const k in p) if (typeof p[k] === 'string' && p[k]) out[k] = p[k]
    }
    return out
  }

  /* ---------- colour maths ----------
     Palettes are only validated as strings, so anything unparseable has to fall
     through to the raw colour rather than producing "#NaNNaNNaN". */

  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

  function parseHex (c) {
    if (typeof c !== 'string') return null
    let s = c.trim()
    if (!HEX.test(s)) return null
    if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
    const n = parseInt(s.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

  function hex2 (v) {
    const s = Math.round(M.clamp(v, 0, 255)).toString(16)
    return s.length < 2 ? '0' + s : s
  }

  /** Lighten (amt > 0) or darken (amt < 0) toward white/black. Unparseable in, same out. */
  function shade (c, amt) {
    const p = parseHex(c)
    if (!p) return c
    const target = amt < 0 ? 0 : 255
    const k = M.clamp01(Math.abs(amt))
    return '#' + hex2(M.lerp(p.r, target, k)) + hex2(M.lerp(p.g, target, k)) + hex2(M.lerp(p.b, target, k))
  }

  /** Blend two colours. Falls back to `a` if either is unparseable. */
  function mix (a, b, k) {
    const pa = parseHex(a), pb = parseHex(b)
    if (!pa || !pb) return a
    return '#' + hex2(M.lerp(pa.r, pb.r, k)) + hex2(M.lerp(pa.g, pb.g, k)) + hex2(M.lerp(pa.b, pb.b, k))
  }

  function rgba (c, a) {
    const p = parseHex(c)
    if (!p) return 'rgba(14, 20, 16, ' + a + ')'
    return 'rgba(' + p.r + ', ' + p.g + ', ' + p.b + ', ' + a + ')'
  }

  /* ---------- deterministic scatter ----------
     hash1 only, seeded off the map key. Never sim.rng (this is render code and
     must not consume simulation randomness) and never Math.random (the cache is
     rebuilt on resize and the grass would move). */

  function strHash (s) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h | 0
  }

  /** Stable [0,1) from a seed, an index and a channel. */
  function rnd (seed, i, channel) {
    return M.hash1((Math.imul(seed, 0x27d4eb2d) ^ Math.imul(i | 0, 0x9e3779b1) ^
      Math.imul(channel | 0, 0x85ebca6b)) | 0)
  }

  /** Stable [-1,1). */
  function srnd (seed, i, channel) { return rnd(seed, i, channel) * 2 - 1 }

  /* ---------- geometry helpers ---------- */

  function regionIsCircle (r) {
    return r.kind === 'circle' || (r.r !== undefined && r.cx !== undefined)
  }

  function inRegion (r, x, y) {
    if (!r) return false
    if (regionIsCircle(r)) return M.dist2(x, y, r.cx, r.cy) <= r.r * r.r
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  }

  function inAny (list, x, y) {
    if (!Array.isArray(list)) return false
    for (let i = 0; i < list.length; i++) if (inRegion(list[i], x, y)) return true
    return false
  }

  function list (v) { return Array.isArray(v) ? v : [] }

  /** Cleared obstacles are read from map.cleared — an array of integer indices. */
  function isCleared (map, i) {
    return Array.isArray(map.cleared) && map.cleared.indexOf(i) >= 0
  }

  function usablePaths (map) {
    const out = []
    const paths = list(map && map.paths)
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]
      if (p && typeof p.posAt === 'function' && p.length > 0) out.push(p)
    }
    return out
  }

  function distToPath (paths, x, y) {
    let best = Infinity
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]
      if (typeof p.distanceTo !== 'function') continue
      const d = p.distanceTo(x, y)
      if (d < best) best = d
    }
    return best
  }

  /**
   * Half-width of the painted road. `trackWidth` is authored from the centreline
   * and is documented to cover the road PLUS a typical tower radius (~14), so the
   * visible road is narrower than the unbuildable margin — which is exactly the
   * affordance the player needs: the paint shows where the road is, the margin
   * around it is the bit they cannot build on.
   */
  function roadHalf (map) {
    const tw = map && typeof map.trackWidth === 'number' && isFinite(map.trackWidth) && map.trackWidth > 0
      ? map.trackWidth
      : 26
    return M.clamp(tw - 14, 8, tw * 0.85)
  }

  function polyline (ctx, pts) {
    if (!pts.length) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  }

  /** Parallel polyline `d` units to the left of `pts`, for wheel ruts. */
  function offsetPoints (pts, d) {
    const out = []
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i === 0 ? 0 : i - 1]
      const b = pts[i === n - 1 ? i : i + 1]
      let dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (!(len > 1e-9)) { out.push({ x: pts[i].x, y: pts[i].y }); continue }
      dx /= len; dy /= len
      out.push({ x: pts[i].x - dy * d, y: pts[i].y + dx * d })
    }
    return out
  }

  /* ============================================================================
     THE PAINT
     ============================================================================ */

  /**
   * Paint the whole static map. Draw order is fixed and is the reading order the
   * player needs: ground, then water, then the road on top of both, then the
   * things standing on the ground, then the markers that say which way the
   * balloons run.
   *
   * @param {CanvasRenderingContext2D} ctx  already scaled to logical units
   * @param {object} map                    a BUILT map (see js/core/maps.js)
   * @param {object} [sim]                  accepted and deliberately never read
   */
  Terrain.paint = function (ctx, map, sim) {
    if (!ctx || !map) return

    const pal = Terrain.palette(map)
    const seed = strHash(String((map && map.key) || 'overpop'))
    const paths = usablePaths(map)

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    paintGround(ctx, map, pal, seed, paths)
    paintWater(ctx, map, pal, seed)
    paintPaths(ctx, map, pal, seed, paths)
    paintBlocked(ctx, map, pal, seed)
    paintBlockers(ctx, map, pal, seed)
    paintObstacles(ctx, map, pal, seed)
    paintMarkers(ctx, map, pal, paths)

    ctx.restore()
  }

  /* ---------- 1. ground ----------
     Buildable ground has to be unmistakably not-road and not-water at a glance,
     because that distinction is the placement rule. It gets: a warm-dark base, a
     mossy diagonal gradient, broad soft mottling, then a dense tuft-and-pebble
     texture that neither the road nor the water has. */

  function paintGround (ctx, map, pal, seed, paths) {
    const W = OP.FIELD_W, H = OP.FIELD_H

    ctx.save()

    // The floor everything else sits on.
    ctx.fillStyle = pal.base
    ctx.fillRect(0, 0, W, H)

    // Moss, lit from the top-left.
    const g = ctx.createLinearGradient(0, 0, W * 0.75, H)
    g.addColorStop(0, pal.grassAlt)
    g.addColorStop(0.45, pal.grass)
    g.addColorStop(1, shade(pal.grass, -0.22))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Broad clearings and shade patches. Soft, low contrast, deliberately large:
    // this is what stops a flat fill reading as a colour swatch.
    const light = rgba(shade(pal.grassAlt, 0.18), 0.14)
    const dark = rgba(shade(pal.grass, -0.4), 0.16)
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? light : dark
      ctx.beginPath()
      for (let i = 0; i < 22; i++) {
        const k = pass * 100 + i
        const x = rnd(seed, k, 11) * W
        const y = rnd(seed, k, 12) * H
        const rx = 60 + rnd(seed, k, 13) * 150
        const ry = rx * (0.4 + rnd(seed, k, 14) * 0.5)
        blob(ctx, x, y, rx, ry, srnd(seed, k, 15) * Math.PI)
      }
      ctx.fill()
    }

    groundTexture(ctx, map, pal, seed, paths)

    // Edge vignette: the field is a clearing in a wood, so it darkens outward.
    const v = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.28, W * 0.5, H * 0.5, H * 0.95)
    v.addColorStop(0, rgba(pal.fog, 0))
    v.addColorStop(0.65, rgba(pal.fog, 0.22))
    v.addColorStop(1, rgba(pal.fog, 0.72))
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)

    // A hard frame, so the play field has an edge rather than fading to nothing.
    ctx.strokeStyle = pal.fog
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, W - 4, H - 4)

    ctx.restore()
  }

  /**
   * Grass tufts and pebbles on a jittered grid, batched into one path per shade
   * so a few hundred tufts cost a handful of fill/stroke calls.
   *
   * Anything that lands on the road or in water is skipped: those layers paint
   * over it anyway, and skipping keeps the texture a property of BUILDABLE ground
   * specifically. The skip test reads trackWidth and water only — never `cleared`
   * — so clearing an obstacle can never shift a single tuft, which is what lets
   * the suite compare neighbourhood draw counts across two cleared-sets.
   */
  function groundTexture (ctx, map, pal, seed, paths) {
    const W = OP.FIELD_W, H = OP.FIELD_H
    const step = 36
    const margin = roadHalf(map) + 6
    const water = list(map.water)

    const tufts = [[], [], []]
    const pebbles = []
    const twigs = []

    let i = 0
    for (let gy = step * 0.5; gy < H; gy += step) {
      for (let gx = step * 0.5; gx < W; gx += step) {
        i++
        const x = gx + srnd(seed, i, 1) * step * 0.45
        const y = gy + srnd(seed, i, 2) * step * 0.45
        if (paths.length && distToPath(paths, x, y) < margin) continue
        if (inAny(water, x, y)) continue

        const roll = rnd(seed, i, 3)
        if (roll < 0.62) {
          tufts[(i + ((rnd(seed, i, 4) * 3) | 0)) % 3].push({
            x: x, y: y,
            h: 4 + rnd(seed, i, 5) * 7,
            lean: srnd(seed, i, 6) * 4
          })
        } else if (roll < 0.86) {
          pebbles.push({
            x: x, y: y,
            r: 1.4 + rnd(seed, i, 7) * 2.6,
            rot: srnd(seed, i, 8) * Math.PI
          })
        } else {
          twigs.push({
            x: x, y: y,
            dx: srnd(seed, i, 9) * 9,
            dy: srnd(seed, i, 10) * 5
          })
        }
      }
    }

    // Three shades of tuft, from shadowed to sunlit.
    const tuftColours = [
      rgba(shade(pal.grass, -0.35), 0.55),
      rgba(pal.grassAlt, 0.7),
      rgba(shade(pal.grassAlt, 0.28), 0.5)
    ]
    ctx.lineWidth = 1.2
    for (let s = 0; s < 3; s++) {
      const batch = tufts[s]
      if (!batch.length) continue
      ctx.strokeStyle = tuftColours[s]
      ctx.beginPath()
      for (let k = 0; k < batch.length; k++) {
        const b = batch[k]
        for (let blade = -1; blade <= 1; blade++) {
          const bx = b.x + blade * 2.1
          ctx.moveTo(bx, b.y)
          ctx.quadraticCurveTo(bx + b.lean * 0.4 + blade, b.y - b.h * 0.65,
            bx + b.lean + blade * 1.6, b.y - b.h)
        }
      }
      ctx.stroke()
    }

    if (pebbles.length) {
      ctx.fillStyle = rgba(shade(pal.rock, -0.1), 0.42)
      ctx.beginPath()
      for (let k = 0; k < pebbles.length; k++) {
        const p = pebbles[k]
        blob(ctx, p.x, p.y, p.r, p.r * 0.62, p.rot)
      }
      ctx.fill()
    }

    if (twigs.length) {
      ctx.strokeStyle = rgba(shade(pal.pathEdge, 0.1), 0.4)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let k = 0; k < twigs.length; k++) {
        const w = twigs[k]
        ctx.moveTo(w.x, w.y)
        ctx.lineTo(w.x + w.dx, w.y + w.dy)
      }
      ctx.stroke()
    }
  }

  /* ---------- 2. water ----------
     Water is a placement rule: only `placement: 'water'` towers may stand here.
     So it gets a shoreline, a distinct hue and a flat sheen that reads as
     "surface", not "ground". */

  function paintWater (ctx, map, pal, seed) {
    const regions = list(map.water)
    if (!regions.length) return

    ctx.save()
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      const circle = regionIsCircle(r)
      const cx = circle ? r.cx : r.x + r.w * 0.5
      const cy = circle ? r.cy : r.y + r.h * 0.5
      const rx = circle ? r.r : r.w * 0.5
      const ry = circle ? r.r : r.h * 0.5

      // Damp shore: the ground gets darker and muddier where it meets water.
      ctx.strokeStyle = rgba(shade(pal.grass, -0.55), 0.75)
      ctx.lineWidth = 7
      shapePath(ctx, r, 3)
      ctx.stroke()

      // The body, deep at the far edge and lighter toward the near shore.
      const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry)
      g.addColorStop(0, shade(pal.water, -0.35))
      g.addColorStop(0.55, pal.water)
      g.addColorStop(1, shade(pal.water, -0.18))
      ctx.fillStyle = g
      shapePath(ctx, r, 0)
      ctx.fill()

      // Inner rim, so the surface sits *below* the ground rather than on it.
      ctx.strokeStyle = rgba(shade(pal.water, -0.5), 0.9)
      ctx.lineWidth = 2.5
      shapePath(ctx, r, -1.5)
      ctx.stroke()

      // Ripples. Long, flat, horizontal — the read that says "water".
      ctx.strokeStyle = rgba(shade(pal.water, 0.5), 0.3)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      const rings = 5 + ((rnd(seed, i, 21) * 4) | 0)
      for (let k = 0; k < rings; k++) {
        const j = i * 37 + k
        const px = cx + srnd(seed, j, 22) * rx * 0.62
        const py = cy + srnd(seed, j, 23) * ry * 0.7
        const w = 8 + rnd(seed, j, 24) * Math.max(10, rx * 0.5)
        ctx.moveTo(px - w, py)
        ctx.quadraticCurveTo(px, py - 2.4, px + w, py)
      }
      ctx.stroke()

      // A single soft glint, top-left, so the surface has a light source.
      const gl = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, 1,
        cx - rx * 0.35, cy - ry * 0.4, Math.max(12, rx * 0.7))
      gl.addColorStop(0, rgba(shade(pal.water, 0.65), 0.22))
      gl.addColorStop(1, rgba(pal.water, 0))
      ctx.fillStyle = gl
      shapePath(ctx, r, 0)
      ctx.fill()
    }
    ctx.restore()
  }

  /** Path for a region, optionally grown by `grow` units. Rect or circle. */
  /**
   * Add ONE ellipse as its own subpath, ready to be batched into a single fill.
   *
   * The `moveTo` is the whole point and is not optional. `ctx.ellipse()` and
   * `ctx.arc()` draw a line from the current point to where the curve starts, so a
   * loop of them with no `moveTo` between is not N separate blobs — it is one
   * connected zig-zag, and filling it fills everything that zig-zag encloses.
   *
   * That bug painted a translucent grey slab across the middle of every map: the
   * pebbles scattered along the road were being filled as a single polygon that
   * followed the track and closed across its two ends. It read as a "black net"
   * over the board. Batching is still worth it — a few hundred blobs in a handful
   * of fills — but only through here.
   */
  function blob (ctx, x, y, rx, ry, rot) {
    rot = rot || 0
    ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx)
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU)
  }

  function shapePath (ctx, r, grow) {
    ctx.beginPath()
    if (regionIsCircle(r)) {
      ctx.arc(r.cx, r.cy, Math.max(0.5, r.r + grow), 0, TAU)
    } else {
      ctx.rect(r.x - grow, r.y - grow, r.w + grow * 2, r.h + grow * 2)
    }
  }

  /* ---------- 3. the path ----------
     The single most important thing on the screen. It must read as a walked track
     at a glance and be impossible to confuse with buildable ground: warm earth
     against cold moss, a trodden rim, two ruts down the middle and loose stones. */

  function paintPaths (ctx, map, pal, seed, paths) {
    if (!paths.length) return

    const half = roadHalf(map)
    const w = half * 2

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let i = 0; i < paths.length; i++) {
      const track = paths[i]
      const pts = typeof track.sample === 'function'
        ? track.sample(9)
        : track.points || []
      if (pts.length < 2) continue

      // Sunk into the ground: a soft dark spread under the whole road.
      polyline(ctx, pts)
      ctx.strokeStyle = rgba(pal.base, 0.5)
      ctx.lineWidth = w + 13
      ctx.stroke()

      // Trodden rim — the ring of packed dirt either side of the walking line.
      polyline(ctx, pts)
      ctx.strokeStyle = pal.pathEdge
      ctx.lineWidth = w + 5
      ctx.stroke()

      // The road surface.
      polyline(ctx, pts)
      ctx.strokeStyle = pal.path
      ctx.lineWidth = w
      ctx.stroke()

      // Worn centre, walked pale by everything that has come through.
      polyline(ctx, pts)
      ctx.strokeStyle = rgba(shade(pal.path, 0.2), 0.75)
      ctx.lineWidth = Math.max(2, w * 0.5)
      ctx.stroke()

      // Two ruts. These are what make it read as *walked* rather than painted.
      ctx.strokeStyle = rgba(shade(pal.path, -0.4), 0.5)
      ctx.lineWidth = Math.max(1.2, w * 0.06)
      polyline(ctx, offsetPoints(pts, half * 0.42))
      ctx.stroke()
      polyline(ctx, offsetPoints(pts, -half * 0.42))
      ctx.stroke()

      pathDetail(ctx, track, pal, seed, i, half)
    }
    ctx.restore()
  }

  /** Loose stones and dry scuffs scattered along one track, batched by colour. */
  function pathDetail (ctx, track, pal, seed, pathIndex, half) {
    const len = track.length
    if (!(len > 0)) return
    const step = 24
    const stones = []
    const scuffs = []

    let k = 0
    for (let t = step * 0.5; t < len; t += step) {
      k++
      const j = pathIndex * 9173 + k
      const p = track.posAt(t)
      const a = typeof track.angleAt === 'function' ? track.angleAt(t) : 0
      const nx = -Math.sin(a), ny = Math.cos(a)
      const off = srnd(seed, j, 31) * half * 0.8
      const x = p.x + nx * off
      const y = p.y + ny * off
      if (rnd(seed, j, 32) < 0.55) {
        stones.push({ x: x, y: y, r: 1.2 + rnd(seed, j, 33) * 2.4, rot: a })
      } else {
        scuffs.push({ x: x, y: y, dx: Math.cos(a) * (3 + rnd(seed, j, 34) * 6), dy: Math.sin(a) * (3 + rnd(seed, j, 34) * 6) })
      }
    }

    if (stones.length) {
      ctx.fillStyle = rgba(shade(pal.rock, 0.12), 0.5)
      ctx.beginPath()
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i]
        blob(ctx, s.x, s.y, s.r, s.r * 0.7, s.rot)
      }
      ctx.fill()
      ctx.fillStyle = rgba(pal.base, 0.35)
      ctx.beginPath()
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i]
        blob(ctx, s.x + 0.7, s.y + 0.9, s.r * 0.8, s.r * 0.55, s.rot)
      }
      ctx.fill()
    }

    if (scuffs.length) {
      ctx.strokeStyle = rgba(shade(pal.pathEdge, -0.15), 0.45)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let i = 0; i < scuffs.length; i++) {
        const s = scuffs[i]
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(s.x + s.dx, s.y + s.dy)
      }
      ctx.stroke()
    }
  }

  /* ---------- 4. blocked terrain ----------
     Nothing may ever be built here, and it does NOT block line of sight, so it
     reads as flat scree rather than as a wall: hatched rubble, no height. */

  function paintBlocked (ctx, map, pal, seed) {
    const regions = list(map.blocked)
    if (!regions.length) return

    ctx.save()
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      const circle = regionIsCircle(r)
      const x0 = circle ? r.cx - r.r : r.x
      const y0 = circle ? r.cy - r.r : r.y
      const x1 = circle ? r.cx + r.r : r.x + r.w
      const y1 = circle ? r.cy + r.r : r.y + r.h

      const g = ctx.createLinearGradient(x0, y0, x0, y1)
      g.addColorStop(0, shade(pal.rock, 0.1))
      g.addColorStop(0.45, pal.rock)
      g.addColorStop(1, shade(pal.rock, -0.4))
      ctx.fillStyle = g
      shapePath(ctx, r, 0)
      ctx.fill()

      // Diagonal hatch, clipped to the region: reads "impassable" without
      // pretending to have height.
      ctx.save()
      shapePath(ctx, r, 0)
      ctx.clip()
      ctx.strokeStyle = rgba(pal.base, 0.4)
      ctx.lineWidth = 2
      ctx.beginPath()
      const span = (x1 - x0) + (y1 - y0)
      for (let d = 0; d <= span; d += 9) {
        ctx.moveTo(x0 + d, y0)
        ctx.lineTo(x0 + d - (y1 - y0), y1)
      }
      ctx.stroke()

      // A scatter of loose chunks inside.
      ctx.fillStyle = rgba(shade(pal.rock, 0.3), 0.45)
      ctx.beginPath()
      for (let k = 0; k < 10; k++) {
        const j = i * 61 + k
        const px = M.lerp(x0, x1, rnd(seed, j, 41))
        const py = M.lerp(y0, y1, rnd(seed, j, 42))
        const pr = 2 + rnd(seed, j, 43) * 5
        blob(ctx, px, py, pr, pr * 0.65, srnd(seed, j, 44) * Math.PI)
      }
      ctx.fill()
      ctx.restore()

      ctx.strokeStyle = rgba(shade(pal.rock, -0.55), 0.85)
      ctx.lineWidth = 2
      shapePath(ctx, r, -1)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ---------- 5. line-of-sight blockers ----------
     These stop shots, so they must look SOLID and TALL — a player who cannot see
     why a tower is not firing will call it a bug. Faked height: a cast shadow, a
     lit cap offset upward, and a dark face below it.

     Reads map.blockers (the LIVE list, already filtered by `cleared`) and skips
     any entry carrying `obstacle`, because those belong to a removable obstacle
     and are drawn as that boulder in the next stage. map.blockersAll is
     deliberately NOT used: it still contains blockers for cleared obstacles. */

  function paintBlockers (ctx, map, pal, seed) {
    const all = list(map.blockers)
    if (!all.length) return

    ctx.save()
    for (let i = 0; i < all.length; i++) {
      const b = all[i]
      if (!b || b.obstacle !== undefined) continue
      if (!(b.w > 0) || !(b.h > 0)) continue

      const lift = M.clamp(b.h * 0.34 + 8, 10, 34)

      // Cast shadow, down and to the right of the light.
      ctx.fillStyle = rgba(pal.base, 0.5)
      ctx.beginPath()
      ctx.ellipse(b.x + b.w * 0.5 + 5, b.y + b.h + 2, b.w * 0.58, Math.max(4, b.h * 0.18), 0, 0, TAU)
      ctx.fill()

      // The dark face.
      const face = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h)
      face.addColorStop(0, shade(pal.rock, -0.28))
      face.addColorStop(0.4, pal.rock)
      face.addColorStop(1, shade(pal.rock, -0.62))
      ctx.fillStyle = face
      ctx.fillRect(b.x, b.y, b.w, b.h)

      // The lit cap, sitting proud of the face — this is the whole illusion.
      const cap = ctx.createLinearGradient(b.x, b.y - lift, b.x + b.w, b.y)
      cap.addColorStop(0, shade(pal.rock, 0.34))
      cap.addColorStop(1, mix(pal.rock, pal.grass, 0.28))
      ctx.fillStyle = cap
      ctx.fillRect(b.x - 2, b.y - lift, b.w + 4, lift + 2)

      // Cap rim and the crease where cap meets face.
      ctx.strokeStyle = rgba(shade(pal.rock, 0.55), 0.55)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(b.x - 2, b.y - lift + 1)
      ctx.lineTo(b.x + b.w + 2, b.y - lift + 1)
      ctx.stroke()

      ctx.strokeStyle = rgba(pal.base, 0.6)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x + b.w, b.y)
      ctx.stroke()

      // Cracks down the face, so a tall rock is not a flat rectangle.
      ctx.strokeStyle = rgba(pal.base, 0.4)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let k = 0; k < 4; k++) {
        const j = i * 53 + k
        const cxk = b.x + M.lerp(0.12, 0.88, rnd(seed, j, 51)) * b.w
        const top = b.y + rnd(seed, j, 52) * b.h * 0.3
        const bot = top + b.h * (0.3 + rnd(seed, j, 53) * 0.5)
        ctx.moveTo(cxk, top)
        ctx.lineTo(cxk + srnd(seed, j, 54) * 3, (top + bot) * 0.5)
        ctx.lineTo(cxk + srnd(seed, j, 55) * 4, Math.min(bot, b.y + b.h))
      }
      ctx.stroke()

      // Moss on the cap, because this is a wood and not a quarry.
      ctx.fillStyle = rgba(pal.grassAlt, 0.5)
      ctx.beginPath()
      for (let k = 0; k < 5; k++) {
        const j = i * 71 + k
        const px = b.x + M.lerp(0.05, 0.95, rnd(seed, j, 56)) * b.w
        const py = b.y - lift + rnd(seed, j, 57) * lift * 0.8
        const pr = 1.8 + rnd(seed, j, 58) * 3.4
        blob(ctx, px, py, pr, pr * 0.6, 0)
      }
      ctx.fill()

      ctx.strokeStyle = rgba(shade(pal.rock, -0.7), 0.8)
      ctx.lineWidth = 1.5
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }

  /* ---------- 6. removable obstacles ----------
     Boulders the player can pay to clear. A CLEARED obstacle is not drawn at all
     — `map.cleared` is the authority, and the terrain cache key includes it, so
     clearing repaints. The dashed accent ring is the affordance that says this
     one can be bought away. */

  function paintObstacles (ctx, map, pal, seed) {
    const obstacles = list(map.removable)
    if (!obstacles.length) return

    ctx.save()
    for (let i = 0; i < obstacles.length; i++) {
      if (isCleared(map, i)) continue
      const o = obstacles[i]
      if (!o || !(o.r > 0)) continue

      const x = o.x, y = o.y, r = o.r

      // Contact shadow.
      ctx.fillStyle = rgba(pal.base, 0.5)
      ctx.beginPath()
      ctx.ellipse(x + 3, y + r * 0.55, r * 0.95, r * 0.4, 0, 0, TAU)
      ctx.fill()

      // Body, lit from the top-left.
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r)
      g.addColorStop(0, shade(pal.rock, 0.42))
      g.addColorStop(0.6, pal.rock)
      g.addColorStop(1, shade(pal.rock, -0.55))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()

      // Highlight along the lit shoulder.
      ctx.strokeStyle = rgba(shade(pal.rock, 0.6), 0.5)
      ctx.lineWidth = Math.max(1.5, r * 0.12)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.78, Math.PI * 1.05, Math.PI * 1.75)
      ctx.stroke()

      // Fissures.
      ctx.strokeStyle = rgba(pal.base, 0.45)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let k = 0; k < 3; k++) {
        const j = i * 83 + k
        const a0 = srnd(seed, j, 61) * Math.PI
        ctx.moveTo(x + Math.cos(a0) * r * 0.15, y + Math.sin(a0) * r * 0.15)
        ctx.lineTo(x + Math.cos(a0 + 0.3) * r * 0.6, y + Math.sin(a0 + 0.3) * r * 0.6)
        ctx.lineTo(x + Math.cos(a0 + 0.1) * r * 0.92, y + Math.sin(a0 + 0.1) * r * 0.92)
      }
      ctx.stroke()

      // Moss on the shaded side.
      ctx.fillStyle = rgba(pal.grassAlt, 0.6)
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const j = i * 97 + k
        const a0 = M.lerp(0.15, 1.5, rnd(seed, j, 62)) * Math.PI
        const rr = r * (0.35 + rnd(seed, j, 63) * 0.55)
        const pr = 1.6 + rnd(seed, j, 64) * 3.2
        blob(ctx, x + Math.cos(a0) * rr, y + Math.sin(a0) * rr, pr, pr * 0.65, 0)
      }
      ctx.fill()

      ctx.strokeStyle = rgba(shade(pal.rock, -0.7), 0.85)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.stroke()

      // "You can buy this out of the way" — a dashed accent ring, the only place
      // the accent colour is used on the terrain.
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = pal.accent
      ctx.lineWidth = 1.6
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.arc(x, y, r + 4.5, 0, TAU)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])
    }
    ctx.restore()
  }

  /* ---------- 7. entry and exit markers ----------
     Every path gets both, so the player can always see which way the balloons
     come from and where they will leak. Entry is a warm gold ring with chevrons
     pointing INTO the field; exit is a dark barred arch in alarm red. Different
     shape and different colour — colour alone is not enough.

     INVARIANT: this is the only stage that calls ctx.translate, and the only one
     that assigns the raw `pal.entry` / `pal.exit` strings. Both facts are how the
     suite proves every path got a marker of each kind. */

  function paintMarkers (ctx, map, pal, paths) {
    if (!paths.length) return
    const r = M.clamp(roadHalf(map) * 0.95, 11, 26)

    for (let i = 0; i < paths.length; i++) {
      const track = paths[i]
      const a = track.posAt(0)
      const b = track.posAt(track.length)
      const angA = typeof track.angleAt === 'function' ? track.angleAt(0) : 0
      const angB = typeof track.angleAt === 'function' ? track.angleAt(track.length) : 0
      drawEntry(ctx, pal, a.x, a.y, angA, r)
      drawExit(ctx, pal, b.x, b.y, angB, r)
    }
  }

  function drawEntry (ctx, pal, x, y, ang, r) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)

    // Dark socket, so the marker reads on both road and grass.
    ctx.fillStyle = rgba(pal.base, 0.6)
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.18, 0, TAU)
    ctx.fill()

    // The ring.
    ctx.strokeStyle = pal.entry
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.stroke()

    ctx.strokeStyle = rgba(pal.entry, 0.35)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.62, 0, TAU)
    ctx.stroke()

    // A solid arrowhead in the middle, pointing the way the balloons walk.
    ctx.fillStyle = pal.entry
    ctx.beginPath()
    ctx.moveTo(-r * 0.3, -r * 0.42)
    ctx.lineTo(r * 0.42, 0)
    ctx.lineTo(-r * 0.3, r * 0.42)
    ctx.closePath()
    ctx.fill()

    // Chevrons marching inward, fading.
    ctx.strokeStyle = pal.entry
    ctx.lineWidth = 2.2
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.75 - k * 0.2
      const ox = r * 1.35 + k * 7
      ctx.beginPath()
      ctx.moveTo(ox - 5, -6)
      ctx.lineTo(ox, 0)
      ctx.lineTo(ox - 5, 6)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  function drawExit (ctx, pal, x, y, ang, r) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)

    // A mouth cut into the ground: dark half-disc opening forward.
    ctx.fillStyle = rgba(pal.base, 0.8)
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.15, -Math.PI * 0.5, Math.PI * 0.5)
    ctx.lineTo(-r * 0.35, r * 1.15)
    ctx.lineTo(-r * 0.35, -r * 1.15)
    ctx.closePath()
    ctx.fill()

    // The arch.
    ctx.strokeStyle = pal.exit
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.05, -Math.PI * 0.5, Math.PI * 0.5)
    ctx.stroke()

    // Bars across it — visually nothing like the entry ring.
    ctx.strokeStyle = pal.exit
    ctx.lineWidth = 2.4
    ctx.beginPath()
    for (let k = 0; k < 3; k++) {
      const bx = -r * 0.1 + k * (r * 0.5)
      const hh = r * Math.sqrt(Math.max(0.06, 1 - (bx / (r * 1.05)) * (bx / (r * 1.05)))) * 0.92
      ctx.moveTo(bx, -hh)
      ctx.lineTo(bx, hh)
    }
    ctx.stroke()

    // Outward chevrons: this is where they leave.
    ctx.strokeStyle = rgba(pal.exit, 0.6)
    ctx.lineWidth = 2
    for (let k = 0; k < 2; k++) {
      const ox = r * 1.5 + k * 7
      ctx.beginPath()
      ctx.moveTo(ox - 5, -6)
      ctx.lineTo(ox, 0)
      ctx.lineTo(ox - 5, 6)
      ctx.stroke()
    }
    ctx.restore()
  }

  OP.Terrain = Terrain
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

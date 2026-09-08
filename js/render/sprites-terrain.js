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
     still look deliberate. These are presentation colours, not map data: sunny
     meadow greens, sandy roads and clear blue water. */

  Terrain.DEFAULT_PALETTE = {
    base: '#365b36',       // contact shadows
    grass: '#75bd43',      // buildable ground
    grassAlt: '#98d65a',   // sunlit lawn and leaf tips
    path: '#e6c18a',       // the walked road
    pathEdge: '#aa7848',   // packed earth beneath the sandy surface
    water: '#2bb8d5',      // water regions — no land tower may stand here
    rock: '#a6ac9b',       // blocked terrain, LOS blockers, removable boulders
    accent: '#c9a227',     // the "you can pay to clear this" ring
    fog: '#48713b',        // a light touch of shade at the field edge
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
    // Lift the shipped dark biome hints without flattening their hue differences.
    // Semantic marker/accent colours and non-hex CSS colours remain author-owned.
    const materials = {
      base: [0.27, 0.3], grass: [0.5, 0.52], grassAlt: [0.6, 0.56],
      path: [0.71, 0.56], pathEdge: [0.46, 0.42], water: [0.5, 0.68],
      rock: [0.61, 0.14], fog: [0.34, 0.3]
    }
    for (const k in materials) {
      if (!p || !p[k]) continue
      let c = parseHex(out[k])
      if (!c) continue
      const floor = materials[k][0]
      let hi = Math.max(c.r, c.g, c.b) / 255
      let lo = Math.min(c.r, c.g, c.b) / 255
      if ((hi + lo) * 0.5 >= floor) continue
      // Roads stay recognisably sand, even in cool slate or purple biomes.
      if (k === 'path' || k === 'pathEdge') {
        c = parseHex(mix(out[k], d[k], 0.55))
        hi = Math.max(c.r, c.g, c.b) / 255
        lo = Math.min(c.r, c.g, c.b) / 255
      }
      const delta = hi - lo
      const sat = Math.max(materials[k][1], delta / Math.max(0.001, 1 - Math.abs(hi + lo - 1)))
      const span = (1 - Math.abs(2 * floor - 1)) * Math.min(sat, 0.78)
      const low = floor - span * 0.5
      const channel = v => 255 * (low + (delta > 0.001 ? (v / 255 - lo) / delta : 0.5) * span)
      out[k] = '#' + hex2(channel(c.r)) + hex2(channel(c.g)) + hex2(channel(c.b))
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
     because that distinction is the placement rule. Broad sunlit lawns and sparse
     low groundcover leave quiet space for towers and projectiles. */

  function paintGround (ctx, map, pal, seed, paths) {
    const W = OP.FIELD_W, H = OP.FIELD_H

    ctx.save()

    // The floor everything else sits on.
    ctx.fillStyle = pal.base
    ctx.fillRect(0, 0, W, H)

    // A broad, consistent top-left light, shared by every terrain material.
    const g = ctx.createLinearGradient(0, 0, W * 0.75, H)
    g.addColorStop(0, pal.grassAlt)
    g.addColorStop(0.45, pal.grass)
    g.addColorStop(1, shade(pal.grass, -0.06))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Broad clearings and shade patches. Soft, low contrast, deliberately large:
    // this is what stops a flat fill reading as a colour swatch.
    const light = rgba(shade(pal.grassAlt, 0.18), 0.16)
    const dark = rgba(shade(pal.grass, -0.22), 0.1)
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? light : dark
      ctx.beginPath()
      for (let i = 0; i < 12; i++) {
        const k = pass * 100 + i
        const x = rnd(seed, k, 11) * W
        const y = rnd(seed, k, 12) * H
        const rx = 60 + rnd(seed, k, 13) * 150
        const ry = rx * (0.4 + rnd(seed, k, 14) * 0.5)
        // Overlapping lobes form broad, scalloped lawn patches, not fine noise.
        blob(ctx, x, y, rx, ry, 0)
        blob(ctx, x - rx * 0.55, y + ry * 0.15, rx * 0.65, ry * 0.85, 0)
        blob(ctx, x + rx * 0.5, y - ry * 0.1, rx * 0.7, ry * 0.8, 0)
      }
      ctx.fill()
    }

    groundTexture(ctx, map, pal, seed, paths)

    // Frame the board without burying the outer lanes in a dark vignette.
    const v = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.28, W * 0.5, H * 0.5, H * 0.95)
    v.addColorStop(0, rgba(pal.fog, 0))
    v.addColorStop(0.65, rgba(pal.fog, 0.025))
    v.addColorStop(1, rgba(pal.fog, 0.14))
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
    const step = 54
    const margin = roadHalf(map) + 14
    const water = list(map.water)

    const tufts = [[], [], []]
    const pebbles = []
    const clover = []

    let i = 0
    for (let gy = step * 0.5; gy < H; gy += step) {
      for (let gx = step * 0.5; gx < W; gx += step) {
        i++
        const x = gx + srnd(seed, i, 1) * step * 0.45
        const y = gy + srnd(seed, i, 2) * step * 0.45
        if (paths.length && distToPath(paths, x, y) < margin) continue
        if (water.some(r => inRegion(r, x, y) ||
          (regionIsCircle(r) ? M.dist2(x, y, r.cx, r.cy) < (r.r + 12) * (r.r + 12) :
            x > r.x - 12 && x < r.x + r.w + 12 && y > r.y - 12 && y < r.y + r.h + 12))) continue

        const roll = rnd(seed, i, 3)
        if (roll < 0.65) {
          tufts[(i + ((rnd(seed, i, 4) * 3) | 0)) % 3].push({
            x: x, y: y,
            h: 3 + rnd(seed, i, 5) * 4,
            lean: srnd(seed, i, 6) * 4
          })
        } else if (roll < 0.82) {
          pebbles.push({
            x: x, y: y,
            r: 1.2 + rnd(seed, i, 7) * 1.6,
            rot: srnd(seed, i, 8) * Math.PI
          })
        } else {
          clover.push({ x: x, y: y, r: 3 + rnd(seed, i, 9) * 2 })
        }
      }
    }

    // Three shades of tuft, from shadowed to sunlit.
    const tuftColours = [
      rgba(shade(pal.grass, -0.24), 0.4),
      rgba(pal.grassAlt, 0.6),
      rgba(shade(pal.grassAlt, 0.28), 0.55)
    ]
    ctx.lineWidth = 1.8
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

    // Low clover rosettes, not trees: buildable ground must still look buildable.
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? rgba(shade(pal.grassAlt, 0.12), 0.8) : rgba(shade(pal.grass, -0.3), 0.35)
      ctx.beginPath()
      for (let k = 0; k < clover.length; k++) {
        const c = clover[k]
        for (let leaf = 0; leaf < 3; leaf++) {
          const a = leaf * TAU / 3 - 0.5
          blob(ctx, c.x + Math.cos(a) * c.r * 0.7,
            c.y + Math.sin(a) * c.r * 0.5 + (pass ? -1 : 1.5), c.r, c.r * 0.55, a)
        }
      }
      ctx.fill()
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

      // Turf lip, sandy bank and a cut earth edge. The water boundary itself
      // stays exactly on the authored region; only the dry bank grows outward.
      ctx.strokeStyle = rgba(shade(pal.grass, -0.35), 0.45)
      ctx.lineWidth = 10
      shapePath(ctx, r, 3)
      ctx.stroke()
      ctx.strokeStyle = shade(pal.path, 0.12)
      ctx.lineWidth = 6
      shapePath(ctx, r, 2)
      ctx.stroke()
      ctx.strokeStyle = pal.pathEdge
      ctx.lineWidth = 2
      shapePath(ctx, r, 0)
      ctx.stroke()

      // A cool deep shelf fading to turquoise shallows.
      const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry)
      g.addColorStop(0, shade(pal.water, -0.18))
      g.addColorStop(0.55, pal.water)
      g.addColorStop(1, mix(pal.water, '#a9f1d9', 0.45))
      ctx.fillStyle = g
      shapePath(ctx, r, 0)
      ctx.fill()

      // All surface details are clipped, including ripples in small round ponds.
      ctx.save()
      shapePath(ctx, r, 0)
      ctx.clip()
      ctx.strokeStyle = rgba(shade(pal.water, 0.7), 0.6)
      ctx.lineWidth = 7
      shapePath(ctx, r, -3)
      ctx.stroke()
      ctx.strokeStyle = rgba(shade(pal.water, -0.5), 0.65)
      ctx.lineWidth = 2
      shapePath(ctx, r, 0)
      ctx.stroke()

      // Ripples. Long, flat, horizontal — the read that says "water".
      ctx.strokeStyle = rgba(shade(pal.water, 0.8), 0.55)
      ctx.lineWidth = 2.2
      ctx.beginPath()
      const rings = 4 + ((rnd(seed, i, 21) * 3) | 0)
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
      gl.addColorStop(0, rgba(shade(pal.water, 0.65), 0.3))
      gl.addColorStop(1, rgba(pal.water, 0))
      ctx.fillStyle = gl
      shapePath(ctx, r, 0)
      ctx.fill()
      ctx.restore()
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
      const w = Math.max(0.5, r.w + grow * 2)
      const h = Math.max(0.5, r.h + grow * 2)
      ctx.rect(r.x + (r.w - w) * 0.5, r.y + (r.h - h) * 0.5, w, h)
    }
  }

  /* ---------- 3. the path ----------
     The single most important thing on the screen. It must read as a walked track
     at a glance and be impossible to confuse with buildable ground: pale sand,
     a packed-earth bevel, a softly worn centre and a few inset stones. */

  function paintPaths (ctx, map, pal, seed, paths) {
    if (!paths.length) return

    const half = roadHalf(map)
    const w = half * 2

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const samples = paths.map(track => typeof track.sample === 'function' ? track.sample(9) : track.points || [])
    const bevel = ctx.createLinearGradient(0, 0, 0, OP.FIELD_H)
    bevel.addColorStop(0, shade(pal.path, 0.38))
    bevel.addColorStop(0.5, shade(pal.path, 0.16))
    bevel.addColorStop(1, mix(pal.path, pal.pathEdge, 0.38))
    const passes = [
      [w + 11, rgba(pal.base, 0.22)],
      [w + 8, mix(pal.grass, pal.grassAlt, 0.5)],
      [w + 5, pal.pathEdge],
      [w + 1.5, bevel],
      [w - 3, pal.path],
      [w * 0.55, rgba(shade(pal.path, 0.18), 0.4)]
    ]
    // Finish each material across ALL lanes before the next. Crossings then
    // read as joined roads, rather than one lane's dark rim cutting another.
    for (const pass of passes) {
      ctx.lineWidth = Math.max(1, pass[0])
      ctx.strokeStyle = pass[1]
      for (const pts of samples) {
        if (pts.length < 2) continue
        polyline(ctx, pts)
        ctx.stroke()
      }
    }
    for (let i = 0; i < paths.length; i++) {
      pathDetail(ctx, paths[i], pal, seed, i, half)
    }
    ctx.restore()
  }

  /** Loose stones and dry scuffs scattered along one track, batched by colour. */
  function pathDetail (ctx, track, pal, seed, pathIndex, half) {
    const len = track.length
    if (!(len > 0)) return
    const step = 46
    const stones = []
    const scuffs = []

    let k = 0
    for (let t = step * 0.5; t < len; t += step) {
      k++
      const j = pathIndex * 9173 + k
      const p = track.posAt(t)
      const a = typeof track.angleAt === 'function' ? track.angleAt(t) : 0
      const nx = -Math.sin(a), ny = Math.cos(a)
      const off = srnd(seed, j, 31) * half * 0.7
      const x = p.x + nx * off
      const y = p.y + ny * off
      if (rnd(seed, j, 32) < 0.55) {
        stones.push({ x: x, y: y, r: 1 + rnd(seed, j, 33) * 1.6, rot: a })
      } else {
        scuffs.push({ x: x, y: y, dx: Math.cos(a) * (3 + rnd(seed, j, 34) * 6), dy: Math.sin(a) * (3 + rnd(seed, j, 34) * 6) })
      }
    }

    if (stones.length) {
      ctx.fillStyle = rgba(pal.pathEdge, 0.28)
      ctx.beginPath()
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i]
        blob(ctx, s.x, s.y, s.r, s.r * 0.7, s.rot)
      }
      ctx.fill()
      ctx.fillStyle = rgba(shade(pal.path, 0.55), 0.65)
      ctx.beginPath()
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i]
        blob(ctx, s.x - 0.4, s.y - 0.6, s.r * 0.8, s.r * 0.55, s.rot)
      }
      ctx.fill()
    }

    if (scuffs.length) {
      ctx.strokeStyle = rgba(pal.pathEdge, 0.2)
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
     reads as flat scree rather than as a wall: fitted rubble, no tall canopy. */

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
      g.addColorStop(0, shade(pal.rock, 0.24))
      g.addColorStop(0.45, pal.rock)
      g.addColorStop(1, shade(pal.rock, -0.16))
      ctx.fillStyle = g
      shapePath(ctx, r, 0)
      ctx.fill()

      // Low, interlocking stone plates instead of a busy warning hatch.
      ctx.save()
      shapePath(ctx, r, 0)
      ctx.clip()
      ctx.lineWidth = 1.5
      let tile = 0
      for (let py = y0 - 8; py < y1 + 20; py += 26) {
        for (let px = x0 - 12; px < x1 + 24; px += 34) {
          const j = i * 701 + tile++
          const x = px + srnd(seed, j, 45) * 6
          const y = py + srnd(seed, j, 46) * 5
          ctx.fillStyle = shade(pal.rock, 0.06 + rnd(seed, j, 47) * 0.2)
          ctx.strokeStyle = rgba(shade(pal.rock, -0.4), 0.5)
          ctx.beginPath()
          ctx.moveTo(x - 14, y - 6)
          ctx.lineTo(x - 5, y - 12)
          ctx.lineTo(x + 13, y - 9)
          ctx.lineTo(x + 17, y + 5)
          ctx.lineTo(x + 5, y + 12)
          ctx.lineTo(x - 13, y + 8)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          ctx.strokeStyle = rgba(shade(pal.rock, 0.65), 0.6)
          ctx.beginPath()
          ctx.moveTo(x - 13, y - 5)
          ctx.lineTo(x - 5, y - 10)
          ctx.lineTo(x + 11, y - 8)
          ctx.stroke()
        }
      }

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

      ctx.strokeStyle = rgba(shade(pal.rock, -0.4), 0.8)
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
      ctx.fillStyle = rgba(pal.base, 0.3)
      ctx.beginPath()
      ctx.ellipse(b.x + b.w * 0.5 + 5, b.y + b.h + 2, b.w * 0.58, Math.max(4, b.h * 0.18), 0, 0, TAU)
      ctx.fill()

      // The dark face.
      const face = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h)
      face.addColorStop(0, shade(pal.rock, -0.14))
      face.addColorStop(0.4, pal.rock)
      face.addColorStop(1, shade(pal.rock, -0.34))
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

      // Cushions of foliage sit on existing solid terrain, never on a new
      // unmarked placement obstacle. Leave the stone face visible underneath.
      ctx.save()
      ctx.beginPath()
      ctx.rect(b.x - 2, b.y - lift, b.w + 4, lift + 2)
      ctx.clip()
      for (let k = 0; k < 3; k++) {
        foliage(ctx, b.x + b.w * (0.18 + k * 0.31), b.y - lift * 0.5,
          Math.min(24, b.w * 0.27), lift * 0.48, pal, seed, i * 71 + k)
      }
      ctx.restore()

      ctx.strokeStyle = rgba(shade(pal.rock, -0.5), 0.8)
      ctx.lineWidth = 1.5
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }

  // Broad leaf masses with a shaded skirt and a few sun-facing lobes. Shared by
  // mossy ledges and removable thickets; callers keep them inside their footprint.
  function foliage (ctx, x, y, rx, ry, pal, seed, index) {
    ctx.fillStyle = shade(pal.grass, -0.32)
    ctx.beginPath()
    blob(ctx, x, y + ry * 0.18, rx, ry, 0)
    ctx.fill()
    for (let k = 0; k < 4; k++) {
      const a = k * 2.4 + rnd(seed, index, 58) * 0.4
      const px = x + Math.cos(a) * rx * 0.4
      const py = y + Math.sin(a) * ry * 0.3 - ry * 0.15
      ctx.fillStyle = k % 2 ? pal.grassAlt : mix(pal.grass, pal.grassAlt, 0.45)
      ctx.beginPath()
      blob(ctx, px, py, rx * 0.6, ry * 0.65, 0)
      ctx.fill()
      ctx.strokeStyle = rgba(shade(pal.grassAlt, 0.4), 0.65)
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(px - rx * 0.35, py - ry * 0.1)
      ctx.quadraticCurveTo(px - rx * 0.25, py - ry * 0.55, px + rx * 0.15, py - ry * 0.45)
      ctx.stroke()
    }
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
      const woody = /stump|log|alder|oak|snag|limb|root|gate/i.test(o.name || '')
      const leafy = /bramble|thicket|briar|bush|thorn|fern|gorse|hedge|tussock/i.test(o.name || '')
      const body = woody ? pal.pathEdge : leafy ? shade(pal.grass, -0.22) : pal.rock

      // Contact shadow.
      ctx.fillStyle = rgba(pal.base, 0.32)
      ctx.beginPath()
      ctx.ellipse(x + 3, y + r * 0.55, r * 0.95, r * 0.4, 0, 0, TAU)
      ctx.fill()

      // Body, lit from the top-left.
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r)
      g.addColorStop(0, shade(body, 0.38))
      g.addColorStop(0.6, body)
      g.addColorStop(1, shade(body, -0.32))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()

      // A broad shoulder and a cool side plane give the stone a carved form,
      // rather than the old glossy sphere. Both facets stay inside its circle.
      ctx.fillStyle = shade(body, 0.3)
      ctx.beginPath()
      ctx.moveTo(x - r * 0.88, y - r * 0.12)
      ctx.lineTo(x - r * 0.48, y - r * 0.72)
      ctx.lineTo(x + r * 0.18, y - r * 0.86)
      ctx.lineTo(x + r * 0.58, y - r * 0.36)
      ctx.lineTo(x + r * 0.12, y + r * 0.05)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = rgba(shade(body, -0.38), 0.5)
      ctx.beginPath()
      ctx.moveTo(x + r * 0.58, y - r * 0.36)
      ctx.lineTo(x + r * 0.93, y + r * 0.12)
      ctx.lineTo(x + r * 0.5, y + r * 0.74)
      ctx.lineTo(x + r * 0.12, y + r * 0.05)
      ctx.closePath()
      ctx.fill()

      // Highlight along the lit shoulder.
      ctx.strokeStyle = rgba(shade(body, 0.6), 0.65)
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

      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.clip()
      if (woody) {
        // A cut timber top with growth rings distinguishes wood from stone.
        ctx.fillStyle = shade(pal.path, 0.12)
        ctx.beginPath()
        blob(ctx, x - r * 0.08, y - r * 0.24, r * 0.78, r * 0.52, -0.15)
        ctx.fill()
        ctx.strokeStyle = rgba(pal.pathEdge, 0.65)
        ctx.lineWidth = 1.5
        for (let ring = 1; ring <= 3; ring++) {
          ctx.beginPath()
          blob(ctx, x - r * 0.08, y - r * 0.24, r * ring * 0.21, r * ring * 0.13, -0.15)
          ctx.stroke()
        }
      }
      if (leafy) {
        foliage(ctx, x, y - r * 0.12, r * 0.94, r * 0.86, pal, seed, i * 97)
      } else {
        foliage(ctx, x - r * 0.42, y + r * 0.5, r * 0.46, r * 0.25, pal, seed, i * 97)
      }
      ctx.restore()

      ctx.strokeStyle = rgba(shade(body, -0.5), 0.85)
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

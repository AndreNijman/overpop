;(function (OP) {
  'use strict'

  const M = OP.M
  const P = OP.PROP
  const TAU = M.TAU

  /* Balloon and blimp sprites, drawn procedurally.

     Two constraints shape every line of this file, and they pull against each
     other:

     1. IT MUST READ AT 20px. The player has a fraction of a second to tell a
        black from a lead, and being wrong costs the round. So every tier gets a
        colour, a shade, a highlight, and — where colour alone is not enough — a
        marking or a silhouette that survives being 14 pixels wide. Zebra is
        striped, rainbow is banded, lead is a dark metal slug with a specular
        bar, ceramic is a cracked shell. The three properties change the
        SILHOUETTE rather than the tint, because a tint is invisible against a
        coloured balloon.

     2. ROUND 90 DRAWS 500+ BALLOONS PER FRAME. What actually kills canvas2D at
        that count is not the entity count, it is per-entity `createRadialGradient`
        and `shadowBlur` — each one throws away the rasteriser's fast path. So
        there are none, anywhere. Every colour in here is a plain fill or stroke
        string, and every one of those strings is built ONCE at load into `PAL`,
        so a frame allocates no strings either. A simple tier costs 3-5 real
        fills; the biggest blimp costs about a dozen. Multi-part shapes (the
        knot, the rivets, the scorch marks) are accumulated into ONE path and
        filled once.

     Animation reads a wall clock, never `sim.rng`, and nothing here writes to a
     balloon: the interpolated x/y come in as arguments precisely so the sprite
     never has to touch `balloon.x`. */

  /* ---------- colour maths — runs at load, never per frame ---------- */

  function rgbOf (h) {
    const n = parseInt(h.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function hexOf (r, g, b) {
    return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)
  }
  function mix (a, b, t) {
    const A = rgbOf(a), B = rgbOf(b)
    return hexOf(
      Math.round(A[0] + (B[0] - A[0]) * t),
      Math.round(A[1] + (B[1] - A[1]) * t),
      Math.round(A[2] + (B[2] - A[2]) * t))
  }
  function lighten (h, t) { return mix(h, '#ffffff', t) }
  function darken (h, t) { return mix(h, '#000000', t) }
  function rgba (h, a) {
    const c = rgbOf(h)
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'
  }

  /* Shared, tier-independent strings. */
  const GLOSS = 'rgba(255,255,255,0.42)'
  const GLOSS_SOFT = 'rgba(255,255,255,0.18)'
  const SCORCH = 'rgba(18,14,12,0.58)'
  const BAR_BG = 'rgba(6,9,7,0.78)'
  const BAR_OK = '#63c257'
  const BAR_MID = '#e0b03a'
  const BAR_LOW = '#d1493c'
  const PLATE = '#b9c2cd'
  const PLATE_DEEP = '#4d5561'
  const RIVET = '#e6ecf4'
  const REGEN_C = '#74e58a'
  const REGEN_DARK = 'rgba(10,32,16,0.55)'
  const VEIL_C = 'rgba(233,242,255,0.92)'

  /* The rainbow bands. Six flat hues beat any gradient here: they read as
     "many colours" at 16px, and they cost six ellipse fills instead of an
     object allocation per balloon per frame. */
  const RAINBOW = ['#d8453c', '#e8862c', '#e6d33a', '#49b356', '#3f7fd0', '#8b4fc9']

  /* ---------- per-tier palette, built once ---------- */

  const PAL = {}
  for (let i = 0; i < OP.BALLOON_TIERS.length; i++) {
    const tier = OP.BALLOON_TIERS[i]
    PAL[tier.key] = {
      body: tier.colour,
      dark: tier.shade,
      deep: darken(tier.shade, 0.42),
      lite: lighten(tier.colour, 0.42),
      pale: lighten(tier.colour, 0.72),
      edge: rgba(darken(tier.shade, 0.55), 0.85),
      soft: rgba(lighten(tier.colour, 0.6), 0.5),
      gloss: GLOSS
    }
  }

  /* ---------- primitives ----------
     `addEllipse` moves to the ellipse's own start point before adding it. Without
     that, a second ellipse in the same path is joined to the first by a straight
     line — which is exactly the bug that makes a cluster of rivets render as a
     spider. Doing it this way lets several blobs share one fill. */

  function addEllipse (ctx, x, y, rx, ry) {
    ctx.moveTo(x + rx, y)
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
  }

  function fillEllipse (ctx, x, y, rx, ry, style) {
    ctx.fillStyle = style
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
    ctx.fill()
  }

  function strokeEllipse (ctx, x, y, rx, ry, style, lw) {
    ctx.strokeStyle = style
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
    ctx.stroke()
  }

  /* A vertical band clipped to the body by construction rather than by ctx.clip().
     Clipping is a per-entity state change with a real cost; solving for the chord
     height is three multiplies. */
  function band (ctx, x, y, rx, ry, dx, w, style) {
    const edge = Math.min(rx * 0.995, Math.abs(dx) + w * 0.5)
    const k = edge / rx
    const h = ry * Math.sqrt(Math.max(0, 1 - k * k))
    if (h < 0.25 || w < 0.25) return
    ctx.fillStyle = style
    ctx.beginPath()
    ctx.ellipse(x + dx, y, w * 0.5, h, 0, 0, TAU)
    ctx.fill()
  }

  /* Body plus knot in a single path, so the whole dark base is one fill. */
  function shell (ctx, x, y, rx, ry, pal) {
    ctx.fillStyle = pal.dark
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
    const kw = rx * 0.26
    ctx.moveTo(x - kw, y + ry * 0.86)
    ctx.lineTo(x + kw, y + ry * 0.86)
    ctx.lineTo(x, y + ry * 1.30)
    ctx.closePath()
    ctx.fill()

    // The face, inset up and left: the uncovered crescent of `dark` on the
    // lower right is the shading, and it costs nothing extra.
    fillEllipse(ctx, x - rx * 0.06, y - ry * 0.08, rx * 0.93, ry * 0.91, pal.body)
  }

  function gloss (ctx, x, y, rx, ry) {
    ctx.fillStyle = GLOSS
    ctx.beginPath()
    ctx.ellipse(x - rx * 0.33, y - ry * 0.36, rx * 0.27, ry * 0.19, -0.55, 0, TAU)
    ctx.fill()
  }

  /* ---------- how healthy is this layer ----------
     PLATED doubles layer HP and freeplay scales it, so the denominator has to be
     the same expression the sim used when it filled `b.hp`. Using `tier.hp` raw
     would draw every plated blimp at half health the moment it spawned. */

  function hpRatio (b, tier) {
    const full = OP.layerHP(tier, b.props) * (b.hpScale || 1)
    if (!(full > 0)) return 1
    return M.clamp01(b.hp / full)
  }

  /* ---------- the clock ----------
     Render is allowed a wall clock; the sim's RNG is not on the table. FX already
     accumulates real seconds for its particles, and a suite (or the bestiary) can
     pass `frame.time` to drive the same animation deterministically. */

  function clock (frame) {
    if (frame && typeof frame.time === 'number') return frame.time
    const fx = OP.FX
    return fx && fx.state ? fx.state.time : 0
  }

  /** Idle bob in [-1, 1], per-entity phase, dropped under reduced motion. */
  function bob (b, time, reduced, channel) {
    if (reduced) return 0
    return Math.sin(time * 2.15 + M.jitter(b.id, channel || 7) * 3.14159)
  }

  /* ---------- properties ----------
     A tint is invisible on a coloured balloon, so each property changes the
     outline or adds a mark that survives 16px:

       VEILED  — the whole sprite drops to half alpha and gains a broken, dashed
                 ring. Half of the ring is missing, which is the read: not solid.
       REGEN   — a green circular arrow with a head. It says "this comes back".
       PLATED  — four thick armour plates on the rim with rivets between them, so
                 the silhouette stops being a smooth circle.

     They stack. The dashed ring sits outside the plates, the arrow sits in the
     middle of the face, so a VEILED PLATED REGEN balloon shows all three. */

  const VEIL_ALPHA = 0.5

  function veiledMark (ctx, x, y, rx, ry, r) {
    const dash = Math.max(1.8, r * 0.42)
    ctx.globalAlpha = 0.92          // the ring itself stays legible
    ctx.setLineDash([dash, dash])
    strokeEllipse(ctx, x, y, rx * 1.14, ry * 1.14, VEIL_C, Math.max(1, r * 0.11))
    ctx.setLineDash([])
    ctx.globalAlpha = VEIL_ALPHA
  }

  function regenMark (ctx, x, y, r) {
    const rr = r * 0.44
    const lw = Math.max(1.1, r * 0.16)
    const a0 = -0.6, a1 = 3.9

    ctx.lineCap = 'butt'
    ctx.strokeStyle = REGEN_DARK    // a dark backing keeps it legible on white
    ctx.lineWidth = lw * 2
    ctx.beginPath()
    ctx.arc(x, y, rr, a0, a1)
    ctx.stroke()

    ctx.strokeStyle = REGEN_C
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(x, y, rr, a0, a1)
    ctx.stroke()

    // Arrowhead on the open end, pointing the way round.
    const hs = Math.max(1.5, r * 0.30)
    const cx = x + Math.cos(a1) * rr
    const cy = y + Math.sin(a1) * rr
    const tx = -Math.sin(a1), ty = Math.cos(a1)
    ctx.fillStyle = REGEN_C
    ctx.beginPath()
    ctx.moveTo(cx + tx * hs, cy + ty * hs)
    ctx.lineTo(cx + Math.cos(a1) * hs * 0.9 - tx * hs * 0.6, cy + Math.sin(a1) * hs * 0.9 - ty * hs * 0.6)
    ctx.lineTo(cx - Math.cos(a1) * hs * 0.9 - tx * hs * 0.6, cy - Math.sin(a1) * hs * 0.9 - ty * hs * 0.6)
    ctx.closePath()
    ctx.fill()
  }

  function platedMark (ctx, x, y, rx, ry, r) {
    const rr = (rx + ry) * 0.5 * 0.96
    const lw = Math.max(1.3, r * 0.22)
    const arc = 1.16                 // radians of plate, leaving four gaps
    ctx.lineCap = 'butt'

    ctx.strokeStyle = PLATE_DEEP
    ctx.lineWidth = lw * 1.45
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) + 0.39
      ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      ctx.arc(x, y, rr, a, a + arc)
    }
    ctx.stroke()

    ctx.strokeStyle = PLATE
    ctx.lineWidth = lw
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) + 0.39
      ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      ctx.arc(x, y, rr, a, a + arc)
    }
    ctx.stroke()

    // Rivets in the gaps — one path, one fill.
    const rv = Math.max(0.7, r * 0.10)
    ctx.fillStyle = RIVET
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) + 0.39 + arc + 0.19
      addEllipse(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr, rv, rv)
    }
    ctx.fill()
  }

  function properties (ctx, x, y, rx, ry, r, b) {
    const p = b.props
    if (p & P.PLATED) platedMark(ctx, x, y, rx, ry, r)
    if (p & P.REGEN) regenMark(ctx, x, y, r)
    if (p & P.VEILED) veiledMark(ctx, x, y, rx, ry, r)
  }

  /* ---------- markings for the simple tiers ---------- */

  // Purple: a dark equatorial band. Reads as "not just a pink".
  function markPurple (ctx, x, y, rx, ry, pal, b, r) {
    strokeEllipse(ctx, x, y, rx * 0.62, ry * 0.26, pal.deep, Math.max(1, r * 0.13))
  }

  // Black: near-invisible on dark terrain without a rim, and the double gloss is
  // what separates it from lead at a glance — black is shiny, lead is not.
  function markBlack (ctx, x, y, rx, ry, pal, b, r) {
    strokeEllipse(ctx, x, y, rx, ry, 'rgba(226,232,240,0.30)', Math.max(1, r * 0.11))
    fillEllipse(ctx, x + rx * 0.30, y + ry * 0.34, rx * 0.20, ry * 0.13, GLOSS_SOFT)
  }

  // White: a cool outline, or it disappears into pale terrain.
  function markWhite (ctx, x, y, rx, ry, pal, b, r) {
    strokeEllipse(ctx, x, y, rx, ry, '#8f9aa8', Math.max(1, r * 0.10))
  }

  // Lead: heavy and metallic. A hard dark outline, a flat specular bar across the
  // upper half, a dimmer one below it, and two rivets. No gloss blob — polished
  // metal reflects a band, not a dot, and that difference is the tell.
  function markLead (ctx, x, y, rx, ry, pal, b, r) {
    fillEllipse(ctx, x, y - ry * 0.20, rx * 0.74, ry * 0.13, 'rgba(232,238,247,0.62)')
    fillEllipse(ctx, x, y + ry * 0.30, rx * 0.52, ry * 0.09, 'rgba(198,206,218,0.30)')
    const rv = Math.max(0.7, r * 0.11)
    ctx.fillStyle = '#2f333b'
    ctx.beginPath()
    addEllipse(ctx, x - rx * 0.62, y, rv, rv)
    addEllipse(ctx, x + rx * 0.62, y, rv, rv)
    ctx.fill()
    strokeEllipse(ctx, x, y, rx, ry, '#23262c', Math.max(1.2, r * 0.16))
  }

  // Zebra: three hard stripes. Unmistakable, and the whole point of the tier.
  function markZebra (ctx, x, y, rx, ry, pal, b, r) {
    const w = rx * 0.30
    band(ctx, x, y, rx, ry, -rx * 0.54, w, pal.dark)
    band(ctx, x, y, rx, ry, 0, w, pal.dark)
    band(ctx, x, y, rx, ry, rx * 0.54, w, pal.dark)
  }

  // Rainbow: six flat hues across the face. No gradient, and it reads as
  // multi-coloured from across the room.
  function markRainbow (ctx, x, y, rx, ry, pal, b, r) {
    const w = rx * 0.40
    for (let i = 0; i < RAINBOW.length; i++) {
      const dx = (i - (RAINBOW.length - 1) / 2) * (rx * 1.72 / RAINBOW.length)
      band(ctx, x, y, rx * 0.99, ry * 0.99, dx, w, RAINBOW[i])
    }
  }

  // Ceramic: a thick shell rim and cracks that multiply as the ten layer HP burn
  // down, so "one more hit" is visible rather than guessed. Crack angles come
  // from M.jitter on the entity id — stable across frames, never from sim.rng.
  function markCeramic (ctx, x, y, rx, ry, pal, b, r, tier) {
    strokeEllipse(ctx, x, y, rx * 0.97, ry * 0.97, pal.deep, Math.max(1.2, r * 0.15))
    const ratio = hpRatio(b, tier)
    const n = 2 + Math.round((1 - ratio) * 3)
    ctx.strokeStyle = 'rgba(46,22,10,0.85)'
    ctx.lineWidth = Math.max(1, r * 0.11)
    ctx.lineCap = 'butt'
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const a = M.jitter(b.id, 11 + i) * 3.14159 + i * 1.9
      const midA = a + M.jitter(b.id, 21 + i) * 0.5
      ctx.moveTo(x + Math.cos(a) * rx * 0.16, y + Math.sin(a) * ry * 0.16)
      ctx.lineTo(x + Math.cos(midA) * rx * 0.55, y + Math.sin(midA) * ry * 0.55)
      ctx.lineTo(x + Math.cos(a) * rx * 0.92, y + Math.sin(a) * ry * 0.92)
    }
    ctx.stroke()
  }

  /* ---------- blimps ----------
     Big, slow and expensive to be wrong about, so each one gets its own hull
     silhouette and a health readout: a player has to know whether a COLOSSUS is
     nearly down without counting shots. The bar sits above the hull, the scorch
     marks sit on it. */

  function healthBar (ctx, x, top, w, ratio) {
    const h = Math.max(2.4, w * 0.072)
    ctx.fillStyle = BAR_BG
    ctx.fillRect(x - w * 0.5, top, w, h)
    ctx.fillStyle = ratio > 0.6 ? BAR_OK : ratio > 0.28 ? BAR_MID : BAR_LOW
    ctx.fillRect(x - w * 0.5 + 1, top + 1, Math.max(0, (w - 2) * ratio), h - 2)
  }

  function scorches (ctx, x, y, rx, ry, b, ratio) {
    const n = Math.min(3, Math.floor((1 - ratio) * 4))
    if (n <= 0) return
    ctx.fillStyle = SCORCH
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      addEllipse(ctx,
        x + M.jitter(b.id, 30 + i) * rx * 0.58,
        y + M.jitter(b.id, 40 + i) * ry * 0.50,
        rx * 0.17, ry * 0.21)
    }
    ctx.fill()
  }

  function bevelPath (ctx, x, y, w, h, bev) {
    ctx.moveTo(x - w + bev, y - h)
    ctx.lineTo(x + w - bev, y - h)
    ctx.lineTo(x + w, y - h + bev)
    ctx.lineTo(x + w, y + h - bev)
    ctx.lineTo(x + w - bev, y + h)
    ctx.lineTo(x - w + bev, y + h)
    ctx.lineTo(x - w, y + h - bev)
    ctx.lineTo(x - w, y - h + bev)
    ctx.closePath()
  }

  // GOLIATH — a fat riveted airship with four fins and a gondola.
  function drawGoliath (ctx, b, x, y, tier, pal, r, ratio) {
    const rx = r * 1.28, ry = r * 0.80

    // Fins first, so the hull overlaps their roots.
    ctx.fillStyle = pal.deep
    ctx.beginPath()
    ctx.moveTo(x - rx * 0.62, y - ry * 0.72); ctx.lineTo(x - rx * 1.06, y - ry * 1.28); ctx.lineTo(x - rx * 0.28, y - ry * 0.92); ctx.closePath()
    ctx.moveTo(x + rx * 0.62, y - ry * 0.72); ctx.lineTo(x + rx * 1.06, y - ry * 1.28); ctx.lineTo(x + rx * 0.28, y - ry * 0.92); ctx.closePath()
    ctx.moveTo(x - rx * 0.62, y + ry * 0.72); ctx.lineTo(x - rx * 1.06, y + ry * 1.28); ctx.lineTo(x - rx * 0.28, y + ry * 0.92); ctx.closePath()
    ctx.moveTo(x + rx * 0.62, y + ry * 0.72); ctx.lineTo(x + rx * 1.06, y + ry * 1.28); ctx.lineTo(x + rx * 0.28, y + ry * 0.92); ctx.closePath()
    ctx.fill()

    fillEllipse(ctx, x, y, rx, ry, pal.dark)
    fillEllipse(ctx, x, y - ry * 0.06, rx * 0.94, ry * 0.90, pal.body)
    band(ctx, x, y, rx * 0.94, ry * 0.90, 0, rx * 0.30, pal.lite)
    fillEllipse(ctx, x, y + ry * 0.92, rx * 0.26, ry * 0.30, pal.deep)   // gondola
    fillEllipse(ctx, x - rx * 0.34, y - ry * 0.44, rx * 0.26, ry * 0.16, GLOSS)
    scorches(ctx, x, y, rx, ry, b, ratio)
    healthBar(ctx, x, y - ry * 1.62, rx * 1.5, ratio)
  }

  // WRAITH — a pointed spectral lens with a tattered trailing edge. Born VEILED,
  // so it also carries the dashed ring; the shape is what separates it from a
  // veiled GOLIATH.
  function drawWraith (ctx, b, x, y, tier, pal, r, ratio) {
    const rx = r * 1.42, ry = r * 0.74

    ctx.fillStyle = pal.deep
    ctx.beginPath()
    ctx.moveTo(x - rx, y)
    ctx.quadraticCurveTo(x, y - ry * 1.55, x + rx, y)
    ctx.quadraticCurveTo(x, y + ry * 1.55, x - rx, y)
    ctx.closePath()
    // Tatters hanging off the underside.
    for (let i = 0; i < 3; i++) {
      const tx = x + (i - 1) * rx * 0.44
      ctx.moveTo(tx - rx * 0.13, y + ry * 0.45)
      ctx.lineTo(tx, y + ry * 1.38)
      ctx.lineTo(tx + rx * 0.13, y + ry * 0.45)
      ctx.closePath()
    }
    ctx.fill()

    ctx.fillStyle = pal.body
    ctx.beginPath()
    ctx.moveTo(x - rx * 0.86, y)
    ctx.quadraticCurveTo(x, y - ry * 1.28, x + rx * 0.86, y)
    ctx.quadraticCurveTo(x, y + ry * 1.28, x - rx * 0.86, y)
    ctx.closePath()
    ctx.fill()

    fillEllipse(ctx, x, y, rx * 0.34, ry * 0.44, pal.soft)               // spectral core
    fillEllipse(ctx, x - rx * 0.30, y - ry * 0.32, rx * 0.22, ry * 0.14, GLOSS)
    scorches(ctx, x, y, rx * 0.8, ry, b, ratio)
    healthBar(ctx, x, y - ry * 1.72, rx * 1.34, ratio)
  }

  // LEVIATHAN — a ribbed whale of a hull with a long gondola and four engines.
  function drawLeviathan (ctx, b, x, y, tier, pal, r, ratio) {
    const rx = r * 1.20, ry = r * 0.86

    fillEllipse(ctx, x, y, rx, ry, pal.deep)
    fillEllipse(ctx, x, y - ry * 0.05, rx * 0.95, ry * 0.92, pal.body)

    const ribW = rx * 0.10
    band(ctx, x, y, rx * 0.95, ry * 0.92, -rx * 0.44, ribW, pal.dark)
    band(ctx, x, y, rx * 0.95, ry * 0.92, 0, ribW, pal.dark)
    band(ctx, x, y, rx * 0.95, ry * 0.92, rx * 0.44, ribW, pal.dark)

    ctx.fillStyle = pal.deep
    ctx.beginPath()
    bevelPath(ctx, x, y + ry * 0.96, rx * 0.56, ry * 0.20, ry * 0.10)
    ctx.fill()

    const er = Math.max(1, r * 0.09)
    ctx.fillStyle = pal.lite
    ctx.beginPath()
    for (let i = 0; i < 4; i++) addEllipse(ctx, x + (i - 1.5) * rx * 0.42, y + ry * 1.26, er, er)
    ctx.fill()

    fillEllipse(ctx, x - rx * 0.32, y - ry * 0.48, rx * 0.28, ry * 0.15, GLOSS)
    scorches(ctx, x, y, rx, ry, b, ratio)
    healthBar(ctx, x, y - ry * 1.52, rx * 1.5, ratio)
  }

  // COLOSSUS — boxy, bevelled, riveted. Nothing else on the board is a rectangle,
  // which is the whole idea: four thousand hull points should not look like a
  // balloon.
  function drawColossus (ctx, b, x, y, tier, pal, r, ratio) {
    const w = r * 1.18, h = r * 0.88, bev = r * 0.30

    const pr = Math.max(1.4, r * 0.15)
    ctx.fillStyle = pal.deep
    ctx.beginPath()
    addEllipse(ctx, x - w * 0.78, y - h * 1.10, pr, pr)
    addEllipse(ctx, x + w * 0.78, y - h * 1.10, pr, pr)
    addEllipse(ctx, x - w * 0.78, y + h * 1.10, pr, pr)
    addEllipse(ctx, x + w * 0.78, y + h * 1.10, pr, pr)
    ctx.fill()

    ctx.fillStyle = pal.deep
    ctx.beginPath()
    bevelPath(ctx, x, y, w, h, bev)
    ctx.fill()

    ctx.fillStyle = pal.body
    const inset = Math.max(1, r * 0.07)
    ctx.beginPath()
    bevelPath(ctx, x, y - inset * 0.4, w - inset, h - inset, bev * 0.9)
    ctx.fill()

    ctx.strokeStyle = pal.dark
    ctx.lineWidth = Math.max(1, r * 0.07)
    ctx.beginPath()
    ctx.moveTo(x - w * 0.86, y - h * 0.34); ctx.lineTo(x + w * 0.86, y - h * 0.34)
    ctx.moveTo(x - w * 0.86, y + h * 0.34); ctx.lineTo(x + w * 0.86, y + h * 0.34)
    ctx.stroke()

    const rv = Math.max(0.8, r * 0.06)
    ctx.fillStyle = RIVET
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const rx2 = x + (i - 2) * w * 0.38
      addEllipse(ctx, rx2, y - h * 0.72, rv, rv)
      addEllipse(ctx, rx2, y + h * 0.72, rv, rv)
    }
    ctx.fill()

    fillEllipse(ctx, x - w * 0.36, y - h * 0.60, w * 0.30, h * 0.13, GLOSS_SOFT)
    scorches(ctx, x, y, w, h, b, ratio)
    healthBar(ctx, x, y - h * 1.62, w * 1.6, ratio)
  }

  // OMEN — the last thing the track sends. A spiked crown around a black hex hull
  // with a lit slit. Angular, not oval, and the only sprite with a glowing eye.
  function drawOmen (ctx, b, x, y, tier, pal, r, ratio) {
    const rx = r * 1.06, ry = r * 0.84

    // Crown of spikes.
    ctx.fillStyle = pal.deep
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = i * (TAU / 8) + 0.2
      const nx = -Math.sin(a), ny = Math.cos(a)
      ctx.moveTo(x + Math.cos(a) * rx * 1.42, y + Math.sin(a) * ry * 1.42)
      ctx.lineTo(x + Math.cos(a) * rx * 0.80 + nx * rx * 0.20, y + Math.sin(a) * ry * 0.80 + ny * ry * 0.20)
      ctx.lineTo(x + Math.cos(a) * rx * 0.80 - nx * rx * 0.20, y + Math.sin(a) * ry * 0.80 - ny * ry * 0.20)
      ctx.closePath()
    }
    ctx.fill()

    // Hex hull.
    ctx.fillStyle = pal.dark
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = i * (TAU / 6)
      const px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = pal.body
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = i * (TAU / 6)
      const px = x + Math.cos(a) * rx * 0.84, py = y + Math.sin(a) * ry * 0.84
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()

    fillEllipse(ctx, x, y, rx * 0.62, ry * 0.20, '#5a1410')
    fillEllipse(ctx, x, y, rx * 0.54, ry * 0.11, '#e8443a')
    fillEllipse(ctx, x, y, rx * 0.22, ry * 0.07, '#ffd9c8')
    scorches(ctx, x, y, rx * 0.9, ry * 0.9, b, ratio)
    healthBar(ctx, x, y - ry * 1.76, rx * 1.7, ratio)
  }

  /* ---------- assembly ---------- */

  const SIMPLE_MARKS = {
    purple: markPurple,
    black: markBlack,
    white: markWhite,
    lead: markLead,
    zebra: markZebra,
    rainbow: markRainbow,
    ceramic: markCeramic
  }

  // Lead is squat and heavy; rainbow and ceramic are round; everything else is a
  // faintly egg-shaped balloon.
  const SHAPE = {
    lead: [1.07, 0.90],
    ceramic: [1.02, 0.98],
    rainbow: [1.01, 0.99]
  }

  const BLIMP_DRAW = {
    goliath: drawGoliath,
    wraith: drawWraith,
    leviathan: drawLeviathan,
    colossus: drawColossus,
    omen: drawOmen
  }

  function makeSimple (tier) {
    const pal = PAL[tier.key]
    const mark = SIMPLE_MARKS[tier.key] || null
    const shape = SHAPE[tier.key] || [0.99, 1.05]
    const r = tier.radius * 1.10
    const rx = r * shape[0]
    const ry = r * shape[1]
    const amp = r * 0.13

    return function (ctx, b, x, y, tierArg, frame) {
      const reduced = !!(frame && frame.reducedMotion)
      const yy = y + bob(b, clock(frame), reduced, 7) * amp
      const veiled = (b.props & P.VEILED) !== 0
      if (veiled) ctx.globalAlpha = VEIL_ALPHA
      shell(ctx, x, yy, rx, ry, pal)
      if (mark) mark(ctx, x, yy, rx, ry, pal, b, r, tierArg || tier)
      gloss(ctx, x, yy, rx, ry)
      if (b.props) properties(ctx, x, yy, rx, ry, r, b)
    }
  }

  function makeBlimp (tier) {
    const pal = PAL[tier.key]
    const draw = BLIMP_DRAW[tier.key]
    const r = tier.radius
    const amp = r * 0.045

    return function (ctx, b, x, y, tierArg, frame) {
      const t = tierArg || tier
      const reduced = !!(frame && frame.reducedMotion)
      const time = clock(frame)
      const yy = y + bob(b, time, reduced, 7) * amp
      const xx = x + bob(b, time, reduced, 13) * amp * 0.5
      const ratio = hpRatio(b, t)
      const veiled = (b.props & P.VEILED) !== 0
      if (veiled) ctx.globalAlpha = VEIL_ALPHA
      draw(ctx, b, xx, yy, t, pal, r, ratio)
      if (b.props) properties(ctx, xx, yy, r * 1.10, r * 0.92, r, b)
    }
  }

  /* ---------- registration ----------
     index.html loads the sprite files BEFORE js/render/renderer.js, and
     renderer.js assigns a fresh `OP.Render` with a fresh `balloonSprites` — so a
     plain `OP.Render.registerBalloon(...)` at load time would either fail (no
     Render yet) or be thrown away seconds later. Rather than draw magenta
     placeholders for the first frames, the assignment itself is hooked: the
     moment renderer.js sets OP.Render, every sprite registers. Any pre-existing
     accessor is chained rather than replaced, so a sibling sprite file doing the
     same thing still works. See the report — the clean fix is a registry declared
     in js/core/const.js, or moving the sprite <script> tags after renderer.js. */

  const SPRITES = {}
  for (let i = 0; i < OP.BALLOON_TIERS.length; i++) {
    const tier = OP.BALLOON_TIERS[i]
    SPRITES[tier.key] = tier.blimp && BLIMP_DRAW[tier.key] ? makeBlimp(tier) : makeSimple(tier)
  }

  const registeredAtLoad = []

  function install (R) {
    R = R || OP.Render
    if (!R || typeof R.registerBalloon !== 'function') return false
    registeredAtLoad.length = 0
    for (const key in SPRITES) {
      R.registerBalloon(key, SPRITES[key])
      registeredAtLoad.push(key)
    }
    return true
  }

  /**
   * Draw a tier outside a running sim — the bestiary and the round preview both
   * need this, and neither has a balloon entity to hand.
   * @param {object} ctx
   * @param {string} key    balloon tier key
   * @param {number} x
   * @param {number} y
   * @param {{props?:number, hpFrac?:number, id?:number, time?:number,
   *          reducedMotion?:boolean}} [opts]
   */
  function preview (ctx, key, x, y, opts) {
    opts = opts || {}
    // A UI helper: the bestiary or a tooltip may ask for a key that no longer
    // exists after a retune. Report false rather than throwing and taking the
    // whole frame down.
    if (OP.BALLOON_INDEX[key] === undefined) return false
    const fn = SPRITES[key]
    if (!fn) return false
    const tier = OP.tierByKey(key)
    const props = opts.props || 0
    const full = OP.layerHP(tier, props | tier.props)
    const fake = {
      id: opts.id === undefined ? 1 : opts.id,
      props: props | tier.props,
      hp: Math.max(1, Math.round(full * (opts.hpFrac === undefined ? 1 : opts.hpFrac))),
      hpScale: 1
    }
    fn(ctx, fake, x, y, tier, opts)
    return true
  }

  OP.BalloonSprites = {
    table: SPRITES,
    install: install,
    preview: preview,
    registeredAtLoad: registeredAtLoad,
    hpRatio: hpRatio
  }

  if (!install()) {
    const prev = Object.getOwnPropertyDescriptor(OP, 'Render')
    let held = prev && 'value' in prev ? prev.value : undefined
    Object.defineProperty(OP, 'Render', {
      configurable: true,
      enumerable: true,
      get: function () { return prev && prev.get ? prev.get.call(OP) : held },
      set: function (v) {
        if (prev && prev.set) prev.set.call(OP, v)
        else held = v
        install(v)
      }
    })
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

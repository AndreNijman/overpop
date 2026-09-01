;(function (OP) {
  'use strict'

  const M = OP.M
  const TAU = M.TAU

  /* ============================================================================
     TOWER SPRITES — every critter in the roster, drawn in code.

     Four rules govern this file, and all four come straight off the contract:

     1. NOTHING HERE MAY TOUCH SIM STATE. Not a field, not `tower.data`, not a
        cached phase. The harness runs the simulation with no renderer at all and
        the determinism checksums must be identical either way, so a sprite that
        stashes its animation phase on the entity is a determinism bug wearing a
        cosmetic hat. Everything a sprite needs comes in as an argument: the
        entity (read-only), the position, and the frame.

     2. NO PER-ENTITY GRADIENTS AND NO shadowBlur. That, not the entity count, is
        what actually kills canvas2D — 200 towers × one radial gradient is 200
        texture allocations a frame. Every colour in this file is a plain string
        built ONCE: the palette is at file scope, and each tower's skin is
        resolved once at install() and closed over. Shading is done with flat
        overlapping fills, which is also why the art reads as cut paper rather
        than airbrush.

     3. THE SILHOUETTE MUST CHANGE AS UPGRADES LAND. A player scanning the board
        needs to see which towers are invested in without clicking one. So every
        art function reads `tower.tiers` and grows real parts: a longer barrel, a
        second weapon, a scope, a chimney, a crown. On top of that the shared
        wrapper draws branch pips, a rank chevron at tier 4 and a full outline at
        tier 5, so investment is legible even on the towers whose own art changes
        subtly. A paragon replaces the palette outright and grows with degree; a
        hero carries its level as a number, because level is its whole progression.

     4. RANDOMNESS COMES FROM M.jitter, NEVER Math.random. Render is allowed to
        use Math.random — but a sprite that does stops being a pure function of
        (entity, time), and then no two frames can be compared, which is exactly
        how the suite proves rules 1 and 2. `M.jitter(id, channel)` gives stable
        per-entity variation with no state and no sim randomness.

     Animation: the phase is `frame.time` when the caller supplies one, otherwise a
     module clock. `frame.reducedMotion` pins the phase to zero, which is how idle
     motion is dropped — one branch, not twenty.

     Load order note: index.html loads the sprite files BEFORE the renderer, so
     OP.Render usually does not exist yet at the bottom of this file. install() is
     therefore idempotent and re-runnable, and a chained property descriptor
     installs the moment the renderer assigns itself. The same shape as
     sprites-balloons.js, deliberately — the two chain onto each other.
     ============================================================================ */

  /* ---------- palette ----------
     Every string here is built once, at file scope. Nothing in a draw path may
     concatenate a colour. */

  const OUT = '#191411'          // outline / ink
  const OUT_SOFT = 'rgba(20,16,12,0.45)'
  const SHADOW = 'rgba(8,10,8,0.30)'

  const WOOD = '#8a6b3c'
  const WOOD_DARK = '#5b4527'
  const IRON = '#8f97a0'
  const IRON_DARK = '#565c64'
  const BRASS = '#c9a227'
  const BONE = '#e8e2d4'
  const STONE = '#8a8477'
  const STONE_DARK = '#5f5b52'
  const EARTH = '#4a3a29'
  const EARTH_EDGE = '#2f2519'
  const LEAF = '#6f9a4a'
  const WATER = '#2c4f63'
  const WATER_LIGHT = '#4d7f96'
  const EMBER = '#e2632c'
  const FROST = '#9fd8ef'
  const ARCANE = '#7de8c6'
  const COIN = '#f0c14b'
  const BERRY = '#c0455f'

  // Branch colours for the investment pips. One per upgrade branch, in order.
  const BRANCH_COL = ['#e2a33c', '#6fc9e8', '#c98ae0']

  // Paragon ramps, bucketed by degree so no string is built per entity.
  const PARA_RIM = [
    'rgba(240,193,75,0.30)', 'rgba(242,199,84,0.34)', 'rgba(244,205,94,0.38)',
    'rgba(246,211,104,0.42)', 'rgba(248,217,114,0.46)', 'rgba(250,223,124,0.50)',
    'rgba(252,229,134,0.55)', 'rgba(254,235,144,0.60)', 'rgba(255,241,158,0.66)',
    'rgba(255,247,178,0.72)'
  ]
  const PARA_RAY = [
    'rgba(240,193,75,0.16)', 'rgba(241,197,82,0.19)', 'rgba(243,202,90,0.22)',
    'rgba(245,207,98,0.25)', 'rgba(247,212,106,0.28)', 'rgba(249,217,114,0.31)',
    'rgba(251,222,122,0.35)', 'rgba(253,228,132,0.39)', 'rgba(255,234,144,0.44)',
    'rgba(255,242,164,0.50)'
  ]
  const PARA_SKIN = {
    fur: '#f0c14b', furDark: '#a8761c', belly: '#fff3c4', accent: '#fff8d8',
    accent2: '#ffe9a0', metal: '#ffe9a0', metalDark: '#a8761c',
    pad: '#3a2d16', padEdge: '#1e1709', padKind: 'rune'
  }

  const HERO_FONT = 'bold 9px system-ui, sans-serif'
  const DASH_RUNE = [3, 4]
  const DASH_NONE = []

  /* ---------- trig table ----------
     Radial layouts (a hedgehog's coat, an owl's bolt fan, a paragon's rays) walk
     this instead of calling Math.cos/sin per spine per entity per frame. */

  const STEPS = 64
  const CS = new Float64Array(STEPS)
  const SN = new Float64Array(STEPS)
  for (let i = 0; i < STEPS; i++) {
    CS[i] = Math.cos((i / STEPS) * TAU)
    SN[i] = Math.sin((i / STEPS) * TAU)
  }
  function tcos (turn) { return CS[((turn * STEPS) | 0) & (STEPS - 1)] }
  function tsin (turn) { return SN[((turn * STEPS) | 0) & (STEPS - 1)] }

  /* ---------- colour maths, install-time only ---------- */

  function hex (c) {
    const n = parseInt(c.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function rgb (r, g, b) {
    return '#' + (((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)) | 0)
      .toString(16).slice(1)
  }
  /** Darken/lighten toward black/white. f < 1 darkens, f > 1 lightens. */
  function shade (c, f) {
    const p = hex(c)
    if (f <= 1) return rgb(p[0] * f, p[1] * f, p[2] * f)
    const g = f - 1
    return rgb(p[0] + (255 - p[0]) * g, p[1] + (255 - p[1]) * g, p[2] + (255 - p[2]) * g)
  }
  function mix (a, b, tt) {
    const p = hex(a), q = hex(b)
    return rgb(p[0] + (q[0] - p[0]) * tt, p[1] + (q[1] - p[1]) * tt, p[2] + (q[2] - p[2]) * tt)
  }

  /* ---------- primitive shapes ----------
     Deliberately allocation-free: no arrays, no template strings, no closures.
     Each one leaves the context's path empty and its style dirty, which is fine
     because the renderer save()s and restore()s around every sprite. */

  function disc (ctx, x, y, r, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }
  function oval (ctx, x, y, rx, ry, rot, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU)
    ctx.fill()
  }
  function ringOf (ctx, x, y, r, w, col) {
    ctx.strokeStyle = col
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.stroke()
  }
  function arcOf (ctx, x, y, r, a0, a1, w, col) {
    ctx.strokeStyle = col
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.arc(x, y, r, a0, a1)
    ctx.stroke()
  }
  function seg (ctx, x1, y1, x2, y2, w, col) {
    ctx.strokeStyle = col
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  function tri (ctx, ax, ay, bx, by, cx, cy, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx, cy)
    ctx.closePath()
    ctx.fill()
  }
  function quad (ctx, ax, ay, bx, by, cx, cy, dx, dy, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx, cy)
    ctx.lineTo(dx, dy)
    ctx.closePath()
    ctx.fill()
  }
  /** Centred rectangle. */
  function box (ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill
    ctx.fillRect(x - w * 0.5, y - h * 0.5, w, h)
  }
  function star (ctx, x, y, r, points, rot, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    const inner = r * 0.44
    for (let i = 0; i < points * 2; i++) {
      const turn = rot + i / (points * 2)
      const rr = (i & 1) ? inner : r
      const px = x + tcos(turn) * rr
      const py = y + tsin(turn) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }
  function ngon (ctx, x, y, r, n, rot, fill) {
    ctx.fillStyle = fill
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const turn = rot + i / n
      const px = x + tcos(turn) * r
      const py = y + tsin(turn) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }

  /** Enter a rotating frame. The critter itself never enters one — see below. */
  function beginAim (ctx, x, y, ang) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
  }
  function endAim (ctx) { ctx.restore() }

  /* ---------- shared critter anatomy ----------
     The whole roster is one body plan plus a job. Keeping it shared is what makes
     thirty-one towers legible as a family rather than thirty-one doodles.

     The body is ALWAYS drawn upright. Only weapons and held things enter a
     rotating frame; the critter's facing is expressed by mirroring the head, so a
     tower shooting to the left is not a tower standing on its head. */

  function shadowUnder (ctx, x, y, r) {
    oval(ctx, x, y + r * 0.72, r * 1.02, r * 0.34, 0, SHADOW)
  }

  /**
   * Haunched body with a belly patch.
   * @param {number} lean  -1..1, shifts the mass for a crouch or a rear-up
   */
  function body (ctx, x, y, r, k, lean) {
    oval(ctx, x, y, r * 0.82, r * 0.92, lean * 0.22, k.fur)
    oval(ctx, x - r * 0.06, y + r * 0.22, r * 0.5, r * 0.52, 0, k.belly)
    ctx.strokeStyle = OUT_SOFT
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(x, y, r * 0.82, r * 0.92, lean * 0.22, 0, TAU)
    ctx.stroke()
  }

  /**
   * Head, ears and eyes. `dir` is +1 facing right, -1 facing left.
   * `ear` picks the silhouette that carries most of a critter's identity.
   */
  function head (ctx, x, y, r, k, dir, ear, snout) {
    const hr = r * 0.52
    // ears go behind the skull
    if (ear === 'point') {
      tri(ctx, x - hr * 0.85, y - hr * 0.5, x - hr * 1.25, y - hr * 2.0, x - hr * 0.15, y - hr * 1.25, k.fur)
      tri(ctx, x + hr * 0.85, y - hr * 0.5, x + hr * 1.25, y - hr * 2.0, x + hr * 0.15, y - hr * 1.25, k.fur)
    } else if (ear === 'long') {
      oval(ctx, x - hr * 0.55, y - hr * 1.7, hr * 0.26, hr * 1.25, -0.18, k.fur)
      oval(ctx, x + hr * 0.55, y - hr * 1.7, hr * 0.26, hr * 1.25, 0.18, k.fur)
      oval(ctx, x - hr * 0.55, y - hr * 1.7, hr * 0.12, hr * 0.95, -0.18, k.belly)
      oval(ctx, x + hr * 0.55, y - hr * 1.7, hr * 0.12, hr * 0.95, 0.18, k.belly)
    } else if (ear === 'round') {
      disc(ctx, x - hr * 0.86, y - hr * 0.78, hr * 0.42, k.furDark)
      disc(ctx, x + hr * 0.86, y - hr * 0.78, hr * 0.42, k.furDark)
    } else if (ear === 'tuft') {
      disc(ctx, x - hr * 0.8, y - hr * 0.7, hr * 0.36, k.furDark)
      disc(ctx, x + hr * 0.8, y - hr * 0.7, hr * 0.36, k.furDark)
      seg(ctx, x - hr * 0.9, y - hr * 0.95, x - hr * 1.15, y - hr * 1.8, 1.4, OUT)
      seg(ctx, x + hr * 0.9, y - hr * 0.95, x + hr * 1.15, y - hr * 1.8, 1.4, OUT)
    }

    disc(ctx, x, y, hr, k.fur)
    if (snout) {
      oval(ctx, x + dir * hr * 0.62, y + hr * 0.22, hr * 0.5, hr * 0.34, 0, k.belly)
      disc(ctx, x + dir * hr * 1.0, y + hr * 0.16, hr * 0.14, OUT)
    }
    // eyes: two ink dots with a catchlight, offset toward the facing side
    const ex = x + dir * hr * 0.22
    disc(ctx, ex - hr * 0.3, y - hr * 0.12, hr * 0.16, OUT)
    disc(ctx, ex + hr * 0.3, y - hr * 0.12, hr * 0.16, OUT)
    disc(ctx, ex - hr * 0.26, y - hr * 0.17, hr * 0.06, BONE)
    disc(ctx, ex + hr * 0.34, y - hr * 0.17, hr * 0.06, BONE)
  }

  function tail (ctx, x, y, r, k, dir, kind) {
    if (kind === 'brush') {
      oval(ctx, x - dir * r * 0.95, y + r * 0.3, r * 0.55, r * 0.34, -dir * 0.5, k.furDark)
      disc(ctx, x - dir * r * 1.35, y + r * 0.1, r * 0.24, k.belly)
    } else if (kind === 'flat') {
      quad(ctx, x - dir * r * 0.6, y + r * 0.5, x - dir * r * 1.5, y + r * 0.75,
        x - dir * r * 1.5, y + r * 0.25, x - dir * r * 0.6, y + r * 0.15, k.furDark)
    } else if (kind === 'thin') {
      arcOf(ctx, x - dir * r * 0.9, y + r * 0.35, r * 0.55, -1.2, 1.2, 2.2, k.furDark)
    } else if (kind === 'stub') {
      disc(ctx, x - dir * r * 0.85, y + r * 0.38, r * 0.22, k.furDark)
    }
  }

  /** A limb reaching out at an angle — the thing that holds the weapon. */
  function paw (ctx, x, y, ang, len, w, k) {
    const ex = x + Math.cos(ang) * len
    const ey = y + Math.sin(ang) * len
    seg(ctx, x, y, ex, ey, w, k.furDark)
    disc(ctx, ex, ey, w * 0.6, k.fur)
  }

  /* ---------- ground pads ----------
     Reads as "this critter has been placed here" and quietly says which family it
     belongs to, which is worth a lot when the board is busy. */

  function pad (ctx, x, y, r, k, t, reduced) {
    const kind = k.padKind
    if (kind === 'ripple') {
      oval(ctx, x, y + r * 0.55, r * 1.35, r * 0.6, 0, WATER)
      const ph = reduced ? 0 : t * 0.35
      arcOf(ctx, x, y + r * 0.55, r * (0.7 + (ph % 1) * 0.6), 0, TAU, 1.2, 'rgba(180,220,235,0.35)')
      arcOf(ctx, x, y + r * 0.55, r * 1.15, 3.0, 6.1, 1, WATER_LIGHT)
      return
    }
    if (kind === 'plate') {
      ngon(ctx, x, y + r * 0.5, r * 1.12, 6, 0.08, k.pad)
      ngon(ctx, x, y + r * 0.5, r * 0.86, 6, 0.08, k.padEdge)
      return
    }
    if (kind === 'rune') {
      disc(ctx, x, y + r * 0.45, r * 1.15, k.pad)
      ctx.setLineDash(DASH_RUNE)
      ringOf(ctx, x, y + r * 0.45, r * 0.95, 1.4, k.accent)
      ctx.setLineDash(DASH_NONE)
      const spin = reduced ? 0 : t * 0.07
      for (let i = 0; i < 4; i++) {
        const turn = spin + i / 4
        seg(ctx, x + tcos(turn) * r * 1.02, y + r * 0.45 + tsin(turn) * r * 1.02,
          x + tcos(turn) * r * 1.22, y + r * 0.45 + tsin(turn) * r * 1.22, 1.6, k.accent)
      }
      return
    }
    if (kind === 'plank') {
      box(ctx, x, y + r * 0.5, r * 2.1, r * 0.9, k.pad)
      seg(ctx, x - r, y + r * 0.5, x + r, y + r * 0.5, 1, k.padEdge)
      seg(ctx, x - r * 0.35, y + r * 0.08, x - r * 0.35, y + r * 0.95, 1, k.padEdge)
      seg(ctx, x + r * 0.35, y + r * 0.08, x + r * 0.35, y + r * 0.95, 1, k.padEdge)
      return
    }
    // earth mound
    oval(ctx, x, y + r * 0.55, r * 1.2, r * 0.55, 0, k.pad)
    arcOf(ctx, x, y + r * 0.55, r * 1.05, 3.35, 6.05, 1.4, k.padEdge)
  }

  /* ---------- investment marks ----------
     The honest, always-legible half of rule 3. Per-branch pips, a rank chevron at
     tier 4 and a full accent outline at tier 5. Cheap, and it means even a tower
     whose own art changes subtly still reads as invested. */

  function tierMarks (ctx, tw, x, y, r) {
    const tiers = tw.tiers
    if (!tiers) return
    const total = tiers[0] + tiers[1] + tiers[2]
    if (total > 0) {
      const w = 3.1
      let px = x - ((total - 1) * w) * 0.5
      const py = y + r * 1.18
      for (let p = 0; p < 3; p++) {
        for (let i = 0; i < tiers[p]; i++) {
          disc(ctx, px, py, 1.35, BRANCH_COL[p])
          px += w
        }
      }
    }
    const top = OP.Upgrades.topTier(tw)
    if (top >= 4) {
      // rank chevron above the head
      const cy = y - r * 1.5
      seg(ctx, x - r * 0.4, cy + r * 0.2, x, cy, 1.8, COIN)
      seg(ctx, x, cy, x + r * 0.4, cy + r * 0.2, 1.8, COIN)
      if (top >= 5) {
        seg(ctx, x - r * 0.4, cy + r * 0.45, x, cy + r * 0.25, 1.8, COIN)
        seg(ctx, x, cy + r * 0.25, x + r * 0.4, cy + r * 0.45, 1.8, COIN)
      }
    }
    if (top >= 5) ringOf(ctx, x, y + r * 0.1, r * 1.3, 1.6, COIN)
  }

  /* ---------- paragon ----------
     A paragon must be unmistakable from across the board and grander with degree.
     Rays and motes are COUNTED from degree so the silhouette itself changes, and
     the colour ramp is bucketed so nothing allocates a string. */

  function paragonUnder (ctx, x, y, r, degree, t, reduced) {
    const b = M.clamp((degree - 1) / 10 | 0, 0, 9)
    const rays = 6 + ((degree / 12) | 0)
    const spin = reduced ? 0 : t * 0.04
    ctx.strokeStyle = PARA_RAY[b]
    ctx.lineWidth = 2.4
    for (let i = 0; i < rays; i++) {
      const turn = spin + i / rays
      ctx.beginPath()
      ctx.moveTo(x + tcos(turn) * r * 0.9, y + tsin(turn) * r * 0.9)
      ctx.lineTo(x + tcos(turn) * r * (1.85 + b * 0.06), y + tsin(turn) * r * (1.85 + b * 0.06))
      ctx.stroke()
    }
    ringOf(ctx, x, y, r * 1.5, 2.2, PARA_RIM[b])
    disc(ctx, x, y + r * 0.5, r * 1.05, '#2a2010')
    ringOf(ctx, x, y + r * 0.5, r * 1.05, 1.6, PARA_RIM[b])
  }

  function paragonOver (ctx, x, y, r, degree, t, reduced) {
    const b = M.clamp((degree - 1) / 10 | 0, 0, 9)
    const motes = 3 + ((degree / 25) | 0)
    const spin = reduced ? 0 : t * 0.11
    for (let i = 0; i < motes; i++) {
      const turn = spin + i / motes
      disc(ctx, x + tcos(turn) * r * 1.25, y - r * 0.4 + tsin(turn) * r * 0.5, 1.6 + b * 0.09, PARA_SKIN.accent)
    }
    // crown: one point per five degrees, capped, so a degree-90 paragon is
    // visibly taller-crowned than a degree-10 one
    const pts = 3 + M.clamp((degree / 14) | 0, 0, 5)
    const cy = y - r * 1.22
    ctx.fillStyle = PARA_SKIN.fur
    ctx.beginPath()
    ctx.moveTo(x - r * 0.62, cy + r * 0.3)
    for (let i = 0; i < pts; i++) {
      const fx = x - r * 0.62 + (r * 1.24 * i) / (pts - 1 || 1)
      ctx.lineTo(fx, cy - r * 0.22)
      ctx.lineTo(fx + (r * 1.24) / ((pts - 1 || 1) * 2), cy + r * 0.12)
    }
    ctx.lineTo(x + r * 0.62, cy + r * 0.3)
    ctx.closePath()
    ctx.fill()
    // degree gauge: a sweep, so 10 and 90 differ at a glance
    arcOf(ctx, x, y + r * 0.5, r * 1.22, -1.6, -1.6 + TAU * (degree / 100), 2, PARA_RIM[b])
  }

  /* ---------- hero level ----------
     Level is a hero's entire progression, so it is drawn as a number as well as
     a laurel sweep. One hero per map, so fillText here costs nothing. */

  function heroBadge (ctx, tw, x, y, r) {
    const lvl = tw.level === undefined ? 1 : tw.level
    const frac = M.clamp01(lvl / 20)
    arcOf(ctx, x, y + r * 0.1, r * 1.42, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * frac, 2.6, COIN)
    ringOf(ctx, x, y + r * 0.1, r * 1.42, 0.8, 'rgba(240,193,75,0.25)')
    // a star per five levels earned
    const stars = (lvl / 5) | 0
    for (let i = 0; i < stars; i++) {
      star(ctx, x - 6 + i * 4.2, y - r * 1.62, 2.6, 5, 0.75, COIN)
    }
    // the number itself
    const bw = lvl >= 10 ? 13 : 10
    box(ctx, x, y + r * 1.55, bw, 9, '#20180c')
    box(ctx, x, y + r * 1.55, bw - 2, 7, COIN)
    ctx.fillStyle = '#20180c'
    ctx.font = HERO_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(lvl), x, y + r * 1.55 + 0.5)
  }

  /* ============================================================================
     THE ROSTER

     One function per tower key. Each one reads tower.tiers and grows.
     Signature: (ctx, tw, x, y, r, k, t, reduced, dir)
       x, y   already carries the idle bob — the pad was drawn unbobbed
       r      body radius, derived from the tower's footprint
       k      the skin resolved at install()
       t      animation phase in seconds; 0 when motion is reduced
       dir    +1 / -1 facing, from the aim angle
     ============================================================================ */

  const ART = {}

  /* ---------- primary ---------- */

  // Throws acorns. Flint caps at Sharpened 3, a second paw at Quick Paws 3, a
  // throwing stick at Long Throw 3.
  ART['acorn-fox'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    tail(ctx, x, y, r, k, dir, 'brush')
    body(ctx, x, y, r, k, dir * 0.1)
    head(ctx, x + dir * r * 0.18, y - r * 0.78, r, k, dir, 'point', true)

    beginAim(ctx, x, y, tw.angle || 0)
    const reach = r * (0.7 + c * 0.09)
    seg(ctx, 0, 0, reach, -r * 0.1, r * 0.22, k.furDark)
    const ar = r * (0.24 + a * 0.035)
    oval(ctx, reach + ar, -r * 0.1, ar, ar * 1.15, 0, a >= 3 ? shade(BRASS, 0.9) : k.accent)
    disc(ctx, reach + ar * 0.4, -r * 0.1, ar * 0.62, WOOD_DARK)
    if (a >= 3) tri(ctx, reach + ar * 1.9, -r * 0.1, reach + ar * 2.9, -r * 0.35, reach + ar * 2.9, r * 0.15, IRON)
    if (b >= 3) {
      // a second acorn already cocked in the off paw
      oval(ctx, reach * 0.2, r * 0.55, ar * 0.8, ar * 0.95, 0, k.accent)
    }
    if (c >= 3) seg(ctx, -r * 0.2, r * 0.1, reach * 1.5, -r * 0.2, 1.6, WOOD)
    endAim(ctx)

    if (b >= 4 && !reduced) {
      // blur streaks: motion lines, not motion
      arcOf(ctx, x, y, r * 1.15, t * 0.9, t * 0.9 + 1.1, 1.4, 'rgba(240,225,190,0.35)')
    }
  }

  // Throws a curved branch that sweeps out and back. Extra branches with Wide
  // Arc, a weighted tip with Heavy Return, a longer snout with Keen Nose.
  ART['boomer-badger'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    body(ctx, x, y, r, k, 0)
    // the badger's face stripe is its whole silhouette
    quad(ctx, x - r * 0.12, y - r * 1.45, x + r * 0.12, y - r * 1.45,
      x + r * 0.2, y - r * 0.35, x - r * 0.2, y - r * 0.35, BONE)
    head(ctx, x + dir * r * 0.1, y - r * 0.85, r, k, dir, 'round', c >= 3)
    tail(ctx, x, y, r, k, dir, 'stub')

    const arms = 1 + (a >= 3 ? 1 : 0) + (a >= 5 ? 1 : 0)
    const spin = reduced ? 0 : t * 0.55
    for (let i = 0; i < arms; i++) {
      const ang = (tw.angle || 0) + (i / arms) * TAU * 0.33 + spin
      beginAim(ctx, x, y - r * 0.2, ang)
      const len = r * (0.85 + b * 0.05)
      ctx.strokeStyle = a >= 4 ? shade(WOOD, 0.75) : WOOD
      ctx.lineWidth = 2.2 + b * 0.35
      ctx.beginPath()
      ctx.arc(len, 0, r * 0.46, -1.9, 1.9)
      ctx.stroke()
      if (b >= 3) disc(ctx, len + r * 0.46, -r * 0.3, 2 + b * 0.25, IRON_DARK)
      endAim(ctx)
    }
    if (c >= 4) {
      // truffle-sense whiskers
      seg(ctx, x + dir * r * 0.5, y - r * 0.7, x + dir * r * 1.3, y - r * 0.95, 1, BONE)
      seg(ctx, x + dir * r * 0.5, y - r * 0.6, x + dir * r * 1.3, y - r * 0.45, 1, BONE)
    }
  }

  // A boar behind a cannon. The barrel is the whole read: it grows with Ironwood
  // Shell, gains a cluster rack with Cone Cluster and a second ram with Long Fuse.
  ART['cannon-boar'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    body(ctx, x, y + r * 0.1, r * 0.95, k, 0)
    head(ctx, x - dir * r * 0.45, y - r * 0.6, r * 0.9, k, dir, 'round', true)
    // tusks
    seg(ctx, x - dir * r * 0.15, y - r * 0.35, x - dir * r * 0.02, y - r * 0.62, 1.6, BONE)

    beginAim(ctx, x + dir * r * 0.1, y - r * 0.15, tw.angle || 0)
    const len = r * (1.0 + a * 0.16)
    const wide = r * (0.3 + a * 0.045)
    box(ctx, len * 0.5, 0, len, wide * 2, a >= 4 ? IRON_DARK : WOOD_DARK)
    disc(ctx, len, 0, wide * 1.12, IRON)
    disc(ctx, len, 0, wide * 0.68, '#120f0c')
    // iron bands appear as the shell branch commits
    for (let i = 0; i < (a >= 3 ? 3 : 1); i++) {
      box(ctx, len * (0.28 + i * 0.26), 0, 2.2, wide * 2.2, BRASS)
    }
    if (c >= 3) box(ctx, -r * 0.35, 0, r * 0.5, wide * 1.3, IRON_DARK)
    endAim(ctx)

    if (b >= 3) {
      // a rack of spare cones
      for (let i = 0; i < 3; i++) {
        oval(ctx, x - dir * r * (0.85 + i * 0.02), y + r * (0.35 - i * 0.3), r * 0.17, r * 0.24, 0, shade(WOOD, 0.8))
      }
    }
    if (a >= 5 || c >= 5) {
      disc(ctx, x - dir * r * 0.95, y + r * 0.72, r * 0.3, IRON_DARK)
      disc(ctx, x + dir * r * 0.95, y + r * 0.72, r * 0.3, IRON_DARK)
    }
  }

  // Spines in every direction at once. Coat count and length ARE the upgrades.
  ART['thistle-hedgehog'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    const n = 12 + a * 3
    const len = r * (1.05 + b * 0.1)
    const spin = reduced ? 0 : t * 0.05
    const tip = c >= 3 ? EMBER : (c > 0 ? mix(k.accent, EMBER, 0.4) : k.accent)
    ctx.lineWidth = 1.5 + a * 0.18
    for (let i = 0; i < n; i++) {
      const turn = spin + i / n
      ctx.strokeStyle = (i & 1) ? tip : k.furDark
      ctx.beginPath()
      ctx.moveTo(x + tcos(turn) * r * 0.55, y + tsin(turn) * r * 0.55)
      ctx.lineTo(x + tcos(turn) * len, y + tsin(turn) * len)
      ctx.stroke()
    }
    disc(ctx, x, y, r * 0.68, k.fur)
    head(ctx, x + dir * r * 0.5, y + r * 0.2, r * 0.62, k, dir, 'none', true)
    if (c >= 4) {
      // burning coat
      for (let i = 0; i < 5; i++) {
        const turn = (reduced ? 0 : t * 0.13) + i / 5
        disc(ctx, x + tcos(turn) * len * 0.9, y + tsin(turn) * len * 0.9, 1.7, EMBER)
      }
    }
    if (b >= 5) ringOf(ctx, x, y, len * 1.12, 1.2, 'rgba(216,203,176,0.4)')
  }

  // Breathes frost. The plume is the rotating part; crystals accrete on the coat.
  ART['frost-hare'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    tail(ctx, x, y, r, k, dir, 'stub')
    body(ctx, x, y, r, k, 0)
    head(ctx, x + dir * r * 0.2, y - r * 0.8, r, k, dir, 'long', true)

    beginAim(ctx, x + dir * r * 0.3, y - r * 0.6, tw.angle || 0)
    const spread = 0.3 + b * 0.06
    const reach = r * (1.1 + b * 0.12)
    ctx.fillStyle = a >= 3 ? '#cdeeff' : 'rgba(159,216,239,0.75)'
    ctx.beginPath()
    ctx.moveTo(r * 0.2, 0)
    ctx.lineTo(reach, -reach * spread)
    ctx.lineTo(reach * 1.1, 0)
    ctx.lineTo(reach, reach * spread)
    ctx.closePath()
    ctx.fill()
    const puffs = 2 + b
    for (let i = 0; i < puffs; i++) {
      const p = (i + 1) / (puffs + 1)
      disc(ctx, reach * p, (reduced ? 0 : Math.sin(t * 3 + i) * r * 0.1), r * (0.12 + p * 0.16), FROST)
    }
    if (c >= 3) {
      for (let i = 0; i < 3; i++) {
        tri(ctx, reach * 0.6, -r * 0.2 + i * r * 0.2, reach * 1.25, -r * 0.1 + i * r * 0.2,
          reach * 0.6, r * 0.02 + i * r * 0.2, '#eaf8ff')
      }
    }
    endAim(ctx)

    if (a >= 4) {
      for (let i = 0; i < 4; i++) {
        const turn = i / 4 + 0.06
        star(ctx, x + tcos(turn) * r * 0.7, y + tsin(turn) * r * 0.7, r * 0.16, 6, 0.02, '#eaf8ff')
      }
    }
    if (c >= 5) ringOf(ctx, x, y, r * 1.32, 1.6, 'rgba(205,238,255,0.5)')
  }

  // Spits sap. Barely fights; holds things still. Shell rings count the upgrades.
  ART['sap-snail'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // foot
    oval(ctx, x, y + r * 0.45, r * 1.05, r * 0.4, 0, k.belly)
    // shell: a spiral of shrinking discs, one more ring per Corrosive Sap tier
    const rings = 3 + a
    for (let i = 0; i < rings; i++) {
      const p = i / rings
      disc(ctx, x - dir * r * 0.2 + dir * p * r * 0.4, y - r * 0.15 - p * r * 0.1,
        r * (0.78 - p * 0.6), i & 1 ? k.fur : k.furDark)
    }
    if (c >= 3) ringOf(ctx, x - dir * r * 0.2, y - r * 0.15, r * 0.8, 1.5, k.accent)
    // head on a stalk with eye stalks
    const hx = x + dir * r * 0.75
    oval(ctx, hx, y + r * 0.15, r * 0.4, r * 0.26, 0, k.belly)
    seg(ctx, hx, y + r * 0.05, hx + dir * r * 0.15, y - r * 0.45, 1.2, k.belly)
    seg(ctx, hx - dir * r * 0.1, y + r * 0.05, hx, y - r * 0.5, 1.2, k.belly)
    disc(ctx, hx + dir * r * 0.15, y - r * 0.48, r * 0.1, OUT)
    disc(ctx, hx, y - r * 0.53, r * 0.1, OUT)

    beginAim(ctx, hx, y + r * 0.1, tw.angle || 0)
    const jet = r * (0.55 + b * 0.13)
    ctx.fillStyle = c >= 4 ? '#d4ff3c' : k.accent
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.14)
    ctx.lineTo(jet, -r * (0.1 + b * 0.05))
    ctx.lineTo(jet, r * (0.1 + b * 0.05))
    ctx.lineTo(0, r * 0.14)
    ctx.closePath()
    ctx.fill()
    disc(ctx, jet, 0, r * (0.14 + b * 0.04), c >= 4 ? '#d4ff3c' : k.accent)
    if (b >= 3) disc(ctx, jet * 1.4, (reduced ? 0 : Math.sin(t * 4) * r * 0.12), r * 0.13, k.accent)
    endAim(ctx)
    if (a >= 5) ringOf(ctx, x, y, r * 1.28, 1.6, k.accent)
  }

  // Six shots then a long reload. All the identity is in the revolver.
  ART['sixgun-stoat'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    tail(ctx, x, y, r, k, dir, 'thin')
    oval(ctx, x, y, r * 0.62, r * 1.0, dir * 0.12, k.fur)
    oval(ctx, x, y + r * 0.25, r * 0.4, r * 0.5, 0, k.belly)
    head(ctx, x + dir * r * 0.2, y - r * 0.9, r * 0.9, k, dir, 'round', true)
    if (b >= 4) {
      // bandolier
      seg(ctx, x - r * 0.5, y - r * 0.3, x + r * 0.55, y + r * 0.45, 2.6, WOOD_DARK)
      for (let i = 0; i < 4; i++) box(ctx, x - r * 0.4 + i * r * 0.3, y - r * 0.15 + i * r * 0.2, 2, 4, BRASS)
    }

    const guns = b >= 3 ? 2 : 1
    for (let g = 0; g < guns; g++) {
      const off = guns === 1 ? 0 : (g === 0 ? -0.22 : 0.22)
      beginAim(ctx, x, y + r * 0.1, (tw.angle || 0) + off)
      const len = r * (0.85 + a * 0.14)
      box(ctx, len * 0.55, 0, len, r * (0.16 + a * 0.02), IRON_DARK)
      disc(ctx, r * 0.35, 0, r * (0.26 + a * 0.02), IRON)
      // six chambers, always six — that is the tower's promise
      for (let i = 0; i < 6; i++) {
        const turn = (reduced ? 0 : t * 0.2) + i / 6
        disc(ctx, r * 0.35 + tcos(turn) * r * 0.15, tsin(turn) * r * 0.15, 1.1, '#171310')
      }
      box(ctx, r * 0.1, r * 0.28, r * 0.3, r * 0.4, WOOD_DARK)
      if (c >= 3) box(ctx, len * 0.95, -r * 0.16, r * 0.14, r * 0.12, BRASS)
      if (a >= 5) disc(ctx, len * 1.1, 0, r * 0.16, IRON)
      endAim(ctx)
    }
    if (c >= 5) {
      // thousand-yard sight line
      beginAim(ctx, x, y, tw.angle || 0)
      ctx.setLineDash(DASH_RUNE)
      seg(ctx, r * 1.4, 0, r * 2.6, 0, 1, 'rgba(240,225,190,0.4)')
      ctx.setLineDash(DASH_NONE)
      endAim(ctx)
    }
  }

  /* ---------- military ---------- */

  // Shoots anywhere from anywhere. A very long rifle, a bipod, and a scope.
  ART['longshot-lynx'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    oval(ctx, x, y + r * 0.15, r * 0.9, r * 0.7, 0, k.fur)
    oval(ctx, x, y + r * 0.35, r * 0.55, r * 0.4, 0, k.belly)
    head(ctx, x + dir * r * 0.35, y - r * 0.5, r * 0.85, k, dir, 'tuft', false)

    beginAim(ctx, x, y - r * 0.1, tw.angle || 0)
    const len = r * (1.5 + b * 0.1)
    box(ctx, len * 0.5, 0, len, r * (0.12 + a * 0.015), IRON_DARK)
    box(ctx, r * 0.15, r * 0.1, r * 0.7, r * 0.3, WOOD_DARK)
    if (a >= 3) box(ctx, len * 0.98, 0, r * 0.35, r * 0.22, IRON)        // muzzle brake
    if (b >= 3) box(ctx, r * 0.55, r * 0.3, r * 0.22, r * 0.42, IRON)    // magazine
    if (c >= 3) {
      box(ctx, len * 0.45, -r * 0.24, r * 0.62, r * 0.16, IRON)          // scope
      disc(ctx, len * 0.45 + r * 0.31, -r * 0.24, r * 0.1, c >= 4 ? FROST : '#2a3138')
    }
    // bipod
    seg(ctx, len * 0.8, 0, len * 0.72, r * 0.55, 1.4, IRON_DARK)
    seg(ctx, len * 0.8, 0, len * 0.9, r * 0.55, 1.4, IRON_DARK)
    if (a >= 5) seg(ctx, len * 1.15, 0, len * 2.6, 0, 1, 'rgba(255,120,90,0.35)')
    endAim(ctx)
    if (c >= 5) ringOf(ctx, x, y, r * 1.36, 1.4, 'rgba(111,201,232,0.45)')
  }

  // Works from under the surface, firing upward. Spear count, sonar, harpoon line.
  ART['diver-otter'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // half-submerged: the waterline crosses the body
    oval(ctx, x, y - r * 0.1, r * 0.72, r * 0.85, dir * 0.1, k.fur)
    head(ctx, x + dir * r * 0.25, y - r * 0.85, r * 0.8, k, dir, 'round', true)
    // waterline over the top of the body
    oval(ctx, x, y + r * 0.5, r * 1.3, r * 0.5, 0, 'rgba(44,79,99,0.75)')
    arcOf(ctx, x, y + r * 0.5, r * 1.3, Math.PI, TAU, 1.4, WATER_LIGHT)

    const spears = 1 + (a >= 3 ? 1 : 0) + (a >= 5 ? 1 : 0)
    for (let i = 0; i < spears; i++) {
      beginAim(ctx, x, y - r * 0.3, (tw.angle || 0) + (i - (spears - 1) * 0.5) * 0.26)
      const len = r * (1.15 + a * 0.08)
      seg(ctx, 0, 0, len, 0, 1.8, WOOD)
      tri(ctx, len, -r * 0.16, len + r * 0.42, 0, len, r * 0.16, c >= 3 ? IRON : FROST)
      if (c >= 3) {
        seg(ctx, 0, 0, len * 0.5, r * 0.4, 1, 'rgba(232,226,212,0.6)')   // harpoon line
      }
      endAim(ctx)
    }
    if (b >= 3) {
      const ph = reduced ? 0.4 : (t * 0.5) % 1
      arcOf(ctx, x, y - r * 0.2, r * (0.9 + ph * 0.9), -2.4, -0.7, 1.4, 'rgba(159,216,232,0.5)')
      arcOf(ctx, x, y - r * 0.2, r * (0.6 + ph * 0.6), -2.4, -0.7, 1.2, 'rgba(159,216,232,0.35)')
    }
    if (b >= 5 || c >= 5) ringOf(ctx, x, y + r * 0.4, r * 1.45, 1.6, 'rgba(111,168,200,0.5)')
  }

  // A dammed-up gunboat firing a fan of shot.
  ART['corsair-beaver'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // hull
    quad(ctx, x - r * 1.25, y + r * 0.15, x + r * 1.25, y + r * 0.15,
      x + r * 0.85, y + r * 0.85, x - r * 0.85, y + r * 0.85, WOOD_DARK)
    box(ctx, x, y + r * 0.15, r * 2.5, r * 0.22, WOOD)
    // beaver on deck
    oval(ctx, x - dir * r * 0.25, y - r * 0.3, r * 0.5, r * 0.6, 0, k.fur)
    head(ctx, x - dir * r * 0.1, y - r * 0.85, r * 0.68, k, dir, 'round', true)
    tail(ctx, x - dir * r * 0.25, y - r * 0.2, r * 0.9, k, dir, 'flat')

    const guns = 2 + a
    for (let i = 0; i < guns; i++) {
      const spread = ((i - (guns - 1) * 0.5) / guns) * 1.0
      beginAim(ctx, x + dir * r * 0.3, y - r * 0.05, (tw.angle || 0) + spread)
      box(ctx, r * 0.55, 0, r * (0.9 + a * 0.06), r * 0.16, IRON_DARK)
      disc(ctx, r * 1.05, 0, r * 0.12, IRON)
      endAim(ctx)
    }
    if (b >= 3) {
      // a mortar tube angled up out of the deck
      beginAim(ctx, x - dir * r * 0.7, y - r * 0.1, -1.1 * dir)
      box(ctx, r * 0.35, 0, r * 0.7, r * (0.3 + b * 0.04), IRON_DARK)
      disc(ctx, r * 0.7, 0, r * 0.22, IRON)
      endAim(ctx)
    }
    if (c >= 3) {
      seg(ctx, x, y + r * 0.1, x, y - r * 1.6, 2, WOOD)                  // mast
      tri(ctx, x, y - r * 1.55, x + dir * r * 0.75, y - r * 1.0, x, y - r * 0.5, BONE)
      if (c >= 4) tri(ctx, x, y - r * 1.6, x + dir * r * 0.5, y - r * 1.75, x, y - r * 1.9, BERRY)
    }
    if (a >= 5 || b >= 5) box(ctx, x, y + r * 0.55, r * 2.2, r * 0.14, BRASS)
  }

  // Flies a fixed circuit around its hangar and fires straight ahead.
  ART['biplane-magpie'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // the hangar stays put; the plane is what moves
    disc(ctx, x, y + r * 0.4, r * 0.55, STONE_DARK)
    ringOf(ctx, x, y + r * 0.4, r * 0.8, 1.2, 'rgba(232,226,212,0.35)')
    const orbit = r * (1.05 - a * 0.03)
    const turn = reduced ? 0.12 : t * 0.19
    const px = x + tcos(turn) * orbit
    const py = y + r * 0.1 + tsin(turn) * orbit * 0.55
    const heading = Math.atan2(tcos(turn) * 0.55, -tsin(turn))

    beginAim(ctx, px, py, heading)
    // lower and upper wing — a biplane, and a third at Airframe 5
    box(ctx, 0, r * 0.16, r * 0.3, r * 1.5, k.furDark)
    box(ctx, 0, -r * 0.16, r * 0.34, r * 1.7, k.fur)
    if (a >= 5) box(ctx, -r * 0.3, 0, r * 0.24, r * 1.2, k.furDark)
    // fuselage
    quad(ctx, r * 0.7, 0, -r * 0.5, -r * 0.2, -r * 0.65, 0, -r * 0.5, r * 0.2, k.fur)
    disc(ctx, r * 0.42, 0, r * 0.16, BONE)
    box(ctx, -r * 0.55, 0, r * 0.2, r * 0.5, k.furDark)
    // propeller
    const pspin = reduced ? 0.1 : t * 1.7
    seg(ctx, r * 0.72, tsin(pspin) * r * 0.4, r * 0.72, -tsin(pspin) * r * 0.4, 1.4, IRON)
    if (a >= 3) {
      seg(ctx, r * 0.3, -r * 0.3, r * 0.95, -r * 0.3, 1.6, IRON_DARK)
      seg(ctx, r * 0.3, r * 0.3, r * 0.95, r * 0.3, 1.6, IRON_DARK)
    }
    if (a >= 4) box(ctx, r * 0.55, 0, r * 0.7, r * 0.14, IRON)
    if (b >= 3) {
      for (let i = 0; i < 2 + b; i++) disc(ctx, -r * 0.1 + i * r * 0.16, r * 0.34, r * 0.09, '#3c3a34')
    }
    if (c >= 3) {
      box(ctx, r * 0.1, -r * 0.62, r * 0.5, r * 0.16, EMBER)
      box(ctx, r * 0.1, r * 0.62, r * 0.5, r * 0.16, EMBER)
    }
    endAim(ctx)
    if (!reduced) arcOf(ctx, x, y + r * 0.1, orbit, turn * TAU - 0.9, turn * TAU - 0.2, 1, 'rgba(232,226,212,0.18)')
  }

  // Lifts off, chases the leader, and shoves balloons back with its downwash.
  ART['rotor-kestrel'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    const lift = reduced ? 0 : Math.sin(t * 1.6) * r * 0.1
    // fuselage upright, nose turns with the target
    oval(ctx, x, y + lift, r * 0.62, r * 0.78, 0, k.fur)
    oval(ctx, x, y + lift + r * 0.2, r * 0.4, r * 0.42, 0, k.belly)
    head(ctx, x + dir * r * 0.3, y + lift - r * 0.62, r * 0.7, k, dir, 'none', true)
    // tail boom
    seg(ctx, x, y + lift + r * 0.3, x - dir * r * 1.15, y + lift + r * 0.5, 2.4, k.furDark)
    tri(ctx, x - dir * r * 1.1, y + lift + r * 0.15, x - dir * r * 1.45, y + lift + r * 0.55,
      x - dir * r * 0.95, y + lift + r * 0.6, k.furDark)

    beginAim(ctx, x, y + lift - r * 0.1, tw.angle || 0)
    const guns = 1 + (a >= 3 ? 1 : 0) + (a >= 5 ? 1 : 0)
    for (let i = 0; i < guns; i++) {
      box(ctx, r * 0.6, (i - (guns - 1) * 0.5) * r * 0.3, r * (0.9 + a * 0.07), r * 0.13, IRON_DARK)
    }
    if (c >= 3) {
      box(ctx, r * 0.35, -r * 0.45, r * 0.5, r * 0.2, EMBER)
      box(ctx, r * 0.35, r * 0.45, r * 0.5, r * 0.2, EMBER)
    }
    if (c >= 4) disc(ctx, r * 0.9, 0, r * 0.14, FROST)
    endAim(ctx)

    // rotor disc: two blades and a blur ring, above everything
    const spin = reduced ? 0.07 : t * 1.3
    const blade = r * (1.25 + b * 0.09)
    seg(ctx, x - tcos(spin) * blade, y + lift - r * 1.0 - tsin(spin) * blade * 0.2,
      x + tcos(spin) * blade, y + lift - r * 1.0 + tsin(spin) * blade * 0.2, 2, IRON_DARK)
    seg(ctx, x - tsin(spin) * blade, y + lift - r * 1.0 + tcos(spin) * blade * 0.2,
      x + tsin(spin) * blade, y + lift - r * 1.0 - tcos(spin) * blade * 0.2, 2, IRON)
    disc(ctx, x, y + lift - r * 1.0, r * 0.14, BRASS)
    if (b >= 3) {
      const ph = reduced ? 0.5 : (t * 0.7) % 1
      ringOf(ctx, x, y + r * 0.7, r * (0.8 + ph * 0.8), 1.4, 'rgba(188,216,232,0.45)')
      if (b >= 4) ringOf(ctx, x, y + r * 0.7, r * (1.2 + ph * 0.6), 1.2, 'rgba(188,216,232,0.3)')
    }
  }

  // Dug in with a fixed gun. Shells a point, over anything in the way.
  ART['howitzer-mole'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // spoil heap
    oval(ctx, x, y + r * 0.55, r * 1.15, r * 0.5, 0, EARTH)
    arcOf(ctx, x, y + r * 0.55, r * 1.0, 3.3, 6.1, 1.4, EARTH_EDGE)
    // mole out of the hole: broad hands and a pink snout
    oval(ctx, x, y + r * 0.1, r * 0.6, r * 0.62, 0, k.fur)
    head(ctx, x + dir * r * 0.15, y - r * 0.4, r * 0.62, k, dir, 'none', true)
    disc(ctx, x - dir * r * 0.55, y + r * 0.3, r * 0.22, k.belly)

    beginAim(ctx, x, y - r * 0.25, tw.angle || 0)
    const len = r * (1.15 + a * 0.14)
    const wide = r * (0.2 + a * 0.035)
    box(ctx, len * 0.5, 0, len, wide * 2, IRON_DARK)
    box(ctx, len * 0.98, 0, r * 0.28, wide * 2.5, IRON)
    box(ctx, -r * 0.15, 0, r * 0.5, wide * 3, b >= 3 ? mix(IRON_DARK, EMBER, 0.35) : IRON_DARK)
    if (a >= 3) {
      seg(ctx, r * 0.3, -wide * 2, r * 0.3, wide * 2, 1.6, BRASS)
      seg(ctx, len * 0.7, -wide * 1.6, len * 0.7, wide * 1.6, 1.6, BRASS)
    }
    if (c >= 3) tri(ctx, len * 1.1, -wide, len * 1.5, 0, len * 1.1, wide, c >= 4 ? BRASS : IRON)
    if (b >= 4) disc(ctx, len * 1.25, 0, r * 0.16, EMBER)
    endAim(ctx)
    if (a >= 5) {
      // siege battery: sandbags
      for (let i = 0; i < 3; i++) oval(ctx, x - r * 0.8 + i * r * 0.8, y + r * 0.9, r * 0.32, r * 0.18, 0, mix(EARTH, BONE, 0.35))
    }
  }

  // Winds up while it holds a target. Barrels, then a cooling jacket, then a core.
  ART['gatling-raccoon'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    body(ctx, x, y, r * 0.95, k, 0)
    // the mask is the raccoon
    const hx = x + dir * r * 0.16, hy = y - r * 0.82
    head(ctx, hx, hy, r * 0.95, k, dir, 'round', true)
    box(ctx, hx + dir * r * 0.1, hy - r * 0.05, r * 0.85, r * 0.2, OUT)
    tail(ctx, x, y, r, k, dir, 'brush')
    for (let i = 0; i < 3; i++) {
      arcOf(ctx, x - dir * r * 1.35, y + r * 0.1, r * 0.24 + i * r * 0.09, -1.2, 1.2, 1.6, i & 1 ? BONE : k.furDark)
    }

    beginAim(ctx, x + dir * r * 0.1, y, tw.angle || 0)
    const barrels = 3 + a
    const len = r * (1.05 + a * 0.06)
    const spin = reduced ? 0 : t * 0.9
    for (let i = 0; i < barrels; i++) {
      const turn = spin + i / barrels
      const oy = tsin(turn) * r * 0.24
      box(ctx, len * 0.5, oy, len, r * 0.12, tcos(turn) > 0 ? IRON : IRON_DARK)
    }
    disc(ctx, r * 0.2, 0, r * 0.34, IRON_DARK)
    if (b >= 3) ringOf(ctx, len * 0.6, 0, r * 0.3, 2, b >= 4 ? FROST : IRON)
    if (c >= 3) {
      disc(ctx, -r * 0.2, 0, r * 0.26, c >= 4 ? '#b678e8' : ARCANE)
      ringOf(ctx, -r * 0.2, 0, r * 0.38, 1.4, c >= 4 ? '#b678e8' : ARCANE)
    }
    if (c >= 5) seg(ctx, len * 1.1, 0, len * 2.0, 0, 2.4, 'rgba(182,120,232,0.4)')
    endAim(ctx)
  }

  /* ---------- magic ---------- */

  // Scratches runes in the air and flicks them off. Rune count is the upgrade.
  ART['rune-weasel'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    oval(ctx, x, y, r * 0.58, r * 0.95, dir * 0.14, k.fur)
    oval(ctx, x, y + r * 0.25, r * 0.36, r * 0.5, 0, k.belly)
    head(ctx, x + dir * r * 0.28, y - r * 0.85, r * 0.8, k, dir, 'round', true)
    tail(ctx, x, y, r, k, dir, 'thin')

    const glyphCol = b >= 3 ? EMBER : k.accent
    const runes = 1 + a
    const spin = reduced ? 0 : t * 0.09
    for (let i = 0; i < runes; i++) {
      const turn = spin + i / runes
      const gx = x + tcos(turn) * r * 1.05
      const gy = y - r * 0.5 + tsin(turn) * r * 0.55
      ngon(ctx, gx, gy, r * (0.16 + a * 0.015), 3, turn + 0.12, glyphCol)
      seg(ctx, gx - r * 0.12, gy, gx + r * 0.12, gy, 1, shade(glyphCol, 1.5))
    }
    beginAim(ctx, x, y - r * 0.2, tw.angle || 0)
    paw(ctx, 0, 0, 0, r * 0.85, r * 0.18, k)
    disc(ctx, r * 0.95, 0, r * (0.16 + b * 0.02), glyphCol)
    if (b >= 4) ringOf(ctx, r * 0.95, 0, r * 0.3, 1.2, glyphCol)
    endAim(ctx)
    if (c >= 3) {
      // familiars: little bound orbs that follow it around
      const fam = c >= 4 ? (c >= 5 ? 3 : 2) : 1
      for (let i = 0; i < fam; i++) {
        const turn = (reduced ? 0.25 : -t * 0.14) + i / fam
        const fx = x + tcos(turn) * r * 1.4
        const fy = y + tsin(turn) * r * 1.4
        disc(ctx, fx, fy, r * 0.2, '#c9f7ff')
        disc(ctx, fx, fy, r * 0.1, ARCANE)
      }
    }
  }

  // Very old, entirely out of patience. Fires faster than anything else.
  ART['elder-owl'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // barrel body, flat head, spectacles
    oval(ctx, x, y, r * 0.86, r * 0.98, 0, k.fur)
    oval(ctx, x, y + r * 0.15, r * 0.55, r * 0.62, 0, k.belly)
    // wing feathers
    for (let i = 0; i < 3; i++) {
      arcOf(ctx, x - r * 0.6, y + r * 0.1, r * (0.3 + i * 0.14), -1.9, -0.2, 1.6, k.furDark)
      arcOf(ctx, x + r * 0.6, y + r * 0.1, r * (0.3 + i * 0.14), -2.9, -1.2, 1.6, k.furDark)
    }
    const hy = y - r * 0.72
    disc(ctx, x, hy, r * 0.58, k.fur)
    // the owl turns its head, not its body
    const look = Math.cos(tw.angle || 0) * r * 0.14
    const eyeR = r * (0.22 + (b >= 3 ? 0.05 : 0))
    disc(ctx, x - r * 0.24 + look, hy, eyeR, BONE)
    disc(ctx, x + r * 0.24 + look, hy, eyeR, BONE)
    disc(ctx, x - r * 0.24 + look * 1.6, hy, eyeR * 0.5, OUT)
    disc(ctx, x + r * 0.24 + look * 1.6, hy, eyeR * 0.5, OUT)
    ringOf(ctx, x - r * 0.24 + look, hy, eyeR * 1.15, 1.2, BRASS)
    ringOf(ctx, x + r * 0.24 + look, hy, eyeR * 1.15, 1.2, BRASS)
    seg(ctx, x - r * 0.08 + look, hy, x + r * 0.08 + look, hy, 1.2, BRASS)
    tri(ctx, x + look, hy + r * 0.16, x + look + r * 0.1, hy + r * 0.36, x + look - r * 0.1, hy + r * 0.36, BRASS)
    // ear tufts
    tri(ctx, x - r * 0.5, hy - r * 0.2, x - r * 0.62, hy - r * 0.7, x - r * 0.24, hy - r * 0.42, k.furDark)
    tri(ctx, x + r * 0.5, hy - r * 0.2, x + r * 0.62, hy - r * 0.7, x + r * 0.24, hy - r * 0.42, k.furDark)

    const bolts = 1 + c
    const col = a >= 4 ? '#b678e8' : k.accent
    for (let i = 0; i < bolts; i++) {
      beginAim(ctx, x, y, (tw.angle || 0) + (i - (bolts - 1) * 0.5) * 0.3)
      const reach = r * (1.0 + a * 0.06)
      disc(ctx, reach, 0, r * (0.14 + a * 0.02), col)
      if (a >= 3) seg(ctx, reach * 0.6, 0, reach * 1.25, 0, 1.6, col)
      endAim(ctx)
    }
    if (b >= 5 || c >= 5) {
      const spin = reduced ? 0 : t * 0.05
      for (let i = 0; i < 8; i++) {
        const turn = spin + i / 8
        seg(ctx, x + tcos(turn) * r * 1.3, y + tsin(turn) * r * 1.3,
          x + tcos(turn) * r * 1.6, y + tsin(turn) * r * 1.6, 1.4, col)
      }
    }
  }

  // Throws paired stars out of the dark. Sees Veiled balloons from the start.
  ART['shadow-marten'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // the shadow it stands in
    oval(ctx, x, y + r * 0.5, r * 1.25, r * 0.55, 0, 'rgba(18,16,26,0.6)')
    oval(ctx, x, y, r * 0.6, r * 0.92, dir * 0.12, k.fur)
    oval(ctx, x, y + r * 0.3, r * 0.34, r * 0.42, 0, k.belly)
    head(ctx, x + dir * r * 0.26, y - r * 0.82, r * 0.78, k, dir, 'point', true)
    // masked band across the eyes — it is a night hunter
    box(ctx, x + dir * r * 0.26, y - r * 0.86, r * 0.7, r * 0.16, '#100e16')
    tail(ctx, x, y, r, k, dir, 'thin')

    const stars = 2 + c
    const spin = reduced ? 0 : t * 0.4
    for (let i = 0; i < stars; i++) {
      beginAim(ctx, x, y - r * 0.1, (tw.angle || 0) + (i - (stars - 1) * 0.5) * 0.28)
      const reach = r * (0.95 + c * 0.04)
      star(ctx, reach, 0, r * (0.2 + b * 0.015), 4, spin + i * 0.1, c >= 4 ? '#e8d67d' : k.accent)
      endAim(ctx)
    }
    if (a >= 3) {
      const ph = reduced ? 0 : t * 0.12
      arcOf(ctx, x, y, r * 1.25, ph * TAU, ph * TAU + 1.6, 1.6, 'rgba(207,214,204,0.4)')
      if (a >= 4) arcOf(ctx, x, y, r * 1.45, ph * TAU + 2.2, ph * TAU + 3.6, 1.4, 'rgba(207,214,204,0.28)')
    }
    if (b >= 3) {
      for (let i = 0; i < 3; i++) {
        disc(ctx, x - dir * r * (0.9 + i * 0.28), y - r * (0.2 + i * 0.28), r * (0.22 - i * 0.04), 'rgba(60,56,70,0.7)')
      }
    }
  }

  // Barely fights. Brews tonics that make everything around it hit harder.
  ART['brewer-toad'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // the vat is most of the sprite, and it grows with Wider Cellar
    const vw = r * (0.95 + c * 0.07)
    quad(ctx, x - vw, y - r * 0.1, x + vw, y - r * 0.1,
      x + vw * 0.8, y + r * 0.8, x - vw * 0.8, y + r * 0.8, WOOD_DARK)
    oval(ctx, x, y - r * 0.1, vw, r * 0.3, 0, b >= 3 ? '#d4ff3c' : k.accent)
    for (let i = 0; i < 2; i++) box(ctx, x, y + r * (0.2 + i * 0.35), vw * 2 * (1 - i * 0.12), r * 0.12, BRASS)
    // toad on the rim
    oval(ctx, x - dir * r * 0.05, y - r * 0.75, r * 0.66, r * 0.5, 0, k.fur)
    disc(ctx, x + dir * r * 0.3, y - r * 0.95, r * 0.16, BONE)
    disc(ctx, x - dir * r * 0.28, y - r * 0.98, r * 0.16, BONE)
    disc(ctx, x + dir * r * 0.3, y - r * 0.95, r * 0.08, OUT)
    disc(ctx, x - dir * r * 0.28, y - r * 0.98, r * 0.08, OUT)
    arcOf(ctx, x - dir * r * 0.05, y - r * 0.78, r * 0.4, 0.3, 2.8, 1.2, OUT)

    // bubbles: the idle animation
    if (!reduced) {
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i * 0.33) % 1
        disc(ctx, x + M.jitter(tw.id | 0, i) * vw * 0.5, y - r * 0.1 - ph * r * 0.9,
          r * 0.1 * (1 - ph * 0.5), 'rgba(212,255,60,0.55)')
      }
    }
    // the ladle turns toward whatever it is watching
    beginAim(ctx, x + dir * r * 0.2, y - r * 0.35, tw.angle || 0)
    seg(ctx, 0, 0, r * 0.8, -r * 0.2, 1.8, WOOD)
    disc(ctx, r * 0.85, -r * 0.22, r * 0.18, BRASS)
    endAim(ctx)

    if (a >= 3) {
      // a rack of tonics on the side
      for (let i = 0; i < 2 + (a >= 4 ? 2 : 0); i++) {
        const fx = x - vw - r * 0.25 + (i % 2) * r * 0.3
        const fy = y + r * (0.1 + ((i / 2) | 0) * 0.35)
        box(ctx, fx, fy, r * 0.2, r * 0.3, k.accent)
        box(ctx, fx, fy - r * 0.2, r * 0.08, r * 0.12, WOOD_DARK)
      }
    }
    // the aura it actually sells
    ctx.setLineDash(DASH_RUNE)
    ringOf(ctx, x, y + r * 0.2, r * (1.45 + c * 0.12), 1.2, 'rgba(168,224,74,0.4)')
    ctx.setLineDash(DASH_NONE)
  }

  // Roots itself and throws thorns. The longer the round, the angrier it gets.
  ART['thornroot-stag'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // roots
    for (let i = 0; i < 4; i++) {
      const turn = 0.06 + i / 8
      seg(ctx, x, y + r * 0.5, x + tcos(turn + 0.25) * r * 1.15, y + r * 0.5 + Math.abs(tsin(turn)) * r * 0.5, 2.2, WOOD_DARK)
    }
    oval(ctx, x, y, r * 0.7, r * 0.95, 0, k.fur)
    oval(ctx, x, y + r * 0.25, r * 0.44, r * 0.5, 0, k.belly)
    const hy = y - r * 0.9
    head(ctx, x + dir * r * 0.1, hy, r * 0.72, k, dir, 'none', true)
    // antlers: one more tine per Season's Growth tier
    const tines = 2 + a
    for (let s = -1; s <= 1; s += 2) {
      const bx = x + s * r * 0.28
      seg(ctx, bx, hy - r * 0.3, bx + s * r * 0.35, hy - r * 1.25, 2.2, k.accent2)
      for (let i = 0; i < tines; i++) {
        const p = (i + 1) / (tines + 1)
        seg(ctx, bx + s * r * 0.35 * p, hy - r * 0.3 - r * 0.95 * p,
          bx + s * r * (0.35 * p + 0.34), hy - r * 0.3 - r * (0.95 * p + 0.28), 1.6, k.accent2)
      }
    }
    beginAim(ctx, x, y - r * 0.2, tw.angle || 0)
    const reach = r * (0.9 + a * 0.05)
    tri(ctx, reach, -r * 0.16, reach + r * 0.5, 0, reach, r * 0.16, b >= 4 ? k.accent2 : LEAF)
    seg(ctx, r * 0.3, 0, reach, 0, 1.8, k.furDark)
    endAim(ctx)

    if (b >= 3) {
      // a ring of brambles around the base
      const n = 8 + b * 2
      for (let i = 0; i < n; i++) {
        const turn = i / n
        tri(ctx, x + tcos(turn) * r * 1.15, y + r * 0.35 + tsin(turn) * r * 0.45,
          x + tcos(turn) * r * 1.35, y + r * 0.3 + tsin(turn) * r * 0.55,
          x + tcos(turn) * r * 1.1, y + r * 0.5 + tsin(turn) * r * 0.5, LEAF)
      }
    }
    if (c >= 3) {
      // a thunderhead gathering overhead
      oval(ctx, x, y - r * 1.9, r * 0.85, r * 0.35, 0, '#4a5560')
      oval(ctx, x - r * 0.45, y - r * 1.8, r * 0.4, r * 0.26, 0, '#3e4852')
      if (c >= 4) {
        const flash = reduced ? 1 : (Math.sin(t * 3.1) > 0.7 ? 1 : 0.25)
        ctx.globalAlpha = flash
        seg(ctx, x + r * 0.2, y - r * 1.6, x - r * 0.1, y - r * 1.15, 1.6, '#f2e9a0')
        ctx.globalAlpha = 1
      }
    }
  }

  // Calls the tide up at the track. Shoves, and freezes what it cannot shove.
  ART['tidecaller-newt'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // the well it draws from
    ringOf(ctx, x, y + r * 0.55, r * (0.75 + c * 0.06), 3, STONE)
    disc(ctx, x, y + r * 0.55, r * (0.6 + c * 0.05), WATER)
    oval(ctx, x, y - r * 0.1, r * 0.55, r * 0.8, dir * 0.1, k.fur)
    oval(ctx, x, y + r * 0.1, r * 0.32, r * 0.42, 0, k.belly)
    head(ctx, x + dir * r * 0.25, y - r * 0.85, r * 0.7, k, dir, 'none', true)
    // crest along the spine
    for (let i = 0; i < 3; i++) {
      tri(ctx, x - dir * r * 0.1, y - r * (0.5 - i * 0.3), x - dir * r * 0.45, y - r * (0.62 - i * 0.3),
        x - dir * r * 0.1, y - r * (0.25 - i * 0.3), k.accent)
    }
    tail(ctx, x, y, r, k, dir, 'thin')

    beginAim(ctx, x, y - r * 0.2, tw.angle || 0)
    // a wave crest raised in front, taller with Tidecaller
    const h = r * (0.55 + c * 0.12)
    ctx.fillStyle = 'rgba(127,198,232,0.75)'
    ctx.beginPath()
    ctx.moveTo(r * 0.5, r * 0.3)
    ctx.quadraticCurveTo(r * 1.0, -h, r * (1.5 + a * 0.1), -h * 0.3)
    ctx.lineTo(r * 1.4, r * 0.35)
    ctx.closePath()
    ctx.fill()
    arcOf(ctx, r * 1.2, -h * 0.4, r * 0.3, -1.2, 1.6, 1.6, '#cdeeff')
    if (b >= 3) {
      for (let i = 0; i < 2 + b; i++) {
        tri(ctx, r * (0.8 + i * 0.2), -h * 0.5, r * (0.95 + i * 0.2), -h * 1.0, r * (1.05 + i * 0.2), -h * 0.4, '#eaf8ff')
      }
    }
    if (a >= 3) {
      const ph = reduced ? 0.3 : (t * 0.6) % 1
      arcOf(ctx, r * 1.1, 0, r * (0.5 + ph * 0.7), -1.9, 1.9, 1.4, 'rgba(205,238,255,0.4)')
    }
    endAim(ctx)
    if (c >= 5) ringOf(ctx, x, y + r * 0.3, r * 1.5, 1.8, 'rgba(127,198,232,0.5)')
  }

  /* ---------- support ---------- */

  // A burrow under a bramble. It picks berries and sells them; it will not fight.
  ART['berry-warren'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // the mound and the hole
    oval(ctx, x, y + r * 0.25, r * 1.1, r * 0.85, 0, k.fur)
    oval(ctx, x, y + r * 0.55, r * 0.34, r * 0.26, 0, '#20180f')
    // bramble canopy, one more bush per Richer Berries tier
    const bushes = 2 + a
    for (let i = 0; i < bushes; i++) {
      const p = i / bushes
      disc(ctx, x - r * 0.8 + p * r * 1.7, y - r * (0.4 + (i % 2) * 0.3), r * (0.42 - (i % 2) * 0.06), i & 1 ? shade(LEAF, 0.85) : LEAF)
    }
    const berries = 3 + a * 2
    for (let i = 0; i < berries; i++) {
      const j = M.jitter(tw.id | 0, i)
      disc(ctx, x + j * r * 0.95, y - r * (0.25 + Math.abs(M.jitter(tw.id | 0, i + 40)) * 0.55), r * 0.12, BERRY)
    }
    // a rabbit looking out — the only moving part
    const bob = reduced ? 0 : Math.sin(t * 2.4) * r * 0.08
    const rx = x + dir * r * 0.1
    disc(ctx, rx, y + r * 0.35 + bob, r * 0.26, k.belly)
    oval(ctx, rx - r * 0.12, y + r * 0.1 + bob, r * 0.08, r * 0.24, -0.15, k.belly)
    oval(ctx, rx + r * 0.12, y + r * 0.1 + bob, r * 0.08, r * 0.24, 0.15, k.belly)
    disc(ctx, rx - r * 0.08, y + r * 0.32 + bob, r * 0.05, OUT)
    disc(ctx, rx + r * 0.08, y + r * 0.32 + bob, r * 0.05, OUT)

    if (b >= 3) {
      // the bank: a cellar door and a stack of coins
      quad(ctx, x + r * 0.6, y + r * 0.75, x + r * 1.25, y + r * 0.6,
        x + r * 1.25, y + r * 0.95, x + r * 0.6, y + r * 1.0, WOOD_DARK)
      for (let i = 0; i < 1 + (b >= 4 ? 2 : 0); i++) {
        oval(ctx, x + r * 0.95, y + r * (0.55 - i * 0.14), r * 0.2, r * 0.08, 0, COIN)
      }
    }
    if (c >= 3) {
      for (let i = 0; i < 3; i++) {
        disc(ctx, x - r * (1.0 + i * 0.1), y + r * (0.1 + i * 0.3), r * 0.2, shade(LEAF, 1.15))
      }
    }
    if (a >= 5 || b >= 5 || c >= 5) {
      for (let i = 0; i < 4; i++) {
        const turn = (reduced ? 0 : t * 0.08) + i / 4
        disc(ctx, x + tcos(turn) * r * 1.3, y + tsin(turn) * r * 0.7, r * 0.1, COIN)
      }
    }
  }

  // Trundles the verge dropping seed cases of hard thorns.
  ART['caltrop-beetle'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // scattered pods around it — where the danger actually is
    const pods = 2 + a
    for (let i = 0; i < pods; i++) {
      const px = x + M.jitter(tw.id | 0, i) * r * 1.5
      const py = y + r * 0.5 + M.jitter(tw.id | 0, i + 17) * r * 0.5
      if (c >= 3) star(ctx, px, py, r * 0.22, 4, 0.05, k.accent2)
      else disc(ctx, px, py, r * 0.16, k.accent)
      if (b >= 3) {
        for (let s = 0; s < 4; s++) {
          const turn = s / 4 + 0.06
          seg(ctx, px, py, px + tcos(turn) * r * 0.3, py + tsin(turn) * r * 0.3, 1.2, k.accent2)
        }
      }
    }
    // carapace with a split down the middle
    oval(ctx, x, y, r * 0.85, r * 0.7, 0, k.fur)
    oval(ctx, x, y - r * 0.05, r * 0.7, r * 0.55, 0, k.furDark)
    seg(ctx, x, y - r * 0.55, x, y + r * 0.5, 1.4, OUT)
    disc(ctx, x + dir * r * 0.8, y - r * 0.1, r * 0.3, k.fur)
    disc(ctx, x + dir * r * 0.9, y - r * 0.16, r * 0.07, OUT)
    // antennae and legs
    seg(ctx, x + dir * r * 0.9, y - r * 0.3, x + dir * r * 1.3, y - r * 0.6, 1.2, k.furDark)
    seg(ctx, x + dir * r * 0.9, y - r * 0.3, x + dir * r * 1.25, y - r * 0.2, 1.2, k.furDark)
    for (let i = 0; i < 3; i++) {
      const lx = x - r * 0.5 + i * r * 0.5
      seg(ctx, lx, y + r * 0.3, lx - r * 0.15, y + r * 0.65, 1.4, k.furDark)
      seg(ctx, lx, y - r * 0.3, lx - r * 0.15, y - r * 0.6, 1.4, k.furDark)
    }
    if (a >= 4) ringOf(ctx, x, y + r * 0.3, r * (1.5 + a * 0.06), 1.2, 'rgba(142,122,63,0.4)')
  }

  // A hall dug into the hillside. Nobody inside fights; everybody outside does.
  ART['warren-hall'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    // stone hall
    box(ctx, x, y + r * 0.3, r * 1.6, r * 0.9, k.fur)
    quad(ctx, x - r * 0.95, y - r * 0.15, x + r * 0.95, y - r * 0.15, x + r * 0.6, y - r * 0.75, x - r * 0.6, y - r * 0.75, k.furDark)
    box(ctx, x, y + r * 0.45, r * 0.4, r * 0.6, '#2a2118')
    arcOf(ctx, x, y + r * 0.16, r * 0.2, Math.PI, TAU, r * 0.2, '#2a2118')
    for (let i = -1; i <= 1; i += 2) {
      box(ctx, x + i * r * 0.55, y + r * 0.2, r * 0.26, r * 0.26, b >= 3 ? COIN : '#3a3228')
    }
    if (a >= 3) {
      // watchtower on the end
      box(ctx, x + r * 1.0, y - r * 0.1, r * 0.5, r * 1.6, k.fur)
      box(ctx, x + r * 1.0, y - r * 0.85, r * 0.7, r * 0.24, k.furDark)
      if (a >= 4) {
        seg(ctx, x + r * 1.0, y - r * 1.0, x + r * 1.0, y - r * 1.6, 1.6, WOOD)
        tri(ctx, x + r * 1.0, y - r * 1.6, x + r * 1.6, y - r * 1.42, x + r * 1.0, y - r * 1.25, BERRY)
      }
    }
    if (b >= 3) {
      // lanterns along the eaves
      for (let i = 0; i < 3; i++) disc(ctx, x - r * 0.7 + i * r * 0.7, y - r * 0.2, r * 0.1, COIN)
    }
    if (c >= 3) {
      // a forge chimney with embers
      box(ctx, x - r * 1.05, y - r * 0.4, r * 0.34, r * 1.0, STONE_DARK)
      const puff = reduced ? 0.5 : (t * 0.4) % 1
      disc(ctx, x - r * 1.05, y - r * 1.0 - puff * r * 0.5, r * (0.16 - puff * 0.06), 'rgba(226,99,44,0.7)')
      if (c >= 4) disc(ctx, x - r * 1.05, y - r * 0.75, r * 0.12, EMBER)
    }
    // the aura, which is the whole point of the building
    ctx.setLineDash(DASH_RUNE)
    ringOf(ctx, x, y + r * 0.2, r * (1.6 + a * 0.1), 1.2, 'rgba(240,193,75,0.35)')
    ctx.setLineDash(DASH_NONE)
  }

  // Runs between towers with a satchel of springs, winding one of them up.
  ART['tinker-shrew'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    oval(ctx, x, y, r * 0.6, r * 0.85, dir * 0.1, k.fur)
    oval(ctx, x, y + r * 0.25, r * 0.38, r * 0.45, 0, k.belly)
    head(ctx, x + dir * r * 0.3, y - r * 0.8, r * 0.72, k, dir, 'round', true)
    // goggles
    disc(ctx, x + dir * r * 0.42, y - r * 0.9, r * 0.16, BRASS)
    disc(ctx, x + dir * r * 0.1, y - r * 0.95, r * 0.16, BRASS)
    seg(ctx, x - dir * r * 0.05, y - r * 0.95, x + dir * r * 0.55, y - r * 0.88, 1.4, WOOD_DARK)
    // satchel
    box(ctx, x - dir * r * 0.55, y + r * 0.2, r * 0.45, r * 0.4, WOOD_DARK)
    tail(ctx, x, y, r, k, dir, 'thin')

    // gears, one more per Overclock tier
    const gears = 1 + a
    for (let i = 0; i < gears; i++) {
      const gx = x - dir * r * (0.85 + i * 0.35)
      const gy = y - r * (0.35 + i * 0.25)
      const spin = reduced ? 0 : t * (0.3 + i * 0.1) * (i & 1 ? -1 : 1)
      disc(ctx, gx, gy, r * 0.2, BRASS)
      for (let s = 0; s < 6; s++) {
        const turn = spin + s / 6
        seg(ctx, gx + tcos(turn) * r * 0.18, gy + tsin(turn) * r * 0.18,
          gx + tcos(turn) * r * 0.28, gy + tsin(turn) * r * 0.28, 1.4, BRASS)
      }
      disc(ctx, gx, gy, r * 0.07, WOOD_DARK)
    }
    // the spanner turns toward whatever it is winding
    beginAim(ctx, x + dir * r * 0.2, y - r * 0.1, tw.angle || 0)
    seg(ctx, 0, 0, r * 0.85, 0, 2.2, IRON)
    arcOf(ctx, r * 0.95, 0, r * 0.2, 0.8, 5.5, 2.2, IRON)
    endAim(ctx)

    if (b >= 3) box(ctx, x - dir * r * 0.9, y + r * 0.55, r * 0.5, r * 0.3, IRON_DARK)
    if (c >= 3) {
      // a tinker turret of its own, bolted together out of scrap
      const bx = x + dir * r * 1.25
      box(ctx, bx, y + r * 0.5, r * 0.45, r * 0.35, IRON_DARK)
      disc(ctx, bx, y + r * 0.2, r * 0.24, IRON)
      beginAim(ctx, bx, y + r * 0.2, tw.angle || 0)
      box(ctx, r * 0.3, 0, r * 0.6, r * 0.1, IRON)
      if (c >= 4) box(ctx, r * 0.3, -r * 0.16, r * 0.6, r * 0.1, IRON)
      endAim(ctx)
    }
  }

  // Stands very still with a glove on. The bird decides where it is needed.
  ART['falconer-ferret'] = function (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers[0], b = tw.tiers[1], c = tw.tiers[2]
    oval(ctx, x, y, r * 0.58, r * 0.95, 0, k.fur)
    oval(ctx, x, y + r * 0.25, r * 0.36, r * 0.5, 0, k.belly)
    head(ctx, x + dir * r * 0.2, y - r * 0.85, r * 0.72, k, dir, 'round', true)
    tail(ctx, x, y, r, k, dir, 'thin')
    // the glove: a big padded fist held out on the aim side
    const gx = x + dir * r * 0.75
    const gy = y - r * 0.35
    seg(ctx, x + dir * r * 0.2, y - r * 0.2, gx, gy, r * 0.2, k.furDark)
    disc(ctx, gx, gy, r * 0.28, WOOD)
    if (b >= 3) box(ctx, x - dir * r * 0.7, y + r * 0.35, r * 0.5, r * 0.4, WOOD_DARK)

    // The bird is perched when motion is reduced and circling when it is not —
    // the clearest possible statement of what reducedMotion turns off.
    const wing = r * (0.55 + a * 0.06)
    let bx, by, bang
    if (reduced) {
      bx = gx; by = gy - r * 0.45; bang = -dir * 0.3
    } else {
      const turn = t * 0.16
      bx = x + tcos(turn) * r * 1.7
      by = y - r * 0.6 + tsin(turn) * r * 0.8
      bang = Math.atan2(tcos(turn) * 0.8, -tsin(turn) * 1.7)
    }
    beginAim(ctx, bx, by, bang)
    const flap = reduced ? 0.55 : 0.35 + Math.abs(Math.sin(t * 4)) * 0.5
    quad(ctx, 0, 0, -wing * 0.4, -wing * flap * 1.5, -wing * 1.1, -wing * flap * 1.1, -wing * 0.3, 0, k.accent)
    quad(ctx, 0, 0, -wing * 0.4, wing * flap * 1.5, -wing * 1.1, wing * flap * 1.1, -wing * 0.3, 0, shade(k.accent, 0.85))
    oval(ctx, 0, 0, wing * 0.42, wing * 0.24, 0, k.accent2)
    tri(ctx, wing * 0.4, 0, wing * 0.7, wing * 0.06, wing * 0.4, wing * 0.12, c >= 3 ? BRASS : OUT)
    disc(ctx, wing * 0.25, -wing * 0.05, wing * 0.06, OUT)
    if (c >= 3) {
      seg(ctx, -wing * 0.1, wing * 0.2, -wing * 0.25, wing * 0.5, 1.4, BRASS)
      seg(ctx, wing * 0.1, wing * 0.2, wing * 0.25, wing * 0.5, 1.4, BRASS)
    }
    if (a >= 5 || c >= 5) star(ctx, -wing * 1.3, 0, wing * 0.25, 4, 0.1, COIN)
    endAim(ctx)
  }

  /* ---------- fallbacks ----------
     A tower added later, or a test fixture's throwaway tower, must still read as a
     critter rather than a magenta placeholder. The fallback varies with the key so
     two unknown towers never draw identically. */

  function genericArt (ctx, tw, x, y, r, k, t, reduced, dir) {
    const a = tw.tiers ? tw.tiers[0] : 0
    const b = tw.tiers ? tw.tiers[1] : 0
    const c = tw.tiers ? tw.tiers[2] : 0
    tail(ctx, x, y, r, k, dir, k.tailKind)
    body(ctx, x, y, r, k, 0)
    head(ctx, x + dir * r * 0.18, y - r * 0.8, r, k, dir, k.earKind, true)
    beginAim(ctx, x, y - r * 0.1, tw.angle || 0)
    const len = r * (0.9 + a * 0.1)
    box(ctx, len * 0.5, 0, len, r * (0.16 + b * 0.02), k.metalDark)
    disc(ctx, len, 0, r * (0.16 + a * 0.02), k.metal)
    if (c >= 3) box(ctx, len * 0.5, -r * 0.22, r * 0.5, r * 0.12, k.metal)
    endAim(ctx)
    if (b >= 3) disc(ctx, x - dir * r * 0.7, y + r * 0.3, r * 0.25, k.accent)
  }

  /** Heroes: taller, cloaked, and armed. Level is drawn by the shared wrapper. */
  function heroArt (ctx, tw, x, y, r, k, t, reduced, dir) {
    const lvl = tw.level === undefined ? 1 : tw.level
    // cloak, which lengthens as the hero levels
    const cloak = r * (0.9 + M.clamp01(lvl / 20) * 0.7)
    quad(ctx, x - r * 0.55, y - r * 0.4, x + r * 0.55, y - r * 0.4,
      x + r * 0.8, y + cloak, x - r * 0.8, y + cloak, k.furDark)
    oval(ctx, x, y, r * 0.6, r * 0.9, 0, k.fur)
    oval(ctx, x, y + r * 0.2, r * 0.36, r * 0.46, 0, k.belly)
    head(ctx, x + dir * r * 0.2, y - r * 0.88, r * 0.85, k, dir, k.earKind, true)
    tail(ctx, x, y, r, k, dir, k.tailKind)

    // the weapon grows in stages, so a level-20 hero is a different silhouette
    beginAim(ctx, x, y - r * 0.2, tw.angle || 0)
    const len = r * (1.0 + M.clamp01(lvl / 20) * 0.7)
    seg(ctx, 0, 0, len, 0, 2.4, WOOD_DARK)
    disc(ctx, len, 0, r * (0.18 + M.clamp01(lvl / 20) * 0.14), k.accent)
    if (lvl >= 5) ringOf(ctx, len, 0, r * 0.3, 1.4, k.accent2)
    if (lvl >= 10) {
      seg(ctx, len * 0.75, -r * 0.3, len * 0.75, r * 0.3, 2, k.metal)
    }
    if (lvl >= 15) {
      for (let i = 0; i < 3; i++) {
        const turn = (reduced ? 0 : t * 0.2) + i / 3
        disc(ctx, len + tcos(turn) * r * 0.42, tsin(turn) * r * 0.42, r * 0.09, k.accent2)
      }
    }
    endAim(ctx)
    if (lvl >= 20) {
      // a full aureole at the cap
      const spin = reduced ? 0 : t * 0.06
      for (let i = 0; i < 8; i++) {
        const turn = spin + i / 8
        seg(ctx, x + tcos(turn) * r * 1.5, y + tsin(turn) * r * 1.5,
          x + tcos(turn) * r * 1.75, y + tsin(turn) * r * 1.75, 1.6, COIN)
      }
    }
  }

  /* ============================================================================
     SKINS — resolved once per key at install(), never per frame.
     ============================================================================ */

  const SKIN_SPEC = {
    'acorn-fox': { fur: '#c76b31', belly: '#f0e0c8', accent: '#c9a227', ear: 'point', tail: 'brush' },
    'boomer-badger': { fur: '#3f3f45', belly: '#e8e4d8', accent: '#8a6b3c', ear: 'round', tail: 'stub' },
    'cannon-boar': { fur: '#6b5a4c', belly: '#cdbca6', accent: '#8f97a0', ear: 'round', tail: 'stub' },
    'thistle-hedgehog': { fur: '#8a7355', belly: '#cbb794', accent: '#d8cbb0', ear: 'none', tail: 'none' },
    'frost-hare': { fur: '#cfd9e2', belly: '#f4f8fb', accent: '#9fd8ef', ear: 'long', tail: 'stub' },
    'sap-snail': { fur: '#b98a4a', belly: '#cbd7a0', accent: '#b9c93a', ear: 'none', tail: 'none' },
    'sixgun-stoat': { fur: '#e0cf9f', belly: '#f6efdb', accent: '#8f97a0', ear: 'round', tail: 'thin' },
    'longshot-lynx': { fur: '#b08a5c', belly: '#e6d8bd', accent: '#6fc9e8', ear: 'tuft', tail: 'stub' },
    'diver-otter': { fur: '#7a5a42', belly: '#cdb79b', accent: '#9fd8e8', ear: 'round', tail: 'flat', pad: 'ripple' },
    'corsair-beaver': { fur: '#6b4a33', belly: '#c2a887', accent: '#a9834f', ear: 'round', tail: 'flat', pad: 'ripple' },
    'biplane-magpie': { fur: '#2f3137', belly: '#e8e6df', accent: '#e8e6df', ear: 'none', tail: 'none', pad: 'plate' },
    'rotor-kestrel': { fur: '#a8794a', belly: '#e2cfa8', accent: '#8f97a0', ear: 'none', tail: 'thin', pad: 'plate' },
    'howitzer-mole': { fur: '#4f4650', belly: '#d8a6a0', accent: '#8f97a0', ear: 'none', tail: 'stub', pad: 'plate' },
    'gatling-raccoon': { fur: '#8b8f97', belly: '#d9dde2', accent: '#c9a227', ear: 'round', tail: 'brush', pad: 'plate' },
    'rune-weasel': { fur: '#c08a4a', belly: '#eddcb8', accent: '#7de8c6', ear: 'round', tail: 'thin', pad: 'rune' },
    'elder-owl': { fur: '#8c7a5e', belly: '#e3d8bf', accent: '#d7e8ff', ear: 'tuft', tail: 'none', pad: 'rune' },
    'shadow-marten': { fur: '#4a3f52', belly: '#b9b2c4', accent: '#cfd6cc', ear: 'point', tail: 'thin', pad: 'rune' },
    'brewer-toad': { fur: '#6f9a4a', belly: '#c3d69a', accent: '#a8e04a', ear: 'none', tail: 'none', pad: 'rune' },
    'thornroot-stag': { fur: '#8a6a4a', belly: '#d6c2a2', accent: '#8fbf6a', accent2: '#c9b98a', ear: 'none', tail: 'stub', pad: 'rune' },
    'tidecaller-newt': { fur: '#4a7f8f', belly: '#a9d3dd', accent: '#7fc6e8', ear: 'none', tail: 'thin', pad: 'rune' },
    'berry-warren': { fur: '#a8845c', belly: '#f2ead8', accent: '#c0455f', ear: 'long', tail: 'stub', pad: 'plank' },
    'caltrop-beetle': { fur: '#4a5540', belly: '#8fa070', accent: '#8e7a3f', accent2: '#cbb26a', ear: 'none', tail: 'none', pad: 'plank' },
    'warren-hall': { fur: '#8a8477', belly: '#c9c3b4', accent: '#f0c14b', ear: 'none', tail: 'none', pad: 'plank' },
    'tinker-shrew': { fur: '#7a7f86', belly: '#cfd4d9', accent: '#c9a227', ear: 'round', tail: 'thin', pad: 'plank' },
    'falconer-ferret': { fur: '#c9b48c', belly: '#f0e6cf', accent: '#e8ddc0', accent2: '#d8c48a', ear: 'round', tail: 'thin', pad: 'plank' }
  }

  const PAD_BY_FAMILY = { primary: 'earth', military: 'plate', magic: 'rune', support: 'plank' }
  const EAR_KINDS = ['point', 'round', 'long', 'tuft']
  const TAIL_KINDS = ['brush', 'thin', 'stub', 'flat']
  // Fallback hues, walked by a hash of the key so unknown towers still differ.
  const SPARE_FUR = ['#a06a4a', '#5f7f6a', '#7a6b9a', '#9a8a4a', '#4a6b8a', '#8a5a5a', '#6a8a4a', '#8a7a9a']

  const SKINS = {}

  function skinFor (key) {
    if (SKINS[key]) return SKINS[key]
    const def = OP.TOWERS[key] || OP.HEROES[key] || null
    const spec = SKIN_SPEC[key] || null
    // A stable hash of the key, so a tower authored later gets its own look
    // without anyone having to come back here.
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
    h = h < 0 ? -h : h

    const fur = spec ? spec.fur : SPARE_FUR[h % SPARE_FUR.length]
    const belly = spec ? spec.belly : shade(fur, 1.55)
    const accent = spec ? spec.accent : BRASS
    const padKind = (spec && spec.pad) || (def && def.placement === 'water' ? 'ripple' : null) ||
      (def && PAD_BY_FAMILY[def.family]) || 'earth'

    const k = {
      key: key,
      fur: fur,
      furDark: shade(fur, 0.62),
      belly: belly,
      accent: accent,
      accent2: (spec && spec.accent2) || shade(accent, 1.35),
      metal: IRON,
      metalDark: IRON_DARK,
      pad: padKind === 'plate' ? IRON_DARK : padKind === 'plank' ? WOOD_DARK : padKind === 'rune' ? '#22301f' : EARTH,
      padEdge: padKind === 'plate' ? '#3c4249' : padKind === 'plank' ? '#3a2c19' : padKind === 'rune' ? '#16220f' : EARTH_EDGE,
      padKind: padKind,
      earKind: (spec && spec.ear) || EAR_KINDS[h % EAR_KINDS.length],
      tailKind: (spec && spec.tail) || TAIL_KINDS[(h >> 3) % TAIL_KINDS.length]
    }
    SKINS[key] = k
    return k
  }

  /* ============================================================================
     THE WRAPPER — everything shared, in one place.
     ============================================================================ */

  const T0 = Date.now()

  /**
   * Animation phase in seconds. `frame.time` wins when the caller supplies one
   * (which is what lets the harness pin it); otherwise a wall clock, because
   * reading the sim for a timestamp would be a step toward reading it for state.
   */
  function phaseOf (frame) {
    if (frame && typeof frame.time === 'number') return frame.time
    return (Date.now() - T0) / 1000
  }

  function makeTowerSprite (key, art) {
    const k = skinFor(key)
    return function (ctx, tower, x, y, frame) {
      const reduced = !!(frame && frame.reducedMotion)
      const t = reduced ? 0 : phaseOf(frame)
      const def = tower.def || OP.TOWERS[tower.key] || OP.HEROES[tower.key] || null
      const r = (def ? def.footprint : 14) * 0.74
      const ang = tower.angle || 0
      const dir = Math.cos(ang) < 0 ? -1 : 1
      const degree = tower.paragonDegree > 0 ? tower.paragonDegree : 0
      const skin = degree > 0 ? PARA_SKIN : k

      // Two incommensurate frequencies, so no two phases ever produce the same
      // pose by coincidence — which is what makes the reduced-motion assertion
      // in the suite meaningful rather than lucky.
      const seed = M.jitter(tower.id | 0, 5) * 3
      const bob = reduced ? 0
        : Math.sin(t * 2.1 + seed) * 0.55 + Math.sin(t * 0.9 + seed * 1.7) * 0.3

      if (degree > 0) paragonUnder(ctx, x, y, r, degree, t, reduced)
      shadowUnder(ctx, x, y, r)
      pad(ctx, x, y, r, skin, t, reduced)
      art(ctx, tower, x, y + bob, r, skin, t, reduced, dir)
      tierMarks(ctx, tower, x, y, r)
      if (degree > 0) paragonOver(ctx, x, y, r, degree, t, reduced)
      if (tower.heroKey) heroBadge(ctx, tower, x, y, r)
    }
  }

  /* ============================================================================
     PROJECTILES

     One drawer per declared kind, built by walking OP.PROJ_KINDS — so a kind
     declared by a tower authored later gets a drawer for free, and the registry's
     own shape/tint/size hint is the art direction. Spin comes off `p.age`, which
     is per-projectile and needs no clock.
     ============================================================================ */

  const SHAPES = {}

  function trailOf (ctx, x, y, ang, len, w, col) {
    seg(ctx, x - Math.cos(ang) * len, y - Math.sin(ang) * len, x, y, w, col)
  }

  SHAPES.dart = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 3, s.size * 0.5, s.faint)
    beginAim(ctx, x, y, ang)
    tri(ctx, s.size * 1.6, 0, -s.size, -s.size * 0.6, -s.size, s.size * 0.6, s.tint)
    box(ctx, -s.size * 0.9, 0, s.size * 0.7, s.size * 1.4, s.dark)
    endAim(ctx)
  }
  SHAPES.bullet = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 4, s.size * 0.4, s.faint)
    beginAim(ctx, x, y, ang)
    oval(ctx, 0, 0, s.size * 1.4, s.size * 0.6, 0, s.tint)
    endAim(ctx)
  }
  SHAPES.spike = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    tri(ctx, s.size * 1.8, 0, -s.size * 0.8, -s.size * 0.5, -s.size * 0.8, s.size * 0.5, s.tint)
    seg(ctx, -s.size * 0.8, 0, s.size * 0.8, 0, 1, s.dark)
    endAim(ctx)
  }
  SHAPES.blade = function (ctx, p, x, y, s, ang) {
    const spin = ang + p.age * 14
    beginAim(ctx, x, y, spin)
    ctx.strokeStyle = s.tint
    ctx.lineWidth = s.size * 0.5
    ctx.beginPath()
    ctx.arc(0, 0, s.size, -2.2, 2.2)
    ctx.stroke()
    disc(ctx, s.size, 0, s.size * 0.3, s.dark)
    endAim(ctx)
  }
  SHAPES.slash = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang + p.age * 10)
    arcOf(ctx, 0, 0, s.size, -1.1, 1.1, s.size * 0.45, s.tint)
    arcOf(ctx, 0, 0, s.size * 0.6, -0.8, 0.8, s.size * 0.3, s.light)
    endAim(ctx)
  }
  SHAPES.bomb = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 2.4, s.size * 0.6, s.faint)
    disc(ctx, x, y, s.size, s.tint)
    disc(ctx, x - s.size * 0.3, y - s.size * 0.3, s.size * 0.34, s.light)
    ringOf(ctx, x, y, s.size, 1, s.dark)
  }
  SHAPES.ball = function (ctx, p, x, y, s, ang) {
    disc(ctx, x, y, s.size, s.tint)
    arcOf(ctx, x, y, s.size * 0.66, 2.2 + p.age * 8, 4.4 + p.age * 8, 1.4, s.light)
  }
  SHAPES.shell = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 3, s.size * 0.5, s.faint)
    beginAim(ctx, x, y, ang)
    oval(ctx, 0, 0, s.size * 1.3, s.size * 0.7, 0, s.tint)
    tri(ctx, s.size * 1.3, -s.size * 0.7, s.size * 2.1, 0, s.size * 1.3, s.size * 0.7, s.dark)
    endAim(ctx)
  }
  SHAPES.rocket = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    box(ctx, 0, 0, s.size * 2.4, s.size * 0.9, s.tint)
    tri(ctx, s.size * 1.2, -s.size * 0.45, s.size * 2.1, 0, s.size * 1.2, s.size * 0.45, s.dark)
    tri(ctx, -s.size * 1.2, -s.size * 0.7, -s.size * 0.4, -s.size * 0.4, -s.size * 1.2, -s.size * 0.1, s.dark)
    tri(ctx, -s.size * 1.2, s.size * 0.7, -s.size * 0.4, s.size * 0.4, -s.size * 1.2, s.size * 0.1, s.dark)
    // exhaust, driven by age so it flickers without a clock
    const fl = 1 + (p.age * 37 % 1) * 0.8
    tri(ctx, -s.size * 1.2, -s.size * 0.4, -s.size * (1.2 + fl), 0, -s.size * 1.2, s.size * 0.4, EMBER)
    endAim(ctx)
  }
  SHAPES.boat = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    quad(ctx, -s.size, -s.size * 0.5, s.size * 1.2, -s.size * 0.3,
      s.size * 1.2, s.size * 0.3, -s.size, s.size * 0.5, s.tint)
    box(ctx, 0, -s.size * 0.5, s.size * 0.4, s.size * 0.9, s.dark)
    endAim(ctx)
  }
  SHAPES.orb = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 2.6, s.size * 0.7, s.faint)
    disc(ctx, x, y, s.size, s.faint)
    disc(ctx, x, y, s.size * 0.68, s.tint)
    disc(ctx, x - s.size * 0.2, y - s.size * 0.2, s.size * 0.26, s.light)
  }
  SHAPES.puff = function (ctx, p, x, y, s, ang) {
    disc(ctx, x, y, s.size, s.faint)
    disc(ctx, x + s.size * 0.4, y - s.size * 0.3, s.size * 0.55, s.tint)
    disc(ctx, x - s.size * 0.4, y + s.size * 0.2, s.size * 0.45, s.light)
  }
  SHAPES.blob = function (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 2, s.size * 0.8, s.faint)
    oval(ctx, x, y, s.size, s.size * 0.82, ang, s.tint)
    disc(ctx, x - s.size * 0.25, y - s.size * 0.25, s.size * 0.3, s.light)
  }
  SHAPES.droplet = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    tri(ctx, s.size * 1.7, 0, -s.size * 0.4, -s.size * 0.75, -s.size * 0.4, s.size * 0.75, s.tint)
    disc(ctx, -s.size * 0.4, 0, s.size * 0.75, s.tint)
    disc(ctx, -s.size * 0.3, -s.size * 0.25, s.size * 0.25, s.light)
    endAim(ctx)
  }
  SHAPES.ring = function (ctx, p, x, y, s, ang) {
    const grow = 1 + (p.age * 4 % 1) * 0.6
    ringOf(ctx, x, y, s.size * grow, 2, s.tint)
    ringOf(ctx, x, y, s.size * grow * 0.6, 1.2, s.faint)
  }
  SHAPES.beam = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    box(ctx, 0, 0, s.size * 4, s.size * 0.5, s.faint)
    box(ctx, 0, 0, s.size * 3.4, s.size * 0.24, s.tint)
    disc(ctx, s.size * 1.7, 0, s.size * 0.4, s.light)
    endAim(ctx)
  }
  SHAPES.bolt = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang)
    quad(ctx, s.size * 1.8, 0, 0, -s.size * 0.7, -s.size * 0.6, 0, 0, s.size * 0.7, s.tint)
    seg(ctx, -s.size * 2, 0, -s.size * 0.6, 0, s.size * 0.4, s.faint)
    endAim(ctx)
  }
  SHAPES.star = function (ctx, p, x, y, s, ang) {
    star(ctx, x, y, s.size * 1.4, 4, p.age * 1.4, s.tint)
    disc(ctx, x, y, s.size * 0.34, s.dark)
  }
  SHAPES.flask = function (ctx, p, x, y, s, ang) {
    beginAim(ctx, x, y, ang + p.age * 6)
    disc(ctx, 0, s.size * 0.2, s.size, s.tint)
    box(ctx, 0, -s.size * 0.9, s.size * 0.5, s.size * 0.8, s.dark)
    disc(ctx, -s.size * 0.3, s.size * 0.05, s.size * 0.28, s.light)
    endAim(ctx)
  }

  /** Anything a later tower declares that this file has not met yet. */
  function shapeFallback (ctx, p, x, y, s, ang) {
    if (s.trail) trailOf(ctx, x, y, ang, s.size * 2.4, s.size * 0.6, s.faint)
    disc(ctx, x, y, s.size, s.tint)
    ringOf(ctx, x, y, s.size, 1, s.dark)
  }

  /** Resolve one kind's art once: colours, size and drawer, all pre-computed. */
  function projStyle (kind) {
    const spec = OP.PROJ_KINDS[kind] || { shape: 'dart', tint: '#e8e2d4', size: 4, trail: false, spin: false }
    const p = hex(spec.tint)
    return {
      kind: kind,
      shape: spec.shape,
      size: spec.size,
      trail: !!spec.trail,
      spin: !!spec.spin,
      tint: spec.tint,
      dark: shade(spec.tint, 0.55),
      light: shade(spec.tint, 1.45),
      faint: 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',0.35)'
    }
  }

  function makeProjSprite (kind) {
    const s = projStyle(kind)
    const draw = SHAPES[s.shape] || shapeFallback
    return function (ctx, p, x, y, frame) {
      const ang = (p.vx || p.vy) ? Math.atan2(p.vy, p.vx) : 0
      draw(ctx, p, x, y, s, ang)
    }
  }

  /* ============================================================================
     INSTALL

     index.html loads the sprite files before the renderer, so this normally runs
     from the property hook at the bottom rather than immediately. It is
     idempotent and re-scans the registries every time, which is what lets a
     tower, hero or projectile kind defined later still get art — including the
     ones a test fixture defines after the bundle has loaded.
     ============================================================================ */

  const registered = { towers: [], heroes: [], projectiles: [] }

  function install (R) {
    R = R || OP.Render
    if (!R || typeof R.registerTower !== 'function') return false

    registered.towers.length = 0
    registered.heroes.length = 0
    registered.projectiles.length = 0

    for (let i = 0; i < OP.TOWER_ORDER.length; i++) {
      const key = OP.TOWER_ORDER[i]
      R.registerTower(key, makeTowerSprite(key, ART[key] || genericArt))
      registered.towers.push(key)
    }

    // Heroes ARE towers as far as the renderer is concerned: Heroes.place sets
    // `key === heroKey` and drawTowers looks the sprite up in towerSprites. There
    // is no separate hero registry, and registering into one would draw magenta.
    for (let i = 0; i < OP.HERO_ORDER.length; i++) {
      const key = OP.HERO_ORDER[i]
      R.registerTower(key, makeTowerSprite(key, heroArt))
      registered.heroes.push(key)
    }

    for (const kind in OP.PROJ_KINDS) {
      R.registerProjectile(kind, makeProjSprite(kind))
      registered.projectiles.push(kind)
    }

    return true
  }

  OP.TowerSprites = {
    install: install,
    registered: registered,
    art: ART,
    shapes: SHAPES,
    skinFor: skinFor,
    heroArt: heroArt,
    genericArt: genericArt
  }

  if (!install()) {
    // Chain onto whatever descriptor is already there — sprites-balloons.js
    // installs the same way, and neither file may swallow the other's hook.
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

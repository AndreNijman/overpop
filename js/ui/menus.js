;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     MENUS — the title, map select, difficulty/mode select and settings screens,
     plus the small widget layer every other canvas UI file reuses.

     Everything in this game is drawn on the canvas; there is no HTML UI. That
     makes a widget layer unavoidable, and it makes its shape important:

       build(app)  ->  a MODEL: plain data, no ctx, no closures, no drawing.
       paint(ctx, model)         draws a model. Reads nothing else.
       hit(widgets, x, y)        resolves a point to a widget.

     A screen is therefore a pure function of app state, and a tap is
     `hit(build(app))` — the same layout the player is looking at, recomputed,
     rather than a list left behind by the last frame. That is what makes the menus
     testable without a canvas and what stops a tap from landing on a stale button
     after a resize or a state change.

     Two rules, both load-bearing:

       1. DRAW FUNCTIONS NEVER MUTATE. Not the sim, not the profile, not module
          state. Only `tap`, `key` and `install` change anything.
       2. No screen may throw on an empty registry. During the build there are no
          maps, no towers, sometimes no difficulties — and a screen that throws
          takes the whole frame down with it. Every selection is therefore
          re-resolved against the live registry each build and never dereferenced
          from a stored key.

     Layout is authored in the fixed 1280x720 design space; the camera scales it.
     ============================================================================ */

  const Menus = {}

  const FIELD_W = OP.FIELD_W
  const FIELD_H = OP.FIELD_H

  /* ---------- palette ----------
     Dark warm near-black, one moss accent, and a deliberately small set of
     greys. Anything that needs to shout uses weight and spacing, not colour. */

  /* The palette reads like the source game's menu: a bright sky behind warm
     wooden panels, chunky green accents, gold for money and celebration. */
  const C = {
    bg: '#4db3f0',
    deep: '#2f8fd4',
    panel: '#7a4f2d',
    panelHi: '#9c6b3f',
    panelSel: '#a97a45',
    line: '#4a2f18',
    lineHi: '#6b4526',
    ink: '#ffffff',
    dim: '#f5e9d8',
    faint: '#c9a97f',
    moss: '#7ec850',
    mossDeep: '#4f9b3d',
    gold: '#ffd23f',
    warn: '#ffb648',
    bad: '#e05545'
  }

  const FONT = "'Trebuchet MS', 'Verdana', 'Segoe UI', 'DejaVu Sans', sans-serif"

  /* Proportional advance estimate for the rounded display face. Measured
     average across mixed-case UI labels sits near 0.52em; the menus only use
     metrics for centering, wrapping and truncation, so an average beats a
     per-glyph measure we cannot take at build() time (no ctx there). */
  const ADV = 0.56

  const PAD = 96                 // page margin
  const CONTENT_W = FIELD_W - PAD * 2

  /* ============================================================================
     THE WIDGET LAYER
     ============================================================================ */

  const UI = {}

  UI.FONT = FONT
  UI.ADV = ADV
  UI.COLOURS = C

  UI.textWidth = function (text, size) {
    return String(text === undefined || text === null ? '' : text).length * size * ADV
  }

  /** Truncate to fit, with an ellipsis. Never returns something wider than maxW. */
  UI.clipText = function (text, size, maxW) {
    const s = String(text === undefined || text === null ? '' : text)
    if (maxW <= 0) return ''
    const room = Math.floor(maxW / (size * ADV))
    if (s.length <= room) return s
    if (room <= 1) return s.slice(0, Math.max(0, room))
    return s.slice(0, room - 1) + '…'
  }

  /**
   * Greedy word wrap on computed metrics. A single word longer than the line is
   * hard-split rather than allowed to overflow.
   */
  UI.wrapText = function (text, size, maxW, maxLines) {
    const s = String(text === undefined || text === null ? '' : text).trim()
    const out = []
    if (!s || maxW <= 0) return out
    const room = Math.max(1, Math.floor(maxW / (size * ADV)))
    const words = s.split(/\s+/)
    let line = ''
    for (let i = 0; i < words.length; i++) {
      let word = words[i]
      while (word.length > room) {
        if (line) { out.push(line); line = '' }
        out.push(word.slice(0, room))
        word = word.slice(room)
        if (maxLines && out.length >= maxLines) return trimLast(out, maxLines)
      }
      const next = line ? line + ' ' + word : word
      if (next.length <= room) { line = next; continue }
      out.push(line)
      line = word
      if (maxLines && out.length >= maxLines) return trimLast(out, maxLines)
    }
    if (line) out.push(line)
    return maxLines ? trimLast(out, maxLines) : out
  }

  function trimLast (lines, maxLines) {
    if (lines.length <= maxLines) return lines
    const out = lines.slice(0, maxLines)
    const last = out[maxLines - 1]
    out[maxLines - 1] = last.length > 1 ? last.slice(0, last.length - 1) + '…' : last
    return out
  }

  /**
   * The topmost widget containing (x, y), or null. Later widgets win, which
   * matches paint order — a widget drawn on top is the one you can press.
   */
  UI.hit = function (widgets, x, y) {
    if (!Array.isArray(widgets)) return null
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return null
    for (let i = widgets.length - 1; i >= 0; i--) {
      const w = widgets[i]
      if (!w || w.noHit) continue
      const clip = w.hitClip
      if (clip && (x < clip.x || x > clip.x + clip.w || y < clip.y || y > clip.y + clip.h)) continue
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w
    }
    return null
  }

  UI.byId = function (widgets, id) {
    if (!Array.isArray(widgets)) return null
    for (let i = 0; i < widgets.length; i++) if (widgets[i] && widgets[i].id === id) return widgets[i]
    return null
  }

  /** 0..1 position of x across a slider's rail. */
  UI.sliderValue = function (w, x) {
    if (!w || !(w.w > 0)) return 0
    return M.clamp((x - w.x) / w.w, 0, 1)
  }

  /* ---------- mark and widget constructors ----------
     Marks are non-interactive; widgets are the same shape plus an id and an
     action. Both are plain objects so a model can be inspected in a test. */

  UI.text = function (x, y, text, opts) {
    opts = opts || {}
    return {
      kind: 'text', x: x, y: y, text: String(text === undefined ? '' : text),
      size: opts.size || 12, colour: opts.colour || C.ink,
      align: opts.align || 'left', weight: opts.weight || '',
      alpha: opts.alpha === undefined ? 1 : opts.alpha
    }
  }

  /** Letter-spaced text. Canvas has no portable letterSpacing, so it is manual. */
  UI.tracked = function (x, y, text, opts) {
    opts = opts || {}
    return {
      kind: 'tracked', x: x, y: y, text: String(text === undefined ? '' : text),
      size: opts.size || 12, colour: opts.colour || C.ink,
      track: opts.track === undefined ? 0.22 : opts.track,
      weight: opts.weight || ''
    }
  }

  UI.rule = function (x, y, w, opts) {
    opts = opts || {}
    return { kind: 'rule', x: x, y: y, w: w, colour: opts.colour || C.line, alpha: opts.alpha === undefined ? 1 : opts.alpha }
  }

  /** A filled or outlined disc — tier pips, counters, bullet points. */
  UI.dot = function (x, y, r, opts) {
    opts = opts || {}
    return {
      kind: 'dot', x: x, y: y, r: r,
      fill: opts.fill || '', stroke: opts.stroke || '',
      alpha: opts.alpha === undefined ? 1 : opts.alpha
    }
  }

  /** A circular progress ring — the round counter's BTD6-style dial.
      `frac` in [0,1] sweeps clockwise from 12 o'clock. */
  UI.ring = function (x, y, r, frac, opts) {
    opts = opts || {}
    return {
      kind: 'ring', x: x, y: y, r: r,
      frac: Math.max(0, Math.min(1, Number(frac) || 0)),
      colour: opts.colour || C.moss,
      track: opts.track || C.deep,
      lineWidth: opts.lineWidth || 3
    }
  }

  UI.box = function (x, y, w, h, opts) {
    opts = opts || {}
    return {
      kind: 'box', x: x, y: y, w: w, h: h,
      fill: opts.fill || '', stroke: opts.stroke || '',
      alpha: opts.alpha === undefined ? 1 : opts.alpha,
      lineWidth: opts.lineWidth || 1, dash: opts.dash || null
    }
  }

  UI.chip = function (x, y, label, opts) {
    opts = opts || {}
    const size = opts.size || 10
    const w = opts.w || Math.ceil(UI.textWidth(label, size) + 16)
    return {
      kind: 'chip', x: x, y: y, w: w, h: opts.h || 20,
      label: String(label), size: size,
      tint: opts.tint || C.moss, filled: opts.filled !== false
    }
  }

  /** A balloon glyph, used by the bestiary and as title-screen furniture. */
  UI.balloon = function (x, y, r, tier) {
    tier = tier || {}
    return {
      kind: 'balloon', x: x, y: y, r: r,
      colour: tier.colour || C.moss, shade: tier.shade || C.mossDeep,
      blimp: !!tier.blimp, veiled: !!(tier.props && OP.PROP && (tier.props & OP.PROP.VEILED))
    }
  }

  /**
   * A tower or hero portrait, drawn with the SAME sprite the board uses.
   *
   * Deliberately not a separate set of shop icons: a second art path is a second
   * thing to keep in sync, and the whole point is that the critter on the card is
   * recognisably the critter you are about to place. If the renderer has no sprite
   * for the key the mark degrades to a labelled disc rather than drawing nothing,
   * so an unregistered tower is visible as a gap instead of an empty cell.
   */
  UI.portrait = function (x, y, r, key, opts) {
    opts = opts || {}
    return {
      kind: 'portrait', x: x, y: y, r: r, key: String(key || ''),
      dim: !!opts.dim, bg: opts.bg === undefined ? C.deep : opts.bg
    }
  }

  /** A small vector icon. Recognisable shapes drawn procedurally, no bitmaps. */
  UI.icon = function (x, y, r, key, opts) {
    opts = opts || {}
    return {
      kind: 'icon', x: x, y: y, r: r, key: String(key || ''),
      colour: opts.colour || C.ink, bg: opts.bg || '',
      alpha: opts.alpha === undefined ? 1 : opts.alpha
    }
  }

  /**
   * A miniature of a map's track shape. `paths` is an array of point arrays in
   * field coordinates; the mark scales the whole field into the box so previews
   * are comparable between maps.
   */
  UI.preview = function (x, y, w, h, paths, opts) {
    opts = opts || {}
    return {
      kind: 'preview', x: x, y: y, w: w, h: h,
      paths: Array.isArray(paths) ? paths : [],
      colour: opts.colour || C.mossDeep, bg: opts.bg || C.deep,
      lineWidth: opts.lineWidth || 2
    }
  }

  function widget (kind, id, x, y, w, h, opts) {
    opts = opts || {}
    const o = {
      kind: kind, id: id, x: x, y: y, w: w, h: h,
      label: opts.label === undefined ? '' : String(opts.label),
      sub: opts.sub === undefined ? '' : String(opts.sub),
      lines: opts.lines || null,
      tone: opts.tone || 'ghost',
      align: opts.align || 'left',
      action: opts.action || '',
      arg: opts.arg === undefined ? null : opts.arg,
      selected: !!opts.selected,
      disabled: !!opts.disabled,
      reason: opts.reason || '',
      value: opts.value,
      on: opts.on,
      note: opts.note || '',
      pips: opts.pips || null,
      previewPaths: opts.previewPaths || null,
      swatch: opts.swatch || '',
      hitClip: opts.hitClip || null,
      noHit: !!opts.noHit
    }
    return o
  }

  UI.button = function (id, x, y, w, h, opts) { return widget('button', id, x, y, w, h, opts) }
  UI.row = function (id, x, y, w, h, opts) { return widget('row', id, x, y, w, h, opts) }
  UI.card = function (id, x, y, w, h, opts) { return widget('card', id, x, y, w, h, opts) }
  UI.tab = function (id, x, y, w, h, opts) { return widget('tab', id, x, y, w, h, opts) }
  UI.slider = function (id, x, y, w, h, opts) { return widget('slider', id, x, y, w, h, opts) }
  UI.toggle = function (id, x, y, w, h, opts) { return widget('toggle', id, x, y, w, h, opts) }

  /* ---------- painting ---------- */

  function setFont (ctx, size, weight) {
    ctx.font = (weight ? weight + ' ' : '') + Math.round(size) + 'px ' + FONT
  }

  function drawText (ctx, x, y, text, size, colour, align, weight, alpha) {
    ctx.save()
    setFont(ctx, size, weight)
    ctx.fillStyle = colour
    ctx.textAlign = align || 'left'
    ctx.textBaseline = 'alphabetic'
    if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha
    ctx.fillText(String(text), x, y)
    ctx.restore()
  }

  function drawTracked (ctx, mark) {
    const step = mark.size * (ADV + mark.track)
    ctx.save()
    setFont(ctx, mark.size, mark.weight)
    ctx.fillStyle = mark.colour
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const s = mark.text
    for (let i = 0; i < s.length; i++) ctx.fillText(s.charAt(i), mark.x + i * step, mark.y)
    ctx.restore()
  }

  UI.trackedWidth = function (mark) {
    return mark.text.length * mark.size * (ADV + mark.track)
  }

  function drawBox (ctx, m) {
    ctx.save()
    if (m.alpha !== 1) ctx.globalAlpha = m.alpha
    // Chunky rounded panel in the source game's manner: a soft drop shadow, a
    // vertical gradient that lightens toward the top, and a thick dark outline.
    const r = Math.min(10, m.w / 3, m.h / 3)
    if (m.fill) {
      if (typeof ctx.shadowColor === 'string') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = 4
        ctx.shadowOffsetY = 2
      }
      ctx.beginPath()
      roundRectPath(ctx, m.x, m.y, m.w, m.h, r)
      ctx.fillStyle = m.fill
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowColor = 'transparent'
      // top sheen so fills read as lit surfaces, not flat cards; skipped on
      // context stubs that do not implement gradients (test rigs, old engines)
      let grad = null
      if (typeof ctx.createLinearGradient === 'function') {
        try { grad = ctx.createLinearGradient(0, m.y, 0, m.y + m.h) } catch (e) { grad = null }
      }
      if (grad) {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.16)')
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0)')
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.12)')
        ctx.fillStyle = grad
        roundRectPath(ctx, m.x, m.y, m.w, m.h, r)
        ctx.fill()
      }
    }
    if (m.stroke) {
      ctx.strokeStyle = m.stroke
      ctx.lineWidth = Math.max(2, m.lineWidth * 2)
      roundRectPath(ctx, m.x + 1, m.y + 1, m.w - 2, m.h - 2, r)
      ctx.stroke()
    }
    if (m.dash && ctx.setLineDash) ctx.setLineDash([])
    ctx.restore()
  }

  function roundRectPath (ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2))
    ctx.beginPath()
    if (typeof ctx.arcTo !== 'function') {
      // context stubs without arcTo degrade to square corners
      ctx.rect(x, y, w, h)
      ctx.closePath()
      return
    }
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    // End point on the left edge, not inside the box — an end point of
    // (x + r, y + h - r) tilts the tangent and bulges the arc outside.
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
  }

  function drawChip (ctx, m) {
    ctx.save()
    if (m.filled) {
      ctx.globalAlpha = 0.16
      ctx.fillStyle = m.tint
      ctx.fillRect(m.x, m.y, m.w, m.h)
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = m.tint
    ctx.lineWidth = 1
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1)
    ctx.restore()
    drawText(ctx, m.x + m.w / 2, m.y + m.h / 2 + m.size * 0.36, m.label, m.size, m.tint, 'center')
  }

  function drawBalloonMark (ctx, m) {
    ctx.save()
    if (m.veiled) ctx.globalAlpha = 0.55
    ctx.fillStyle = m.colour
    ctx.beginPath()
    if (m.blimp) ctx.ellipse(m.x, m.y, m.r * 1.35, m.r * 0.78, 0, 0, M.TAU)
    else ctx.arc(m.x, m.y, m.r, 0, M.TAU)
    ctx.fill()
    ctx.strokeStyle = m.shade
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  /* A portrait reuses the board sprite, which expects a tower entity and a frame.
     A stub is enough: the sprite reads `def`, `key`, `angle`, `id` and the tier
     counters, and a portrait wants the unupgraded, unrotated, unanimated pose.
     `reducedMotion` is set so the pose is deterministic — a portrait that bobs
     with wall-clock time cannot be screenshot-tested. */
  function drawPortraitMark (ctx, m) {
    const def = (OP.TOWERS && OP.TOWERS[m.key]) || (OP.HEROES && OP.HEROES[m.key]) || null
    const fn = OP.Render && OP.Render.towerSprites ? OP.Render.towerSprites[m.key] : null

    ctx.save()
    if (m.dim) ctx.globalAlpha = 0.42

    if (fn && def) {
      // The sprite sizes itself off `def.footprint`; scale so any footprint lands
      // at the requested radius instead of large towers overflowing the card.
      const drawn = def.footprint || 14
      const scale = (m.r / (drawn * 0.74)) * 0.92
      ctx.translate(m.x, m.y)
      ctx.scale(scale, scale)
      try {
        fn(ctx, { key: m.key, def: def, tiers: [0, 0, 0], id: 0, angle: 0, x: 0, y: 0 },
          0, 0, { reducedMotion: true })
      } catch (e) {
        ctx.restore(); ctx.save(); drawPortraitFallback(ctx, m)
      }
    } else {
      drawPortraitFallback(ctx, m)
    }
    ctx.restore()
  }

  function drawPortraitFallback (ctx, m) {
    ctx.fillStyle = m.bg
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, M.TAU); ctx.fill()
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = C.dim
    ctx.font = '600 ' + Math.max(7, Math.round(m.r * 0.9)) + 'px ' + FONT
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText((m.key[0] || '?').toUpperCase(), m.x, m.y + 1)
  }

  function drawIconMark (ctx, m) {
    ctx.save()
    if (m.alpha !== 1) ctx.globalAlpha = m.alpha
    const r = m.r
    const x = m.x
    const y = m.y
    const c = m.colour
    ctx.strokeStyle = c
    ctx.fillStyle = c
    ctx.lineWidth = Math.max(1.5, r * 0.18)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    switch (m.key) {
      case 'heart': {
        ctx.beginPath()
        ctx.moveTo(x, y + r * 0.3)
        ctx.bezierCurveTo(x - r, y - r * 0.5, x - r * 0.4, y - r, x, y - r * 0.4)
        ctx.bezierCurveTo(x + r * 0.4, y - r, x + r, y - r * 0.5, x, y + r * 0.3)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'coin': {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, M.TAU)
        ctx.fill()
        ctx.fillStyle = m.bg || '#b8860b'
        ctx.beginPath()
        ctx.arc(x, y, r * 0.7, 0, M.TAU)
        ctx.fill()
        ctx.fillStyle = c
        ctx.font = 'bold ' + Math.round(r * 0.9) + 'px ' + FONT
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('$', x, y + 1)
        break
      }
      case 'star': {
        ctx.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = (i * 72 - 90) * Math.PI / 180
          const a2 = ((i * 72 + 36) - 90) * Math.PI / 180
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
          ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45)
        }
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'play': {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.3, y - r)
        ctx.lineTo(x - r * 0.3, y + r)
        ctx.lineTo(x + r * 0.85, y)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'pause': {
        const pw = r * 0.3
        ctx.fillRect(x - r * 0.5, y - r, pw, r * 2)
        ctx.fillRect(x + r * 0.5 - pw, y - r, pw, r * 2)
        break
      }
      case 'fast': {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.6, y - r)
        ctx.lineTo(x - r * 0.6, y + r)
        ctx.lineTo(x + r * 0.1, y)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x, y - r)
        ctx.lineTo(x, y + r)
        ctx.lineTo(x + r * 0.85, y)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'gear': {
        ctx.beginPath()
        ctx.arc(x, y, r * 0.45, 0, M.TAU)
        ctx.fill()
        for (let i = 0; i < 6; i++) {
          const a = i * 60 * Math.PI / 180
          const cos = Math.cos(a)
          const sin = Math.sin(a)
          ctx.beginPath()
          ctx.moveTo(x + cos * r * 0.55, y + sin * r * 0.55)
          ctx.lineTo(x + cos * r, y + sin * r)
          ctx.lineWidth = Math.max(2, r * 0.28)
          ctx.stroke()
        }
        break
      }
      case 'book': {
        ctx.beginPath()
        ctx.moveTo(x - r, y - r)
        ctx.quadraticCurveTo(x, y - r * 0.7, x + r, y - r)
        ctx.lineTo(x + r, y + r)
        ctx.quadraticCurveTo(x, y + r * 0.7, x - r, y + r)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = m.bg || '#4a2f18'
        ctx.lineWidth = Math.max(1.5, r * 0.12)
        ctx.beginPath()
        ctx.moveTo(x, y - r * 0.85)
        ctx.lineTo(x, y + r * 0.85)
        ctx.stroke()
        break
      }
      case 'shield': {
        ctx.beginPath()
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r * 0.85, y - r * 0.5)
        ctx.lineTo(x + r * 0.7, y + r * 0.5)
        ctx.lineTo(x, y + r)
        ctx.lineTo(x - r * 0.7, y + r * 0.5)
        ctx.lineTo(x - r * 0.85, y - r * 0.5)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'trophy': {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.6, y - r)
        ctx.lineTo(x + r * 0.6, y - r)
        ctx.lineTo(x + r * 0.5, y + r * 0.2)
        ctx.quadraticCurveTo(x + r, y + r * 0.1, x + r * 0.7, y + r * 0.5)
        ctx.lineTo(x + r * 0.2, y + r * 0.3)
        ctx.lineTo(x + r * 0.2, y + r * 0.7)
        ctx.lineTo(x - r * 0.2, y + r * 0.7)
        ctx.lineTo(x - r * 0.2, y + r * 0.3)
        ctx.lineTo(x - r * 0.7, y + r * 0.5)
        ctx.quadraticCurveTo(x - r, y + r * 0.1, x - r * 0.5, y + r * 0.2)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'bolt': {
        ctx.beginPath()
        ctx.moveTo(x + r * 0.15, y - r)
        ctx.lineTo(x - r * 0.5, y + r * 0.1)
        ctx.lineTo(x + r * 0.05, y + r * 0.1)
        ctx.lineTo(x - r * 0.15, y + r)
        ctx.lineTo(x + r * 0.5, y - r * 0.1)
        ctx.lineTo(x - r * 0.05, y - r * 0.1)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'home': {
        ctx.beginPath()
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r, y + r * 0.1)
        ctx.lineTo(x + r * 0.55, y + r * 0.1)
        ctx.lineTo(x + r * 0.55, y + r)
        ctx.lineTo(x + r * 0.15, y + r)
        ctx.lineTo(x + r * 0.15, y + r * 0.35)
        ctx.lineTo(x - r * 0.15, y + r * 0.35)
        ctx.lineTo(x - r * 0.15, y + r)
        ctx.lineTo(x - r * 0.55, y + r)
        ctx.lineTo(x - r * 0.55, y + r * 0.1)
        ctx.lineTo(x - r, y + r * 0.1)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'gift': {
        ctx.fillStyle = m.bg || c
        ctx.fillRect(x - r, y - r * 0.3, r * 2, r * 1.3)
        ctx.fillStyle = c
        ctx.fillRect(x - r * 0.12, y - r * 0.3, r * 0.24, r * 1.3)
        ctx.fillRect(x - r, y - r * 0.5, r * 2, r * 0.25)
        ctx.beginPath()
        ctx.arc(x - r * 0.3, y - r * 0.5, r * 0.25, Math.PI, 0)
        ctx.arc(x + r * 0.3, y - r * 0.5, r * 0.25, Math.PI, 0)
        ctx.fill()
        break
      }
      case 'flag': {
        ctx.beginPath()
        ctx.moveTo(x - r * 0.6, y - r)
        ctx.lineTo(x - r * 0.6, y + r)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x - r * 0.55, y - r)
        ctx.lineTo(x + r * 0.6, y - r * 0.35)
        ctx.lineTo(x - r * 0.55, y + r * 0.3)
        ctx.closePath()
        ctx.fill()
        break
      }
      default: {
        ctx.beginPath()
        ctx.arc(x, y, r * 0.6, 0, M.TAU)
        ctx.stroke()
        break
      }
    }
    ctx.restore()
  }

  function drawDotMark (ctx, m) {
    ctx.save()
    if (m.alpha !== 1) ctx.globalAlpha = m.alpha
    ctx.beginPath()
    ctx.arc(m.x, m.y, Math.max(0.5, m.r), 0, M.TAU)
    if (m.fill) { ctx.fillStyle = m.fill; ctx.fill() }
    if (m.stroke) { ctx.strokeStyle = m.stroke; ctx.lineWidth = 1; ctx.stroke() }
    ctx.restore()
  }

  function drawRingMark (ctx, m) {
    ctx.save()
    if (!ctx.arc) { ctx.restore(); return }
    const a0 = -Math.PI / 2
    const sweep = M.TAU * m.frac
    ctx.lineCap = 'round'
    ctx.strokeStyle = m.track
    ctx.lineWidth = m.lineWidth
    ctx.beginPath()
    ctx.arc(m.x, m.y, m.r, 0, M.TAU)
    ctx.stroke()
    if (m.frac > 0.004) {
      ctx.strokeStyle = m.colour
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.r, a0, a0 + sweep)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawLogoMark (ctx, m) {
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const size = m.size || 74
    const step = size * (ADV + (m.track || 0.18))
    const s = m.text || ''

    /* Shadow */
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    setFont(ctx, size, '800')
    for (let i = 0; i < s.length; i++) ctx.fillText(s.charAt(i), m.x + i * step + 3, m.y + 4)

    /* Dark outline for readability against sky */
    ctx.strokeStyle = m.stroke || '#2a1a0a'
    ctx.lineWidth = Math.max(3, size * 0.06)
    ctx.lineJoin = 'round'
    for (let i = 0; i < s.length; i++) ctx.strokeText(s.charAt(i), m.x + i * step, m.y)

    /* White fill */
    ctx.fillStyle = m.colour || C.ink
    for (let i = 0; i < s.length; i++) ctx.fillText(s.charAt(i), m.x + i * step, m.y)

    ctx.restore()
  }

  function drawTitleBackdrop (ctx, m) {
    ctx.save()
    const W = FIELD_W
    const H = FIELD_H

    /* Sky gradient */
    let sky = null
    if (typeof ctx.createLinearGradient === 'function') {
      try { sky = ctx.createLinearGradient(0, 0, 0, H) } catch (e) { sky = null }
    }
    if (sky) {
      sky.addColorStop(0, '#87CEEB')
      sky.addColorStop(0.45, '#B0E0F6')
      sky.addColorStop(0.7, '#d4eef8')
      sky.addColorStop(1, '#7ec850')
      ctx.fillStyle = sky
    } else {
      ctx.fillStyle = '#87CEEB'
    }
    ctx.fillRect(0, 0, W, H)

    /* Sun glow */
    const sunX = W * 0.78
    const sunY = H * 0.18
    let sg = null
    if (typeof ctx.createRadialGradient === 'function') {
      try { sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120) } catch (e) { sg = null }
    }
    if (sg) {
      sg.addColorStop(0, 'rgba(255, 248, 180, 0.9)')
      sg.addColorStop(0.3, 'rgba(255, 240, 140, 0.4)')
      sg.addColorStop(1, 'rgba(255, 240, 140, 0)')
      ctx.fillStyle = sg
      ctx.fillRect(0, 0, W, H * 0.7)
    }

    /* Clouds */
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    function cloud (cx, cy, s) {
      ctx.beginPath()
      ctx.arc(cx, cy, 22 * s, 0, M.TAU)
      ctx.arc(cx + 28 * s, cy - 6 * s, 18 * s, 0, M.TAU)
      ctx.arc(cx + 50 * s, cy, 24 * s, 0, M.TAU)
      ctx.arc(cx + 24 * s, cy + 4 * s, 16 * s, 0, M.TAU)
      ctx.fill()
    }
    cloud(W * 0.12, H * 0.11, 1.1)
    cloud(W * 0.35, H * 0.07, 0.8)
    cloud(W * 0.55, H * 0.14, 1.0)
    cloud(W * 0.88, H * 0.09, 0.7)

    /* Distant hills — two overlapping curves for depth */
    ctx.fillStyle = '#5fb84a'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.72)
    ctx.quadraticCurveTo(W * 0.25, H * 0.62, W * 0.5, H * 0.68)
    ctx.quadraticCurveTo(W * 0.75, H * 0.74, W, H * 0.66)
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#4fa83a'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.78)
    ctx.quadraticCurveTo(W * 0.3, H * 0.7, W * 0.6, H * 0.76)
    ctx.quadraticCurveTo(W * 0.8, H * 0.8, W, H * 0.74)
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()

    /* Grass strip at bottom — BTD6-style bright green band */
    ctx.fillStyle = '#6abf4b'
    ctx.fillRect(0, H * 0.82, W, H * 0.18)

    /* Grass tufts */
    ctx.strokeStyle = '#5aa83d'
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    for (let i = 0; i < 60; i++) {
      const gx = (i / 60) * W + Math.sin(i * 3.7) * 12
      const gy = H * 0.82 + Math.abs(Math.sin(i * 2.1)) * 8
      ctx.beginPath()
      ctx.moveTo(gx, gy)
      ctx.lineTo(gx - 2, gy - 6 - Math.abs(Math.sin(i * 1.3)) * 4)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(gx + 3, gy)
      ctx.lineTo(gx + 5, gy - 5 - Math.abs(Math.cos(i * 1.7)) * 3)
      ctx.stroke()
    }

    ctx.restore()
  }

  function drawPreview (ctx, m) {
    ctx.save()
    ctx.fillStyle = m.bg
    ctx.fillRect(m.x, m.y, m.w, m.h)
    ctx.strokeStyle = C.line
    ctx.lineWidth = 1
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1)

    const sx = m.w / FIELD_W
    const sy = m.h / FIELD_H
    ctx.strokeStyle = m.colour
    ctx.lineWidth = m.lineWidth
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (let p = 0; p < m.paths.length; p++) {
      const pts = m.paths[p]
      if (!Array.isArray(pts) || pts.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const px = m.x + pts[i].x * sx
        const py = m.y + pts[i].y * sy
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  function paintMark (ctx, m) {
    switch (m.kind) {
      case 'text': drawText(ctx, m.x, m.y, m.text, m.size, m.colour, m.align, m.weight, m.alpha); break
      case 'tracked': drawTracked(ctx, m); break
      case 'rule':
        ctx.save()
        if (m.alpha !== 1) ctx.globalAlpha = m.alpha
        ctx.fillStyle = m.colour
        ctx.fillRect(m.x, m.y, m.w, 1)
        ctx.restore()
        break
      case 'box': drawBox(ctx, m); break
      case 'chip': drawChip(ctx, m); break
      case 'balloon': drawBalloonMark(ctx, m); break
      case 'portrait': drawPortraitMark(ctx, m); break
      case 'icon': drawIconMark(ctx, m); break
      case 'dot': drawDotMark(ctx, m); break
      case 'ring': drawRingMark(ctx, m); break
      case 'titleBg': drawTitleBackdrop(ctx, m); break
      case 'logo': drawLogoMark(ctx, m); break
      case 'preview': drawPreview(ctx, m); break
      default: break        // an unknown mark is skipped, never thrown over
    }
  }

  function toneColours (w, hover) {
    const primary = w.tone === 'primary'
    const danger = w.tone === 'danger'
    let fill = w.selected ? C.panelSel : C.panel
    let stroke = w.selected ? C.moss : C.line
    let ink = C.ink
    if (primary) { stroke = C.moss; fill = w.selected ? C.panelSel : C.panelHi }
    if (danger) { stroke = C.bad; ink = C.bad }
    if (hover && !w.disabled) { fill = C.panelHi; stroke = primary ? C.moss : C.lineHi }
    // Disabled is a muted dark wood, never the page background — the old
    // C.bg fill turned every locked card bright sky blue overnight when the
    // palette went blue, which read as "available" instead of "off".
    if (w.disabled) { ink = C.faint; stroke = C.line; fill = '#4a3a28' }
    return { fill: fill, stroke: stroke, ink: ink }
  }

  function paintWidget (ctx, w, hover) {
    const t = toneColours(w, hover)
    switch (w.kind) {
      case 'button': {
        drawBox(ctx, UI.box(w.x, w.y, w.w, w.h, { fill: t.fill, stroke: t.stroke, alpha: 1 }))
        const hasIcon = w.icon && typeof drawIconMark === 'function'
        const iconSpace = hasIcon ? 20 : 0
        const cx = w.align === 'center' ? w.x + w.w / 2 : w.x + 16 + iconSpace
        const baseY = w.sub ? w.y + w.h / 2 - 2 : w.y + w.h / 2 + 5
        if (hasIcon) {
          drawIconMark(ctx, { kind: 'icon', x: w.x + 18, y: w.y + w.h / 2, r: 10, key: w.icon, colour: t.ink })
        }
        drawTracked(ctx, UI.tracked(w.align === 'center' ? cx - UI.trackedWidth(UI.tracked(0, 0, w.label, { size: 14 })) / 2 : cx,
          baseY, w.label, { size: 14, colour: t.ink, track: 0.18 }))
        if (w.sub) drawText(ctx, cx, w.y + w.h / 2 + 14, UI.clipText(w.sub, 10, w.w - 24 - iconSpace), 10, w.disabled ? C.faint : C.dim, w.align === 'center' ? 'center' : 'left')
        if (hover && !w.disabled) {
          ctx.save(); ctx.fillStyle = C.moss
          ctx.beginPath(); roundRectPath(ctx, w.x, w.y, w.w, w.h, Math.min(10, w.w / 3, w.h / 3)); ctx.clip()
          ctx.fillRect(w.x, w.y, 3, w.h); ctx.restore()
        }
        break
      }
      case 'row': {
        drawBox(ctx, UI.box(w.x, w.y, w.w, w.h, { fill: t.fill, stroke: w.selected ? C.moss : '' }))
        if (w.selected || (hover && !w.disabled)) {
          ctx.save(); ctx.fillStyle = w.selected ? C.moss : C.lineHi
          ctx.beginPath(); roundRectPath(ctx, w.x, w.y, w.w, w.h, Math.min(10, w.w / 3, w.h / 3)); ctx.clip()
          ctx.fillRect(w.x, w.y, 3, w.h); ctx.restore()
        }
        if (w.swatch) {
          ctx.save(); ctx.fillStyle = w.swatch; ctx.fillRect(w.x + 12, w.y + w.h / 2 - 4, 8, 8); ctx.restore()
        }
        const tx = w.x + (w.swatch ? 30 : 14)
        drawText(ctx, tx, w.y + (w.sub ? 19 : w.h / 2 + 4), UI.clipText(w.label, 13, w.w - 100), 13, t.ink, 'left', '600')
        if (w.sub) drawText(ctx, tx, w.y + 34, UI.clipText(w.sub, 10, w.w - 40), 10, w.disabled ? C.faint : C.dim)
        if (w.note) drawText(ctx, w.x + w.w - 12, w.y + (w.sub ? 19 : w.h / 2 + 4), w.note, 10, w.disabled ? C.faint : C.moss, 'right')
        if (w.disabled && w.reason) drawText(ctx, w.x + w.w - 12, w.y + 34, UI.clipText(w.reason, 9, w.w / 2), 9, C.warn, 'right')
        break
      }
      case 'card': {
        drawBox(ctx, UI.box(w.x, w.y, w.w, w.h, { fill: t.fill, stroke: t.stroke }))
        if (w.selected) { ctx.save(); ctx.fillStyle = C.moss; ctx.beginPath(); roundRectPath(ctx, w.x, w.y, w.w, w.h, Math.min(10, w.w / 3, w.h / 3)); ctx.clip(); ctx.fillRect(w.x, w.y, w.w, 3); ctx.restore() }
        const previewW = 76
        const textW = w.w - previewW - 34
        drawText(ctx, w.x + 14, w.y + 24, UI.clipText(w.label, 14, textW), 14, t.ink, 'left', '600')
        const lines = w.lines || []
        for (let i = 0; i < lines.length; i++) {
          drawText(ctx, w.x + 14, w.y + 42 + i * 13, lines[i], 10, w.disabled ? C.faint : C.dim)
        }
        if (w.previewPaths) {
          drawPreview(ctx, UI.preview(w.x + w.w - previewW - 12, w.y + 12, previewW, Math.round(previewW * FIELD_H / FIELD_W), w.previewPaths))
        }
        if (w.pips && w.pips.length) paintPips(ctx, w.x + 14, w.y + w.h - 16, w.pips)
        if (w.note) drawText(ctx, w.x + w.w - 12, w.y + w.h - 12, w.note, 9, C.faint, 'right')
        break
      }
      case 'tab': {
        const active = w.selected
        drawText(ctx, w.x + w.w / 2, w.y + w.h / 2 + 5, w.label, 12, active ? C.ink : (hover ? C.dim : C.faint), 'center', active ? '600' : '')
        ctx.save()
        ctx.fillStyle = active ? C.moss : C.line
        ctx.fillRect(w.x, w.y + w.h - 1, w.w, active ? 2 : 1)
        ctx.restore()
        break
      }
      case 'slider': {
        const v = M.clamp(typeof w.value === 'number' ? w.value : 0, 0, 1)
        drawText(ctx, w.x, w.y - 10, w.label, 11, C.dim)
        drawText(ctx, w.x + w.w, w.y - 10, Math.round(v * 100) + '%', 11, C.moss, 'right')
        ctx.save()
        ctx.fillStyle = C.panel
        ctx.fillRect(w.x, w.y + w.h / 2 - 3, w.w, 6)
        ctx.fillStyle = C.moss
        ctx.fillRect(w.x, w.y + w.h / 2 - 3, w.w * v, 6)
        ctx.fillStyle = hover ? C.ink : C.moss
        ctx.fillRect(w.x + w.w * v - 2, w.y + 2, 5, w.h - 4)
        ctx.restore()
        break
      }
      case 'toggle': {
        const on = !!w.on
        drawBox(ctx, UI.box(w.x, w.y + w.h / 2 - 9, 18, 18, { fill: on ? C.moss : C.panel, stroke: on ? C.moss : (hover ? C.lineHi : C.line) }))
        if (on) {
          ctx.save()
          ctx.strokeStyle = C.bg
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(w.x + 5, w.y + w.h / 2)
          ctx.lineTo(w.x + 8, w.y + w.h / 2 + 4)
          ctx.lineTo(w.x + 13, w.y + w.h / 2 - 5)
          ctx.stroke()
          ctx.restore()
        }
        drawText(ctx, w.x + 30, w.y + w.h / 2 + 4, UI.clipText(w.label, 12, w.w - 40), 12, hover ? C.ink : C.dim)
        if (w.sub) drawText(ctx, w.x + w.w, w.y + w.h / 2 + 4, w.sub, 10, C.faint, 'right')
        break
      }
      default: break
    }
  }

  function paintPips (ctx, x, y, pips) {
    ctx.save()
    for (let i = 0; i < pips.length; i++) {
      const p = pips[i]
      const cx = x + i * 16
      ctx.beginPath()
      ctx.arc(cx + 4, y, 4, 0, M.TAU)
      if (p.done) { ctx.fillStyle = C.moss; ctx.fill() } else { ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke() }
      if (p.label) {
        setFont(ctx, 8, '')
        ctx.fillStyle = p.done ? C.bg : C.faint
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.label, cx + 4, y + 0.5)
      }
    }
    ctx.restore()
  }

  /**
   * Paint a model. The only function in the UI layer that touches a ctx, and it
   * changes nothing else — call it as often as you like.
   */
  UI.paint = function (ctx, model, opts) {
    if (!ctx || !model) return 0
    opts = opts || {}
    const hoverId = opts.hoverId === undefined ? null : opts.hoverId
    let drawn = 0

    if (model.backdrop === 'solid') {
      ctx.save(); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, FIELD_W, FIELD_H); ctx.restore()
      drawn++
    } else if (model.backdrop === 'scrim') {
      ctx.save(); ctx.globalAlpha = 0.86; ctx.fillStyle = C.deep; ctx.fillRect(0, 0, FIELD_W, FIELD_H); ctx.restore()
      drawn++
    }

    const marks = model.marks || []
    for (let i = 0; i < marks.length; i++) {
      if (!marks[i]) continue
      try { paintMark(ctx, marks[i]); drawn++ } catch (e) { /* one bad mark must not lose the frame */ }
    }

    const widgets = model.widgets || []
    for (let i = 0; i < widgets.length; i++) {
      const w = widgets[i]
      if (!w) continue
      try { paintWidget(ctx, w, w.id === hoverId); drawn++ } catch (e) { /* ditto */ }
    }
    return drawn
  }

  Menus.UI = UI
  Menus.COLOURS = C

  /* ============================================================================
     MODULE STATE

     The sub-screen lives here, not on the sim and not on App.state — App.state
     .screen only says whether the shell is showing menus, a board, or results.
     ============================================================================ */

  const state = {
    screen: 'title',        // title | maps | setup | settings | bestiary
    mapKey: null,
    difficulty: 'medium',
    mode: 'standard',
    mapScroll: 0,
    mapMaxScroll: 0,
    notice: '',
    hoverId: null,
    confirmReset: false,
    hasRun: false,
    runCheckedAt: 0
  }

  Menus.state = state

  const SCREENS = {}

  /**
   * Register a screen. `spec.build(app)` returns a model; `spec.activate(app,
   * widget, model)` returns true when it handled the press; `spec.key(app, key,
   * model)` and `spec.paint(ctx, model, app)` are optional.
   *
   * bestiary.js registers itself this way rather than menus.js knowing about it.
   */
  Menus.registerScreen = function (key, spec) {
    SCREENS[key] = spec || {}
    return key
  }

  Menus.screenNames = function () { return Object.keys(SCREENS).sort() }

  const BACK_TO = { maps: 'title', setup: 'maps', settings: 'title', bestiary: 'title', daily: 'title', 'trophy-store': 'title', title: 'title' }

  Menus.go = function (app, screen) {
    state.screen = SCREENS[screen] ? screen : 'title'
    state.notice = ''
    state.confirmReset = false
    state.hoverId = null
    refreshRun(true)
    return state.screen
  }

  Menus.back = function (app) {
    const spec = SCREENS[state.screen]
    if (spec && typeof spec.back === 'function') {
      const to = spec.back(app)
      if (to) return Menus.go(app, to)
    }
    return Menus.go(app, BACK_TO[state.screen] || 'title')
  }

  /** True when the menus own the screen — i.e. the shell is not mid-game. */
  Menus.active = function (app) {
    const s = app && app.state ? app.state.screen : null
    return s === 'menu' || s === 'results'
  }

  /* ---------- profile plumbing ---------- */

  function profileOf (app) {
    const st = app && app.state ? app.state : null
    if (st && st.profile) return st.profile
    const fresh = OP.Save && OP.Save.defaults ? OP.Save.defaults() : null
    if (st && fresh) st.profile = fresh
    return fresh
  }
  Menus.profile = profileOf

  function settingsOf (app) {
    const p = profileOf(app)
    return (p && p.settings) || {}
  }

  /** Write one setting through OP.Save, persist it, and tell the mixer. */
  function applySetting (app, key, value) {
    let p = profileOf(app)
    if (OP.Save && OP.Save.setSetting) p = OP.Save.setSetting(p, key, value)
    else if (p && p.settings) p.settings[key] = value
    if (app && app.state) app.state.profile = p
    if (OP.Save && OP.Save.save) OP.Save.save(p)
    const s = (p && p.settings) || {}
    if (OP.Audio) {
      if (key === 'musicVolume' && OP.Audio.setMusicVolume) OP.Audio.setMusicVolume(s.musicVolume)
      if (key === 'sfxVolume' && OP.Audio.setSfxVolume) OP.Audio.setSfxVolume(s.sfxVolume)
    }
    return p
  }
  Menus.applySetting = applySetting

  /* localStorage is not free, and the title screen would otherwise re-parse the
     run save sixty times a second. One second of staleness on a "Continue"
     button nobody can have invalidated from another tab mid-frame is fine. */
  function refreshRun (force) {
    const now = Date.now()
    if (!force && now - state.runCheckedAt < 1000) return state.hasRun
    state.runCheckedAt = now
    state.hasRun = !!(OP.Save && OP.Save.hasRun && OP.Save.hasRun())
    return state.hasRun
  }
  Menus.refresh = function () { return refreshRun(true) }

  function click (ok) {
    if (!OP.Audio || !OP.Audio.play) return
    OP.Audio.play(ok === false ? 'deny' : 'ui')
  }

  /* ---------- registry readers ----------
     Every one of these tolerates an empty or half-built registry, because during
     the content build that is the normal state of the world. */

  function allMaps () {
    const out = []
    const order = Array.isArray(OP.MAP_ORDER) ? OP.MAP_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.MAPS ? OP.MAPS[order[i]] : null
      if (def && def.key) out.push(def)
    }
    return out
  }
  Menus.allMaps = allMaps

  function mapTiers () {
    return (OP.Maps && Array.isArray(OP.Maps.TIERS)) ? OP.Maps.TIERS : ['beginner', 'intermediate', 'advanced', 'expert']
  }

  function difficultyKeys () {
    const order = Array.isArray(OP.DIFFICULTY_ORDER) ? OP.DIFFICULTY_ORDER : []
    return order.filter(function (k) { return !!(OP.DIFFICULTIES && OP.DIFFICULTIES[k]) })
  }
  Menus.difficultyKeys = difficultyKeys

  function modeKeys () {
    const order = Array.isArray(OP.MODE_ORDER) ? OP.MODE_ORDER : []
    return order.filter(function (k) { return !!(OP.MODES && OP.MODES[k]) })
  }
  Menus.modeKeys = modeKeys

  function modeAllowed (modeKey, difficultyKey) {
    if (typeof OP.modeAllowedOn === 'function') {
      try { return !!OP.modeAllowedOn(modeKey, difficultyKey) } catch (e) { return false }
    }
    return true
  }

  /** Why a mode is not offered on this difficulty, phrased for the player. */
  function modeGateReason (modeKey) {
    const diffs = difficultyKeys()
    for (let i = 0; i < diffs.length; i++) {
      if (modeAllowed(modeKey, diffs[i])) {
        const d = OP.DIFFICULTIES[diffs[i]]
        return 'needs ' + ((d && d.name) || diffs[i]) + ' or above'
      }
    }
    return 'unavailable'
  }

  /* Selections are re-resolved against the live registry on every build. A key
     kept from a previous session — or from before a registry was emptied — must
     never be dereferenced. */

  function resolveMap () {
    const maps = allMaps()
    if (!maps.length) { state.mapKey = null; return null }
    for (let i = 0; i < maps.length; i++) if (maps[i].key === state.mapKey) return maps[i]
    state.mapKey = maps[0].key
    return maps[0]
  }

  function resolveDifficulty () {
    const keys = difficultyKeys()
    if (!keys.length) return null
    if (keys.indexOf(state.difficulty) < 0) state.difficulty = keys[0]
    return OP.DIFFICULTIES[state.difficulty]
  }

  function resolveMode () {
    const keys = modeKeys()
    if (!keys.length) return null
    if (keys.indexOf(state.mode) < 0) state.mode = keys[0]
    return OP.MODES[state.mode]
  }

  /* ---------- shared chrome ---------- */

  function chrome (marks, title, sub) {
    marks.push(UI.tracked(PAD, 92, title, { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    if (sub) marks.push(UI.text(PAD, 114, sub, { size: 11, colour: C.dim }))
    marks.push(UI.rule(PAD, 130, CONTENT_W))
  }

  function footer (marks, hint) {
    marks.push(UI.rule(PAD, 676, CONTENT_W, { alpha: 0.6 }))
    marks.push(UI.text(PAD, 700, hint || 'ESC back · ENTER confirm', { size: 10, colour: C.faint }))
  }

  function noticeMark (marks) {
    if (!state.notice) return
    marks.push(UI.text(FIELD_W - PAD, 700, state.notice, { size: 10, colour: C.warn, align: 'right' }))
  }

  /* ============================================================================
     TITLE
     ============================================================================ */

  function buildTitle (app) {
    const marks = []
    const widgets = []
    const p = profileOf(app)

    /* Illustrated backdrop — sky gradient, sun, clouds, hills, grass */
    marks.push({ kind: 'titleBg', x: 0, y: 0, w: FIELD_W, h: FIELD_H })

    /* Big logo with outline shadow — the BTD6-style hero title */
    marks.push({ kind: 'logo', x: PAD, y: 130, text: 'OVERPOP', size: 80, colour: C.ink, stroke: '#2a1a0a', track: 0.18 })
    marks.push(UI.tracked(PAD + 6, 175, 'AN ORIGINAL TOWER DEFENSE', { size: 12, colour: C.gold, track: 0.34 }))
    marks.push(UI.text(PAD, 198, 'Every sprite drawn in code. Every sound synthesised.', { size: 10, colour: C.dim }))

    /* Decorative balloon row — floats in the sky area */
    const tiers = Array.isArray(OP.BALLOON_TIERS) ? OP.BALLOON_TIERS : []
    const shown = tiers.slice(0, 6)
    for (let i = 0; i < shown.length; i++) {
      marks.push(UI.balloon(PAD + 420 + i * 40, 110 + Math.sin(i * 1.8) * 14, 10, shown[i]))
    }

    /* Left column: primary buttons on a wooden panel background */
    marks.push(UI.box(PAD - 12, 220, 400, 320, { fill: 'rgba(90, 55, 25, 0.55)', stroke: '#4a2f18' }))
    const bx = PAD + 8, bw = 370, bh = 50, gap = 6
    let byL = 240

    widgets.push(UI.button('title.play', bx, byL, bw, bh, {
      label: 'PLAY', tone: 'primary', action: 'goto', arg: 'maps',
      sub: 'choose a map, a difficulty and a mode'
    }))
    byL += bh + gap
    if (refreshRun()) {
      widgets.push(UI.button('title.continue', bx, byL, bw, bh, {
        label: 'CONTINUE', action: 'continue', sub: 'resume the run in progress'
      }))
      byL += bh + gap
    }
    widgets.push(UI.button('title.settings', bx, byL, bw, bh, {
      label: 'SETTINGS', action: 'goto', arg: 'settings', sub: 'volume, trails, round autostart'
    }))
    byL += bh + gap
    widgets.push(UI.button('title.store', bx, byL, bw, bh, {
      label: 'TROPHY STORE', action: 'goto', arg: 'trophy-store',
      sub: 'spend trophies on looks and critter crates'
    }))

    /* Right column: content screens on a panel */
    const gx = 540, gw = 220, gh = 38
    marks.push(UI.box(gx - 10, 220, 240, 320, { fill: 'rgba(90, 55, 25, 0.55)', stroke: '#4a2f18' }))
    let byR = 240
    widgets.push(UI.button('title.bestiary', gx, byR, gw, gh, {
      label: 'BESTIARY', action: 'goto', arg: 'bestiary', sub: 'balloons, immunities and towers'
    }))
    byR += gh + gap
    widgets.push(UI.button('title.towers', gx, byR, gw, gh, {
      label: 'TOWERS', action: 'goto', arg: 'towers', sub: 'upgrades, costs and tower XP'
    }))
    byR += gh + gap
    if (OP.Drafts && OP.Drafts.list) {
      var draftsOwned = OP.Drafts.count(profileOf(app))
      if (draftsOwned > 0) {
        widgets.push(UI.button('title.drafts', gx, byR, gw, gh, {
          label: 'DRAFTS', action: 'goto', arg: 'drafts',
          sub: draftsOwned + ' token' + (draftsOwned === 1 ? '' : 's') + ' — free placed towers'
        }))
        byR += gh + gap
      }
    }
    widgets.push(UI.button('title.knowledge', gx, byR, gw, gh, {
      label: 'CRITTER WISDOM', action: 'goto', arg: 'knowledge', sub: 'spend knowledge points on permanent bonuses'
    }))
    byR += gh + gap
    if (OP.Daily && OP.DailyCore) {
      var daily = OP.DailyCore.summary ? OP.DailyCore.summary(profileOf(app)) : null
      var dailyDone = daily && daily.done
      var dailySub = dailyDone ? 'already completed today — come back tomorrow' : 'a fresh challenge every day'
      widgets.push(UI.button('title.daily', gx, byR, gw, gh, {
        label: 'DAILY CHALLENGE', action: 'goto', arg: 'daily', sub: dailySub,
        disabled: dailyDone
      }))
      byR += gh + gap
    }
    if (OP.Expedition && OP.Expeditions) {
      var expActive = OP.Expedition.isActive(profileOf(app))
      var expSub = expActive ? 'resume your active expedition' : 'multi-map campaigns with resource carry-over'
      widgets.push(UI.button('title.expedition', gx, byR, gw, gh, {
        label: 'EXPEDITION', action: 'goto', arg: 'expedition', sub: expSub
      }))
      byR += gh + gap
    }
    if (OP.Trial && OP.Trials) {
      var trialActive = OP.Trial.isActive(profileOf(app))
      var trialSub = trialActive ? 'resume your active trial' : 'curated challenge scenarios with unique rules'
      widgets.push(UI.button('title.trial', gx, byR, gw, gh, {
        label: 'TRIALS', action: 'goto', arg: 'trials', sub: trialSub
      }))
      byR += gh + gap
    }
    if (OP.Legends && OP.LegendsData) {
      var legendsActive = OP.Legends.isActive(profileOf(app))
      var legendsSub = legendsActive ? 'resume your active campaign' : 'a rogue-lite campaign across escalating stages'
      widgets.push(UI.button('title.legends', gx, byR, gw, gh, {
        label: 'LEGENDS', action: 'goto', arg: 'legends', sub: legendsSub
      }))
      byR += gh + gap
    }
    if (OP.BossEvent && OP.Boss) {
      var bossSub = 'weekly rotating boss fights with tier rewards'
      widgets.push(UI.button('title.bossEvent', gx, byR, gw, gh, {
        label: 'BOSS EVENT', action: 'goto', arg: 'boss-event', sub: bossSub
      }))
      byR += gh + gap
    }

    /* Record panel — far right column */
    const rx = 800
    marks.push(UI.box(rx - 10, 60, 400, 420, { fill: 'rgba(90, 55, 25, 0.55)', stroke: '#4a2f18' }))
    marks.push(UI.tracked(rx, 82, 'RECORD', { size: 12, colour: C.gold, track: 0.3 }))
    marks.push(UI.rule(rx, 94, 370))
    const stats = (p && p.stats) || {}
    const xp = OP.Save && OP.Save.xpProgress
      ? OP.Save.xpProgress(p)
      : { level: 1, current: 0, needed: 1000 }
    let best = 0
    const bestMap = (stats.bestRound && typeof stats.bestRound === 'object') ? stats.bestRound : {}
    for (const k in bestMap) if (bestMap[k] > best) best = bestMap[k]
    const rows = [
      ['Games played', stats.gamesPlayed || 0],
      ['Games won', stats.gamesWon || 0],
      ['Rounds cleared', stats.roundsCleared || 0],
      ['Balloons popped', fmtBig(stats.totalPops || 0)],
      ['Cash earned', '$' + fmtBig(stats.totalCash || 0)],
      ['Best round', best || '—'],
      ['Player level', xp.level],
      ['Next level', xp.current + ' / ' + xp.needed + ' XP']
    ]
    for (let i = 0; i < rows.length; i++) {
      const y = 118 + i * 26
      marks.push(UI.text(rx, y, rows[i][0], { size: 11, colour: C.dim }))
      marks.push(UI.text(rx + 360, y, String(rows[i][1]), { size: 12, colour: C.ink, align: 'right' }))
    }

    marks.push(UI.text(PAD, FIELD_H - 12, 'v' + (OP.VERSION || '?') + ' · no downloads, works offline', { size: 10, colour: C.dim }))
    noticeMark(marks)

    return {
      screen: 'title',
      backdrop: 'solid',
      marks: marks,
      widgets: widgets,
      defaultId: UI.byId(widgets, 'title.continue') ? 'title.continue' : 'title.play'
    }
  }

  function fmtBig (n) {
    if (OP.M && OP.M.compact) return OP.M.compact(n)
    return String(n)
  }

  function activateTitle (app, w) {
    if (w.action === 'continue') {
      const sim = app && app.resumeGame ? app.resumeGame() : null
      if (!sim) {
        state.notice = 'That saved run could not be resumed.'
        refreshRun(true)
        click(false)
        return true
      }
      click(true)
      return true
    }
    return false
  }

  /* ============================================================================
     SETTINGS
     ============================================================================ */

  function buildSettings (app) {
    const marks = []
    const widgets = []
    const s = settingsOf(app)

    chrome(marks, 'SETTINGS', 'stored on this device · applied immediately')
    widgets.push(UI.button('settings.back', FIELD_W - PAD - 96, 74, 96, 32, { label: 'BACK', action: 'back', align: 'center' }))

    const x = PAD, w = 440
    marks.push(UI.tracked(x, 184, 'AUDIO', { size: 11, colour: C.moss, track: 0.3 }))
    widgets.push(UI.slider('settings.musicVolume', x, 212, w, 20, {
      label: 'Music', value: num(s.musicVolume, 0.6), action: 'setting', arg: 'musicVolume'
    }))
    widgets.push(UI.slider('settings.sfxVolume', x, 262, w, 20, {
      label: 'Effects', value: num(s.sfxVolume, 0.8), action: 'setting', arg: 'sfxVolume'
    }))

    marks.push(UI.tracked(x, 330, 'GAMEPLAY', { size: 11, colour: C.moss, track: 0.3 }))
    const toggles = [
      ['showTrails', 'Projectile trails', 'cosmetic only'],
      ['confirmSell', 'Confirm before selling', 'a mis-tap costs a tower'],
      ['autostart', 'Start rounds automatically', 'no waiting between waves']
    ]
    for (let i = 0; i < toggles.length; i++) {
      widgets.push(UI.toggle('settings.' + toggles[i][0], x, 352 + i * 40, w, 32, {
        label: toggles[i][1], sub: toggles[i][2], on: !!s[toggles[i][0]], action: 'setting', arg: toggles[i][0]
      }))
    }

    marks.push(UI.tracked(x, 508, 'DEFAULT SPEED', { size: 11, colour: C.moss, track: 0.3 }))
    const speed = num(s.gameSpeed, 1)
    for (let i = 1; i <= 3; i++) {
      widgets.push(UI.button('settings.speed' + i, x + (i - 1) * 76, 526, 66, 38, {
        label: i + '×', align: 'center', selected: Math.round(speed) === i, action: 'setting-speed', arg: i
      }))
    }

    // Destructive, so it takes two presses and says so on the first.
    const rx = 700
    marks.push(UI.tracked(rx, 184, 'PROFILE', { size: 11, colour: C.moss, track: 0.3 }))
    marks.push(UI.text(rx, 212, 'Settings, completions and lifetime', { size: 10, colour: C.faint }))
    marks.push(UI.text(rx, 226, 'statistics all live in this browser.', { size: 10, colour: C.faint }))
    widgets.push(UI.button('settings.reset', rx, 246, 300, 44, {
      label: state.confirmReset ? 'PRESS AGAIN TO ERASE' : 'RESET PROGRESS',
      tone: 'danger', align: 'center', action: 'reset'
    }))
    if (state.confirmReset) marks.push(UI.text(rx, 306, 'This cannot be undone.', { size: 10, colour: C.bad }))

    footer(marks, 'ESC back')
    noticeMark(marks)
    return { screen: 'settings', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'settings.back' }
  }

  function num (v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback
  }

  function activateSettings (app, w, model, point) {
    if (w.action === 'setting') {
      if (w.kind === 'slider') {
        const v = UI.sliderValue(w, point && typeof point.x === 'number' ? point.x : w.x)
        applySetting(app, w.arg, v)
      } else {
        applySetting(app, w.arg, !w.on)
      }
      click(true)
      return true
    }
    if (w.action === 'setting-speed') {
      applySetting(app, 'gameSpeed', w.arg)
      click(true)
      return true
    }
    if (w.action === 'reset') {
      if (!state.confirmReset) { state.confirmReset = true; click(false); return true }
      state.confirmReset = false
      if (OP.Save && OP.Save.reset) {
        const fresh = OP.Save.reset()
        if (app && app.state) app.state.profile = fresh
      }
      refreshRun(true)
      state.notice = 'Progress erased.'
      click(true)
      return true
    }
    return false
  }

  /* ============================================================================
     MAP SELECT
     ============================================================================ */

  /** Completion summary for one map: which difficulties are done, and how many
      difficulty/mode cells in total. */
  function completionOf (app, mapKey) {
    const p = profileOf(app)
    const cell = p && p.completions ? p.completions[mapKey] : null
    const diffs = difficultyKeys()
    const pips = []
    let cells = 0
    for (let i = 0; i < diffs.length; i++) {
      const modes = cell ? cell[diffs[i]] : null
      let n = 0
      if (modes) for (const m in modes) if (modes[m] === true) n++
      cells += n
      const d = OP.DIFFICULTIES[diffs[i]]
      pips.push({ label: ((d && d.name) || diffs[i]).charAt(0).toUpperCase(), done: n > 0 })
    }
    return { pips: pips, cells: cells }
  }
  Menus.completionOf = completionOf

  const MAP_VIEW = { x: PAD, y: 150, w: CONTENT_W, h: 514 }
  const MAP_CARD_H = 88
  const MAP_ROW_GAP = 12
  const MAP_HEADER_H = 28

  function mapGroups (maps) {
    const tiers = mapTiers()
    const groups = []
    const seen = {}
    for (let i = 0; i < tiers.length; i++) {
      const list = maps.filter(function (d) { return d.tier === tiers[i] })
      list.forEach(function (d) { seen[d.key] = true })
      if (list.length) groups.push({ tier: tiers[i], maps: list })
    }
    const orphans = maps.filter(function (d) { return !seen[d.key] })
    if (orphans.length) groups.push({ tier: 'other', maps: orphans })
    return groups
  }

  function mapLayout (maps) {
    const groups = mapGroups(maps)
    const perRow = 4
    const gap = 14
    const listW = MAP_VIEW.w - 12
    const cardW = Math.floor((listW - gap * (perRow - 1)) / perRow)
    const entries = []
    let y = 0
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]
      group.y = y
      y += MAP_HEADER_H
      for (let i = 0; i < group.maps.length; i++) {
        entries.push({
          def: group.maps[i],
          x: (i % perRow) * (cardW + gap),
          y: y + Math.floor(i / perRow) * (MAP_CARD_H + MAP_ROW_GAP),
          w: cardW,
          h: MAP_CARD_H
        })
      }
      y += Math.ceil(group.maps.length / perRow) * (MAP_CARD_H + MAP_ROW_GAP) + 10
    }
    return { groups: groups, entries: entries, contentH: Math.max(0, y - MAP_ROW_GAP) }
  }

  Menus.scrollMapsBy = function (dy) {
    const before = state.mapScroll
    state.mapScroll = M.clamp(state.mapScroll + dy, 0, state.mapMaxScroll)
    return state.mapScroll !== before
  }

  function mapPointInside (x, y) {
    return x >= MAP_VIEW.x && x <= MAP_VIEW.x + MAP_VIEW.w &&
      y >= MAP_VIEW.y && y <= MAP_VIEW.y + MAP_VIEW.h
  }

  function buildMaps (app) {
    const marks = []
    const cardWidgets = []
    const chromeWidgets = []
    const listMarks = []
    const maps = allMaps()
    resolveMap()

    chrome(marks, 'SELECT A MAP', maps.length + (maps.length === 1 ? ' map' : ' maps') + ' · grouped by tier')
    chromeWidgets.push(UI.button('maps.back', FIELD_W - PAD - 96, 74, 96, 32, { label: 'BACK', action: 'back', align: 'center' }))

    if (!maps.length) {
      marks.push(UI.text(PAD, 300, 'No maps are registered yet.', { size: 18, colour: C.dim }))
      marks.push(UI.text(PAD, 328, 'js/data/maps-*.js declares them; this screen lists whatever is there.', { size: 11, colour: C.faint }))
      footer(marks, 'ESC back')
      noticeMark(marks)
      return { screen: 'maps', backdrop: 'solid', marks: marks, widgets: chromeWidgets, defaultId: 'maps.back' }
    }

    // The illustrated sky behind a smoked panel keeps the map list readable
    // while the screen no longer looks like a flat colour fill.
    marks.push({ kind: 'titleBg', x: 0, y: 0, w: FIELD_W, h: FIELD_H })
    marks.push(UI.box(PAD - 12, 140, CONTENT_W + 24, FIELD_H - 160, { fill: 'rgba(90, 55, 25, 0.62)', stroke: '#4a2f18' }))

    const layout = mapLayout(maps)
    state.mapMaxScroll = Math.max(0, layout.contentH - MAP_VIEW.h)
    state.mapScroll = M.clamp(state.mapScroll, 0, state.mapMaxScroll)

    for (let g = 0; g < layout.groups.length; g++) {
      const group = layout.groups[g]
      const gy = MAP_VIEW.y + group.y - state.mapScroll
      if (gy + MAP_HEADER_H >= MAP_VIEW.y && gy <= MAP_VIEW.y + MAP_VIEW.h) {
        listMarks.push(UI.tracked(PAD, gy + 12, group.tier.toUpperCase(), { size: 10, colour: C.gold, track: 0.32 }))
        // BTD6 difficulty stars: one per tier level, drawn right of the label.
        const tierNames = mapTiers()
        const stars = Math.max(1, tierNames.indexOf(group.tier) + 1)
        const labelW = UI.trackedWidth(UI.tracked(0, 0, group.tier.toUpperCase(), { size: 10, track: 0.32 }))
        for (let s = 0; s < stars; s++) {
          listMarks.push(UI.icon(PAD + labelW + 16 + s * 15, gy + 8, 6, 'star', { colour: C.gold }))
        }
        listMarks.push(UI.text(FIELD_W - PAD - 12, gy + 12, group.maps.length + (group.maps.length === 1 ? ' map' : ' maps'), { size: 10, colour: C.dim, align: 'right' }))
        listMarks.push(UI.rule(PAD, gy + 20, CONTENT_W - 12, { alpha: 0.5 }))
      }
    }

    const profile = profileOf(app)
    for (let i = 0; i < layout.entries.length; i++) {
      const entry = layout.entries[i]
      const def = entry.def
      const cx = MAP_VIEW.x + entry.x
      const cy = MAP_VIEW.y + entry.y - state.mapScroll
      // Every map is a real, addressable widget in the model regardless of where
      // the scroll has it. paintMaps clips to MAP_VIEW, and each card carries
      // hitClip: MAP_VIEW, so an off-screen card is neither drawn nor tappable —
      // but it IS routable (hit-testing resolves a tap the moment the scroll
      // brings it into view), which is what the tap handler and the roster test
      // rely on. Culling below the fold out of the model would make later maps
      // unreachable as widgets.
      const comp = completionOf(app, def.key)
      const access = OP.Save && OP.Save.mapUnlockInfo
        ? OP.Save.mapUnlockInfo(profile, def)
        : { unlocked: true, reason: '' }
      cardWidgets.push(UI.card('map.' + def.key, cx, cy, entry.w, entry.h, {
        label: def.name || def.key,
        lines: UI.wrapText(def.blurb, 10, entry.w - 110, 2),
        selected: def.key === state.mapKey,
        disabled: !access.unlocked,
        reason: access.reason,
        action: 'setmap',
        arg: def.key,
        pips: comp.pips,
        note: access.unlocked ? (comp.cells ? comp.cells + ' cleared' : '') : access.reason,
        previewPaths: pathsOf(def),
        hitClip: MAP_VIEW
      }))
    }

    if (state.mapMaxScroll > 0) {
      const barW = 5
      const trackX = MAP_VIEW.x + MAP_VIEW.w - barW
      const thumbH = Math.max(28, Math.round(MAP_VIEW.h * (MAP_VIEW.h / layout.contentH)))
      const thumbY = MAP_VIEW.y + Math.round((MAP_VIEW.h - thumbH) * state.mapScroll / state.mapMaxScroll)
      marks.push(UI.box(trackX, MAP_VIEW.y, barW, MAP_VIEW.h, { fill: C.line, alpha: 0.35 }))
      marks.push(UI.box(trackX, thumbY, barW, thumbH, { fill: C.moss, alpha: 0.75 }))
    }

    footer(marks, 'SCROLL or drag to browse · arrows move · ENTER opens')
    noticeMark(marks)
    const widgets = cardWidgets.concat(chromeWidgets)
    const selected = UI.byId(cardWidgets, state.mapKey ? 'map.' + state.mapKey : '')
    const firstOpen = cardWidgets.find(function (w) { return !w.disabled })
    return {
      screen: 'maps',
      backdrop: 'solid',
      marks: marks,
      listMarks: listMarks,
      cardWidgets: cardWidgets,
      chromeWidgets: chromeWidgets,
      clip: MAP_VIEW,
      widgets: widgets,
      contentH: layout.contentH,
      scroll: state.mapScroll,
      maxScroll: state.mapMaxScroll,
      defaultId: selected ? selected.id : (firstOpen ? firstOpen.id : 'maps.back')
    }
  }

  function paintMaps (ctx, model) {
    let drawn = UI.paint(ctx, { backdrop: model.backdrop, marks: model.marks, widgets: [] }, {})
    if (model.clip && ctx.save && ctx.beginPath && ctx.rect && ctx.clip) {
      ctx.save(); ctx.beginPath(); ctx.rect(model.clip.x, model.clip.y, model.clip.w, model.clip.h); ctx.clip()
    }
    drawn += UI.paint(ctx, { marks: model.listMarks || [], widgets: model.cardWidgets || [] }, { hoverId: state.hoverId })
    if (model.clip && ctx.restore) ctx.restore()
    drawn += UI.paint(ctx, { marks: [], widgets: model.chromeWidgets || [] }, { hoverId: state.hoverId })
    return drawn
  }

  function keepMapVisible (mapKey) {
    const layout = mapLayout(allMaps())
    const entry = layout.entries.find(function (e) { return e.def.key === mapKey })
    if (!entry) return
    state.mapMaxScroll = Math.max(0, layout.contentH - MAP_VIEW.h)
    if (entry.y < state.mapScroll) state.mapScroll = entry.y
    else if (entry.y + entry.h > state.mapScroll + MAP_VIEW.h) state.mapScroll = entry.y + entry.h - MAP_VIEW.h
    state.mapScroll = M.clamp(state.mapScroll, 0, state.mapMaxScroll)
  }

  function keyMaps (app, key) {
    const maps = allMaps()
    if (!maps.length) return false
    let index = maps.findIndex(function (m) { return m.key === state.mapKey })
    if (index < 0) index = 0
    let next = index
    if (key === 'ArrowLeft') next--
    else if (key === 'ArrowRight') next++
    else if (key === 'ArrowUp') next -= 4
    else if (key === 'ArrowDown') next += 4
    else if (key === 'PageUp') next -= 12
    else if (key === 'PageDown') next += 12
    else if (key === 'Home') next = 0
    else if (key === 'End') next = maps.length - 1
    else return false
    next = M.clamp(next, 0, maps.length - 1)
    state.mapKey = maps[next].key
    keepMapVisible(state.mapKey)
    return true
  }

  /** Authored control points per path, for the preview. Never builds Tracks — a
      map preview must cost nothing and must work on an unbuilt definition. */
  function pathsOf (def) {
    const out = []
    const paths = (def && def.paths) || []
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]
      if (p && Array.isArray(p.points) && p.points.length >= 2) out.push(p.points)
    }
    return out
  }
  Menus.pathsOf = pathsOf

  function activateMaps (app, w) {
    if (w.action === 'setmap') {
      if (w.disabled) {
        state.notice = w.reason || 'That map is still locked.'
        click(false)
        return true
      }
      state.mapKey = w.arg
      click(true)
      Menus.go(app, 'setup')
      return true
    }
    return false
  }

  /* ============================================================================
     DIFFICULTY / MODE SELECT
     ============================================================================ */

  function rulesFor (difficultyKey, modeKey) {
    if (!OP.Sim || typeof OP.Sim.resolveRules !== 'function') return null
    try { return OP.Sim.resolveRules({ difficulty: difficultyKey, mode: modeKey }) } catch (e) { return null }
  }

  function buildSetup (app) {
    const marks = []
    const widgets = []
    const map = resolveMap()
    const diff = resolveDifficulty()
    const mode = resolveMode()

    chrome(marks, 'DIFFICULTY & MODE', map ? (map.name + ' · ' + String(map.tier || '').toUpperCase()) : 'no map selected')
    widgets.push(UI.button('setup.back', FIELD_W - PAD - 96, 74, 96, 32, { label: 'BACK', action: 'back', align: 'center' }))

    /* ----- difficulties ----- */
    const dx = PAD, dw = 420
    marks.push(UI.tracked(dx, 176, 'DIFFICULTY', { size: 11, colour: C.moss, track: 0.32 }))
    const diffs = difficultyKeys()
    if (!diffs.length) {
      marks.push(UI.text(dx, 214, 'No difficulties are registered.', { size: 12, colour: C.dim }))
    }
    for (let i = 0; i < diffs.length; i++) {
      const d = OP.DIFFICULTIES[diffs[i]]
      const r = (d && d.rules) || {}
      const rounds = (r.firstRound || 1) + '–' + (r.lastRound || '?')
      const sub = (r.startLives || '?') + ' lives · rounds ' + rounds + ' · prices ×' + (r.costMul === undefined ? 1 : r.costMul)
      widgets.push(UI.row('diff.' + diffs[i], dx, 194 + i * 62, dw, 54, {
        label: (d && d.name) || diffs[i],
        sub: sub,
        selected: diffs[i] === state.difficulty,
        action: 'setdiff',
        arg: diffs[i]
      }))
    }

    /* ----- the chosen combination, spelled out ----- */
    const sy = 194 + Math.max(1, diffs.length) * 62 + 12
    const rules = rulesFor(state.difficulty, state.mode)
    marks.push(UI.rule(dx, sy, dw, { alpha: 0.6 }))
    if (rules) {
      const cells = [
        ['LIVES', rules.startLives],
        ['CASH', '$' + rules.startCash],
        ['ROUNDS', rules.firstRound + '–' + rules.lastRound],
        ['PRICES', '×' + rules.costMul]
      ]
      for (let i = 0; i < cells.length; i++) {
        const cx = dx + i * Math.floor(dw / 4)
        marks.push(UI.text(cx, sy + 22, cells[i][0], { size: 9, colour: C.faint }))
        marks.push(UI.text(cx, sy + 42, String(cells[i][1]), { size: 15, colour: C.ink, weight: '600' }))
      }
    }

    /* ----- the map, so the choice is never abstract ----- */
    const pvY = 508
    if (map) {
      marks.push(UI.preview(dx, pvY, 149, 84, pathsOf(map)))
      marks.push(UI.text(dx + 165, pvY + 16, map.name || map.key, { size: 13, colour: C.ink, weight: '600' }))
      const lanes = pathsOf(map).length
      marks.push(UI.text(dx + 165, pvY + 34, lanes + (lanes === 1 ? ' lane' : ' lanes') +
        (map.trackWidth ? ' · margin ' + map.trackWidth : ''), { size: 10, colour: C.faint }))
      const blurb = UI.wrapText(map.blurb, 10, dw - 175, 2)
      for (let i = 0; i < blurb.length; i++) {
        marks.push(UI.text(dx + 165, pvY + 54 + i * 13, blurb[i], { size: 10, colour: C.dim }))
      }
    } else {
      marks.push(UI.text(dx, pvY + 20, 'No map selected — go back and pick one.', { size: 11, colour: C.warn }))
    }

    const allowed = !!(mode && diff && modeAllowed(state.mode, state.difficulty))
    const startY = 606
    widgets.push(UI.button('setup.start', dx, startY, dw, 54, {
      label: 'START',
      tone: 'primary',
      align: 'center',
      disabled: !map || !diff || !mode || !allowed,
      sub: map && diff && mode
        ? (map.name + ' · ' + diff.name + ' · ' + mode.name)
        : 'pick a map, a difficulty and a mode',
      action: 'start'
    }))
    if (!allowed && mode && diff) {
      marks.push(UI.text(dx, startY - 10, mode.name + ' ' + modeGateReason(state.mode) + '.', { size: 10, colour: C.warn }))
    }

    /* ----- modes ----- */
    const mx = 568, mw = FIELD_W - PAD - mx
    marks.push(UI.tracked(mx, 176, 'MODE', { size: 11, colour: C.moss, track: 0.32 }))
    const modes = modeKeys()
    if (!modes.length) {
      marks.push(UI.text(mx, 214, 'No modes are registered.', { size: 12, colour: C.dim }))
    }
    const rowH = 40
    for (let i = 0; i < modes.length; i++) {
      const m = OP.MODES[modes[i]]
      const ok = modeAllowed(modes[i], state.difficulty)
      widgets.push(UI.row('mode.' + modes[i], mx, 190 + i * (rowH + 2), mw, rowH, {
        label: (m && m.name) || modes[i],
        sub: UI.clipText((m && m.blurb) || '', 10, mw - 200),
        selected: modes[i] === state.mode,
        disabled: !ok,
        reason: ok ? '' : modeGateReason(modes[i]),
        action: 'setmode',
        arg: modes[i]
      }))
    }

    footer(marks, 'ESC back · ENTER starts the run')
    noticeMark(marks)
    return { screen: 'setup', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'setup.start' }
  }

  function activateSetup (app, w) {
    if (w.action === 'setdiff') {
      state.difficulty = w.arg
      // A difficulty change can invalidate the mode (PURIST is gated). Fall back
      // rather than leaving a disabled START and no explanation.
      if (!modeAllowed(state.mode, state.difficulty)) {
        const was = (OP.MODES[state.mode] && OP.MODES[state.mode].name) || state.mode
        const keys = modeKeys()
        for (let i = 0; i < keys.length; i++) {
          if (modeAllowed(keys[i], state.difficulty)) { state.mode = keys[i]; break }
        }
        state.notice = was + ' is not available on this difficulty.'
      } else {
        state.notice = ''
      }
      click(true)
      return true
    }
    if (w.action === 'setmode') {
      if (w.disabled) {
        state.notice = w.label + ' ' + w.reason + '.'
        click(false)
        return true
      }
      state.mode = w.arg
      state.notice = ''
      click(true)
      return true
    }
    if (w.action === 'start') {
      if (w.disabled) { click(false); return true }
      click(true)
      if (app && app.startGame) app.startGame(state.mapKey, state.difficulty, state.mode)
      return true
    }
    return false
  }

  /* ============================================================================
     DAILY CHALLENGE SCREEN
     ============================================================================ */

  function buildDaily (app) {
    const marks = []
    const widgets = []
    const p = profileOf(app)

    marks.push(UI.tracked(PAD, 190, 'DAILY CHALLENGE', { size: 48, colour: C.ink, track: 0.14, weight: '600' }))
    marks.push(UI.rule(PAD, 230, 360))

    if (!OP.Daily || !OP.DailyCore) {
      marks.push(UI.text(PAD, 270, 'Daily challenge is not available.', { size: 14, colour: C.dim }))
      return { screen: 'daily', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: null }
    }

    var summary = OP.DailyCore.summary(p)
    var challenge = summary.challenge

    if (!challenge) {
      marks.push(UI.text(PAD, 270, 'Could not generate today\'s challenge.', { size: 14, colour: C.dim }))
      return { screen: 'daily', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: null }
    }

    marks.push(UI.text(PAD, 262, challenge.dateKey, { size: 14, colour: C.moss, weight: '600' }))

    var descLines = UI.wrapText(challenge.description, 12, 400, 4)
    for (var i = 0; i < descLines.length; i++) {
      marks.push(UI.text(PAD, 290 + i * 18, descLines[i], { size: 12, colour: C.ink }))
    }

    var modY = 290 + descLines.length * 18 + 12
    if (challenge.modifiers.length > 0) {
      marks.push(UI.text(PAD, modY, 'MODIFIERS', { size: 10, colour: C.moss, track: 0.2 }))
      modY += 16
      for (var j = 0; j < challenge.modifiers.length; j++) {
        var mod = challenge.modifiers[j]
        var modText = mod.name + (mod.detail ? ': ' + mod.detail : '')
        marks.push(UI.text(PAD + 12, modY, modText, { size: 11, colour: C.ink }))
        modY += 16
      }
    }

    var resultY = Math.max(modY + 10, 400)
    if (summary.done && summary.result) {
      marks.push(UI.text(PAD, resultY, 'TODAY\'S RESULT', { size: 10, colour: C.moss, track: 0.2 }))
      resultY += 16
      var r = summary.result
      var resultText = r.won ? 'WON' : 'LOST'
      marks.push(UI.text(PAD + 12, resultY, resultText + ' — Round ' + r.bestRound, { size: 12, colour: r.won ? '#5daa68' : '#e06a5a' }))
      resultY += 16
      marks.push(UI.text(PAD + 12, resultY, 'Pops: ' + fmtBig(r.pops) + '  Cash: $' + fmtBig(r.cash), { size: 11, colour: C.dim }))
      resultY += 20
    }

    var streakY = Math.max(resultY + 10, 440)
    var streak = summary.streak
    marks.push(UI.text(PAD, streakY, 'STREAK', { size: 10, colour: C.moss, track: 0.2 }))
    streakY += 16
    marks.push(UI.text(PAD + 12, streakY, 'Current: ' + streak.current + '  Best: ' + streak.best, { size: 12, colour: C.ink }))
    streakY += 16
    marks.push(UI.text(PAD + 12, streakY, 'Total completed: ' + summary.totalCompleted, { size: 11, colour: C.dim }))

    var bw = 330, bh = 52
    var by = Math.max(streakY + 30, 520)
    if (!summary.done) {
      widgets.push(UI.button('daily.play', PAD, by, bw, bh, {
        label: 'PLAY TODAY\'S CHALLENGE', tone: 'primary', action: 'play-daily'
      }))
    } else {
      widgets.push(UI.button('daily.play', PAD, by, bw, bh, {
        label: 'PLAY AGAIN', tone: 'primary', action: 'play-daily',
        sub: 'score will not be recorded'
      }))
    }

    return {
      screen: 'daily',
      backdrop: 'solid',
      marks: marks,
      widgets: widgets,
      defaultId: 'daily.play'
    }
  }

  function activateDaily (app, w) {
    if (w.action === 'play-daily') {
      if (w.disabled) { click(false); return true }
      if (!OP.Daily || !OP.DailyCore) { state.notice = 'Daily challenge is not available.'; click(false); return true }

      var challenge = OP.DailyCore.active() || (OP.Daily.today ? OP.Daily.today() : null)
      if (!challenge) { state.notice = 'Could not generate today\'s challenge.'; click(false); return true }

      OP.DailyCore.start(challenge)
      click(true)

      var extraRules = challenge.rules || {}
      if (app && app.startGame) {
        app.startGame(challenge.mapKey, challenge.difficulty, challenge.mode, {
          seed: challenge.seed,
          rules: extraRules
        })
      }
      return true
    }
    return false
  }

  /* ============================================================================
     EXPEDITION SCREEN
     ============================================================================ */

  var expState = {
    selected: null, // expedition key or null
    notice: null
  }

  function expeditionSummary (app) {
    var p = profileOf(app)
    if (!OP.Expedition || !OP.Expeditions) return null
    var active = OP.Expedition.isActive(p)
    var activeKey = active ? p.expedition.expeditionKey : null
    var list = OP.Expeditions.all().map(function (def) {
      var summary = OP.Expedition.summary(p, def.key)
      return {
        key: def.key,
        name: def.name,
        desc: def.desc,
        difficulty: def.difficulty,
        mode: def.mode,
        maps: def.maps.length,
        completed: summary ? summary.completed : false,
        completions: summary ? summary.completions : 0,
        active: activeKey === def.key,
        stageIndex: summary ? summary.stageIndex : 0
      }
    })
    return { list: list, activeKey: activeKey, active: active }
  }

  function buildExpedition (app) {
    var PAD = 40
    var P = { x: PAD, y: 90, w: FIELD_W - PAD * 2, h: FIELD_H - 90 - PAD }
    var marks = []
    var widgets = []
    var exp = expeditionSummary(app)
    var profile = profileOf(app)
    var active = exp && exp.active

    marks.push(UI.tracked(PAD, 190, 'EXPEDITION', { size: 48, colour: C.ink, track: 0.14, weight: '600' }))
    if (active) {
      marks.push(UI.text(PAD, 244, 'ACTIVE EXPEDITION', { size: 11, colour: C.moss }))
    } else {
      marks.push(UI.text(PAD, 244, 'Choose a route to begin.', { size: 11, colour: C.moss }))
    }
    marks.push(UI.rule(PAD, 258, P.w))

    if (expState.notice) {
      marks.push(UI.text(PAD, 270, expState.notice, { size: 11, colour: '#d4a843' }))
    }

    if (!exp || !exp.list) {
      marks.push(UI.text(PAD, 300, 'Expedition system is not available.', { size: 13, colour: C.dim }))
    } else {
      /* Eight campaigns (five expeditions + three Voyages) cannot use the old
         58px rows from y=290 — that ran past the 720px field. Compact rows keep
         the whole roster on one screen. */
      var y = 280
      for (var i = 0; i < exp.list.length; i++) {
        var e = exp.list[i]
        var isActive = e.active
        var isCompleted = e.completed
        var diffDef = OP.DIFFICULTIES && OP.DIFFICULTIES[e.difficulty]
        var diffName = diffDef ? diffDef.name : e.difficulty
        var modeDef = OP.MODES && OP.MODES[e.mode]
        var modeName = modeDef ? modeDef.name : e.mode

        var label = e.name
        if (isActive) label += '  [STAGE ' + (e.stageIndex + 1) + '/' + e.maps + ']'
        else if (isCompleted) label += '  [DONE x' + e.completions + ']'

        var sub = diffName + ' ' + modeName + ' — ' + e.maps + ' maps — ' + e.desc
        var btnId = 'expedition.' + e.key
        widgets.push(UI.button(btnId, PAD, y, P.w, 46, {
          label: label, action: 'start-expedition', arg: e.key, sub: sub,
          disabled: isActive
        }))
        y += 54
      }
    }

    // Back button
    widgets.push(UI.button('expedition.back', PAD, P.y + P.h - 50, 120, 38, {
      label: '< BACK', action: 'back'
    }))

    return { screen: 'expedition', backdrop: 'solid', marks: marks, widgets: widgets }
  }

  function activateExpedition (app, w) {
    if (w.action === 'start-expedition' && w.arg) {
      if (w.disabled) { click(false); return true }
      if (!app || !app.startExpedition) { click(false); return true }
      var key = w.arg
      var def = OP.Expeditions && OP.Expeditions.get(key)
      if (!def) { expState.notice = 'Unknown expedition.'; click(false); return true }

      // If there's an active expedition on a different key, ask to abandon
      var profile = profileOf(app)
      if (OP.Expedition && OP.Expedition.isActive(profile) && profile.expedition.expeditionKey !== key) {
        expState.notice = 'Finish or abandon your current expedition first.'
        click(false)
        return true
      }

      // If active on same key, resume it
      if (OP.Expedition && OP.Expedition.isActive(profile) && profile.expedition.expeditionKey === key) {
        var mapKey = OP.Expedition.currentMapKey(profile)
        // The leg's own mode, not the campaign's — a Voyage leg carries its
        // restriction override, and resuming mid-campaign must keep it.
        var legMode = OP.Expedition.currentMode(profile) || def.mode
        if (mapKey && app.startGame) {
          click(true)
          app.startGame(mapKey, def.difficulty, legMode, {
            expeditionCash: profile.expedition.cash,
            expeditionLives: profile.expedition.lives
          })
        } else {
          expState.notice = 'Could not resume expedition.'
          click(false)
        }
        return true
      }

      // Start fresh
      expState.notice = null
      click(true)
      app.startExpedition(key)
      return true
    }
    return false
  }

  /* ============================================================================
     TRIALS SCREEN
     ============================================================================ */

  var trialState = {
    selected: null,
    notice: null
  }

  function trialSummary (app) {
    var p = profileOf(app)
    if (!OP.Trial || !OP.Trials) return null
    var active = OP.Trial.isActive(p)
    var activeKey = active ? p.activeTrial.trialKey : null
    var list = OP.Trials.all().map(function (def) {
      var summary = OP.Trial.summary(p, def.key)
      return {
        key: def.key,
        name: def.name,
        desc: def.desc,
        difficulty: def.difficulty,
        mode: def.mode,
        mapKey: def.mapKey,
        goal: def.goal,
        towerFilter: def.towerFilter || null,
        completed: summary ? summary.completed : false,
        bestTime: summary ? summary.bestTime : null,
        active: activeKey === def.key
      }
    })
    return { list: list, activeKey: activeKey, active: active }
  }

  function buildTrials (app) {
    var PAD = 40
    var P = { x: PAD, y: 90, w: FIELD_W - PAD * 2, h: FIELD_H - 90 - PAD }
    var marks = []
    var widgets = []
    var trl = trialSummary(app)
    var profile = profileOf(app)
    var active = trl && trl.active

    marks.push(UI.tracked(PAD, 190, 'TRIALS', { size: 48, colour: C.ink, track: 0.14, weight: '600' }))
    if (active) {
      marks.push(UI.text(PAD, 244, 'ACTIVE TRIAL', { size: 11, colour: C.moss }))
    } else {
      marks.push(UI.text(PAD, 244, 'Choose a curated challenge.', { size: 11, colour: C.moss }))
    }
    marks.push(UI.rule(PAD, 258, P.w))

    if (trialState.notice) {
      marks.push(UI.text(PAD, 270, trialState.notice, { size: 11, colour: '#d4a843' }))
    }

    if (!trl || !trl.list) {
      marks.push(UI.text(PAD, 300, 'Trial system is not available.', { size: 13, colour: C.dim }))
    } else {
      var y = 290
      for (var i = 0; i < trl.list.length; i++) {
        var t = trl.list[i]
        var isActive = t.active
        var isCompleted = t.completed
        var diffDef = OP.DIFFICULTIES && OP.DIFFICULTIES[t.difficulty]
        var diffName = diffDef ? diffDef.name : t.difficulty

        var label = t.name
        if (isActive) label += '  [ACTIVE]'
        else if (isCompleted) label += '  [DONE]'

        var filterText = t.towerFilter ? t.towerFilter.join('/') + ' only' : 'all towers'
        var sub = diffName + ' — ' + filterText + ' — ' + t.goal

        var btnId = 'trial.' + t.key
        widgets.push(UI.button(btnId, PAD, y, P.w, 58, {
          label: label, action: 'start-trial', arg: t.key, sub: sub,
          disabled: isActive
        }))
        y += 72
      }
    }

    // Back button
    widgets.push(UI.button('trial.back', PAD, P.y + P.h - 50, 120, 38, {
      label: '< BACK', action: 'back'
    }))

    return { screen: 'trials', backdrop: 'solid', marks: marks, widgets: widgets }
  }

  function activateTrials (app, w) {
    if (w.action === 'start-trial' && w.arg) {
      if (w.disabled) { click(false); return true }
      if (!app || !app.startTrial) { click(false); return true }
      var key = w.arg
      var def = OP.Trials && OP.Trials.get(key)
      if (!def) { trialState.notice = 'Unknown trial.'; click(false); return true }

      var profile = profileOf(app)
      if (OP.Trial && OP.Trial.isActive(profile) && profile.activeTrial.trialKey !== key) {
        trialState.notice = 'Finish or abandon your current trial first.'
        click(false)
        return true
      }

      if (OP.Trial && OP.Trial.isActive(profile) && profile.activeTrial.trialKey === key) {
        // Resume
        click(true)
        app.startGame(def.mapKey, def.difficulty, def.mode, { rules: def.rules || {} })
        return true
      }

      trialState.notice = null
      click(true)
      app.startTrial(key)
      return true
    }
    return false
  }

  /* ============================================================================
     THE ROUTER
     ============================================================================ */

  Menus.registerScreen('title', { build: buildTitle, activate: activateTitle })
  Menus.registerScreen('settings', { build: buildSettings, activate: activateSettings })
  Menus.registerScreen('maps', { build: buildMaps, paint: paintMaps, activate: activateMaps, key: keyMaps })
  Menus.registerScreen('setup', { build: buildSetup, activate: activateSetup })
  Menus.registerScreen('daily', { build: buildDaily, activate: activateDaily })
  Menus.registerScreen('expedition', { build: buildExpedition, activate: activateExpedition })
  Menus.registerScreen('trials', { build: buildTrials, activate: activateTrials })

  function currentSpec () {
    return SCREENS[state.screen] || SCREENS.title
  }

  /**
   * The model for whatever screen is showing. Pure: no ctx, no mutation beyond
   * re-resolving a stale selection key, which is what keeps an emptied registry
   * from throwing.
   */
  Menus.build = function (app) {
    const spec = currentSpec()
    if (!spec || typeof spec.build !== 'function') {
      return { screen: state.screen, backdrop: 'solid', marks: [], widgets: [] }
    }
    const model = spec.build(app)
    return model || { screen: state.screen, backdrop: 'solid', marks: [], widgets: [] }
  }

  /** Draw the current screen. Mutates nothing. Called by the shell each frame. */
  Menus.draw = function (ctx, app) {
    const model = Menus.build(app)
    const spec = currentSpec()
    if (spec && typeof spec.paint === 'function') return spec.paint(ctx, model, app)
    return UI.paint(ctx, model, { hoverId: state.hoverId })
  }

  /** Remember what the pointer is over, so the next paint can highlight it. */
  Menus.hover = function (app, x, y) {
    const w = UI.hit(Menus.build(app).widgets, x, y)
    state.hoverId = w ? w.id : null
    return state.hoverId
  }

  /**
   * Resolve a tap. Routes to the results overlay while the shell is showing one,
   * so a single entry point covers every canvas screen.
   * @returns {?object} the widget that was pressed, or null
   */
  Menus.tap = function (app, x, y) {
    if (app && app.state && app.state.screen === 'results' && OP.Results && OP.Results.tap) {
      return OP.Results.tap(app, x, y)
    }
    const model = Menus.build(app)
    const w = UI.hit(model.widgets, x, y)
    if (!w) return null
    Menus.activate(app, w, model, { x: x, y: y })
    return w
  }

  /** Run a widget's action. Shared by tap and by the Enter key. */
  Menus.activate = function (app, w, model, point) {
    if (!w) return false
    if (w.action === 'goto') {
      if (w.arg === 'bestiary' && !SCREENS.bestiary) {
        state.notice = 'The bestiary is not available in this build.'
        click(false)
        return true
      }
      if (w.arg === 'towers' && !SCREENS.towers) {
        state.notice = 'The tower menu is not available in this build.'
        click(false)
        return true
      }
      click(true)
      Menus.go(app, w.arg)
      return true
    }
    if (w.action === 'back') { click(true); Menus.back(app); return true }

    const spec = currentSpec()
    if (spec && typeof spec.activate === 'function') {
      if (spec.activate(app, w, model || Menus.build(app), point || { x: w.x, y: w.y })) return true
    }
    return false
  }

  /**
   * Keyboard. Escape backs out, Enter confirms the screen's default widget.
   * @returns {boolean} true when the key was consumed
   */
  Menus.key = function (app, key) {
    if (app && app.state && app.state.screen === 'results' && OP.Results && OP.Results.key) {
      return OP.Results.key(app, key)
    }
    if (!Menus.active(app)) return false
    const spec = currentSpec()
    const model = Menus.build(app)
    if (spec && typeof spec.key === 'function' && spec.key(app, key, model)) return true
    if (key === 'Escape') {
      if (state.screen === 'title') return false
      Menus.back(app)
      return true
    }
    if (key === 'Enter') {
      const w = UI.byId(model.widgets, model.defaultId)
      if (!w) return false
      Menus.activate(app, w, model, { x: w.x + w.w / 2, y: w.y + w.h / 2 })
      return true
    }
    return false
  }

  Menus.wheel = function (app, dy, x, y) {
    if (!Menus.active(app) || state.screen !== 'maps' || !mapPointInside(x, y)) return false
    buildMaps(app)
    return Menus.scrollMapsBy(dy)
  }

  Menus.drag = function (app, dy, x, y, startX, startY) {
    if (!Menus.active(app) || state.screen !== 'maps' || !mapPointInside(startX, startY)) return false
    buildMaps(app)
    return Menus.scrollMapsBy(-dy)
  }

  /* ============================================================================
     INSTALL

     The shell has already registered its own input handlers by the time this
     runs, so the menus COMPOSE with them: a tap on a menu screen is consumed
     here, and anything mid-game falls through to the game's handler untouched.
     Each wrapper closes over the app it was installed with — module state would
     leave a second install pointing the first app's pointer at the wrong place.
     ============================================================================ */

  Menus.install = function (app) {
    if (!app || !app.state) return Menus
    const io = app.state.io || (OP.Input && OP.Input.state)
    state.screen = SCREENS[state.screen] ? state.screen : 'title'
    resolveDifficulty()
    resolveMode()
    resolveMap()
    refreshRun(true)

    if (io && OP.Input && OP.Input.setHandlers) {
      const prev = io._handlers || {}
      if (!prev._opMenus) {
        const next = {}
        for (const k in prev) next[k] = prev[k]
        next._opMenus = true

        /* Input resolves a tap to a tower id and hands us `select`; the point
           itself lives on the io. That is the documented tap path — see
           OP.Input.tap — and it is why the menus need no listeners of their own. */
        next.select = function (id) {
          if (Menus.active(app)) { Menus.tap(app, io.x, io.y); return }
          if (typeof prev.select === 'function') prev.select(id)
        }
        next.key = function (key, ev) {
          if (Menus.key(app, key)) return true
          if (typeof prev.key === 'function') return !!prev.key(key, ev)
          return false
        }
        next.wheel = function (dy, x, y) {
          if (Menus.wheel(app, dy, x, y)) return true
          if (typeof prev.wheel === 'function') return !!prev.wheel(dy, x, y)
          return false
        }
        next.drag = function (dy, x, y, startX, startY) {
          if (Menus.drag(app, dy, x, y, startX, startY)) return true
          if (typeof prev.drag === 'function') return !!prev.drag(dy, x, y, startX, startY)
          return false
        }
        OP.Input.setHandlers(io, next)
      }
    }

    return Menus
  }

  OP.Menus = Menus
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))


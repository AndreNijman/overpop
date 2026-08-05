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

  const C = {
    bg: '#0e1410',
    deep: '#070a08',
    panel: '#141c17',
    panelHi: '#1d2720',
    panelSel: '#22301f',
    line: '#2a352c',
    lineHi: '#3c4c3f',
    ink: '#e8efe6',
    dim: '#94a595',
    faint: '#5d6d5f',
    moss: '#6fae7f',
    mossDeep: '#3f6b4c',
    gold: '#c9a227',
    warn: '#e0b64a',
    bad: '#d0604f'
  }

  const FONT = "ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace"

  // Monospace advance width as a fraction of the em. Every mono face this game
  // could land on sits at 0.6, so metrics are computed rather than measured —
  // build() has no ctx, and wrapping must not depend on one.
  const ADV = 0.6

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
    if (m.fill) { ctx.fillStyle = m.fill; ctx.fillRect(m.x, m.y, m.w, m.h) }
    if (m.stroke) {
      ctx.strokeStyle = m.stroke
      ctx.lineWidth = m.lineWidth
      if (m.dash && ctx.setLineDash) ctx.setLineDash(m.dash)
      ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1)
      if (m.dash && ctx.setLineDash) ctx.setLineDash([])
    }
    ctx.restore()
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
    if (w.disabled) { ink = C.faint; stroke = C.line; fill = C.bg }
    return { fill: fill, stroke: stroke, ink: ink }
  }

  function paintWidget (ctx, w, hover) {
    const t = toneColours(w, hover)
    switch (w.kind) {
      case 'button': {
        drawBox(ctx, UI.box(w.x, w.y, w.w, w.h, { fill: t.fill, stroke: t.stroke, alpha: 1 }))
        const cx = w.align === 'center' ? w.x + w.w / 2 : w.x + 16
        const baseY = w.sub ? w.y + w.h / 2 - 2 : w.y + w.h / 2 + 5
        drawTracked(ctx, UI.tracked(w.align === 'center' ? cx - UI.trackedWidth(UI.tracked(0, 0, w.label, { size: 14 })) / 2 : cx,
          baseY, w.label, { size: 14, colour: t.ink, track: 0.18 }))
        if (w.sub) drawText(ctx, cx, w.y + w.h / 2 + 14, UI.clipText(w.sub, 10, w.w - 24), 10, w.disabled ? C.faint : C.dim, w.align === 'center' ? 'center' : 'left')
        if (hover && !w.disabled) {
          ctx.save(); ctx.fillStyle = C.moss; ctx.fillRect(w.x, w.y, 2, w.h); ctx.restore()
        }
        break
      }
      case 'row': {
        drawBox(ctx, UI.box(w.x, w.y, w.w, w.h, { fill: t.fill, stroke: w.selected ? C.moss : '' }))
        if (w.selected) { ctx.save(); ctx.fillStyle = C.moss; ctx.fillRect(w.x, w.y, 3, w.h); ctx.restore() }
        else if (hover && !w.disabled) { ctx.save(); ctx.fillStyle = C.lineHi; ctx.fillRect(w.x, w.y, 3, w.h); ctx.restore() }
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
        if (w.selected) { ctx.save(); ctx.fillStyle = C.moss; ctx.fillRect(w.x, w.y, w.w, 2); ctx.restore() }
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

  const BACK_TO = { maps: 'title', setup: 'maps', settings: 'title', bestiary: 'title', title: 'title' }

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

    marks.push(UI.tracked(PAD, 190, 'OVERPOP', { size: 74, colour: C.ink, track: 0.18, weight: '600' }))
    marks.push(UI.tracked(PAD + 4, 224, 'AN ORIGINAL TOWER DEFENSE', { size: 11, colour: C.moss, track: 0.34 }))
    marks.push(UI.rule(PAD, 252, 400))
    marks.push(UI.text(PAD, 276, 'Every sprite drawn in code. Every sound synthesised.', { size: 11, colour: C.faint }))

    const bx = PAD, bw = 330, bh = 52
    let by = 320
    widgets.push(UI.button('title.play', bx, by, bw, bh, {
      label: 'PLAY', tone: 'primary', action: 'goto', arg: 'maps',
      sub: 'choose a map, a difficulty and a mode'
    }))
    by += bh + 14
    if (refreshRun()) {
      widgets.push(UI.button('title.continue', bx, by, bw, bh, {
        label: 'CONTINUE', action: 'continue', sub: 'resume the run in progress'
      }))
      by += bh + 14
    }
    widgets.push(UI.button('title.bestiary', bx, by, bw, bh, {
      label: 'BESTIARY', action: 'goto', arg: 'bestiary', sub: 'balloons, immunities and towers'
    }))
    by += bh + 14
    widgets.push(UI.button('title.settings', bx, by, bw, bh, {
      label: 'SETTINGS', action: 'goto', arg: 'settings', sub: 'volume, trails, round autostart'
    }))

    /* Right column: the record. Restrained on purpose — a wall of counters would
       compete with the four things a player came here to press. */
    const rx = 720
    marks.push(UI.tracked(rx, 190, 'RECORD', { size: 11, colour: C.moss, track: 0.3 }))
    marks.push(UI.rule(rx, 202, FIELD_W - PAD - rx))
    const stats = (p && p.stats) || {}
    let best = 0
    const bestMap = (stats.bestRound && typeof stats.bestRound === 'object') ? stats.bestRound : {}
    for (const k in bestMap) if (bestMap[k] > best) best = bestMap[k]
    const rows = [
      ['Games played', stats.gamesPlayed || 0],
      ['Games won', stats.gamesWon || 0],
      ['Rounds cleared', stats.roundsCleared || 0],
      ['Balloons popped', fmtBig(stats.totalPops || 0)],
      ['Cash earned', '$' + fmtBig(stats.totalCash || 0)],
      ['Best round', best || '—']
    ]
    for (let i = 0; i < rows.length; i++) {
      const y = 232 + i * 26
      marks.push(UI.text(rx, y, rows[i][0], { size: 11, colour: C.dim }))
      marks.push(UI.text(FIELD_W - PAD, y, String(rows[i][1]), { size: 12, colour: C.ink, align: 'right' }))
    }

    // A quiet row of the roster, so the title screen shows the game's subject.
    const tiers = Array.isArray(OP.BALLOON_TIERS) ? OP.BALLOON_TIERS : []
    const shown = tiers.slice(0, 12)
    for (let i = 0; i < shown.length; i++) {
      marks.push(UI.balloon(rx + 12 + i * 34, 470, 11, shown[i]))
    }
    if (shown.length) {
      marks.push(UI.text(rx, 508, shown.length + ' of ' + tiers.length + ' tiers · see the bestiary', { size: 10, colour: C.faint }))
    }

    marks.push(UI.text(PAD, 700, 'v' + (OP.VERSION || '?') + ' · no downloads, works offline', { size: 10, colour: C.faint }))
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

  function buildMaps (app) {
    const marks = []
    const widgets = []
    const maps = allMaps()

    chrome(marks, 'SELECT A MAP', maps.length + (maps.length === 1 ? ' map' : ' maps') + ' · grouped by tier')
    widgets.push(UI.button('maps.back', FIELD_W - PAD - 96, 74, 96, 32, { label: 'BACK', action: 'back', align: 'center' }))

    if (!maps.length) {
      marks.push(UI.text(PAD, 300, 'No maps are registered yet.', { size: 18, colour: C.dim }))
      marks.push(UI.text(PAD, 328, 'js/data/maps-*.js declares them; this screen lists whatever is there.', { size: 11, colour: C.faint }))
      footer(marks, 'ESC back')
      noticeMark(marks)
      return { screen: 'maps', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'maps.back' }
    }

    // Group by declared tier, then sweep up anything with a tier nobody declared
    // so a map can never be invisible.
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

    const perRow = 4
    const gap = 14
    const cardW = Math.floor((CONTENT_W - gap * (perRow - 1)) / perRow)
    const areaTop = 160
    const areaBottom = 664

    // Rows first, so the card height can be chosen to fit whatever is registered
    // rather than overflowing the page when a tier holds more than a row.
    let totalRows = 0
    for (let g = 0; g < groups.length; g++) totalRows += Math.ceil(groups[g].maps.length / perRow)
    const labelH = 26
    const rowGap = 12
    const avail = areaBottom - areaTop - groups.length * (labelH + 10) - (totalRows - 1) * rowGap
    const cardH = M.clamp(Math.floor(avail / Math.max(1, totalRows)), 68, 116)

    let y = areaTop
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]
      marks.push(UI.tracked(PAD, y + 12, group.tier.toUpperCase(), { size: 10, colour: C.moss, track: 0.32 }))
      marks.push(UI.text(FIELD_W - PAD, y + 12, group.maps.length + (group.maps.length === 1 ? ' map' : ' maps'), { size: 10, colour: C.faint, align: 'right' }))
      marks.push(UI.rule(PAD, y + 20, CONTENT_W, { alpha: 0.5 }))
      y += labelH

      for (let i = 0; i < group.maps.length; i++) {
        const def = group.maps[i]
        const col = i % perRow
        const row = Math.floor(i / perRow)
        const cx = PAD + col * (cardW + gap)
        const cy = y + row * (cardH + rowGap)
        const comp = completionOf(app, def.key)
        widgets.push(UI.card('map.' + def.key, cx, cy, cardW, cardH, {
          label: def.name || def.key,
          lines: UI.wrapText(def.blurb, 10, cardW - 110, cardH >= 96 ? 3 : 2),
          selected: def.key === state.mapKey,
          action: 'setmap',
          arg: def.key,
          pips: comp.pips,
          note: comp.cells ? comp.cells + ' cleared' : '',
          previewPaths: pathsOf(def)
        }))
      }
      y += Math.ceil(group.maps.length / perRow) * (cardH + rowGap) + 10
    }

    footer(marks, 'ESC back · ENTER opens the highlighted map')
    noticeMark(marks)
    return {
      screen: 'maps',
      backdrop: 'solid',
      marks: marks,
      widgets: widgets,
      defaultId: state.mapKey ? 'map.' + state.mapKey : (widgets.length > 1 ? widgets[1].id : 'maps.back')
    }
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
     THE ROUTER
     ============================================================================ */

  Menus.registerScreen('title', { build: buildTitle, activate: activateTitle })
  Menus.registerScreen('settings', { build: buildSettings, activate: activateSettings })
  Menus.registerScreen('maps', { build: buildMaps, activate: activateMaps })
  Menus.registerScreen('setup', { build: buildSetup, activate: activateSetup })

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
          if (Menus.key(app, key)) return
          if (typeof prev.key === 'function') prev.key(key, ev)
        }
        OP.Input.setHandlers(io, next)
      }
    }

    /* Escape is the one key Input never forwards: its keydown listener calls
       Input.cancel and returns before firing the `key` intent, and cancel only
       emits `cancel` when a placement was in progress — which is never true on a
       menu. So the menus keep one narrowly-scoped listener that ignores every
       other key. Installed at most once. */
    if (!Menus._escBound && typeof window !== 'undefined' && window.addEventListener) {
      Menus._escBound = function (ev) {
        if (!ev || ev.key !== 'Escape') return
        Menus.key(app, 'Escape')
      }
      window.addEventListener('keydown', Menus._escBound)
    }

    return Menus
  }

  OP.Menus = Menus
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

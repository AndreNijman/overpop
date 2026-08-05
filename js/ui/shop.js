;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     SHOP — every tower in the game, grouped by family, in the sidebar.

     Reuses the widget layer from js/ui/menus.js and registers itself as an
     in-game panel with OP.HUD, which owns the tap router. Nothing here adds a
     listener and nothing here decides a rule:

       price          OP.Economy.price          (the difficulty multiplier lives there)
       affordable     OP.Economy.canAfford
       allowed        OP.Economy.towerAllowed   + the engine's own refusal wording
       hero limit     OP.Heroes.canPlace
       placing        OP.Input.beginPlacing

     A forbidden tower is shown WITH its reason. Primary Only and PURIST both
     depend on that: a greyed row with no explanation reads as a broken game
     rather than a rule.

     The roster is read from OP.TOWER_ORDER, OP.FAMILIES and OP.HERO_ORDER on
     every build, so a tower added later cannot be silently skipped and an empty
     registry — the normal state of the world mid-build — draws a note instead of
     throwing.
     ============================================================================ */

  const Shop = {}

  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }

  function colours () {
    return (OP.Menus && OP.Menus.COLOURS) || {
      bg: '#0e1410', deep: '#070a08', panel: '#141c17', panelHi: '#1d2720', panelSel: '#22301f',
      line: '#2a352c', lineHi: '#3c4c3f', ink: '#e8efe6', dim: '#94a595', faint: '#5d6d5f',
      moss: '#6fae7f', mossDeep: '#3f6b4c', gold: '#c9a227', warn: '#e0b64a', bad: '#d0604f'
    }
  }

  /** The sidebar rect is published by the HUD so two files cannot disagree. */
  function sidebar () {
    const L = OP.HUD && OP.HUD.LAYOUT && OP.HUD.LAYOUT.sidebar
    return L || { x: 960, y: 52, w: FIELD_W - 960, h: 660 }
  }

  function simOf (app) { return app && app.state ? app.state.sim : null }
  function ioOf (app) {
    if (app && app.state && app.state.io) return app.state.io
    return OP.Input ? OP.Input.state : null
  }

  function selectedTower (app) {
    if (OP.HUD && OP.HUD.selectedTower) return OP.HUD.selectedTower(app)
    const sim = simOf(app); const io = ioOf(app)
    if (!sim || !io || !(io.selectedId >= 0) || !sim.towerById) return null
    return sim.towerById.get(io.selectedId) || null
  }

  function gameActive (app) {
    if (OP.HUD && OP.HUD.gameActive) return OP.HUD.gameActive(app)
    const sim = simOf(app)
    return !!sim && !sim.over
  }

  function click (ok) {
    if (OP.HUD && OP.HUD.click) return OP.HUD.click(ok)
    if (OP.Audio && OP.Audio.play) OP.Audio.play(ok === false ? 'deny' : 'ui')
  }

  function refuse (x, y, reason) {
    if (OP.HUD && OP.HUD.refuse) return OP.HUD.refuse(x, y, reason)
    click(false)
  }

  /* ============================================================================
     THE ROSTER

     Grouped by OP.FAMILIES so a family added later appears without touching this
     file, and swept up at the end so a tower whose family nobody declared is
     still visible rather than silently missing.
     ============================================================================ */

  function towerDefs () {
    const out = []
    const order = Array.isArray(OP.TOWER_ORDER) ? OP.TOWER_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.TOWERS ? OP.TOWERS[order[i]] : null
      if (def && def.key) out.push(def)
    }
    return out
  }

  function heroDefs () {
    const out = []
    const order = Array.isArray(OP.HERO_ORDER) ? OP.HERO_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.HEROES ? OP.HEROES[order[i]] : null
      if (def && def.key) out.push(def)
    }
    return out
  }

  function groups () {
    const defs = towerDefs()
    const families = Array.isArray(OP.FAMILIES) ? OP.FAMILIES : []
    const out = []
    const seen = {}
    for (let f = 0; f < families.length; f++) {
      const family = families[f]
      const list = defs.filter(function (d) { return d.family === family })
      for (let i = 0; i < list.length; i++) seen[list[i].key] = true
      if (list.length) {
        out.push({
          key: family,
          label: (OP.FAMILY_LABELS && OP.FAMILY_LABELS[family]) || family,
          hero: false,
          defs: list
        })
      }
    }
    const orphans = defs.filter(function (d) { return !seen[d.key] })
    if (orphans.length) out.push({ key: 'other', label: 'Other', hero: false, defs: orphans })

    const heroes = heroDefs()
    if (heroes.length) out.push({ key: 'heroes', label: 'Heroes', hero: true, defs: heroes })
    return out
  }
  Shop.groups = groups

  /* ---------- per-entry state ----------
     Three visually distinct outcomes, each asked of the engine:
       'ok'      affordable and legal
       'poor'    legal but not affordable right now
       'blocked' the mode (or the one-hero rule) forbids it, WITH the reason
  */

  /**
   * Why the mode forbids this tower, or ''.
   *
   * Towers.canPlace checks the mode BEFORE cash and before any geometry, so once
   * towerAllowed has already said no, the reason it hands back is the mode's own
   * wording and the point is never looked at. Asking keeps one source of truth for
   * the sentence the player reads.
   */
  function towerBlock (sim, def) {
    if (!OP.Economy || !OP.Economy.towerAllowed) return ''
    if (OP.Economy.towerAllowed(sim, def)) return ''
    try {
      const check = OP.Towers.canPlace(sim, def.key, -1, -1)
      if (check && !check.ok && check.reason) return check.reason
    } catch (e) { /* fall through to the generic line */ }
    return 'Disabled in this mode.'
  }

  /** Why a hero cannot be placed, or ''. */
  function heroBlock (sim, def) {
    if (!OP.Heroes || !OP.Heroes.of) return ''
    let placed = null
    try { placed = OP.Heroes.of(sim) } catch (e) { placed = null }
    if (!placed) return ''
    // The one-hero rule is the first gate in Heroes.canPlace after the key, so
    // with a hero already down the reason is that rule's own wording.
    try {
      const check = OP.Heroes.canPlace(sim, def.key, -1, -1)
      if (check && !check.ok && check.reason) return check.reason
    } catch (e) { /* fall through */ }
    return 'You already have a hero on this map.'
  }

  function entryState (sim, def, isHero) {
    const price = OP.Economy ? OP.Economy.price(sim, def.cost) : def.cost
    const block = isHero ? heroBlock(sim, def) : towerBlock(sim, def)
    if (block) return { state: 'blocked', price: price, reason: block }
    const afford = OP.Economy ? OP.Economy.canAfford(sim, price) : true
    if (!afford) {
      return { state: 'poor', price: price, reason: 'Not enough cash — ' + M.money(price) + ' needed.' }
    }
    return { state: 'ok', price: price, reason: '' }
  }
  Shop.entryState = entryState

  /* ============================================================================
     BUILD
     ============================================================================ */

  function model (marks, widgets, over, app) {
    const U = ui()
    const io = ioOf(app)
    let hover = null
    if (U && io && io.overCanvas) hover = U.hit(widgets, io.x, io.y)
    return {
      screen: 'shop',
      marks: marks,
      widgets: widgets,
      over: over,
      hoverId: hover ? hover.id : null,
      hovered: hover
    }
  }

  /** True when the shop owns the sidebar: in a live game, nothing selected. */
  function showing (app) {
    if (!gameActive(app)) return false
    return !selectedTower(app)
  }
  Shop.showing = showing

  function build (app) {
    const U = ui()
    const marks = []
    const widgets = []
    const over = []
    const sim = simOf(app)
    if (!U || !sim) return model(marks, widgets, over, app)

    const C = colours()
    const S = sidebar()
    const padX = 12
    const x0 = S.x + padX
    const innerW = S.w - padX * 2

    marks.push(U.box(S.x, S.y, S.w, S.h, { fill: C.panel, stroke: C.line }))
    marks.push(U.tracked(x0, S.y + 22, 'BUILD', { size: 11, colour: C.moss, track: 0.3 }))
    marks.push(U.text(S.x + S.w - padX, S.y + 22, M.money(sim.cash), { size: 12, colour: C.ink, align: 'right', weight: '600' }))
    marks.push(U.rule(x0, S.y + 30, innerW, { colour: C.line }))

    const list = groups()

    /* ----- the detail strip, reserved before the grid so the grid can size to fit ----- */
    const detailH = 96
    const detailY = S.y + S.h - detailH - 22
    const top = S.y + 40
    const bottom = detailY - 8

    if (!list.length) {
      marks.push(U.text(x0, top + 30, 'No towers are registered yet.', { size: 12, colour: C.dim }))
      marks.push(U.text(x0, top + 50, 'js/towers/*.js registers each family;', { size: 9, colour: C.faint }))
      marks.push(U.text(x0, top + 62, 'this panel lists whatever is there.', { size: 9, colour: C.faint }))
      detail(app, sim, marks, over, null, S, detailY, detailH)
      return model(marks, widgets, over, app)
    }

    // Rows first, so a roster that grows shrinks the cells rather than running off
    // the bottom of the sidebar.
    const cols = 2
    const gap = 6
    const headerH = 22
    let rows = 0
    for (let g = 0; g < list.length; g++) rows += Math.ceil(list[g].defs.length / cols)
    const cellW = Math.floor((innerW - gap * (cols - 1)) / cols)
    const cellH = M.clamp(Math.floor((bottom - top - list.length * headerH) / Math.max(1, rows)), 16, 30)

    const io = ioOf(app)
    const placingKey = io && io.mode === 'placing' ? io.placingKey : null

    let y = top
    for (let g = 0; g < list.length; g++) {
      const group = list[g]

      // One reason per group, taken from the first blocked entry. That covers both
      // "this whole family is disabled" and "income towers are disabled", and it
      // keeps the sentence on screen instead of hiding it behind a hover.
      let groupReason = ''
      const states = []
      for (let i = 0; i < group.defs.length; i++) {
        const st = entryState(sim, group.defs[i], group.hero)
        states.push(st)
        if (!groupReason && st.state === 'blocked') groupReason = st.reason
      }

      marks.push(U.tracked(x0, y + 13, group.label.toUpperCase(), { size: 9, colour: groupReason ? C.warn : C.moss, track: 0.28 }))
      if (groupReason) {
        marks.push(U.text(S.x + S.w - padX, y + 13, U.clipText(groupReason, 8, innerW - 84),
          { size: 8, colour: C.warn, align: 'right' }))
      } else {
        marks.push(U.text(S.x + S.w - padX, y + 13, group.defs.length + (group.hero ? ' heroes' : ' towers'),
          { size: 8, colour: C.faint, align: 'right' }))
      }
      marks.push(U.rule(x0, y + 18, innerW, { colour: C.line, alpha: 0.6 }))
      y += headerH

      for (let i = 0; i < group.defs.length; i++) {
        const def = group.defs[i]
        const st = states[i]
        const cx = x0 + (i % cols) * (cellW + gap)
        const cy = y + Math.floor(i / cols) * cellH

        const w = U.button('shop.' + def.key, cx, cy, cellW, cellH - 2, {
          label: '',
          disabled: st.state !== 'ok',
          selected: placingKey === def.key,
          action: 'shop-buy',
          arg: def.key,
          reason: st.reason
        })
        // Extra fields the widget layer ignores, so a test — and activate() — can
        // read the decision rather than re-deriving it from a colour.
        w.state = st.state
        w.hero = group.hero
        w.price = st.price
        widgets.push(w)

        const nameColour = st.state === 'ok' ? C.ink : (st.state === 'poor' ? C.dim : C.faint)
        over.push(U.text(cx + 8, cy + cellH / 2 + 2, U.clipText(def.name || def.key, 10, cellW - 52),
          { size: 10, colour: nameColour }))
        if (st.state === 'blocked') {
          over.push(U.text(cx + cellW - 8, cy + cellH / 2 + 2, 'LOCKED', { size: 8, colour: C.warn, align: 'right' }))
        } else {
          over.push(U.text(cx + cellW - 8, cy + cellH / 2 + 2, M.money(st.price),
            { size: 9, colour: st.state === 'ok' ? C.moss : C.bad, align: 'right' }))
        }
      }
      y += Math.ceil(group.defs.length / cols) * cellH
    }

    const m = model(marks, widgets, over, app)
    detail(app, sim, marks, over, m.hovered, S, detailY, detailH)
    return m
  }

  /* ---------- the detail strip ----------
     The blurb lives here rather than in the cell, because a 145-wide cell cannot
     hold a sentence and a truncated blurb is worse than none. */

  function detail (app, sim, marks, over, hovered, S, y, h) {
    const U = ui(); const C = colours()
    const padX = 12
    const x0 = S.x + padX
    const innerW = S.w - padX * 2

    marks.push(U.box(x0, y, innerW, h, { fill: C.panelHi, stroke: C.line }))

    const def = hovered ? defFor(hovered) : null
    if (!def) {
      over.push(U.text(x0 + 10, y + 22, 'Point at a critter', { size: 11, colour: C.dim }))
      over.push(U.text(x0 + 10, y + 40, 'to read what it does, what it', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 52, 'costs here, and why it might', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 64, 'be unavailable.', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 84, 'Tap to place · ESC cancels', { size: 8, colour: C.faint }))
      return
    }

    const isHero = !!hovered.hero
    const famLabel = isHero
      ? 'HERO' + (def.title ? ' · ' + String(def.title).toUpperCase() : '')
      : String((OP.FAMILY_LABELS && OP.FAMILY_LABELS[def.family]) || def.family || '').toUpperCase()

    over.push(U.text(x0 + 10, y + 20, U.clipText(def.name || def.key, 12, innerW - 80),
      { size: 12, colour: C.ink, weight: '600' }))
    over.push(U.text(x0 + innerW - 10, y + 20, M.money(hovered.price === undefined ? def.cost : hovered.price),
      { size: 11, colour: hovered.state === 'ok' ? C.moss : C.bad, align: 'right' }))
    over.push(U.text(x0 + 10, y + 33, U.clipText(famLabel, 8, innerW - 20), { size: 8, colour: C.moss }))

    const blurb = U.wrapText(def.blurb, 9, innerW - 20, hovered.state === 'ok' ? 4 : 3)
    for (let i = 0; i < blurb.length; i++) {
      over.push(U.text(x0 + 10, y + 47 + i * 11, blurb[i], { size: 9, colour: C.dim }))
    }

    if (hovered.reason) {
      const lines = U.wrapText(hovered.reason, 9, innerW - 20, 2)
      for (let i = 0; i < lines.length; i++) {
        over.push(U.text(x0 + 10, y + h - 16 + i * 11 - (lines.length - 1) * 11, lines[i],
          { size: 9, colour: hovered.state === 'blocked' ? C.warn : C.bad }))
      }
    }
  }

  function defFor (widget) {
    if (!widget || widget.action !== 'shop-buy') return null
    if (widget.hero) return OP.HEROES ? OP.HEROES[widget.arg] : null
    return OP.TOWERS ? OP.TOWERS[widget.arg] : null
  }

  /* ============================================================================
     PAINT / HIT / ACTIONS
     ============================================================================ */

  function paint (ctx, m) {
    const U = ui()
    if (!U || !m) return 0
    let n = U.paint(ctx, m, { hoverId: m.hoverId })
    if (m.over && m.over.length) n += U.paint(ctx, { marks: m.over, widgets: [] }, {})
    return n
  }

  Shop.build = build

  Shop.draw = function (ctx, app) {
    if (!showing(app)) return 0
    return paint(ctx, build(app))
  }

  Shop.chromeAt = function (app, x, y) {
    if (!showing(app)) return false
    const S = sidebar()
    return x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h
  }

  Shop.hitAt = function (app, x, y) {
    const U = ui()
    if (!U || !showing(app)) return null
    return U.hit(build(app).widgets, x, y)
  }

  Shop.activate = function (app, w) {
    const sim = simOf(app)
    const io = ioOf(app)
    if (!w || !sim || !io || w.action !== 'shop-buy') return false

    if (w.state !== 'ok') {
      refuse(w.x + w.w / 2, w.y, w.reason || 'Not available.')
      return true
    }

    // Placement itself is Input's job: it owns the preview, the legality check at
    // the pointer, and the confirming tap.
    OP.Input.beginPlacing(io, w.arg, !!w.hero)
    click(true)
    return true
  }

  Shop.tap = function (app, x, y) {
    const w = Shop.hitAt(app, x, y)
    if (w) Shop.activate(app, w)
    return w
  }

  /* ============================================================================
     INSTALL
     ============================================================================ */

  let logged = false
  function layerBody (ctx, app) {
    try { return Shop.draw(ctx, app) } catch (e) {
      if (!logged) {
        logged = true
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: shop draw threw', e)
      }
      return 0
    }
  }

  Shop.install = function (app) {
    if (!app || !app.state) return Shop

    if (OP.HUD && OP.HUD.registerPanel) {
      OP.HUD.registerPanel('shop', 10, {
        chromeAt: Shop.chromeAt,
        hitAt: Shop.hitAt,
        activate: Shop.activate
      })
    }

    if (OP.Render && OP.Render.registerLayer) {
      OP.Render.registerLayer('shop', OP.Render.LAYER.HUD + 10, function (ctx, sim, view, frame) {
        layerBody(ctx, (frame && frame.app) || app)
      })
    }

    return Shop
  }

  OP.Shop = Shop
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

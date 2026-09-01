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

  /** Width of the upgrade-tree strip on the right of every card. */
  const TREE_W = 26

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

  function model (marks, widgets, over, app, extra) {
    const U = ui()
    const io = ioOf(app)
    let hover = null
    if (U && io && io.overCanvas) hover = U.hit(widgets, io.x, io.y)
    const m = {
      screen: 'shop',
      marks: marks,
      widgets: widgets,
      over: over,
      // Content that scrolls, painted inside a clip so a partly-visible card is
      // cut off at the viewport edge rather than bleeding over the header.
      listMarks: [],
      listOver: [],
      clip: null,
      hoverId: hover ? hover.id : null,
      hovered: hover
    }
    if (extra) Object.assign(m, extra)
    if (U && io && io.overCanvas) {
      const h2 = U.hit(m.widgets, io.x, io.y)
      m.hovered = h2
      m.hoverId = h2 ? h2.id : null
    }
    return m
  }

  /* ---------- panel state ----------
     Scroll offset and which upgrade tree is open are VIEW state: they live here,
     never on the sim. A sim field would land in the save file and, worse, in the
     checksum — two players scrolled to different places are not in different game
     states. */

  const state = {
    scroll: 0,          // pixels the card list is scrolled down by
    maxScroll: 0,       // recomputed each build; clamps the above
    tree: null,         // tower/hero key whose upgrade tree is open, or null

    /* The detail strip is STICKY: it keeps showing the last critter the pointer
       was over, and is only replaced by hovering a different one.

       It used to follow live hover, which made the UPGRADES button unreachable —
       moving the pointer off the card to go and press it rebuilt the strip from
       "nothing hovered", so the button vanished before it could be clicked. Any
       control that lives in a hover-driven panel has to outlive the hover that
       summoned it, or it cannot be used with a mouse at all. */
    detailKey: null,
    detailHero: false
  }
  Shop.state = state

  Shop.scrollBy = function (dy) {
    const before = state.scroll
    state.scroll = M.clamp(state.scroll + dy, 0, state.maxScroll)
    return state.scroll !== before
  }

  Shop.openTree = function (key) { state.tree = key || null; return state.tree }
  Shop.closeTree = function () { const had = !!state.tree; state.tree = null; return had }

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

    // Smoked, not opaque: maps run to the field edge, so the sidebar always sits
    // over live board and a balloon crossing behind it must not simply vanish.
    marks.push(U.box(S.x, S.y, S.w, S.h, { fill: C.panel, stroke: C.line, alpha: 0.94 }))
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
      detail(app, sim, marks, over, S, detailY, detailH)
      return model(marks, widgets, over, app)
    }

    /* ONE COLUMN of tall cards, scrolled — not a grid of shrinking cells.
       The old grid divided the remaining height by the row count, so every tower
       added made every card shorter; at 31 towers and 20 heroes a cell was 16px,
       which fits a clipped name and nothing else. A card has to carry the
       critter's portrait to be worth looking at, and a portrait needs real
       height. So the card size is FIXED and the list scrolls instead. */
    const cardH = 44
    const rowGap = 4
    const headerH = 22
    const listMarks = []
    const listOver = []

    const io = ioOf(app)
    const placingKey = io && io.mode === 'placing' ? io.placingKey : null

    // Measure the whole list first — scroll clamping needs the full content
    // height, and the cull below needs to know where each card would land.
    let contentH = 0
    for (let g = 0; g < list.length; g++) {
      contentH += headerH + list[g].defs.length * (cardH + rowGap)
    }
    const viewH = bottom - top
    // The scrollbar only takes width when it is actually needed.
    const overflowing = contentH > viewH
    const barW = overflowing ? 5 : 0
    const cardW = innerW - (overflowing ? barW + 4 : 0)

    state.maxScroll = Math.max(0, contentH - viewH)
    state.scroll = M.clamp(state.scroll, 0, state.maxScroll)

    let y = top - state.scroll
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

      if (y + headerH > top && y < bottom) {
        listMarks.push(U.tracked(x0, y + 13, group.label.toUpperCase(), { size: 9, colour: groupReason ? C.warn : C.moss, track: 0.28 }))
        if (groupReason) {
          listOver.push(U.text(x0 + cardW, y + 13, U.clipText(groupReason, 8, cardW - 84),
            { size: 8, colour: C.warn, align: 'right' }))
        } else {
          listOver.push(U.text(x0 + cardW, y + 13, group.defs.length + (group.hero ? ' heroes' : ' towers'),
            { size: 8, colour: C.faint, align: 'right' }))
        }
        listMarks.push(U.rule(x0, y + 18, cardW, { colour: C.line, alpha: 0.6 }))
      }
      y += headerH

      for (let i = 0; i < group.defs.length; i++) {
        const def = group.defs[i]
        const st = states[i]
        const cy = y
        y += cardH + rowGap

        /* CULL, rather than clip alone. A card scrolled out of view must not be
           in `widgets` at all — otherwise it still answers hit tests and the
           player buys a tower they cannot see. Clipping fixes the picture and
           would leave the bug. */
        if (cy + cardH < top || cy > bottom) continue

        // The buy area STOPS where the tree strip starts, rather than sitting under
        // it. No overlap means the hit test does not depend on push order, and the
        // panel keeps the "no two widgets overlap" invariant the suite enforces.
        const hasTree = !!(def.paths && def.paths.length)
        const buyW = cardW - (hasTree ? TREE_W : 0)
        const w = U.button('shop.' + def.key, x0, cy, buyW, cardH, {
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

        /* THE UPGRADE-TREE BUTTON LIVES ON THE CARD.
           It was originally only in the detail strip, which made it unreachable:
           the strip sits below the list, so getting to the button meant dragging
           the pointer down across six other cards, and by the time it arrived the
           strip described a different tower. A control that can only be reached by
           leaving the thing it belongs to is not a control.

           Pushed AFTER the card so it wins the hit test — UI.hit scans backwards —
           and given a strip of the card's full height so it is an easy target. */
        if (hasTree) {
          const tw = U.button('shop.tree.' + def.key, x0 + buyW, cy, TREE_W, cardH, {
            label: '',
            action: 'shop-tree',
            arg: def.key
          })
          tw.hero = group.hero
          tw.state = st.state
          tw.price = st.price
          tw.reason = st.reason
          widgets.push(tw)
        }

        card(sim, listOver, def, st, x0, cy, cardW, cardH, group.hero)
      }
    }

    /* The scrollbar is an indicator, not a control: the thumb shows where you are
       in a list that is taller than the panel. Dragging it would be a second
       gesture to build and test for no gain over the wheel and the drag that
       already work anywhere in the list. */
    if (overflowing) {
      const trackX = x0 + innerW - barW
      marks.push(U.box(trackX, top, barW, viewH, { fill: C.line, alpha: 0.35 }))
      const thumbH = Math.max(24, Math.round(viewH * (viewH / contentH)))
      const thumbY = top + Math.round((viewH - thumbH) * (state.maxScroll ? state.scroll / state.maxScroll : 0))
      marks.push(U.box(trackX, thumbY, barW, thumbH, { fill: C.moss, alpha: 0.75 }))
    }

    // The cards are everything placed so far; chrome widgets are appended after.
    const cardWidgets = widgets.slice()
    const m = model(marks, widgets, over, app, {
      listMarks: listMarks,
      listOver: listOver,
      cardWidgets: cardWidgets,
      chromeWidgets: [],
      clip: { x: S.x, y: top, w: S.w, h: viewH },
      contentH: contentH,
      viewH: viewH,
      scroll: state.scroll,
      maxScroll: state.maxScroll
    })
    /* Remember what to show BEFORE anything else can change the hover. A card
       under the pointer replaces it; pointing at nothing leaves it alone, which is
       what makes the button in the strip reachable. Placing mode wins outright —
       the player has committed to that critter. */
    const hoveredDef = m.hovered && (m.hovered.action === 'shop-buy') ? m.hovered : null
    if (placingKey) {
      state.detailKey = placingKey
      state.detailHero = !!(io && io.placingIsHero)
    } else if (hoveredDef) {
      state.detailKey = hoveredDef.arg
      state.detailHero = !!hoveredDef.hero
    }

    // `detail` appends the upgrade-tree button to `widgets`, so hit testing sees
    // it; splitting it out here keeps it out of the clipped paint.
    const before = widgets.length
    detail(app, sim, marks, over, S, detailY, detailH, widgets)
    m.chromeWidgets = widgets.slice(before)
    // Hover is resolved against the full set, chrome included.
    const io2 = ioOf(app)
    if (U && io2 && io2.overCanvas) {
      const h2 = U.hit(widgets, io2.x, io2.y)
      m.hovered = h2
      m.hoverId = h2 ? h2.id : null
    }
    return m
  }

  /* ---------- one card ----------
     Portrait, name, what it deals, what it costs, and the one trait a player
     actually decides on: whether it can see camo. Everything else is in the
     detail strip — a card that tries to say everything says nothing at 44px. */

  function card (sim, out, def, st, x, y, w, h, isHero) {
    const U = ui(); const C = colours()
    // Leave the tree strip its own column so text never runs under it.
    const hasTree = !!(def.paths && def.paths.length)
    if (hasTree) w -= TREE_W
    const dim = st.state !== 'ok'
    const nameColour = st.state === 'ok' ? C.ink : (st.state === 'poor' ? C.dim : C.faint)
    const r = Math.floor(h * 0.36)
    const px = x + 6 + r
    const tx = px + r + 8

    out.push(U.portrait(px, y + h / 2, r, def.key, { dim: dim }))

    out.push(U.text(tx, y + 15, U.clipText(def.name || def.key, 11, w - (tx - x) - 54),
      { size: 11, colour: nameColour, weight: '600' }))

    if (st.state === 'blocked') {
      out.push(U.text(x + w - 8, y + 15, 'LOCKED', { size: 8, colour: C.warn, align: 'right' }))
    } else {
      out.push(U.text(x + w - 8, y + 15, M.money(st.price),
        { size: 10, colour: st.state === 'ok' ? C.moss : C.bad, align: 'right', weight: '600' }))
    }

    const traits = OP.Upgrades && OP.Upgrades.traits ? OP.Upgrades.traits(def, sim) : null
    const bits = []
    if (isHero) bits.push('HERO')
    if (traits) {
      bits.push(String(traits.dmgType).toUpperCase())
      if (traits.camoNow) bits.push('SEES CAMO')
      else if (traits.camoLater) bits.push('CAMO VIA UPG')
    }
    out.push(U.text(tx, y + 30, U.clipText(bits.join(' · '), 8, w - (tx - x) - 12),
      { size: 8, colour: C.faint }))

    // A permanent blind spot is the one thing worth shouting on the card itself:
    // it is the difference between a tower that needs an upgrade and one that will
    // never answer a round no matter what you spend.
    if (hasTree) {
      // A quiet chevron: discoverable without competing with the price.
      out.push(U.text(x + w + TREE_W / 2, y + h / 2 - 5, '\u25B8', { size: 11, colour: C.moss, align: 'center' }))
      out.push(U.text(x + w + TREE_W / 2, y + h / 2 + 9, 'UPG', { size: 6, colour: C.faint, align: 'center' }))
      out.push(U.rule(x + w, y + 6, 0, { colour: C.line }))
    }

    if (traits && traits.blindTo.length) {
      out.push(U.text(x + w - 8, y + 30, 'never: ' + U.clipText(traits.blindTo.join(','), 8, 70),
        { size: 8, colour: C.bad, align: 'right' }))
    } else if (traits && traits.fixable.length) {
      out.push(U.text(x + w - 8, y + 30, 'upg: ' + U.clipText(traits.fixable.join(','), 8, 70),
        { size: 8, colour: C.warn, align: 'right' }))
    }
  }

  /* ---------- the detail strip ----------
     The blurb lives here rather than in the cell, because a 145-wide cell cannot
     hold a sentence and a truncated blurb is worse than none. */

  function detail (app, sim, marks, over, S, y, h, widgets) {
    const U = ui(); const C = colours()
    const padX = 12
    const x0 = S.x + padX
    const innerW = S.w - padX * 2

    marks.push(U.box(x0, y, innerW, h, { fill: C.panelHi, stroke: C.line }))

    /* Read the STICKY key, not the live hover — see Shop.state.detailKey. Also
       re-derive price and availability every frame rather than reusing whatever the
       card widget was carrying: cash changes constantly, and a strip quoting a
       stale affordability would disagree with the card right above it. */
    const key = state.detailKey
    const isHero = !!state.detailHero
    const def = key ? ((isHero ? OP.HEROES : OP.TOWERS) || {})[key] : null
    const st = def ? entryState(sim, def, isHero) : null
    if (!def) {
      over.push(U.text(x0 + 10, y + 20, 'Point at a critter', { size: 11, colour: C.dim }))
      over.push(U.text(x0 + 10, y + 36, 'to see what it pops, what it', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 48, 'can never pop, and its whole', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 60, 'upgrade tree before you buy.', { size: 9, colour: C.faint }))
      over.push(U.text(x0 + 10, y + 80, 'Tap to place · scroll the list', { size: 8, colour: C.faint }))
      return
    }

    const famLabel = isHero
      ? 'HERO' + (def.title ? ' · ' + String(def.title).toUpperCase() : '')
      : String((OP.FAMILY_LABELS && OP.FAMILY_LABELS[def.family]) || def.family || '').toUpperCase()

    over.push(U.text(x0 + 10, y + 18, U.clipText(def.name || def.key, 12, innerW - 80),
      { size: 12, colour: C.ink, weight: '600' }))
    over.push(U.text(x0 + innerW - 10, y + 18, M.money(st.price),
      { size: 11, colour: st.state === 'ok' ? C.moss : C.bad, align: 'right' }))
    over.push(U.text(x0 + 10, y + 30, U.clipText(famLabel, 8, innerW - 20), { size: 8, colour: C.moss }))

    const blurb = U.wrapText(def.blurb, 9, innerW - 20, 2)
    for (let i = 0; i < blurb.length; i++) {
      over.push(U.text(x0 + 10, y + 43 + i * 11, blurb[i], { size: 9, colour: C.dim }))
    }

    /* ----- the traits summary -----
       Three lines at most, and only the ones that carry information: what it pops
       now, what an upgrade would let it pop, and what it will never pop. Printing
       "pops: red, blue, green…" for every tower would be noise; the interesting
       set is exactly the tiers something is immune to. */
    const traits = OP.Upgrades && OP.Upgrades.traits ? OP.Upgrades.traits(def, sim) : null
    let ty = y + 43 + blurb.length * 11 + 2
    if (traits) {
      const canNow = traits.pops.filter(function (p) { return p.now }).map(function (p) { return p.label })
      if (canNow.length) {
        over.push(U.text(x0 + 10, ty, U.clipText('pops ' + canNow.join(', '), 8, innerW - 20),
          { size: 8, colour: C.moss }))
        ty += 10
      }
      if (traits.fixable.length) {
        over.push(U.text(x0 + 10, ty, U.clipText('upgrades to pop ' + traits.fixable.join(', '), 8, innerW - 20),
          { size: 8, colour: C.warn }))
        ty += 10
      }
      if (traits.blindTo.length) {
        over.push(U.text(x0 + 10, ty, U.clipText('never pops ' + traits.blindTo.join(', '), 8, innerW - 20),
          { size: 8, colour: C.bad }))
        ty += 10
      }
      const camo = traits.camoNow ? 'sees camo' : (traits.camoLater ? 'sees camo once upgraded' : 'cannot see camo')
      over.push(U.text(x0 + 10, ty, camo, { size: 8, colour: traits.camoNow ? C.moss : (traits.camoLater ? C.warn : C.dim) }))
    }

    /* No upgrade-tree button here any more — it lives on each card instead.
       A duplicate would also collide on id, since the strip describes a card that
       is usually still on screen. The strip just says how to get there. */
    over.push(U.text(x0 + 10, y + h - 8, 'press \u25B8 UPG on a card for its full tree',
      { size: 8, colour: C.faint }))

    if (st.reason) {
      const lines = U.wrapText(st.reason, 9, innerW - 118, 2)
      for (let i = 0; i < lines.length; i++) {
        over.push(U.text(x0 + 10, y + h - 16 + i * 11 - (lines.length - 1) * 11, lines[i],
          { size: 9, colour: st.state === 'blocked' ? C.warn : C.bad }))
      }
    }
  }

  /* ============================================================================
     THE UPGRADE TREE

     A scrim overlay over the field rather than another sidebar panel: three
     branches of five upgrades with names, costs and descriptions does not fit in
     a 170px column, and squeezing it there is how you end up with a tree nobody
     reads.
     ============================================================================ */

  function buildTree (app) {
    const U = ui()
    const marks = []
    const widgets = []
    const over = []
    const sim = simOf(app)
    const key = state.tree
    const def = (OP.TOWERS && OP.TOWERS[key]) || (OP.HEROES && OP.HEROES[key]) || null
    if (!U || !sim || !def) { state.tree = null; return null }

    const C = colours()
    const paths = def.paths || []

    /* SIZE THE PANEL TO THE TEXT, not the text to the panel.

       Upgrade descriptions are not uniform: measured across all 375 of them, 74
       need one line and the longest needs eight. A fixed row height either clips
       the long ones mid-sentence — useless in a panel whose only job is telling
       you what you would buy — or wastes a screen of whitespace on the short ones.

       So each row is as tall as its own text, each column accumulates its own
       height, and the line cap drops only if the tallest column would not fit on
       screen. Clipping is the last resort, not the default. */
    const W = 920
    const PAD = 26
    const HEAD = 102
    const FOOT = 34
    const colW = Math.floor((W - PAD * 2 - 12 * (paths.length - 1)) / Math.max(1, paths.length))
    const MAX_H = OP.FIELD_H - 48

    function layout (cap) {
      const cols = []
      let tallest = 0
      for (let p = 0; p < paths.length; p++) {
        const rows = []
        let y = 0
        const tiers = (paths[p] && paths[p].tiers) || []
        for (let t = 0; t < tiers.length; t++) {
          const up = tiers[t]
          if (!up) continue
          const lines = U.wrapText(up.desc || '', 8, colW - 22, cap)
          const h = 22 + lines.length * 10 + 6
          rows.push({ up: up, tier: t, dy: y, h: h, lines: lines })
          y += h + 5
        }
        cols.push(rows)
        if (y > tallest) tallest = y
      }
      return { cols: cols, h: HEAD + tallest + FOOT }
    }

    let plan = null
    for (let cap = 8; cap >= 2; cap--) {
      plan = layout(cap)
      if (plan.h <= MAX_H) break
    }

    const H = Math.min(plan.h, MAX_H)
    const x0 = Math.round((FIELD_W - W) / 2)
    const y0 = Math.round((OP.FIELD_H - H) / 2)

    marks.push(U.box(x0, y0, W, H, { fill: C.panel, stroke: C.line, alpha: 0.985 }))

    const r = 22
    marks.push(U.portrait(x0 + PAD + r, y0 + 30, r, def.key, {}))
    over.push(U.text(x0 + PAD + r * 2 + 12, y0 + 26, def.name || def.key, { size: 15, colour: C.ink, weight: '600' }))
    over.push(U.text(x0 + PAD + r * 2 + 12, y0 + 42, 'UPGRADE PATHS · ' + M.money(OP.Economy.price(sim, def.cost)) + ' to place',
      { size: 9, colour: C.moss }))

    const close = U.button('shop.tree.close', x0 + W - 36, y0 + 14, 24, 24, {
      label: '', action: 'shop-tree-close'
    })
    widgets.push(close)
    // Drawn as an explicit mark rather than relying on the button's own label: the
    // footer promises "× closes", and a promise the player cannot see is a lie.
    over.push(U.text(x0 + W - 24, y0 + 31, '\u00d7', { size: 16, colour: C.dim, align: 'center' }))

    // The crosspath rule is the single most surprising thing about a BTD-shaped
    // upgrade tree, and it decides which of these columns a player can finish.
    over.push(U.text(x0 + PAD, y0 + 64,
      'At most one branch past tier 2, at most two branches touched — so 5-2-0 and its permutations.',
      { size: 8, colour: C.faint }))



    for (let p = 0; p < paths.length; p++) {
      const path = paths[p]
      const cx = x0 + PAD + p * (colW + 12)
      over.push(U.text(cx, y0 + 88, U.clipText(String(path.name || 'PATH ' + (p + 1)).toUpperCase(), 9, colW),
        { size: 9, colour: C.moss, weight: '600' }))
      marks.push(U.rule(cx, y0 + 94, colW, { colour: C.line }))

      const rows = plan.cols[p] || []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const ry = y0 + HEAD + row.dy
        marks.push(U.box(cx, ry, colW, row.h, { fill: C.panelHi, stroke: C.line, alpha: 0.7 }))
        over.push(U.text(cx + 6, ry + 13, String(row.tier + 1), { size: 8, colour: C.faint }))
        over.push(U.text(cx + 18, ry + 13, U.clipText(row.up.name || '', 9, colW - 62),
          { size: 9, colour: C.ink, weight: '600' }))
        over.push(U.text(cx + colW - 6, ry + 13, M.money(OP.Economy.price(sim, row.up.cost)),
          { size: 8, colour: C.moss, align: 'right' }))
        for (let n = 0; n < row.lines.length; n++) {
          over.push(U.text(cx + 18, ry + 25 + n * 10, row.lines[n], { size: 8, colour: C.dim }))
        }
      }
    }

    over.push(U.text(x0 + PAD, y0 + H - 12, 'ESC or × closes · this is a preview, nothing is bought here',
      { size: 8, colour: C.faint }))

    return model(marks, widgets, over, app, { screen: 'shop-tree', backdrop: 'scrim' })
  }

  /* Both the card and its own upgrade-tree button resolve to the same tower.
     Without the second action here, moving the pointer onto UPGRADES made the
     hovered widget a non-tower and blanked the strip the button sits in — the
     same shape of bug as a tap clearing the selection before the press lands. */
  function defFor (widget) {
    if (!widget) return null
    if (widget.action !== 'shop-buy' && widget.action !== 'shop-tree') return null
    if (widget.hero) return OP.HEROES ? OP.HEROES[widget.arg] : null
    return OP.TOWERS ? OP.TOWERS[widget.arg] : null
  }

  /* ============================================================================
     PAINT / HIT / ACTIONS
     ============================================================================ */

  function paint (ctx, m) {
    const U = ui()
    if (!U || !m) return 0

    // Chrome first, then the scrolled content inside a clip, then the chrome that
    // sits over it. Without the clip a card halfway out of the viewport paints
    // across the header and the detail strip.
    let n = U.paint(ctx, { marks: m.marks, widgets: [], backdrop: m.backdrop }, {})

    const clipped = m.clip && ctx.save && ctx.beginPath && ctx.clip
    if (clipped) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(m.clip.x, m.clip.y, m.clip.w, m.clip.h)
      ctx.clip()
    }
    n += U.paint(ctx, { marks: m.listMarks || [], widgets: m.cardWidgets || [] }, { hoverId: m.hoverId })
    if (m.listOver && m.listOver.length) n += U.paint(ctx, { marks: m.listOver, widgets: [] }, {})
    if (clipped) ctx.restore()

    // Chrome widgets are NOT clipped: the upgrade-tree button lives in the detail
    // strip, below the list viewport, and clipping it would paint it nowhere while
    // leaving it clickable.
    n += U.paint(ctx, { marks: [], widgets: m.chromeWidgets || [] }, { hoverId: m.hoverId })
    if (m.over && m.over.length) n += U.paint(ctx, { marks: m.over, widgets: [] }, {})
    return n
  }

  Shop.build = build

  Shop.draw = function (ctx, app) {
    if (!showing(app)) return 0
    let n = paint(ctx, build(app))
    // The tree is drawn over the sidebar and over the board, because it is a modal
    // preview: while it is open nothing behind it should look pressable.
    if (state.tree) {
      const tm = buildTree(app)
      if (tm) n += paint(ctx, tm)
    }
    return n
  }

  /* While the tree is open it owns the WHOLE field, not just the sidebar —
     otherwise a tap on the scrim would fall through and place a tower behind an
     overlay the player is still reading. */
  Shop.chromeAt = function (app, x, y) {
    if (!showing(app)) return false
    if (state.tree) return true
    const S = sidebar()
    return x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h
  }

  Shop.hitAt = function (app, x, y) {
    const U = ui()
    if (!U || !showing(app)) return null
    if (state.tree) {
      const tm = buildTree(app)
      const hit = tm ? U.hit(tm.widgets, x, y) : null
      // A press anywhere else on the scrim closes it — the usual way out of a
      // modal, and it means a player who opened it by accident is not trapped.
      if (hit) return hit
      return { id: 'shop.tree.scrim', action: 'shop-tree-close', x: x, y: y, w: 0, h: 0 }
    }
    return U.hit(build(app).widgets, x, y)
  }

  /** Wheel over the sidebar scrolls the card list. */
  Shop.wheelAt = function (app, dy, x, y) {
    if (!showing(app)) return false
    if (state.tree) return true          // swallow scroll behind a modal
    build(app)                            // refresh maxScroll for the live roster
    return Shop.scrollBy(dy)
  }

  Shop.key = function (app, key) {
    if (!showing(app)) return false
    if (key === 'Escape' && state.tree) { Shop.closeTree(); return true }
    return false
  }

  Shop.activate = function (app, w) {
    const sim = simOf(app)
    const io = ioOf(app)
    if (!w || !sim || !io) return false

    if (w.action === 'shop-tree') { Shop.openTree(w.arg); click(true); return true }
    if (w.action === 'shop-tree-close') { Shop.closeTree(); click(true); return true }
    if (w.action !== 'shop-buy') return false

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
        activate: Shop.activate,
        wheelAt: Shop.wheelAt
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

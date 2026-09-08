;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     HUD — the in-game readouts and controls, plus the in-game tap router.

     Everything is drawn on the canvas, so this file reuses the widget layer from
     js/ui/menus.js exactly as js/ui/bestiary.js does: build(app) returns a plain
     MODEL, paint draws it, hit() resolves a point. No second widget layer, and a
     tap resolves against a freshly recomputed layout rather than a list left
     behind by the last frame.

     Three rules hold this file together:

       1. DRAW FUNCTIONS NEVER MUTATE. Not the sim, not the profile, not module
          state. Only activate(), install() and the input wrappers change anything.
          The suite proves it by comparing OP.Sim.serialize before and after
          drawing thousands of frames.
       2. Every action asks the engine (Sim.startRound, Sim.setSpeed,
          Towers.canActivate) rather than reimplementing a rule. A UI that decides
          for itself whether an ability is ready will drift from the sim that
          actually runs it.
       3. Nothing may throw on an empty registry. The renderer unregisters a layer
          that throws, so a single bad frame would take the whole interface off
          screen for the rest of the run.

     THE ROUTER lives here because the HUD is the one in-game surface that is
     always present. js/ui/shop.js and js/ui/tower-panel.js register themselves
     with HUD.registerPanel — the same shape bestiary.js uses to register with
     menus.js — so this file knows nothing about them and they need no listeners.
     ============================================================================ */

  const HUD = {}

  const FIELD_W = OP.FIELD_W
  const FIELD_H = OP.FIELD_H

  /* ---------- layout ----------
     Published, because the shop and the tower panel share the sidebar rect and
     two files inventing the same number is two files that can disagree. */

  HUD.LAYOUT = {
    top: { x: 0, y: 0, w: FIELD_W, h: 60 },
    bottom: { x: 0, y: FIELD_H - 68, w: 960, h: 68 },
    hero: { x: 16, y: 524, w: 312, h: 116 },
    powers: { x: 344, y: 548, w: 600, h: 92 },
    sidebar: { x: 960, y: 68, w: FIELD_W - 960, h: FIELD_H - 76 }
  }

  const L = HUD.LAYOUT

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }

  function colours () {
    return (OP.Menus && OP.Menus.COLOURS) || {
      bg: '#0e1410', deep: '#070a08', panel: '#141c17', panelHi: '#1d2720', panelSel: '#22301f',
      line: '#2a352c', lineHi: '#3c4c3f', ink: '#e8efe6', dim: '#94a595', faint: '#5d6d5f',
      moss: '#6fae7f', mossDeep: '#3f6b4c', gold: '#c9a227', warn: '#e0b64a', bad: '#d0604f'
    }
  }

  /* ---------- shared app readers ----------
     Every one of these tolerates a half-built app: the shell is documented as
     booting with any UI module missing, and the suites drive these modules with a
     hand-rolled app object. */

  function simOf (app) { return app && app.state ? app.state.sim : null }
  function ioOf (app) {
    if (app && app.state && app.state.io) return app.state.io
    return OP.Input ? OP.Input.state : null
  }

  /** The selected tower, asked of the shell first so one answer serves everyone. */
  function selectedTower (app) {
    if (app && typeof app.selectedTower === 'function') {
      try { const t = app.selectedTower(); if (t) return t } catch (e) { /* fall through */ }
    }
    const sim = simOf(app)
    const io = ioOf(app)
    if (!sim || !io || !(io.selectedId >= 0) || !sim.towerById) return null
    return sim.towerById.get(io.selectedId) || null
  }
  HUD.selectedTower = selectedTower

  /** Is the board live and interactive — i.e. not a menu and not a finished run? */
  function gameActive (app) {
    const sim = simOf(app)
    if (!sim || sim.over) return false
    return !(app.state && app.state.screen && app.state.screen !== 'game')
  }
  HUD.gameActive = gameActive

  function inRect (r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  }
  HUD.inRect = inRect

  function click (ok) {
    if (!OP.Audio || !OP.Audio.play) return
    OP.Audio.play(ok === false ? 'deny' : 'ui')
  }
  HUD.click = click

  /** Tell the player why an action was refused, at the thing they pressed. */
  function refuse (x, y, reason) {
    click(false)
    if (OP.FX && OP.FX.say && reason) OP.FX.say(x, y, reason, colours().bad)
  }
  HUD.refuse = refuse

  /* ============================================================================
     THE IN-GAME PANEL ROUTER

     A tap on the board means "place" or "select"; a tap on a panel means "press
     that button". Input resolves the first two for us, so the only thing needed
     here is a way to notice that a point landed on chrome and to route it.

     ORDERING NOTE, and it is load-bearing: OP.Input.tap resolves the point to a
     tower id and then OVERWRITES io.selectedId before firing `select`. By the time
     a handler runs, the selection the player was looking at is already gone — so
     pressing an upgrade button would deselect the tower and the panel would
     vanish under the press. The tower lookup is the last moment the live selection
     is visible, so the hook below records it there, and the select wrapper puts it
     back when the tap turns out to have been a UI press.
     ============================================================================ */

  const PANELS = []

  /**
   * Register an in-game panel.
   * @param {string} name
   * @param {number} order   higher is on top; the HUD itself is 0
   * @param {object} spec    { chromeAt(app,x,y), hitAt(app,x,y), activate(app,w) }
   */
  HUD.registerPanel = function (name, order, spec) {
    HUD.unregisterPanel(name)
    PANELS.push({ name: name, order: order || 0, spec: spec || {} })
    PANELS.sort(function (a, b) {
      if (a.order !== b.order) return b.order - a.order      // topmost first
      return a.name < b.name ? -1 : 1                        // stable, never insertion order
    })
    return name
  }

  HUD.unregisterPanel = function (name) {
    for (let i = 0; i < PANELS.length; i++) {
      if (PANELS[i].name === name) { PANELS.splice(i, 1); return true }
    }
    return false
  }

  HUD.panelNames = function () { return PANELS.map(function (p) { return p.name }) }

  /** The topmost registered panel whose chrome covers this point, or null. */
  function panelAt (app, x, y) {
    for (let i = 0; i < PANELS.length; i++) {
      const p = PANELS[i]
      if (typeof p.spec.chromeAt !== 'function') continue
      let hit = false
      try { hit = !!p.spec.chromeAt(app, x, y) } catch (e) { hit = false }
      if (hit) return p
    }
    return null
  }

  /** Is this point over any in-game chrome? */
  HUD.chromeAt = function (app, x, y) { return !!panelAt(app, x, y) }

  /**
   * Route a press. Returns true when the point belonged to a panel — whether or
   * not a widget was under it, because a press on a panel's background must never
   * fall through and place a tower under the panel.
   */
  HUD.route = function (app, x, y) {
    const p = panelAt(app, x, y)
    if (!p) return false
    let w = null
    if (typeof p.spec.hitAt === 'function') {
      try { w = p.spec.hitAt(app, x, y) } catch (e) { w = null }
    }
    if (w && typeof p.spec.activate === 'function') {
      try { p.spec.activate(app, w) } catch (e) { /* one bad press must not kill the frame */ }
    }
    return true
  }

  /**
   * Offer a scroll to whichever panel's chrome is under the pointer. Returns true
   * when a panel consumed it.
   *
   * Unlike `route`, an unconsumed scroll over a panel returns false: a panel with
   * nothing to scroll should not swallow the gesture, or a wheel over the sidebar
   * would feel broken rather than merely inert.
   */
  HUD.wheel = function (app, dy, x, y) {
    const p = panelAt(app, x, y)
    if (!p || typeof p.spec.wheelAt !== 'function') return false
    try { return !!p.spec.wheelAt(app, dy, x, y) } catch (e) { return false }
  }

  /* ============================================================================
     MODEL

     `over` is a second list of marks, painted AFTER the widgets. The widget layer
     paints marks first and widgets second, so a widget's own fill would cover any
     text placed inside it; painting the model twice — once normally, once with the
     overlay marks — puts the typography back on top without inventing a second
     widget layer.
     ============================================================================ */

  function model (marks, widgets, over, app) {
    return {
      screen: 'hud',
      marks: marks,
      widgets: widgets,
      over: over,
      hoverId: hoverId(app, widgets)
    }
  }

  /** What the pointer is over, recomputed from the live pointer position. */
  function hoverId (app, widgets) {
    const U = ui()
    const io = ioOf(app)
    if (!U || !io || !io.overCanvas) return null
    const w = U.hit(widgets, io.x, io.y)
    return w ? w.id : null
  }

  /* ---------- readouts ---------- */

  /** Cheapest thing the player could actually buy, or 0 when the roster is empty. */
  function cheapestPrice (sim) {
    let best = Infinity
    const order = Array.isArray(OP.TOWER_ORDER) ? OP.TOWER_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.TOWERS ? OP.TOWERS[order[i]] : null
      if (!def || !(def.cost > 0)) continue
      if (OP.Economy && OP.Economy.towerAllowed && !OP.Economy.towerAllowed(sim, def)) continue
      const price = OP.Economy ? OP.Economy.price(sim, def.cost) : def.cost
      if (price < best) best = price
    }
    return best === Infinity ? 0 : best
  }

  /**
   * The RBE of the round that has not started yet.
   *
   * OP.Rounds.definition is deliberately NOT used: its fall-through path appends
   * an error event to the sim, and nothing in a draw may touch sim state. The
   * round table is read directly, and the freeplay generator — documented as a
   * pure function of the round index — covers everything past it.
   */
  function nextRoundRBE (sim) {
    const idx = sim.roundIndex + 1
    let def = sim.roundSet ? sim.roundSet[idx] : null
    if (!def && OP.Freeplay && OP.Freeplay.generate) {
      try { def = OP.Freeplay.generate(sim, idx) } catch (e) { def = null }
    }
    if (!def || !Array.isArray(def.groups)) return null
    // roundRBE walks OP.balloonRBE, which throws on a tier nobody registered.
    try { return OP.Rounds.roundRBE(def) } catch (e) { return null }
  }

  function roundIsIdle (sim) { return !sim.round || sim.round.done }

  function label (marks, x, y, text, colour) {
    marks.push(ui().text(x, y, text, { size: 9, colour: colour || colours().dim, weight: '700' }))
  }

  function value (marks, x, y, text, colour, size) {
    marks.push(ui().text(x, y, text, { size: size || 16, colour: colour || colours().ink, weight: '600' }))
  }

  /* ============================================================================
     BUILD
     ============================================================================ */

  function build (app) {
    const U = ui()
    const marks = []
    const widgets = []
    const over = []
    const sim = simOf(app)
    if (!U || !sim) return model(marks, widgets, over, app)

    const C = colours()
    const rules = sim.rules || {}

    /* ----- the top strip: what the run is worth right now -----
       Maps are authored to the field edges, so every panel in the interface sits
       over live board. The big fills are therefore smoked rather than opaque:
       text drawn on top stays at full alpha and reads normally, while a balloon
       passing behind is still perceptible instead of vanishing. */

    marks.push(U.box(L.top.x, L.top.y, L.top.w, L.top.h, { fill: C.panel, alpha: 0.93 }))
    marks.push(U.rule(L.top.x, L.top.y + L.top.h - 1, L.top.w, { colour: C.line }))

    const cheapest = cheapestPrice(sim)
    const lowCash = cheapest > 0 && sim.cash < cheapest
    const startLives = rules.startLives > 0 ? rules.startLives : 150
    // Proportional OR absolute. A purely proportional rule means a Relentless run
    // (one life) never sees the warning at all, while 2 of 200 does — and a player
    // down to a handful of lives is in trouble however many they began with.
    const lowLives = sim.lives <= Math.max(1, Math.ceil(startLives * 0.2)) || sim.lives <= 5

    // Low cash and low lives must be obvious without reading a number, so each
    // gets a tinted field behind it as well as a colour.
    marks.push(U.box(12, 5, 224, 49, { fill: lowCash ? C.warn : C.deep, alpha: lowCash ? 0.24 : 0.65 }))
    marks.push(U.box(244, 5, 156, 49, { fill: lowLives ? C.bad : C.deep, alpha: lowLives ? 0.3 : 0.65 }))
    marks.push(U.box(408, 5, 192, 49, { fill: C.deep, alpha: 0.65 }))
    if (U.icon) {
      marks.push(U.icon(36, 30, 17, 'coin', { colour: C.gold }))
      marks.push(U.icon(268, 30, 17, 'heart', { colour: C.bad }))
      marks.push(U.icon(432, 30, 17, 'flag', { colour: C.moss }))
    }

    const cashLabel = sim.coop ? 'PLAYER ' + (sim.coop.active + 1) + ' CASH' : 'CASH'
    label(marks, 60, 19, lowCash ? cashLabel + ' / TOO LOW' : cashLabel, lowCash ? C.warn : C.dim)
    value(marks, 60, 46, U.clipText(M.money(sim.cash), 26, 164), lowCash ? C.warn : C.gold, 26)

    label(marks, 292, 19, lowLives ? 'LIVES / CRITICAL' : 'LIVES', lowLives ? C.bad : C.dim)
    value(marks, 292, 46, M.compact(Math.max(0, sim.lives)), lowLives ? C.bad : C.ink, 26)

    label(marks, 456, 19, sim.freeplay ? 'ROUND / FREEPLAY' : 'ROUND')
    const lastRound = rules.lastRound || 0
    value(marks, 456, 46,
      Math.max(0, sim.roundIndex) + (sim.freeplay || !lastRound ? '' : ' / ' + lastRound),
      C.ink, 24)

    const rbe = roundIsIdle(sim) ? nextRoundRBE(sim) : sim.round.rbe
    label(marks, 620, 21, roundIsIdle(sim) ? 'NEXT ROUND RBE' : 'ROUND RBE')
    value(marks, 620, 44, rbe === null || rbe === undefined ? '—' : M.compact(rbe), C.ink, 19)

    const pressure = OP.Sim && OP.Sim.pressure ? OP.Sim.pressure(sim) : 0
    label(marks, 760, 21, 'ON THE BOARD')
    value(marks, 760, 44, pressure > 0 ? M.compact(pressure) : '—',
      pressure > 0 ? C.warn : C.dim, 19)

    // A short pressure bar: RBE alone means little until you have watched a few
    // rounds, but a bar that fills as the board loads up reads immediately.
    if (pressure > 0 && rbe > 0) {
      const frac = M.clamp01(pressure / Math.max(1, rbe))
      marks.push(U.box(760, 49, 100, 4, { fill: C.deep }))
      marks.push(U.box(760, 49, Math.max(1, Math.round(100 * frac)), 4, { fill: C.warn, alpha: 0.9 }))
    }

    const diff = OP.DIFFICULTIES && OP.DIFFICULTIES[sim.difficulty]
    const mode = OP.MODES && OP.MODES[sim.mode]
    marks.push(U.text(FIELD_W - 20, 21, ((diff && diff.name) || sim.difficulty || '?').toUpperCase(),
      { size: 11, colour: C.ink, align: 'right', weight: '600' }))
    marks.push(U.text(FIELD_W - 20, 38, U.clipText(((mode && mode.name) || sim.mode || '?').toUpperCase(), 9, 250),
      { size: 9, colour: C.moss, align: 'right' }))

    /* ----- mini-game goal ----- */
    // A Legends Mini-game battle shows its objective live: the cash budget for
    // Least Cash, a running clock against the time target for Race, or a pop
    // counter toward the Endurance Race goal. Reached goals tint gold.
    if (sim.isLegends && sim.legendsMini && OP.LegendsData) {
      const mini = sim.legendsMini
      const name = (OP.LegendsData.miniName && OP.LegendsData.miniName(mini.type)) || 'Mini-game'
      let readout
      if (mini.type === OP.LegendsData.LEAST_CASH) {
        const spent = (sim.stats && sim.stats.cashSpent) || 0
        readout = name.toUpperCase() + '  $' + spent + ' / $' + mini.goal
      } else if (mini.type === OP.LegendsData.RACE) {
        const now = OP.Race && OP.Race.elapsed ? OP.Race.elapsed(sim) : (sim.time || 0)
        const fmt = OP.Race && OP.Race.formatTime
          ? OP.Race.formatTime
          : function (s) { return Math.floor(s) + 's' }
        readout = name.toUpperCase() + '  ' + fmt(now) + ' / ' + fmt(mini.goal)
      } else {
        const popped = (sim.stats && sim.stats.popped) || 0
        readout = name.toUpperCase() + '  ' + popped + ' / ' + mini.goal
      }
      const ok = (mini.type === OP.LegendsData.LEAST_CASH || mini.type === OP.LegendsData.RACE)
        ? false
        : ((sim.stats && sim.stats.popped) || 0) >= mini.goal
      marks.push(U.text(FIELD_W - 20, 53, U.clipText(readout, 9, 370),
        { size: 9, colour: ok ? C.gold : C.dim, align: 'right' }))
    }

    /* ----- race timer ----- */
    if (OP.Race && OP.Race.isActive && OP.Race.isActive(sim)) {
      var raceTime = OP.Race.elapsed(sim)
      label(marks, 888, 21, 'TIME')
      value(marks, 888, 44, OP.Race.formatTime(raceTime), C.gold, 19)
    }

    /* ----- boss health bar ----- */
    if (OP.Boss && OP.Boss.isActive && OP.Boss.isActive(sim)) {
      const bi = OP.Boss.info(sim)
      if (bi) {
        const bx = 16, by2 = 82, bw = 420, bh = 20
        // Boss name and tier
        marks.push(U.text(bx, by2 - 2, bi.name.toUpperCase() + ' T' + bi.tier + (bi.elite ? ' ELITE' : ''),
          { size: 10, colour: bi.colour, weight: '600' }))
        // Background bar
        marks.push(U.box(bx, by2 + 10, bw, bh, { fill: C.deep }))
        // Health fill
        const hpFrac = M.clamp01(bi.fraction)
        const hpColour = hpFrac > 0.5 ? bi.colour : hpFrac > 0.25 ? C.warn : C.bad
        marks.push(U.box(bx, by2 + 10, Math.max(1, Math.round(bw * hpFrac)), bh,
          { fill: hpColour, alpha: 0.9 }))
        // Border
        marks.push(U.box(bx, by2 + 10, bw, bh, { stroke: bi.colour, alpha: 0.6 }))
        // HP text
        marks.push(U.text(bx + bw / 2, by2 + 22, M.compact(bi.hp) + ' / ' + M.compact(bi.maxHP),
          { size: 9, colour: C.ink, align: 'center', weight: '600' }))
      }
    }

    /* ----- the bottom strip: everything you press between rounds ----- */

    marks.push(U.box(L.bottom.x, L.bottom.y, L.bottom.w, L.bottom.h, { fill: C.panel, alpha: 0.93 }))
    marks.push(U.rule(L.bottom.x, L.bottom.y, L.bottom.w, { colour: C.line }))

    const by = L.bottom.y + 10
    if (roundIsIdle(sim)) {
      widgets.push(U.button('hud.start', 16, by, 216, 48, {
        label: 'START ROUND', icon: 'play', labelSize: 17,
        tone: 'primary', align: 'center', action: 'hud-start'
      }))
    } else {
      const r = sim.round
      const total = r.released + remainingInRound(r)
      marks.push(U.box(16, by, 216, 48, { fill: C.panelHi, stroke: C.moss }))
      over.push(U.text(28, by + 21, 'ROUND ' + r.index, { size: 15, colour: C.ink, weight: '700' }))
      over.push(U.text(220, by + 21, r.released + '/' + total, { size: 11, colour: C.dim, align: 'right' }))
      const frac = total > 0 ? M.clamp01(r.released / total) : 1
      over.push(U.box(28, by + 32, 192, 7, { fill: C.deep }))
      over.push(U.box(28, by + 32, Math.max(1, Math.round(192 * frac)), 7, { fill: C.moss }))
    }

    for (let i = 1; i <= 3; i++) {
      widgets.push(U.button('hud.speed' + i, 248 + (i - 1) * 76, by, 68, 48, {
        label: i + 'x', icon: i === 1 ? 'play' : 'fast', labelSize: 16,
        align: 'center', selected: sim.speed === i, tint: C.moss,
        action: 'hud-speed', arg: i
      }))
    }

    widgets.push(U.button('hud.pause', 488, by, 140, 48, {
      label: sim.paused ? 'RESUME' : 'PAUSE', icon: sim.paused ? 'play' : 'pause', labelSize: 14, align: 'center',
      selected: !!sim.paused, action: 'hud-pause'
    }))

    widgets.push(U.toggle('hud.autostart', 648, by, 152, 48, {
      label: 'AUTOSTART', on: !!sim.autostart, action: 'hud-autostart'
    }))

    if (OP.POWER_ORDER && OP.POWERS && sim.powers) {
      // A separate tray keeps every power out of both the controls and sidebar.
      const P = L.powers
      marks.push(U.box(P.x, P.y, P.w, P.h, { fill: C.panel, stroke: C.line, alpha: 0.94 }))
      label(marks, P.x + 10, P.y + 15, rules.allowPowers ? 'POWERS' : 'POWERS / DISABLED IN THIS MODE', C.gold)
      const cols = 5
      const rows = Math.max(2, Math.ceil(OP.POWER_ORDER.length / cols))
      const pw = (P.w - 24) / cols
      const ph = (P.h - 24) / rows
      for (let i = 0; i < OP.POWER_ORDER.length; i++) {
        const key = OP.POWER_ORDER[i]
        const def = OP.POWERS[key]
        if (!def) continue
        const count = sim.powers[key] || 0
        widgets.push(U.button('hud.power.' + key, P.x + 8 + (i % cols) * (pw + 2), P.y + 22 + Math.floor(i / cols) * ph, pw - 2, ph - 4, {
          label: def.short + ' ' + M.compact(count), labelSize: 10,
          icon: def.effect === 'cash' ? 'coin' : def.effect === 'lives' ? 'heart' : def.effect === 'slow' ? 'shield' : 'bolt',
          tint: def.effect === 'cash' ? C.gold : def.effect === 'lives' ? C.bad : C.moss,
          align: 'center',
          action: 'hud-power',
          arg: key,
          disabled: count <= 0 || !sim.rules.allowPowers,
          reason: !sim.rules.allowPowers ? 'Powers are disabled in this mode.' : 'None left.'
        }))
      }
    }
    marks.push(U.text(938, by + 19, 'SPACE: START', { size: 9, colour: C.dim, align: 'right' }))
    marks.push(U.text(938, by + 35, 'P: PAUSE', { size: 9, colour: C.dim, align: 'right' }))

    if (sim.paused) {
      marks.push(U.text(FIELD_W / 2, 90, 'PAUSED', { size: 22, colour: C.warn, align: 'center', weight: '600' }))
    }
    if (sim.coop && sim.coop.swapping) {
      marks.push(U.box(FIELD_W / 2 - 190, 292, 380, 104, { fill: C.deep, stroke: C.gold, alpha: 0.96 }))
      marks.push(U.text(FIELD_W / 2, 334, 'PLAYER ' + (sim.coop.active + 1) + ' TURN', {
        size: 24, colour: C.gold, align: 'center', weight: '600'
      }))
      marks.push(U.text(FIELD_W / 2, 362, 'Pass control to the next player.', {
        size: 11, colour: C.ink, align: 'center'
      }))
    }

    /* ----- the hero panel ----- */
    heroPanel(app, sim, marks, widgets, over)

    return model(marks, widgets, over, app)
  }

  function remainingInRound (r) {
    let n = 0
    for (let i = 0; i < r.groups.length; i++) n += Math.max(0, r.groups[i].remaining)
    return n
  }

  /* ---------- hero ---------- */

  function heroOf (sim) {
    if (!OP.Heroes || !OP.Heroes.of) return null
    try { return OP.Heroes.of(sim) } catch (e) { return null }
  }
  HUD.heroOf = heroOf

  function heroPanel (app, sim, marks, widgets, over) {
    const hero = heroOf(sim)
    if (!hero || !hero.s) return
    const U = ui(); const C = colours()
    const r = L.hero

    marks.push(U.box(r.x, r.y, r.w, r.h, { fill: C.panel, stroke: C.line, alpha: 0.94 }))
    marks.push(U.portrait(r.x + 30, r.y + 29, 22, hero.key || hero.heroKey, {}))
    marks.push(U.text(r.x + 60, r.y + 22, U.clipText(displayName(hero), 14, r.w - 72),
      { size: 14, colour: C.ink, weight: '700' }))

    const maxLevel = OP.Heroes.MAX_LEVEL || 20
    marks.push(U.text(r.x + r.w - 12, r.y + 38, 'LV ' + hero.level + ' / ' + maxLevel,
      { size: 10, colour: C.moss, align: 'right' }))

    let progress = 0
    try { progress = OP.Heroes.progress(hero) } catch (e) { progress = 0 }
    marks.push(U.box(r.x + 60, r.y + 30, 140, 6, { fill: C.deep }))
    marks.push(U.box(r.x + 60, r.y + 30, Math.max(1, Math.round(140 * M.clamp01(progress))), 6,
      { fill: hero.level >= maxLevel ? C.gold : C.moss }))
    marks.push(U.text(r.x + 60, r.y + 50,
      hero.level >= maxLevel
        ? 'fully levelled'
        : Math.round(progress * 100) + '% to level ' + (hero.level + 1),
      { size: 9, colour: C.faint }))
    marks.push(U.text(r.x + r.w - 12, r.y + 50, M.compact(Math.floor(hero.xp || 0)) + ' XP',
      { size: 9, colour: C.faint, align: 'right' }))

    // Both abilities, side by side. Whether either exists is content: an ability
    // is attached by a level's apply(), so ask the resolved stats, never the level.
    abilityButton(app, sim, hero, marks, widgets, over,
      hero.s.ability, 1, r.x + 12, r.y + 60, Math.floor((r.w - 32) / 2), 42)
    abilityButton(app, sim, hero, marks, widgets, over,
      hero.s.ability2, 2, r.x + 20 + Math.floor((r.w - 32) / 2), r.y + 60, Math.floor((r.w - 32) / 2), 42)
  }

  function displayName (tower) {
    if (OP.Towers && OP.Towers.displayName) {
      try { return OP.Towers.displayName(tower) } catch (e) { /* fall through */ }
    }
    return (tower.def && tower.def.name) || tower.key || '?'
  }
  HUD.displayName = displayName

  /**
   * One ability button with its cooldown. `slot` is 1 for the tower ability and 2
   * for a hero's second — the two have separate engine entry points, so the slot
   * is what activate() routes on.
   */
  function abilityButton (app, sim, tower, marks, widgets, over, ability, slot, x, y, w, h) {
    const U = ui(); const C = colours()
    if (!ability) {
      marks.push(U.box(x, y, w, h, { stroke: C.line, alpha: 0.5 }))
      over.push(U.text(x + 10, y + h / 2 + 4, slot === 2 ? 'no second ability' : 'no ability',
        { size: 9, colour: C.faint }))
      return null
    }

    const check = canActivate(sim, tower, slot)
    const cd = slot === 2 ? (tower.ability2Cd || 0) : (tower.abilityCd || 0)
    const full = ability.cooldown > 0 ? ability.cooldown : 1

    const widget = U.button('hud.ability' + slot + '.' + tower.id, x, y, w, h, {
      label: '', disabled: !check.ok, action: 'hud-ability', arg: slot, reason: check.reason
    })
    widget.keepId = tower.id
    widgets.push(widget)

    over.push(U.text(x + 10, y + 17, U.clipText(ability.name || 'Ability', 10, w - 20),
      { size: 10, colour: check.ok ? C.ink : C.dim }))
    if (cd > 0) {
      over.push(U.box(x + 10, y + 24, w - 20, 5, { fill: C.deep }))
      over.push(U.box(x + 10, y + 24, Math.max(1, Math.round((w - 20) * M.clamp01(1 - cd / full))), 5,
        { fill: C.warn }))
      over.push(U.text(x + 10, y + 39, cd.toFixed(1) + 's', { size: 9, colour: C.warn }))
    } else {
      over.push(U.text(x + 10, y + 39, check.ok ? 'READY' : U.clipText(check.reason, 9, w - 20),
        { size: 9, colour: check.ok ? C.moss : C.faint }))
    }
    return widget
  }
  HUD.abilityButton = abilityButton

  /** Ask the engine, both slots. Never decides readiness here. */
  function canActivate (sim, tower, slot) {
    try {
      if (slot === 2) return OP.Heroes.canActivateSecond(sim, tower)
      return OP.Towers.canActivate(sim, tower)
    } catch (e) {
      return { ok: false, reason: 'Unavailable.' }
    }
  }
  HUD.canActivate = canActivate

  /* ============================================================================
     PAINT
     ============================================================================ */

  function paint (ctx, m) {
    const U = ui()
    if (!U || !m) return 0
    let n = U.paint(ctx, m, { hoverId: m.hoverId })
    if (m.over && m.over.length) n += U.paint(ctx, { marks: m.over, widgets: [] }, {})
    return n
  }

  HUD.build = build

  /** Draw the HUD. Mutates nothing; safe to call as often as you like. */
  HUD.draw = function (ctx, app) {
    const sim = simOf(app)
    if (!sim || sim.over) return 0
    return paint(ctx, build(app))
  }

  /* ---------- hit testing ---------- */

  HUD.chromeAtOwn = function (app, x, y) {
    const sim = simOf(app)
    if (!sim || sim.over) return false
    if (inRect(L.top, x, y) || inRect(L.bottom, x, y)) return true
    if (OP.POWER_ORDER && OP.POWERS && sim.powers && inRect(L.powers, x, y)) return true
    return !!heroOf(sim) && inRect(L.hero, x, y)
  }

  HUD.hitAt = function (app, x, y) {
    const U = ui()
    if (!U) return null
    return U.hit(build(app).widgets, x, y)
  }

  /* ============================================================================
     ACTIONS

     Every branch goes through an engine call. The HUD never edits cash, lives, a
     cooldown or a round — it asks, and shows what came back.
     ============================================================================ */

  HUD.activate = function (app, w) {
    const sim = simOf(app)
    if (!w || !sim) return false

    if (w.action === 'hud-start') {
      if (sim.over) { click(false); return true }
      OP.Sim.startRound(sim)
      click(true)
      return true
    }

    if (w.action === 'hud-speed') {
      OP.Sim.setSpeed(sim, w.arg)
      click(true)
      return true
    }

    if (w.action === 'hud-pause') {
      OP.Sim.togglePause(sim)
      click(true)
      return true
    }

    if (w.action === 'hud-autostart') {
      // No engine setter for this one — it is a plain flag on the sim, read by
      // Sim.step when a round completes. Persist it as a preference too, so the
      // next run starts the way this one ended.
      sim.autostart = !sim.autostart
      if (OP.Menus && OP.Menus.applySetting) OP.Menus.applySetting(app, 'autostart', sim.autostart)
      click(true)
      return true
    }

    if (w.action === 'hud-ability') {
      const tower = sim.towerById ? sim.towerById.get(w.keepId) : null
      if (!tower) { click(false); return true }
      const res = w.arg === 2
        ? OP.Heroes.activateSecond(sim, tower)
        : OP.Towers.activate(sim, tower)
      if (res && res.ok) click(true)
      else refuse(tower.x, tower.y - 24, (res && res.reason) || 'Not ready.')
      return true
    }

    if (w.action === 'hud-power') {
      const res = OP.Powers && OP.Powers.activate
        ? OP.Powers.activate(sim, w.arg)
        : { ok: false, reason: 'Powers are unavailable.' }
      if (res.ok) {
        const profile = app && app.state ? app.state.profile : null
        if (profile) {
          profile.powers = OP.Powers.copyInventory(sim.powers)
          if (OP.Save && OP.Save.save) OP.Save.save(profile)
        }
        click(true)
      } else {
        refuse(FIELD_W - 150, L.bottom.y - 10, res.reason || 'Power unavailable.')
      }
      return true
    }

    return false
  }

  /** Resolve a press against the HUD's own widgets. */
  HUD.tap = function (app, x, y) {
    const w = HUD.hitAt(app, x, y)
    if (w) HUD.activate(app, w)
    return w
  }

  /* ============================================================================
     INSTALL

     Composes with the handlers the shell and the menus already registered: a tap
     on in-game chrome is consumed here, and anything else falls through
     untouched. Each wrapper closes over the app it was installed with, because
     module state would leave a second install pointing at the first app.
     ============================================================================ */

  let logged = false
  function layerBody (ctx, app) {
    try { return HUD.draw(ctx, app) } catch (e) {
      // A throwing layer gets unregistered by the renderer, which would take the
      // whole interface off screen for the rest of the run. Swallow, report once.
      if (!logged) {
        logged = true
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: HUD draw threw', e)
      }
      return 0
    }
  }

  /** Board coordinates -> field coordinates, as a pair for spreading. */
  function fieldOf (x, y) {
    if (!OP.Camera || !OP.Camera.boardToField) return [x, y]
    const f = OP.Camera.boardToField(x, y)
    return [f.x, f.y]
  }

  HUD.install = function (app) {
    if (!app || !app.state) return HUD

    // The HUD is its own bottom-most panel, so the router has one code path.
    HUD.registerPanel('hud', 0, {
      chromeAt: HUD.chromeAtOwn,
      hitAt: HUD.hitAt,
      activate: HUD.activate
    })

    if (OP.Render && OP.Render.registerLayer) {
      OP.Render.registerLayer('hud', OP.Render.LAYER.HUD, function (ctx, sim, view, frame) {
        layerBody(ctx, (frame && frame.app) || app)
      })
    }

    const io = ioOf(app)
    if (!io || !OP.Input || !OP.Input.setHandlers) return HUD

    /* The lookup hook. See the ORDERING NOTE above: this is the last moment the
       live selection is visible, and it is also where a tower hiding under a panel
       is made unselectable — otherwise a press on the sidebar would select
       whatever happens to be behind it. */
    if (!io._uiLookupHook) {
      io._uiLookupHook = true
      const prevLookup = io._towerAt
      OP.Input.setTowerLookup(io, function (x, y) {
        io._uiSel = io.selectedId
        // The lookup is sim-facing, so `x, y` are BOARD coordinates — but "is this
        // press over chrome" is a FIELD-space question, because the panels are not
        // scaled by the board fit. Asking chromeAt in the wrong space made every
        // press on the sidebar report as empty ground behind it.
        io._uiOver = HUD.chromeAt(app, ...fieldOf(x, y))
        if (io._uiOver) return -1
        return typeof prevLookup === 'function' ? prevLookup(x, y) : -1
      })
    }

    const prev = io._handlers || {}
    if (!prev._opHud) {
      const next = {}
      for (const k in prev) next[k] = prev[k]
      next._opHud = true

      next.select = function (id) {
        if (io._uiOver && gameActive(app)) {
          // Input.tap already cleared the selection; a press on chrome is not a
          // deselect, so put back what the tap started with.
          const live = simOf(app)
          if (io._uiSel >= 0 && live && live.towerById && live.towerById.has(io._uiSel)) {
            io.selectedId = io._uiSel
          }
          HUD.route(app, io.x, io.y)
          return
        }
        if (typeof prev.select === 'function') prev.select(id)
      }

      next.place = function (key, x, y, isHero, draft) {
        // Placing mode never runs the lookup, so ask directly. The selection is
        // intact on this path, which is why no restore is needed.
        // Same space conversion as the lookup hook above: x, y arrive in board
        // space and the router works in field space.
        const f = fieldOf(x, y)
        if (gameActive(app) && HUD.chromeAt(app, f[0], f[1])) { HUD.route(app, f[0], f[1]); return }
        if (typeof prev.place === 'function') prev.place(key, x, y, isHero, draft)
      }

      OP.Input.setHandlers(io, next)
    }

    return HUD
  }

  OP.HUD = HUD
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

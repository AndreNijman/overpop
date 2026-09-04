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
    top: { x: 0, y: 0, w: FIELD_W, h: 44 },
    bottom: { x: 0, y: FIELD_H - 44, w: 960, h: 44 },
    hero: { x: 16, y: 548, w: 312, h: 116 },
    sidebar: { x: 960, y: 52, w: FIELD_W - 960, h: FIELD_H - 60 }
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
    marks.push(ui().text(x, y, text, { size: 8, colour: colour || colours().faint }))
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
    if (lowCash) marks.push(U.box(12, 6, 148, 32, { fill: C.warn, alpha: 0.14 }))
    if (lowLives) marks.push(U.box(168, 6, 120, 32, { fill: C.bad, alpha: 0.18 }))

    const cashLabel = sim.coop ? 'PLAYER ' + (sim.coop.active + 1) + ' CASH' : 'CASH'
    label(marks, 20, 18, lowCash ? cashLabel + ' / TOO LOW TO BUILD' : cashLabel, lowCash ? C.warn : C.faint)
    value(marks, 20, 35, M.money(sim.cash), lowCash ? C.warn : C.moss, 17)

    label(marks, 176, 18, lowLives ? 'LIVES · CRITICAL' : 'LIVES', lowLives ? C.bad : C.faint)
    value(marks, 176, 35, M.compact(Math.max(0, sim.lives)), lowLives ? C.bad : C.ink, 17)

    label(marks, 300, 18, sim.freeplay ? 'ROUND · FREEPLAY' : 'ROUND')
    const lastRound = rules.lastRound || 0
    value(marks, 300, 35,
      Math.max(0, sim.roundIndex) + (sim.freeplay || !lastRound ? '' : ' / ' + lastRound),
      C.ink, 17)

    const rbe = roundIsIdle(sim) ? nextRoundRBE(sim) : sim.round.rbe
    label(marks, 452, 18, roundIsIdle(sim) ? 'NEXT ROUND RBE' : 'ROUND RBE')
    value(marks, 452, 35, rbe === null || rbe === undefined ? '—' : M.compact(rbe), C.dim, 15)

    const pressure = OP.Sim && OP.Sim.pressure ? OP.Sim.pressure(sim) : 0
    label(marks, 600, 18, 'ON THE BOARD')
    value(marks, 600, 35, pressure > 0 ? M.compact(pressure) : '—',
      pressure > 0 ? C.warn : C.faint, 15)

    // A short pressure bar: RBE alone means little until you have watched a few
    // rounds, but a bar that fills as the board loads up reads immediately.
    if (pressure > 0 && rbe > 0) {
      const frac = M.clamp01(pressure / Math.max(1, rbe))
      marks.push(U.box(668, 14, 92, 6, { fill: C.deep }))
      marks.push(U.box(668, 14, Math.max(1, Math.round(92 * frac)), 6, { fill: C.warn, alpha: 0.9 }))
    }

    const diff = OP.DIFFICULTIES && OP.DIFFICULTIES[sim.difficulty]
    const mode = OP.MODES && OP.MODES[sim.mode]
    marks.push(U.text(FIELD_W - 20, 20, ((diff && diff.name) || sim.difficulty || '?').toUpperCase(),
      { size: 11, colour: C.ink, align: 'right', weight: '600' }))
    marks.push(U.text(FIELD_W - 20, 34, ((mode && mode.name) || sim.mode || '?').toUpperCase(),
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
      marks.push(U.text(FIELD_W - 20, 46, readout,
        { size: 9, colour: ok ? C.gold : C.dim, align: 'right' }))
    }

    /* ----- race timer ----- */
    if (OP.Race && OP.Race.isActive && OP.Race.isActive(sim)) {
      var raceTime = OP.Race.elapsed(sim)
      label(marks, 850, 18, 'TIME')
      value(marks, 850, 35, OP.Race.formatTime(raceTime), C.gold, 17)
    }

    /* ----- boss health bar ----- */
    if (OP.Boss && OP.Boss.isActive && OP.Boss.isActive(sim)) {
      const bi = OP.Boss.info(sim)
      if (bi) {
        const bx = 12, by2 = 48, bw = 420, bh = 18
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

    const by = L.bottom.y + 5
    if (roundIsIdle(sim)) {
      widgets.push(U.button('hud.start', 16, by, 176, 34, {
        label: 'START ROUND', tone: 'primary', align: 'center', action: 'hud-start'
      }))
    } else {
      const r = sim.round
      const total = r.released + remainingInRound(r)
      marks.push(U.box(16, by, 176, 34, { fill: C.panelHi, stroke: C.line }))
      over.push(U.text(26, by + 15, 'ROUND ' + r.index, { size: 11, colour: C.ink, weight: '600' }))
      over.push(U.text(182, by + 15, r.released + '/' + total, { size: 10, colour: C.dim, align: 'right' }))
      const frac = total > 0 ? M.clamp01(r.released / total) : 1
      over.push(U.box(26, by + 22, 156, 5, { fill: C.deep }))
      over.push(U.box(26, by + 22, Math.max(1, Math.round(156 * frac)), 5, { fill: C.moss }))
    }

    for (let i = 1; i <= 3; i++) {
      widgets.push(U.button('hud.speed' + i, 204 + (i - 1) * 48, by, 44, 34, {
        label: i + '×', align: 'center', selected: sim.speed === i,
        action: 'hud-speed', arg: i
      }))
    }

    widgets.push(U.button('hud.pause', 352, by, 96, 34, {
      label: sim.paused ? 'RESUME' : 'PAUSE', align: 'center',
      selected: !!sim.paused, action: 'hud-pause'
    }))

    widgets.push(U.toggle('hud.autostart', 462, by, 190, 34, {
      label: 'AUTOSTART', on: !!sim.autostart, action: 'hud-autostart'
    }))

    if (OP.POWER_ORDER && OP.POWERS && sim.powers) {
      for (let i = 0; i < OP.POWER_ORDER.length; i++) {
        const key = OP.POWER_ORDER[i]
        const def = OP.POWERS[key]
        const count = sim.powers[key] || 0
        widgets.push(U.button('hud.power.' + key, 668 + i * 70, by, 66, 34, {
          label: def.short + ' ' + count,
          align: 'center',
          action: 'hud-power',
          arg: key,
          disabled: count <= 0 || !sim.rules.allowPowers,
          reason: !sim.rules.allowPowers ? 'Powers are disabled in this mode.' : 'None left.'
        }))
      }
    } else {
      marks.push(U.text(L.bottom.x + L.bottom.w - 16, by + 14,
        'SPACE start / 1 2 3 speed / P pause', { size: 9, colour: C.faint, align: 'right' }))
      marks.push(U.text(L.bottom.x + L.bottom.w - 16, by + 27,
        'right-click a tower cycles its targeting', { size: 9, colour: C.faint, align: 'right' }))
    }

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
    marks.push(U.text(r.x + 12, r.y + 22, U.clipText(displayName(hero), 13, r.w - 90),
      { size: 13, colour: C.ink, weight: '600' }))

    const maxLevel = OP.Heroes.MAX_LEVEL || 20
    marks.push(U.text(r.x + r.w - 12, r.y + 22, 'LV ' + hero.level + ' / ' + maxLevel,
      { size: 10, colour: C.moss, align: 'right' }))

    let progress = 0
    try { progress = OP.Heroes.progress(hero) } catch (e) { progress = 0 }
    marks.push(U.box(r.x + 12, r.y + 30, r.w - 24, 6, { fill: C.deep }))
    marks.push(U.box(r.x + 12, r.y + 30, Math.max(1, Math.round((r.w - 24) * M.clamp01(progress))), 6,
      { fill: hero.level >= maxLevel ? C.gold : C.moss }))
    marks.push(U.text(r.x + 12, r.y + 50,
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

      next.place = function (key, x, y, isHero) {
        // Placing mode never runs the lookup, so ask directly. The selection is
        // intact on this path, which is why no restore is needed.
        // Same space conversion as the lookup hook above: x, y arrive in board
        // space and the router works in field space.
        const f = fieldOf(x, y)
        if (gameActive(app) && HUD.chromeAt(app, f[0], f[1])) { HUD.route(app, f[0], f[1]); return }
        if (typeof prev.place === 'function') prev.place(key, x, y, isHero)
      }

      OP.Input.setHandlers(io, next)
    }

    return HUD
  }

  OP.HUD = HUD
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

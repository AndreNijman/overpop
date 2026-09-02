;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     RESULTS — the one screen a player reads carefully, so it says plainly what
     happened and offers clear next steps.

     Shown whenever `sim.over`, drawn as a MODAL layer over the board that produced
     it: the last frame of the run stays visible behind the scrim, which is worth
     more than a black background.

     Input routing is already handled: js/ui/menus.js sends a tap and a key to
     OP.Results while the shell is showing results, so this file needs no listener
     of its own. It reuses the widget layer from menus.js like every other canvas
     screen.
     ============================================================================ */

  const Results = {}

  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }

  function colours () {
    return (OP.Menus && OP.Menus.COLOURS) || {
      bg: '#0e1410', deep: '#070a08', panel: '#141c17', panelHi: '#1d2720', panelSel: '#22301f',
      line: '#2a352c', lineHi: '#3c4c3f', ink: '#e8efe6', dim: '#94a595', faint: '#5d6d5f',
      moss: '#6fae7f', mossDeep: '#3f6b4c', gold: '#c9a227', warn: '#e0b64a', bad: '#d0604f'
    }
  }

  function simOf (app) { return app && app.state ? app.state.sim : null }

  function click (ok) {
    if (OP.Audio && OP.Audio.play) OP.Audio.play(ok === false ? 'deny' : 'ui')
  }

  /* ---------- geometry ---------- */

  const PANEL = { x: 340, y: 120, w: 600, h: 480 }

  /* ============================================================================
     BUILD
     ============================================================================ */

  function build (app) {
    const U = ui()
    const marks = []
    const widgets = []
    const sim = simOf(app)
    if (!U) return { screen: 'results', marks: marks, widgets: widgets }
    const C = colours()

    if (!sim) {
      // Nothing to report. Never throw: this is a registered render layer, and a
      // layer that throws is unregistered and takes the whole interface with it.
      return { screen: 'results', backdrop: 'scrim', marks: marks, widgets: widgets, defaultId: '' }
    }

    const won = sim.outcome === 'won'
    const quit = sim.outcome === 'quit'
    const freeplayEnded = sim.freeplay && !won && !quit
    const P = PANEL

    marks.push(U.box(P.x, P.y, P.w, P.h, { fill: C.panel, stroke: won ? C.moss : C.line }))
    marks.push(U.box(P.x, P.y, P.w, 3, { fill: won ? C.moss : C.bad }))

    const title = won ? 'VICTORY' : (quit ? 'ABANDONED' : (freeplayEnded ? 'FREEPLAY OVER' : 'DEFEAT'))
    marks.push(U.tracked(P.x + 40, P.y + 84, title,
      { size: 40, colour: won ? C.moss : C.bad, track: 0.16, weight: '600' }))
    marks.push(U.text(P.x + 42, P.y + 108, won
      ? 'Every round cleared. Nothing got past you.'
      : (quit ? 'You left this run behind.' : (freeplayEnded
          ? 'Your defense held beyond the final round.'
          : 'The last of your lives went through the exit.')),
      { size: 11, colour: C.dim }))

    const mapDef = OP.MAPS && app.state ? OP.MAPS[app.state.mapKey] : null
    const diff = OP.DIFFICULTIES && OP.DIFFICULTIES[sim.difficulty]
    const mode = OP.MODES && OP.MODES[sim.mode]
    marks.push(U.text(P.x + P.w - 40, P.y + 84,
      ((mapDef && mapDef.name) || (sim.map && sim.map.key) || 'unknown map'),
      { size: 12, colour: C.ink, align: 'right' }))
    marks.push(U.text(P.x + P.w - 40, P.y + 104,
      (((diff && diff.name) || sim.difficulty || '?') + ' · ' +
       ((mode && mode.name) || sim.mode || '?')).toUpperCase(),
      { size: 9, colour: C.moss, align: 'right' }))

    marks.push(U.rule(P.x + 40, P.y + 128, P.w - 80))

    const rules = sim.rules || {}
    const stats = sim.stats || {}
    const rows = [
      ['Round reached', String(Math.max(0, sim.roundIndex)) +
        (rules.lastRound && !sim.freeplay ? ' of ' + rules.lastRound : '')],
      ['Balloons popped', M.compact(stats.popped || 0)],
      ['Layers popped', M.compact(stats.layersPopped || 0)],
      ['Cash earned', M.money(stats.cashEarned || 0)],
      ['Lives left', String(Math.max(0, sim.lives))],
      ['Balloons leaked', M.compact(stats.leaked || 0)],
      ['Towers standing', String(sim.towers ? sim.towers.length : 0)],
      ['Time played', M.time(sim.time || 0)]
    ]
    // Race-specific rows
    if (OP.Race && OP.Race.isActive && OP.Race.isActive(sim)) {
      var raceTime = OP.Race.elapsed(sim)
      var profile = app && app.state ? app.state.profile : null
      var best = profile && OP.Race.bestFor ? OP.Race.bestFor(profile, app.state.mapKey, app.state.difficulty) : null
      rows.push(['Clear time', OP.Race.formatTime(raceTime)])
      if (best && best.won && best.time > 0) {
        rows.push(['Best time', OP.Race.formatTime(best.time)])
        if (raceTime > 0 && best.time > 0) {
          var timeDiff = raceTime - best.time
          var prefix = timeDiff > 0 ? '+' : ''
          rows.push(['vs Best', prefix + OP.Race.formatTime(Math.abs(timeDiff))])
        }
      } else if (won) {
        rows.push(['Best time', OP.Race.formatTime(raceTime) + ' (new!)'])
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const y = P.y + 158 + i * 26
      marks.push(U.text(P.x + 40, y, rows[i][0], { size: 11, colour: C.dim }))
      marks.push(U.text(P.x + P.w - 40, y, rows[i][1],
        { size: 13, colour: C.ink, align: 'right', weight: '600' }))
    }

    const by = P.y + P.h - 78
    marks.push(U.rule(P.x + 40, by - 22, P.w - 80, { alpha: 0.6 }))

// Expedition-specific buttons
    var profile = app && app.state ? app.state.profile : null
    var expResult = app && app.state ? app.state.expeditionResult : null
    var freeplayEligible = won && !sim.freeplay && !expResult &&
      (!app || typeof app.canContinueFreeplay !== 'function' || app.canContinueFreeplay())
    var defaultAction = freeplayEligible ? 'results.freeplay' : 'results.retry'
    var hint = freeplayEligible
      ? 'ENTER continues in freeplay · ESC returns to the title'
      : 'ENTER plays again · ESC returns to the title'
    if (expResult && expResult.stageComplete && !expResult.expeditionComplete) {
      // Map completed in expedition — show CONTINUE EXPEDITION
      var expDef = profile && OP.Expedition && OP.Expedition.activeDef(profile)
      var stageIdx = profile && OP.Expedition ? OP.Expedition.stageIndex(profile) : 0
      var totalMaps = expDef ? expDef.maps.length : 0
      widgets.push(U.button('results.expContinue', P.x + 40, by, 250, 48, {
        label: 'CONTINUE EXPEDITION', tone: 'primary', align: 'center',
        action: 'results-expedition-continue',
        sub: 'stage ' + (stageIdx + 1) + ' of ' + totalMaps
      }))
      widgets.push(U.button('results.expAbandon', P.x + P.w - 290, by, 250, 48, {
        label: 'ABANDON', align: 'center', action: 'results-expedition-abandon',
        sub: 'give up this expedition'
      }))
      defaultAction = 'results.expContinue'
      hint = 'ENTER continues the expedition · ESC returns to the title'
    } else if (expResult && expResult.expeditionComplete) {
      // Expedition fully complete
      widgets.push(U.button('results.title', P.x + 40, by, 250, 48, {
        label: 'EXPEDITION COMPLETE', tone: 'primary', align: 'center',
        action: 'results-title', sub: 'all maps cleared'
      }))
      widgets.push(U.button('results.expAbandon', P.x + P.w - 290, by, 250, 48, {
        label: 'TITLE', align: 'center', action: 'results-title', sub: 'back to the menu'
      }))
      defaultAction = 'results.title'
      hint = 'EXPEDITION COMPLETE · ESC returns to the title'
    } else {
      // Normal results buttons
      if (freeplayEligible) {
        widgets.push(U.button('results.freeplay', P.x + 40, by, 160, 48, {
          label: 'FREEPLAY', tone: 'primary', align: 'center', action: 'results-freeplay',
          sub: 'keep this defense'
        }))
        widgets.push(U.button('results.retry', P.x + 220, by, 160, 48, {
          label: 'PLAY AGAIN', align: 'center', action: 'results-retry',
          sub: 'restart this map'
        }))
        widgets.push(U.button('results.title', P.x + 400, by, 160, 48, {
          label: 'TITLE', align: 'center', action: 'results-title', sub: 'back to the menu'
        }))
      } else {
        widgets.push(U.button('results.retry', P.x + 40, by, 250, 48, {
          label: 'PLAY AGAIN', tone: 'primary', align: 'center', action: 'results-retry',
          sub: 'same map, same rules'
        }))
        widgets.push(U.button('results.title', P.x + P.w - 290, by, 250, 48, {
          label: 'TITLE', align: 'center', action: 'results-title', sub: 'back to the menu'
        }))
      }
    }

    marks.push(U.text(FIELD_W / 2, PANEL.y + PANEL.h + 30, hint,
      { size: 10, colour: C.faint, align: 'center' }))

    return {
      screen: 'results',
      backdrop: 'scrim',
      marks: marks,
      widgets: widgets,
      defaultId: defaultAction,
      hoverId: hoverId(app, widgets)
    }
  }

  function hoverId (app, widgets) {
    const U = ui()
    const io = (app && app.state && app.state.io) || (OP.Input ? OP.Input.state : null)
    if (!U || !io || !io.overCanvas) return null
    const w = U.hit(widgets, io.x, io.y)
    return w ? w.id : null
  }

  Results.build = build

  /* ============================================================================
     PAINT
     ============================================================================ */

  Results.draw = function (ctx, app) {
    const U = ui()
    const sim = simOf(app)
    if (!U || !sim || !sim.over) return 0
    const m = build(app)
    return U.paint(ctx, m, { hoverId: m.hoverId })
  }

  /* ============================================================================
     ACTIONS
     ============================================================================ */

  Results.activate = function (app, w) {
    if (!w) return false

    if (w.action === 'results-freeplay') {
      click(true)
      if (app && typeof app.continueFreeplay === 'function') app.continueFreeplay()
      return true
    }

    if (w.action === 'results-retry') {
      click(true)
      const st = app && app.state ? app.state : null
      if (app && typeof app.startGame === 'function' && st) {
        var opts = {}
        // "PLAY AGAIN" must mean same map, same rules. A finished daily run is
        // only identified by its sim seed ("daily-<dateKey>"); without carrying
        // the challenge's seed and modifiers into the replay, retrying a daily
        // would silently start the plain map with none of them (reduced-lives
        // becomes a full-lives game). The challenge is not re-armed — the day
        // was already completed on the first game over, so a replay must not
        // re-record it either.
        var live = st.sim
        if (live && typeof live.seed === 'string' && live.seed.indexOf('daily-') === 0 && OP.Daily) {
          const challenge = OP.Daily.generate(live.seed.slice('daily-'.length))
          if (challenge) {
            opts.seed = challenge.seed
            opts.rules = challenge.rules || {}
          }
        }
        app.startGame(st.mapKey, st.difficulty, st.mode, opts)
      }
      return true
    }

    if (w.action === 'results-title') {
      click(true)
      if (app && typeof app.quitToMenu === 'function') app.quitToMenu()
      else if (app && app.state) { app.state.sim = null; app.state.screen = 'menu' }
      if (OP.Menus && OP.Menus.go) OP.Menus.go(app, 'title')
      return true
    }

    if (w.action === 'results-expedition-continue') {
      click(true)
      if (app && typeof app.advanceExpedition === 'function') app.advanceExpedition()
      return true
    }

    if (w.action === 'results-expedition-abandon') {
      click(true)
      if (app && typeof app.abandonExpedition === 'function') app.abandonExpedition()
      if (OP.Menus && OP.Menus.go) OP.Menus.go(app, 'title')
      return true
    }

    return false
  }

  /**
   * Resolve a tap. Returns the widget so the caller — js/ui/menus.js routes here —
   * can treat it like any other screen's press.
   */
  Results.tap = function (app, x, y) {
    const U = ui()
    if (!U) return null
    const w = U.hit(build(app).widgets, x, y)
    if (w) Results.activate(app, w)
    return w
  }

  /** @returns {boolean} true when the key was consumed. */
  Results.key = function (app, key) {
    if (key === 'Enter') {
      const U = ui()
      if (!U) return false
      const m = build(app)
      const w = U.byId(m.widgets, m.defaultId)
      if (!w) return false
      Results.activate(app, w)
      return true
    }
    if (key === 'Escape') {
      Results.activate(app, { action: 'results-title' })
      return true
    }
    return false
  }

  /* ============================================================================
     INSTALL
     ============================================================================ */

  let logged = false
  function layerBody (ctx, app) {
    try { return Results.draw(ctx, app) } catch (e) {
      if (!logged) {
        logged = true
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: results draw threw', e)
      }
      return 0
    }
  }

  Results.install = function (app) {
    if (!app || !app.state) return Results
    if (OP.Render && OP.Render.registerLayer) {
      OP.Render.registerLayer('results', OP.Render.LAYER.MODAL, function (ctx, sim, view, frame) {
        layerBody(ctx, (frame && frame.app) || app)
      })
    }
    return Results
  }

  OP.Results = Results
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

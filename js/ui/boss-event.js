;(function (OP) {
  'use strict'

  /* Boss Event screen — the weekly rotating boss challenge picker.

     Announces this week's featured boss, shows the full three-boss roster with
     per-boss, per-difficulty tier progression (the durable "medal rack"), lets
     the player pick any boss, and starts the fight on Normal or Elite. Elite is
     gated per-boss until at least one Normal tier is beaten, mirroring how BTD6
     locks Elite behind a Normal clear.

     This is a menu screen in the same sense as bestiary/legends-screen: pure
     build + paint + activate, no sim, only reaching into OP.BossEvent for the
     week + ledger and OP.BOSSES for the roster. Falls back to a safe empty model
     when the widget layer is absent, so it can never throw during boot. */

  var EventScreen = {}

  var PAD = 96
  var FIELD_W = OP.FIELD_W
  var FIELD_H = OP.FIELD_H
  var CONTENT_W = FIELD_W - PAD * 2

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus && OP.Menus.COLOURS ? OP.Menus.COLOURS : {} }
  function selection (app) {
    var ms = OP.Menus && OP.Menus.state
    return (ms && ms.bossEventSel) || null
  }

  function build (app) {
    var U = ui()
    var C = colours()
    if (!U) return { screen: 'boss-event', backdrop: 'solid', marks: [], widgets: [] }
    var marks = []
    var widgets = []
    var profile = app && app.state ? app.state.profile : null
    var sel = selection(app)

    if (!OP.BossEvent || !OP.bossRoster) {
      marks.push(U.text(PAD, 130, 'The Boss Event is unavailable right now.', { size: 12, colour: C.dim }))
      widgets.push(U.button('event.back', PAD, FIELD_H - 80, 200, 48, {
        label: 'BACK', align: 'center', action: 'boss-event-back'
      }))
      return { screen: 'boss-event', backdrop: 'solid', marks: marks, widgets: widgets }
    }

    var sum = OP.BossEvent.summary(profile)
    var roster = OP.bossRoster()

    /* ---- header ----- */
    // Same frame as every other menu: title top-left, BACK top-right. The old
    // screen laid six boss cards in a row built for three, so half the roster
    // ran off the right edge, and the BACK button sat orphaned at the bottom.
    marks.push(U.tracked(PAD, 84, 'BOSS EVENT', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 108, 'A titan advances every twenty rounds. Kill each tier before it escapes.',
      { size: 11, colour: C.dim }))
    widgets.push(U.button('event.back', FIELD_W - PAD - 96, 62, 96, 32, {
      label: 'BACK', align: 'center', action: 'boss-event-back'
    }))
    marks.push(U.rule(PAD, 126, CONTENT_W))

    /* ---- roster: one row per boss ---- */
    var top = 150
    var bottom = 664
    var listW = 380
    var gapY = 8
    var rowH = Math.min(50, Math.floor((bottom - top + gapY) / Math.max(1, roster.length)) - gapY)
    var shown = sel || sum.bossKey || (roster[0] && roster[0].key)
    for (var i = 0; i < roster.length; i++) {
      var boss = roster[i]
      var prog = sum.progress && sum.progress[boss.key] ? sum.progress[boss.key] : { normal: 0, elite: 0 }
      widgets.push(U.row('event.card.' + boss.key, PAD, top + i * (rowH + gapY), listW, rowH, {
        label: boss.name,
        sub: 'Normal ' + prog.normal + '/5 · Elite ' + prog.elite + '/5',
        note: boss.key === sum.bossKey ? 'THIS WEEK' : '',
        swatch: boss.colour,
        selected: shown === boss.key,
        action: 'boss-event-select', arg: boss.key
      }))
    }

    /* ---- detail for the picked (or featured) boss ---- */
    var b = null
    for (var j = 0; j < roster.length; j++) if (roster[j].key === shown) b = roster[j]
    var dx = PAD + listW + 24
    var dw = FIELD_W - PAD - dx
    marks.push(U.box(dx, top, dw, bottom - top, { fill: '#5a3a1e', stroke: '#2a1a0a', alpha: 0.97 }))
    if (b) {
      var bp = sum.progress && sum.progress[b.key] ? sum.progress[b.key] : { normal: 0, elite: 0 }
      var ix = dx + 22
      var iw = dw - 44
      // Most bosses are dark; a pale disc keeps them from vanishing into the wood.
      marks.push(U.dot(ix + 34, top + 56, 38, { fill: '#e8d2ae' }))
      marks.push(U.balloon(ix + 34, top + 56, 30, { colour: b.colour, shade: b.shade }))
      var nx = ix + 84
      marks.push(U.text(nx, top + 50, b.name.toUpperCase(), { size: 22, colour: C.ink, weight: '700' }))
      marks.push(U.text(nx, top + 74, b.key === sum.bossKey ? "THIS WEEK'S BOSS" : 'OFF-ROTATION · still fightable', {
        size: 11, colour: b.key === sum.bossKey ? C.gold : C.moss, weight: '600'
      }))
      var lines = U.wrapText(b.blurb || '', 13, iw, 3)
      for (var l = 0; l < lines.length; l++) {
        marks.push(U.text(ix, top + 124 + l * 19, lines[l], { size: 13, colour: C.ink }))
      }
      var y = top + 124 + lines.length * 19 + 14
      if (b.ability && b.ability.desc) {
        marks.push(U.tracked(ix, y, 'ABILITY', { size: 10, colour: C.faint, track: 0.24, weight: '600' }))
        marks.push(U.text(ix + 90, y, U.clipText(b.ability.desc, 12, iw - 90), { size: 12, colour: C.dim }))
        y += 22
      }
      marks.push(U.tracked(ix, y, 'ARRIVES', { size: 10, colour: C.faint, track: 0.24, weight: '600' }))
      marks.push(U.text(ix + 90, y, 'round ' + (b.spawnsOnRound || 40) + ', then a tier every ' + (b.tierInterval || 20) + ' rounds', { size: 12, colour: C.dim }))
      y += 34

      // Tier progress as five filled/empty boxes per difficulty — the old
      // ■□ glyph strings depended on the font having them.
      var rack = [['NORMAL', bp.normal, C.moss], ['ELITE', bp.elite, C.bad]]
      for (var r = 0; r < rack.length; r++) {
        marks.push(U.tracked(ix, y + 14, rack[r][0], { size: 11, colour: C.ink, track: 0.2, weight: '700' }))
        for (var t = 0; t < 5; t++) {
          marks.push(U.box(ix + 90 + t * 40, y, 32, 20, {
            fill: rack[r][1] > t ? rack[r][2] : '#3e2a18', stroke: '#2a1a0a'
          }))
        }
        marks.push(U.text(ix + 90 + 5 * 40 + 6, y + 14, rack[r][1] + ' / 5 tiers', { size: 11, colour: C.dim }))
        y += 30
      }
      marks.push(U.text(ix, y + 10, 'Each tier beaten banks Knowledge Points and a trophy on your rack.', { size: 11, colour: C.faint }))

      /* ---- action buttons ---- */
      var by = bottom - 74
      var bw = Math.floor((iw - 12) / 2)
      var eliteDisabled = !OP.BossEvent.eliteUnlocked(profile, b.key)
      widgets.push(U.button('event.fight.normal', ix, by, bw, 52, {
        label: 'FIGHT NORMAL', tone: 'primary', align: 'center',
        action: 'boss-event-fight', arg: 'normal',
        sub: 'Medium difficulty'
      }))
      widgets.push(U.button('event.fight.elite', ix + bw + 12, by, bw, 52, {
        label: 'FIGHT ELITE', tone: 'danger', align: 'center',
        action: 'boss-event-fight', arg: 'elite',
        disabled: eliteDisabled,
        sub: eliteDisabled ? 'beat one Normal tier first' : 'Hard difficulty'
      }))
    }

    marks.push(U.rule(PAD, 676, CONTENT_W, { alpha: 0.6 }))
    marks.push(U.text(PAD, 700, 'ESC back · fighting a boss spends no tower XP and cannot be resumed',
      { size: 11, colour: C.faint }))

    return {
      screen: 'boss-event',
      backdrop: 'solid',
      marks: marks,
      widgets: widgets,
      // Once a boss is picked, ENTER fights it on Normal.
      defaultId: sel ? 'event.fight.normal' : 'event.card.' + (shown || '')
    }
  }

  function paint (ctx, app) {
    var U = ui()
    if (!U || !U.paint) return 0
    return U.paint(ctx, build(app), { hoverId: OP.Menus ? OP.Menus.state.hoverId : null })
  }

  function activate (app, w) {
    if (!w) return false
    if (w.action === 'boss-event-select') {
      var ms = OP.Menus && OP.Menus.state
      if (ms) ms.bossEventSel = w.arg
      return true
    }
    if (w.action === 'boss-event-fight') {
      var elite = w.arg === 'elite'
      var sel = selection(app)
      if (!sel && OP.BossEvent) sel = OP.BossEvent.summary(app && app.state ? app.state.profile : null).bossKey
      if (sel && app && app.startBossEvent) app.startBossEvent(sel, elite)
      return true
    }
    if (w.action === 'boss-event-back') {
      if (OP.Menus && OP.Menus.go) OP.Menus.go(app, 'title')
      return true
    }
    return false
  }

  EventScreen.build = build
  EventScreen.paint = paint
  EventScreen.activate = activate
  EventScreen.back = function () { return 'title' }

  EventScreen.install = function (app) {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('boss-event', {
        build: build,
        paint: function (ctx, m) {
          var U = ui()
          return U ? U.paint(ctx, m, { hoverId: OP.Menus ? OP.Menus.state.hoverId : null }) : 0
        },
        activate: activate,
        back: function () { return 'title' }
      })
    }
    return EventScreen
  }

  OP.EventScreen = EventScreen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
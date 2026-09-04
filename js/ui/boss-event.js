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

  function tierPips (tiers) {
    var s = ''
    for (var t = 1; t <= 5; t++) s += (tiers >= t) ? '■' : '□'
    return s
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
    marks.push(U.tracked(PAD, 90, 'BOSS EVENT', { size: 30, colour: C.ink, track: 0.2, weight: '600' }))

    if (sum.featured) {
      marks.push(U.text(PAD, 140, 'THIS WEEK: ' + sum.featured.name.toUpperCase(),
        { size: 16, colour: C.gold, weight: '600' }))
      marks.push(U.text(PAD, 164, 'A titan advances every twenty rounds. Kill each tier before it escapes.',
        { size: 11, colour: C.dim }))
      marks.push(U.text(PAD, 182, 'Beating a tier bank of Knowledge Points and a permanent trophy on your rack.',
        { size: 11, colour: C.dim }))
    }
    marks.push(U.rule(PAD, 200, CONTENT_W))

    /* ---- roster cards ---- */
    var cardW = (CONTENT_W - 2 * 20) / 3
    var cardH = 210
    var cardY = 240
    for (var i = 0; i < roster.length; i++) {
      var boss = roster[i]
      var x = PAD + i * (cardW + 20)
      var featured = boss.key === sum.bossKey
      var prog = sum.progress && sum.progress[boss.key] ? sum.progress[boss.key] : { normal: 0, elite: 0 }
      var cardLines = [
        U.clipText(boss.blurb, 10, cardW - 28),
        'NORMAL  ' + tierPips(prog.normal),
        'ELITE   ' + tierPips(prog.elite)
      ]
      if (featured) cardLines[0] = '★ ' + cardLines[0]

      widgets.push(U.card('event.card.' + boss.key, x, cardY, cardW, cardH, {
        label: boss.name,
        lines: cardLines,
        selected: sel === boss.key,
        action: 'boss-event-select', arg: boss.key,
        swatch: boss.colour
      }))
    }

    /* ---- action buttons ---- */
    var by = cardY + cardH + 30
    var normalBtn = U.button('event.fight.normal', PAD + 608, by, 210, 52, {
      label: 'FIGHT NORMAL', tone: 'primary', align: 'center',
      action: 'boss-event-fight', arg: 'normal',
      disabled: !sel,
      sub: sel ? 'Medium boss event' : 'pick a boss first'
    })
    widgets.push(normalBtn)

    var eliteDisabled = !sel || !OP.BossEvent.eliteUnlocked(profile, sel)
    widgets.push(U.button('event.fight.elite', PAD + 608 + 220, by, 210, 52, {
      label: 'FIGHT ELITE', tone: 'danger', align: 'center',
      action: 'boss-event-fight', arg: 'elite',
      disabled: eliteDisabled,
      sub: eliteDisabled
        ? (!sel ? 'pick a boss first' : 'beat one Normal tier to unlock')
        : 'Hard boss event'
    }))

    widgets.push(U.button('event.back', PAD, FIELD_H - 80, 200, 48, {
      label: 'BACK', align: 'center', action: 'boss-event-back'
    }))

    marks.push(U.text(PAD, FIELD_H - 44, 'Fighting a boss spends no tower XP and cannot be resumed.',
      { size: 10, colour: C.faint }))

    return {
      screen: 'boss-event',
      backdrop: 'solid',
      marks: marks,
      widgets: widgets,
      defaultId: sel ? 'event.fight.normal' : 'event.card.' + ((sum.bossKey || roster[0] && roster[0].key) || '')
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
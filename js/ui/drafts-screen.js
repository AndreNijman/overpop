;(function (OP) {
  'use strict'

  /* The Draft Token collection. A read-only inventory screen: every slot the
     player owns, grouped by level, with the total up top. Placement happens
     in the shop during a game — a token is spent where it is used. */

  const Screen = {}
  const PAD = 96
  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus.COLOURS }
  function profileOf (app) { return app && app.state ? app.state.profile : null }

  Screen.build = function (app) {
    const U = ui()
    if (!U) return { screen: 'drafts', backdrop: 'solid', marks: [], widgets: [] }
    const C = colours()
    const profile = profileOf(app) || {}
    const owned = OP.Drafts && OP.Drafts.list ? OP.Drafts.list(profile) : []
    const total = OP.Drafts && OP.Drafts.count ? OP.Drafts.count(profile) : 0
    const marks = []
    const widgets = []

    marks.push(U.tracked(PAD, 84, 'DRAFTS', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 108, 'Collected free placements: each token puts a tower on the board for nothing.', { size: 11, colour: C.dim }))
    marks.push(U.text(FIELD_W - PAD - 118, 84, total + ' TOKEN' + (total === 1 ? '' : 'S'), {
      size: 14, colour: C.gold, align: 'right', weight: '600'
    }))
    widgets.push(U.button('drafts.back', FIELD_W - PAD - 96, 62, 96, 32, {
      label: 'BACK', action: 'back', align: 'center'
    }))
    marks.push(U.rule(PAD, 126, FIELD_W - PAD * 2))

    if (!owned.length) {
      marks.push(U.text(PAD, 170, 'No draft tokens yet.', { size: 13, colour: C.dim }))
      marks.push(U.text(PAD, 192, 'Earn one from every newly-beaten Boss Event tier, an improved Rush Trial best,', { size: 10, colour: C.faint }))
      marks.push(U.text(PAD, 206, 'and any Legends chest that finds the artifact pool exhausted.', { size: 10, colour: C.faint }))
      marks.push(U.text(PAD, 700, 'Owned tokens appear in the shop as free placements.', { size: 10, colour: C.faint }))
      return { screen: 'drafts', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'drafts.back' }
    }

    /* One card per slot: the tower sprite, its name, the level it starts at, and
       the stack size. Layout mirrors the knowledge branches grid — columns of
       cards, left to right, top to bottom. */
    const cardW = 200
    const cardH = 64
    const gapX = 22
    const cols = Math.max(1, Math.floor((FIELD_W - PAD * 2 - gapX) / (cardW + gapX)))
    const y0 = 158
    for (let i = 0; i < owned.length; i++) {
      const slot = owned[i]
      const def = OP.TOWERS ? OP.TOWERS[slot.key] : null
      const x = PAD + (i % cols) * (cardW + gapX)
      const y = y0 + Math.floor(i / cols) * (cardH + 12)
      marks.push(U.box(x, y, cardW, cardH, { fill: C.panel, stroke: C.line }))
      marks.push(U.portrait(x + 30, y + cardH / 2, 20, slot.key, {}))
      const tx = x + 56
      marks.push(U.tracked(tx, y + 20, U.clipText((def && def.name) || slot.key, 11, cardW - 66),
        { size: 11, colour: C.ink, track: 0.12, weight: '600' }))
      marks.push(U.text(tx, y + 38, (def && OP.FAMILY_LABELS && OP.FAMILY_LABELS[def.family]) || '', { size: 8, colour: C.faint }))
      marks.push(U.text(x + cardW - 10, y + 20, 'LEVEL ' + slot.level, { size: 9, colour: C.moss, align: 'right', weight: '600' }))
      marks.push(U.text(x + cardW - 10, y + 38, slot.count === 1 ? '1 token' : slot.count + ' in stack', { size: 9, colour: C.gold, align: 'right' }))
    }

    marks.push(U.text(PAD, 700, 'Find your tokens in the shop during a game — place them free, and pick while you play.', { size: 10, colour: C.faint }))
    return { screen: 'drafts', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'drafts.back' }
  }

  Screen.draw = function (ctx, app) {
    const U = ui()
    if (!U) return 0
    return U.paint(ctx, Screen.build(app), {
      hoverId: OP.Menus && OP.Menus.state ? OP.Menus.state.hoverId : null
    })
  }

  Screen.activate = function (app, w) {
    if (!w) return false
    if (w.id === 'drafts.back' && w.action === 'back') return false // handled centrally
    return false
  }

  Screen.install = function () {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('drafts', {
        build: Screen.build,
        paint: Screen.draw,
        activate: Screen.activate,
        back: function () { return 'title' }
      })
    }
    return Screen
  }

  OP.DraftScreen = Screen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
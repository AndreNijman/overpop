;(function (OP) {
  'use strict'

  /* The Trophy Store. Trophies are banked by play and spent here on cosmetics
     and insta-critter crates. Same shape as the drafts screen: a plain data
     model, paint-only drawing, presses routed through the shell's central tap. */

  const Screen = {}
  const state = { kind: 'trail', notice: '' }
  Screen.state = state

  const PAD = 96
  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus.COLOURS }
  function profileOf (app) { return app && app.state ? app.state.profile : null }

  Screen.build = function (app) {
    const U = ui()
    if (!U) return { screen: 'trophy-store', backdrop: 'solid', marks: [], widgets: [] }
    const C = colours()
    const p = profileOf(app) || {}
    const T = OP.Trophies
    const marks = []
    const widgets = []

    const bank = T ? T.bank(p) : 0
    marks.push(U.tracked(PAD, 84, 'TROPHY STORE', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 108, 'Trophies are earned by winning. Spend them on looks and critters — nothing here changes the game.', { size: 11, colour: C.dim }))
    marks.push(U.text(FIELD_W - PAD - 140, 84, String(bank), { size: 16, colour: C.gold, align: 'right', weight: '700' }))
    if (U.icon) marks.push(U.icon(FIELD_W - PAD - 152, 79, 10, 'trophy', { colour: C.gold }))
    widgets.push(U.button('store.back', FIELD_W - PAD - 96, 62, 96, 32, { label: 'BACK', action: 'back', align: 'center' }))

    /* kind tabs */
    const kinds = ['trail', 'flag', 'badge', 'title', 'insta']
    const tabW = 96
    for (let i = 0; i < kinds.length; i++) {
      widgets.push(U.tab('store.tab.' + kinds[i], PAD + i * (tabW + 6), 140, tabW, 26, {
        label: kinds[i].toUpperCase(), selected: state.kind === kinds[i], action: 'store-kind', arg: kinds[i]
      }))
    }

    const items = OP.trophyItemsOfKind ? OP.trophyItemsOfKind(state.kind) : []
    const rowH = 52
    const y0 = 190
    const owns = T ? T.ownedKeys(p) : []
    for (let i = 0; i < items.length; i++) {
      const def = items[i]
      const y = y0 + i * (rowH + 6)
      if (y + rowH > 660) break
      const owned = T && T.owns(p, def.key)
      const equipped = T ? T.equipped(p, def.kind) === def.key : false
      marks.push(U.box(PAD, y, FIELD_W - PAD * 2, rowH, { fill: C.panel, stroke: equipped ? C.gold : C.line }))
      marks.push(U.tracked(PAD + 14, y + 21, U.clipText(def.name, 13, 420), { size: 13, colour: C.ink, track: 0.1, weight: '600' }))
      marks.push(U.text(PAD + 14, y + 40, U.clipText(def.blurb, 10, 520), { size: 10, colour: C.dim }))
      if (def.colour) {
        marks.push(U.dot(PAD + 560, y + rowH / 2, 8, { fill: def.colour, stroke: C.lineHi }))
      }
      if (owned && def.kind !== 'insta') {
        widgets.push(U.button('store.equip.' + def.key, FIELD_W - PAD - 190, y + 10, 110, 32, {
          label: equipped ? 'EQUIPPED' : 'EQUIP', align: 'center', selected: equipped,
          action: 'store-equip', arg: def.key
        }))
      } else if (owned) {
        marks.push(U.text(FIELD_W - PAD - 14, y + 31, 'OWNED — open it', { size: 10, colour: C.moss, align: 'right' }))
      } else {
        const afford = T && T.bank(p) >= def.cost
        widgets.push(U.button('store.buy.' + def.key, FIELD_W - PAD - 190, y + 10, 110, 32, {
          label: def.cost + ' TROPHY' + (def.cost === 1 ? '' : 'IES'), labelSize: 10, align: 'center',
          tone: afford ? 'primary' : 'ghost', disabled: !T, action: 'store-buy', arg: def.key
        }))
      }
    }

    if (state.notice) marks.push(U.text(FIELD_W - PAD, 700, state.notice, { size: 10, colour: C.warn, align: 'right' }))
    marks.push(U.text(PAD, 700, 'Crates open straight into your critter inventory — place them free from the shop.', { size: 10, colour: C.faint }))

    return { screen: 'trophy-store', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: 'store.back' }
  }

  Screen.draw = function (ctx, app) {
    const U = ui()
    if (!U) return 0
    return U.paint(ctx, Screen.build(app), {
      hoverId: OP.Menus && OP.Menus.state ? OP.Menus.state.hoverId : null
    })
  }

  Screen.activate = function (app, w) {
    const p = profileOf(app)
    const T = OP.Trophies
    if (!p || !T) return false
    if (w.action === 'store-kind') { state.kind = w.arg; state.notice = ''; return true }
    if (w.action === 'store-buy') {
      const res = T.purchase(p, w.arg)
      state.notice = res.ok ? '' : res.reason
      return true
    }
    if (w.action === 'store-equip') {
      const def = OP.trophyByKey ? OP.trophyByKey(w.arg) : null
      const equipped = T.equipped(p, def.kind) === w.arg
      const res = T.equip(p, def.kind, equipped ? '' : w.arg)
      state.notice = res.ok ? '' : res.reason
      return true
    }
    return false
  }

  Screen.install = function () {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('trophy-store', {
        build: Screen.build,
        paint: Screen.draw,
        activate: Screen.activate,
        back: function () { return 'title' }
      })
    }
    return Screen
  }

  OP.TrophyScreen = Screen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

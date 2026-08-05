;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     BESTIARY — the game explaining its own type chart.

     Three tabs:

       BALLOONS    every tier, with its computed RBE, speed, children, and — the
                   reason this screen exists — its immunities, stated loudly.
       TYPE CHART  the whole tier x damage-type matrix in one grid. A player who
                   has been told "black ignores explosive" three times still
                   benefits from seeing all of it at once, and an author gets a
                   free proof that the table in ARCHITECTURE.md §3 is what shipped.
       TOWERS      every tower with its blurb, base stats and three upgrade
                   branches.

     Nothing here is authored twice. RBE comes from OP.balloonRBE, immunity comes
     from OP.canDamage, damage-type labels come from OP.DMG_META. A bestiary that
     restated any of them would be a second source of truth that silently rots.

     It reuses the widget layer from js/ui/menus.js — one hit-testing model for
     every canvas screen — and registers itself as a menu screen rather than
     menus.js knowing it exists.
     ============================================================================ */

  const Bestiary = {}

  const PAD = 96
  const FIELD_W = OP.FIELD_W
  const CONTENT_W = FIELD_W - PAD * 2

  const TABS = [
    { key: 'balloons', label: 'BALLOONS' },
    { key: 'chart', label: 'TYPE CHART' },
    { key: 'towers', label: 'TOWERS' }
  ]

  Bestiary.state = {
    tab: 'balloons',
    tierKey: null,
    towerKey: null
  }
  const state = Bestiary.state

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () {
    return (OP.Menus && OP.Menus.COLOURS) || {
      bg: '#0e1410', deep: '#070a08', panel: '#141c17', panelHi: '#1d2720', panelSel: '#22301f',
      line: '#2a352c', lineHi: '#3c4c3f', ink: '#e8efe6', dim: '#94a595', faint: '#5d6d5f',
      moss: '#6fae7f', mossDeep: '#3f6b4c', gold: '#c9a227', warn: '#e0b64a', bad: '#d0604f'
    }
  }

  /* ---------- registry readers, all tolerant of an empty registry ---------- */

  function tiers () { return Array.isArray(OP.BALLOON_TIERS) ? OP.BALLOON_TIERS : [] }

  function towers () {
    const out = []
    const order = Array.isArray(OP.TOWER_ORDER) ? OP.TOWER_ORDER : []
    for (let i = 0; i < order.length; i++) {
      const def = OP.TOWERS ? OP.TOWERS[order[i]] : null
      if (def && def.key) out.push(def)
    }
    return out
  }

  function dmgOrder () {
    return Array.isArray(OP.DMG_ORDER) ? OP.DMG_ORDER : []
  }

  function dmgLabel (key) {
    const meta = OP.DMG_META && OP.DMG_META[key]
    return (meta && meta.label) || String(key)
  }

  function dmgTint (key) {
    const meta = OP.DMG_META && OP.DMG_META[key]
    return (meta && meta.tint) || colours().dim
  }

  /* Selection is re-resolved from the live registry on every build. Holding a key
     and dereferencing it is what makes a screen throw the moment a registry is
     empty or renamed — and during the content build both happen. */

  function resolveTier () {
    const list = tiers()
    if (!list.length) { state.tierKey = null; return null }
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].key === state.tierKey) return list[i]
    state.tierKey = list[0].key
    return list[0]
  }

  function resolveTower () {
    const list = towers()
    if (!list.length) { state.towerKey = null; return null }
    for (let i = 0; i < list.length; i++) if (list[i].key === state.towerKey) return list[i]
    state.towerKey = list[0].key
    return list[0]
  }

  function rbeOf (key) {
    if (typeof OP.balloonRBE !== 'function') return null
    try { return OP.balloonRBE(key) } catch (e) { return null }
  }

  function immuneList (tier) {
    const out = []
    const types = dmgOrder()
    if (!tier) return out
    for (let i = 0; i < types.length; i++) {
      if (!canHurt(tier, types[i])) out.push(types[i])
    }
    return out
  }

  function canHurt (tier, dmgType) {
    if (typeof OP.canDamage === 'function' && tier && tier.key) {
      try { return !!OP.canDamage(tier.key, dmgType) } catch (e) { /* fall through */ }
    }
    return !(tier && tier.immuneSet && tier.immuneSet[dmgType])
  }
  Bestiary.canHurt = canHurt

  function propNames (props) {
    const out = []
    if (!props || !OP.PROP) return out
    if (props & OP.PROP.VEILED) out.push('VEILED')
    if (props & OP.PROP.REGEN) out.push('REGEN')
    if (props & OP.PROP.PLATED) out.push('PLATED')
    return out
  }

  /* ---------- shared chrome ---------- */

  function chrome (marks, widgets, sub) {
    const U = ui(); const C = colours()
    marks.push(U.tracked(PAD, 92, 'BESTIARY', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 114, sub, { size: 11, colour: C.dim }))
    marks.push(U.rule(PAD, 130, CONTENT_W))
    widgets.push(U.button('bestiary.back', FIELD_W - PAD - 96, 74, 96, 32, {
      label: 'BACK', action: 'back', align: 'center'
    }))
    for (let i = 0; i < TABS.length; i++) {
      widgets.push(U.tab('bestiary.tab.' + TABS[i].key, PAD + i * 150, 142, 150, 34, {
        label: TABS[i].label, selected: state.tab === TABS[i].key, action: 'bestiary-tab', arg: TABS[i].key
      }))
    }
    marks.push(U.rule(PAD, 700 - 24, CONTENT_W, { alpha: 0.6 }))
  }

  /** A scrolling-free list: rows shrink to fit rather than running off the page. */
  function listRows (n, top, bottom, max) {
    if (n <= 0) return 0
    return M.clamp(Math.floor((bottom - top) / n), 14, max || 26)
  }

  /* ============================================================================
     BALLOONS
     ============================================================================ */

  function buildBalloons (app) {
    const U = ui(); const C = colours()
    const marks = []
    const widgets = []
    const list = tiers()
    const sel = resolveTier()

    chrome(marks, widgets, list.length + ' tiers · every immunity in the game')

    if (!list.length) {
      marks.push(U.text(PAD, 300, 'No balloon tiers are registered.', { size: 18, colour: C.dim }))
      marks.push(U.text(PAD, 328, 'js/data/balloons.js declares the ladder; this screen reads it.', { size: 11, colour: C.faint }))
      return model(marks, widgets, 'bestiary.back')
    }

    /* ----- the ladder ----- */
    const lx = PAD, lw = 290, top = 200, bottom = 656
    const rowH = listRows(list.length, top, bottom, 26)
    marks.push(U.text(lx, top - 10, 'WEAKEST FIRST', { size: 9, colour: C.faint }))
    for (let i = 0; i < list.length; i++) {
      const tier = list[i]
      const rbe = rbeOf(tier.key)
      widgets.push(U.row('bestiary.tier.' + tier.key, lx, top + i * rowH, lw, rowH - 2, {
        label: tier.name || tier.key,
        swatch: tier.colour || C.moss,
        note: rbe === null ? '' : 'RBE ' + rbe,
        selected: !!sel && tier.key === sel.key,
        action: 'bestiary-tier',
        arg: tier.key
      }))
    }

    /* ----- the detail ----- */
    const dx = 418
    const dw = FIELD_W - PAD - dx
    if (!sel) return model(marks, widgets, 'bestiary.back')

    marks.push(U.balloon(dx + 26, 224, sel.blimp ? 20 : Math.max(8, sel.radius || 8), sel))
    marks.push(U.tracked(dx + 62, 232, (sel.name || sel.key).toUpperCase(), { size: 24, colour: C.ink, track: 0.16, weight: '600' }))
    const kind = (sel.blimp ? 'BLIMP CLASS' : 'BALLOON') +
      (propNames(sel.props).length ? ' · BORN ' + propNames(sel.props).join(' + ') : '') +
      (sel.abilityImmune ? ' · ABILITY-IMMUNE' : '')
    marks.push(U.text(dx + 62, 250, kind, { size: 10, colour: C.moss }))

    const blurb = U.wrapText(sel.blurb, 11, dw - 20, 2)
    for (let i = 0; i < blurb.length; i++) {
      marks.push(U.text(dx, 282 + i * 16, blurb[i], { size: 11, colour: C.dim }))
    }

    const rbe = rbeOf(sel.key)
    const speed = (sel.speed || 0) * (OP.BASE_SPEED || 46)
    const stats = [
      ['RBE', rbe === null ? '?' : String(rbe)],
      ['LAYER HP', String(sel.hp === undefined ? '?' : sel.hp)],
      ['SPEED', '×' + (sel.speed === undefined ? '?' : sel.speed)],
      ['UNITS/SEC', String(Math.round(speed))],
      ['CASH', '$' + (sel.cash === undefined ? '?' : sel.cash)]
    ]
    marks.push(U.rule(dx, 326, dw, { alpha: 0.6 }))
    for (let i = 0; i < stats.length; i++) {
      const cx = dx + i * Math.floor(dw / stats.length)
      marks.push(U.text(cx, 346, stats[i][0], { size: 9, colour: C.faint }))
      marks.push(U.text(cx, 368, stats[i][1], { size: 16, colour: C.ink, weight: '600' }))
    }

    /* ----- immunities, given the space they deserve ----- */
    const imm = immuneList(sel)
    marks.push(U.tracked(dx, 414, 'IGNORES', { size: 11, colour: imm.length ? C.bad : C.moss, track: 0.3 }))
    if (!imm.length) {
      marks.push(U.text(dx + 110, 414, 'nothing — every damage type gets through', { size: 12, colour: C.moss }))
    } else {
      let cx = dx + 110
      for (let i = 0; i < imm.length; i++) {
        const chip = U.chip(cx, 400, dmgLabel(imm[i]).toUpperCase(), { size: 11, h: 24, tint: C.bad })
        marks.push(chip)
        cx += chip.w + 8
      }
    }

    const works = dmgOrder().filter(function (d) { return canHurt(sel, d) })
    marks.push(U.tracked(dx, 452, 'WORKS', { size: 11, colour: C.moss, track: 0.3 }))
    let wx = dx + 110
    for (let i = 0; i < works.length; i++) {
      const chip = U.chip(wx, 440, dmgLabel(works[i]).toUpperCase(), { size: 9, h: 20, tint: dmgTint(works[i]), filled: false })
      marks.push(chip)
      wx += chip.w + 6
      if (wx > FIELD_W - PAD - 90) { wx = dx + 110; marks.push(U.text(0, 0, '', {})) }
    }

    /* ----- what it becomes ----- */
    marks.push(U.rule(dx, 486, dw, { alpha: 0.6 }))
    marks.push(U.tracked(dx, 510, 'SPLITS INTO', { size: 11, colour: C.moss, track: 0.3 }))
    const kids = Array.isArray(sel.children) ? sel.children : []
    if (!kids.length) {
      marks.push(U.text(dx, 540, 'Nothing. One layer and it is gone.', { size: 12, colour: C.dim }))
    } else {
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i]
        const ct = childTier(child.tier)
        const y = 534 + i * 30
        marks.push(U.balloon(dx + 12, y - 4, 8, ct || {}))
        const childRbe = rbeOf(child.tier)
        marks.push(U.text(dx + 30, y, '×' + child.count + '  ' + ((ct && ct.name) || child.tier) +
          (childRbe === null ? '' : '   (RBE ' + childRbe + ' each)'), { size: 12, colour: C.ink }))
      }
      marks.push(U.text(dx, 534 + kids.length * 30 + 16,
        'Damage stops at a split: excess is discarded, never carried into the children.',
        { size: 10, colour: C.faint }))
    }

    marks.push(U.text(PAD, 700, 'ESC back · pick a tier on the left', { size: 10, colour: C.faint }))
    return model(marks, widgets, 'bestiary.back')
  }

  function childTier (key) {
    const list = tiers()
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return list[i]
    return null
  }

  /* ============================================================================
     TYPE CHART
     ============================================================================ */

  function buildChart (app) {
    const U = ui(); const C = colours()
    const marks = []
    const widgets = []
    const list = tiers()
    const types = dmgOrder()

    chrome(marks, widgets, 'which damage type does nothing to what')

    if (!list.length || !types.length) {
      marks.push(U.text(PAD, 300, 'Nothing to chart yet.', { size: 18, colour: C.dim }))
      marks.push(U.text(PAD, 328, 'The chart is generated from the tier roster and OP.canDamage.', { size: 11, colour: C.faint }))
      return model(marks, widgets, 'bestiary.back')
    }

    const labelW = 150
    const gridX = PAD + labelW
    const colW = Math.floor((CONTENT_W - labelW) / types.length)
    const top = 220
    const rowH = listRows(list.length, top, 650, 24)

    for (let c = 0; c < types.length; c++) {
      marks.push(U.text(gridX + c * colW + colW / 2, top - 12, dmgLabel(types[c]).toUpperCase(),
        { size: 8, colour: dmgTint(types[c]), align: 'center' }))
    }
    marks.push(U.rule(PAD, top - 6, CONTENT_W, { alpha: 0.7 }))

    for (let r = 0; r < list.length; r++) {
      const tier = list[r]
      const y = top + r * rowH
      if (r % 2 === 1) marks.push(U.box(PAD, y, CONTENT_W, rowH, { fill: C.panel, alpha: 0.5 }))
      marks.push(U.box(PAD + 6, y + rowH / 2 - 4, 8, 8, { fill: tier.colour || C.moss }))
      marks.push(U.text(PAD + 22, y + rowH / 2 + 4, U.clipText(tier.name || tier.key, 11, labelW - 30),
        { size: 11, colour: tier.blimp ? C.gold : C.ink }))
      for (let c = 0; c < types.length; c++) {
        const cx = gridX + c * colW + colW / 2
        if (canHurt(tier, types[c])) {
          marks.push(U.text(cx, y + rowH / 2 + 3, '·', { size: 12, colour: C.faint, align: 'center' }))
        } else {
          marks.push(U.box(cx - 9, y + rowH / 2 - 8, 18, 16, { fill: C.bad, alpha: 0.22 }))
          marks.push(U.text(cx, y + rowH / 2 + 4, '×', { size: 12, colour: C.bad, align: 'center' }))
        }
      }
    }

    marks.push(U.text(PAD, 690, '×  immune — that damage does nothing at all.   ·  vulnerable.', { size: 10, colour: C.dim }))
    marks.push(U.text(PAD, 706, 'No tier resists SHATTER; VOID ignores every immunity there is.', { size: 10, colour: C.faint }))
    return model(marks, widgets, 'bestiary.back')
  }

  /* ============================================================================
     TOWERS
     ============================================================================ */

  function buildTowers (app) {
    const U = ui(); const C = colours()
    const marks = []
    const widgets = []
    const list = towers()
    const sel = resolveTower()

    chrome(marks, widgets, list.length + (list.length === 1 ? ' tower' : ' towers') + ' · three branches each, at most one past tier 2')

    if (!list.length) {
      marks.push(U.text(PAD, 300, 'No towers are registered yet.', { size: 18, colour: C.dim }))
      marks.push(U.text(PAD, 328, 'Each js/towers/*.js file registers its family; this screen reads the registry.', { size: 11, colour: C.faint }))
      return model(marks, widgets, 'bestiary.back')
    }

    const lx = PAD, lw = 290, top = 200, bottom = 656
    const rowH = listRows(list.length, top, bottom, 24)
    for (let i = 0; i < list.length; i++) {
      const def = list[i]
      widgets.push(U.row('bestiary.tower.' + def.key, lx, top + i * rowH, lw, rowH - 2, {
        label: def.name || def.key,
        note: '$' + (def.cost === undefined ? '?' : def.cost),
        selected: !!sel && def.key === sel.key,
        action: 'bestiary-tower',
        arg: def.key
      }))
    }

    const dx = 418
    const dw = FIELD_W - PAD - dx
    if (!sel) return model(marks, widgets, 'bestiary.back')

    const famLabel = (OP.FAMILY_LABELS && OP.FAMILY_LABELS[sel.family]) || sel.family || '—'
    marks.push(U.tracked(dx, 232, (sel.name || sel.key).toUpperCase(), { size: 22, colour: C.ink, track: 0.16, weight: '600' }))
    marks.push(U.text(dx, 252, String(famLabel).toUpperCase() + ' · $' + (sel.cost === undefined ? '?' : sel.cost) +
      ' · ' + (sel.placement || 'land') + (sel.unlockRound ? ' · unlocks round ' + sel.unlockRound : ''),
      { size: 10, colour: C.moss }))

    const blurb = U.wrapText(sel.blurb, 11, dw - 20, 3)
    for (let i = 0; i < blurb.length; i++) {
      marks.push(U.text(dx, 282 + i * 16, blurb[i], { size: 11, colour: C.dim }))
    }

    const base = sel.base || {}
    const stats = [
      ['DAMAGE', String(base.damage === undefined ? '?' : base.damage)],
      ['TYPE', dmgLabel(base.dmgType).toUpperCase()],
      ['PIERCE', String(base.pierce === undefined ? '?' : base.pierce)],
      ['RANGE', String(base.range === undefined ? '?' : Math.round(base.range))],
      ['EVERY', (base.cooldown === undefined ? '?' : base.cooldown) + 's'],
      ['SEES VEILED', base.camoDetect ? 'yes' : 'no']
    ]
    marks.push(U.rule(dx, 340, dw, { alpha: 0.6 }))
    for (let i = 0; i < stats.length; i++) {
      const cx = dx + i * Math.floor(dw / stats.length)
      marks.push(U.text(cx, 360, stats[i][0], { size: 9, colour: C.faint }))
      marks.push(U.text(cx, 382, stats[i][1], { size: 14, colour: C.ink, weight: '600' }))
    }

    /* ----- the three branches ----- */
    const paths = Array.isArray(sel.paths) ? sel.paths : []
    if (!paths.length) {
      marks.push(U.text(dx, 430, 'No upgrade branches declared.', { size: 12, colour: C.warn }))
      return model(marks, widgets, 'bestiary.back')
    }
    const colW = Math.floor(dw / Math.max(1, paths.length))
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p] || {}
      const cx = dx + p * colW
      marks.push(U.tracked(cx, 424, String(path.name || 'PATH ' + (p + 1)).toUpperCase(), { size: 10, colour: C.moss, track: 0.24 }))
      marks.push(U.rule(cx, 434, colW - 16, { alpha: 0.6 }))
      const ups = Array.isArray(path.tiers) ? path.tiers : []
      for (let i = 0; i < ups.length; i++) {
        const up = ups[i] || {}
        const y = 456 + i * 44
        marks.push(U.text(cx, y, String(i + 1), { size: 9, colour: C.faint }))
        marks.push(U.text(cx + 14, y, U.clipText(up.name || '—', 11, colW - 76), { size: 11, colour: C.ink }))
        marks.push(U.text(cx + colW - 20, y, '$' + (up.cost === undefined ? '?' : up.cost), { size: 10, colour: C.gold, align: 'right' }))
        const desc = U.wrapText(up.desc, 9, colW - 32, 2)
        for (let d = 0; d < desc.length; d++) {
          marks.push(U.text(cx + 14, y + 13 + d * 11, desc[d], { size: 9, colour: C.faint }))
        }
      }
    }

    marks.push(U.text(PAD, 700, 'ESC back · at most one branch past tier 2, at most two branches touched', { size: 10, colour: C.faint }))
    return model(marks, widgets, 'bestiary.back')
  }

  /* ============================================================================
     SCREEN PLUMBING
     ============================================================================ */

  function model (marks, widgets, defaultId) {
    return { screen: 'bestiary', backdrop: 'solid', marks: marks, widgets: widgets, defaultId: defaultId }
  }

  /** The model for the active tab. Pure — safe to call from a draw. */
  Bestiary.build = function (app) {
    if (!ui()) return { screen: 'bestiary', backdrop: 'solid', marks: [], widgets: [] }
    if (state.tab === 'chart') return buildChart(app)
    if (state.tab === 'towers') return buildTowers(app)
    state.tab = 'balloons'
    return buildBalloons(app)
  }

  Bestiary.draw = function (ctx, app) {
    const U = ui()
    if (!U) return 0
    return U.paint(ctx, Bestiary.build(app), {
      hoverId: OP.Menus && OP.Menus.state ? OP.Menus.state.hoverId : null
    })
  }

  Bestiary.activate = function (app, w) {
    if (!w) return false
    if (w.action === 'bestiary-tab') { state.tab = w.arg; return true }
    if (w.action === 'bestiary-tier') { state.tierKey = w.arg; return true }
    if (w.action === 'bestiary-tower') { state.towerKey = w.arg; return true }
    return false
  }

  /** Left/right cycle the tabs, up/down the selected entry. */
  Bestiary.key = function (app, key) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const i = indexOfTab(state.tab)
      const n = TABS.length
      state.tab = TABS[(i + (key === 'ArrowRight' ? 1 : n - 1)) % n].key
      return true
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const step = key === 'ArrowDown' ? 1 : -1
      if (state.tab === 'towers') {
        const list = towers()
        if (!list.length) return true
        const cur = Math.max(0, indexOfKey(list, state.towerKey))
        state.towerKey = list[(cur + step + list.length) % list.length].key
      } else {
        const list = tiers()
        if (!list.length) return true
        const cur = Math.max(0, indexOfKey(list, state.tierKey))
        state.tierKey = list[(cur + step + list.length) % list.length].key
      }
      return true
    }
    return false
  }

  function indexOfTab (key) {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].key === key) return i
    return 0
  }

  function indexOfKey (list, key) {
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return i
    return -1
  }

  Bestiary.install = function (app) {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('bestiary', {
        build: Bestiary.build,
        paint: function (ctx, m) {
          const U = ui()
          return U ? U.paint(ctx, m, { hoverId: OP.Menus.state.hoverId }) : 0
        },
        activate: Bestiary.activate,
        key: Bestiary.key,
        back: function () { return 'title' }
      })
    }
    return Bestiary
  }

  OP.Bestiary = Bestiary
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

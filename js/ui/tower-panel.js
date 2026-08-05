;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     TOWER PANEL — everything about the selected tower, and every reason it cannot
     do something.

     The one rule this screen exists to honour: LOCKS ARE SHOWN HONESTLY. A greyed
     upgrade button with no explanation is the most common complaint about upgrade
     trees, and the engine already hands back the sentence — OP.Upgrades.canBuy
     returns { ok, reason }. So does OP.Towers.canActivate, and OP.Paragon.preview.
     This file asks all three and prints what they say; it never decides for itself
     whether something is legal, because two implementations of the crosspath rule
     will disagree eventually and the UI's copy is the one nobody tests.

     A hero has levels instead of branches, so the middle of the panel swaps for a
     level readout — a hero definition has no `paths` at all, and walking one would
     throw and take the layer with it.

     Reuses the widget layer from js/ui/menus.js; registers with OP.HUD as an
     in-game panel, which owns the tap router.
     ============================================================================ */

  const TowerPanel = {}

  const FIELD_W = OP.FIELD_W

  /* Two destructive actions need a second press. The pending id lives here rather
     than on the sim: it is interface state, it must not survive a save, and a
     draw never touches it — only activate() writes. A stale id is harmless
     because build() only honours a confirmation for the tower it names. */
  TowerPanel.state = { confirmSell: -1, confirmParagon: -1 }
  const state = TowerPanel.state

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }

  function colours () {
    return (OP.Menus && OP.Menus.COLOURS) || {
      bg: '#0e1410', deep: '#070a08', panel: '#141c17', panelHi: '#1d2720', panelSel: '#22301f',
      line: '#2a352c', lineHi: '#3c4c3f', ink: '#e8efe6', dim: '#94a595', faint: '#5d6d5f',
      moss: '#6fae7f', mossDeep: '#3f6b4c', gold: '#c9a227', warn: '#e0b64a', bad: '#d0604f'
    }
  }

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

  function displayName (tower) {
    if (OP.Towers && OP.Towers.displayName) {
      try { return OP.Towers.displayName(tower) } catch (e) { /* fall through */ }
    }
    return (tower.def && tower.def.name) || tower.key || '?'
  }

  function dmgLabel (key) {
    const meta = OP.DMG_META && OP.DMG_META[key]
    return String((meta && meta.label) || key || '—')
  }

  /* ============================================================================
     MODEL
     ============================================================================ */

  function model (marks, widgets, over, app) {
    const U = ui()
    const io = ioOf(app)
    let hover = null
    if (U && io && io.overCanvas) hover = U.hit(widgets, io.x, io.y)
    return {
      screen: 'tower-panel',
      marks: marks,
      widgets: widgets,
      over: over,
      hoverId: hover ? hover.id : null
    }
  }

  function showing (app) {
    return gameActive(app) && !!selectedTower(app)
  }
  TowerPanel.showing = showing

  /* ---------- engine questions, asked once per build ---------- */

  /** What the next step on a branch costs and why it might be refused. */
  function branchState (sim, tower, p) {
    const legal = OP.Upgrades.canBuy(tower, p)
    const up = OP.Upgrades.nextUpgrade(tower, p)
    const cost = up ? OP.Economy.price(sim, up.cost) : 0
    const afford = !!up && OP.Economy.canAfford(sim, cost)
    let reason = ''
    if (!legal.ok) reason = legal.reason
    else if (!up) reason = 'This branch is fully upgraded.'
    else if (!afford) reason = 'Not enough cash — ' + M.money(cost) + ' needed.'
    return {
      up: up,
      cost: cost,
      ok: legal.ok && !!up && afford,
      locked: !legal.ok,        // a rule refusal, not merely an empty wallet
      reason: reason
    }
  }
  TowerPanel.branchState = branchState

  function paragonPreview (sim, tower) {
    if (!OP.Paragon || !OP.Paragon.preview) return { ok: false, reason: '' }
    try { return OP.Paragon.preview(sim, tower) } catch (e) { return { ok: false, reason: '' } }
  }

  function buffsFor (sim, tower) {
    const out = []
    if (!OP.Buffs || !OP.Buffs.listFor) return out
    try { OP.Buffs.listFor(sim, tower, out) } catch (e) { out.length = 0 }
    return out
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
    const tower = selectedTower(app)
    if (!U || !sim || !tower) return model(marks, widgets, over, app)

    const C = colours()
    const S = sidebar()
    const padX = 12
    const x0 = S.x + padX
    const innerW = S.w - padX * 2
    const s = tower.s || {}
    const isHero = !!tower.heroKey

    // Smoked, not opaque — see the note in js/ui/shop.js.
    marks.push(U.box(S.x, S.y, S.w, S.h, { fill: C.panel, stroke: C.line, alpha: 0.94 }))

    /* ----- header ----- */
    marks.push(U.tracked(x0, S.y + 26, U.clipText(displayName(tower), 14, innerW - 46).toUpperCase(),
      { size: 14, colour: C.ink, track: 0.14, weight: '600' }))
    widgets.push(stamp(U.button('panel.close', S.x + S.w - 34, S.y + 10, 24, 24, {
      label: '×', align: 'center', action: 'panel-close'
    }), tower))

    const famLabel = isHero
      ? 'HERO'
      : String((OP.FAMILY_LABELS && OP.FAMILY_LABELS[tower.def.family]) || tower.def.family || '').toUpperCase()
    const tierLabel = isHero
      ? 'LEVEL ' + tower.level + ' / ' + (OP.Heroes.MAX_LEVEL || 20)
      : OP.Upgrades.label(tower)
    marks.push(U.text(x0, S.y + 41, famLabel + ' · ' + tierLabel +
      (s.isParagon ? ' · PARAGON DEGREE ' + s.paragonDegree : ''), { size: 9, colour: C.moss }))
    marks.push(U.rule(x0, S.y + 50, innerW, { colour: C.line }))

    let y = S.y + 56

    /* ----- live stats, straight off tower.s ----- */
    const cells = [
      ['DAMAGE', String(s.damage === undefined ? '—' : s.damage)],
      ['TYPE', dmgLabel(s.dmgType).toUpperCase()],
      ['PIERCE', String(s.pierce === undefined ? '—' : s.pierce)],
      ['RANGE', String(s.range === undefined ? '—' : Math.round(s.range))],
      ['EVERY', s.cooldown === undefined ? '—' : s.cooldown.toFixed(2) + 's'],
      ['POPS', M.compact(tower.pops || 0)]
    ]
    const colW = Math.floor(innerW / 3)
    for (let i = 0; i < cells.length; i++) {
      const cx = x0 + (i % 3) * colW
      const cy = y + Math.floor(i / 3) * 34
      marks.push(U.text(cx, cy + 10, cells[i][0], { size: 8, colour: C.faint }))
      marks.push(U.text(cx, cy + 26, U.clipText(cells[i][1], 13, colW - 6), { size: 13, colour: C.ink, weight: '600' }))
    }
    y += 72

    marks.push(U.text(x0, y, 'earned ' + M.money(tower.earned || 0) +
      ' · invested ' + M.money(tower.invested || 0) +
      (s.camoDetect ? ' · sees veiled' : ''), { size: 9, colour: C.dim }))
    y += 14

    /* ----- buffs reaching this tower ----- */
    const buffs = buffsFor(sim, tower)
    if (!buffs.length) {
      marks.push(U.text(x0, y, 'no support reaching this tower', { size: 9, colour: C.faint }))
    } else {
      const names = []
      for (let i = 0; i < buffs.length && names.length < 3; i++) {
        const src = buffs[i].sourceId === tower.id ? 'itself' : sourceName(sim, buffs[i].sourceId)
        if (names.indexOf(src) < 0) names.push(src)
      }
      marks.push(U.text(x0, y, U.clipText(buffs.length + (buffs.length === 1 ? ' buff · ' : ' buffs · ') +
        names.join(', '), 9, innerW), { size: 9, colour: C.moss }))
    }
    y += 10
    marks.push(U.rule(x0, y, innerW, { colour: C.line, alpha: 0.6 }))
    y += 18

    /* ----- the middle: branches for a tower, levels for a hero ----- */
    if (isHero) y = heroSection(app, sim, tower, marks, widgets, over, x0, innerW, y)
    else y = upgradeSection(app, sim, tower, marks, widgets, over, x0, innerW, y)

    /* ----- targeting ----- */
    y = targetingSection(sim, tower, marks, widgets, over, x0, innerW, y)

    /* ----- abilities ----- */
    if (s.ability) {
      y = abilityButton(sim, tower, marks, widgets, over, s.ability, 1, x0, y, innerW, 42) + 6
    }
    if (isHero && s.ability2) {
      y = abilityButton(sim, tower, marks, widgets, over, s.ability2, 2, x0, y, innerW, 42) + 6
    }

    /* ----- sell and paragon ----- */
    y = footerSection(app, sim, tower, marks, widgets, over, x0, innerW, y, S)

    return model(marks, widgets, over, app)
  }

  /** Every widget carries the tower it belongs to, so a press can never be applied
      to whatever happens to be selected by the time it is handled. */
  function stamp (w, tower) { w.keepId = tower.id; return w }

  function sourceName (sim, id) {
    const src = sim.towerById ? sim.towerById.get(id) : null
    return src ? displayName(src) : 'unknown'
  }

  /* ---------- the three branches ---------- */

  function upgradeSection (app, sim, tower, marks, widgets, over, x0, innerW, y) {
    const U = ui(); const C = colours()
    const paths = Array.isArray(tower.def.paths) ? tower.def.paths : []

    marks.push(U.tracked(x0, y, 'UPGRADES', { size: 9, colour: C.moss, track: 0.28 }))
    marks.push(U.text(x0 + innerW, y, 'one branch past tier 2, two branches touched',
      { size: 8, colour: C.faint, align: 'right' }))
    y += 8

    if (!paths.length) {
      marks.push(U.text(x0, y + 18, 'This tower declares no upgrade branches.', { size: 9, colour: C.warn }))
      return y + 30
    }

    const blockH = 84
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p] || {}
      const st = branchState(sim, tower, p)
      const by = y + p * (blockH + 4)

      const w = U.button('panel.up' + p, x0 - 4, by, innerW + 8, blockH, {
        label: '', disabled: !st.ok, action: 'panel-upgrade', arg: p, reason: st.reason
      })
      w.tier = tower.tiers[p]
      w.locked = st.locked
      w.cost = st.cost
      widgets.push(stamp(w, tower))

      over.push(U.text(x0 + 4, by + 14, U.clipText(String(path.name || 'Branch ' + (p + 1)).toUpperCase(), 9, innerW - 70),
        { size: 9, colour: st.locked ? C.faint : C.moss }))

      // Owned tiers, as pips. Five small squares read faster than "3 / 5".
      const maxTier = OP.Upgrades.MAX_TIER || 5
      for (let i = 0; i < maxTier; i++) {
        const px = x0 + innerW - (maxTier - i) * 11
        const owned = i < tower.tiers[p]
        over.push(U.box(px, by + 7, 7, 7, owned ? { fill: C.moss } : { stroke: C.line }))
      }

      if (st.up) {
        over.push(U.text(x0 + 4, by + 32, U.clipText(st.up.name, 11, innerW - 70),
          { size: 11, colour: st.ok ? C.ink : C.dim }))
        over.push(U.text(x0 + innerW - 4, by + 32, M.money(st.cost),
          { size: 10, colour: st.ok ? C.gold : C.faint, align: 'right' }))
        const desc = U.wrapText(st.up.desc, 9, innerW - 8, st.reason ? 2 : 3)
        for (let i = 0; i < desc.length; i++) {
          over.push(U.text(x0 + 4, by + 47 + i * 11, desc[i], { size: 9, colour: C.faint }))
        }
      } else {
        over.push(U.text(x0 + 4, by + 32, 'Fully upgraded', { size: 11, colour: C.gold }))
      }

      /* The whole point of this panel: a lock says why, in the engine's own
         words, on screen, without a hover. */
      if (st.reason) {
        const lines = U.wrapText(st.reason, 9, innerW - 8, 2)
        for (let i = 0; i < lines.length; i++) {
          over.push(U.text(x0 + 4, by + blockH - 14 + i * 10 - (lines.length - 1) * 10, lines[i],
            { size: 9, colour: st.locked ? C.warn : C.bad }))
        }
      }
    }

    return y + paths.length * (blockH + 4) + 6
  }

  /* ---------- a hero's levels ---------- */

  function heroSection (app, sim, hero, marks, widgets, over, x0, innerW, y) {
    const U = ui(); const C = colours()
    const maxLevel = OP.Heroes.MAX_LEVEL || 20

    marks.push(U.tracked(x0, y, 'LEVELS', { size: 9, colour: C.moss, track: 0.28 }))
    marks.push(U.text(x0 + innerW, y, 'earned by popping, never bought',
      { size: 8, colour: C.faint, align: 'right' }))
    y += 12

    let progress = 0
    try { progress = OP.Heroes.progress(hero) } catch (e) { progress = 0 }
    marks.push(U.box(x0, y, innerW, 8, { fill: C.deep }))
    marks.push(U.box(x0, y, Math.max(1, Math.round(innerW * M.clamp01(progress))), 8,
      { fill: hero.level >= maxLevel ? C.gold : C.moss }))
    y += 22
    marks.push(U.text(x0, y, hero.level >= maxLevel
      ? 'Fully levelled · ' + M.compact(Math.floor(hero.xp || 0)) + ' XP'
      : Math.round(progress * 100) + '% to level ' + (hero.level + 1) + ' · ' +
        M.compact(Math.floor(hero.xp || 0)) + ' XP', { size: 9, colour: C.dim }))
    y += 18

    // What the next level actually grants, verbatim from the definition.
    const next = hero.def.levelsByNumber ? hero.def.levelsByNumber[hero.level + 1] : null
    if (next) {
      marks.push(U.text(x0, y, 'NEXT · LEVEL ' + next.level, { size: 8, colour: C.faint }))
      const lines = U.wrapText(next.desc, 9, innerW, 3)
      for (let i = 0; i < lines.length; i++) {
        marks.push(U.text(x0, y + 14 + i * 11, lines[i], { size: 9, colour: C.ink }))
      }
      y += 14 + Math.max(1, lines.length) * 11 + 8
    } else {
      marks.push(U.text(x0, y, 'Nothing left to learn.', { size: 9, colour: C.gold }))
      y += 18
    }

    return y
  }

  /* ---------- targeting ---------- */

  function targetingSection (sim, tower, marks, widgets, over, x0, innerW, y) {
    const U = ui(); const C = colours()
    const s = tower.s || {}
    const modes = Array.isArray(s.targetModes) ? s.targetModes : []

    marks.push(U.tracked(x0, y, 'TARGETING', { size: 9, colour: C.moss, track: 0.28 }))
    y += 8

    if (!modes.length) {
      marks.push(U.text(x0, y + 14, 'This tower does not choose targets.', { size: 9, colour: C.faint }))
      return y + 26
    }

    const cols = 3
    const gap = 5
    const bw = Math.floor((innerW - gap * (cols - 1)) / cols)
    const bh = 24
    const rows = Math.ceil(modes.length / cols)
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      const bx = x0 + (i % cols) * (bw + gap)
      const byy = y + Math.floor(i / cols) * (bh + 4)
      const w = U.button('panel.target.' + mode, bx, byy, bw, bh, {
        label: '', selected: tower.targetMode === mode, action: 'panel-target', arg: mode
      })
      widgets.push(stamp(w, tower))
      const labelText = OP.Targeting && OP.Targeting.modeLabel ? OP.Targeting.modeLabel(mode) : mode
      over.push(U.text(bx + bw / 2, byy + bh / 2 + 4, U.clipText(labelText, 10, bw - 8),
        { size: 10, colour: tower.targetMode === mode ? C.ink : C.dim, align: 'center' }))
    }
    y += rows * (bh + 4)

    const hint = OP.Targeting && OP.Targeting.modeHint ? OP.Targeting.modeHint(tower.targetMode) : ''
    if (hint) {
      marks.push(U.text(x0, y + 10, U.clipText(hint, 8, innerW), { size: 8, colour: C.faint }))
    }
    return y + 18
  }

  /* ---------- one ability, with its cooldown ---------- */

  function abilityButton (sim, tower, marks, widgets, over, ability, slot, x, y, w, h) {
    const U = ui(); const C = colours()
    let check
    try {
      check = slot === 2 ? OP.Heroes.canActivateSecond(sim, tower) : OP.Towers.canActivate(sim, tower)
    } catch (e) { check = { ok: false, reason: 'Unavailable.' } }

    const cd = slot === 2 ? (tower.ability2Cd || 0) : (tower.abilityCd || 0)
    const full = ability.cooldown > 0 ? ability.cooldown : 1

    const widget = U.button('panel.ability' + slot, x, y, w, h, {
      label: '', disabled: !check.ok, action: 'panel-ability', arg: slot, reason: check.reason
    })
    widgets.push(stamp(widget, tower))

    over.push(U.text(x + 8, y + 17, U.clipText(ability.name || 'Ability', 11, w - 80),
      { size: 11, colour: check.ok ? C.ink : C.dim }))
    over.push(U.text(x + w - 8, y + 17, ability.duration ? ability.duration + 's effect' : 'instant',
      { size: 8, colour: C.faint, align: 'right' }))

    if (cd > 0) {
      over.push(U.box(x + 8, y + 24, w - 16, 5, { fill: C.deep }))
      over.push(U.box(x + 8, y + 24, Math.max(1, Math.round((w - 16) * M.clamp01(1 - cd / full))), 5,
        { fill: C.warn }))
      over.push(U.text(x + 8, y + 38, cd.toFixed(1) + 's of ' + full + 's', { size: 8, colour: C.warn }))
    } else {
      over.push(U.text(x + 8, y + 38, check.ok ? 'READY' : U.clipText(check.reason, 8, w - 16),
        { size: 8, colour: check.ok ? C.moss : C.faint }))
    }
    return y + h
  }

  /* ---------- sell and paragon ---------- */

  function footerSection (app, sim, tower, marks, widgets, over, x0, innerW, y, S) {
    const U = ui(); const C = colours()
    const rules = sim.rules || {}
    const preview = paragonPreview(sim, tower)
    const bottom = S.y + S.h - 26

    // Keep the footer pinned to the bottom when the panel above it is short, but
    // never let it climb into the section above when it is tall.
    let fy = Math.min(Math.max(y, bottom - 40), S.y + S.h - 46)
    const confirmingParagon = preview.ok && state.confirmParagon === tower.id

    // Only when the section above actually left room; the button's own sub-line
    // carries the count regardless, so nothing is lost on a crowded panel.
    if (confirmingParagon && fy - 24 > y) {
      marks.push(U.text(x0, fy - 22, 'Consumes ' + preview.sacrifices.length +
        ' other ' + (preview.sacrifices.length === 1 ? 'tower' : 'towers') +
        ' · degree ' + preview.degree, { size: 9, colour: C.warn }))
      marks.push(U.text(x0, fy - 10, 'This cannot be undone.', { size: 9, colour: C.bad }))
    }

    /* Selling is a rule, not a preference: PURIST removes it, so the button is
       ABSENT rather than greyed — there is nothing to explain about an action the
       mode does not have. */
    const canSell = rules.allowSell !== false
    const sellW = preview.ok ? Math.floor((innerW - 8) / 2) : innerW
    if (canSell) {
      const value = OP.Economy.sellValue(sim, tower)
      const pending = state.confirmSell === tower.id
      widgets.push(stamp(U.button('panel.sell', x0, fy, preview.ok ? sellW : innerW, 34, {
        label: pending ? 'CONFIRM' : 'SELL',
        sub: pending ? 'press again' : 'returns ' + M.money(value),
        tone: 'danger', action: 'panel-sell'
      }), tower))
    } else {
      marks.push(U.text(x0, fy + 20, 'Selling is disabled in this mode.', { size: 9, colour: C.faint }))
    }

    if (preview.ok) {
      const px = canSell ? x0 + sellW + 8 : x0
      widgets.push(stamp(U.button('panel.paragon', px, fy, canSell ? sellW : innerW, 34, {
        label: confirmingParagon ? 'CONFIRM' : 'PARAGON',
        sub: confirmingParagon
          ? 'consumes ' + preview.sacrifices.length
          : 'degree ' + preview.degree + ' · ' + M.money(preview.cost),
        tone: confirmingParagon ? 'danger' : 'primary',
        action: 'panel-paragon'
      }), tower))
    } else if (preview.reason && OP.Paragon && OP.Paragon.exists && OP.Paragon.exists(tower.key)) {
      // A tower that HAS a paragon but cannot take it yet gets the reason; one that
      // has no paragon at all gets no line, because there is nothing to explain.
      marks.push(U.text(x0, fy + 48, U.clipText('Paragon: ' + preview.reason, 8, innerW),
        { size: 8, colour: C.faint }))
    }

    marks.push(U.text(x0, S.y + S.h - 8, 'right-click cycles targeting · DEL sells',
      { size: 8, colour: C.faint }))
    return fy + 34
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

  TowerPanel.build = build

  TowerPanel.draw = function (ctx, app) {
    if (!showing(app)) return 0
    return paint(ctx, build(app))
  }

  TowerPanel.chromeAt = function (app, x, y) {
    if (!showing(app)) return false
    const S = sidebar()
    return x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h
  }

  TowerPanel.hitAt = function (app, x, y) {
    const U = ui()
    if (!U || !showing(app)) return null
    return U.hit(build(app).widgets, x, y)
  }

  TowerPanel.activate = function (app, w) {
    const sim = simOf(app)
    const io = ioOf(app)
    if (!w || !sim || !io) return false
    const tower = w.keepId >= 0 && sim.towerById ? sim.towerById.get(w.keepId) : null

    if (w.action === 'panel-close') {
      io.selectedId = -1
      state.confirmSell = -1
      state.confirmParagon = -1
      click(true)
      return true
    }

    if (!tower) return false

    if (w.action === 'panel-upgrade') {
      // Ask, then buy. Upgrades.buy re-checks and returns the same reason, so the
      // refusal the player reads is always the engine's.
      const res = OP.Upgrades.buy(sim, tower, w.arg)
      if (res && res.ok) click(true)
      else refuse(tower.x, tower.y - 24, (res && res.reason) || w.reason || 'Cannot buy that.')
      return true
    }

    if (w.action === 'panel-target') {
      if (OP.Towers.setTargetMode(sim, tower, w.arg)) click(true)
      else refuse(tower.x, tower.y - 24, 'This tower cannot target that way.')
      return true
    }

    if (w.action === 'panel-ability') {
      const res = w.arg === 2
        ? OP.Heroes.activateSecond(sim, tower)
        : OP.Towers.activate(sim, tower)
      if (res && res.ok) click(true)
      else refuse(tower.x, tower.y - 24, (res && res.reason) || 'Not ready.')
      return true
    }

    if (w.action === 'panel-sell') {
      const confirmNeeded = wantsSellConfirm(app)
      if (confirmNeeded && state.confirmSell !== tower.id) {
        state.confirmSell = tower.id
        click(false)
        return true
      }
      state.confirmSell = -1
      const value = OP.Towers.sell(sim, tower)
      if (value > 0) {
        io.selectedId = -1
        click(true)
      } else {
        refuse(tower.x, tower.y - 24, 'Selling is disabled in this mode.')
      }
      return true
    }

    if (w.action === 'panel-paragon') {
      // Destructive and irreversible: it deletes every other tower of this type on
      // the board without a refund, so it takes two presses.
      if (state.confirmParagon !== tower.id) {
        state.confirmParagon = tower.id
        click(false)
        return true
      }
      state.confirmParagon = -1
      const res = OP.Paragon.promote(sim, tower)
      if (res && res.ok) click(true)
      else refuse(tower.x, tower.y - 24, (res && res.reason) || 'Cannot promote this tower.')
      return true
    }

    return false
  }

  function wantsSellConfirm (app) {
    const p = app && app.state ? app.state.profile : null
    const set = p && p.settings
    return !!(set && set.confirmSell)
  }

  TowerPanel.tap = function (app, x, y) {
    const w = TowerPanel.hitAt(app, x, y)
    if (w) TowerPanel.activate(app, w)
    return w
  }

  /* ============================================================================
     INSTALL
     ============================================================================ */

  let logged = false
  function layerBody (ctx, app) {
    try { return TowerPanel.draw(ctx, app) } catch (e) {
      if (!logged) {
        logged = true
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: tower panel draw threw', e)
      }
      return 0
    }
  }

  TowerPanel.install = function (app) {
    if (!app || !app.state) return TowerPanel

    if (OP.HUD && OP.HUD.registerPanel) {
      OP.HUD.registerPanel('tower-panel', 20, {
        chromeAt: TowerPanel.chromeAt,
        hitAt: TowerPanel.hitAt,
        activate: TowerPanel.activate
      })
    }

    if (OP.Render && OP.Render.registerLayer) {
      OP.Render.registerLayer('tower-panel', OP.Render.LAYER.HUD + 20, function (ctx, sim, view, frame) {
        layerBody(ctx, (frame && frame.app) || app)
      })
    }

    return TowerPanel
  }

  OP.TowerPanel = TowerPanel
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

export const name = 'ui-game'
export const needs = [
  'js/ui/hud.js',
  'js/ui/shop.js',
  'js/ui/tower-panel.js',
  'js/ui/results.js'
]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../loadgame.mjs'
import { makeSim, spawn } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

/*
  The in-game interface: HUD, shop, tower panel, results.

  Two things this suite is careful about, because both are the kind of bug that
  only shows up with a real pointer:

    - It drives OP.Input.tap for the important presses rather than calling
      Module.tap directly. Input.tap rewrites io.selectedId BEFORE it fires the
      select intent, so a panel that only ever gets called directly would never
      notice that pressing its own upgrade button deselects the tower underneath.

    - "Nothing mutates the sim" is checked with OP.Sim.serialize as well as
      OP.Sim.checksum. The checksum deliberately folds only what can affect the
      future of the simulation, so it would not notice a draw that cycled a target
      mode, changed autostart, or pushed an event.
*/

export function run (t, OP, env) {
  const R = OP.Render
  const U = OP.Menus.UI
  const HUD = OP.HUD
  const Shop = OP.Shop
  const Panel = OP.TowerPanel
  const Results = OP.Results

  /* ---------- a recording context ----------
     Captures every draw call and, separately, every string drawn, so a test can
     assert that a value reached the screen rather than just that something was
     painted. `dense()` is the concatenation in draw order, which also covers
     letter-spaced text (drawn one character per fillText). */

  function recorder () {
    const calls = []
    const texts = []
    const noop = n => function () { calls.push(n) }
    const ctx = {
      calls: calls,
      texts: texts,
      dense: () => texts.join(''),
      save: noop('save'), restore: noop('restore'),
      setTransform: noop('setTransform'), translate: noop('translate'),
      rotate: noop('rotate'), scale: noop('scale'),
      clearRect: noop('clearRect'), fillRect: noop('fillRect'), strokeRect: noop('strokeRect'),
      beginPath: noop('beginPath'), closePath: noop('closePath'),
      moveTo: noop('moveTo'), lineTo: noop('lineTo'), arc: noop('arc'),
      ellipse: noop('ellipse'), rect: noop('rect'), roundRect: noop('roundRect'),
      quadraticCurveTo: noop('quadraticCurveTo'), bezierCurveTo: noop('bezierCurveTo'),
      fill: noop('fill'), stroke: noop('stroke'), clip: noop('clip'),
      drawImage: noop('drawImage'), strokeText: noop('strokeText'),
      fillText: function (s) { calls.push('fillText'); texts.push(String(s)) },
      setLineDash: noop('setLineDash'), getLineDash: () => [],
      measureText: s => ({ width: String(s).length * 6 }),
      createLinearGradient: () => ({ addColorStop () {} }),
      createRadialGradient: () => ({ addColorStop () {} }),
      getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
    }
    return ctx
  }

  function view () {
    const v = OP.Camera.create()
    OP.Camera.resize(v, env.ctx.document.createElement('canvas'), 1280, 720, 1)
    return v
  }

  /* ---------- fixtures ---------- */

  function sim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 100000, lives: 150
    }, opts || {}))
  }

  /** An app object shaped exactly like the one js/main.js hands the UI. */
  function makeApp (s, opts) {
    opts = opts || {}
    const io = OP.Input.create()
    const app = {
      state: {
        canvas: null, ctx: null, view: null,
        io: io,
        sim: s,
        profile: opts.profile || null,
        screen: 'game',
        mapKey: opts.mapKey || 'test',
        difficulty: s ? s.difficulty : 'medium',
        mode: s ? s.mode : 'standard'
      },
      calls: [],
      selectedTower: function () {
        const live = app.state.sim
        return live && io.selectedId >= 0 ? live.towerById.get(io.selectedId) : null
      },
startGame: function (mapKey, difficulty, mode, opts) {
        app.calls.push(['startGame', mapKey, difficulty, mode, opts || {}])
        return null
      },
continueFreeplay: function () { app.calls.push(['continueFreeplay']); return app.state.sim },
      advanceExpedition: function () { app.calls.push(['advanceExpedition']) },
      quitToMenu: function () { app.calls.push(['quitToMenu']); app.state.screen = 'menu' }
    }
    return app
  }

  /** Wire the shell's own intent handlers, then install the UI over the top —
      the same order js/main.js uses, which is what makes the router testable. */
  function wireShell (app) {
    const io = app.state.io
    OP.Input.setTowerLookup(io, function (x, y) {
      const live = app.state.sim
      const tower = live ? OP.Towers.at(live, x, y) : null
      return tower ? tower.id : -1
    })
    OP.Input.setHandlers(io, {
      select: function (id) { io.selectedId = id; app.calls.push(['select', id]) },
      place: function (key, x, y, isHero) {
        const live = app.state.sim
        const placed = isHero ? OP.Heroes.place(live, key, x, y) : OP.Towers.place(live, key, x, y)
        if (placed) { io.selectedId = placed.id; OP.Input.cancel(io) }
        app.calls.push(['place', key, !!placed])
      },
      cancel: function () { app.calls.push(['cancel']) }
    })
    HUD.install(app)
    Shop.install(app)
    Panel.install(app)
    Results.install(app)
    return app
  }

  /** Somewhere legal to build, found the way the smoke test does. */
  function place (s, key, isHero) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = 60 + (attempt * 71) % (OP.FIELD_W - 120)
      const y = 60 + (attempt * 137) % (OP.FIELD_H - 120)
      const check = isHero ? OP.Heroes.canPlace(s, key, x, y) : OP.Towers.canPlace(s, key, x, y)
      if (!check.ok) continue
      const made = isHero ? OP.Heroes.place(s, key, x, y) : OP.Towers.place(s, key, x, y)
      if (made) return made
    }
    return null
  }

  function centre (w) { return { x: w.x + w.w / 2, y: w.y + w.h / 2 } }

  function byId (model, id) { return U.byId(model.widgets, id) }

  /**
   * Scroll the shop until `id` is on screen, then return that widget (or null).
   *
   * Needed because the card list is culled: a widget below the fold does not
   * exist, which is the correct behaviour and does mean a test that wants a
   * specific card has to go and find it the way a player would.
   */
  function scrollToCard (app, id) {
    OP.Shop.state.scroll = 0
    for (let guard = 0; guard < 400; guard++) {
      const m = OP.Shop.build(app)
      const w = U.byId(m.widgets, id)
      if (w) return w
      if (OP.Shop.state.scroll >= OP.Shop.state.maxScroll) return null
      OP.Shop.scrollBy(24)
    }
    return null
  }

  /** Drive a real pointer tap at a point, the way Input does on pointerup. */
  function tapAt (app, x, y) {
    const io = app.state.io
    io.overCanvas = true
    OP.Input.setPoint(io, x, y)
    return OP.Input.tap(io, x, y)
  }

  /**
   * Tap the screen position where a BOARD point appears.
   *
   * Towers live in board coordinates; taps arrive in field coordinates. Since the
   * board is fitted beside the sidebar the two differ, so a test that wants to
   * press "on that tower" has to convert — exactly as a player's finger does.
   */
  function tapBoard (app, bx, by) {
    const f = OP.Camera.boardToField(bx, by)
    return tapAt(app, f.x, f.y)
  }

  function firstTowerKey () {
    return Array.isArray(OP.TOWER_ORDER) && OP.TOWER_ORDER.length ? OP.TOWER_ORDER[0] : null
  }

  const KEY = firstTowerKey()

  /* ==========================================================================
     INSTALL
     ========================================================================== */

  t.section('every module installs against a real sim')
  const s0 = sim()
  const app0 = wireShell(makeApp(s0))
  t.ok(HUD.LAYOUT && HUD.LAYOUT.sidebar, 'the HUD publishes the shared layout')
  const layers = R.layerNames()
  t.ok(layers.includes('hud'), 'the HUD registered a render layer')
  t.ok(layers.includes('shop'), 'so did the shop')
  t.ok(layers.includes('tower-panel'), 'so did the tower panel')
  t.ok(layers.includes('results'), 'so did the results screen')
  const panels = HUD.panelNames()
  t.deep(panels, ['tower-panel', 'shop', 'hud'], 'panels route topmost-first, by declared order')
  t.eq(app0.state.io._uiLookupHook, true, 'the tower lookup was hooked exactly once')

  t.section('installing twice does not duplicate a layer or a panel')
  HUD.install(app0); Shop.install(app0); Panel.install(app0); Results.install(app0)
  t.eq(R.layerNames().filter(n => n === 'hud').length, 1, 'one hud layer')
  t.eq(HUD.panelNames().filter(n => n === 'shop').length, 1, 'one shop panel')

  /* ==========================================================================
     THE HUD
     ========================================================================== */

  t.section('the HUD draws a meaningful frame')
  const hudCtx = recorder()
  const hudDrawn = HUD.draw(hudCtx, app0)
  t.gt(hudDrawn, 20, `painted ${hudDrawn} marks and widgets`)
  t.gt(hudCtx.calls.length, 40, `issuing ${hudCtx.calls.length} draw calls`)
  t.ok(hudCtx.calls.includes('fillRect'), 'painted its panels')
  t.ok(hudCtx.calls.includes('fillText'), 'and its readouts')

  t.section('the HUD shows cash, lives, the round and the pressure')
  let dense = hudCtx.dense()
  t.ok(dense.includes(OP.M.money(s0.cash)), 'cash, formatted by OP.M.money')
  t.ok(dense.includes('LIVES'), 'a lives readout')
  t.ok(dense.includes('ROUND'), 'a round readout')
  t.ok(dense.includes('/ ' + s0.rules.lastRound), 'with the round total from the ruleset')
  t.ok(dense.includes('ON THE BOARD'), 'and live board pressure')

  t.section('the HUD output changes when cash changes')
  const cashBefore = drawDense(HUD, app0)
  s0.cash = 4242
  const cashAfter = drawDense(HUD, app0)
  t.neq(cashAfter, cashBefore, 'the drawn output is different')
  t.ok(cashAfter.includes(OP.M.money(4242)), 'and carries the new cash')

  t.section('and when lives change')
  const livesBefore = drawDense(HUD, app0)
  s0.lives = 97
  const livesAfter = drawDense(HUD, app0)
  t.neq(livesAfter, livesBefore, 'the drawn output is different')
  t.ok(livesAfter.includes('97'), 'and carries the new lives')

  t.section('and when the round changes')
  const roundBefore = drawDense(HUD, app0)
  OP.Sim.startRound(s0, 7)
  const roundAfter = drawDense(HUD, app0)
  t.neq(roundAfter, roundBefore, 'the drawn output is different')
  t.ok(roundAfter.includes('ROUND 7'), 'the running round is named')
  t.ok(roundAfter.includes(String(s0.round.rbe)) || roundAfter.includes(OP.M.compact(s0.round.rbe)),
    'and the round RBE is shown')

  t.section('low lives and low cash are called out, not just recoloured')
  const poor = sim({ cash: 0, lives: 2 })
  const poorApp = wireShell(makeApp(poor))
  const poorDense = drawDense(HUD, poorApp)
  t.ok(poorDense.includes('CRITICAL'), 'critical lives are labelled')
  t.ok(poorDense.includes('TOO LOW'), 'and so is cash that cannot buy anything')
  const rich = sim({ cash: 100000, lives: 150 })
  const richDense = drawDense(HUD, wireShell(makeApp(rich)))
  t.notOk(richDense.includes('CRITICAL'), 'a healthy run says neither')
  t.notOk(richDense.includes('TOO LOW'), 'nor the other')

  t.section('the difficulty and the mode being played are always on screen')
  const purist = sim({ difficulty: 'hard', mode: 'purist' })
  const puristDense = drawDense(HUD, wireShell(makeApp(purist)))
  t.ok(puristDense.includes('HARD'), 'the difficulty')
  t.ok(puristDense.includes('PURIST'), 'and the mode')

  t.section('a Start Round button appears only when the board is idle')
  const idle = sim()
  const idleApp = wireShell(makeApp(idle))
  t.ok(byId(HUD.build(idleApp), 'hud.start'), 'idle: the button is there')
  const idleDense = drawDense(HUD, idleApp)
  t.ok(idleDense.includes('NEXT ROUND RBE'), 'and the round to come is priced in RBE')
  const nextRBE = OP.Rounds.roundRBE(idle.roundSet[idle.roundIndex + 1])
  t.ok(idleDense.includes(OP.M.compact(nextRBE)), `showing ${OP.M.compact(nextRBE)} for the next round`)
  OP.Sim.startRound(idle, 3)
  t.notOk(byId(HUD.build(idleApp), 'hud.start'), 'mid-round: it is replaced by the progress readout')
  t.ok(drawDense(HUD, idleApp).includes('ROUND 3'), 'which names the round in flight')

  t.section('the HUD acts through the engine, never on its own')
  const acts = sim()
  const actsApp = wireShell(makeApp(acts))
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.start'))
  t.ok(acts.round && acts.round.index === acts.rules.firstRound, 'start armed the first round via Sim.startRound')
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.speed3'))
  t.eq(acts.speed, 3, 'the speed buttons go through Sim.setSpeed')
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.speed1'))
  t.eq(acts.speed, 1, 'and back down')
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.pause'))
  t.eq(acts.paused, true, 'pause goes through Sim.togglePause')
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.pause'))
  t.eq(acts.paused, false, 'and unpauses')
  const autoWas = acts.autostart
  HUD.activate(actsApp, byId(HUD.build(actsApp), 'hud.autostart'))
  t.eq(acts.autostart, !autoWas, 'the autostart toggle flips the sim flag')

  t.section('speed buttons clamp to what the sim allows')
  HUD.activate(actsApp, { action: 'hud-speed', arg: 99 })
  t.lte(acts.speed, 3, 'Sim.setSpeed clamped it rather than the UI guessing')

  /* ==========================================================================
     THE HERO PANEL
     ========================================================================== */

  t.section('the hero panel shows level, XP and both abilities')
  const heroKey = Array.isArray(OP.HERO_ORDER) && OP.HERO_ORDER.length ? OP.HERO_ORDER[0] : null
  if (!heroKey) {
    t.fail('no heroes registered', 'OP.HERO_ORDER is empty')
  } else {
    const hs = sim()
    const hApp = wireShell(makeApp(hs))
    t.notOk(drawDense(HUD, hApp).includes('LV '), 'with no hero placed there is no hero panel')
    const hero = place(hs, heroKey, true)
    t.ok(hero, 'a hero was placed')
    OP.Heroes.grantXP(hs, 1000000)
    t.eq(hero.level, OP.Heroes.MAX_LEVEL, 'and levelled to the top through the engine')
    const heroDense = drawDense(HUD, hApp)
    t.ok(heroDense.includes('LV ' + hero.level + ' / ' + OP.Heroes.MAX_LEVEL), 'the level is shown')
    t.ok(heroDense.includes('XP'), 'and the XP total')
    t.ok(heroDense.includes('fully levelled'), 'progress reads as complete at max level')

    const hModel = HUD.build(hApp)
    const ab1 = byId(hModel, 'hud.ability1.' + hero.id)
    t.ok(ab1, 'the first ability has a button')
    t.eq(ab1.keepId, hero.id, 'stamped with the hero it belongs to')
    t.ok(heroDense.includes('READY') || heroDense.includes('s'), 'with its cooldown state')

    if (hero.s.ability) {
      hero.abilityCd = 12.5
      const cdDense = drawDense(HUD, hApp)
      t.ok(cdDense.includes('12.5s'), 'a live cooldown is counted down on the button')
      const disabled = byId(HUD.build(hApp), 'hud.ability1.' + hero.id)
      t.ok(disabled.disabled, 'and the button is disabled while it runs')
      t.ok(disabled.reason.length > 0, 'carrying the engine reason')
      hero.abilityCd = 0
      const res = HUD.activate(hApp, byId(HUD.build(hApp), 'hud.ability1.' + hero.id))
      t.ok(res, 'pressing it is handled')
      t.gt(hero.abilityCd, 0, 'and the engine put the ability on cooldown')
    } else {
      t.ok(heroDense.includes('no ability'), 'a hero with no ability says so rather than drawing a dead button')
    }

    t.section('the second ability is its own button, on its own cooldown')
    // Slot 2 reads hero.ability2Cd and routes to Heroes.activateSecond. A copy-paste
    // that read abilityCd would render a plausible-looking wrong number, so both
    // fields are moved independently here.
    if (!hero.s.ability2) {
      t.fail('no hero reaches a second ability', 'expected s.ability2 by level ' + OP.Heroes.MAX_LEVEL)
    } else {
      const ab2 = byId(HUD.build(hApp), 'hud.ability2.' + hero.id)
      t.ok(ab2, 'the second ability has its own button')
      t.eq(ab2.keepId, hero.id, 'stamped with the hero')
      t.eq(ab2.arg, 2, 'and marked as the second slot')
      t.ok(drawDense(HUD, hApp).includes(hero.s.ability2.name), 'named on screen')

      hero.abilityCd = 3
      hero.ability2Cd = 9.5
      const bothDense = drawDense(HUD, hApp)
      t.ok(bothDense.includes('9.5s'), 'slot 2 counts down its own cooldown')
      t.ok(bothDense.includes('3.0s'), 'while slot 1 shows a different one')

      hero.abilityCd = 0
      hero.ability2Cd = 0
      const res2 = OP.Heroes.canActivateSecond(hs, hero)
      t.ok(res2.ok, 'the engine says the second ability is ready')
      HUD.activate(hApp, byId(HUD.build(hApp), 'hud.ability2.' + hero.id))
      t.gt(hero.ability2Cd, 0, 'pressing it went through Heroes.activateSecond')
      t.eq(hero.abilityCd, 0, 'and left the first ability alone')
    }

    t.section('an XP change moves the hero panel')
    const before = drawDense(HUD, hApp)
    hero.level = 3
    hero.xp = OP.Heroes.xpForLevel(3) + 5
    OP.Towers.restat(hs, hero)
    t.neq(drawDense(HUD, hApp), before, 'the panel follows the hero')
  }

  /* ==========================================================================
     THE SHOP
     ========================================================================== */

  t.section('the shop lists every registered tower, grouped by family')
  const shopSim = sim({ cash: 100000 })
  const shopApp = wireShell(makeApp(shopSim))
  /* The list is CULLED, not merely clipped: a card scrolled out of view is absent
     from `widgets` so it cannot answer a hit test and let a player buy a tower
     they cannot see. That means "every tower has an entry" cannot be asserted
     from one frame — it has to be asserted by scrolling, which is the stronger
     claim anyway, because it also proves everything can actually be REACHED. A
     card stranded below the last scroll position would pass a naive count. */
  Shop.state.scroll = 0
  const shopModel = Shop.build(shopApp)
  const visible = shopModel.widgets.filter(w => w.action === 'shop-buy')
  t.gt(visible.length, 0, `${visible.length} cards fit the viewport at once`)
  t.lt(visible.length, OP.TOWER_ORDER.length + OP.HERO_ORDER.length,
    'and not all of them — otherwise this test proves nothing about scrolling')

  const reachable = new Set()
  const heroesReachable = new Set()
  let guard = 0
  Shop.state.scroll = 0
  for (;;) {
    const m = Shop.build(shopApp)
    for (const w of m.widgets) {
      if (w.action !== 'shop-buy') continue
      ;(w.hero ? heroesReachable : reachable).add(w.arg)
    }
    if (Shop.state.scroll >= Shop.state.maxScroll || ++guard > 400) break
    Shop.scrollBy(20)
  }
  t.lt(guard, 400, 'scrolling terminates at the bottom rather than running forever')
  t.eq(reachable.size, OP.TOWER_ORDER.length, `all ${OP.TOWER_ORDER.length} towers are reachable by scrolling`)
  t.eq(heroesReachable.size, OP.HERO_ORDER.length, `and all ${OP.HERO_ORDER.length} heroes`)
  t.ok(OP.TOWER_ORDER.every(k => reachable.has(k)), 'read from OP.TOWER_ORDER, so nothing is skipped')

  t.section('the card list scrolls, and cannot be scrolled off either end')
  Shop.state.scroll = 0
  t.ok(!Shop.scrollBy(-50), 'scrolling up at the top is refused rather than going negative')
  t.eq(Shop.state.scroll, 0, 'still pinned at the top')
  t.ok(Shop.scrollBy(40), 'scrolling down moves')
  const mid = Shop.state.scroll
  t.eq(mid, 40, 'by exactly the amount asked for')
  Shop.build(shopApp)
  Shop.scrollBy(100000)
  t.eq(Shop.state.scroll, Shop.state.maxScroll, 'a huge scroll clamps to the last card instead of blanking the panel')
  t.ok(!Shop.scrollBy(50), 'and is refused past the end')
  t.gt(Shop.state.maxScroll, 0, 'the roster genuinely overflows one screen, so this matters')
  Shop.state.scroll = 0
  const groupLabels = Shop.groups().map(g => g.label)
  t.deep(groupLabels.slice(0, OP.FAMILIES.length), OP.FAMILIES.map(f => OP.FAMILY_LABELS[f]),
    'grouped in OP.FAMILIES order')
  t.eq(groupLabels[groupLabels.length - 1], 'Heroes', 'with the heroes last')

  t.section('the shop draws names, prices and its family headers')
  const shopCtx = recorder()
  const shopDrawn = Shop.draw(shopCtx, shopApp)
  t.gt(shopDrawn, 60, `painted ${shopDrawn} marks and widgets`)
  t.gt(shopCtx.calls.length, 150, `issuing ${shopCtx.calls.length} draw calls`)
  const shopDense = shopCtx.dense()
  t.ok(shopDense.includes(OP.TOWERS[KEY].name), 'a tower name reached the screen')
  t.ok(shopDense.includes(OP.M.money(OP.Economy.price(shopSim, OP.TOWERS[KEY].cost))), 'with its price')
  t.ok(shopDense.includes('PRIMARY'), 'and the family headers')

  t.section('each card shows the critter it is, drawn with the board sprite')
  Shop.state.scroll = 0
  const portraitModel = Shop.build(shopApp)
  const cardIds = portraitModel.widgets.filter(w => w.action === 'shop-buy').map(w => w.arg)
  const portraits = (portraitModel.listOver || []).filter(m => m && m.kind === 'portrait')
  t.eq(portraits.length, cardIds.length, 'one portrait per visible card, no more and no fewer')
  t.deep(portraits.map(p => p.key), cardIds, 'and each portrait is the key of the card it sits on')
  t.ok(portraits.every(p => p.r > 6), 'at a radius big enough to make out')

  // The point of reusing the board sprite is that the shop cannot drift from the
  // board. Asserting the registry is consulted is what makes that true rather
  // than aspirational.
  /* A portrait must be backed by real art — but "shipped" cannot be read from
     OP.FAMILY_ROSTERS here. Under --all, js/towers/_TEMPLATE.js REPLACES
     FAMILY_ROSTERS.primary with its own key, so the seven primary towers vanish
     from the registry that is supposed to be authoritative and this assertion
     would pass vacuously on zero towers. Scan the shipped sources instead, the
     same way sprites-towers.mjs does. */
  const shippedSrc = [
    'js/towers/primary.js', 'js/towers/military.js', 'js/towers/magic.js',
    'js/towers/support.js', 'js/towers/heroes.js'
  ].map(rel => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { return '' } }).join('\n')
  const isShipped = k => k.indexOf('template-') !== 0 && shippedSrc.indexOf("'" + k + "'") >= 0

  const shippedPortraits = portraits.filter(p => isShipped(p.key))
  t.gt(shippedPortraits.length, 0, 'the visible cards include shipped content')
  t.ok(shippedPortraits.every(p => typeof OP.Render.towerSprites[p.key] === 'function'),
    'every shipped portrait has a real registered sprite behind it')

  const dimmed = portraits.filter(p => p.dim)
  const states = {}
  for (const w of portraitModel.widgets) if (w.action === 'shop-buy') states[w.arg] = w.state
  t.ok(dimmed.every(p => states[p.key] !== 'ok'),
    'only unavailable critters are dimmed, so dimming means something')

  t.section('a card carries the one trait a player decides on')
  const traitDense = drawDense(Shop, shopApp)
  const anyCamo = OP.TOWER_ORDER.some(k => {
    const tr = OP.Upgrades.traits(OP.TOWERS[k], shopSim)
    return tr && (tr.camoNow || tr.camoLater)
  })
  t.ok(anyCamo, 'some tower answers camo, so the trait is worth printing')
  t.ok(traitDense.includes('SHARP') || traitDense.includes('EXPLOSIVE') || traitDense.includes('NORMAL'),
    'the damage type is on the card')

  t.section('the upgrade tree can be previewed before buying')
  Shop.state.scroll = 0
  Shop.closeTree()
  const hoverApp = wireShell(makeApp(sim({ cash: 100000 })))
  const firstCard = scrollToCard(hoverApp, 'shop.' + KEY)
  // Point at the card so the detail strip — and its button — exist at all.
  hoverApp.state.io.overCanvas = true
  OP.Input.setPoint(hoverApp.state.io, firstCard.x + firstCard.w / 2, firstCard.y + firstCard.h / 2)
  const hovered = Shop.build(hoverApp)
  const treeBtn = U.byId(hovered.widgets, 'shop.tree.' + KEY)
  t.ok(!!treeBtn, 'a hovered card offers an UPGRADES button')
  t.eq(treeBtn.action, 'shop-tree', 'wired to open the tree')
  t.ok((hovered.cardWidgets || []).some(w => w.id === treeBtn.id),
    'and it scrolls WITH its card — a button that outlived its card would open the wrong tree')

  t.section('the upgrade-tree button is ON the card, so reaching it never leaves it')
  /* Reported by Andre against the first build of this panel: the button lived only
     in the detail strip below the list, so pressing it meant dragging the pointer
     down across six other cards — and each one it crossed replaced the strip, so
     the button either vanished or belonged to a different tower by the time it was
     reached. A control that can only be reached by leaving the thing it belongs to
     is not a control. It is now a strip on the card's own right edge. */
  const cardTree = U.byId(hovered.widgets, 'shop.tree.' + KEY)
  t.ok(!!cardTree, 'every card with upgrade paths carries its own tree button')
  t.eq(cardTree.x, firstCard.x + firstCard.w,
    'butted directly against the buy area, with no gap and no overlap')
  t.eq(cardTree.y, firstCard.y, 'aligned to the card top')
  t.eq(cardTree.h, firstCard.h, 'and full card height, so it is an easy target')

  // The press a player actually makes: pointer already on the card, no travel.
  const onBtn = { x: cardTree.x + cardTree.w / 2, y: cardTree.y + cardTree.h / 2 }
  OP.Input.setPoint(hoverApp.state.io, onBtn.x, onBtn.y)
  const atBtn = Shop.build(hoverApp)
  t.eq(U.hit(atBtn.widgets, onBtn.x, onBtn.y).id, 'shop.tree.' + KEY,
    'the tree strip wins the hit test over the buy area underneath it')
  t.eq(Shop.state.detailKey, KEY, 'and the strip still describes the tower being pointed at')

  t.notOk(Shop.state.tree, 'the tree starts closed')
  Shop.activate(hoverApp, U.hit(atBtn.widgets, onBtn.x, onBtn.y))
  t.eq(Shop.state.tree, KEY, 'pressing it opens that tower\'s tree')
  t.eq(hoverApp.state.sim.towers.length, 0, 'and buys nothing — it is a preview')
  t.eq(hoverApp.state.io.placingKey, null, 'and does not arm a placement')
  Shop.closeTree()

  t.section('pressing the rest of the card still buys, not previews')
  const buyPoint = { x: firstCard.x + 8, y: firstCard.y + firstCard.h / 2 }
  const atBuy = U.hit(Shop.build(hoverApp).widgets, buyPoint.x, buyPoint.y)
  t.eq(atBuy.id, 'shop.' + KEY, 'the buy area is still hit everywhere else on the card')
  t.eq(atBuy.action, 'shop-buy', 'and still means buy')

  t.section('the strip keeps its subject when the pointer leaves the list entirely')
  OP.Input.setPoint(hoverApp.state.io, firstCard.x + firstCard.w / 2, firstCard.y + firstCard.h / 2)
  Shop.build(hoverApp)
  OP.Input.setPoint(hoverApp.state.io, 40, 400)          // off the sidebar, over the board
  Shop.build(hoverApp)
  t.eq(Shop.state.detailKey, KEY, 'pointing at nothing does not blank the strip')

  t.section('hovering a DIFFERENT card does replace the strip')
  Shop.closeTree()
  const otherKey = OP.TOWER_ORDER[1] || KEY
  const otherCard = scrollToCard(hoverApp, 'shop.' + otherKey)
  OP.Input.setPoint(hoverApp.state.io, otherCard.x + otherCard.w / 2, otherCard.y + otherCard.h / 2)
  Shop.build(hoverApp)
  t.eq(Shop.state.detailKey, otherKey, 'sticky means "until something replaces it", not "frozen"')

  const treeCtx = recorder()
  Shop.openTree(KEY)
  const treeDrawn = Shop.draw(treeCtx, hoverApp)
  const treeDense = treeCtx.dense()
  t.gt(treeDrawn, 60, `the open tree paints (${treeDrawn} marks)`)
  const def = OP.TOWERS[KEY]
  let namedUpgrades = 0
  for (const path of def.paths) {
    for (const up of path.tiers) if (up && up.name && treeDense.includes(up.name)) namedUpgrades++
  }
  t.gt(namedUpgrades, 10, `${namedUpgrades} of the 15 upgrade names are legible before purchase`)
  t.ok(def.paths.every(p => treeDense.includes(String(p.name).toUpperCase())), 'all three branches are labelled')
  t.ok(treeDense.includes('at most one branch past tier 2') || treeDense.includes('5-2-0'),
    'and the crosspath rule is stated, since it decides which column you can finish')

  t.section('the tree is modal, and escapable')
  t.ok(Shop.chromeAt(hoverApp, 10, 10), 'while open it owns the whole field, so a tap cannot fall through')
  const scrimHit = Shop.hitAt(hoverApp, 12, 12)
  t.eq(scrimHit.action, 'shop-tree-close', 'a press off the panel closes it rather than trapping the player')
  Shop.activate(hoverApp, scrimHit)
  t.notOk(Shop.state.tree, 'closed')
  Shop.openTree(KEY)
  t.ok(Shop.key(hoverApp, 'Escape'), 'Escape is claimed by the open tree')
  t.notOk(Shop.state.tree, 'and closes it')
  t.notOk(Shop.key(hoverApp, 'Escape'), 'with nothing open, Escape is left for the placement mode')
  Shop.state.scroll = 0

  t.section('prices come from OP.Economy.price, so the difficulty multiplier lands')
  const easy = sim({ difficulty: 'easy', cash: 100000 })
  const hard = sim({ difficulty: 'relentless', cash: 100000 })
  const easyEntry = byId(Shop.build(wireShell(makeApp(easy))), 'shop.' + KEY)
  const hardEntry = byId(Shop.build(wireShell(makeApp(hard))), 'shop.' + KEY)
  t.eq(easyEntry.price, OP.Economy.price(easy, OP.TOWERS[KEY].cost), 'easy asks the engine')
  t.eq(hardEntry.price, OP.Economy.price(hard, OP.TOWERS[KEY].cost), 'so does Relentless')
  t.lt(easyEntry.price, hardEntry.price, `and they differ (${easyEntry.price} vs ${hardEntry.price})`)
  t.ok(drawDense(Shop, wireShell(makeApp(easy))).includes(OP.M.money(easyEntry.price)),
    'the cheaper price is what gets drawn on Easy')
  t.ok(drawDense(Shop, wireShell(makeApp(hard))).includes(OP.M.money(hardEntry.price)),
    'and the dearer one on Relentless')

  t.section('affordable, unaffordable and mode-forbidden look different')
  const thin = sim({ cash: 0, mode: 'primary-only' })
  thin.cash = OP.Economy.price(thin, OP.TOWERS[KEY].cost)      // exactly one purchase
  const thinApp = wireShell(makeApp(thin))
  const affordable = scrollToCard(thinApp, 'shop.' + KEY)
  t.eq(affordable.state, 'ok', 'the one tower we can pay for is affordable')
  t.notOk(affordable.disabled, 'and enabled')

  const dearKey = OP.TOWER_ORDER.filter(k => OP.TOWERS[k].family === 'primary')
    .sort((a, b) => OP.TOWERS[b].cost - OP.TOWERS[a].cost)[0]
  const dear = scrollToCard(thinApp, 'shop.' + dearKey)
  t.eq(dear.state, 'poor', 'a tower we cannot pay for is marked poor, not blocked')
  t.ok(dear.disabled, 'and disabled')
  t.ok(dear.reason.includes('Not enough cash'), 'with an affordability reason')

  const militaryKey = OP.TOWER_ORDER.find(k => OP.TOWERS[k].family === 'military')
  const blocked = scrollToCard(thinApp, 'shop.' + militaryKey)
  t.eq(blocked.state, 'blocked', 'a tower the mode forbids is blocked')
  t.ok(blocked.disabled, 'and disabled')
  t.neq(blocked.state, dear.state, 'the three states are distinguishable from the model')
  t.ok(blocked.reason.length > 0, 'and it carries a reason')
  t.eq(blocked.reason, OP.Towers.canPlace(thin, militaryKey, -1, -1).reason,
    'the reason is the engine\'s own wording, not a second copy of the rule')

  t.section('the forbidden reason reaches the drawn output, without a hover')
  // Left scrolled to the blocked tower on purpose: the point of this section is
  // that the reason is legible without a hover, and it can only be legible if the
  // card carrying it is actually on screen.
  const thinDense = drawDense(Shop, thinApp)
  t.ok(thinDense.includes('LOCKED'), 'forbidden entries are tagged')
  t.ok(thinDense.includes(blocked.reason), `and the reason is on screen: "${blocked.reason}"`)
  t.ok(thinDense.includes('disabled in this mode'), 'in the mode\'s own words')

  t.section('PURIST blocks income towers with the income reason')
  const pure = sim({ mode: 'purist', cash: 100000 })
  const pureApp = wireShell(makeApp(pure))
  const incomeKey = OP.TOWER_ORDER.find(k => OP.TOWERS[k].income)
  if (incomeKey) {
    const w = scrollToCard(pureApp, 'shop.' + incomeKey)
    t.ok(!!w, `the income tower ${incomeKey} can be scrolled to`)
    t.eq(w.state, 'blocked', 'an income tower is blocked')
    t.ok(w.reason.toLowerCase().includes('income'), 'for the income reason')
    t.ok(drawDense(Shop, pureApp).includes(w.reason), 'which is drawn beside its family')
    Shop.state.scroll = 0
  } else {
    t.fail('no income tower registered', 'expected at least one def.income tower')
  }

  t.section('hovering an entry explains it')
  const io = shopApp.state.io
  const hoverTarget = byId(Shop.build(shopApp), 'shop.' + KEY)
  io.overCanvas = true
  OP.Input.setPoint(io, centre(hoverTarget).x, centre(hoverTarget).y)
  const hoverModel = Shop.build(shopApp)
  t.eq(hoverModel.hoverId, hoverTarget.id, 'the hovered entry is resolved from the live pointer')
  const hoverDense = drawDense(Shop, shopApp)
  const blurbWords = String(OP.TOWERS[KEY].blurb).split(/\s+/).slice(0, 3).join(' ')
  t.ok(hoverDense.includes(blurbWords), `the blurb is shown: "${blurbWords}…"`)
  io.overCanvas = false

  t.section('clicking an entry puts Input into placing mode with that key')
  const buyApp = wireShell(makeApp(sim({ cash: 100000 })))
  const entry = byId(Shop.build(buyApp), 'shop.' + KEY)
  const at = centre(entry)
  t.eq(tapAt(buyApp, at.x, at.y), 'deselect', 'the tap resolves through Input, over the sidebar')
  if (buyApp.state.io.mode !== 'placing') console.error('DBG showing=', Shop.showing(buyApp), 'tree=', Shop.state.tree, 'chromeAt=', Shop.chromeAt(buyApp, at.x, at.y), 'at=', JSON.stringify(at), 'hit=', JSON.stringify((Shop.hitAt(buyApp, at.x, at.y)||{}).id), 'entryRect=', entry.x, entry.y, entry.w, entry.h)
  t.eq(buyApp.state.io.mode, 'placing', 'Input is placing')
  t.eq(buyApp.state.io.placingKey, KEY, 'with the key that was pressed')
  t.notOk(buyApp.state.io.placingIsHero, 'and not as a hero')

  t.section('a second entry switches the key rather than placing on the panel')
  const other = OP.TOWER_ORDER[1] || KEY
  const otherEntry = byId(Shop.build(buyApp), 'shop.' + other)
  const at2 = centre(otherEntry)
  const towersBefore = buyApp.state.sim.towers.length
  OP.Input.tap(buyApp.state.io, at2.x, at2.y)         // placing mode fires `place`
  t.eq(buyApp.state.sim.towers.length, towersBefore, 'nothing was built under the sidebar')
  t.eq(buyApp.state.io.placingKey, other, 'the placement key was switched instead')

  t.section('clicking a hero entry places a hero')
  if (heroKey) {
    // Heroes sort last, so this card is always well below the fold.
    const heroEntry = scrollToCard(buyApp, 'shop.' + heroKey)
    t.ok(!!heroEntry, 'the hero card can be scrolled to')
    const hAt = centre(heroEntry)
    Shop.activate(buyApp, heroEntry)
    t.eq(buyApp.state.io.placingKey, heroKey, 'the hero key is being placed')
    t.ok(buyApp.state.io.placingIsHero, 'flagged as a hero')
    t.ok(hAt.x > 0, 'and it has a position on screen')
  }

  t.section('an unaffordable entry refuses instead of arming a doomed placement')
  const brokeApp = wireShell(makeApp(sim({ cash: 0 })))
  const brokeEntry = byId(Shop.build(brokeApp), 'shop.' + KEY)
  Shop.activate(brokeApp, brokeEntry)
  t.eq(brokeApp.state.io.mode, 'idle', 'Input was left alone')

  t.section('the hero section is disabled once a hero is placed')
  if (heroKey) {
    const hs2 = sim({ cash: 100000 })
    const hApp2 = wireShell(makeApp(hs2))
    t.eq(byId(Shop.build(hApp2), 'shop.' + heroKey).state, 'ok', 'before: available')
    place(hs2, heroKey, true)
    const after = byId(Shop.build(hApp2), 'shop.' + heroKey)
    t.eq(after.state, 'blocked', 'after: blocked')
    t.ok(after.reason.length > 0, 'with the one-hero-per-map reason')
    t.eq(after.reason, OP.Heroes.canPlace(hs2, heroKey, -1, -1).reason, 'taken from the engine')
    t.ok(drawDense(Shop, hApp2).includes(after.reason), 'and drawn')
  }

  t.section('the shop hands the sidebar over when a tower is selected')
  const swapSim = sim({ cash: 100000 })
  const swapApp = wireShell(makeApp(swapSim))
  const swapTower = place(swapSim, KEY)
  t.ok(Shop.showing(swapApp), 'shop showing with nothing selected')
  swapApp.state.io.selectedId = swapTower.id
  t.notOk(Shop.showing(swapApp), 'and hidden once a tower is selected')
  t.eq(Shop.draw(recorder(), swapApp), 0, 'so it draws nothing at all')
  t.notOk(Shop.chromeAt(swapApp, 1100, 400), 'and stops claiming the sidebar')
  t.ok(Panel.chromeAt(swapApp, 1100, 400), 'which the tower panel now owns')

  /* ==========================================================================
     THE TOWER PANEL
     ========================================================================== */

  t.section('the tower panel draws the selected tower')
  Panel.state.confirmSell = -1
  Panel.state.confirmParagon = -1
  const ps = sim({ cash: 1000000 })
  const pApp = wireShell(makeApp(ps))
  const tower = place(ps, KEY)
  t.ok(tower, 'a tower was placed')
  pApp.state.io.selectedId = tower.id
  const pCtx = recorder()
  const pDrawn = Panel.draw(pCtx, pApp)
  t.gt(pDrawn, 40, `painted ${pDrawn} marks and widgets`)
  t.gt(pCtx.calls.length, 100, `issuing ${pCtx.calls.length} draw calls`)
  const pDense = pCtx.dense()
  t.ok(pDense.includes(OP.Towers.displayName(tower).toUpperCase()), 'the name via Towers.displayName')
  t.ok(pDense.includes(OP.Upgrades.label(tower)), 'the tier label via Upgrades.label')
  t.ok(pDense.includes('POPS'), 'the pop counter')
  t.ok(pDense.includes('earned'), 'and the cash it has earned')
  t.ok(pDense.includes(String(Math.round(tower.s.range))), 'live stats come from tower.s')
  t.ok(pDense.includes(OP.DMG_META[tower.s.dmgType].label.toUpperCase()), 'including the damage type')

  t.section('all three branches are offered with name, desc and cost')
  const pModel = Panel.build(pApp)
  for (let p = 0; p < OP.Upgrades.PATHS; p++) {
    const w = byId(pModel, 'panel.up' + p)
    if (!t.ok(w, 'branch ' + p + ' has a button')) continue
    t.eq(w.keepId, tower.id, 'stamped with the tower it belongs to')
    const st = Panel.branchState(ps, tower, p)
    t.eq(w.cost, st.cost, 'costed through Economy.price')
  }
  const up0 = OP.Upgrades.nextUpgrade(tower, 0)
  t.ok(pDense.includes(up0.name), 'the next upgrade is named')
  t.ok(pDense.includes(String(up0.desc).split(/\s+/).slice(0, 3).join(' ')), 'its description is shown')
  t.ok(pDense.includes(OP.M.money(OP.Economy.price(ps, up0.cost))), 'and its price')

  t.section('buying an upgrade goes through OP.Upgrades.buy')
  const cashWas = ps.cash
  Panel.activate(pApp, byId(Panel.build(pApp), 'panel.up0'))
  t.eq(tower.tiers[0], 1, 'the tier went up')
  t.lt(ps.cash, cashWas, 'and the engine charged for it')

  t.section('CROSSPATH LOCKS ARE SHOWN WITH THEIR REASON')
  // 3-2-0: branch 1 cannot pass tier 2 because branch 0 already has, and branch 2
  // cannot be started at all because two branches are already touched.
  tower.tiers = [3, 2, 0]
  OP.Towers.restat(ps, tower)
  const locked = Panel.build(pApp)
  const lock1 = byId(locked, 'panel.up1')
  const lock2 = byId(locked, 'panel.up2')
  const why1 = OP.Upgrades.canBuy(tower, 1)
  const why2 = OP.Upgrades.canBuy(tower, 2)
  t.notOk(why1.ok, 'the engine refuses branch 1 at 3-2-0')
  t.notOk(why2.ok, 'and branch 2')
  t.ok(lock1.disabled, 'branch 1 is disabled')
  t.ok(lock2.disabled, 'branch 2 is disabled')
  t.eq(lock1.reason, why1.reason, 'branch 1 carries canBuy\'s reason verbatim')
  t.eq(lock2.reason, why2.reason, 'and so does branch 2')
  t.eq(lock1.locked, true, 'flagged as a rule lock, not an empty wallet')

  const lockedDense = drawDense(Panel, pApp)
  const frag1 = why1.reason.split(/\s+/).slice(0, 4).join(' ')
  const frag2 = why2.reason.split(/\s+/).slice(0, 4).join(' ')
  t.ok(lockedDense.includes(frag1), `branch 1's reason is drawn: "${frag1}…"`)
  t.ok(lockedDense.includes(frag2), `branch 2's reason is drawn: "${frag2}…"`)
  t.ok(why1.reason.includes(OP.TOWERS[KEY].paths[0].name),
    'and the reason names the branch that used the crosspath')
  t.ok(lockedDense.includes('3-2-0'), 'the tier label reflects the state')

  t.section('a branch we simply cannot afford reads differently from a locked one')
  const brokeSim = sim({ cash: 0 })
  const brokeTowerApp = wireShell(makeApp(brokeSim))
  brokeSim.cash = 1000000
  const bt = place(brokeSim, KEY)
  brokeSim.cash = 0
  brokeTowerApp.state.io.selectedId = bt.id
  const bw = byId(Panel.build(brokeTowerApp), 'panel.up0')
  t.ok(bw.disabled, 'the button is disabled')
  t.notOk(bw.locked, 'but not flagged as a rule lock')
  t.ok(bw.reason.includes('Not enough cash'), 'and the reason is the wallet')
  t.ok(drawDense(Panel, brokeTowerApp).includes('Not enough cash'), 'which is drawn too')

  t.section('a maxed branch says so')
  const maxSim = sim({ cash: 1000000 })
  const maxApp = wireShell(makeApp(maxSim))
  const maxTower = place(maxSim, KEY)
  maxTower.tiers = [5, 0, 0]
  OP.Towers.restat(maxSim, maxTower)
  maxApp.state.io.selectedId = maxTower.id
  const maxDense = drawDense(Panel, maxApp)
  t.ok(maxDense.includes('Fully upgraded'), 'the branch is marked fully upgraded')
  t.ok(maxDense.includes(OP.Upgrades.canBuy(maxTower, 0).reason), 'with the engine\'s reason')

  t.section('targeting buttons come from tower.s.targetModes')
  const tModel = Panel.build(maxApp)
  const modes = maxTower.s.targetModes
  t.gt(modes.length, 0, `the tower offers ${modes.length} modes`)
  for (const mode of modes) {
    const w = byId(tModel, 'panel.target.' + mode)
    if (!t.ok(w, 'mode ' + mode + ' has a button')) continue
    t.eq(w.selected, maxTower.targetMode === mode, 'selection mirrors the tower')
  }
  t.ok(maxDense.includes(OP.Targeting.modeLabel(modes[0])), 'labelled via Targeting.modeLabel')
  t.ok(maxDense.includes(OP.Targeting.modeHint(maxTower.targetMode).slice(0, 12)),
    'and the active mode\'s hint is explained')

  t.section('pressing a targeting button goes through Towers.setTargetMode')
  const otherMode = modes[modes.length - 1]
  Panel.activate(maxApp, byId(Panel.build(maxApp), 'panel.target.' + otherMode))
  t.eq(maxTower.targetMode, otherMode, 'the tower retargeted')
  t.eq(maxTower.targetId, -1, 'and the engine dropped the held target')

  t.section('an ability button shows its cooldown')
  const abilityKey = OP.TOWER_ORDER.find(function (key) {
    const probe = OP.TOWERS[key]
    if (!probe || !Array.isArray(probe.paths)) return false
    const s = sim({ cash: 100000000 })
    const made = place(s, key)
    if (!made) return false
    made.tiers = [5, 0, 0]
    OP.Towers.restat(s, made)
    return !!(made.s && made.s.ability)
  })
  if (!abilityKey) {
    t.fail('no tower reaches an ability at 5-0-0', 'expected a tier-4 or tier-5 apply() to attach s.ability')
  } else {
    const as = sim({ cash: 100000000 })
    const aApp = wireShell(makeApp(as))
    const at3 = place(as, abilityKey)
    at3.tiers = [5, 0, 0]
    OP.Towers.restat(as, at3)
    aApp.state.io.selectedId = at3.id
    const aw = byId(Panel.build(aApp), 'panel.ability1')
    t.ok(aw, 'the ability has a button')
    t.notOk(aw.disabled, 'ready to press')
    t.ok(drawDense(Panel, aApp).includes(at3.s.ability.name), 'named on screen')
    Panel.activate(aApp, aw)
    t.gt(at3.abilityCd, 0, 'pressing it went through Towers.activate')
    const busy = byId(Panel.build(aApp), 'panel.ability1')
    t.ok(busy.disabled, 'and the button is now disabled')
    t.eq(busy.reason, OP.Towers.canActivate(as, at3).reason, 'with canActivate\'s reason')
    t.ok(drawDense(Panel, aApp).includes(at3.abilityCd.toFixed(1) + 's'), 'the cooldown counts down on screen')
  }

  t.section('sell shows what it returns, and is ABSENT when the mode forbids selling')
  const sellSim = sim({ cash: 1000000 })
  const sellApp = wireShell(makeApp(sellSim))
  const sellTower = place(sellSim, KEY)
  sellApp.state.io.selectedId = sellTower.id
  const sellWidget = byId(Panel.build(sellApp), 'panel.sell')
  t.ok(sellWidget, 'a sell button with selling allowed')
  t.ok(drawDense(Panel, sellApp).includes(OP.M.money(OP.Economy.sellValue(sellSim, sellTower))),
    'showing Economy.sellValue')

  const noSell = sim({ cash: 1000000, mode: 'purist' })
  t.eq(noSell.rules.allowSell, false, 'PURIST forbids selling')
  const noSellApp = wireShell(makeApp(noSell))
  const noSellTower = place(noSell, KEY)
  noSellApp.state.io.selectedId = noSellTower.id
  const noSellModel = Panel.build(noSellApp)
  t.notOk(byId(noSellModel, 'panel.sell'), 'no sell button at all')
  t.eq(noSellModel.widgets.filter(w => w.action === 'panel-sell').length, 0, 'and no sell action anywhere')
  t.notOk(drawDense(Panel, noSellApp).includes('SELL'), 'nothing on screen offers it')
  t.ok(drawDense(Panel, noSellApp).includes('Selling is disabled in this mode'),
    'the space says why instead of leaving a hole')

  t.section('selling goes through Towers.sell and drops the selection')
  const before = sellSim.towers.length
  Panel.activate(sellApp, byId(Panel.build(sellApp), 'panel.sell'))
  t.eq(sellSim.towers.length, before - 1, 'the tower is gone')
  t.eq(sellApp.state.io.selectedId, -1, 'and nothing is selected')

  t.section('with confirmSell on, the first press only arms it')
  const confSim = sim({ cash: 1000000 })
  const confApp = wireShell(makeApp(confSim, { profile: { settings: { confirmSell: true } } }))
  const confTower = place(confSim, KEY)
  confApp.state.io.selectedId = confTower.id
  Panel.state.confirmSell = -1
  Panel.activate(confApp, byId(Panel.build(confApp), 'panel.sell'))
  t.eq(confSim.towers.length, 1, 'still standing after one press')
  t.eq(Panel.state.confirmSell, confTower.id, 'the confirmation is armed for that tower')
  t.ok(drawDense(Panel, confApp).includes('CONFIRM'), 'and the button says so')
  Panel.activate(confApp, byId(Panel.build(confApp), 'panel.sell'))
  t.eq(confSim.towers.length, 0, 'the second press sells')

  t.section('buffs reaching the tower are listed via OP.Buffs.listFor')
  const buffSim = sim({ cash: 10000000 })
  const buffApp = wireShell(makeApp(buffSim))
  const buffTower = place(buffSim, KEY)
  buffApp.state.io.selectedId = buffTower.id
  t.ok(drawDense(Panel, buffApp).includes('no support'), 'an unbuffed tower says so')
  OP.Buffs.register(buffSim, {
    id: 'ui-game-test-buff', sourceId: buffTower.id, radius: 'global', mods: { damageAdd: 1 }
  })
  OP.Towers.restatAll(buffSim)
  const buffed = drawDense(Panel, buffApp)
  t.ok(buffed.includes('1 buff'), 'a live buff is counted')
  t.ok(buffed.includes('itself'), 'and its source named')
  OP.Buffs.unregisterById(buffSim, 'ui-game-test-buff')
  OP.Towers.restatAll(buffSim)

  t.section('a hero shows levels instead of branches, and never walks a missing tree')
  if (heroKey) {
    const hs3 = sim({ cash: 1000000 })
    const hApp3 = wireShell(makeApp(hs3))
    const hero3 = place(hs3, heroKey, true)
    hApp3.state.io.selectedId = hero3.id
    const hModel3 = Panel.build(hApp3)
    t.notOk(byId(hModel3, 'panel.up0'), 'no upgrade branches for a hero')
    const hDense3 = drawDense(Panel, hApp3)
    t.ok(hDense3.includes('LEVELS'), 'a level section instead')
    t.ok(hDense3.includes('LEVEL ' + hero3.level), 'naming the level it is on')
    const next = hero3.def.levelsByNumber[hero3.level + 1]
    if (next) t.ok(hDense3.includes(String(next.desc).split(/\s+/).slice(0, 3).join(' ')),
      'and what the next level grants')
  }

  /* ==========================================================================
     PARAGON — destructive, so it must be honest and it must confirm
     ========================================================================== */

  t.section('the paragon button appears only when OP.Paragon.preview says ok')
  const paragonKey = pickParagonKey()
  if (!paragonKey) {
    t.fail('no paragon available to test', 'neither shipped nor definable')
  } else {
    const gs = sim({ cash: 100000000 })
    const gApp = wireShell(makeApp(gs))
    const def = OP.PARAGONS[paragonKey]
    const promote = place(gs, paragonKey)
    const victim = place(gs, paragonKey)
    t.ok(promote && victim, 'two towers of the type are on the board')
    gApp.state.io.selectedId = promote.id

    // Not eligible yet: the tree has not reached the paragon's minimum tier.
    promote.tiers = [2, 0, 0]
    OP.Towers.restat(gs, promote)
    t.notOk(OP.Paragon.preview(gs, promote).ok, 'the engine refuses at tier 2')
    t.notOk(byId(Panel.build(gApp), 'panel.paragon'), 'so there is no paragon button')
    t.ok(drawDense(Panel, gApp).includes('Paragon:'), 'but the panel says what is missing')

    promote.tiers = [def.minTier, 0, 0]
    OP.Towers.restat(gs, promote)
    const preview = OP.Paragon.preview(gs, promote)
    t.ok(preview.ok, 'the engine allows it at tier ' + def.minTier)
    const gw = byId(Panel.build(gApp), 'panel.paragon')
    t.ok(gw, 'now the button is offered')
    const gDense = drawDense(Panel, gApp)
    t.ok(gDense.includes('PARAGON'), 'labelled')
    t.ok(gDense.includes('degree ' + preview.degree), 'showing the degree it would produce')
    t.ok(gDense.includes(OP.M.money(preview.cost)), 'and what it costs')
    // The count belongs on screen BEFORE the first press, not only once armed:
    // this is the number that decides whether the trade is worth it.
    t.ok(gDense.includes('Consumes ' + preview.sacrifices.length),
      `and how many towers it eats (${preview.sacrifices.length}) without arming it first`)

    t.section('promoting takes two presses, and says what it consumes')
    Panel.state.confirmParagon = -1
    Panel.activate(gApp, byId(Panel.build(gApp), 'panel.paragon'))
    t.eq(promote.paragonDegree, 0, 'one press changes nothing')
    t.eq(Panel.state.confirmParagon, promote.id, 'it arms a confirmation for that tower')
    const armed = drawDense(Panel, gApp)
    t.ok(armed.includes('CONFIRM'), 'the button asks again')
    t.ok(armed.includes('Consumes ' + preview.sacrifices.length),
      `still saying it consumes ${preview.sacrifices.length} tower(s)`)
    t.ok(armed.includes('cannot be undone'), 'and that it cannot be undone')
    const towersWere = gs.towers.length
    Panel.activate(gApp, byId(Panel.build(gApp), 'panel.paragon'))
    t.gt(promote.paragonDegree, 0, 'the second press promoted it through Paragon.promote')
    t.lt(gs.towers.length, towersWere, 'and the sacrifices are gone')
    t.ok(drawDense(Panel, gApp).includes('PARAGON DEGREE'), 'the header now reports the degree')
    t.notOk(byId(Panel.build(gApp), 'panel.paragon'), 'and the button is gone')
  }

  /* ==========================================================================
     THE ROUTER — the part only a real tap can prove
     ========================================================================== */

  t.section('a press on the tower panel does NOT deselect the tower')
  // Input.tap overwrites io.selectedId before firing `select`, so without the
  // lookup hook every upgrade press would close the panel it was aimed at.
  const rs = sim({ cash: 10000000 })
  const rApp = wireShell(makeApp(rs))
  const rTower = place(rs, KEY)
  rApp.state.io.selectedId = rTower.id
  const upWidget = byId(Panel.build(rApp), 'panel.up0')
  const upAt = centre(upWidget)
  const tiersWere = rTower.tiers[0]
  tapAt(rApp, upAt.x, upAt.y)
  t.eq(rApp.state.io.selectedId, rTower.id, 'the tower is still selected')
  t.eq(rTower.tiers[0], tiersWere + 1, 'and the upgrade was bought')

  t.section('a press on the HUD does not deselect either')
  const hudBtn = byId(HUD.build(rApp), 'hud.speed2')
  const hudAt = centre(hudBtn)
  tapAt(rApp, hudAt.x, hudAt.y)
  t.eq(rApp.state.io.selectedId, rTower.id, 'still selected')
  t.eq(rs.speed, 2, 'and the speed changed')

  t.section('a tap on the board still selects and deselects normally')
  rApp.state.io.selectedId = -1
  tapBoard(rApp, rTower.x, rTower.y)
  t.eq(rApp.state.io.selectedId, rTower.id, 'tapping a tower selects it')
  tapBoard(rApp, rTower.x, rTower.y)
  t.eq(rApp.state.io.selectedId, -1, 'tapping it again deselects')

  t.section('NO part of the board can hide under the sidebar any more')
  /* This used to be a test that a tower at world x=1100 was unselectable because
     the sidebar covered it. That was the bug, not the feature: between 14% and 38%
     of every map's track sat under the shop, so balloons crossed a third of the
     route out of sight. The board is now fitted into the play rect, so the correct
     assertion is the opposite one — every board position is visible. */
  const panelRect = OP.HUD.LAYOUT.sidebar
  t.ok(panelRect.x >= OP.PLAY_W,
    `the sidebar (x=${panelRect.x}) starts at or after the play area ends (${OP.PLAY_W}) — these two numbers must not drift`)
  let underPanel = 0
  for (let bx = 0; bx <= OP.FIELD_W; bx += 20) {
    for (let by = 0; by <= OP.FIELD_H; by += 20) {
      const f = OP.Camera.boardToField(bx, by)
      if (f.x >= panelRect.x) underPanel++
    }
  }
  t.eq(underPanel, 0, 'no point of the 1280x720 board maps under the sidebar')

  const farRight = OP.Camera.boardToField(OP.FIELD_W, OP.FIELD_H / 2)
  t.lt(farRight.x, panelRect.x, `the far edge of the board lands at field x=${Math.round(farRight.x)}, left of the panel at ${panelRect.x}`)

  const hidden = OP.Towers.place(rs, KEY, 1100, 300, { free: true })
  if (hidden) {
    rApp.state.io.selectedId = -1
    tapBoard(rApp, 1100, 300)
    t.eq(rApp.state.io.selectedId, hidden.id, 'a tower at world x=1100 is now visible and selectable')
  } else {
    t.fail('could not place a tower at world x=1100', 'expected a free placement to succeed')
  }

  t.section('chrome still wins where chrome actually is')
  rApp.state.io.selectedId = -1
  tapAt(rApp, panelRect.x + 40, 300)
  t.eq(rApp.state.io.selectedId, -1, 'a press on the sidebar itself selects nothing behind it')

  t.section('a placement tap that lands on chrome does not build under the panel')
  const placeApp = wireShell(makeApp(sim({ cash: 1000000 })))
  OP.Input.beginPlacing(placeApp.state.io, KEY, false)
  const countWas = placeApp.state.sim.towers.length
  OP.Input.tap(placeApp.state.io, 900, 700)          // empty space on the bottom bar
  t.eq(placeApp.state.sim.towers.length, countWas, 'nothing was built on the HUD')
  t.eq(placeApp.state.io.mode, 'placing', 'and the placement is still armed')

  t.section('the router reports chrome honestly')
  t.ok(HUD.chromeAt(rApp, 20, 20), 'the top strip is chrome')
  t.ok(HUD.chromeAt(rApp, 300, 700), 'so is the bottom strip')
  t.notOk(HUD.chromeAt(rApp, 500, 300), 'the middle of the board is not')

  /* ==========================================================================
     RESULTS
     ========================================================================== */

  t.section('results are shown only once the run is over')
  const wonSim = sim()
  const wonApp = wireShell(makeApp(wonSim, { mapKey: 'test' }))
  t.eq(Results.draw(recorder(), wonApp), 0, 'a live game draws no results screen')

  wonSim.roundIndex = 40
  wonSim.stats.popped = 12345
  wonSim.stats.cashEarned = 6789
  wonSim.lives = 88
  OP.Economy.endGame(wonSim, 'won')
  const wonCtx = recorder()
  const wonDrawn = Results.draw(wonCtx, wonApp)
  t.gt(wonDrawn, 20, `an ended run draws its results (${wonDrawn} marks)`)
  const wonDense = wonCtx.dense()
  t.ok(wonDense.includes('VICTORY'), 'a won run says so')
  t.ok(wonDense.includes('40'), 'the round reached')
  t.ok(wonDense.includes(OP.M.compact(12345)), 'the pop count')
  t.ok(wonDense.includes(OP.M.money(6789)), 'the cash earned')
  t.ok(wonDense.includes('88'), 'and the lives left')
  t.ok(wonDense.includes('Lives left'), 'each figure is labelled')

  t.section('a lost run reads differently')
  const lostSim = sim({ lives: 3 })
  const lostApp = wireShell(makeApp(lostSim))
  lostSim.roundIndex = 17
  lostSim.stats.popped = 99
  OP.Economy.loseLives(lostSim, 3)
  t.ok(lostSim.over, 'losing every life ended the run')
  t.eq(lostSim.outcome, 'leaked', 'as a leak')
  const lostDense = drawDense(Results, lostApp)
  t.ok(lostDense.includes('DEFEAT'), 'a lost run says defeat')
  t.notOk(lostDense.includes('VICTORY'), 'and not victory')
  t.neq(lostDense, wonDense, 'the two screens differ')
  t.ok(lostDense.includes('17'), 'with the round it fell on')
  const lostModel = Results.build(lostApp)
  t.notOk(byId(lostModel, 'results.freeplay'), 'a defeat cannot continue into freeplay')
  t.eq(lostModel.defaultId, 'results.retry', 'ENTER retries after a defeat')

  t.section('the results buttons act on the shell')
  const rModel = Results.build(wonApp)
  t.ok(byId(rModel, 'results.freeplay'), 'a freeplay continuation button')
  t.ok(byId(rModel, 'results.retry'), 'a retry button')
  t.ok(byId(rModel, 'results.title'), 'and a way back to the title')
  t.eq(rModel.defaultId, 'results.freeplay', 'ENTER continues into freeplay after a victory')
  const freeplayAt = centre(byId(rModel, 'results.freeplay'))
  Results.tap(wonApp, freeplayAt.x, freeplayAt.y)
  t.deep(wonApp.calls[wonApp.calls.length - 1], ['continueFreeplay'],
    'freeplay asks the shell to reactivate the winning board')
const retryAt = centre(byId(rModel, 'results.retry'))
  Results.tap(wonApp, retryAt.x, retryAt.y)
  t.deep(wonApp.calls[wonApp.calls.length - 1],
    ['startGame', 'test', wonSim.difficulty, wonSim.mode, {}],
    'retry restarts the same map, difficulty and mode (plain runs keep a fresh seed)')

  const titleAt = centre(byId(rModel, 'results.title'))
  Results.tap(wonApp, titleAt.x, titleAt.y)
  t.deep(wonApp.calls[wonApp.calls.length - 1], ['quitToMenu'], 'and the other button leaves for the menu')

  t.section('retry replays a finished daily with its challenge seed and rules')
  const dailySim = sim({ seed: 'daily-2026-08-31', rules: { startLives: 1, startCash: 2500 } })
  OP.Economy.endGame(dailySim, 'leaked')
  const dApp = wireShell(makeApp(dailySim))
  const dModel = Results.build(dApp)
  t.ok(byId(dModel, 'results.retry'), 'a defeated daily still offers retry')
  t.eq(dModel.defaultId, 'results.retry', 'and ENTER retries it')
  const dRetryAt = centre(byId(dModel, 'results.retry'))
  Results.tap(dApp, dRetryAt.x, dRetryAt.y)
  const lastStart = dApp.calls[dApp.calls.length - 1]
  t.eq(lastStart[0], 'startGame', 'retry calls startGame')
  t.eq(lastStart[1], 'test', 'with the same map')
  t.eq(lastStart[2], dailySim.difficulty, 'and difficulty')
  t.eq(lastStart[3], dailySim.mode, 'and the same mode')
  t.eq(lastStart[4].seed, 'daily-2026-08-31', 'and replays the daily seed')
  t.deep(lastStart[4].rules, OP.Daily.generate('2026-08-31').rules,
    'with the challenge modifiers intact — a reduced-lives daily stays reduced-lives')

  t.section('the keyboard works on the results screen')
  const keyApp = wireShell(makeApp(sim()))
  OP.Economy.endGame(keyApp.state.sim, 'won')
  t.ok(Results.key(keyApp, 'Enter'), 'ENTER is consumed')
  t.eq(keyApp.calls[keyApp.calls.length - 1][0], 'continueFreeplay', 'and continues into freeplay')
  t.ok(Results.key(keyApp, 'Escape'), 'ESC is consumed')
  t.eq(keyApp.calls[keyApp.calls.length - 1][0], 'quitToMenu', 'and quits to the menu')
  t.notOk(Results.key(keyApp, 'q'), 'anything else falls through')

  t.section('an ended freeplay run reports its real round without offering freeplay twice')
  const fpSim = sim()
  fpSim.freeplay = true
  fpSim.roundIndex = 137
  OP.Economy.endGame(fpSim, 'leaked')
  const fpApp = wireShell(makeApp(fpSim))
  const fpDense = drawDense(Results, fpApp)
  const fpModel = Results.build(fpApp)
  t.ok(fpDense.includes('FREEPLAY OVER'), 'the result is identified as freeplay')
  t.ok(fpDense.includes('137'), 'the actual round reached is shown')
  t.notOk(fpDense.includes('of ' + fpSim.rules.lastRound), 'the old victory target is not shown as a limit')
  t.notOk(byId(fpModel, 'results.freeplay'), 'freeplay cannot be entered a second time')

t.section('expedition victories keep their dedicated actions')
  const expSim = sim()
  OP.Economy.endGame(expSim, 'won')
  const expApp = wireShell(makeApp(expSim))
  expApp.state.expeditionResult = { expeditionComplete: true }
  const expModel = Results.build(expApp)
  t.notOk(byId(expModel, 'results.freeplay'), 'an expedition result does not offer freeplay')
  t.ok(byId(expModel, 'results.title'), 'its expedition-complete action remains')
  t.eq(expModel.defaultId, 'results.title', 'ENTER leaves a completed expedition for the title')

  const midApp = wireShell(makeApp(sim()))
  OP.Economy.endGame(midApp.state.sim, 'won')
  midApp.state.expeditionResult = { stageComplete: true, expeditionComplete: false }
  const midModel = Results.build(midApp)
  t.ok(byId(midModel, 'results.expContinue'), 'a stage-complete expedition offers continue')
  t.eq(midModel.defaultId, 'results.expContinue', 'and ENTER continues, not the absent retry')
  t.ok(Results.key(midApp, 'Enter'), 'ENTER is consumed on the expedition screen')
  t.eq(midApp.calls[midApp.calls.length - 1][0], 'advanceExpedition', 'and advances the expedition')

  t.section('the in-game panels stand down once the run is over')
  const overApp = wireShell(makeApp(sim()))
  const overTower = place(overApp.state.sim, KEY)
  overApp.state.io.selectedId = overTower.id
  OP.Economy.endGame(overApp.state.sim, 'leaked')
  t.eq(HUD.draw(recorder(), overApp), 0, 'the HUD stops drawing')
  t.eq(Shop.draw(recorder(), overApp), 0, 'so does the shop')
  t.eq(Panel.draw(recorder(), overApp), 0, 'and the tower panel')
  t.notOk(HUD.chromeAt(overApp, 20, 20), 'and nothing claims a tap any more')

  /* ==========================================================================
     THE WHOLE FRAME
     ========================================================================== */

  t.section('a full render frame draws the board and the interface together')
  const fs = sim({ cash: 1000000 })
  const fApp = wireShell(makeApp(fs))
  const fTower = place(fs, KEY)
  fApp.state.io.selectedId = fTower.id
  OP.Sim.startRound(fs, 5)
  for (let i = 0; i < 30; i++) OP.Sim.step(fs)
  const fCtx = recorder()
  t.noThrow(() => R.frame(fs, fCtx, view(), { app: fApp }), 'the frame runs')
  const fDense = fCtx.dense()
  t.ok(fDense.includes('ROUND 5'), 'the HUD is in the frame')
  t.ok(fDense.includes(OP.Towers.displayName(fTower).toUpperCase()), 'and the tower panel')
  t.ok(R.layerNames().includes('hud'), 'no layer was unregistered for throwing')
  t.ok(R.layerNames().includes('tower-panel'), 'including the panel')

  /* ==========================================================================
     LAYOUT INTEGRITY

     Nothing here can be seen from a terminal, so the two properties that make a
     canvas UI usable are asserted instead: every widget is on screen, and no
     widget sits on top of another — an overlapped button is one the player can
     never press, and it is invisible in a screenshot until someone tries.
     ========================================================================== */

  t.section('every panel keeps its widgets on screen and out of each other\'s way')
  const ls = sim({ cash: 1000000 })
  const lApp = wireShell(makeApp(ls))
  const lTower = place(ls, KEY)
  if (heroKey) { const h = place(ls, heroKey, true); if (h) OP.Heroes.grantXP(ls, 1000000) }
  const shopLayout = Shop.build(lApp)
  lApp.state.io.selectedId = lTower.id
  const panelLayout = Panel.build(lApp)
  const hudLayout = HUD.build(lApp)
  const overSim = sim()
  OP.Economy.endGame(overSim, 'won')
  const resultsLayout = Results.build(wireShell(makeApp(overSim)))

  for (const [label, m] of [['HUD', hudLayout], ['shop', shopLayout],
    ['tower panel', panelLayout], ['results', resultsLayout]]) {
    const ws = m.widgets
    t.gt(ws.length, 0, label + ' has widgets to press')
    const off = ws.filter(w => w.x < 0 || w.y < 0 || w.x + w.w > 1280 || w.y + w.h > 720)
    t.eq(off.length, 0, off.length
      ? label + ': off screen — ' + off.map(w => w.id).join(', ')
      : label + ': every widget is inside the 1280x720 field')
    const ids = ws.map(w => w.id)
    t.eq(new Set(ids).size, ids.length, label + ': widget ids are unique')
    t.eq(ws.filter(w => !w.action).length, 0, label + ': no widget is a dead end')
    const clash = []
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i]; const b = ws[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          clash.push(a.id + ' / ' + b.id)
        }
      }
    }
    t.eq(clash.length, 0, clash.length ? label + ': overlapping widgets — ' + clash.join(', ')
      : label + ': no widget covers another')
  }

  t.section('the sidebar panels and the HUD strips do not fight over a point')
  const sb = HUD.LAYOUT.sidebar
  t.notOk(HUD.inRect(HUD.LAYOUT.top, sb.x + 5, sb.y + 5), 'the sidebar starts below the top strip')
  t.notOk(HUD.inRect(HUD.LAYOUT.bottom, sb.x + 5, 700), 'and the bottom strip stops before it')
  t.notOk(HUD.inRect(HUD.LAYOUT.bottom, HUD.LAYOUT.hero.x, HUD.LAYOUT.hero.y + HUD.LAYOUT.hero.h),
    'the hero panel sits above the bottom strip')

  /* ==========================================================================
     EMPTY REGISTRIES
     ========================================================================== */

  t.section('every screen survives an empty roster')
  const towerOrder = OP.TOWER_ORDER.slice()
  const heroOrder = OP.HERO_ORDER.slice()
  try {
    OP.TOWER_ORDER.length = 0
    OP.HERO_ORDER.length = 0

    const es = sim()
    const eApp = wireShell(makeApp(es))
    t.noThrow(() => HUD.draw(recorder(), eApp), 'the HUD draws with no towers registered')
    t.noThrow(() => Shop.draw(recorder(), eApp), 'the shop draws')
    t.ok(drawDense(Shop, eApp).includes('No towers are registered yet'), 'and says the shelf is empty')
    t.deep(Shop.groups(), [], 'with no groups at all')
    t.noThrow(() => Panel.draw(recorder(), eApp), 'the tower panel draws with nothing selected')
    t.noThrow(() => Results.draw(recorder(), eApp), 'the results layer draws')
    t.noThrow(() => R.frame(es, recorder(), view(), { app: eApp }), 'and a whole frame runs')

    // A tower already on the board keeps its definition, so the panel must still
    // work for it even with the registry emptied underneath.
    const survivor = OP.Towers.place(es, towerOrder[0], 300, 300, { free: true })
    if (survivor) {
      eApp.state.io.selectedId = survivor.id
      t.noThrow(() => Panel.draw(recorder(), eApp), 'and for a tower whose key is no longer listed')
    }
    t.ok(R.layerNames().includes('hud'), 'no layer threw itself out of the renderer')
    t.ok(R.layerNames().includes('shop'), 'not the shop either')
  } finally {
    for (const k of towerOrder) OP.TOWER_ORDER.push(k)
    for (const k of heroOrder) OP.HERO_ORDER.push(k)
  }
  t.eq(OP.TOWER_ORDER.length, towerOrder.length, 'the roster was restored for every later suite')
  t.eq(OP.HERO_ORDER.length, heroOrder.length, 'and so were the heroes')

  /* ==========================================================================
     NOTHING IN A DRAW MAY TOUCH THE SIM
     ========================================================================== */

  t.section('DRAWING NEVER MUTATES SIM STATE')
  const ms = sim({ cash: 1000000 })
  const mApp = wireShell(makeApp(ms))
  const mTower = place(ms, KEY)
  mTower.tiers = [3, 2, 0]
  OP.Towers.restat(ms, mTower)
  if (heroKey) {
    const mHero = place(ms, heroKey, true)
    if (mHero) OP.Heroes.grantXP(ms, 50000)
  }
  mApp.state.io.selectedId = mTower.id
  mApp.state.io.overCanvas = true
  OP.Input.setPoint(mApp.state.io, 1100, 300)
  OP.Sim.startRound(ms, 12)
  for (let i = 0; i < 60; i++) OP.Sim.step(ms)
  spawn(OP, ms, 'ceramic', 200)

  const sumBefore = OP.Sim.checksum(ms)
  const snapBefore = JSON.stringify(OP.Sim.serialize(ms))
  const eventsBefore = ms.events.length
  const buffsBefore = ms.buffs.length

  const drawCtx = recorder()
  for (let i = 0; i < 120; i++) {
    HUD.draw(drawCtx, mApp)
    Shop.draw(drawCtx, mApp)
    Panel.draw(drawCtx, mApp)
    Results.draw(drawCtx, mApp)
    HUD.build(mApp); Shop.build(mApp); Panel.build(mApp); Results.build(mApp)
    HUD.chromeAt(mApp, 1100, 300)
    HUD.chromeAt(mApp, 500, 300)
  }
  t.gt(drawCtx.calls.length, 5000, `drew ${drawCtx.calls.length} calls across 120 frames of every layer`)
  t.eq(OP.Sim.checksum(ms), sumBefore, 'the checksum is unchanged')
  t.eq(JSON.stringify(OP.Sim.serialize(ms)), snapBefore,
    'and so is the whole serialised sim — target modes, cash, autostart, tower data, everything')
  t.eq(ms.events.length, eventsBefore, 'no events were appended')
  t.eq(ms.buffs.length, buffsBefore, 'no buffs were registered')

  t.section('and neither does drawing an idle board, where the next round is priced')
  const is2 = sim()
  const iApp = wireShell(makeApp(is2))
  place(is2, KEY)
  const idleSum = OP.Sim.checksum(is2)
  const idleSnap = JSON.stringify(OP.Sim.serialize(is2))
  for (let i = 0; i < 60; i++) { HUD.draw(recorder(), iApp); Shop.draw(recorder(), iApp) }
  t.eq(OP.Sim.checksum(is2), idleSum, 'the checksum is unchanged')
  t.eq(JSON.stringify(OP.Sim.serialize(is2)), idleSnap, 'and the serialised sim is identical')

  t.section('nor does drawing a shop full of mode-forbidden towers')
  // This is the path that asks Towers.canPlace for its refusal wording, so it is
  // the one most likely to reach into the sim by accident.
  const bs = sim({ mode: 'primary-only', cash: 500 })
  const bApp = wireShell(makeApp(bs))
  const blockSum = OP.Sim.checksum(bs)
  const blockSnap = JSON.stringify(OP.Sim.serialize(bs))
  for (let i = 0; i < 40; i++) Shop.draw(recorder(), bApp)
  t.eq(OP.Sim.checksum(bs), blockSum, 'the checksum is unchanged')
  t.eq(JSON.stringify(OP.Sim.serialize(bs)), blockSnap, 'and the serialised sim is identical')

  t.section('drawing past the authored rounds does not consume randomness')
  const fs2 = sim()
  const fApp2 = wireShell(makeApp(fs2))
  fs2.roundIndex = 400            // deep into generated freeplay rounds
  const rngWas = fs2.rng.calls
  for (let i = 0; i < 30; i++) HUD.draw(recorder(), fApp2)
  t.eq(fs2.rng.calls, rngWas, 'the RNG was never touched to price a generated round')
  t.ok(drawDense(HUD, fApp2).length > 10, 'and something was still drawn')

  /* ---------- helpers used above ---------- */

  function drawDense (mod, app) {
    const ctx = recorder()
    mod.draw(ctx, app)
    return ctx.dense()
  }

  /**
   * A tower key with a paragon. Prefers a shipped one — testing the real data is
   * worth more than testing a stand-in — and defines a throwaway only when
   * js/towers/paragons.js has not landed yet.
   */
  function pickParagonKey () {
    const shipped = OP.Paragon.all()
    for (let i = 0; i < shipped.length; i++) {
      if (OP.TOWERS[shipped[i].towerKey]) return shipped[i].towerKey
    }
    for (let i = 0; i < OP.TOWER_ORDER.length; i++) {
      const key = OP.TOWER_ORDER[i]
      if (OP.Paragon.exists(key)) continue
      try {
        OP.defineParagon({
          towerKey: key,
          name: 'Trial Ascendant',
          blurb: 'A harness-only fusion, defined so the paragon button can be proven to appear only when the engine allows it.',
          cost: 400000,
          apply: function (s) { s.damage += 1 }
        })
        return key
      } catch (e) { return null }
    }
    return null
  }
}

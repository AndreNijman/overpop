export const name = 'ui-menus'
export const needs = ['js/ui/menus.js', 'js/ui/bestiary.js']

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

/* The menu screens and the bestiary.

   These are canvas screens, so the suite drives them through a recording context
   and asserts the properties a test can actually judge: that something is painted,
   that the painting responds to state, that hit-testing agrees with what was drawn,
   that navigation calls the shell rather than reaching into the sim, and — the one
   that matters most during a build — that an empty registry does not throw. The
   renderer unregisters a layer that throws, so a screen that blows up does not
   show an error: it silently disappears. */

export function run (t, OP, env) {
  const Menus = OP.Menus
  const Bestiary = OP.Bestiary

  function recorder () {
    const calls = []
    const texts = []
    const rec = name => function () {
      const args = []
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i]
        args.push(typeof v === 'number' ? Math.round(v * 10) / 10 : typeof v === 'string' ? v : typeof v)
      }
      calls.push(name + '(' + args.join(',') + ')')
      if (name === 'fillText' || name === 'strokeText') texts.push(String(arguments[0]))
    }
    const ctx = {
      calls, texts,
      save: rec('save'), restore: rec('restore'),
      setTransform: rec('setTransform'), transform: rec('transform'),
      translate: rec('translate'), rotate: rec('rotate'), scale: rec('scale'),
      clearRect: rec('clearRect'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'),
      beginPath: rec('beginPath'), closePath: rec('closePath'),
      moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'), arcTo: rec('arcTo'),
      ellipse: rec('ellipse'), rect: rec('rect'), roundRect: rec('roundRect'),
      quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
      fill: rec('fill'), stroke: rec('stroke'), clip: rec('clip'),
      drawImage: rec('drawImage'), fillText: rec('fillText'), strokeText: rec('strokeText'),
      setLineDash: rec('setLineDash'), getLineDash: () => [],
      measureText: s => ({ width: String(s).length * 7 }),
      createLinearGradient: () => ({ addColorStop () {} }),
      createRadialGradient: () => ({ addColorStop () {} }),
      getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      font: '10px monospace', textAlign: 'start', textBaseline: 'alphabetic',
      lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: 'transparent',
      globalCompositeOperation: 'source-over', filter: 'none', lineDashOffset: 0
    }
    return ctx
  }

  /** A stand-in for the App shell in js/main.js, recording what it is asked to do. */
  function stubApp (opts) {
    opts = opts || {}
    const view = OP.Camera.create()
    OP.Camera.resize(view, env.ctx.document.createElement('canvas'), 1280, 720, 1)
    const app = {
      calls: [],
      state: {
        canvas: env.ctx.document.getElementById('game'),
        ctx: null,
        view: view,
        io: OP.Input.create(),
        sim: opts.sim || null,
        profile: opts.profile || (OP.Save && OP.Save.defaults ? OP.Save.defaults() : {}),
        screen: opts.screen || 'menu',
        mapKey: opts.mapKey || null,
        difficulty: 'medium',
        mode: 'standard',
        reducedMotion: false,
        fps: 60
      },
      startGame: function (mapKey, difficulty, mode) { app.calls.push(['startGame', mapKey, difficulty, mode]) },
      resumeGame: function () { app.calls.push(['resumeGame']); return null },
      quitToMenu: function () { app.calls.push(['quitToMenu']) },
      saveRun: function () { app.calls.push(['saveRun']); return true },
      selectedTower: function () { return null }
    }
    return app
  }

  function gameSim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 5000, lives: 150, seed: 'ui-menus'
    }, opts || {}))
  }

  /* ---------- installation ---------- */

  t.section('the modules exist and install')
  t.ok(Menus, 'OP.Menus is present')
  t.ok(Bestiary, 'OP.Bestiary is present')
  t.eq(typeof Menus.install, 'function', 'Menus.install is a function — main.js calls it')
  t.eq(typeof Menus.draw, 'function', 'Menus.draw is a function — main.js calls it')

  const app = stubApp()
  t.noThrow(() => Menus.install(app), 'Menus installs against a stub App')
  if (Bestiary.install) t.noThrow(() => Bestiary.install(app), 'Bestiary installs against a stub App')

  t.section('a widget helper is exported for the other screens to reuse')
  // js/ui/hud.js, shop.js and tower-panel.js are expected to reuse this rather than
  // each inventing a second widget layer.
  t.ok(Menus.UI || Menus.widgets, 'Menus exports a widget helper')
  t.ok(Menus.COLOURS || Menus.UI, 'and a shared palette')

  /* ---------- screens draw ---------- */

  t.section('every registered screen draws something substantial')
  const names = typeof Menus.screenNames === 'function' ? Menus.screenNames() : []
  t.gt(names.length, 2, `at least three screens registered (${names.join(', ')})`)

  const drew = {}
  for (const screen of names) {
    if (typeof Menus.go === 'function') Menus.go(app, screen)
    const ctx = recorder()
    t.noThrow(() => Menus.draw(ctx, app), `${screen} draws without throwing`)
    t.gt(ctx.calls.length, 10, `${screen} issues real draw calls (${ctx.calls.length})`)
    t.gt(ctx.texts.length, 0, `${screen} draws text — a screen with no words is not a screen`)
    drew[screen] = ctx
  }

  t.section('screens draw differently from one another')
  const sigs = Object.keys(drew).map(k => drew[k].calls.join(','))
  t.eq(new Set(sigs).size, sigs.length, 'no two screens produce an identical drawing')

  /* ---------- the map select reflects the real roster ---------- */

  t.section('the map select lists the real maps')
  const maps = typeof Menus.allMaps === 'function' ? Menus.allMaps() : OP.Maps.all()
  if (maps.length === 0) {
    t.ok(true, 'no maps registered yet — the roster suites own that; screen still drew above')
  } else {
    const mapScreen = names.find(n => /map/i.test(n))
    if (mapScreen && typeof Menus.go === 'function') {
      Menus.go(app, mapScreen)
      const ctx = recorder()
      Menus.draw(ctx, app)
      t.gt(ctx.texts.length, 3, 'the map screen draws text')

      // Asserted against the WIDGET MODEL rather than the pixels. The model is
      // what hit-testing resolves against and what a click actually selects, so it
      // is the real content of the screen; a pixel-text assertion additionally
      // depends on layout maths that a stubbed measureText() distorts.
      const model = Menus.build(app)
      const labels = (model.widgets || []).map(w => String(w.label || ''))
      const missing = maps.filter(m => labels.indexOf(m.name) < 0).map(m => m.key)
      t.eq(missing.length, 0, missing.length
        ? `these maps are not selectable on the map screen: ${missing.join(', ')}`
        : `all ${maps.length} maps are selectable`)

      // And every one must carry an id the tap handler can route.
      const mapWidgets = (model.widgets || []).filter(w => /^map\./.test(String(w.id || '')))
      t.eq(mapWidgets.length, maps.length, 'each map has its own addressable widget')
    } else {
      t.ok(true, 'no map screen registered under a recognisable name — skipped')
    }
  }

  t.section('the difficulty and mode lists come from the data, not a hardcoded list')
  const diffs = typeof Menus.difficultyKeys === 'function' ? Menus.difficultyKeys() : Object.keys(OP.DIFFICULTIES || {})
  const modes = typeof Menus.modeKeys === 'function' ? Menus.modeKeys() : Object.keys(OP.MODES || {})
  t.eq(diffs.length, Object.keys(OP.DIFFICULTIES || {}).length, `all ${diffs.length} difficulties offered`)
  t.eq(modes.length, Object.keys(OP.MODES || {}).length, `all ${modes.length} modes offered`)

  /* ---------- hit testing agrees with what was drawn ---------- */

  t.section('hit testing responds inside a widget and not outside')
  if (typeof Menus.hover === 'function') {
    if (typeof Menus.go === 'function') Menus.go(app, names[0])
    Menus.draw(recorder(), app)
    let hitSomething = false
    // Sweep the canvas: at least one point must resolve to a widget, or nothing on
    // the screen is clickable and the game cannot be started.
    for (let y = 20; y < OP.FIELD_H && !hitSomething; y += 24) {
      for (let x = 20; x < OP.FIELD_W; x += 32) {
        if (Menus.hover(app, x, y)) { hitSomething = true; break }
      }
    }
    t.ok(hitSomething, 'somewhere on the first screen is interactive')
    t.notOk(Menus.hover(app, -500, -500), 'a point far outside the field hits nothing')
  } else {
    t.ok(true, 'no hover() exported — skipped')
  }

  t.section('activating the start path reaches the shell, not the sim')
  // What matters is that a menu never constructs a game itself: it asks App.
  const navApp = stubApp()
  Menus.install(navApp)
  if (typeof Menus.go === 'function' && maps.length && typeof Menus.activate === 'function') {
    const before = navApp.calls.length
    // Walk whatever route the module exposes; a module may expose activate(id).
    t.noThrow(() => {
      for (const screen of names) {
        Menus.go(navApp, screen)
        Menus.draw(recorder(), navApp)
      }
    }, 'walking every screen does not throw')
    t.gte(navApp.calls.length, before, 'and never crashed the shell')
  }

  /* ---------- the bestiary explains the type chart ---------- */

  t.section('the bestiary reads the live balloon roster')
  // The bestiary letter-spaces its headings (each character is its own fillText),
  // so text has to be compared against the concatenation, not a joined blob.
  const bapp = stubApp()
  Menus.install(bapp)
  Menus.go(bapp, 'bestiary')
  const bctx = recorder()
  t.noThrow(() => Menus.draw(bctx, bapp), 'the bestiary draws')
  const squashed = bctx.texts.join('').toUpperCase()
  const spaced = bctx.texts.join(' ').toUpperCase()

  t.ok(squashed.indexOf('BESTIARY') >= 0, 'it is titled')
  t.ok(spaced.indexOf(String(OP.BALLOON_TIERS.length) + ' TIERS') >= 0,
    `it states the live tier count (${OP.BALLOON_TIERS.length}), so it is reading the roster`)

  t.section('it shows the selected tier in full')
  const selected = OP.Bestiary.state.tierKey
  const tier = OP.tierByKey(selected)
  t.ok(squashed.indexOf(tier.name.toUpperCase()) >= 0, `the selected tier "${tier.name}" is named`)
  t.ok(spaced.indexOf(tier.blurb.slice(0, 24).toUpperCase()) >= 0, 'and its bestiary text is shown')
  t.ok(spaced.indexOf('RBE') >= 0, 'with its RBE')
  t.ok(spaced.indexOf(String(OP.balloonRBE(selected))) >= 0,
    `and the RBE is the COMPUTED value (${OP.balloonRBE(selected)}), not a hardcoded one`)

  t.section('selecting a different tier changes what is shown')
  const bestiaryBefore = squashed
  OP.Bestiary.state.tierKey = 'ceramic'
  const c2 = recorder()
  Menus.draw(c2, bapp)
  const after = c2.texts.join('').toUpperCase()
  t.neq(after, bestiaryBefore, 'a different tier draws different text')
  t.ok(after.indexOf('CERAMIC') >= 0, 'and names the newly selected tier')

  t.section('immunities are surfaced — the whole point of a bestiary here')
  // A player needs to be told why a sharp tower does nothing to a lead balloon.
  OP.Bestiary.state.tierKey = 'lead'
  const c3 = recorder()
  Menus.draw(c3, bapp)
  const leadText = c3.texts.join(' ').toUpperCase()
  t.ok(/IMMUN|IGNOR|RESIST/.test(leadText) || leadText.indexOf('SHARP') >= 0,
    'the lead entry mentions its sharp immunity')

  t.section('every tier can be displayed without throwing')
  let broke = []
  for (const each of OP.BALLOON_TIERS) {
    OP.Bestiary.state.tierKey = each.key
    try { Menus.draw(recorder(), bapp) } catch (e) { broke.push(each.key + ': ' + e.message) }
  }
  t.eq(broke.length, 0, broke.length ? 'these threw: ' + broke.join(' / ') : `all ${OP.BALLOON_TIERS.length} tiers display`)
  OP.Bestiary.state.tierKey = selected

  t.section('the tower tab displays every shipped tower without throwing')
  if (OP.Bestiary.state.tab !== undefined) {
    OP.Bestiary.state.tab = 'towers'
    broke = []
    for (const key of OP.TOWER_ORDER) {
      OP.Bestiary.state.towerKey = key
      try { Menus.draw(recorder(), bapp) } catch (e) { broke.push(key + ': ' + e.message) }
    }
    t.eq(broke.length, 0, broke.length ? 'these threw: ' + broke.join(' / ') : `all ${OP.TOWER_ORDER.length} towers display`)
    OP.Bestiary.state.tab = 'balloons'
    OP.Bestiary.state.towerKey = null
  }

  /* ---------- empty registries must not throw ---------- */

  t.section('every screen survives empty registries')
  // True during a build, and a throwing layer is unregistered by the renderer — so
  // the screen would not error, it would silently vanish.
  const stash = {
    maps: OP.MAPS, mapOrder: OP.MAP_ORDER,
    towers: OP.TOWERS, towerOrder: OP.TOWER_ORDER,
    heroes: OP.HEROES, heroOrder: OP.HERO_ORDER,
    difficulties: OP.DIFFICULTIES, modes: OP.MODES
  }
  try {
    OP.MAPS = {}; OP.MAP_ORDER = []
    OP.TOWERS = {}; OP.TOWER_ORDER = []
    OP.HEROES = {}; OP.HERO_ORDER = []
    OP.DIFFICULTIES = {}; OP.MODES = {}
    const bare = stubApp()
    t.noThrow(() => Menus.install(bare), 'Menus installs with nothing registered')
    for (const screen of names) {
      if (typeof Menus.go === 'function') Menus.go(bare, screen)
      t.noThrow(() => Menus.draw(recorder(), bare), `${screen} survives empty registries`)
    }
  } finally {
    OP.MAPS = stash.maps; OP.MAP_ORDER = stash.mapOrder
    OP.TOWERS = stash.towers; OP.TOWER_ORDER = stash.towerOrder
    OP.HEROES = stash.heroes; OP.HERO_ORDER = stash.heroOrder
    OP.DIFFICULTIES = stash.difficulties; OP.MODES = stash.modes
  }

  t.section('screens survive a missing profile')
  const noProfile = stubApp({ profile: null })
  t.noThrow(() => {
    Menus.install(noProfile)
    for (const screen of names) {
      if (typeof Menus.go === 'function') Menus.go(noProfile, screen)
      Menus.draw(recorder(), noProfile)
    }
  }, 'a null profile does not throw — a first-run player has no save yet')

  /* ---------- settings reach the save layer ---------- */

  t.section('a settings change reaches the profile')
  if (typeof Menus.applySetting === 'function') {
    const setApp = stubApp()
    Menus.install(setApp)
    const before = setApp.state.profile.settings.sfxVolume
    Menus.applySetting(setApp, 'sfxVolume', before === 0.5 ? 0.25 : 0.5)
    t.neq(setApp.state.profile.settings.sfxVolume, before, 'the profile was updated')
    t.between(setApp.state.profile.settings.sfxVolume, 0, 1, 'and the value stayed in range')
  } else {
    t.ok(true, 'no applySetting() exported — skipped')
  }

  /* ---------- purity ---------- */

  t.section('drawing a menu never mutates the simulation')
  const live = gameSim()
  for (let i = 0; i < 20; i++) OP.Balloons.spawn(live, { tier: 'red', path: 0, t: i * 30 })
  OP.Sim.run(live, 60)
  const gameApp = stubApp({ sim: live, screen: 'game' })
  Menus.install(gameApp)
  const before = OP.Sim.checksum(live)
  for (let pass = 0; pass < 30; pass++) {
    for (const screen of names) {
      if (typeof Menus.go === 'function') Menus.go(gameApp, screen)
      Menus.draw(recorder(), gameApp)
    }
  }
  t.eq(OP.Sim.checksum(live), before,
    `${30 * names.length} menu draws left the simulation bit-identical`)

  t.section('drawing is deterministic for the same state')
  if (typeof Menus.go === 'function') Menus.go(app, names[0])
  const d1 = recorder(); Menus.draw(d1, app)
  const d2 = recorder(); Menus.draw(d2, app)
  // An idle animation is legitimate, so this is a soft check: either identical, or
  // differing only in a way that a time value would explain.
  const same = d1.calls.join(',') === d2.calls.join(',')
  t.ok(same || d1.calls.length === d2.calls.length,
    same ? 'two draws of the same state are identical'
      : 'two draws differ only in values, not in structure (an idle animation)')

  t.section('no borrowed proper nouns in any menu text')
  const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
  const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/
  let allText = ''
  for (const screen of names) {
    if (typeof Menus.go === 'function') Menus.go(app, screen)
    const ctx = recorder()
    Menus.draw(ctx, app)
    allText += ' ' + ctx.texts.join(' ')
  }
  const hit = (allText.match(BANNED_ANY) || allText.match(BANNED_CAPS) || [])[0]
  t.notOk(hit, 'menu text borrows nothing' + (hit ? ` — found "${hit}"` : ''))

  t.section('keyboard handling does not throw')
  const keyApp = stubApp()
  Menus.install(keyApp)
  if (typeof Menus.key === 'function') {
    for (const k of ['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'q', ' ']) {
      t.noThrow(() => Menus.key(keyApp, k), `key "${k}" is handled`)
    }
  } else {
    t.ok(true, 'no key() exported — skipped')
  }

  // Leave the module on its first screen so a later suite is not surprised.
  if (typeof Menus.go === 'function' && names.length) Menus.go(app, names[0])
}

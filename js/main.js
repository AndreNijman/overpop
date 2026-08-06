;(function (OP) {
  'use strict'

  const M = OP.M

  /* Boot and the frame loop.

     This is the only file that touches the DOM at load time, and the only one that
     owns a requestAnimationFrame loop. Everything else is a library it drives.

     It is deliberately tolerant of missing UI modules: if js/ui/menus.js or the
     HUD is not present, the game still boots and still renders the board. That is
     not defensive padding — it means the page is testable and playable at every
     stage of the build, and a single broken screen cannot take the whole game down
     with it. */

  const App = {}

  App.state = {
    canvas: null,
    ctx: null,
    view: null,
    io: null,
    sim: null,
    profile: null,
    screen: 'menu',        // 'menu' | 'game' | 'results'
    mapKey: null,
    difficulty: 'medium',
    mode: 'standard',
    raf: 0,
    lastFrame: 0,
    running: false,
    reducedMotion: false,
    booted: false,
    fps: 0,
    frameAcc: 0,
    frameCount: 0
  }

  /* ---------- boot ---------- */

  function boot () {
    const S = App.state
    if (S.booted) return
    S.booted = true

    S.canvas = document.getElementById('game')
    if (!S.canvas) { fail('no #game canvas in the document'); return }
    S.ctx = S.canvas.getContext('2d', { alpha: false })
    if (!S.ctx) { fail('this browser did not give us a 2d canvas context'); return }

    S.view = OP.Camera.create()
    OP.FX.view = S.view                     // so a blimp pop can shake the screen
    S.io = OP.Input.state

    S.reducedMotion = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)

    S.profile = OP.Save && OP.Save.load ? OP.Save.load() : null
    applySettings()

    resize()
    window.addEventListener('resize', resize)
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      if (mq.addEventListener) mq.addEventListener('change', e => { S.reducedMotion = e.matches })
    }

    OP.Input.attach(S.io, S.canvas, S.view)
    OP.Input.setTowerLookup(S.io, towerAt)
    OP.Input.setHandlers(S.io, {
      place: onPlace,
      select: onSelect,
      aim: onAim,
      context: onContext,
      key: onKey,
      wheel: onWheel,
      cancel: onCancel
    })

    // Audio may not exist until a gesture, so unlock on the first one of any kind.
    const unlock = () => {
      if (OP.Audio) OP.Audio.unlock()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)

    // Pause when the tab is hidden: a backgrounded tab throttles rAF, and the
    // accumulator would otherwise bank time and lurch on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop()
      else startLoop()
    })

    if (OP.Menus && OP.Menus.install) OP.Menus.install(App)
    if (OP.HUD && OP.HUD.install) OP.HUD.install(App)
    if (OP.Shop && OP.Shop.install) OP.Shop.install(App)
    if (OP.TowerPanel && OP.TowerPanel.install) OP.TowerPanel.install(App)
    if (OP.Bestiary && OP.Bestiary.install) OP.Bestiary.install(App)
    if (OP.Results && OP.Results.install) OP.Results.install(App)

    // Something must be on screen even with no menu module built yet.
    if (!(OP.Menus && OP.Menus.install)) App.startGame(firstMapKey(), 'medium', 'standard')

    startLoop()
    registerServiceWorker()
  }

  function fail (why) {
    const boot = document.getElementById('boot')
    if (boot) {
      const note = boot.querySelector ? boot.querySelector('.boot-note') : null
      if (note) note.textContent = why
      else boot.textContent = why
    }
    if (console && console.error) console.error('OVERPOP: ' + why)
  }

  function applySettings () {
    const S = App.state
    const set = S.profile && S.profile.settings
    if (!set || !OP.Audio) return
    if (set.sfxVolume !== undefined) OP.Audio.setSfxVolume(set.sfxVolume)
    if (set.musicVolume !== undefined) OP.Audio.setMusicVolume(set.musicVolume)
  }

  function firstMapKey () {
    if (OP.MAP_ORDER && OP.MAP_ORDER.length) return OP.MAP_ORDER[0]
    return null
  }

  /* The one place a playable map is produced from a definition. Reverse is a mode
     rule, so the reversal has to happen on the resume path too — building the
     forward map for a saved Reverse run puts every stored balloon `t` on a track
     running the other way, and they walk out of the entry they came in by. */
  function buildMapFor (def, mode) {
    let map = OP.Maps.build(def)
    const modeDef = OP.MODES && OP.MODES[mode]
    if (modeDef && modeDef.rules && modeDef.rules.reversePaths && OP.Maps.reversePaths) {
      map = OP.Maps.reversePaths(map)
    }
    return map
  }

  function resize () {
    const S = App.state
    const rect = S.canvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight
    OP.Camera.resize(S.view, S.canvas, w, h, window.devicePixelRatio || 1)
    OP.Render.invalidateTerrain(S.view)
    if (S.ctx) S.ctx.imageSmoothingEnabled = true
  }

  /* ---------- the loop ---------- */

  function startLoop () {
    const S = App.state
    if (S.running) return
    S.running = true
    S.lastFrame = 0
    S.raf = requestAnimationFrame(frame)
  }

  function stopLoop () {
    const S = App.state
    S.running = false
    if (S.raf) cancelAnimationFrame(S.raf)
    S.raf = 0
  }

  function frame (now) {
    const S = App.state
    if (!S.running) return
    S.raf = requestAnimationFrame(frame)

    const dt = S.lastFrame ? Math.min((now - S.lastFrame) / 1000, 0.25) : 1 / 60
    S.lastFrame = now

    // rolling fps, for the debug overlay
    S.frameAcc += dt
    S.frameCount++
    if (S.frameAcc >= 0.5) {
      S.fps = S.frameCount / S.frameAcc
      S.frameAcc = 0
      S.frameCount = 0
    }

    if (S.sim) {
      OP.Sim.advance(S.sim, dt)
      OP.FX.consume(OP.FX.state, S.sim)
      if (OP.Audio) OP.Audio.consume(S.sim)
      if (S.sim.over && S.screen === 'game') onGameOver()
    }
    OP.FX.step(OP.FX.state, dt)
    OP.Camera.stepShake(S.view, dt, S.reducedMotion)
    OP.Input.updateHover(S.io)

    draw()
    clearBootOverlay()
    // An update that arrived mid-round is applied here, the moment play stops.
    drainPendingReload()
  }

  function draw () {
    const S = App.state
    if (!S.sim) {
      // No game yet: let the menu own the whole canvas.
      S.ctx.setTransform(1, 0, 0, 1, 0, 0)
      S.ctx.fillStyle = '#0e1410'
      S.ctx.fillRect(0, 0, S.view.cw, S.view.ch)
      if (OP.Menus && OP.Menus.draw) {
        OP.Camera.apply(S.view, S.ctx)
        try { OP.Menus.draw(S.ctx, App) } catch (e) { logOnce('menu draw', e) }
        S.ctx.restore()
      }
      return
    }

    OP.Render.frame(S.sim, S.ctx, S.view, {
      reducedMotion: S.reducedMotion,
      selected: selectedTower(),
      hover: hoverTower(),
      placing: OP.Input.placementPreview(S.io, S.sim),
      app: App
    })
  }

  let logged = {}
  function logOnce (what, e) {
    if (logged[what]) return
    logged[what] = true
    if (console && console.error) console.error('OVERPOP: ' + what + ' threw', e)
  }

  function clearBootOverlay () {
    const el = document.getElementById('boot')
    if (el && !el.classList.contains('gone')) {
      el.classList.add('gone')
      // Removing it entirely keeps it out of the accessibility tree.
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el) }, 500)
    }
  }

  /* ---------- game lifecycle ---------- */

  App.startGame = function (mapKey, difficulty, mode, opts) {
    const S = App.state
    opts = opts || {}
    if (!mapKey) { fail('no maps are available yet'); return null }

    const def = OP.MAPS[mapKey]
    if (!def) { fail('unknown map: ' + mapKey); return null }

    // buildMapFor applies Maps.reversePaths before Sim.create, because a Track is
    // built once and every stored balloon `t` is measured along it.
    const map = buildMapFor(def, mode)
    const modeDef = OP.MODES && OP.MODES[mode]

    S.mapKey = mapKey
    S.difficulty = difficulty || 'medium'
    S.mode = mode || 'standard'
    S.sim = OP.Sim.create({
      map: map,
      seed: opts.seed === undefined ? String(Date.now()) : opts.seed,
      difficulty: S.difficulty,
      mode: S.mode,
      roundSetKey: (modeDef && modeDef.roundSetKey) || 'standard',
      autostart: !!(S.profile && S.profile.settings && S.profile.settings.autostart)
    })
    S.screen = 'game'
    OP.FX.reset()
    OP.FX.view = S.view
    OP.Render.invalidateTerrain(S.view)
    OP.Input.cancel(S.io)
    S.io.selectedId = -1
    if (OP.Audio) OP.Audio.startMusic('calm')
    return S.sim
  }

  App.resumeGame = function () {
    const S = App.state
    if (!(OP.Save && OP.Save.loadRun)) return null
    const run = OP.Save.loadRun()
    if (!run || !run.snapshot || !run.mapKey) return null
    const def = OP.MAPS[run.mapKey]
    if (!def) return null
    try {
      S.sim = OP.Sim.deserialize(run.snapshot, buildMapFor(def, run.snapshot.mode))
      S.mapKey = run.mapKey
      S.difficulty = S.sim.difficulty
      S.mode = S.sim.mode
      S.screen = 'game'
      OP.FX.reset()
      OP.Render.invalidateTerrain(S.view)
      return S.sim
    } catch (e) {
      // A save from an older build that no longer loads must not brick the game.
      logOnce('resume', e)
      if (OP.Save.clearRun) OP.Save.clearRun()
      return null
    }
  }

  App.saveRun = function () {
    const S = App.state
    if (!S.sim || S.sim.over || !(OP.Save && OP.Save.saveRun)) return false
    return OP.Save.saveRun(S.sim, S.mapKey)
  }

  App.quitToMenu = function () {
    const S = App.state
    App.saveRun()
    S.sim = null
    S.screen = 'menu'
    if (OP.Audio) OP.Audio.stopMusic()
  }

  function onGameOver () {
    const S = App.state
    S.screen = 'results'
    if (OP.Save && OP.Save.clearRun) OP.Save.clearRun()
    if (OP.Save && OP.Save.recordResult && S.profile) {
      OP.Save.recordResult(S.profile, {
        mapKey: S.mapKey,
        difficulty: S.difficulty,
        mode: S.mode,
        won: S.sim.outcome === 'won',
        round: S.sim.roundIndex,
        pops: S.sim.stats.popped,
        cash: S.sim.stats.cashEarned
      })
      if (OP.Save.save) OP.Save.save(S.profile)
    }
    if (OP.Audio) OP.Audio.stopMusic()
  }

  /* ---------- intents from input ---------- */

  function towerAt (x, y) {
    const S = App.state
    if (!S.sim) return -1
    const tower = OP.Towers.at(S.sim, x, y)
    return tower ? tower.id : -1
  }

  function selectedTower () {
    const S = App.state
    return S.sim && S.io.selectedId >= 0 ? S.sim.towerById.get(S.io.selectedId) : null
  }
  App.selectedTower = selectedTower

  function hoverTower () {
    const S = App.state
    return S.sim && S.io.hoverId >= 0 ? S.sim.towerById.get(S.io.hoverId) : null
  }

  function onPlace (key, x, y, isHero) {
    const S = App.state
    if (!S.sim) return
    const placed = isHero
      ? OP.Heroes.place(S.sim, key, x, y)
      : OP.Towers.place(S.sim, key, x, y)
    if (placed) {
      S.io.selectedId = placed.id
      OP.Input.cancel(S.io)
    } else {
      const why = isHero ? OP.Heroes.canPlace(S.sim, key, x, y) : OP.Towers.canPlace(S.sim, key, x, y)
      if (OP.Audio) OP.Audio.play('deny')
      OP.FX.say(x, y - 20, why.reason || 'Cannot place here', '#e06a5a')
    }
  }

  function onSelect (id) { App.state.io.selectedId = id }

  function onAim (towerId, x, y) {
    const S = App.state
    if (!S.sim) return
    const tower = S.sim.towerById.get(towerId)
    if (!tower) return
    tower.data.aimX = x
    tower.data.aimY = y
    OP.Input.cancel(S.io)
  }

  function onContext (towerId, x, y) {
    const S = App.state
    if (!S.sim || towerId < 0) return
    const tower = S.sim.towerById.get(towerId)
    if (tower) OP.Towers.cycleTargetMode(S.sim, tower, 1)
  }

  function onCancel () { App.state.io.selectedId = App.state.io.selectedId }

  /** Scroll belongs to whichever panel is under the pointer, or to nothing. */
  function onWheel (dy, x, y) {
    if (!OP.HUD || !OP.HUD.wheel) return false
    return OP.HUD.wheel(App, dy, x, y)
  }

  /**
   * Returns true when the press was CLAIMED, which is how Escape reaches an open
   * overlay instead of being spent cancelling a placement mode behind it.
   */
  function onKey (key) {
    const S = App.state
    if (!S.sim) return false
    if (OP.Shop && OP.Shop.key && OP.Shop.key(App, key)) return true
    if (key === ' ') {
      if (S.sim.round && !S.sim.round.done) OP.Sim.togglePause(S.sim)
      else OP.Sim.startRound(S.sim)
    } else if (key === '1' || key === '2' || key === '3') {
      OP.Sim.setSpeed(S.sim, parseInt(key, 10))
    } else if (key === 'p' || key === 'P') {
      OP.Sim.togglePause(S.sim)
    } else if (key === 'Backspace' || key === 'Delete') {
      const tower = selectedTower()
      if (tower && OP.Towers.sell(S.sim, tower) > 0) S.io.selectedId = -1
    }
  }

  /* ---------- service worker ---------- */

  /* An update has to apply on its own.

     Caching an offline copy is only half a feature: the other half is noticing
     that the copy is stale. Without the code below a returning player keeps the
     build they first loaded until they hard-refresh or clear site data, which is
     exactly what was reported — the game looked unchanged after a deploy.

     Three pieces, and all three are needed:
       1. `updateViaCache: 'none'` so the browser fetches sw.js itself over the
          network rather than out of its own HTTP cache. A cached worker script can
          never discover that it is out of date.
       2. An explicit `registration.update()` now and on a timer, plus on regaining
          focus. Browsers check on navigation, but this game is a single page a
          player may leave open for hours.
       3. A reload when the new worker takes over. sw.js calls `skipWaiting()`, so
          `controllerchange` fires as soon as the new version is fully cached, and
          reloading there is what swaps the running build.

     RELOADING MID-GAME IS NOT ACCEPTABLE, so it waits: an update that lands
     during a run is applied when the board is next idle. Losing someone's round 78
     to a cosmetic patch would be a worse bug than the one this fixes. */

  const UPDATE_POLL_MS = 15 * 60 * 1000
  let pendingReload = false
  let reloading = false

  function boardBusy () {
    const S = App.state
    if (!S || !S.sim || S.sim.over) return false
    return S.screen === 'game'
  }

  function applyUpdate () {
    if (reloading) return
    if (boardBusy()) { pendingReload = true; return }
    reloading = true
    // `location.reload()` and not a cache-buster query: the new worker is already
    // in control, so a plain reload is served entirely from the new version.
    location.reload()
  }

  /** Called from the frame loop, so a deferred update lands the moment play stops. */
  function drainPendingReload () {
    if (pendingReload && !boardBusy()) applyUpdate()
  }

  function registerServiceWorker () {
    // Only over http(s): a service worker cannot register from file://, and
    // attempting it throws a console error that would fail the smoke test.
    if (!('serviceWorker' in navigator)) return
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return

    // Ignore the very first controller: that is the initial install on a first
    // visit, where nothing is stale and a reload would be a pointless flash.
    const hadController = !!navigator.serviceWorker.controller

    // A worker taking control means a different build is now being served, so the
    // page has to be re-parsed to actually be running it. Feature-tested rather
    // than assumed: the harness stubs `serviceWorker` with only what it needs, and
    // a missing listener must not take the whole bundle down at load time.
    const swc = navigator.serviceWorker
    if (typeof swc.addEventListener === 'function') {
      swc.addEventListener('controllerchange', () => {
        if (!hadController) return
        applyUpdate()
      })
    }

    const reg = swc.register('sw.js', { updateViaCache: 'none' })
    if (!reg || typeof reg.then !== 'function') return
    reg.then(r => {
      if (!r || typeof r.update !== 'function') return
      const check = () => { try { r.update() } catch (e) { /* offline */ } }
      check()
      setInterval(check, UPDATE_POLL_MS)
      window.addEventListener('focus', check)
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
    }).catch(() => { /* offline is optional */ })
  }

  /* ---------- test hook ----------
     tools/smoke.mjs looks for this. Keeping it here rather than in the test means
     the smoke test drives the same code path a player does. */

  OP.Test = OP.Test || {}
  OP.Test.autoplay = function (rounds) {
    const S = App.state
    const mapKey = S.mapKey || firstMapKey()
    if (!mapKey) return { ok: false, why: 'no maps registered' }
    const sim = App.startGame(mapKey, 'easy', 'standard', { seed: 'smoke' })
    if (!sim) return { ok: false, why: 'startGame failed' }
    sim.cash = 999999

    let placed = 0
    const keys = OP.TOWER_ORDER.slice(0, 10)
    for (const key of keys) {
      for (let attempt = 0; attempt < 240 && placed < 10; attempt++) {
        const x = 40 + (attempt * 71) % (OP.FIELD_W - 80)
        const y = 40 + (attempt * 137) % (OP.FIELD_H - 80)
        if (OP.Towers.canPlace(sim, key, x, y).ok && OP.Towers.place(sim, key, x, y)) { placed++; break }
      }
    }

    sim.autostart = true
    OP.Sim.startRound(sim, 1)
    let guard = 0
    while (sim.roundIndex <= rounds && !sim.over && guard < 60 * 60 * 15) {
      OP.Sim.step(sim)
      guard++
    }
    return {
      ok: true, placed: placed, tick: sim.tick, round: sim.roundIndex,
      popped: sim.stats.popped, leaked: sim.stats.leaked, lives: sim.lives,
      over: sim.over, outcome: sim.outcome, checksum: OP.Sim.checksum(sim)
    }
  }

  OP.App = App

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
    else boot()
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

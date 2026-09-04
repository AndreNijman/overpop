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
    if (OP.KnowledgeScreen && OP.KnowledgeScreen.install) OP.KnowledgeScreen.install(App)
    if (OP.Bestiary && OP.Bestiary.install) OP.Bestiary.install(App)
    if (OP.LegendsScreen && OP.LegendsScreen.install) OP.LegendsScreen.install(App)
    if (OP.EventScreen && OP.EventScreen.install) OP.EventScreen.install(App)
    if (OP.Results && OP.Results.install) OP.Results.install(App)

    // Something must be on screen even with no menu module built yet.
    if (!(OP.Menus && OP.Menus.install)) App.startGame(firstMapKey(), 'medium', 'standard')

    startLoop()
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

    const runRules = Object.assign({}, opts.rules || {})
    if (runRules.allowedTowerKeys === undefined) {
      runRules.allowedTowerKeys = opts.unlockAllTowers
        ? null
        : (OP.Save && OP.Save.availableTowerKeys ? OP.Save.availableTowerKeys(S.profile) : null)
    }

    S.mapKey = mapKey
    S.difficulty = difficulty || 'medium'
    S.mode = mode || 'standard'
    S.progressionResult = null
    S.expeditionResult = null
    S.trialResult = null
    S.legendsResult = null
    S.bossEventResult = null
    S.sim = OP.Sim.create({
      map: map,
      seed: opts.seed === undefined ? String(Date.now()) : opts.seed,
      difficulty: S.difficulty,
      mode: S.mode,
      roundSetKey: (modeDef && modeDef.roundSetKey) || 'standard',
      autostart: !!(S.profile && S.profile.settings && S.profile.settings.autostart),
      knowledge: S.profile && S.profile.knowledge ? S.profile.knowledge.slice() : [],
      powers: S.profile && S.profile.powers ? Object.assign({}, S.profile.powers) : {},
      rules: runRules
    })
    // Rush Trial forces autostart regardless of player settings
    if (OP.Race && OP.Race.applyForcedAutostart) OP.Race.applyForcedAutostart(S.sim)
    // Apply expedition carry-over state
    if (opts.expeditionCash != null) S.sim.cash = opts.expeditionCash
    if (opts.expeditionLives != null) S.sim.lives = opts.expeditionLives
    // Banked tower XP rides along on the sim so gating has one source of truth
    // for "how much of this tower type may I spend". A shallow copy is fine —
    // the map only ever grows at game over, never mid-run.
    S.sim.towerXp = Object.assign({}, (S.profile && S.profile.towerXp) || {})
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
      // tower.runXp is per-tower inside the snapshot, so the run's own XP is
      // already restored; this copy re-attaches the banked half.
      S.sim.towerXp = Object.assign({}, (S.profile && S.profile.towerXp) || {})
      S.mapKey = run.mapKey
      S.difficulty = S.sim.difficulty
      S.mode = S.sim.mode
      S.screen = 'game'
      OP.FX.reset()
      OP.Render.invalidateTerrain(S.view)

      // The daily challenge's active state lives in memory, not the run save, so
      // a daily run resumed after a reload would finish without recording its
      // result. The sim's seed ("daily-<dateKey>") identifies the challenge. Skip
      // the restore when that date is already recorded: a won challenge saved
      // mid-freeplay must not re-activate the daily — its continuation must not
      // re-record the day with freeplay-inflated stats.
      if (OP.DailyCore && OP.Daily && S.profile &&
          typeof run.snapshot.seed === 'string' &&
          run.snapshot.seed.indexOf('daily-') === 0) {
        const dateKey = run.snapshot.seed.slice('daily-'.length)
        if (!OP.DailyCore.isDone(S.profile, dateKey)) {
          const challenge = OP.Daily.generate(dateKey)
          if (challenge) OP.DailyCore.start(challenge)
        }
      }

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

  App.canContinueFreeplay = function () {
    const S = App.state
    return !!(S.screen === 'results' && !S.expeditionResult &&
      OP.Sim && OP.Sim.canEnterFreeplay && OP.Sim.canEnterFreeplay(S.sim))
  }

  App.continueFreeplay = function () {
    const S = App.state
    if (!App.canContinueFreeplay() || !OP.Sim.enterFreeplay(S.sim)) return null

    // The victory reward is already in the profile. Carry that exact inventory
    // into the continued run so powers used in freeplay persist correctly.
    if (S.profile && OP.Powers && OP.Powers.copyInventory) {
      S.sim.powers = OP.Powers.copyInventory(S.profile.powers)
    }
    S.screen = 'game'
    S.progressionResult = null
    if (S.io && OP.Input) {
      OP.Input.cancel(S.io)
      S.io.selectedId = -1
    }
    if (S.sim.autostart && OP.Rounds && OP.Rounds.next) OP.Rounds.next(S.sim)
    App.saveRun()
    if (OP.Audio) OP.Audio.startMusic('calm')
    return S.sim
  }

  App.quitToMenu = function () {
    const S = App.state
    App.saveRun()
    S.sim = null
    S.screen = 'menu'
    if (OP.Audio) OP.Audio.stopMusic()
  }

  /**
   * Start an expedition from the beginning.
   */
  App.startExpedition = function (expeditionKey) {
    const S = App.state
    if (!S.profile || !OP.Expedition) return null
    var def = OP.Expeditions && OP.Expeditions.get(expeditionKey)
    if (!def) return null
    var startCash = 650
    var startLives = 20
    OP.Expedition.start(S.profile, expeditionKey, startCash, startLives)
    if (OP.Save && OP.Save.save) OP.Save.save(S.profile)
    var mapKey = def.maps[0].key
    return App.startGame(mapKey, def.difficulty, def.mode, {
      expeditionCash: startCash,
      expeditionLives: startLives
    })
  }

  /**
   * Advance to the next map in the current expedition.
   */
  App.advanceExpedition = function () {
    const S = App.state
    if (!S.profile || !OP.Expedition || !OP.Expedition.isActive(S.profile)) return null
    var exp = S.profile.expedition
    var def = OP.Expedition.activeDef(S.profile)
    if (!def || exp.stageIndex >= def.maps.length) return null
    var mapKey = def.maps[exp.stageIndex].key
    var result = App.startGame(mapKey, def.difficulty, def.mode, {
      expeditionCash: exp.cash,
      expeditionLives: exp.lives
    })
    S.expeditionResult = null
    return result
  }

  /**
   * Start (or resume) a Legends campaign and launch the current node's battle.
   */
  App.startLegends = function () {
    const S = App.state
    if (!S.profile || !OP.Legends) return null
    if (!OP.Legends.isActive(S.profile)) {
      // The entry screen's Starter Party picker stores its selections here;
      // hand them through so the campaign opens with the player's starter relics.
      var picks = (OP.Menus && OP.Menus.state && OP.Menus.state.legendsStart)
        ? OP.Menus.state.legendsStart.picks : null
      var hero = (OP.Menus && OP.Menus.state && OP.Menus.state.legendsStart)
        ? OP.Menus.state.legendsStart.hero : null
      if (OP.Menus && OP.Menus.state) OP.Menus.state.legendsStart = null
      if (!OP.Legends.start(S.profile, null, { picks: picks || [], hero: hero })) return null
      if (OP.Save && OP.Save.save) OP.Save.save(S.profile)
    }
    var launched = App.launchLegendsBattle()
    S.legendsResult = null
    return launched
  }

  /**
   * Resolve the current Merchant node from the board screen: buy an artifact
   * (spend cash) or skip, then advance to the next tile. Stays on the board.
   */
  App.legendsMerchant = function (buy) {
    const S = App.state
    if (!S.profile || !OP.Legends) return null
    const res = OP.Legends.resolveMerchant(S.profile, !!buy)
    if (res && OP.Save && OP.Save.save) OP.Save.save(S.profile)
    return res
  }

  /**
   * Advance a won Legends battle to the next node, then launch it (or return
   * to the board when a battle just opened a chest / the run finished).
   */
  App.advanceLegends = function () {
    const S = App.state
    if (!S.profile || !OP.Legends) return null
    // The run's state was already advanced when the battle was won (recordWin
    // ran in onGameOver so the results screen could reflect the outcome). Here
    // we only decide where the campaign goes next.
    var res = S.legendsResult || {}
    S.legendsResult = null
    if (res.campaignComplete) {
      App.quitToMenu()
      return null
    }
    if (res.stageComplete) {
      App.quitToMenu()
      if (OP.Menus && OP.Menus.go) OP.Menus.go(App, 'legends')
      return { nextStage: true }
    }
    if (!OP.Legends.isActive(S.profile)) return null
    return App.launchLegendsBattle()
  }

  /**
   * Launch the current Legends node's battle: build the config, create the sim,
   * drive its escalating round set + artifacts, then hand off to the game screen.
   */
  App.launchLegendsBattle = function () {
    const S = App.state
    if (!S.profile || !OP.Legends || !OP.Legends.isActive(S.profile)) return null
    // Tick the active boost before launching (decrement at battle START).
    if (OP.Legends.tickBoost) OP.Legends.tickBoost(S.profile)
    var cfg = OP.Legends.battleConfig(S.profile)
    if (!cfg) return null
    var sim = App.startGame(cfg.mapKey, cfg.difficulty, cfg.mode, {})
    if (!sim) return null
    // Escalating rounds: an explicit table beats any round-set key (rounds.js),
    // so a fought-through battle gets a denser, faster-ramping set than standard.
    // roundSetKey is left as-startGame set it, so a resumed Legends battle loads
    // cleanly (it just falls back to the standard set if the player re-enters it).
    if (cfg.roundSet) sim.roundSet = cfg.roundSet
    // Non-serialised marker so onGameOver can tell a Legends battle apart.
    sim.isLegends = true
    // Mini-game goal contract: surface the type + target on the live sim so the
    // HUD shows the constraint and recordWin can judge it. Not serialised.
    if (cfg.miniType) sim.legendsMini = { type: cfg.miniType, goal: cfg.miniGoal }
    // Resource/artifact carry-over.
    sim.cash = cfg.startCash != null ? cfg.startCash : sim.cash
    if (cfg.startLives != null) sim.lives = cfg.startLives
    if (OP.Legends.applyArtifacts) OP.Legends.applyArtifacts(S.profile, sim)
    // Boost resource carry-over (fortify startLives, etc.)
    if (OP.Legends.boostResourceBoosts) {
      var bRes = OP.Legends.boostResourceBoosts(S.profile)
      if (bRes.cash) sim.cash += bRes.cash
      if (bRes.lives) sim.lives += bRes.lives
    }
    // Apply active boost mods/rules to the sim.
    if (OP.Legends.applyBoost) OP.Legends.applyBoost(S.profile, sim)
    // Deploy the campaign hero onto the map.
    if (OP.Legends.deployHero) OP.Legends.deployHero(S.profile, sim)
    return sim
  }

  /**
   * Abandon the current expedition.
   */
  App.abandonExpedition = function () {
    const S = App.state
    if (!S.profile || !OP.Expedition) return
    OP.Expedition.abandon(S.profile)
    if (OP.Save && OP.Save.save) OP.Save.save(S.profile)
    S.expeditionResult = null
  }

  /**
   * Start a trial challenge.
   */
  App.startTrial = function (trialKey) {
    const S = App.state
    if (!S.profile || !OP.Trial || !OP.Trials) return null
    var def = OP.Trials.get(trialKey)
    if (!def) return null
    OP.Trial.start(S.profile, trialKey)
    if (OP.Save && OP.Save.save) OP.Save.save(S.profile)
    return App.startGame(def.mapKey, def.difficulty, def.mode, {
      rules: def.rules || {}
    })
  }

  /**
   * Start a Boss Event fight against the chosen boss.
   *
   * Runs the boss-event / boss-event-elite mode (which spawns the configured boss
   * every 20 rounds) on this week's deterministic map, injecting the chosen boss
   * via a rules override so the same mode keeps working for any roster member.
   * @param {string} bossKey  a key into OP.BOSSES
   * @param {boolean} elite   fight the elite variant (gated on normal progress)
   * @returns {object|null}   the sim, or null if the choice is invalid
   */
  App.startBossEvent = function (bossKey, elite) {
    const S = App.state
    if (!S.profile || !OP.BossEvent || !OP.Boss) return null
    bossKey = OP.BossEvent.validBoss(bossKey)
    if (!bossKey) return null
    if (elite && !OP.BossEvent.eliteUnlocked(S.profile, bossKey)) return null

    var date = new Date()
    var mapKey = OP.BossEvent.mapKey(date)
    if (!mapKey) return null
    var seed = OP.BossEvent.seed(date, bossKey)
    var mode = elite ? 'boss-event-elite' : 'boss-event'
    // The elite variant is a hard-tier challenge (modes.js gates it so); start it
    // on hard so difficulty scaling matches its billing.
    var difficulty = elite ? 'hard' : 'medium'

    S.bossEventResult = null
    return App.startGame(mapKey, difficulty, mode, {
      seed: seed,
      rules: { bossKey: bossKey }
    })
  }

  function onGameOver () {
    const S = App.state
    S.screen = 'results'
    if (S.io && OP.Input) {
      OP.Input.cancel(S.io)
      S.io.selectedId = -1
    }
    if (OP.Save && OP.Save.clearRun) OP.Save.clearRun()
    if (OP.Save && OP.Save.recordResult && S.profile) {
      var levelBefore = OP.Save.playerLevel ? OP.Save.playerLevel(S.profile) : 1
      var xpBefore = S.profile.playerXp || 0
      var savedResult = {
        mapKey: S.mapKey,
        difficulty: S.difficulty,
        mode: S.mode,
        won: S.sim.outcome === 'won',
        round: S.sim.roundIndex,
        roundsCleared: S.sim.stats.roundsCleared,
        pops: S.sim.stats.popped,
        cash: S.sim.stats.cashEarned,
        powers: S.sim.powers
      }
      if (S.sim.freeplay && S.sim.freeplayBaseline && OP.Save.recordFreeplayResult) {
        OP.Save.recordFreeplayResult(S.profile, savedResult, S.sim.freeplayBaseline)
      } else {
        OP.Save.recordResult(S.profile, savedResult)
      }
      S.progressionResult = {
        xpEarned: Math.max(0, (S.profile.playerXp || 0) - xpBefore),
        levelBefore: levelBefore,
        level: OP.Save.playerLevel ? OP.Save.playerLevel(S.profile) : levelBefore
      }
    }
    // Record daily challenge result if one is active
    if (OP.DailyCore && OP.DailyCore.active() && S.profile) {
      var dailyResult = OP.DailyCore.resultFromSim(S.sim, S.sim.outcome === 'won')
      OP.DailyCore.record(S.profile, OP.DailyCore.active().dateKey, dailyResult)
      OP.DailyCore.updateStreak(S.profile)
      OP.DailyCore.complete()
    }
    // Record race result if Rush Trial
    if (OP.Race && OP.Race.isActive && OP.Race.isActive(S.sim) && S.profile) {
      var raceResult = OP.Race.resultFromSim(S.sim, S.sim.outcome === 'won')
      OP.Race.record(S.profile, S.mapKey, S.difficulty, raceResult)
    }
    // Record Boss Event result (per-tier progression + KP rewards). Mirrors the
    // daily/race hooks: only fires when this run was actually a boss-event run
    // (sim.rules.bossKey set), so no ordinary game touches the ledger.
    if (OP.BossEvent && S.profile && S.sim && S.sim.rules &&
        S.sim.rules.bossKey && !S.sim.freeplay) {
      S.bossEventResult = OP.BossEvent.recordResult(S.profile, S.sim)
    }
    // Handle expedition map transition
    if (OP.Expedition && OP.Expedition.isActive(S.profile) && S.sim.outcome === 'won') {
      OP.Expedition.extractState(S.profile, S.sim)
      var expResult = OP.Expedition.recordGameOver(S.profile, true)
      S.expeditionResult = expResult
    } else if (OP.Expedition && OP.Expedition.isActive(S.profile)) {
      // Lost during expedition — abandon it
      OP.Expedition.abandon(S.profile)
    }
    // Handle trial completion
    if (OP.Trial && OP.Trial.isActive(S.profile)) {
      var trialResult = OP.Trial.recordGameOver(S.profile, S.sim.outcome === 'won', S.sim.roundIndex)
      S.trialResult = trialResult
    }
    // Handle a Legends battle ending. A won battle advances the campaign here so
    // the results screen can reflect what actually happened (a chest picked up,
    // a stage cleared, the whole campaign finished). `isLegends` is a
    // non-serialised marker set on the live sim so a stray expedition/trial
    // never cross-fires into it, and the advanced profile state is persisted by
    // the normal game-over save below. Losing ends the run.
    if (OP.Legends && OP.Legends.isActive(S.profile) && S.sim && S.sim.isLegends) {
      if (S.sim.outcome === 'won') {
        var legendsWin = OP.Legends.recordWin(S.profile, S.sim) || {}
        S.legendsResult = Object.assign({ won: true }, legendsWin)
      } else {
        OP.Legends.recordLoss(S.profile)
        S.legendsResult = { won: false }
      }
    }
    // Share out any XP still sitting in the round pool (a losing round never
    // completed, so the settle hook never fired), then bank what the run's
    // towers actually earned. Writes profile.towerXp only from living towers,
    // so a run walked away from banks nothing.
    if (OP.TowerXp && OP.TowerXp.settle) OP.TowerXp.settle(S.sim)
    if (OP.TowerXp && OP.TowerXp.bank) OP.TowerXp.bank(S.profile, S.sim)
    if (OP.Save && OP.Save.save) OP.Save.save(S.profile)
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

  /* ---------- test hook ----------
     tools/smoke.mjs looks for this. Keeping it here rather than in the test means
     the smoke test drives the same code path a player does. */

  OP.Test = OP.Test || {}
  OP.Test.autoplay = function (rounds) {
    const S = App.state
    const mapKey = S.mapKey || firstMapKey()
    if (!mapKey) return { ok: false, why: 'no maps registered' }
    const sim = App.startGame(mapKey, 'easy', 'standard', { seed: 'smoke', unlockAllTowers: true })
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

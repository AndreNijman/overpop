import { loadGame } from '../loadgame.mjs'

export const name = 'abandon-run'
export const needs = ['js/main.js', 'js/ui/hud.js', 'js/save.js', 'js/core/expedition.js', 'js/core/trial.js', 'js/core/legends.js']

export function run (t) {
  const env = loadGame()
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()

  t.section('standard run has no abandon button')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    OP.Sim.startRound(app.state.sim)
    OP.Sim.run(app.state.sim, 30)
    app.togglePauseMenu()
    const pause = OP.HUD.buildPauseMenu(app)
    t.ok(!pause.widgets.find(w => w.action === 'pause-abandon'), 'no abandon button for standard run')
    OP.HUD.activate(app, { action: 'pause-resume' })
    app.saveAndQuit()
  }

  t.section('expedition: abandon clears activity and returns to menu')
  {
    const profile = app.state.profile
    const expDef = OP.Expeditions.all()[0]
    OP.Expedition.start(profile, expDef.key, 800, 25)
    const exp = profile.expedition
    app.startExpedition(expDef.key)
    const sim = app.state.sim
    t.ok(sim && sim.runType === 'expedition', 'expedition run is live')
    t.ok(OP.Expedition.isActive(profile), 'expedition is active before abandon')
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 20)
    app.togglePauseMenu()
    const pause = OP.HUD.buildPauseMenu(app)
    const btn = pause.widgets.find(w => w.action === 'pause-abandon')
    t.ok(btn, 'abandon button is shown for expedition')
    t.eq(btn.label, 'ABANDON RUN', 'first press shows ABANDON RUN')
    OP.HUD.activate(app, btn)
    const confirm = OP.HUD.buildPauseMenu(app)
    const confirmBtn = confirm.widgets.find(w => w.action === 'pause-abandon')
    t.eq(confirmBtn.label, 'CONFIRM ABANDON', 'second press shows CONFIRM ABANDON')
    t.eq(confirmBtn.tone, 'danger', 'confirm button is danger-styled')
    OP.HUD.activate(app, confirmBtn)
    t.notOk(OP.Expedition.isActive(profile), 'expedition is cleared after abandon')
    t.eq(app.state.sim, null, 'sim is released')
    t.eq(app.state.screen, 'menu', 'returned to menu')
  }

  t.section('expedition: abandon saves profile')
  {
    const profile = app.state.profile
    const expDef = OP.Expeditions.all()[0]
    OP.Expedition.start(profile, expDef.key, 800, 25)
    app.startExpedition(expDef.key)
    app.togglePauseMenu()
    OP.HUD.activate(app, { action: 'pause-abandon' })
    OP.HUD.activate(app, { action: 'pause-abandon' })
    const saved = OP.Save.load()
    t.notOk(saved.expedition, 'abandoned expedition is not persisted')
  }

  t.section('expedition: abandon does not settle rewards')
  {
    const profile = app.state.profile
    const expDef = OP.Expeditions.all()[0]
    OP.Expedition.start(profile, expDef.key, 800, 25)
    app.startExpedition(expDef.key)
    OP.Sim.startRound(app.state.sim)
    OP.Sim.run(app.state.sim, 20)
    const trophiesBefore = profile.trophies || 0
    app.togglePauseMenu()
    OP.HUD.activate(app, { action: 'pause-abandon' })
    OP.HUD.activate(app, { action: 'pause-abandon' })
    t.eq(profile.trophies || 0, trophiesBefore, 'trophies unchanged after abandon')
  }

  t.section('trial: abandon clears activity and returns to menu')
  {
    const profile = app.state.profile
    const trialDef = OP.Trials.all()[0]
    OP.Trial.start(profile, trialDef.key)
    app.startTrial(trialDef.key)
    const sim = app.state.sim
    t.ok(sim && sim.runType === 'trial', 'trial run is live')
    t.ok(OP.Trial.isActive(profile), 'trial is active before abandon')
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 20)
    app.togglePauseMenu()
    const pause = OP.HUD.buildPauseMenu(app)
    const btn = pause.widgets.find(w => w.action === 'pause-abandon')
    t.ok(btn, 'abandon button is shown for trial')
    OP.HUD.activate(app, btn)
    OP.HUD.activate(app, { action: 'pause-abandon' })
    t.notOk(OP.Trial.isActive(profile), 'trial is cleared after abandon')
    t.eq(app.state.sim, null, 'sim is released')
    t.eq(app.state.screen, 'menu', 'returned to menu')
  }

  t.section('legends: abandon clears campaign and returns to menu')
  {
    const profile = app.state.profile
    if (OP.Legends) {
      const seed = 'abandon-test-seed'
      OP.Legends.start(profile, seed, { heroKey: 'acorn-fox' })
      app.startLegends()
      const sim = app.state.sim
      t.ok(sim && (sim.isLegends || sim.runType === 'legends'), 'legends run is live')
      t.ok(OP.Legends.isActive(profile), 'legends is active before abandon')
      OP.Sim.startRound(sim)
      OP.Sim.run(sim, 20)
      app.togglePauseMenu()
      const pause = OP.HUD.buildPauseMenu(app)
      const btn = pause.widgets.find(w => w.action === 'pause-abandon')
      t.ok(btn, 'abandon button is shown for legends')
      OP.HUD.activate(app, btn)
      OP.HUD.activate(app, { action: 'pause-abandon' })
      t.notOk(OP.Legends.isActive(profile), 'legends is cleared after abandon')
      t.eq(app.state.sim, null, 'sim is released')
      t.eq(app.state.screen, 'menu', 'returned to menu')
    }
  }

  t.section('escape resets confirm-abandon state')
  {
    const profile = app.state.profile
    const expDef = OP.Expeditions.all()[0]
    OP.Expedition.start(profile, expDef.key, 800, 25)
    app.startExpedition(expDef.key)
    OP.Sim.startRound(app.state.sim)
    OP.Sim.run(app.state.sim, 20)
    app.togglePauseMenu()
    OP.HUD.activate(app, { action: 'pause-abandon' })
    t.ok(app.state._confirmAbandon, 'confirm flag set after first press')
    app.togglePauseMenu()
    t.notOk(app.state._confirmAbandon, 'confirm flag cleared when pause closes')
  }

  t.section('pause settings does not reset confirm-abandon state')
  {
    const profile = app.state.profile
    const expDef = OP.Expeditions.all()[0]
    OP.Expedition.start(profile, expDef.key, 800, 25)
    app.startExpedition(expDef.key)
    OP.Sim.startRound(app.state.sim)
    OP.Sim.run(app.state.sim, 20)
    app.togglePauseMenu()
    OP.HUD.activate(app, { action: 'pause-abandon' })
    t.ok(app.state._confirmAbandon, 'confirm flag set after first press')
    app.openPauseSettings()
    t.ok(app.state._confirmAbandon, 'confirm flag preserved while in Settings')
    app.closePauseSettings()
    t.ok(app.state._confirmAbandon, 'confirm flag preserved after leaving Settings')
    app.togglePauseMenu()
    t.notOk(app.state._confirmAbandon, 'confirm flag cleared when pause closes')
  }
}

import { loadGame } from '../loadgame.mjs'

export const name = 'pause-settings'
export const needs = ['js/main.js', 'js/ui/hud.js', 'js/ui/menus.js']

export function run (t) {
  const env = loadGame()
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
  OP.Sim.startRound(sim)
  OP.Sim.run(sim, 60)
  app.togglePauseMenu()
  const pause = OP.HUD.buildPauseMenu(app)
  const settings = pause.widgets.find(w => w.action === 'pause-settings')
  t.ok(settings, 'pause menu provides Settings')
  if (!settings) return
  const before = OP.Sim.checksum(sim)
  OP.HUD.activate(app, settings)
  t.eq(app.state.screen, 'menu', 'the menu renderer owns Settings')
  t.eq(OP.Menus.state.screen, 'settings', 'Settings opens')
  t.eq(app.state.sim, sim, 'the same live board is retained')
  app.updateGame(1)
  t.eq(OP.Sim.checksum(sim), before, 'simulation does not advance while Settings is open')
  const model = OP.Menus.build(app)
  t.ok(model.widgets.find(w => w.id === 'settings.reset').disabled, 'profile reset is unavailable during a live run')
  t.ok(model.widgets.find(w => w.id === 'settings.import').disabled, 'backup import is unavailable during a live run')
  OP.Menus.activate(app, { action: 'setting-speed', arg: 2 })
  t.eq(OP.Save.load().settings.gameSpeed, 2, 'Settings changes persist normally')
  OP.Menus.activate(app, { action: 'setting', arg: 'autostart', on: false })
  t.ok(sim.autostart, 'autostart changes apply to the current run')
  t.ok(app.state.io._handlers.key('Escape'), 'the real Escape handler closes Settings')
  t.eq(app.state.screen, 'game', 'Escape returns to the battlefield')
  t.ok(app.state.pauseOpen && sim.paused, 'returning leaves the pause menu open')
  app.updateGame(1)
  t.eq(OP.Sim.checksum(sim), before, 'returning does not silently resume the battle')
  OP.HUD.activate(app, { action: 'pause-settings' })
  OP.Menus.activate(app, { action: 'back' })
  t.eq(app.state.screen, 'game', 'Back button also returns to the battlefield')
  OP.HUD.activate(app, { action: 'pause-resume' })
  app.updateGame(0.1)
  t.gt(sim.tick, 60, 'Resume advances the original battle')

  t.section('Settings opened from title still returns to title')
  app.saveAndQuit()
  OP.Menus.go(app, 'settings')
  OP.Menus.back(app)
  t.eq(OP.Menus.state.screen, 'title', 'normal Settings navigation is unchanged')
  t.eq(app.state.sim, null, 'normal Settings does not revive the prior battle')

  t.section('forced-autostart modes keep their rules')
  const race = app.startGame(OP.MAP_ORDER[0], 'medium', 'rush-trial')
  app.togglePauseMenu()
  app.openPauseSettings()
  OP.Menus.activate(app, { action: 'setting', arg: 'autostart', on: true })
  t.notOk(app.state.profile.settings.autostart, 'the player preference can be disabled')
  t.ok(race.autostart, 'Rush Trial still enforces autostart for its current run')
}

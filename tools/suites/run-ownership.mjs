// Exercise the real shell and storage, not just the campaign helpers: activity
// ownership has to survive reload and must never be inferred from an open menu.
import { loadGame } from '../loadgame.mjs'

export const name = 'run-ownership'
export const needs = ['js/main.js', 'js/save.js', 'js/core/sim.js', 'js/ui/menus.js', 'js/ui/hud.js', 'js/ui/results.js']

const copy = value => JSON.parse(JSON.stringify(value))

function fixture () {
  const env = loadGame()
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return { ...env, app }
}

function reload (env) {
  env.OP.Save.save(env.app.state.profile)
  env.app.saveRun()
  const cold = fixture()
  for (const [key, value] of Object.entries(env.ctx.localStorage._dump())) {
    cold.ctx.localStorage.setItem(key, value)
  }
  cold.app.state.profile = cold.OP.Save.load()
  cold.app.resumeGame()
  return cold
}

function finish (env, won) {
  const sim = env.app.state.sim
  sim.over = true
  sim.outcome = won ? 'won' : 'leaked'
  sim.roundIndex = sim.rules.lastRound
  env.app.updateGame(0)
}

export function run (t) {
  t.section('ordinary games leave pending activities alone, including after reload')
  for (const won of [true, false]) {
    const env = fixture()
    const { OP, app } = env
    const profile = app.state.profile
    OP.Expedition.start(profile, OP.Expeditions.all()[0].key, 800, 25)
    OP.Trial.start(profile, OP.Trials.all()[0].key)
    const day = OP.Daily.generate('2026-09-17')
    OP.DailyCore.start(day)
    const before = copy(profile)
    app.startGame(day.mapKey, 'easy', 'standard')
    finish(env, won)
    t.deep(profile.expedition, before.expedition, 'ordinary outcome does not advance or abandon a Voyage')
    t.deep(profile.activeTrial, before.activeTrial, 'ordinary outcome does not clear a Trial')
    t.deep(profile.daily, before.daily, 'ordinary outcome does not complete a Daily')
    t.eq(OP.DailyCore.active(), day, 'the pending Daily remains available')
    t.eq(profile.stats.gamesWon, won ? 1 : 0, 'ordinary progression still records the game')

    app.startGame(day.mapKey, 'easy', 'standard')
    const cold = reload(env)
    const pending = copy(cold.app.state.profile)
    finish(cold, won)
    t.deep(cold.app.state.profile.expedition, pending.expedition, 'reloaded ordinary run cannot claim a Voyage')
    t.deep(cold.app.state.profile.activeTrial, pending.activeTrial, 'reloaded ordinary run cannot claim a Trial')
  }

  t.section('Voyage and Trial attempts retain ownership through save, restart and settlement')
  for (const type of ['expedition', 'trial']) {
    for (const won of [true, false]) {
      const env = fixture()
      const { OP, app } = env
      const key = type === 'expedition' ? OP.Expeditions.all()[0].key : OP.Trials.all()[0].key
      if (type === 'expedition') OP.Trial.start(app.state.profile, OP.Trials.all()[0].key)
      else OP.Expedition.start(app.state.profile, OP.Expeditions.all()[0].key, 800, 25)
      const unrelatedField = type === 'expedition' ? 'activeTrial' : 'expedition'
      const unrelated = copy(app.state.profile[unrelatedField])
      const sim = type === 'expedition' ? app.startExpedition(key) : app.startTrial(key)
      const profileField = type === 'expedition' ? 'expedition' : 'activeTrial'
      t.eq(sim.runType, type, type + ' has an explicit run type')
      t.eq(app.state.profile[profileField].runId, sim.runId, 'profile binds to the actual attempt')
      t.eq(OP.Save.load()[profileField].runId, sim.runId, 'launch persists the ownership binding')
      const cold = reload(env)
      t.eq(cold.app.state.sim.runId, sim.runId, 'cold resume keeps the attempt identity')
      t.deep(cold.app.state.sim.runContext, sim.runContext, 'cold resume keeps the activity context')
      t.ok(cold.app.state.pauseOpen, 'cold resume waits for the player')
      const startingCash = sim.cash
      cold.app.state.sim.cash = 0
      cold.OP.HUD.activate(cold.app, { action: 'pause-restart' })
      const restarted = cold.app.state.sim
      t.eq(restarted.runType, type, 'HUD restart stays in the activity')
      t.eq(restarted.cash, startingCash, 'HUD restart restores the activity resources')
      t.eq(cold.app.state.profile[profileField].runId, restarted.runId, 'HUD restart binds its new attempt')
      finish(cold, won)
      t.deep(cold.app.state.profile[unrelatedField], unrelated, 'own outcome leaves the other activity alone')
      const after = copy(cold.app.state.profile)
      cold.app.updateGame(0)
      t.deep(cold.app.state.profile, after, 'later frames do not settle the result again')
      t.notOk(cold.app.canContinueFreeplay(), 'campaign legs and Trials cannot continue as freeplay')
      if (type === 'expedition') {
        if (won) {
          t.eq(cold.app.state.profile.expedition.stageIndex, 1, 'own Voyage victory advances one leg')
          const next = cold.app.advanceExpedition()
          t.eq(next.runContext.stageIndex, 1, 'next leg gets the new stage identity')
        } else {
          t.eq(cold.app.state.profile.expedition, null, 'own Voyage defeat abandons the campaign')
          cold.OP.Results.activate(cold.app, { action: 'results-retry' })
          t.eq(cold.app.state.sim.runType, type, 'Voyage retry starts a new campaign')
          t.eq(cold.app.state.profile.expedition.stageIndex, 0, 'Voyage retry begins at the first leg')
        }
      } else {
        t.eq(cold.app.state.profile.activeTrial, null, 'own Trial outcome clears the attempt')
        t.eq(!!cold.app.state.profile.completedTrials[key], won, 'only a won Trial records completion')
        cold.OP.Results.activate(cold.app, { action: 'results-retry' })
        t.eq(cold.app.state.sim.runType, 'trial', 'results retry launches a real Trial attempt')
        t.eq(cold.app.state.profile.activeTrial.runId, cold.app.state.sim.runId, 'retry binds the fresh attempt')
      }
    }
  }

  t.section('activity menus reopen the matching saved board')
  for (const type of ['expedition', 'trial']) {
    const env = fixture()
    const { OP, app } = env
    const key = type === 'expedition' ? OP.Expeditions.all()[0].key : OP.Trials.all()[0].key
    if (type === 'expedition') app.startExpedition(key)
    else app.startTrial(key)
    OP.Sim.startRound(app.state.sim)
    OP.Sim.run(app.state.sim, 90)
    app.state.sim.cash = 123
    const expected = copy(OP.Sim.serialize(app.state.sim))
    t.ok(app.saveAndQuit(), 'activity saves and quits through the shell')
    const screen = type === 'expedition' ? 'expedition' : 'trials'
    OP.Menus.go(app, screen)
    const model = OP.Menus.build(app)
    const button = model.widgets.find(w => w.action === 'start-' + type && w.arg === key)
    t.ok(button && !button.disabled, 'the active activity has an enabled resume button')
    OP.Menus.activate(app, button)
    t.eq(app.state.sim.runId, expected.runId, 'the menu resumes rather than starting a new attempt')
    t.eq(app.state.sim.tick, expected.tick, 'the menu keeps the saved simulation clock')
    t.eq(app.state.sim.cash, 123, 'the menu keeps spent cash')
    t.ok(app.state.pauseOpen, 'the resumed board stays paused')
  }

  t.section('legacy activities get a binding when relaunched, never on an unrelated resume')
  for (const type of ['expedition', 'trial']) {
    const env = fixture()
    const { OP, app } = env
    const key = type === 'expedition' ? OP.Expeditions.all()[0].key : OP.Trials.all()[0].key
    const field = type === 'expedition' ? 'expedition' : 'activeTrial'
    if (type === 'expedition') OP.Expedition.start(app.state.profile, key, 800, 25)
    else OP.Trial.start(app.state.profile, key)
    delete app.state.profile[field].runId
    OP.Save.save(app.state.profile)
    app.state.profile = OP.Save.load()
    t.eq(app.state.profile[field].runId, null, 'legacy profiles have no implicit run owner')
    const sim = type === 'expedition' ? app.resumeExpedition() : app.resumeTrial()
    t.eq(app.state.profile[field].runId, sim.runId, 'relaunch binds the legacy activity to a new run')
  }

  t.section('an old save cannot settle a replacement attempt of the same activity')
  for (const type of ['expedition', 'trial']) {
    for (const won of [true, false]) {
      const env = fixture()
      const { OP, app } = env
      const key = type === 'expedition' ? OP.Expeditions.all()[0].key : OP.Trials.all()[0].key
      const launch = () => type === 'expedition' ? app.startExpedition(key) : app.startTrial(key)
      const old = launch()
      const saved = copy(OP.Sim.serialize(old))
      launch()
      const field = type === 'expedition' ? 'expedition' : 'activeTrial'
      const replacement = copy(app.state.profile[field])
      app.state.sim = OP.Sim.deserialize(saved, OP.Maps.build(saved.mapKey))
      app.togglePauseMenu()
      OP.HUD.activate(app, { action: 'pause-restart' })
      t.eq(app.state.sim.runId, old.runId, 'stale restart does not replace the current attempt')
      t.ok(app.state.pauseOpen, 'stale restart stays paused')
      finish(env, won)
      t.deep(app.state.profile[field], replacement, 'stale outcome leaves the replacement attempt untouched')
    }
  }

  t.section('Daily results belong to the saved date, not the currently viewed day')
  for (const won of [true, false]) {
    const env = fixture()
    const { OP, app } = env
    const day = OP.Daily.generate('2026-09-16')
    OP.DailyCore.start(day)
    OP.Menus.go(app, 'daily')
    OP.Menus.activate(app, { action: 'play-daily' })
    t.eq(app.state.sim.runType, 'daily', 'the real menu creates a Daily run')
    const cold = reload(env)
    const otherDay = cold.OP.Daily.generate('2026-09-17')
    cold.OP.DailyCore.start(otherDay)
    finish(cold, won)
    const profile = cold.app.state.profile
    t.eq(profile.daily[day.dateKey] && profile.daily[day.dateKey].won, won, 'the saved date receives the outcome')
    t.notOk(profile.daily[otherDay.dateKey], 'the other day receives no result')
    t.eq(cold.OP.DailyCore.active(), otherDay, 'the other daily stays active')
    if (won) {
      const recorded = copy(profile.daily)
      cold.app.continueFreeplay()
      finish(cold, false)
      t.deep(profile.daily, recorded, 'freeplay cannot settle either daily again')
    } else {
      cold.OP.Results.activate(cold.app, { action: 'results-retry' })
      t.eq(cold.app.state.sim.runContext.dateKey, day.dateKey, 'Daily retry retains the original date')
      finish(cold, true)
      t.ok(profile.daily[day.dateKey].won, 'a retry can complete a previously lost Daily')
      t.notOk(profile.daily[otherDay.dateKey], 'retry still leaves the other day untouched')
    }
  }
}

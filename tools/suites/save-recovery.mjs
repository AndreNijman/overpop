import { loadGame } from '../loadgame.mjs'

export const name = 'save-recovery'
export const needs = ['js/save.js', 'js/main.js', 'js/ui/hud.js']

export function run (t) {
  const env = loadGame()
  const OP = env.OP
  const app = OP.App
  const Save = OP.Save
  const storage = env.ctx.localStorage
  app.state.profile = Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  const mapKey = OP.MAP_ORDER[0]
  const sim = app.startGame(mapKey, 'easy', 'standard')

  t.section('a damaged current save recovers the previous checkpoint')
  sim.cash = 321
  t.ok(app.saveRun(), 'first checkpoint saves')
  sim.cash = 123
  t.ok(app.saveRun(), 'second checkpoint saves')
  t.eq(Save.loadRun().snapshot.cash, 123, 'the latest healthy save is preferred')
  const latest = JSON.parse(storage.getItem(Save.RUN_KEY))
  for (const corrupt of [
    payload => { payload.snapshot.tick = -1 },
    payload => { payload.snapshot.rng = null },
    payload => { payload.snapshot.mapKey = 'wrong-map' }
  ]) {
    const payload = JSON.parse(JSON.stringify(latest))
    corrupt(payload)
    storage.setItem(Save.RUN_KEY, JSON.stringify(payload))
    t.eq(Save.loadRun() && Save.loadRun().snapshot.cash, 321, 'invalid envelope recovers the prior checkpoint')
  }
  storage.setItem(Save.RUN_KEY, '{broken')
  const recovered = Save.loadRun()
  t.ok(recovered, 'the previous checkpoint is available')
  if (!recovered) return
  t.eq(recovered.snapshot.cash, 321, 'recovery returns the previous saved state')
  t.eq(recovered.snapshot.runId, sim.runId, 'recovery belongs to the same run')
  t.ok(recovered.recovered, 'recovery is explicitly reported')
  const cold = loadGame()
  for (const [key, value] of Object.entries(storage._dump())) cold.ctx.localStorage.setItem(key, value)
  t.eq(cold.OP.Save.loadRun().snapshot.cash, 321, 'recovery survives a completely fresh bundle')
  const resumed = app.resumeGame()
  t.eq(resumed.cash, 321, 'the shell can resume the recovered checkpoint')
  t.ok(app.state.pauseOpen, 'recovery resumes paused')
  t.ok(JSON.stringify(OP.HUD.buildPauseMenu(app).marks).includes('Recovered previous checkpoint'),
    'the player is told that a previous checkpoint was recovered')

  t.section('storage failures preserve the current and previous saves')
  const realSet = storage.setItem
  storage.setItem = (key, value) => {
    if (key === Save.RUN_KEY) throw new Error('QuotaExceededError')
    realSet(key, value)
  }
  try {
    t.notOk(app.saveRun(), 'failure to write the recovered run is reported')
    t.eq(Save.loadRun().snapshot.cash, 321, 'the recovery checkpoint survives a failed write')
  } finally { storage.setItem = realSet }
  t.ok(app.saveRun(), 'the recovered run saves once storage works')
  t.notOk(Save.loadRun().recovered, 'the new healthy save is preferred')
  resumed.cash = 99
  storage.setItem = (key, value) => {
    if (key === Save.RUN_KEY) throw new Error('QuotaExceededError')
    realSet(key, value)
  }
  try {
    t.notOk(app.saveRun(), 'a primary write failure with a healthy current save is reported')
    t.eq(Save.loadRun().snapshot.cash, 321, 'the healthy current save survives primary write failure')
  } finally { storage.setItem = realSet }
  storage.setItem = (key, value) => {
    if (key === Save.RUN_BACKUP_KEY) throw new Error('QuotaExceededError')
    realSet(key, value)
  }
  try {
    t.notOk(app.saveRun(), 'backup write failure is reported before replacing the current save')
    t.eq(Save.loadRun().snapshot.cash, 321, 'the last good current save remains intact')
  } finally { storage.setItem = realSet }

  t.section('a new run never inherits another run’s checkpoint')
  const next = app.startGame(mapKey, 'easy', 'standard')
  t.neq(next.runId, sim.runId, 'the next run has its own identity')
  t.ok(app.saveRun(), 'the new run saves')
  storage.setItem(Save.RUN_KEY, '{broken')
  t.eq(Save.loadRun(), null, 'corruption cannot resurrect the previous run')

  t.section('clearing and resetting cannot resurrect completed checkpoints')
  t.ok(app.saveRun(), 'first new checkpoint saves')
  next.cash = 777
  t.ok(app.saveRun(), 'second new checkpoint saves')
  const backup = storage.getItem(Save.RUN_BACKUP_KEY)
  t.ok(backup, 'a backup exists before clearing')
  t.ok(Save.clearRun(), 'clear removes the run and backup')
  t.eq(storage.getItem(Save.RUN_BACKUP_KEY), null, 'backup is removed')
  storage.setItem(Save.RUN_BACKUP_KEY, backup)
  t.notOk(Save.hasRun(), 'an orphan backup cannot revive an intentionally cleared run')
  app.saveRun()
  app.saveRun()
  Save.reset()
  t.eq(storage.getItem(Save.RUN_BACKUP_KEY), null, 'profile reset also removes the backup')
  t.notOk(Save.hasRun(), 'reset leaves no resumable run')

  t.section('damaged backups and legacy run identities do not cross run boundaries')
  app.saveRun()
  app.saveRun()
  storage.setItem(Save.RUN_KEY, '{broken')
  storage.setItem(Save.RUN_BACKUP_KEY, 'null')
  t.eq(Save.loadRun(), null, 'two unusable entries return no run without throwing')
  Save.clearRun()
  next.runId = null
  app.saveRun()
  next.cash = 88
  app.saveRun()
  storage.setItem(Save.RUN_KEY, '{broken')
  t.eq(Save.loadRun(), null, 'legacy saves without identity are not guessed to be the same run')
}

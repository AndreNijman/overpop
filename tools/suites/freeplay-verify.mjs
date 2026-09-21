import { loadGame } from '../loadgame.mjs'

export const name = 'freeplay-verify'
export const needs = ['js/core/freeplay.js', 'js/core/rounds.js', 'js/core/sim.js', 'js/main.js', 'js/save.js']

function fixture (env) {
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return app
}

function winGame (OP, app, lastRound) {
  app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', {
    rules: { lastRound: lastRound || 2, startCash: 99999, startLives: 999 }
  })
  const sim = app.state.sim
  for (let i = 0; i < 8; i++) {
    OP.Towers.place(sim, OP.TOWER_ORDER[0], 120 + i * 120, 300, { free: true })
  }
  for (let r = 1; r <= (lastRound || 2); r++) {
    OP.Sim.startRound(sim)
    OP.Sim.runRound(sim, 60 * 600)
  }
  return sim
}

export function run (t) {
  const env = loadGame()
  const { OP } = env
  const app = fixture(env)

  t.section('can enter freeplay after winning')
  {
    const sim = winGame(OP, app, 2)
    t.ok(sim.over, 'game is over')
    t.eq(sim.outcome, 'won', 'outcome is won')
    t.ok(OP.Sim.canEnterFreeplay(sim), 'canEnterFreeplay is true after win')
    const ok = OP.Sim.enterFreeplay(sim)
    t.ok(ok, 'enterFreeplay succeeds')
    t.ok(sim.freeplay, 'sim.freeplay flag is set')
    t.notOk(sim.over, 'sim.over is cleared')
    t.eq(sim.outcome, null, 'outcome is cleared')
  }

  t.section('cannot enter freeplay on a loss')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', {
      rules: { lastRound: 1, startCash: 0, startLives: 1 }
    })
    const sim = app.state.sim
    OP.Sim.startRound(sim)
    OP.Sim.runRound(sim, 60 * 600)
    t.ok(sim.over, 'game is over')
    t.eq(sim.outcome, 'leaked', 'outcome is leaked')
    t.notOk(OP.Sim.canEnterFreeplay(sim), 'cannotEnterFreeplay after loss')
  }

  t.section('towers are preserved on freeplay entry')
  {
    const sim = winGame(OP, app, 2)
    const towerCount = sim.towers.length
    OP.Sim.enterFreeplay(sim)
    t.eq(sim.towers.length, towerCount, 'tower count preserved after entering freeplay')
  }

  t.section('cash and lives are preserved on freeplay entry')
  {
    const sim = winGame(OP, app, 2)
    const cash = sim.cash
    const lives = sim.lives
    OP.Sim.enterFreeplay(sim)
    t.eq(sim.cash, cash, 'cash preserved after entering freeplay')
    t.eq(sim.lives, lives, 'lives preserved after entering freeplay')
  }

  t.section('freeplay rounds generate without errors')
  {
    const sim = winGame(OP, app, 2)
    OP.Sim.enterFreeplay(sim)
    for (let idx = 101; idx <= 110; idx++) {
      const round = OP.Freeplay.generate(sim, idx)
      t.ok(round, 'round ' + idx + ' generated')
      t.ok(Array.isArray(round.groups), 'round ' + idx + ' has groups')
      t.ok(round.groups.length > 0, 'round ' + idx + ' has at least one group')
    }
  }

  t.section('freeplay rounds chain and complete')
  {
    const sim = winGame(OP, app, 2)
    OP.Sim.enterFreeplay(sim)
    OP.Sim.startRound(sim)
    const beforeTick = sim.tick
    const result = OP.Sim.runRound(sim, 60 * 600)
    t.ok(result.completed, 'first freeplay round completes')
    t.gt(result.ticks, 0, 'at least some ticks ran')
    t.ok(sim.tick > beforeTick, 'tick advanced')
  }

  t.section('freeplay scaleFor is monotonically increasing')
  {
    let prev = OP.Freeplay.scaleFor(101)
    for (let n = 102; n <= 200; n++) {
      const cur = OP.Freeplay.scaleFor(n)
      t.gt(cur.hpScale, prev.hpScale, 'hpScale increases at round ' + n)
      prev = cur
    }
  }

  t.section('freeplay save and resume is deterministic')
  {
    const sim = winGame(OP, app, 2)
    OP.Sim.enterFreeplay(sim)
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 30)
    const checksum1 = OP.Sim.checksum(sim)
    app.saveRun()
    const saved = OP.Save.loadRun()
    t.ok(saved, 'saved freeplay state')
    t.ok(saved.snapshot.freeplay, 'freeplay flag is in snapshot')
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    app.resumeGame()
    const sim2 = app.state.sim
    t.ok(sim2.freeplay, 'resumed into freeplay')
    const checksum2 = OP.Sim.checksum(sim2)
    t.eq(checksum1, checksum2, 'checksum matches after resume')
  }

  t.section('freeplay baseline stats are recorded')
  {
    const sim = winGame(OP, app, 2)
    OP.Sim.enterFreeplay(sim)
    t.ok(sim.freeplayBaseline, 'freeplayBaseline is set')
    t.ok(typeof sim.freeplayBaseline.round === 'number', 'baseline has round')
    t.ok(typeof sim.freeplayBaseline.roundsCleared === 'number', 'baseline has roundsCleared')
    t.ok(typeof sim.freeplayBaseline.pops === 'number', 'baseline has pops')
    t.ok(typeof sim.freeplayBaseline.cash === 'number', 'baseline has cash')
  }

  t.section('multiple freeplay rounds chain without error')
  {
    const sim = winGame(OP, app, 2)
    OP.Sim.enterFreeplay(sim)
    let completed = 0
    for (let r = 0; r < 5 && !sim.over; r++) {
      OP.Sim.startRound(sim)
      const res = OP.Sim.runRound(sim, 60 * 600)
      if (res.completed) completed++
    }
    t.gt(completed, 0, 'at least one freeplay round completed')
    t.notOk(sim.over, 'game did not unexpectedly end')
  }
}

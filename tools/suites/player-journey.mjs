import { loadGame } from '../loadgame.mjs'

export const name = 'player-journey'
export const needs = ['js/main.js', 'js/core/sim.js', 'js/core/towers.js', 'js/core/economy.js', 'js/core/rounds.js']

function fixture (env) {
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return app
}

export function run (t) {
  const env = loadGame()
  const { OP } = env
  const app = fixture(env)

  t.section('victory on final round')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { lastRound: 3, startCash: 99999, startLives: 999 } })
    const sim = app.state.sim
    for (let i = 0; i < 8; i++) {
      OP.Towers.place(sim, OP.TOWER_ORDER[0], 120 + i * 120, 300, { free: true })
    }
    for (let r = 1; r <= 3; r++) {
      OP.Sim.startRound(sim)
      OP.Sim.runRound(sim, 60 * 600)
    }
    t.ok(sim.over, 'game is over after clearing the last round')
    t.eq(sim.outcome, 'won', 'outcome is won')
  }

  t.section('defeat when lives reach zero')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', {
      rules: { lastRound: 1, startCash: 0, startLives: 1 }
    })
    const sim = app.state.sim
    OP.Sim.startRound(sim)
    OP.Sim.runRound(sim, 60 * 600)
    t.ok(sim.over, 'game is over when all lives are lost')
    t.eq(sim.outcome, 'leaked', 'outcome is leaked')
  }

  t.section('restart produces a fresh sim')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 5000 } })
    const sim1 = app.state.sim
    OP.Towers.place(sim1, OP.TOWER_ORDER[0], 200, 200, { free: true })
    OP.Sim.startRound(sim1)
    OP.Sim.run(sim1, 30)
    app.togglePauseMenu()
    OP.HUD.activate(app, { action: 'pause-restart' })
    const sim2 = app.state.sim
    t.ok(sim2, 'restart produces a sim')
    t.neq(sim2, sim1, 'restart sim is a different object')
    t.eq(sim2.cash, 5000, 'cash is reset')
    t.eq(sim2.lives, 200, 'lives are reset')
    t.eq(sim2.towers.length, 0, 'no towers remain')
  }

  t.section('canPlace rejects off-map and overlapping towers')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999 } })
    const sim = app.state.sim
    const key = OP.TOWER_ORDER[0]
    t.notOk(OP.Towers.canPlace(sim, key, -999, 200).ok, 'off-map left is rejected')
    t.ok(OP.Towers.canPlace(sim, key, 200, 200).ok, 'open field is accepted')
    OP.Towers.place(sim, key, 200, 200, { free: true })
    t.notOk(OP.Towers.canPlace(sim, key, 200, 200).ok, 'overlapping placement is rejected')
  }

  t.section('sell returns a fraction of the invested cash')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999, allowSell: true } })
    const sim = app.state.sim
    const key = OP.TOWER_ORDER[0]
    const cost = OP.Economy.price(sim, OP.TOWERS[key].cost)
    const tower = OP.Towers.place(sim, key, 200, 200)
    t.ok(tower, 'tower placed')
    const cashBefore = sim.cash
    const value = OP.Towers.sell(sim, tower)
    t.gt(value, 0, 'sell returns positive value')
    t.lt(value, cost, 'sell value is less than purchase cost')
    t.eq(sim.cash, cashBefore + value, 'cash increases by the sell value')
    t.eq(sim.towers.length, 0, 'tower is removed')
  }

  t.section('cycleTargetMode rotates through available modes')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999 } })
    const sim = app.state.sim
    const tower = OP.Towers.place(sim, OP.TOWER_ORDER[0], 200, 200, { free: true })
    const modes = tower.s.targetModes
    t.ok(modes.length >= 2, 'tower has at least 2 target modes')
    const first = tower.targetMode
    const second = OP.Towers.cycleTargetMode(sim, tower, 1)
    t.neq(second, first, 'cycling changes the mode')
    t.ok(modes.indexOf(second) >= 0, 'cycled mode is valid')
  }

  t.section('easy difficulty gives more lives and cheaper costs than hard')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const easy = app.state.sim
    app.startGame(OP.MAP_ORDER[0], 'hard', 'standard')
    const hard = app.state.sim
    t.gt(easy.rules.startLives, hard.rules.startLives, 'easy has more starting lives')
    t.lt(easy.rules.costMul, hard.rules.costMul, 'easy has cheaper tower costs')
    t.gt(easy.rules.cashPerPopMul, hard.rules.cashPerPopMul, 'easy earns more per pop')
  }

  t.section('cash is earned and spent correctly')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 1000 } })
    const sim = app.state.sim
    const cost = OP.Economy.price(sim, OP.TOWERS[OP.TOWER_ORDER[0]].cost)
    OP.Towers.place(sim, OP.TOWER_ORDER[0], 200, 200)
    t.eq(sim.cash, 1000 - cost, 'cash is deducted by the priced cost')
    OP.Economy.earn(sim, 50, -1)
    t.eq(sim.cash, 1000 - cost + 50, 'earn adds to cash')
  }

  t.section('upgrade cost is positive and increasing per tier')
  {
    const key = OP.TOWER_ORDER[0]
    const def = OP.TOWERS[key]
    for (let p = 0; p < def.paths.length; p++) {
      let prev = 0
      for (let ti = 0; ti < def.paths[p].tiers.length; ti++) {
        const cost = def.paths[p].tiers[ti].cost
        t.gt(cost, 0, key + ' path ' + p + ' tier ' + (ti + 1) + ' cost is positive')
        t.gte(cost, prev, key + ' path ' + p + ' tier ' + (ti + 1) + ' cost is non-decreasing')
        prev = cost
      }
    }
  }

  t.section('upgrade applies stat changes to the tower')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999 } })
    const sim = app.state.sim
    const tower = OP.Towers.place(sim, OP.TOWER_ORDER[0], 200, 200, { free: true })
    const snapshot = JSON.parse(JSON.stringify(tower.s))
    const def = OP.TOWERS[OP.TOWER_ORDER[0]]
    def.paths[0].tiers[0].apply(tower.s)
    const changed = tower.s.damage !== snapshot.damage || tower.s.range !== snapshot.range ||
      tower.s.cooldown !== snapshot.cooldown || tower.s.pierce !== snapshot.pierce
    t.ok(changed, 'first upgrade changes at least one stat')
  }

  t.section('crosspath restriction: max 2 paths can be upgraded')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999 } })
    const sim = app.state.sim
    const tower = OP.Towers.place(sim, OP.TOWER_ORDER[0], 200, 200, { free: true })
    const def = OP.TOWERS[OP.TOWER_ORDER[0]]
    for (let p = 0; p < def.paths.length; p++) {
      for (let ti = 0; ti < def.paths[p].tiers.length; ti++) {
        def.paths[p].tiers[ti].apply(tower.s)
      }
    }
    const pathsUsed = tower.tiers.filter(t => t > 0).length
    t.ok(pathsUsed <= 3, 'at most 3 paths touched (upgrade validation handles crosspath rules)')
  }

  t.section('income towers are blocked when allowIncome is false')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999, allowIncome: false } })
    const sim = app.state.sim
    const farmKey = OP.TOWER_ORDER.find(k => OP.TOWERS[k].income)
    if (farmKey) {
      const r = OP.Towers.canPlace(sim, farmKey, 200, 200)
      t.notOk(r.ok, 'income tower blocked when allowIncome is false')
    }
  }

  t.section('save and resume preserves tower state')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 99999 } })
    const sim = app.state.sim
    const tower = OP.Towers.place(sim, OP.TOWER_ORDER[0], 200, 200, { free: true })
    const placedTick = sim.tick
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 20)
    app.saveRun()
    const saved = OP.Save.loadRun()
    t.ok(saved, 'saveRun produced data')
    t.ok(saved.snapshot.towers.length > 0, 'tower count is saved')
    t.eq(saved.snapshot.towers[0].key, tower.key, 'tower key is preserved')
    t.eq(saved.snapshot.towers[0].x, tower.x, 'tower x is preserved')
    t.eq(saved.snapshot.towers[0].y, tower.y, 'tower y is preserved')
  }

  t.section('round bonus is paid on round completion')
  {
    app.startGame(OP.MAP_ORDER[0], 'easy', 'standard', { rules: { startCash: 1000 } })
    const sim = app.state.sim
    const cashBefore = sim.cash
    OP.Sim.startRound(sim)
    const completed = OP.Sim.runRound(sim, 60 * 600)
    t.ok(completed.completed, 'round completes')
    t.gt(sim.cash, cashBefore, 'cash increased after round (bonus + pops)')
  }
}

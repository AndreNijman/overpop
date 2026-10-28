import { loadGame } from '../loadgame.mjs'
import { makeSim } from './_fixture.mjs'

export const name = 'income-journey'
export const needs = ['js/main.js', 'js/core/rounds.js', 'js/towers/support.js', 'js/save.js']

export function run (t) {
  const { OP } = loadGame()

  t.section('fresh farm only harvests active-round time, including across saves')
  {
    const app = OP.App
    app.state.profile = OP.Save.defaults()
    let sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    let farm = OP.Towers.place(sim, 'berry-warren', 200, 200)
    t.ok(farm, 'fresh player can buy a real starter farm')
    const startCash = sim.cash
    OP.Sim.run(sim, 600)
    t.eq(sim.cash, startCash, 'waiting before Start Round earns no free money')
    t.eq(farm.data.h, 0, 'waiting does not precharge the first harvest')
    t.eq(farm.earned, 0, 'no idle income is attributed to the farm')
    t.ok(app.saveRun(), 'pre-round farm checkpoint saves')
    sim = app.resumeGame()
    farm = sim.towers[0]
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(sim, 600)
    t.eq(sim.cash, startCash, 'reload before the first round cannot produce idle income')
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 60)
    const partial = farm.data.h
    t.gt(partial, 0, 'active round starts the harvest clock')
    t.eq(farm.earned, 0, 'partial harvest pays nothing yet')
    app.togglePauseMenu()
    app.updateGame(10)
    t.eq(farm.data.h, partial, 'pausing does not advance harvest time')
    t.ok(app.saveRun(), 'partial harvest saves')
    sim = app.resumeGame()
    farm = sim.towers[0]
    t.eq(farm.data.h, partial, 'partial harvest survives resume exactly')
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(sim, 61)
    t.eq(farm.earned, farm.s.yield, 'continued active time pays one harvest, not the idle backlog')
    t.ok(OP.Sim.runRound(sim, 60 * 600).completed, 'farm-only opening reaches a normal round end')
    const betweenCash = sim.cash
    const betweenClock = farm.data.h
    const earned = farm.earned
    OP.Sim.run(sim, 900)
    t.eq(sim.cash, betweenCash, 'waiting between rounds cannot farm cash')
    t.eq(farm.data.h, betweenClock, 'harvest remainder freezes between rounds')
    app.saveRun()
    sim = app.resumeGame()
    farm = sim.towers[0]
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(sim, 600)
    t.eq(sim.cash, betweenCash, 'between-round resume still pays no idle income')
    t.eq(farm.data.h, betweenClock, 'reload preserves the frozen harvest remainder')
    OP.Sim.startRound(sim)
    const untilHarvest = Math.ceil((farm.s.harvest - farm.data.h) / OP.DT) + 1
    OP.Sim.run(sim, untilHarvest)
    t.eq(farm.earned, earned + farm.s.yield, 'next round resumes the remainder and pays exactly one harvest')
  }

  // Focused lifecycle fixtures make round 10 complete in a single tick. Round
  // 11 stays active so the tests can distinguish completion from autostart.
  function roundFixture (path, tier, opts = {}) {
    const sim = makeSim(OP, {
      cash: 1000000, lives: 200, autostart: !!opts.autostart,
      roundSetKey: 'income-clock',
      roundSet: { 10: { groups: [] }, 11: { groups: [{ tier: 'red', count: 1, delay: 60 }] } },
      rules: { firstRound: 10, lastRound: opts.lastRound || 11 }
    })
    const farm = OP.Towers.place(sim, 'berry-warren', 200, 200)
    for (let n = 0; n < tier; n++) t.ok(OP.Upgrades.buy(sim, farm, path).ok, 'fixture pays for income upgrade')
    return { sim, farm }
  }

  t.section('final-round windfall is paid before victory and never paid again')
  {
    const { sim, farm } = roundFixture(2, 4, { lastRound: 10 })
    OP.Sim.startRound(sim)
    const cash = sim.cash
    const bonus = OP.Economy.roundBonus(sim, 10)
    OP.Sim.step(sim)
    t.ok(sim.over && sim.outcome === 'won', 'fixture wins on the configured final round')
    t.eq(farm.earned, 720, 'final-round windfall uses the actual completed round number')
    t.eq(sim.cash, cash + bonus + 720, 'victory cash includes the ordinary bonus and the farm payout')
    t.eq(farm.data.rounds, 1, 'farm ledger settles on the completion tick')
    t.notOk(OP.Rounds.complete(sim), 'finished round cannot be completed twice')
    t.ok(OP.Sim.enterFreeplay(sim), 'winning fixture can continue to freeplay')
    OP.Sim.run(sim, 600)
    t.eq(farm.earned, 720, 'freeplay continuation does not repeat the final payout or idle-harvest')
    t.eq(sim.cash, cash + bonus + 720, 'waiting after victory adds no extra money')
  }

  t.section('autostart cannot shift a windfall onto the next round number')
  {
    const { sim, farm } = roundFixture(2, 4, { autostart: true })
    OP.Sim.startRound(sim)
    OP.Sim.step(sim)
    t.eq(sim.roundIndex, 11, 'autostart has advanced to round eleven')
    t.eq(farm.earned, 720, 'round-ten payout is not incorrectly calculated as round eleven')
    t.eq(farm.data.rounds, 1, 'autostart observes an already-settled ledger')
    OP.Sim.run(sim, 30)
    t.eq(farm.earned, 720, 'next-round updates do not repeat the windfall')
  }

  t.section('interest reaching bank capacity pays out on the round boundary')
  {
    const { sim, farm } = roundFixture(1, 3)
    farm.data.bank = 1199
    OP.Sim.startRound(sim)
    const cash = sim.cash
    const bonus = OP.Economy.roundBonus(sim, 10)
    OP.Sim.step(sim)
    t.eq(farm.data.bank, 0, 'interest fills and empties the capped bank immediately')
    t.eq(farm.earned, 1200, 'automatic collection pays the bank capacity once')
    t.eq(sim.cash, cash + bonus + 1200, 'cash includes exactly one bank payout')
    OP.Sim.run(sim, 600)
    t.eq(sim.cash, cash + bonus + 1200, 'no extra collection or harvest occurs while waiting')
  }

  t.section('old pending checkpoints recover once without counting new-round income')
  for (const active of [false, true]) {
    const { sim, farm } = roundFixture(1, 4)
    OP.Sim.startRound(sim, active ? 11 : 10)
    sim.round.done = !active
    sim.stats.roundsCleared = 1
    farm.data.rounds = 0 // matches the preceding build's next-tick payout checkpoint
    farm.data.bank = 1000
    farm.data.h = 1.999 // next active tick harvests; idle ticks must not
    let restored = OP.Sim.deserialize(OP.Sim.serialize(sim), sim.map)
    OP.Sim.run(restored, 1)
    let back = restored.towers[0]
    t.eq(back.data.bank, active ? 1258 : 1250, 'legacy interest settles before any new-round harvest')
    t.eq(back.data.rounds, 1, 'legacy recovery records the paid cleared-round count')
    if (!active) t.eq(back.data.h, 1.999, 'legacy idle recovery does not advance the harvest clock')
    restored = OP.Sim.deserialize(OP.Sim.serialize(restored), sim.map)
    OP.Sim.run(restored, 1)
    back = restored.towers[0]
    t.eq(back.data.bank, active ? 1258 : 1250, 'reloading a repaired checkpoint cannot pay interest twice')
  }

  t.section('legacy autostart checkpoint uses the previous round for windfalls')
  {
    const { sim, farm } = roundFixture(2, 4, { autostart: true })
    OP.Sim.startRound(sim, 11)
    sim.stats.roundsCleared = 1
    farm.data.rounds = 0
    const restored = OP.Sim.deserialize(OP.Sim.serialize(sim), sim.map)
    OP.Sim.run(restored, 1)
    t.eq(restored.towers[0].earned, 720, 'legacy pending payout belongs to completed round ten')
  }
}

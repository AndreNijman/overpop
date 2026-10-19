import { loadGame } from '../loadgame.mjs'

export const name = 'progression-journey'
export const needs = ['js/main.js', 'js/save.js', 'js/core/towerxp.js', 'js/ui/bestiary.js', 'js/ui/shop.js', 'js/ui/tower-panel.js']

function fixture () {
  const env = loadGame()
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return { ...env, app }
}

function unlockWidget (OP, app) {
  OP.TowerMenu.activate(app, { action: 'bestiary-tower', arg: 'acorn-fox' })
  return OP.TowerMenu.build(app).widgets.find(w => w.action === 'bestiary-unlock' && w.arg === 'acorn-fox|0|1')
}

export function run (t) {
  t.section('player level opens the real shop roster')
  {
    const { OP, app } = fixture()
    const key = 'boomer-badger'
    let sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    t.eq(OP.Save.playerLevel(app.state.profile), 1, 'fresh player begins at level one')
    t.notOk(OP.Economy.progressionAllowsTower(sim, OP.TOWERS[key]), 'level-two tower is initially locked')
    const blocked = OP.Shop.entryState(sim, OP.TOWERS[key], false)
    t.eq(blocked.state, 'blocked', 'shop does not offer a progression-locked tower')
    t.ok(blocked.reason.includes('level 2'), 'shop explains the required player level')
    t.eq(OP.Towers.place(sim, key, 200, 200), null, 'placement also enforces the lock')
    // Two normal easy wins pay enough player XP to reach the next level.
    for (let i = 0; i < 2; i++) OP.Save.recordResult(app.state.profile, {
      won: true, roundsCleared: 40, mapKey: OP.MAP_ORDER[0], difficulty: 'easy', mode: 'standard'
    })
    t.eq(OP.Save.playerLevel(app.state.profile), 2, 'ordinary results earn the next player level')
    t.ok(OP.Save.save(app.state.profile), 'level progress is saved')
    app.state.profile = OP.Save.load()
    sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    t.eq(OP.Shop.entryState(sim, OP.TOWERS[key], false).state, 'ok', 'reloaded level-two player can buy the new tower')
    const cash = sim.cash
    const tower = OP.Towers.place(sim, key, 200, 200)
    t.ok(tower, 'unlocked tower can actually be placed')
    t.eq(sim.cash, cash - OP.Economy.price(sim, OP.TOWERS[key].cost), 'unlock does not waive placement cash')
  }

  t.section('menu XP unlock persists; cash buys the in-match upgrade')
  {
    const { OP, app } = fixture()
    // Earn the XP by playing with a real starter, without free placements,
    // synthetic unlocks, or extra starting cash/lives. Losing still banks XP.
    const firstRun = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    t.ok(OP.Towers.place(firstRun, 'acorn-fox', 200, 200), 'fresh player can afford the starter')
    for (let r = 0; r < 40 && !firstRun.over; r++) {
      OP.Sim.startRound(firstRun)
      OP.Sim.runRound(firstRun, 60 * 600)
    }
    t.ok(firstRun.over, 'starter-only run reaches a real result')
    app.updateGame(0)
    const earned = OP.TowerXp.profileXp(app.state.profile, 'acorn-fox')
    t.gte(earned, 150, 'normal play earns enough tower XP for a first upgrade')
    app.quitToMenu()
    const widget = unlockWidget(OP, app)
    t.ok(widget, 'tower menu exposes the locked cell')
    OP.TowerMenu.activate(app, widget)
    const saved = OP.Save.load()
    t.eq(OP.TowerXp.profileXp(saved, 'acorn-fox'), earned - 150, 'XP cost is immediately persisted')
    t.eq(OP.TowerXp.pathUnlocked(saved, 'acorn-fox', 0), 1, 'the purchased cell survives reload')
    t.eq(OP.TowerXp.pathUnlocked(saved, 'acorn-fox', 1), 0, 'another branch remains locked')
    OP.TowerMenu.activate(app, widget)
    t.eq(app.state.profile.towerXp['acorn-fox'], earned - 150, 'stale unlock button cannot spend again')
    app.state.profile = saved
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    app.state.io.selectedId = tower.id
    const upgrade = OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-upgrade' && w.arg === 0)
    t.ok(upgrade, 'selected tower exposes the unlocked upgrade')
    const cash = sim.cash
    const cost = OP.TowerPanel.branchState(sim, tower, 0).cost
    OP.TowerPanel.activate(app, upgrade)
    t.eq(tower.tiers[0], 1, 'cash purchase installs the upgrade')
    t.eq(sim.cash, cash - cost, 'the displayed upgrade price is charged')
    t.eq(OP.TowerXp.available(sim, tower.key), earned - 150, 'cash purchase grants no XP')
    t.notOk(OP.TowerPanel.branchState(sim, tower, 1).ok, 'unbought XP branch still refuses cash')
    t.ok(app.saveRun(), 'upgraded run saves')
    app.state.sim = null
    app.state.profile = OP.Save.load()
    const resumed = app.resumeGame()
    t.eq(resumed.towers[0].tiers[0], 1, 'installed upgrade survives run resume')
    t.eq(resumed.cash, cash - cost, 'resume does not refund the cash purchase')
  }

  t.section('storage refusal leaves the menu purchase retryable')
  {
    const { OP, app, ctx } = fixture()
    app.state.profile.towerXp['acorn-fox'] = 300
    OP.Save.save(app.state.profile)
    const widget = unlockWidget(OP, app)
    const setItem = ctx.localStorage.setItem
    ctx.localStorage.setItem = () => { throw new Error('Quota exceeded') }
    try {
      OP.TowerMenu.activate(app, widget)
      t.eq(app.state.profile.towerXp['acorn-fox'], 300, 'failed persistence spends no XP')
      t.eq(OP.TowerXp.pathUnlocked(app.state.profile, 'acorn-fox', 0), 0, 'failed persistence grants no unlock')
      t.ok(OP.Menus.state.notice.includes('not spent'), 'failure explains that the purchase was not applied')
    } finally { ctx.localStorage.setItem = setItem }
    OP.TowerMenu.activate(app, widget)
    t.eq(OP.Save.load().towerXp['acorn-fox'], 150, 'retry spends exactly one purchase')
    OP.TowerMenu.activate(app, widget)
    t.eq(OP.Save.load().towerXp['acorn-fox'], 150, 'duplicate request cannot spend the remaining balance')
  }

  t.section('live XP purchases save both wallets and the run together')
  {
    const { OP, app, ctx } = fixture()
    app.state.profile.towerXp['acorn-fox'] = 100
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    tower.runXp = 200
    OP.Save.save(app.state.profile)
    app.saveRun()
    app.saveRun() // include an old recovery checkpoint with unspent XP
    const widget = unlockWidget(OP, app)
    t.ok(OP.TowerMenu.build(app).marks.some(m => m.text === 'TOWER XP  300'), 'menu displays the same banked-plus-live wallet it spends')
    OP.TowerMenu.activate(app, widget)
    t.eq(OP.TowerXp.profileXp(OP.Save.load(), tower.key), 0, 'banked part of the purchase is saved')
    t.eq(tower.runXp, 150, 'only the remaining fifty XP is drawn from the live tower')
    t.eq(OP.Save.loadRun().snapshot.towers[0].runXp, 150, 'spent live XP is immediately checkpointed')
    app.state.sim = null
    app.state.profile = OP.Save.load()
    const resumed = app.resumeGame()
    t.eq(OP.TowerXp.available(resumed, tower.key), 150, 'reload cannot refund the purchased XP')
    t.eq(OP.TowerXp.pathUnlocked(resumed, tower.key, 0), 1, 'reload retains the purchased upgrade cell')
    ctx.localStorage.setItem(OP.Save.RUN_KEY, '{broken')
    t.eq(OP.Save.loadRun(), null, 'recovery cannot restore a pre-purchase XP balance')
  }

  t.section('a refused live purchase retains the previous profile/run pair')
  for (const failedKey of ['overpop.import-journal', 'overpop.profile', 'overpop.run']) {
    const { OP, app, ctx } = fixture()
    app.state.profile.towerXp['acorn-fox'] = 100
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    tower.runXp = 200
    OP.Save.save(app.state.profile)
    app.saveRun()
    const setItem = ctx.localStorage.setItem
    ctx.localStorage.setItem = (key, value) => {
      if (key === failedKey) throw new Error('Storage denied')
      return setItem.call(ctx.localStorage, key, value)
    }
    try {
      OP.TowerMenu.activate(app, unlockWidget(OP, app))
      t.eq(OP.TowerXp.profileXp(app.state.profile, tower.key), 100, failedKey + ': live profile was not charged')
      t.eq(tower.runXp, 200, failedKey + ': live tower was not charged')
      t.eq(OP.TowerXp.pathUnlocked(sim, tower.key, 0), 0, failedKey + ': live unlock was not granted')
      t.eq(OP.TowerXp.profileXp(OP.Save.load(), tower.key), 100, failedKey + ': stored bank is retained')
      t.eq(OP.Save.loadRun().snapshot.towers[0].runXp, 200, failedKey + ': stored run is retained')
    } finally { ctx.localStorage.setItem = setItem }
    OP.TowerMenu.activate(app, unlockWidget(OP, app))
    t.eq(OP.Save.loadRun().snapshot.towers[0].runXp, 150, failedKey + ': retry applies exactly one purchase')
  }

  t.section('invalid and repeated engine requests cannot drain the wallet')
  {
    const { OP, app } = fixture()
    const profile = app.state.profile
    profile.towerXp['acorn-fox'] = 1000
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    t.ok(OP.TowerXp.unlockCell(profile, sim, 'acorn-fox', 0, 1).ok, 'live run can spend its banked XP')
    t.eq(profile.towerXp['acorn-fox'], 850, 'profile pays the same banked debit as the live run')
    t.eq(sim.towerXp['acorn-fox'], 850, 'run and profile wallets remain synchronized')
    t.notOk(OP.TowerXp.unlockCell(profile, sim, 'acorn-fox', 0, 1).ok, 'repeated engine request is rejected')
    t.notOk(OP.TowerXp.unlockCell(profile, sim, 'constructor', 0, 1).ok, 'inherited registry keys are not towers')
    t.eq(profile.towerXp['acorn-fox'], 850, 'rejected requests do not change XP')
  }
}

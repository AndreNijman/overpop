import { loadGame } from '../loadgame.mjs'

export const name = 'upgrade-journey'
export const needs = ['js/main.js', 'js/core/upgrades.js', 'js/core/towerxp.js', 'js/ui/tower-panel.js', 'js/ui/bestiary.js']

function fixture () {
  const { OP } = loadGame()
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return { OP, app }
}

function unlock (t, OP, app, path, tier) {
  OP.TowerMenu.activate(app, { action: 'bestiary-tower', arg: 'acorn-fox' })
  const w = OP.TowerMenu.build(app).widgets.find(w =>
    w.action === 'bestiary-unlock' && w.arg === ['acorn-fox', path, tier].join('|'))
  t.ok(w, 'menu offers branch ' + path + ' tier ' + tier)
  OP.TowerMenu.activate(app, w)
  t.eq(OP.TowerXp.pathUnlocked(app.state.profile, 'acorn-fox', path), tier, 'menu unlocks the requested cell')
}

function button (OP, app, path) {
  return OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-upgrade' && w.arg === path)
}

function buy (t, OP, app, tower, path) {
  const sim = app.state.sim
  const w = button(OP, app, path)
  const tier = tower.tiers[path]
  const cash = sim.cash
  const invested = tower.invested
  t.ok(w && !w.disabled, 'legal branch purchase is enabled')
  OP.TowerPanel.activate(app, w)
  t.eq(tower.tiers[path], tier + 1, 'panel installs exactly one tier')
  t.eq(sim.cash, cash - w.cost, 'panel price matches the actual debit')
  t.eq(tower.invested, invested + w.cost, 'purchase is recorded in the tower investment')
  t.ok(OP.Upgrades.isLegalState(tower.tiers), 'purchased configuration is legal')
}

function walletAndTower (sim, tower) {
  return JSON.stringify({
    cash: sim.cash, cashSpent: sim.stats.cashSpent, invested: tower.invested,
    tiers: tower.tiers, stats: tower.s, events: sim.events.length
  })
}

function refuse (t, OP, app, tower, w, reason) {
  const before = walletAndTower(app.state.sim, tower)
  t.ok(w.disabled && w.locked, 'crosspath refusal is shown as a rule lock')
  t.ok(w.reason.includes(reason), 'panel explains the crosspath rule')
  OP.TowerPanel.activate(app, w)
  t.eq(walletAndTower(app.state.sim, tower), before, 'refused purchase changes no cash, investment, tiers, stats, or sim events')
}

export function run (t) {
  t.section('fresh player earns three XP unlocks but can only crosspath two branches')
  {
    const { OP, app } = fixture()
    // Earn actual tower XP from three ordinary starter-only runs. No free
    // placements, bonus cash, rule overrides, or bypassed progression gates.
    for (let game = 0; game < 3; game++) {
      const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
      OP.Towers.place(sim, 'acorn-fox', 200, 200)
      for (let round = 0; round < 40 && !sim.over; round++) {
        OP.Sim.startRound(sim)
        OP.Sim.runRound(sim, 60 * 600)
      }
      t.ok(sim.over, 'starter run reaches its result')
      app.updateGame(0)
      app.quitToMenu()
    }
    t.gte(OP.TowerXp.profileXp(app.state.profile, 'acorn-fox'), 450, 'normal play banks XP for three first-tier cells')
    for (let path = 0; path < 3; path++) unlock(t, OP, app, path, 1)
    app.state.profile = OP.Save.load()
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    app.state.io.selectedId = tower.id
    const staleThird = button(OP, app, 2)
    t.notOk(staleThird.disabled, 'third branch is initially available')
    const pierce = tower.s.pierce
    buy(t, OP, app, tower, 0)
    t.eq(tower.s.pierce, pierce + 1, 'purchased pierce upgrade really changes combat stats')
    const cooldown = tower.s.cooldown
    buy(t, OP, app, tower, 1)
    t.lt(tower.s.cooldown, cooldown, 'purchased speed upgrade really changes combat stats')
    t.deep(Array.from(tower.tiers), [1, 1, 0], 'two paid branches are installed')
    refuse(t, OP, app, tower, button(OP, app, 2), 'two branches')
    const before = walletAndTower(sim, tower)
    OP.TowerPanel.activate(app, staleThird)
    t.eq(walletAndTower(sim, tower), before, 'stale formerly-enabled button cannot bypass the new crosspath lock')
    t.ok(app.saveRun(), 'two-branch configuration saves')
    app.state.sim = null
    app.state.profile = OP.Save.load()
    const resumed = app.resumeGame()
    const restored = resumed.towers[0]
    app.state.io.selectedId = restored.id
    t.deep(Array.from(restored.tiers), [1, 1, 0], 'resume retains the purchased branches')
    refuse(t, OP, app, restored, button(OP, app, 2), 'two branches')
  }

  t.section('malformed purchases never charge or mutate a live tower')
  {
    const { OP, app } = fixture()
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    for (const path of [NaN, Infinity, 0.5, undefined, null, '0', -1, 3]) {
      const before = walletAndTower(sim, tower)
      const res = OP.Upgrades.buy(sim, tower, path)
      t.notOk(res.ok, 'malformed branch purchase is refused: ' + String(path))
      t.eq(walletAndTower(sim, tower), before, 'malformed request changes no purchase state')
    }
    for (const tiers of [[NaN, 0, 0], [1, 1, 1], [3, 3, 0], [6, 0, 0]]) {
      tower.tiers = tiers
      const before = walletAndTower(sim, tower)
      t.notOk(OP.Upgrades.buy(sim, tower, 0).ok, 'invalid saved configuration cannot receive more upgrades')
      t.eq(walletAndTower(sim, tower), before, 'invalid configuration refusal changes no purchase state')
    }
  }

  t.section('all six late-game 5-2-0 permutations buy legally and survive resume')
  for (let main = 0; main < 3; main++) {
    for (let side = 0; side < 3; side++) {
      if (main === side) continue
      const { OP, app } = fixture()
      // Funded late-game account fixture, not an unrestricted raw Sim. Each
      // upgrade still has to pass a paid, saved per-cell XP unlock first.
      app.state.profile.towerXp['acorn-fox'] = 75000
      for (let path = 0; path < 3; path++) {
        for (let tier = 1; tier <= 5; tier++) unlock(t, OP, app, path, tier)
      }
      t.eq(OP.TowerXp.profileXp(OP.Save.load(), 'acorn-fox'), 0, 'all fifteen XP cells were paid for')
      const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
      OP.Economy.earn(sim, 100000, -1) // isolate late-tier purchase rules from balance
      const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
      app.state.io.selectedId = tower.id
      const third = 3 - main - side
      const staleThird = button(OP, app, third)
      buy(t, OP, app, tower, main)
      buy(t, OP, app, tower, main)
      buy(t, OP, app, tower, side)
      buy(t, OP, app, tower, side)
      const staleSide = button(OP, app, side)
      t.notOk(staleSide.disabled, 'either branch can still become the primary path at 2-2-0')
      buy(t, OP, app, tower, main)
      refuse(t, OP, app, tower, button(OP, app, side), 'past tier 2')
      const before = walletAndTower(sim, tower)
      OP.TowerPanel.activate(app, staleSide)
      OP.TowerPanel.activate(app, staleThird)
      t.eq(walletAndTower(sim, tower), before, 'stale buttons cannot create a second tier-three or third branch')
      buy(t, OP, app, tower, main)
      buy(t, OP, app, tower, main)
      const expected = [0, 0, 0]
      expected[main] = 5
      expected[side] = 2
      t.deep(Array.from(tower.tiers), expected, 'correct 5-2-0 permutation is installed')
      refuse(t, OP, app, tower, button(OP, app, main), 'fully upgraded')
      refuse(t, OP, app, tower, button(OP, app, third), 'two branches')
      const saved = walletAndTower(sim, tower)
      const combatStats = JSON.stringify(tower.s)
      t.ok(app.saveRun(), 'late-game crosspath saves')
      app.state.sim = null
      app.state.profile = OP.Save.load()
      const resumed = app.resumeGame()
      const restored = resumed.towers[0]
      app.state.io.selectedId = restored.id
      t.deep(Array.from(restored.tiers), expected, 'resume retains the entire crosspath')
      t.eq(resumed.cash, JSON.parse(saved).cash, 'resume retains the cash balance')
      t.eq(JSON.stringify(restored.s), combatStats, 'resume rebuilds the same combat stats')
      for (let path = 0; path < 3; path++) {
        const reason = path === main ? 'fully upgraded' : path === side ? 'past tier 2' : 'two branches'
        refuse(t, OP, app, restored, button(OP, app, path), reason)
      }
    }
  }
}

import { loadGame } from '../loadgame.mjs'

export const name = 'economy-journey'
export const needs = ['js/main.js', 'js/core/towers.js', 'js/core/heroes.js', 'js/towers/support.js', 'js/ui/tower-panel.js']

function fixture () {
  const env = loadGame()
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  return { ...env, app }
}

function tap (OP, app, x, y) {
  OP.Input.setPoint(app.state.io, x, y)
  OP.Input.tap(app.state.io, x, y)
}

function select (OP, app, tower) {
  if (app.state.io.selectedId === tower.id) return
  const p = OP.Camera.boardToField(tower.x, tower.y)
  tap(OP, app, p.x, p.y)
}

function widget (OP, app, action) {
  return OP.TowerPanel.build(app).widgets.find(w => w.action === action)
}

function press (OP, app, w) {
  if (!w) throw new Error('Expected a visible panel control')
  tap(OP, app, w.x + w.w / 2, w.y + w.h / 2)
}

function unlock (t, OP, app, key, path, tier) {
  // Fund a progressed-account fixture, but pay for every permanent cell through
  // the real menu rather than bypassing the XP gate on the simulation.
  app.state.profile.towerXp[key] = OP.TowerXp.tierRequired(tier)
  OP.TowerMenu.activate(app, { action: 'bestiary-tower', arg: key })
  for (let n = 1; n <= tier; n++) {
    const w = OP.TowerMenu.build(app).widgets.find(w =>
      w.action === 'bestiary-unlock' && w.arg === [key, path, n].join('|'))
    OP.TowerMenu.activate(app, w)
    t.eq(OP.TowerXp.pathUnlocked(app.state.profile, key, path), n, 'account pays for upgrade cell ' + n)
  }
}

function bankFixture (t) {
  const env = fixture()
  const { OP, app } = env
  unlock(t, OP, app, 'berry-warren', 1, 4)
  const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
  OP.Economy.earn(sim, 10000, -1) // funded late-upgrade fixture, normal match rules
  const tower = OP.Towers.place(sim, 'berry-warren', 200, 200)
  select(OP, app, tower)
  for (let n = 1; n <= 4; n++) {
    const w = OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-upgrade' && w.arg === 1)
    press(OP, app, w)
    t.eq(tower.tiers[1], n, 'cash purchase installs bank tier ' + n)
  }
  return { ...env, sim, tower }
}

function savedState (OP, sim) { return JSON.stringify(OP.Sim.serialize(sim)) }

export function run (t) {
  t.section('keyboard selling honors confirmation and ignores held-key repeats')
  {
    const { OP, app } = fixture()
    app.state.profile.settings.confirmSell = true
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    const tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    select(OP, app, tower)
    const cash = sim.cash
    const value = OP.Economy.sellValue(sim, tower)
    app.state.io._handlers.key('Delete', { repeat: false })
    t.ok(sim.towerById.has(tower.id), 'first Delete press does not sell a protected tower')
    t.eq(sim.cash, cash, 'arming confirmation pays no money')
    t.eq(widget(OP, app, 'panel-sell').label, 'CONFIRM', 'keyboard confirmation is visible on the panel')
    app.state.io._handlers.key('Delete', { repeat: true })
    t.ok(sim.towerById.has(tower.id), 'holding Delete cannot automatically confirm the sale')
    app.state.io._handlers.key('Escape')
    t.eq(OP.TowerPanel.state.confirmSell, -1, 'Escape clears the armed sale')
    select(OP, app, tower)
    app.state.io._handlers.key('Delete')
    t.ok(sim.towerById.has(tower.id), 'reselecting requires a fresh confirmation')
    app.state.io._handlers.key('Backspace', { repeat: false })
    t.notOk(sim.towerById.has(tower.id), 'a second intentional sell key confirms')
    t.eq(sim.cash, cash + value, 'sale pays the advertised amount exactly once')
    t.eq(app.state.io.selectedId, -1, 'completed keyboard sale clears selection')
  }

  t.section('confirmations do not survive pause, selection changes, or a new run')
  {
    const { OP, app } = fixture()
    app.state.profile.settings.confirmSell = true
    let sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    let tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    select(OP, app, tower)
    press(OP, app, widget(OP, app, 'panel-sell'))
    tap(OP, app, 600, 400)
    t.eq(OP.TowerPanel.state.confirmSell, -1, 'deselecting clears confirmation')
    select(OP, app, tower)
    app.state.io._handlers.key('Delete')
    app.togglePauseMenu()
    t.eq(OP.TowerPanel.state.confirmSell, -1, 'pause closes pending destructive actions')
    OP.HUD.activate(app, { action: 'pause-resume' })
    select(OP, app, tower)
    app.state.io._handlers.key('Delete')
    sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    t.eq(OP.TowerPanel.state.confirmSell, -1, 'new run clears confirmation before entity ids can be reused')
    tower = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    select(OP, app, tower)
    app.state.io._handlers.key('Delete')
    t.ok(sim.towerById.has(tower.id), 'new tower cannot inherit the prior run confirmation')
    app.state.profile.settings.confirmSell = false
    app.state.io._handlers.key('Delete')
    t.notOk(sim.towerById.has(tower.id), 'disabling confirmation permits a one-press sale')
  }

  t.section('bank harvests, Collect, cooldown, and round-end interest survive resume')
  {
    const { OP, app, sim, tower } = bankFixture(t)
    const beforeHarvest = sim.cash
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 121)
    t.gt(tower.data.bank, 0, 'a real active round produces banked harvests')
    t.eq(sim.cash, beforeHarvest, 'banked harvests do not also pay cash')
    const panel = OP.TowerPanel.build(app)
    t.ok(panel.marks.some(m => m.text === 'BANK'), 'selected farm labels its bank balance')
    t.ok(panel.marks.some(m => m.text === OP.M.money(tower.data.bank)), 'bank balance is visible before collection')
    t.ok(panel.marks.some(m => m.text === OP.M.money(tower.s.bankCap)), 'bank capacity is visible')
    t.ok(panel.marks.some(m => m.text === '25% / rd'), 'round interest is explained')
    const ability = widget(OP, app, 'panel-ability')
    const bank = tower.data.bank
    press(OP, app, ability)
    t.eq(sim.cash, beforeHarvest + bank, 'Collect moves exactly the displayed balance into cash')
    t.eq(tower.data.bank, 0, 'Collect empties the bank')
    t.eq(tower.abilityCd, 20, 'Collect starts its declared cooldown')
    const busy = widget(OP, app, 'panel-ability')
    t.ok(busy.disabled && busy.reason.includes('cooldown'), 'panel explains why Collect cannot repeat')
    const used = savedState(OP, sim)
    OP.TowerPanel.activate(app, ability)
    t.eq(savedState(OP, sim), used, 'stale ready ability button cannot collect twice or reset cooldown')
    app.togglePauseMenu()
    app.updateGame(10)
    t.eq(tower.abilityCd, 20, 'time spent in the pause menu does not recharge abilities')
    t.ok(app.saveRun(), 'bank harvest clock and cooldown save while paused')
    app.state.sim = null
    let resumed = app.resumeGame()
    let restored = resumed.towers[0]
    t.eq(restored.abilityCd, 20, 'resume retains the cooldown rather than resetting it')
    t.eq(restored.data.h, tower.data.h, 'resume retains the partial harvest interval')
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(resumed, 60)
    t.close(restored.abilityCd, 19, 1e-6, 'cooldown advances by simulation time after Resume')
    const result = OP.Sim.runRound(resumed, 60 * 600)
    t.ok(result.completed && !resumed.over, 'ordinary round completes without ending the match')
    t.eq(restored.data.rounds, 1, 'round-end interest is settled before the completion checkpoint')
    const interest = restored.data.bank
    app.saveRun()
    resumed = app.resumeGame()
    restored = resumed.towers[0]
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(resumed, 1)
    t.eq(restored.data.bank, interest, 'settled interest survives resume without another payout')
    t.eq(restored.data.rounds, 1, 'round payout ledger records settlement')
    app.saveRun()
    resumed = app.resumeGame()
    restored = resumed.towers[0]
    OP.HUD.activate(app, { action: 'pause-resume' })
    OP.Sim.run(resumed, 1)
    t.eq(restored.data.bank, interest, 'another reload does not compound the same round interest again')
    select(OP, app, restored)
    t.notOk(widget(OP, app, 'panel-ability').disabled, 'ability becomes ready again after its cooldown')
    const cash = resumed.cash
    press(OP, app, widget(OP, app, 'panel-ability'))
    t.eq(resumed.cash, cash + interest, 'ready Collect pays the restored savings exactly once')
  }

  t.section('sold tower references cannot create duplicate refunds or stale payouts')
  {
    const { OP, app, sim, tower } = bankFixture(t)
    OP.Sim.startRound(sim)
    OP.Sim.run(sim, 121)
    const value = OP.Economy.sellValue(sim, tower)
    t.eq(OP.Towers.sell(sim, tower), value, 'live tower sells for its current investment value')
    const sold = savedState(OP, sim)
    t.eq(OP.Towers.sell(sim, tower), 0, 'repeated sale of the same reference is refused')
    t.notOk(OP.Towers.canActivate(sim, tower).ok, 'sold bank has no usable ability')
    t.notOk(OP.Towers.activate(sim, tower).ok, 'sold bank cannot cash out leftover savings')
    t.eq(savedState(OP, sim), sold, 'rejected stale actions change no cash, towers, cooldowns, or events')
    app.state.io.selectedId = -1
  }

  t.section('real support aura restores once and disappears when its source is sold')
  {
    const { OP, app } = fixture()
    app.state.profile.playerXp = 8000 // Warren Hall's normal level-nine unlock
    unlock(t, OP, app, 'warren-hall', 1, 3)
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    OP.Economy.earn(sim, 20000, -1)
    const fox = OP.Towers.place(sim, 'acorn-fox', 200, 200)
    const base = { range: fox.s.range, pierce: fox.s.pierce, damage: fox.s.damage }
    const at = sim.map.paths[0].nearest(fox.x, fox.y).t
    const veiled = OP.Balloons.spawn(sim, { tier: 'red', path: 0, t: at, props: OP.PROP.VEILED })
    OP.Grid.rebuild(sim.grid, sim.balloons)
    t.eq(OP.Targeting.acquire(sim, fox, 'first'), -1, 'unbuffed starter cannot see the veiled enemy')
    const hall = OP.Towers.place(sim, 'warren-hall', 260, 200)
    t.ok(hall, 'paid support tower fits beside the starter')
    t.eq(fox.s.range, base.range + 12, 'placing the hall immediately extends the starter range')
    t.eq(fox.s.pierce, base.pierce + 1, 'placing the hall immediately adds pierce')
    select(OP, app, hall)
    for (let n = 0; n < 3; n++) {
      press(OP, app, OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-upgrade' && w.arg === 1))
    }
    t.ok(fox.s.camoDetect, 'paid support upgrade grants veiled detection')
    t.eq(OP.Targeting.acquire(sim, fox, 'first'), veiled.id, 'the actual targeting gate now admits the veiled enemy')
    select(OP, app, fox)
    t.ok(OP.TowerPanel.build(app).marks.some(m => m.text && m.text.includes('Warren Hall')), 'selected starter names its real support source')
    const damage = fox.s.damage
    app.saveRun()
    const resumed = app.resumeGame()
    const restoredFox = resumed.towerById.get(fox.id)
    const restoredHall = resumed.towerById.get(hall.id)
    t.eq(restoredFox.s.damage, damage, 'resume does not apply aura damage twice')
    t.eq(restoredFox.s.range, base.range + 12, 'resume does not stack aura range')
    t.ok(restoredFox.s.camoDetect, 'support detection survives reload')
    OP.HUD.activate(app, { action: 'pause-resume' })
    select(OP, app, restoredHall)
    app.state.profile.settings.confirmSell = true
    press(OP, app, widget(OP, app, 'panel-sell'))
    t.ok(restoredFox.s.camoDetect, 'arming sale leaves the aura intact')
    press(OP, app, widget(OP, app, 'panel-sell'))
    t.eq(restoredFox.s.damage, base.damage, 'selling the support source removes its damage buff immediately')
    t.eq(restoredFox.s.range, base.range, 'selling the source restores original range')
    t.eq(restoredFox.s.pierce, base.pierce, 'selling the source restores original pierce')
    t.notOk(restoredFox.s.camoDetect, 'selling the source removes granted detection')
    t.eq(OP.Targeting.acquire(resumed, restoredFox, 'first'), -1, 'veiled enemy becomes untargetable again')
  }

  t.section('selling a hero frees its slot immediately and disables both old abilities')
  {
    const { OP, app } = fixture()
    const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
    OP.Economy.earn(sim, 10000, -1)
    const hero = OP.Heroes.place(sim, OP.HERO_ORDER[0], 200, 200)
    OP.Heroes.grantXP(sim, OP.Heroes.xpForLevel(20))
    t.ok(hero.s.ability && hero.s.ability2, 'levelled hero has two ready ability slots')
    t.gt(OP.Towers.sell(sim, hero), 0, 'hero sells normally')
    t.eq(sim.heroId, -1, 'selling immediately clears the one-hero slot')
    const before = savedState(OP, sim)
    t.notOk(OP.Towers.activate(sim, hero).ok, 'sold hero cannot activate its first ability')
    t.notOk(OP.Heroes.activateSecond(sim, hero).ok, 'sold hero cannot activate its second ability')
    t.eq(savedState(OP, sim), before, 'stale hero abilities produce no simulation side effects')
    t.ok(OP.Heroes.place(sim, OP.HERO_ORDER[0], 200, 200), 'replacement hero can be bought without advancing a tick')
  }
}

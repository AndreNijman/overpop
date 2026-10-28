import { loadGame } from '../loadgame.mjs'

export const name = 'targeting-journey'
export const needs = ['js/main.js', 'js/ui/input.js', 'js/ui/tower-panel.js', 'js/towers/military.js', 'js/render/renderer.js']

function fixture (manual = false) {
  const env = loadGame()
  const { OP } = env
  const app = OP.App // Retain the real boot-installed input, HUD and key handlers.
  app.state.profile = OP.Save.defaults()
  if (manual) app.state.profile.playerXp = 18000 // normal level-19 Howitzer unlock
  const sim = app.startGame(OP.MAP_ORDER[0], 'easy', 'standard')
  const tower = OP.Towers.place(sim, manual ? 'howitzer-mole' : 'acorn-fox', 200, 200)
  const field = OP.Camera.boardToField(tower.x, tower.y)
  tap(OP, app, field.x, field.y)
  return { ...env, app, sim, tower }
}

function tap (OP, app, x, y) {
  OP.Input.setPoint(app.state.io, x, y)
  return OP.Input.tap(app.state.io, x, y)
}

function press (OP, app, w) {
  if (!w) throw new Error('Expected a visible widget')
  return tap(OP, app, w.x + w.w / 2, w.y + w.h / 2)
}

function aimButton (OP, app) {
  return OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-aim')
}

function aim (tower) { return [tower.data.aimX, tower.data.aimY] }

export function run (t) {
  t.section('fresh starter chooses all four targeting priorities through real taps')
  {
    const { OP, app, sim, tower } = fixture()
    t.eq(app.state.io.selectedId, tower.id, 'battlefield tap selects the starter')
    t.notOk(aimButton(OP, app), 'ordinary towers do not advertise fixed-point aiming')
    const path = sim.map.paths[0]
    const at = path.nearest(tower.x, tower.y).t
    const behind = OP.Balloons.spawn(sim, { tier: 'ceramic', path: 0, t: at - 25 })
    const near = OP.Balloons.spawn(sim, { tier: 'red', path: 0, t: at })
    const ahead = OP.Balloons.spawn(sim, { tier: 'red', path: 0, t: at + 25 })
    OP.Grid.rebuild(sim.grid, sim.balloons)
    const expected = { first: ahead.id, last: behind.id, close: near.id, strong: behind.id }
    for (const mode of ['first', 'last', 'close', 'strong']) {
      const w = OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-target' && w.arg === mode)
      press(OP, app, w)
      t.eq(tower.targetMode, mode, mode + ': panel tap changes the live priority')
      t.eq(tower.targetId, -1, mode + ': changing priority drops the previous target')
      t.eq(app.state.io.selectedId, tower.id, mode + ': panel tap keeps the selection')
      OP.Towers.step(sim)
      t.eq(tower.targetId, expected[mode], mode + ': firing pass acquires the correct balloon')
      t.ok(OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-target' && w.arg === mode).selected,
        mode + ': panel highlights the active priority')
    }
    const field = OP.Camera.boardToField(tower.x, tower.y)
    OP.Input.context(app.state.io, field.x, field.y)
    t.eq(tower.targetMode, 'first', 'right-click/long-press cycles to the next priority')
    t.ok(app.saveRun(), 'chosen priority saves')
    app.state.sim = null
    const resumed = app.resumeGame()
    t.eq(resumed.towers[0].targetMode, 'first', 'resume retains the chosen priority')
  }

  t.section('Set Aim previews and confirms the same range-limited board point')
  {
    const { OP, app, sim, tower, canvas } = fixture(true)
    const w = aimButton(OP, app)
    t.ok(w, 'Howitzer exposes an accessible Set Aim control')
    t.notOk(OP.TowerPanel.build(app).widgets.some(w => w.action === 'panel-target'), 'fixed-point gun does not show misleading priority controls')
    const original = aim(tower)
    press(OP, app, w)
    t.eq(app.state.io.mode, 'aiming', 'real panel tap enters aiming mode')
    t.eq(app.state.io.aimingTowerId, tower.id, 'aim gesture belongs to the selected gun')
    const field = OP.Camera.boardToField(1000, 600)
    OP.Input.setPoint(app.state.io, field.x, field.y)
    const before = JSON.stringify(OP.Sim.serialize(sim))
    const preview = OP.Input.aimingPreview(app.state.io, sim)
    t.ok(preview, 'aim mode provides a board-space preview')
    t.lte(OP.M.dist(tower.x, tower.y, preview.x, preview.y), tower.s.range + 1e-6, 'preview respects the gun range')
    t.deep(aim(tower), original, 'moving the preview does not change the saved aim')
    const context = canvas.getContext('2d')
    const arc = context.arc
    const arcs = []
    context.arc = (...args) => { arcs.push(args); return arc.apply(context, args) }
    try {
      OP.Render.frame(sim, context, app.state.view, { app, selected: tower, aiming: preview })
    } finally { context.arc = arc }
    t.ok(arcs.some(a => a[0] === preview.x && a[1] === preview.y && a[2] === 10), 'renderer draws the preview crosshair at the projected board point')
    t.ok(arcs.some(a => a[0] === preview.x && a[1] === preview.y && a[2] === tower.s.blastRadius), 'preview shows shell blast coverage')
    t.eq(JSON.stringify(OP.Sim.serialize(sim)), before, 'preview and rendering change no simulation state or RNG')
    tap(OP, app, field.x, field.y)
    t.close(tower.data.aimX, preview.x, 1e-6, 'confirmed X matches the preview, not field coordinates')
    t.close(tower.data.aimY, preview.y, 1e-6, 'confirmed Y matches the preview')
    t.eq(app.state.io.mode, 'idle', 'confirmation finishes the gesture')
    t.eq(app.state.io.selectedId, tower.id, 'confirmation keeps the gun selected')
    t.eq(OP.Input.aimingPreview(app.state.io, sim), null, 'transient preview disappears after confirmation')

    // A visible enemy triggers firing, but the projectile must travel toward
    // the player's chosen ground point rather than toward that enemy.
    const at = sim.map.paths[0].nearest(tower.x, tower.y).t
    OP.Balloons.spawn(sim, { tier: 'ceramic', path: 0, t: at })
    OP.Grid.rebuild(sim.grid, sim.balloons)
    OP.Towers.step(sim)
    const shell = sim.projectiles.find(p => p.alive && p.ownerId === tower.id)
    t.ok(shell, 'manually aimed gun fires a real shell')
    t.close(Math.atan2(shell.vy, shell.vx), OP.M.angleTo(tower.x, tower.y, preview.x, preview.y), 1e-6,
      'shell travels toward the chosen aim point')
    t.ok(app.saveRun(), 'aim and shell can be saved mid-flight')
    app.state.sim = null
    const resumed = app.resumeGame()
    t.deep(aim(resumed.towers[0]), aim(tower), 'save/resume retains the exact confirmed aim')
    t.ok(resumed.projectiles.some(p => p.alive && p.ownerId === tower.id), 'resume retains the shell in flight')
    t.eq(app.state.io.mode, 'idle', 'resume does not revive an old input gesture')
  }

  t.section('HUD, Escape and cancellation never accidentally retarget the gun')
  {
    const { OP, app, sim, tower } = fixture(true)
    const original = aim(tower)
    press(OP, app, aimButton(OP, app))
    const speed = OP.HUD.build(app).widgets.find(w => w.action === 'hud-speed' && w.arg === 2)
    press(OP, app, speed)
    t.eq(sim.speed, 2, 'HUD speed button still works during aiming')
    t.deep(aim(tower), original, 'HUD button tap is not a board aim point')
    t.eq(app.state.io.mode, 'aiming', 'speed change leaves aiming available')
    press(OP, app, aimButton(OP, app))
    t.eq(app.state.io.mode, 'idle', 'Cancel Aim button exits the gesture')
    press(OP, app, aimButton(OP, app))
    app.state.io._handlers.key('Escape')
    t.eq(app.state.io.mode, 'idle', 'Escape cancels aiming before deselecting or pausing')
    t.eq(app.state.io.selectedId, tower.id, 'Escape keeps the gun selected')
    t.notOk(app.state.pauseOpen, 'cancelling aim does not open pause')
    t.deep(aim(tower), original, 'both cancellation paths preserve the previous aim')
    press(OP, app, aimButton(OP, app))
    const pause = OP.HUD.build(app).widgets.find(w => w.action === 'hud-pause')
    press(OP, app, pause)
    t.ok(app.state.pauseOpen && sim.paused, 'pause button still opens the pause menu during aiming')
    t.eq(app.state.io.mode, 'idle', 'pause cancels the outstanding gesture')
    t.deep(aim(tower), original, 'pausing cannot move the aim')
  }

  t.section('invalid coordinates and removed guns cannot corrupt aim data')
  {
    const { OP, app, sim, tower } = fixture(true)
    const original = aim(tower)
    press(OP, app, aimButton(OP, app))
    tap(OP, app, NaN, Infinity)
    t.deep(aim(tower), original, 'non-finite pointer coordinates do not reach the gun data')
    t.eq(app.state.io.mode, 'aiming', 'invalid aim remains retryable')
    t.eq(OP.Input.aimingPreview(app.state.io, sim), null, 'invalid pointer has no drawable preview')
    t.eq(OP.Military.setAimPoint(sim, tower, Infinity, 100), null, 'engine helper also rejects invalid coordinates')
    app.state.profile.settings.confirmSell = false
    press(OP, app, OP.TowerPanel.build(app).widgets.find(w => w.action === 'panel-sell'))
    t.notOk(sim.towerById.has(tower.id), 'gun can be sold through the HUD while aiming')
    t.eq(app.state.io.mode, 'idle', 'selling the aiming gun clears its gesture')
    OP.Input.beginAiming(app.state.io, tower.id)
    tap(OP, app, 450, 300)
    t.eq(app.state.io.mode, 'idle', 'a stale removed-gun intent is safely cancelled')
  }

  t.section('noncombat towers do not gain an invalid priority when cycled')
  {
    const { OP } = fixture()
    const tower = { s: { targetModes: [] }, targetMode: null, targetId: -1 }
    t.eq(OP.Towers.cycleTargetMode(null, tower, 1), null, 'empty mode list has no next priority')
    t.eq(tower.targetMode, null, 'cycling an empty list leaves priority unchanged')
  }
}

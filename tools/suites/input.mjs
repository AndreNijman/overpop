export const name = 'input'
export const needs = ['js/ui/input.js']

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

export function run (t, OP, env) {
  const I = OP.Input

  env.evalFile('js/towers/_TEMPLATE.js')
  env.evalFile('js/towers/_HERO_TEMPLATE.js')

  function sim () {
    return makeSim(OP, { tracks: [arena(OP)], cash: 1000000, lives: 200 })
  }

  /** A handler set that records what it was asked to do. */
  function spy (io) {
    const log = []
    I.setHandlers(io, {
      place: (key, x, y, isHero) => log.push(['place', key, Math.round(x), Math.round(y), !!isHero]),
      select: id => log.push(['select', id]),
      aim: (id, x, y) => log.push(['aim', id, Math.round(x), Math.round(y)]),
      context: (id, x, y) => log.push(['context', id]),
      key: k => log.push(['key', k]),
      cancel: () => log.push(['cancel'])
    })
    return log
  }

  /* ---------- state ---------- */

  t.section('a fresh input state is idle')
  let io = I.create()
  t.eq(io.mode, 'idle', 'mode is idle')
  t.eq(io.selectedId, -1, 'nothing selected')
  t.eq(io.hoverId, -1, 'nothing hovered')
  t.notOk(io.down, 'no pointer down')
  t.eq(io.placingKey, null, 'not placing anything')

  /* ---------- modes ---------- */

  t.section('placement mode')
  io = I.create()
  let log = spy(io)
  I.beginPlacing(io, 'template-critter', false)
  t.eq(io.mode, 'placing', 'mode switches to placing')
  t.eq(io.placingKey, 'template-critter', 'and remembers what')
  t.notOk(io.placingIsHero, 'and that it is not a hero')

  t.section('entering placement mode clears the selection')
  io = I.create()
  io.selectedId = 7
  I.beginPlacing(io, 'template-critter', false)
  t.eq(io.selectedId, -1, 'the previously selected tower is deselected')

  t.section('a tap while placing becomes a place intent')
  io = I.create()
  log = spy(io)
  I.beginPlacing(io, 'template-critter', false)
  t.eq(I.tap(io, 300, 400), 'place', 'the tap resolves as a placement')
  // The handler is sim-facing, so the position it receives is BOARD space. A press
  // at field (300,400) is world (400,413) because the board is fitted beside the
  // sidebar — asserting the field numbers here would be asserting the bug.
  const placeB = OP.Camera.fieldToBoard(300, 400)
  t.deep(log[0], ['place', 'template-critter', Math.round(placeB.x), Math.round(placeB.y), false],
    'with the key and the position in board space')

  t.section('placing a hero is flagged as such')
  io = I.create()
  log = spy(io)
  I.beginPlacing(io, 'template-hero', true)
  I.tap(io, 200, 200)
  t.eq(log[0][4], true, 'the hero flag reaches the handler')

  t.section('cancel leaves placement mode and fires cancel once')
  io = I.create()
  log = spy(io)
  I.beginPlacing(io, 'template-critter', false)
  I.cancel(io)
  t.eq(io.mode, 'idle', 'back to idle')
  t.eq(io.placingKey, null, 'and the key is cleared')
  t.eq(log.filter(e => e[0] === 'cancel').length, 1, 'cancel fired once')
  I.cancel(io)
  t.eq(log.filter(e => e[0] === 'cancel').length, 1, 'and cancelling from idle does not fire again')

  t.section('aim mode')
  io = I.create()
  log = spy(io)
  I.beginAiming(io, 42)
  t.eq(io.mode, 'aiming', 'mode switches to aiming')
  t.eq(I.tap(io, 500, 300), 'aim', 'a tap resolves as an aim')
  const aimB = OP.Camera.fieldToBoard(500, 300)
  t.deep(log[0], ['aim', 42, Math.round(aimB.x), Math.round(aimB.y)],
    'with the tower id and the point in BOARD space')

  /* ---------- selection ---------- */

  t.section('selection uses the tower lookup the shell installs')
  io = I.create()
  log = spy(io)
  /* The lookup is a SIM-facing callback, so it is handed board coordinates. The
     band below is expressed in board space and the taps in field space, which is
     the whole point of the conversion: a press at field 450 is not world 450. */
  I.setTowerLookup(io, (x, y) => (x > 550 && x < 650 ? 99 : -1))
  const selField = OP.Camera.boardToField(600, 300)
  t.eq(I.tap(io, selField.x, selField.y), 'select', 'a tap on a tower selects it')
  t.eq(io.selectedId, 99, 'and records which')
  t.deep(log[log.length - 1], ['select', 99], 'and tells the shell')

  t.section('tapping the same tower again deselects it')
  t.eq(I.tap(io, selField.x, selField.y), 'deselect', 'the second tap deselects')
  t.eq(io.selectedId, -1, 'nothing is selected')
  t.deep(log[log.length - 1], ['select', -1], 'and the shell is told with -1')

  t.section('tapping empty ground deselects')
  I.tap(io, selField.x, selField.y)
  t.eq(io.selectedId, 99, 'select again')
  t.eq(I.tap(io, 100, 100), 'deselect', 'a tap on nothing deselects')
  t.eq(io.selectedId, -1, 'and clears the selection')

  t.section('with no lookup installed, a tap deselects rather than crashing')
  io = I.create()
  log = spy(io)
  t.noThrow(() => I.tap(io, 300, 300), 'no crash')
  t.eq(io.selectedId, -1, 'and nothing is selected')

  /* ---------- hover ---------- */

  t.section('hover only tracks while idle and over the canvas')
  io = I.create()
  I.setTowerLookup(io, () => 5)
  io.overCanvas = true
  OP.Input.setPoint(io, 300, 300)
  t.eq(I.updateHover(io), 5, 'hovering finds a tower')
  io.overCanvas = false
  t.eq(I.updateHover(io), -1, 'leaving the canvas clears it')
  io.overCanvas = true
  I.beginPlacing(io, 'template-critter', false)
  t.eq(I.updateHover(io), -1, 'and placement mode suppresses hover, so the preview owns the cursor')

  /* ---------- placement preview ---------- */

  t.section('the placement preview asks the REAL placement rules')
  // The preview must never disagree with what a tap is actually allowed to do.
  const s = sim()
  io = I.create()
  t.eq(I.placementPreview(io, s), null, 'no preview when not placing')

  I.beginPlacing(io, 'template-critter', false)
  const p = s.map.paths[0].posAt(300)

  OP.Input.setPoint(io, OP.M.clamp(p.x, 60, 1220), OP.M.clamp(p.y - 70, 60, 660))
  let pv = I.placementPreview(io, s)
  t.ok(pv, 'a preview exists while placing')
  t.eq(pv.key, 'template-critter', 'naming what is being placed')
  t.eq(pv.footprint, OP.TOWERS['template-critter'].footprint, 'with the real footprint')
  t.eq(pv.range, OP.TOWERS['template-critter'].base.range, 'and the real base range')

  OP.Input.setPoint(io, 5, 5)
  pv = I.placementPreview(io, s)
  t.notOk(pv.ok, 'a spot hanging off the map previews as illegal')
  t.ok(pv.reason.length > 0, 'with a reason to show the player')

  t.section('the preview and the real check always agree')
  let disagreements = 0
  for (let i = 0; i < 120; i++) {
    OP.Input.setPoint(io, 20 + (i * 97) % (OP.FIELD_W - 40), 20 + (i * 53) % (OP.FIELD_H - 40))
    const preview = I.placementPreview(io, s)
    // Against BOARD coordinates: those are the ones the tap will actually use, so
    // this is the comparison that proves the preview cannot lie.
    const real = OP.Towers.canPlace(s, 'template-critter', io.bx, io.by)
    if (preview.ok !== real.ok) disagreements++
  }
  t.eq(disagreements, 0, 'over 120 positions the preview never disagreed with canPlace')

  t.section('a hero preview uses the hero rules')
  const hs = sim()
  io = I.create()
  I.beginPlacing(io, 'template-hero', true)
  OP.Input.setPoint(io, 300, 620)
  const heroPv = I.placementPreview(io, hs)
  t.ok(heroPv, 'a hero preview exists')
  OP.Heroes.place(hs, 'template-hero', 300, 620, { free: true })
  const second = I.placementPreview(io, hs)
  t.notOk(second.ok, 'once a hero is placed the preview goes illegal')
  t.ok(/already have a hero/i.test(second.reason), 'with the one-hero-per-map reason')

  t.section('an unknown key previews as nothing rather than throwing')
  io = I.create()
  I.beginPlacing(io, 'no-such-tower', false)
  t.eq(I.placementPreview(io, s), null, 'null, not an exception')

  /* ---------- handlers ---------- */

  t.section('a throwing handler does not take the input system down')
  io = I.create()
  I.setHandlers(io, { select: () => { throw new Error('handler blew up') } })
  I.setTowerLookup(io, () => 3)
  t.noThrow(() => I.tap(io, 100, 100), 'the tap still completes')
  t.eq(io.selectedId, 3, 'and the state was still updated')

  t.section('missing handlers are simply not called')
  io = I.create()
  I.setHandlers(io, {})
  I.setTowerLookup(io, () => 1)
  t.noThrow(() => I.tap(io, 100, 100), 'no handler for select is fine')
  I.beginPlacing(io, 'template-critter', false)
  t.noThrow(() => I.tap(io, 100, 100), 'no handler for place is fine')

  /* ---------- attach / detach ---------- */

  t.section('attach and detach are symmetric')
  const canvas = env.ctx.document.createElement('canvas')
  const view = OP.Camera.create()
  OP.Camera.resize(view, canvas, 1280, 720, 1)
  io = I.create()
  t.noThrow(() => I.attach(io, canvas, view), 'attach works against the stub canvas')
  t.ok(io._bound, 'listeners were recorded so they can be removed exactly')
  t.noThrow(() => I.detach(io), 'detach works')
  t.eq(io._bound, null, 'and clears the record')
  t.noThrow(() => I.detach(io), 'detaching twice is safe')

  t.section('attaching twice does not double-bind')
  io = I.create()
  I.attach(io, canvas, view)
  const firstBound = io._bound
  I.attach(io, canvas, view)
  t.notOk(io._bound === firstBound, 'the second attach replaced the first rather than stacking')
  I.detach(io)

  t.section('attach tolerates a missing canvas')
  io = I.create()
  t.noThrow(() => I.attach(io, null, view), 'no canvas is survivable')
  t.eq(io._bound, null, 'and nothing was bound')

  /* ---------- keyboard ---------- */

  t.section('key state tracking')
  io = I.create()
  io.keys.Shift = true
  t.ok(I.isDown(io, 'Shift'), 'a held key reads as down')
  t.notOk(I.isDown(io, 'Control'), 'an unheld one does not')

  /* ---------- isolation ---------- */

  t.section('input never touches the simulation')
  const a = sim()
  const b = sim()
  io = I.create()
  I.setHandlers(io, {})       // no handlers, so nothing can act on the sim
  I.setTowerLookup(io, (x, y) => {
    const tower = OP.Towers.at(a, x, y)
    return tower ? tower.id : -1
  })
  const beforeA = OP.Sim.checksum(a)
  for (let i = 0; i < 200; i++) {
    OP.Input.setPoint(io, (i * 61) % OP.FIELD_W, (i * 37) % OP.FIELD_H)
    io.overCanvas = true
    I.updateHover(io)
    I.tap(io, io.x, io.y)
    I.placementPreview(io, a)
  }
  t.eq(OP.Sim.checksum(a), beforeA, '200 taps, hovers and previews left the sim bit-identical')
  t.eq(OP.Sim.checksum(a), OP.Sim.checksum(b), 'and identical to an untouched sim')
}

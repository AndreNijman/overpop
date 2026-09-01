export const name = 'coop'
export const needs = ['js/core/coop.js', 'js/data/modes.js']

import { straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  function sim () {
    return OP.Sim.create({
      map: { key: 'test', paths: [straightTrack(OP, 3000)], placement: null, blockers: null },
      seed: 'coop', difficulty: 'medium', mode: 'tag-team'
    })
  }

  t.section('Tag Team creates two independent cash pools')
  let s = sim()
  t.ok(s.coop, 'the coop state exists')
  t.eq(s.coop.active, 0, 'player one starts')
  t.eq(s.cash, 1000, 'player one receives the mode starting cash')
  t.eq(s.coop.players[1].cash, 1000, 'player two has an independent starting pool')
  OP.Economy.spend(s, 250)
  OP.Coop.swap(s)
  t.eq(s.coop.active, 1, 'the active player switches')
  t.eq(s.coop.players[0].cash, 750, 'player one cash is banked')
  t.eq(s.cash, 1000, 'player two cash is loaded')

  t.section('the wall-time overlay cannot deadlock the paused sim')
  t.ok(s.paused && s.coop.swapping, 'the swap pauses play')
  for (let i = 0; i < 7; i++) OP.Sim.advance(s, 0.25)
  t.ok(s.coop.swapping, 'the overlay remains before two seconds')
  OP.Sim.advance(s, 0.25)
  t.notOk(s.coop.swapping, 'the overlay expires at two seconds')
  t.notOk(s.paused, 'the sim resumes when it expires')

  t.section('placement is locked only during the handoff')
  OP.Coop.swap(s)
  const blocked = OP.Towers.canPlace(s, 'acorn-fox', 300, 300)
  t.notOk(blocked.ok, 'tower placement is refused during the swap')
  t.ok(/swap/i.test(blocked.reason), 'the refusal explains why')
  const heroKey = OP.HERO_ORDER[0]
  t.notOk(OP.Heroes.canPlace(s, heroKey, 500, 300).ok, 'hero placement is also refused')
  for (let i = 0; i < 8; i++) OP.Sim.advance(s, 0.25)
  t.ok(OP.Towers.canPlace(s, 'acorn-fox', 300, 300).ok, 'placement returns after the handoff')

  t.section('serialization captures the live active-player balance')
  OP.Economy.spend(s, 125)
  const snap = OP.Sim.serialize(s)
  t.eq(snap.coop.players[s.coop.active].cash, s.cash, 'the snapshot has no stale active balance')
  const restored = OP.Sim.deserialize(snap,
    { key: 'test', paths: [straightTrack(OP, 3000)], placement: null, blockers: null })
  t.eq(restored.coop.active, s.coop.active, 'the active player restores')
  t.eq(restored.cash, s.cash, 'their live cash restores')
  t.deep(OP.Coop.summary(restored), {
    active: restored.coop.active,
    cash0: restored.coop.active === 0 ? restored.cash : restored.coop.players[0].cash,
    cash1: restored.coop.active === 1 ? restored.cash : restored.coop.players[1].cash,
    swapping: false,
    swapTimer: 0
  }, 'the HUD summary reports both current balances')
  t.eq(OP.Sim.checksum(restored), OP.Sim.checksum(s), 'coop cash pools participate in the checksum')
}

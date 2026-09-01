export const name = 'boss'
export const needs = ['js/data/bosses.js', 'js/core/boss.js']

import { straightTrack, ticks } from './_fixture.mjs'

export function run (t, OP) {
  function sim () {
    return OP.Sim.create({
      map: { key: 'test', paths: [straightTrack(OP, 5000)], placement: null, blockers: null },
      seed: 'boss', difficulty: 'medium', mode: 'boss-event',
      rules: { startCash: 100000, startLives: 150 }
    })
  }

  t.section('the boss registry is complete')
  t.eq(Object.keys(OP.BOSSES).length, 3, 'three original bosses ship')
  const defs = Object.values(OP.BOSSES)
  t.deep(defs.map(d => d.key).sort(), ['elder-worm', 'storm-drake', 'void-maw'], 'all three boss keys are unique')
  for (const def of defs) {
    t.eq(def.maxTiers, 5, def.key + ' has five tiers')
    t.gt(OP.bossHP(def, 5, false), OP.bossHP(def, 1, false), def.key + ' gains HP by tier')
    t.gt(OP.bossHP(def, 1, true), OP.bossHP(def, 1, false), def.key + ' has a tougher elite form')
  }

  t.section('spawn creates a targetable simulation entity')
  let s = sim()
  const boss = OP.Boss.spawn(s, 'elder-worm', 1, false)
  t.ok(boss, 'the boss spawns')
  t.ok(boss.id > 0, 'it receives an entity id')
  t.eq(s.byId.get(boss.id), boss, 'the shared entity lookup resolves it')
  t.eq(OP.Boss.spawn(s, 'storm-drake', 1, false), null, 'a second active boss is refused')

  const tower = OP.Towers.place(s, 'acorn-fox', 80, 300, { free: true })
  tower.s.range = 300
  t.eq(OP.Targeting.acquire(s, tower, 'first'), boss.id, 'a tower acquires the boss with no balloons present')
  tower.s.noBlimps = true
  t.eq(OP.Targeting.acquire(s, tower, 'first'), -1, 'a no-blimps tower refuses the boss')
  tower.s.noBlimps = false

  t.section('ordinary tower fire can damage a directly targeted boss')
  boss.speed = 0
  const hp = boss.hp
  ticks(OP, s, 240)
  t.lt(boss.hp, hp, 'the tower fires and lowers boss HP')
  t.gt(s.stats.damageDealt, 0, 'boss damage is recorded')

  t.section('boss identity survives a sim round trip')
  const snap = OP.Sim.serialize(s)
  const restored = OP.Sim.deserialize(snap,
    { key: 'test', paths: [straightTrack(OP, 5000)], placement: null, blockers: null })
  t.ok(restored.boss && restored.boss.alive, 'the boss restores alive')
  t.eq(restored.boss.id, boss.id, 'its entity id restores')
  t.eq(restored.byId.get(boss.id), restored.boss, 'the restored lookup resolves it')
  t.eq(restored.nextEntityId, s.nextEntityId, 'the next id remains collision-free')
  t.gt(restored.boss.timeLimit, restored.boss.ticksAlive, 'the restored boss does not time out immediately')
  t.gt(restored.boss.minionInterval, 0, 'its minion cadence restores')

  t.section('killing a boss clears its targetable identity')
  const id = restored.boss.id
  OP.Boss.damage(restored, { damage: restored.boss.hp, dmgType: OP.DMG.VOID, sourceId: -1 })
  t.eq(restored.boss, null, 'the active boss slot clears')
  t.eq(restored.byId.get(id), undefined, 'the shared lookup no longer holds the dead boss')

  t.section('a resumed boss fight stays in lockstep with the never-saved run')
  // Regression: a saved boss battle must resume onto the exact same board. If the
  // RNG state did not round-trip bit-for-bit, the reloaded sim would diverge from
  // the original on the very next step even though it looked identical on load —
  // silently invalidating every mid-boss save.
  function mk () {
    const sim = OP.Sim.create({
      map: { key: 'test', paths: [straightTrack(OP, 5000)], placement: null, blockers: null },
      seed: 'boss-lockstep', difficulty: 'medium', mode: 'boss-event',
      rules: { startCash: 100000, startLives: 150 }
    })
    const b = OP.Boss.spawn(sim, 'storm-drake', 2, false)
    for (let i = 0; i < 60 && sim.towers.length < 4; i++) {
      OP.Towers.place(sim, 'acorn-fox', 40 + i * 50, 350, { free: true })
    }
    b.speed = 0.4
    return sim
  }
  const control = mk()
  const snapB = OP.Sim.serialize(control)
  const resumed = OP.Sim.deserialize(snapB,
    { key: 'test', paths: [straightTrack(OP, 5000)], placement: null, blockers: null })
  let divergent = -1
  for (let i = 0; i < 600; i++) {
    OP.Sim.step(control)
    OP.Sim.step(resumed)
    if (divergent < 0 && OP.Sim.checksum(control) !== OP.Sim.checksum(resumed)) divergent = i
  }
  t.eq(divergent, -1, '600 steps of a resumed boss fight never diverge from the original')
  t.eq(OP.Sim.checksum(control), OP.Sim.checksum(resumed), 'final checksums match')
}

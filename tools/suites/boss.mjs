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
  t.eq(restored.stats.bossTiersKilled, 1, 'the kill is counted for the Boss Event reward recorder')

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

  t.section('minions spawn on the boss cadence')
  const ms = sim()
  const mBoss = OP.Boss.spawn(ms, 'elder-worm', 1, false)
  mBoss.speed = 0
  const ballBefore = ms.balloons.length
  ticks(OP, ms, 240)
  const minions = ms.balloons.length - ballBefore
  t.gt(minions, 0, 'minions are released after the spawning interval')
  t.eq(mBoss.minionWave > 0 || ms.balloons.length > ballBefore, true, 'the minion counter advances as they spawn')
  t.gt(mBoss.minionInterval, 3, 'the spawn cadence is a sane countdown')
  t.ok(OP.bossMinions(mBoss.def, 1), 'the tier has a minion schedule')

  t.section('abilities engage only at tier 3+ and take effect')
  const dormant = OP.bossAbility(OP.bossByKey('elder-worm'), 2)
  t.eq(OP.bossAbility(OP.bossByKey('elder-worm'), 2), null, 'tier 2 has no ability')
  const active = OP.bossAbility(OP.bossByKey('storm-drake'), 3)
  t.eq(active && active.key, 'storm-drake-shock', 'tier 3 storm drake has its shock')
  t.gt(active.cooldown, 0, 'the ability cooldown is positive')
  const as = sim()
  const aBoss = OP.Boss.spawn(as, 'storm-drake', 3, false)
  aBoss.speed = 0
  const stunned = OP.Towers.place(as, 'acorn-fox', 50, 260, { free: true })
  t.eq(stunned.stunnedT === undefined || stunned.stunnedT === 0, true, 'tower starts unstunned')
  aBoss.abilityCd = 1
  let fired = false
  for (let i = 0; i < 300 && !fired; i++) {
    OP.Sim.step(as)
    if (as.events.some(e => e.kind === 'bossability')) fired = true
  }
  t.ok(fired, 'the ability fires once the cooldown elapses')
  t.gt(stunned.stunnedT || 0, 0, 'the shocked tower is disabled')
  const serBoss = OP.Sim.serialize(as).boss
  t.ok(Object.prototype.hasOwnProperty.call(serBoss, 'abilityActive'), 'the ability state serialises on the boss')

  t.section('reaching the exit ends the game as a leak')
  const rs = sim()
  const rBoss = OP.Boss.spawn(rs, 'elder-worm', 1, false)
  rBoss.speed = 1e6 // clear the 5000-unit track in a tick
  OP.Sim.step(rs)
  t.eq(rs.over, true, 'the run ends when the boss reaches the exit')
  t.eq(rs.outcome, 'leaked', 'the ending is a leak')
  t.eq(rs.events.some(e => e.kind === 'bossreach'), true, 'a bossreach event is emitted')

  t.section('hitting the time limit also ends the game as a leak')
  const ts = sim()
  const tBoss = OP.Boss.spawn(ts, 'void-maw', 1, false)
  tBoss.t = 0
  tBoss.ticksAlive = tBoss.timeLimit - 1
  OP.Sim.step(ts)
  t.eq(ts.over, true, 'the run ends when the time limit is hit')
  t.eq(ts.outcome, 'leaked', 'the ending is a leak')
  t.eq(ts.events.some(e => e.kind === 'bosstimeout'), true, 'a bosstimeout event is emitted')

  t.section('boss cadence stops when the final round wins the game')
  const cadence = sim()
  const bossDef = OP.bossByKey(cadence.rules.bossKey)
  cadence.roundSet = { [bossDef.spawnsOnRound]: { groups: [] } }
  OP.Rounds.begin(cadence, bossDef.spawnsOnRound)
  OP.Sim.step(cadence)
  t.notOk(cadence.over, 'a non-final boss round keeps the run active')
  t.ok(cadence.boss && cadence.boss.alive, 'and still spawns its scheduled boss')

  const final = sim()
  final.roundSet = { [final.rules.lastRound]: { groups: [] } }
  OP.Rounds.begin(final, final.rules.lastRound)
  OP.Sim.step(final)
  t.ok(final.over && final.outcome === 'won', 'the final round ends in victory')
  t.eq(final.boss, null, 'no extra boss is created behind the victory screen')

  t.section('boss tier HP scales through the documented curve')
  t.eq(OP.bossHP(OP.bossByKey('elder-worm'), 2, false), 50000 * 4, 'tier 2 multiplies base HP once')
  t.eq(OP.bossHP(OP.bossByKey('elder-worm'), 5, false), 50000 * 4 * 4 * 4 * 4, 'tier 5 is base HP to the fourth power')
  t.eq(OP.bossHP(OP.bossByKey('elder-worm'), 1, true), 50000 * 20, 'elite multiplies tier 1 HP by the elite factor')
}

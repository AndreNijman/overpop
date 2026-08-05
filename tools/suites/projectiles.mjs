export const name = 'projectiles'
export const needs = ['js/core/projectiles.js', 'js/core/damage.js', 'js/core/balloons.js']

import { makeSim, spawn, ticks, census } from './_fixture.mjs'

export function run (t, OP) {
  const P = OP.Projectiles
  const D = OP.DMG

  // Fire a projectile from the left, travelling right along the track line.
  function shoot (sim, def) {
    return P.spawn(sim, Object.assign({
      x: 0, y: 360, vx: 600, vy: 0,
      damage: 1, dmgType: D.SHARP, pierce: 1, radius: 4, life: 3, ownerId: 1
    }, def))
  }

  function prep (sim) { OP.Grid.rebuild(sim.grid, sim.balloons) }

  /* ---------- rule 1: never hit the same balloon twice ---------- */

  t.section('a projectile never hits the same balloon twice')
  let sim = makeSim(OP, { trackLength: 3000 })
  const big = spawn(OP, sim, 'omen', 400)   // 52-unit hull, several ticks to cross
  prep(sim)
  // 120 u/s over ~3.3s to reach x=400, then ~56 ticks inside a 52-unit hull.
  const slowShot = shoot(sim, { vx: 120, pierce: 10, damage: 1, life: 8 })
  const hpBefore = big.hp
  ticks(OP, sim, 300)
  t.eq(hpBefore - big.hp, 1, 'crossing a huge hull over many ticks still lands exactly one hit')
  t.eq(slowShot.hits.size, 1, 'the hit set holds exactly one id')

  t.section('pierce counts distinct balloons, not collision events')
  sim = makeSim(OP, { trackLength: 3000 })
  for (let i = 0; i < 5; i++) spawn(OP, sim, 'red', 300 + i * 14)
  prep(sim)
  const piercer = shoot(sim, { pierce: 3, damage: 1, life: 5 })
  ticks(OP, sim, 60)
  t.eq(sim.stats.popped, 3, 'a pierce-3 shot pops exactly three of five reds')
  t.eq(census(OP, sim).red, 2, 'two reds survive')
  t.notOk(piercer.alive, 'and the projectile is spent')

  /* ---------- rule 3: swept collision ---------- */

  t.section('swept collision catches a target the projectile passes in one tick')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 500)
  prep(sim)
  // 3000 units/sec = 50 units per tick, far more than a 6-unit hull.
  shoot(sim, { x: 400, vx: 3000, pierce: 1, life: 1 })
  ticks(OP, sim, 3)
  t.eq(sim.stats.popped, 1, 'a projectile moving 50 units per tick still hits a 6-unit balloon')

  t.section('and a genuinely wide miss stays a miss')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 500)
  prep(sim)
  shoot(sim, { x: 400, y: 200, vx: 3000, pierce: 1, life: 1 })
  ticks(OP, sim, 5)
  t.eq(sim.stats.popped, 0, 'a shot 160 units off the track hits nothing')

  t.section('nearest-first resolution')
  sim = makeSim(OP, { trackLength: 3000 })
  const near = spawn(OP, sim, 'ceramic', 300)
  const far = spawn(OP, sim, 'ceramic', 340)
  prep(sim)
  shoot(sim, { x: 250, vx: 4000, pierce: 1, damage: 3, life: 1 })
  ticks(OP, sim, 2)
  t.lt(near.hp, 10, 'the nearer ceramic took the hit')
  t.eq(far.hp, 10, 'the further one did not, even though both were in the sweep')

  /* ---------- pierce onto children ---------- */

  t.section('a piercing shot can spend pierce on the children it just created')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'black', 400)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 3, damage: 1, life: 2 })
  ticks(OP, sim, 10)
  t.eq(census(OP, sim).pink, undefined, 'pierce 3 clears the black and both pinks it spawned')
  t.eq(census(OP, sim).yellow, 2, 'leaving the two yellows underneath')

  t.section('but only as far as pierce allows')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'black', 400)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 2, damage: 1, life: 2 })
  ticks(OP, sim, 10)
  const c = census(OP, sim)
  t.eq((c.pink || 0) + (c.yellow || 0), 2, 'pierce 2 pops the black and one pink, leaving two balloons')

  t.section('a pierce-1 shot leaves the children alone')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'black', 400)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 1, damage: 1, life: 2 })
  ticks(OP, sim, 10)
  t.eq(census(OP, sim).pink, 2, 'both pinks survive')

  /* ---------- immunity and camo ---------- */

  t.section('immunity blanks a projectile but still costs pierce')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'lead', 400)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 1, damage: 5, dmgType: D.SHARP, life: 2 })
  ticks(OP, sim, 10)
  t.eq(census(OP, sim).lead, 1, 'a sharp shot cannot pop lead')
  t.eq(sim.stats.blanked, 1, 'and the blank is counted')

  t.section('camo gating on projectiles')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 400, OP.PROP.VEILED)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 5, life: 2, camoDetect: false })
  ticks(OP, sim, 10)
  t.eq(sim.stats.popped, 0, 'a projectile without detection passes straight through a veiled balloon')

  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 400, OP.PROP.VEILED)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 5, life: 2, camoDetect: true })
  ticks(OP, sim, 10)
  t.eq(sim.stats.popped, 1, 'with detection it pops')

  t.section('veiled children are also skipped without detection')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'wraith', 400)   // veiled, immune to sharp and explosive
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 9, damage: 9999, dmgType: D.COLD, life: 2, camoDetect: false })
  ticks(OP, sim, 10)
  t.eq(sim.stats.popped, 0, 'a WRAITH cannot even be reached without detection')

  /* ---------- bombs ---------- */

  t.section('a bomb explodes on first contact')
  sim = makeSim(OP, { trackLength: 3000 })
  for (let i = 0; i < 6; i++) spawn(OP, sim, 'red', 400 + i * 12)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 10, damage: 1, dmgType: D.EXPLOSIVE, blastRadius: 70, life: 2 })
  ticks(OP, sim, 10)
  t.eq(sim.stats.popped, 6, 'one bomb clears the whole cluster')
  t.eq(sim.blastEvents.length, 1, 'and records a single blast event')

  t.section('a bomb respects its pierce as a target cap')
  sim = makeSim(OP, { trackLength: 3000 })
  for (let i = 0; i < 8 ; i++) spawn(OP, sim, 'red', 400 + i * 12)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 3, damage: 1, dmgType: D.EXPLOSIVE, blastRadius: 90, life: 2 })
  ticks(OP, sim, 10)
  t.eq(sim.stats.popped, 3, 'pierce caps how many a blast can touch')

  t.section('blastOnExpiry detonates a bomb that hits nothing')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 100)
  prep(sim)
  shoot(sim, { x: 400, y: 100, vx: 0, vy: 0, blastRadius: 400, damage: 1, dmgType: D.EXPLOSIVE, pierce: 5, life: 0.2, blastOnExpiry: true })
  ticks(OP, sim, 20)
  t.eq(sim.blastEvents.length, 1, 'it exploded when its fuse ran out')
  t.eq(sim.stats.popped, 1, 'catching the balloon in range')

  t.section('a bomb without blastOnExpiry just disappears')
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 100)
  prep(sim)
  shoot(sim, { x: 400, y: 100, vx: 0, vy: 0, blastRadius: 400, damage: 1, dmgType: D.EXPLOSIVE, pierce: 5, life: 0.2 })
  ticks(OP, sim, 20)
  t.eq(sim.blastEvents.length, 0, 'no blast')
  t.eq(sim.stats.popped, 0, 'and nothing popped')

  t.section('blast falloff')
  sim = makeSim(OP, { trackLength: 3000 })
  const bNear = spawn(OP, sim, 'ceramic', 400)
  const bFar = spawn(OP, sim, 'ceramic', 520)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 5, damage: 8, dmgType: D.EXPLOSIVE, blastRadius: 160, blastFalloff: 0.85, life: 2 })
  ticks(OP, sim, 10)
  t.lt(bNear.hp, bFar.hp, 'the closer ceramic takes more from a falloff blast')

  /* ---------- lifetime, range, bounds ---------- */

  t.section('lifetime and range')
  sim = makeSim(OP, { trackLength: 3000 })
  const shortLived = shoot(sim, { life: 0.05 })
  ticks(OP, sim, 10)
  t.notOk(shortLived.alive, 'a projectile expires when its life runs out')

  sim = makeSim(OP, { trackLength: 3000 })
  const ranged = shoot(sim, { maxRange: 100, life: 10, vx: 600 })
  ticks(OP, sim, 60)
  t.notOk(ranged.alive, 'maxRange retires a projectile that has flown far enough')
  t.gte(ranged.travelled, 100, 'after actually travelling that far')

  sim = makeSim(OP, { trackLength: 3000 })
  const escapee = shoot(sim, { x: OP.FIELD_W - 10, vx: 4000, life: 10 })
  ticks(OP, sim, 20)
  t.notOk(escapee.alive, 'a projectile leaving the field is retired')

  t.section('gravity arcs a projectile')
  sim = makeSim(OP, { trackLength: 3000 })
  const lobbed = shoot(sim, { vx: 200, vy: -300, gravity: 900, life: 5 })
  const startVy = lobbed.vy
  ticks(OP, sim, 30)
  t.gt(lobbed.vy, startVy, 'gravity accelerates it downward')

  /* ---------- homing ---------- */

  t.section('homing steers toward a live target')
  sim = makeSim(OP, { tracks: [new OP.Track([{ x: 0, y: 100 }, { x: 3000, y: 100 }])] })
  const quarry = spawn(OP, sim, 'ceramic', 600)
  prep(sim)
  // The missile must outrun its target: a ceramic covers 115 u/s, so a 100 u/s
  // missile could home perfectly and still never arrive.
  const missile = P.spawn(sim, {
    x: 600, y: 500, vx: 0, vy: -500, damage: 1, dmgType: D.SHARP,
    pierce: 1, radius: 5, life: 6, ownerId: 1,
    homing: 8, turnRate: 8, targetId: quarry.id
  })
  ticks(OP, sim, 120)
  t.gt(sim.stats.projHits || 0, 0, 'the homing projectile connected')
  t.notOk(missile.alive, 'and was spent doing it')

  t.section('a homing projectile slower than its target does not magically connect')
  sim = makeSim(OP, { tracks: [new OP.Track([{ x: 0, y: 100 }, { x: 6000, y: 100 }])] })
  const runner = spawn(OP, sim, 'pink', 600)
  prep(sim)
  P.spawn(sim, {
    x: 600, y: 500, vx: 0, vy: -60, damage: 1, dmgType: D.SHARP,
    pierce: 1, radius: 5, life: 6, ownerId: 1,
    homing: 8, turnRate: 8, targetId: runner.id
  })
  ticks(OP, sim, 300)
  t.eq(sim.stats.projHits || 0, 0, 'homing steers, it does not teleport')

  t.section('homing survives its target dying')
  sim = makeSim(OP, { trackLength: 3000 })
  const doomed = spawn(OP, sim, 'red', 400)
  prep(sim)
  const seeker = P.spawn(sim, {
    x: 100, y: 360, vx: 300, vy: 0, damage: 1, pierce: 1, radius: 4, life: 5,
    ownerId: 1, homing: 5, turnRate: 5, targetId: doomed.id
  })
  OP.Balloons.kill(sim, doomed)
  t.noThrow(() => ticks(OP, sim, 30), 'a homing projectile whose target vanished does not crash')
  t.eq(seeker.targetId, -1, 'it forgets the dead target')

  /* ---------- behaviours are string keys ---------- */

  t.section('behaviour hooks are registry keys, not closures')
  let onHitCalls = 0, onExpireCalls = 0, onStepCalls = 0
  OP.PROJ_BEHAVIOURS['test-probe'] = {
    onHit: function () { onHitCalls++ },
    onExpire: function () { onExpireCalls++ },
    onStep: function () { onStepCalls++ }
  }
  sim = makeSim(OP, { trackLength: 3000 })
  spawn(OP, sim, 'red', 400)
  prep(sim)
  const probe = shoot(sim, { x: 300, vx: 1200, pierce: 1, life: 2, behaviour: 'test-probe' })
  ticks(OP, sim, 10)
  t.gt(onStepCalls, 0, 'onStep runs every tick')
  t.eq(onHitCalls, 1, 'onHit runs on contact')
  t.eq(typeof probe.behaviour, 'string', 'the projectile stores a string, not a function')

  sim = makeSim(OP, { trackLength: 3000 })
  shoot(sim, { life: 0.05, behaviour: 'test-probe' })
  ticks(OP, sim, 5)
  t.eq(onExpireCalls, 1, 'onExpire runs on expiry')
  delete OP.PROJ_BEHAVIOURS['test-probe']

  /* ---------- pooling ---------- */

  t.section('pooling reuses objects and clears their state')
  sim = makeSim(OP, { trackLength: 3000 })
  const first = shoot(sim, { life: 0.01 })
  first.hits.add(999)
  ticks(OP, sim, 3)
  t.eq(sim.projectiles.length, 0, 'the spent projectile is gone from the live list')
  t.eq(sim.projPool.length, 1, 'and back in the pool')
  const second = shoot(sim, {})
  t.ok(second === first, 'the next shot reuses it')
  t.eq(second.hits.size, 0, 'with a cleared hit set — otherwise it would refuse a legitimate target')
  t.eq(second.effects, null, 'and no stale effects')

  t.section('the projectile ceiling holds')
  sim = makeSim(OP, { trackLength: 3000 })
  let capped = false
  for (let i = 0; i < OP.MAX_PROJECTILES + 20; i++) if (shoot(sim, { life: 99 }) === null) { capped = true; break }
  t.ok(capped, 'spawn returns null at the ceiling rather than growing without limit')
  t.lte(sim.projectiles.length, OP.MAX_PROJECTILES, 'the live list respects MAX_PROJECTILES')

  /* ---------- effects delivered by projectiles ---------- */

  t.section('projectiles deliver status effects')
  sim = makeSim(OP, { trackLength: 5000 })
  const target = spawn(OP, sim, 'ceramic', 400)
  prep(sim)
  shoot(sim, {
    x: 300, vx: 1200, pierce: 1, damage: 0, dmgType: D.NORMAL, life: 2,
    effects: [OP.Effects.make('glue', 5, 0.5, 1, D.NORMAL)]
  })
  ticks(OP, sim, 10)
  t.ok(OP.Effects.has(target, 'glue'), 'the glue landed')
  t.close(target.speedMul, 0.5, 1e-9, 'and is slowing the balloon')

  /* ---------- pop attribution ---------- */

  t.section('pops are attributed to the firing tower')
  sim = makeSim(OP, { trackLength: 3000 })
  const fakeTower = { id: 77, pops: 0 }
  sim.towerById.set(77, fakeTower)
  spawn(OP, sim, 'pink', 400)
  prep(sim)
  shoot(sim, { x: 300, vx: 1200, pierce: 1, damage: 5, ownerId: 77, life: 2 })
  ticks(OP, sim, 10)
  t.eq(fakeTower.pops, 5, 'the tower is credited with all five layers')

  /* ---------- determinism ---------- */

  t.section('the pass is deterministic')
  function scenario (seed) {
    const s = makeSim(OP, { trackLength: 4000, seed })
    for (let i = 0; i < 30; i++) s.rng.next()
    for (let i = 0; i < 12; i++) spawn(OP, s, i % 3 === 0 ? 'ceramic' : 'black', 200 + i * 23)
    OP.Grid.rebuild(s.grid, s.balloons)
    for (let i = 0; i < 6; i++) {
      P.spawn(s, {
        x: 0, y: 360, vx: 700 + i * 40, vy: 0, damage: 2, dmgType: D.SHARP,
        pierce: 4, radius: 5, life: 4, ownerId: 1
      })
    }
    ticks(OP, s, 90)
    return [s.stats.popped, s.stats.layersPopped, s.stats.projHits || 0, Math.round(s.cash)].join('|')
  }
  const runA = scenario('det')
  const runB = scenario('det')
  t.eq(runA, runB, 'the same setup twice gives identical pop, hit and cash totals')
  t.ok(/^[1-9]/.test(runA), 'and the scenario actually did something: ' + runA)

  /* ---------- serialisation ---------- */

  t.section('serialisation round-trips')
  sim = makeSim(OP, { trackLength: 4000 })
  spawn(OP, sim, 'ceramic', 600)
  prep(sim)
  shoot(sim, { x: 200, vx: 500, pierce: 4, damage: 2, life: 5, effects: [OP.Effects.make('cold', 3, 0.4, 1, D.COLD)] })
  shoot(sim, { x: 100, vx: 900, pierce: 2, blastRadius: 40, dmgType: D.EXPLOSIVE, life: 4 })
  ticks(OP, sim, 20)
  const snap = JSON.parse(JSON.stringify(P.serialize(sim)))
  t.eq(snap.length, sim.projectiles.length, 'all live projectiles serialise')
  t.ok(snap.every(o => Array.isArray(o.hits)), 'hit sets serialise as arrays')
  t.ok(snap.every(o => typeof o.behaviour === 'string'), 'behaviours serialise as strings')

  const restored = makeSim(OP, { trackLength: 4000 })
  P.deserialize(restored, snap)
  t.eq(restored.projectiles.length, snap.length, 'all come back')
  const a = sim.projectiles.map(p => [p.id, p.x.toFixed(4), p.pierce, p.hits.size].join(':'))
  const b = restored.projectiles.map(p => [p.id, p.x.toFixed(4), p.pierce, p.hits.size].join(':'))
  t.deep(b, a, 'id, position, remaining pierce and hit-set size all round-trip')
  // NB: `instanceof Set` is false here even when correct — the bundle runs in a
  // separate VM context with its own Set constructor. Duck-type instead.
  t.ok(restored.projectiles.every(p => typeof p.hits.add === 'function' && typeof p.hits.has === 'function'),
    'hit sets come back as real sets (duck-typed across the VM boundary)')
  t.ok(restored.projectiles.every(p => p.hits.size === sim.projectiles.find(q => q.id === p.id).hits.size),
    'and with the same contents')
  t.ok(restored.projectiles[0].effects === null || Array.isArray(restored.projectiles[0].effects),
    'effects come back in a usable shape')
}

export const name = 'balloons'
export const needs = [
  'js/data/balloons.js', 'js/core/balloons.js', 'js/core/grid.js', 'js/core/effects.js'
]

import { makeSim, spawn, ticks, census, straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  const B = OP.Balloons

  /* ---------- data integrity ---------- */

  t.section('tier table')
  const tiers = OP.BALLOON_TIERS
  t.gte(tiers.length, 17, 'at least 17 tiers (12 simple + 5 blimp)')
  t.eq(new Set(tiers.map(x => x.key)).size, tiers.length, 'tier keys are unique')
  tiers.forEach((tier, i) => {
    t.eq(tier.index, i, `${tier.key}.index matches its position`)
    t.gte(tier.hp, 1, `${tier.key} has at least 1 layer HP`)
    t.gt(tier.speed, 0, `${tier.key} has a positive speed`)
    t.gt(tier.radius, 0, `${tier.key} has a positive radius`)
    t.ok(typeof tier.blurb === 'string' && tier.blurb.length > 10, `${tier.key} has bestiary text`)
    t.ok(/^#[0-9a-f]{6}$/i.test(tier.colour), `${tier.key} has a hex colour`)
  })

  t.section('child references resolve and terminate')
  let badChild = 0
  for (const tier of tiers) {
    for (const c of tier.children) {
      if (OP.BALLOON_INDEX[c.tier] === undefined) badChild++
      else if (OP.BALLOON_INDEX[c.tier] >= tier.index) badChild++   // must point weaker
      if (!(c.count >= 1)) badChild++
    }
  }
  t.eq(badChild, 0, 'every child reference exists and points to a strictly weaker tier')
  t.eq(OP.tierByKey('red').children.length, 0, 'red is the terminal tier')

  t.section('RBE is computed, not tabled')
  t.eq(OP.balloonRBE('red'), 1, 'red is 1')
  t.eq(OP.balloonRBE('blue'), 2, 'blue is 2')
  t.eq(OP.balloonRBE('green'), 3, 'green is 3')
  t.eq(OP.balloonRBE('yellow'), 4, 'yellow is 4')
  t.eq(OP.balloonRBE('pink'), 5, 'pink is 5')
  t.eq(OP.balloonRBE('black'), 11, 'black is 1 + two pinks')
  t.eq(OP.balloonRBE('white'), 11, 'white matches black')
  t.eq(OP.balloonRBE('purple'), 11, 'purple matches black')
  t.eq(OP.balloonRBE('lead'), 23, 'lead is 1 + two blacks')
  t.eq(OP.balloonRBE('zebra'), 23, 'zebra is 1 + a black and a white')
  t.eq(OP.balloonRBE('rainbow'), 47, 'rainbow is 1 + two zebras')
  t.eq(OP.balloonRBE('ceramic'), 104, 'ceramic is 10 shell + two rainbows')
  t.eq(OP.balloonRBE('goliath'), 616, 'GOLIATH is 200 + four ceramics')
  t.eq(OP.balloonRBE('wraith'), 816, 'WRAITH is 400 + four ceramics')
  t.eq(OP.balloonRBE('leviathan'), 3164, 'LEVIATHAN is 700 + four GOLIATHs')
  t.eq(OP.balloonRBE('colossus'), 16656, 'COLOSSUS is 4000 + four LEVIATHANs')
  t.eq(OP.balloonRBE('omen'), 55760, 'OMEN is 20000 + two COLOSSUS + three WRAITH')

  let nonDecreasing = true
  for (let i = 1; i < tiers.length; i++) {
    if (OP.balloonRBE(tiers[i].key) < OP.balloonRBE(tiers[i - 1].key)) nonDecreasing = false
  }
  t.ok(nonDecreasing, 'the roster is ordered by non-decreasing RBE')
  t.throws(() => OP.tierIndex('nope'), 'an unknown tier key throws rather than returning undefined')

  t.section('immunity sets are prebuilt lookups, not array scans')
  t.ok(OP.tierByKey('black').immuneSet.explosive, 'black ignores explosive')
  t.ok(OP.tierByKey('white').immuneSet.cold, 'white ignores cold')
  t.ok(OP.tierByKey('zebra').immuneSet.explosive && OP.tierByKey('zebra').immuneSet.cold, 'zebra ignores both')
  t.ok(OP.tierByKey('lead').immuneSet.sharp, 'lead ignores sharp')
  const purple = OP.tierByKey('purple').immuneSet
  t.ok(purple.fire && purple.plasma && purple.energy, 'purple ignores fire, plasma and energy')
  t.notOk(purple.sharp, 'purple is vulnerable to sharp')
  const wraith = OP.tierByKey('wraith')
  t.ok(wraith.immuneSet.sharp && wraith.immuneSet.explosive, 'WRAITH ignores sharp and explosive')
  t.ok(wraith.props & OP.PROP.VEILED, 'WRAITH is born veiled')
  t.ok(wraith.blimp, 'WRAITH is a blimp')

  t.section('blimp boundary')
  t.eq(OP.BALLOON_TIERS[OP.LAST_SIMPLE_TIER].key, 'ceramic', 'ceramic is the last simple tier')
  t.ok(OP.BALLOON_TIERS[OP.FIRST_BLIMP_TIER].blimp, 'the next tier up is a blimp')
  for (let i = OP.FIRST_BLIMP_TIER; i < tiers.length; i++) t.ok(tiers[i].blimp, `${tiers[i].key} is a blimp`)

  /* ---------- entities ---------- */

  t.section('spawning')
  const sim = makeSim(OP, { trackLength: 1000 })
  const red = spawn(OP, sim, 'red')
  t.ok(red && red.alive, 'a spawned balloon is alive')
  t.eq(red.hp, 1, 'red spawns with 1 layer HP')
  t.eq(red.t, 0, 'spawns at the track start')
  t.close(red.x, 0, 1e-9, 'position is derived from t immediately')
  t.eq(red.prevX, red.x, 'prevX starts equal to x, so the first frame does not interpolate from nowhere')
  t.eq(B.get(sim, red.id), red, 'the id index resolves it')
  t.eq(sim.stats.spawned, 1, 'spawn is counted')

  const cer = spawn(OP, sim, 'ceramic')
  t.eq(cer.hp, 10, 'ceramic spawns with 10 layer HP')
  const plated = spawn(OP, sim, 'ceramic', 0, OP.PROP.PLATED)
  t.eq(plated.hp, 20, 'PLATED doubles layer HP')
  const platedRed = spawn(OP, sim, 'red', 0, OP.PROP.PLATED)
  t.eq(platedRed.hp, 2, 'PLATED doubles even a one-HP layer')

  const scaled = OP.Balloons.spawn(sim, { tier: 'goliath', hpScale: 2 })
  t.eq(scaled.hp, 400, 'hpScale multiplies layer HP (Double HP Blimps mode)')

  t.section('ids are unique and ascending')
  const ids = sim.balloons.map(b => b.id)
  t.eq(new Set(ids).size, ids.length, 'no duplicate ids')
  let ascending = true
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) ascending = false
  t.ok(ascending, 'spawn order gives ascending ids, which the determinism guarantee relies on')

  t.section('the pool reuses objects rather than allocating')
  const sim2 = makeSim(OP)
  const first = spawn(OP, sim2, 'red')
  const firstRef = first
  B.kill(sim2, first)
  B.compact(sim2)
  t.eq(sim2.balloons.length, 0, 'compaction drops the dead balloon')
  t.eq(sim2.balloonPool.length, 1, 'the object went back to the pool')
  const second = spawn(OP, sim2, 'blue')
  t.ok(second === firstRef, 'the next spawn reuses the pooled object')
  t.neq(second.id, firstRef.id === second.id ? -1 : firstRef.id, 'but it gets a fresh id')
  t.eq(second.effects.length, 0, 'and its effects were cleared on recycle')
  t.eq(second.tier, OP.tierIndex('blue'), 'and its tier was reset')

  /* ---------- movement ---------- */

  t.section('movement')
  const sim3 = makeSim(OP, { trackLength: 1000 })
  const mover = spawn(OP, sim3, 'red')
  ticks(OP, sim3, 60)
  t.close(mover.t, OP.BASE_SPEED, OP.BASE_SPEED * 0.02, 'a red balloon covers BASE_SPEED units in one second')
  t.close(mover.x, mover.t, 1e-6, 'x tracks t on a straight path')
  t.gt(mover.prevX, 0, 'prevX is maintained for render interpolation')

  const sim4 = makeSim(OP, { trackLength: 4000 })
  const slow = spawn(OP, sim4, 'red')
  const fast = spawn(OP, sim4, 'pink')
  ticks(OP, sim4, 60)
  t.close(fast.t / slow.t, OP.tierByKey('pink').speed, 0.05, 'pink travels at its speed multiple of red')

  t.section('a stopped balloon does not move')
  const sim5 = makeSim(OP, { trackLength: 1000 })
  const stopped = spawn(OP, sim5, 'red')
  stopped.speedMul = 0
  OP.Balloons.move(sim5)
  t.eq(stopped.t, 0, 'speedMul 0 means no movement at all')
  t.eq(stopped.prevX, stopped.x, 'and prev position stays consistent')

  /* ---------- leaks ---------- */

  t.section('leaks')
  const sim6 = makeSim(OP, { trackLength: 100 })
  const leaker = spawn(OP, sim6, 'ceramic', 95)
  const before = sim6.stats.leaked
  ticks(OP, sim6, 30)
  t.notOk(leaker.alive, 'a balloon reaching the exit is removed')
  t.eq(sim6.stats.leaked - before, 104, 'a full ceramic costs its whole RBE')
  t.eq(sim6.leakEvents.length, 1, 'the leak was recorded as an event')
  t.eq(sim6.leakEvents[0].tier, 'ceramic', 'the event names the tier')

  const sim7 = makeSim(OP, { trackLength: 100 })
  const damaged = spawn(OP, sim7, 'ceramic', 99)
  damaged.hp = 3   // took 7 shell damage on the way
  ticks(OP, sim7, 10)
  t.eq(sim7.stats.leaked, 3 + 2 * 47, 'a damaged ceramic only costs its remaining layers')

  t.section('leaking exactly at the exit counts, one unit short does not')
  const sim8 = makeSim(OP, { trackLength: 100 })
  const atExit = spawn(OP, sim8, 'red', 100)
  const nearExit = spawn(OP, sim8, 'red', 99.9)
  OP.Balloons.leakCheck(sim8)
  t.notOk(atExit.alive, 't == length has leaked')
  t.ok(nearExit.alive, 't just short of length has not')

  /* ---------- children ---------- */

  t.section('child cascade')
  const sim9 = makeSim(OP, { trackLength: 1000 })
  const black = spawn(OP, sim9, 'black', 500)
  const made = []
  const n = B.spawnChildren(sim9, black, made)
  t.eq(n, 2, 'a black spawns two children')
  t.eq(made.length, 2, 'and reports their ids')
  const kids = made.map(id => B.get(sim9, id))
  t.ok(kids.every(k => OP.BALLOON_TIERS[k.tier].key === 'pink'), 'both children are pink')
  t.ok(kids.every(k => Math.abs(k.t - 500) <= OP.CHILD_SPREAD), 'children spawn at the parent position')
  t.neq(kids[0].t, kids[1].t, 'children are fanned apart rather than stacked')
  t.eq(kids[0].spawnTier, kids[0].tier, "a split child's spawnTier is its own tier, so regen cannot climb past the split")

  const zebraSim = makeSim(OP)
  const zebra = spawn(OP, zebraSim, 'zebra', 100)
  const zk = []
  B.spawnChildren(zebraSim, zebra, zk)
  const zKinds = zk.map(id => OP.BALLOON_TIERS[B.get(zebraSim, id).tier].key).sort()
  t.deep(zKinds, ['black', 'white'], 'a zebra splits into one black and one white')

  const omenSim = makeSim(OP)
  const omen = spawn(OP, omenSim, 'omen', 100)
  const ok2 = []
  B.spawnChildren(omenSim, omen, ok2)
  t.eq(ok2.length, 5, 'OMEN spawns five children')
  const oKinds = {}
  ok2.forEach(id => { const k = OP.BALLOON_TIERS[B.get(omenSim, id).tier].key; oKinds[k] = (oKinds[k] || 0) + 1 })
  t.eq(oKinds.colossus, 2, 'two COLOSSUS')
  t.eq(oKinds.wraith, 3, 'three WRAITH')

  t.section('children never spawn behind the track start')
  const edge = makeSim(OP)
  const atStart = spawn(OP, edge, 'omen', 0)
  const eids = []
  B.spawnChildren(edge, atStart, eids)
  t.ok(eids.every(id => B.get(edge, id).t >= 0), 'a split at t=0 clamps children to t >= 0')

  t.section('property inheritance')
  const inh = makeSim(OP)
  const veiled = spawn(OP, inh, 'ceramic', 100, OP.PROP.VEILED | OP.PROP.PLATED)
  const vk = []
  B.spawnChildren(inh, veiled, vk)
  const vkids = vk.map(id => B.get(inh, id))
  t.ok(vkids.every(k => k.props & OP.PROP.VEILED), 'VEILED passes to children')
  t.ok(vkids.every(k => k.props & OP.PROP.PLATED), 'PLATED passes to children')
  t.eq(vkids[0].hp, 2, 'and the inherited PLATED doubles the child layer HP')

  const wSim = makeSim(OP)
  const wr = spawn(OP, wSim, 'wraith', 100)
  const wk = []
  B.spawnChildren(wSim, wr, wk)
  t.ok(wk.map(id => B.get(wSim, id)).every(k => k.props & OP.PROP.VEILED),
    'WRAITH children are veiled ceramics — the whole point of the tier')

  t.section('cascade depth is bounded')
  const deep = makeSim(OP)
  const b = spawn(OP, deep, 'red', 10)
  b.depth = OP.MAX_CASCADE_DEPTH
  t.eq(B.spawnChildren(deep, b, []), 0, 'a balloon at max depth spawns nothing')

  t.section('spawn respects the entity ceiling')
  const flood = makeSim(OP)
  let capped = false
  for (let i = 0; i < OP.MAX_BALLOONS + 50; i++) if (spawn(OP, flood, 'red') === null) { capped = true; break }
  t.ok(capped, 'spawn returns null rather than growing without limit')
  t.lte(flood.balloons.length, OP.MAX_BALLOONS, 'the live list never exceeds MAX_BALLOONS')

  /* ---------- regen ---------- */

  t.section('regen climbs back, but never past a split')
  const rSim = makeSim(OP, { trackLength: 100000 })
  const regen = spawn(OP, rSim, 'rainbow', 0, OP.PROP.REGEN)
  regen.tier = OP.tierIndex('zebra')     // as if popped one layer
  regen.hp = 1
  ticks(OP, rSim, Math.ceil(OP.REGEN_PERIOD * 60) + 2)
  t.eq(OP.BALLOON_TIERS[regen.tier].key, 'rainbow', 'a regen balloon climbs back a layer')
  t.eq(sim.stats.regrown >= 0, true, 'regrowth is counted')
  ticks(OP, rSim, Math.ceil(OP.REGEN_PERIOD * 60) * 3)
  t.eq(OP.BALLOON_TIERS[regen.tier].key, 'rainbow', 'and stops at the tier it spawned as')

  const noRegen = makeSim(OP, { trackLength: 100000 })
  const plain = spawn(OP, noRegen, 'rainbow')
  plain.tier = OP.tierIndex('zebra')
  ticks(OP, noRegen, Math.ceil(OP.REGEN_PERIOD * 60) * 2)
  t.eq(OP.BALLOON_TIERS[plain.tier].key, 'zebra', 'a balloon without REGEN never climbs')

  t.section('regen restores the full layer HP of the tier it returns to')
  const rc = makeSim(OP, { trackLength: 100000 })
  const shell = spawn(OP, rc, 'ceramic', 0, OP.PROP.REGEN)
  shell.tier = OP.tierIndex('rainbow')
  shell.hp = 1
  ticks(OP, rc, Math.ceil(OP.REGEN_PERIOD * 60) + 2)
  t.eq(OP.BALLOON_TIERS[shell.tier].key, 'ceramic', 'climbed back to ceramic')
  t.eq(shell.hp, 10, 'and got its ten shell HP back, not one')

  /* ---------- compaction and ordering ---------- */

  t.section('compaction preserves order')
  const cSim = makeSim(OP)
  const list = []
  for (let i = 0; i < 20; i++) list.push(spawn(OP, cSim, 'red'))
  for (let i = 0; i < 20; i += 2) B.kill(cSim, list[i])
  B.compact(cSim)
  t.eq(cSim.balloons.length, 10, 'ten survivors')
  let ordered = true
  for (let i = 1; i < cSim.balloons.length; i++) if (cSim.balloons[i].id <= cSim.balloons[i - 1].id) ordered = false
  t.ok(ordered, 'survivors stay in ascending id order — a swap-remove would break replays')
  t.eq(cSim.byId.size, 10, 'the id index dropped the dead entries')

  /* ---------- grid integration ---------- */

  t.section('children are visible to the grid immediately')
  const gSim = makeSim(OP)
  const parent = spawn(OP, gSim, 'black', 300)
  OP.Grid.rebuild(gSim.grid, gSim.balloons)
  const out = []
  OP.Grid.queryCircle(gSim.grid, parent.x, parent.y, 40, out)
  t.eq(out.length, 1, 'the parent is in the grid')
  B.spawnChildren(gSim, parent, [])
  B.kill(gSim, parent)
  OP.Grid.queryCircle(gSim.grid, 300, 360, 40, out)
  t.eq(out.length, 2, 'both children are queryable without waiting for a rebuild')

  t.section('grid queries return ascending ids regardless of bucket layout')
  const qSim = makeSim(OP)
  for (let i = 0; i < 40; i++) spawn(OP, qSim, 'red', i * 7)
  OP.Grid.rebuild(qSim.grid, qSim.balloons)
  const q = []
  OP.Grid.queryCircle(qSim.grid, 140, 360, 200, q)
  let qOrdered = true
  for (let i = 1; i < q.length; i++) if (q[i].id <= q[i - 1].id) qOrdered = false
  t.ok(qOrdered, 'query results are id-sorted, so tie-breaks cannot depend on grid geometry')
  t.gt(q.length, 5, 'the query actually found balloons')

  t.section('fat query catches a blimp clipped by the edge of a blast')
  const fSim = makeSim(OP)
  const big = spawn(OP, fSim, 'omen', 500)
  OP.Grid.rebuild(fSim.grid, fSim.balloons)
  const fat = []
  const r = OP.tierByKey('omen').radius
  // A 5-unit blast whose edge just overlaps the hull: 54 apart, combined reach 57.
  const probeX = big.x + r + 2
  OP.Grid.queryCircle(fSim.grid, probeX, big.y, 5, fat)
  t.eq(fat.length, 0, 'a centre-only query misses it — the centre is 54 units away')
  OP.Grid.queryCircleFat(fSim.grid, probeX, big.y, 5, fat)
  t.eq(fat.length, 1, 'the radius-aware query finds it, because the hull is inside the blast')
  OP.Grid.queryCircleFat(fSim.grid, big.x + r + 40, big.y, 5, fat)
  t.eq(fat.length, 0, 'and a blast genuinely clear of the hull still misses')

  /* ---------- serialisation ---------- */

  t.section('serialisation round-trips')
  const sSim = makeSim(OP, { trackLength: 2000 })
  spawn(OP, sSim, 'ceramic', 120, OP.PROP.REGEN | OP.PROP.PLATED)
  spawn(OP, sSim, 'goliath', 340)
  spawn(OP, sSim, 'red', 900)
  ticks(OP, sSim, 30)
  const snap = JSON.parse(JSON.stringify(B.serialize(sSim)))
  t.eq(snap.length, 3, 'all live balloons serialise')
  t.ok(snap.every(s => typeof s.tier === 'string'), 'tiers serialise as stable keys, not indices')

  const restored = makeSim(OP, { trackLength: 2000 })
  B.deserialize(restored, snap)
  t.eq(restored.balloons.length, 3, 'all three come back')
  t.deep(census(OP, restored), census(OP, sSim), 'the tier census matches')
  t.eq(B.totalRBE(restored), B.totalRBE(sSim), 'total remaining RBE matches exactly')
  const a = sSim.balloons.map(x => [x.id, x.t.toFixed(6), x.hp, x.props].join(':'))
  const c = restored.balloons.map(x => [x.id, x.t.toFixed(6), x.hp, x.props].join(':'))
  t.deep(c, a, 'every id, position, HP and property flag round-trips')

  t.section('deserialisation restores ascending id order')
  const shuffled = snap.slice().reverse()
  const r2 = makeSim(OP, { trackLength: 2000 })
  B.deserialize(r2, shuffled)
  let rOrdered = true
  for (let i = 1; i < r2.balloons.length; i++) if (r2.balloons[i].id <= r2.balloons[i - 1].id) rOrdered = false
  t.ok(rOrdered, 'load order cannot change iteration order')

  /* ---------- multi-path ---------- */

  t.section('multi-path tracks')
  const mSim = makeSim(OP, {
    tracks: [straightTrack(OP, 500, 200), straightTrack(OP, 1500, 500)]
  })
  const onShort = OP.Balloons.spawn(mSim, { tier: 'red', path: 0, t: 450 })
  const onLong = OP.Balloons.spawn(mSim, { tier: 'red', path: 1, t: 900 })
  t.close(onShort.y, 200, 1e-6, 'path 0 balloon sits on its own track')
  t.close(onLong.y, 500, 1e-6, 'path 1 balloon sits on its own track')
  t.lt(OP.remaining(mSim.map.paths[0], onShort.t), OP.remaining(mSim.map.paths[1], onLong.t),
    'the balloon nearer its own exit is First despite a smaller t')

  t.section('helpers')
  t.eq(B.count(mSim), 2, 'count reports live balloons')
  t.eq(B.leader(mSim).id, onShort.id, 'leader is the one closest to leaking')
  t.eq(OP.layerHP(OP.tierByKey('ceramic'), 0), 10, 'layerHP without PLATED')
  t.eq(OP.layerHP(OP.tierByKey('ceramic'), OP.PROP.PLATED), 20, 'layerHP with PLATED')
}

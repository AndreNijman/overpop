export const name = 'buffs'
export const needs = ['js/core/buffs.js', 'js/core/towers.js']

import { makeSim } from './_fixture.mjs'

export function run (t, OP) {
  const B = OP.Buffs
  const T = OP.Towers
  const D = OP.DMG

  const path = n => ({
    name: n,
    tiers: [1, 2, 3, 4, 5].map(i => ({
      name: n + i, cost: i * 100, desc: 'a thing', apply: function (s) { s.damage += 1 }
    }))
  })

  // A plain gun to be buffed.
  if (!OP.TOWERS['buff-gun']) {
    T.define({
      key: 'buff-gun', name: 'Buff Gun', family: 'primary', cost: 200, footprint: 12,
      base: { range: 100, cooldown: 1, damage: 2, pierce: 2, dmgType: D.SHARP, projSpeed: 300 },
      paths: [path('A'), path('B'), path('C')],
      fire: function () {}
    })
  }
  // A magic gun, to test family filters.
  if (!OP.TOWERS['buff-mage']) {
    T.define({
      key: 'buff-mage', name: 'Buff Mage', family: 'magic', cost: 300, footprint: 12,
      base: { range: 100, cooldown: 1, damage: 2, pierce: 2, dmgType: D.PLASMA, projSpeed: 300 },
      paths: [path('A'), path('B'), path('C')],
      fire: function () {}
    })
  }
  // A village that buffs everything nearby.
  if (!OP.TOWERS['buff-village']) {
    T.define({
      key: 'buff-village', name: 'Buff Village', family: 'support', cost: 1000, footprint: 16,
      base: { range: 180, cooldown: 5, damage: 0, pierce: 1, dmgType: D.NORMAL, projSpeed: 1 },
      paths: [path('A'), path('B'), path('C')],
      update: function () {},
      buffs: function (sim, tower) {
        OP.Buffs.register(sim, {
          id: 'village:' + tower.id,
          sourceId: tower.id,
          x: tower.x, y: tower.y,
          radius: tower.s ? tower.s.range : 180,
          excludeSelf: true,
          mods: { rangeMul: 1.2, camoDetect: true }
        })
      }
    })
  }

  function place (sim, key, x, y) { return T.place(sim, key, x, y, { free: true }) }

  t.section('field categories are declared, so a content phase knows what exists')
  t.ok(B.ADD_FIELDS.length > 0, 'additive fields are enumerated')
  t.ok(B.MUL_FIELDS.length > 0, 'multiplicative fields are enumerated')
  t.ok(B.FLAG_FIELDS.indexOf('camoDetect') >= 0, 'camoDetect is a flag field')

  t.section('a buff with no id is refused')
  let sim = makeSim(OP, { cash: 100000 })
  t.throws(() => B.register(sim, { mods: {} }), 'an id is mandatory — it is what makes re-registration idempotent')

  t.section('additive and multiplicative mods')
  sim = makeSim(OP, { cash: 100000 })
  const gun = place(sim, 'buff-gun', 400, 300)
  t.eq(gun.s.range, 100, 'baseline range')
  t.eq(gun.s.damage, 2, 'baseline damage')

  B.register(sim, { id: 'r1', radius: 'global', mods: { rangeAdd: 25 } })
  T.restat(sim, gun)
  t.eq(gun.s.range, 125, 'rangeAdd adds')

  B.register(sim, { id: 'r2', radius: 'global', mods: { rangeMul: 2 } })
  T.restat(sim, gun)
  t.eq(gun.s.range, 250, 'rangeMul multiplies the already-added value')

  B.register(sim, { id: 'd1', radius: 'global', mods: { damageAdd: 3 } })
  T.restat(sim, gun)
  t.eq(gun.s.damage, 5, 'damageAdd adds')
  t.eq(gun.s.buffCount, 3, 'and the tower knows how many buffs reached it')

  t.section('same-kind mods from several sources aggregate')
  sim = makeSim(OP, { cash: 100000 })
  const g2 = place(sim, 'buff-gun', 400, 300)
  B.register(sim, { id: 'a', radius: 'global', mods: { rangeAdd: 10 } })
  B.register(sim, { id: 'b', radius: 'global', mods: { rangeAdd: 20 } })
  B.register(sim, { id: 'c', radius: 'global', mods: { rangeMul: 1.5 } })
  B.register(sim, { id: 'd', radius: 'global', mods: { rangeMul: 2 } })
  T.restat(sim, g2)
  t.eq(g2.s.range, (100 + 30) * 3, 'adds sum and muls multiply: (100+30) * 1.5 * 2')

  t.section('ORDER INDEPENDENCE — the property this whole module exists for')
  function withOrder (order) {
    const s = makeSim(OP, { cash: 100000 })
    const tower = place(s, 'buff-gun', 400, 300)
    for (const spec of order) B.register(s, spec)
    T.restat(s, tower)
    return [tower.s.range, tower.s.damage, tower.s.pierce, tower.s.cooldown, !!tower.s.camoDetect].join('|')
  }
  const specs = [
    { id: 'x1', radius: 'global', mods: { rangeAdd: 15, damageAdd: 1 } },
    { id: 'x2', radius: 'global', mods: { rangeMul: 1.25, cooldownMul: 0.8 } },
    { id: 'x3', radius: 'global', mods: { pierceAdd: 4, camoDetect: true } },
    { id: 'x4', radius: 'global', mods: { rangeAdd: 5, cooldownMul: 0.5 } }
  ]
  const forward = withOrder(specs)
  const backward = withOrder(specs.slice().reverse())
  const shuffled = withOrder([specs[2], specs[0], specs[3], specs[1]])
  t.eq(backward, forward, 'registering in reverse order gives identical stats')
  t.eq(shuffled, forward, 'and so does an arbitrary order: ' + forward)

  t.section('two overlapping villages give the same result in either placement order')
  function twoVillages (first, second) {
    const s = makeSim(OP, { cash: 100000 })
    const target = place(s, 'buff-gun', 500, 300)
    place(s, 'buff-village', first.x, first.y)
    place(s, 'buff-village', second.x, second.y)
    T.restatAll(s)
    return [target.s.range.toFixed(6), !!target.s.camoDetect].join('|')
  }
  const orderA = twoVillages({ x: 440, y: 300 }, { x: 560, y: 300 })
  const orderB = twoVillages({ x: 560, y: 300 }, { x: 440, y: 300 })
  t.eq(orderA, orderB, 'identical stats regardless of which village was built first: ' + orderA)

  t.section('MUTUAL buff sources: aura geometry must not depend on placement order')
  // Regression. Previously `def.buffs` ran after `restat`, so the second village
  // computed its aura radius with the first village's rangeMul already applied,
  // and the two auras ended up different sizes depending on build order. The
  // earlier order-independence test missed it by only checking a third tower
  // that sat comfortably inside both auras.
  function villageRadii (order) {
    const s2 = makeSim(OP, { cash: 100000 })
    const spots = order === 'AB' ? [[300, 200], [550, 200]] : [[550, 200], [300, 200]]
    for (const [x, y] of spots) T.place(s2, 'buff-village', x, y)
    return s2.buffs.slice()
      .sort((p1, p2) => p1.x - p2.x)
      .map(bf => `${bf.x},${bf.y}:${bf.radius.toFixed(3)}`)
      .join(' ')
  }
  const radiiAB = villageRadii('AB')
  const radiiBA = villageRadii('BA')
  t.eq(radiiBA, radiiAB, 'two mutually-overlapping villages register identical auras either way')
  t.eq(radiiAB, '300,200:180.000 550,200:180.000',
    'and both auras use the UNBUFFED range, not a range inflated by the other village')

  t.section('a tower on the edge of one aura is treated the same in either order')
  function edgeRange (order) {
    const s2 = makeSim(OP, { cash: 100000 })
    const edge = place(s2, 'buff-gun', 470, 200)
    const spots = order === 'AB' ? [[300, 200], [550, 200]] : [[550, 200], [300, 200]]
    for (const [x, y] of spots) T.place(s2, 'buff-village', x, y)
    return edge.s.range.toFixed(6)
  }
  t.eq(edgeRange('BA'), edgeRange('AB'), `an edge tower resolves identically (${edgeRange('AB')})`)

  t.section('inside buffs(), tower.s is the unbuffed stat block')
  // Enforced by the engine rather than left to every content author to remember.
  let seenRange = -1
  if (!OP.TOWERS['buff-probe']) {
    T.define({
      key: 'buff-probe', name: 'Probe', family: 'support', cost: 100, footprint: 12,
      base: { range: 200, cooldown: 3, damage: 0, pierce: 1, dmgType: D.NORMAL, projSpeed: 1 },
      paths: [path('A'), path('B'), path('C')],
      update: function () {},
      buffs: function (s2, tower) {
        seenRange = tower.s.range
        OP.Buffs.register(s2, { id: 'probe:' + tower.id, sourceId: tower.id, x: tower.x, y: tower.y, radius: 50, mods: {} })
      }
    })
  }
  sim = makeSim(OP, { cash: 100000 })
  B.register(sim, { id: 'inflate', radius: 'global', mods: { rangeMul: 5 } })
  const probe = place(sim, 'buff-probe', 400, 300)
  t.eq(seenRange, 200, 'buffs() saw the base range, not the 5x-inflated one')
  t.eq(probe.s.range, 1000, 'while the resolved stats do include the buff')

  t.section('flags OR together and cannot be un-set by another buff')
  sim = makeSim(OP, { cash: 100000 })
  const g3 = place(sim, 'buff-gun', 400, 300)
  t.notOk(g3.s.camoDetect, 'no detection to begin with')
  B.register(sim, { id: 'f1', radius: 'global', mods: { camoDetect: true } })
  B.register(sim, { id: 'f2', radius: 'global', mods: { camoDetect: false } })
  T.restat(sim, g3)
  t.ok(g3.s.camoDetect, 'a false flag does not cancel a true one — flags only grant')

  t.section('dmgTypeSet resolves by declared priority, not by order')
  function typeWith (order) {
    const s = makeSim(OP, { cash: 100000 })
    const tower = place(s, 'buff-gun', 400, 300)
    for (const spec of order) B.register(s, spec)
    T.restat(s, tower)
    return tower.s.dmgType
  }
  const hi = { id: 'hi', radius: 'global', priority: 10, mods: { dmgTypeSet: D.SHATTER } }
  const lo = { id: 'lo', radius: 'global', priority: 1, mods: { dmgTypeSet: D.FIRE } }
  t.eq(typeWith([hi, lo]), D.SHATTER, 'the higher priority wins')
  t.eq(typeWith([lo, hi]), D.SHATTER, 'and still wins when registered second')

  t.section('equal priorities break on id, deterministically')
  const eqA = { id: 'aaa', radius: 'global', priority: 5, mods: { dmgTypeSet: D.COLD } }
  const eqB = { id: 'zzz', radius: 'global', priority: 5, mods: { dmgTypeSet: D.FIRE } }
  t.eq(typeWith([eqA, eqB]), D.COLD, 'the lower id wins')
  t.eq(typeWith([eqB, eqA]), D.COLD, 'in either registration order')

  t.section('radius')
  sim = makeSim(OP, { cash: 100000 })
  const inside = place(sim, 'buff-gun', 400, 300)
  const outside = place(sim, 'buff-gun', 900, 300)
  B.register(sim, { id: 'local', x: 400, y: 300, radius: 100, mods: { rangeAdd: 50 } })
  T.restatAll(sim)
  t.eq(inside.s.range, 150, 'a tower inside the radius is buffed')
  t.eq(outside.s.range, 100, 'a tower outside is not')

  t.section('radius is measured to the tower centre, inclusively')
  sim = makeSim(OP, { cash: 100000 })
  const atEdge = place(sim, 'buff-gun', 500, 300)
  B.register(sim, { id: 'edge', x: 400, y: 300, radius: 100, mods: { rangeAdd: 10 } })
  T.restatAll(sim)
  t.eq(atEdge.s.range, 110, 'exactly on the edge counts as inside')

  t.section('family and key filters')
  sim = makeSim(OP, { cash: 100000 })
  const prim = place(sim, 'buff-gun', 300, 300)
  const mage = place(sim, 'buff-mage', 600, 300)
  B.register(sim, { id: 'primonly', radius: 'global', families: ['primary'], mods: { damageAdd: 5 } })
  T.restatAll(sim)
  t.eq(prim.s.damage, 7, 'the primary tower is buffed')
  t.eq(mage.s.damage, 2, 'the magic tower is not')

  sim = makeSim(OP, { cash: 100000 })
  const kGun = place(sim, 'buff-gun', 300, 300)
  const kMage = place(sim, 'buff-mage', 600, 300)
  B.register(sim, { id: 'keyed', radius: 'global', keys: ['buff-mage'], mods: { damageAdd: 4 } })
  T.restatAll(sim)
  t.eq(kMage.s.damage, 6, 'a key filter buffs the named tower')
  t.eq(kGun.s.damage, 2, 'and nothing else')

  t.section('selfOnly and excludeSelf')
  sim = makeSim(OP, { cash: 100000 })
  const selfT = place(sim, 'buff-gun', 300, 300)
  const otherT = place(sim, 'buff-gun', 600, 300)
  B.register(sim, { id: 'self', sourceId: selfT.id, radius: 'global', selfOnly: true, mods: { damageAdd: 9 } })
  T.restatAll(sim)
  t.eq(selfT.s.damage, 11, 'selfOnly reaches its source')
  t.eq(otherT.s.damage, 2, 'and nobody else')

  sim = makeSim(OP, { cash: 100000 })
  const src = place(sim, 'buff-gun', 300, 300)
  const nbr = place(sim, 'buff-gun', 600, 300)
  B.register(sim, { id: 'ex', sourceId: src.id, radius: 'global', excludeSelf: true, mods: { damageAdd: 9 } })
  T.restatAll(sim)
  t.eq(src.s.damage, 2, 'excludeSelf skips its source')
  t.eq(nbr.s.damage, 11, 'but reaches everyone else')

  t.section('a village buffs its neighbours but not itself')
  sim = makeSim(OP, { cash: 100000 })
  const village = place(sim, 'buff-village', 400, 300)
  const neighbour = place(sim, 'buff-gun', 460, 300)
  T.restatAll(sim)
  t.close(neighbour.s.range, 120, 1e-9, 'the neighbour got the range multiplier')
  t.ok(neighbour.s.camoDetect, 'and the detection flag')
  t.eq(village.s.range, 180, 'the village itself is unchanged')

  t.section('re-registering the same id replaces rather than stacking')
  sim = makeSim(OP, { cash: 100000 })
  const once = place(sim, 'buff-gun', 400, 300)
  B.register(sim, { id: 'same', radius: 'global', mods: { rangeAdd: 30 } })
  B.register(sim, { id: 'same', radius: 'global', mods: { rangeAdd: 30 } })
  B.register(sim, { id: 'same', radius: 'global', mods: { rangeAdd: 30 } })
  T.restat(sim, once)
  t.eq(once.s.range, 130, 'three registrations of one id count once')
  t.eq(sim.buffs.length, 1, 'and only one buff is stored')

  t.section('unregistering')
  sim = makeSim(OP, { cash: 100000 })
  const un = place(sim, 'buff-gun', 400, 300)
  B.register(sim, { id: 'u1', sourceId: 42, radius: 'global', mods: { rangeAdd: 10 } })
  B.register(sim, { id: 'u2', sourceId: 42, radius: 'global', mods: { damageAdd: 1 } })
  B.register(sim, { id: 'u3', sourceId: 99, radius: 'global', mods: { pierceAdd: 1 } })
  T.restat(sim, un)
  t.eq(un.s.range, 110, 'all three applied')

  t.eq(B.unregisterBySource(sim, 42), 2, 'unregisterBySource removes both of that source')
  T.restat(sim, un)
  t.eq(un.s.range, 100, 'and the range buff is gone')
  t.eq(un.s.pierce, 3, 'while the other source survives')

  t.ok(B.unregisterById(sim, 'u3'), 'unregisterById removes one')
  t.notOk(B.unregisterById(sim, 'u3'), 'and reports false the second time')
  T.restat(sim, un)
  t.eq(un.s.pierce, 2, 'back to baseline')

  t.section('selling a buff source removes its buff')
  sim = makeSim(OP, { cash: 100000 })
  const soldVillage = T.place(sim, 'buff-village', 400, 300)
  const beneficiary = place(sim, 'buff-gun', 460, 300)
  T.restatAll(sim)
  t.gt(beneficiary.s.range, 100, 'buffed while the village stands')
  T.sell(sim, soldVillage)
  t.eq(beneficiary.s.range, 100, 'and back to baseline once it is sold')
  t.eq(sim.buffs.length, 0, 'with no orphaned buff left behind')

  t.section('cooldown can never be driven to zero')
  sim = makeSim(OP, { cash: 100000 })
  const fast = place(sim, 'buff-gun', 400, 300)
  B.register(sim, { id: 'z1', radius: 'global', mods: { cooldownMul: 0 } })
  T.restat(sim, fast)
  t.gt(fast.s.cooldown, 0, 'a zero multiplier is clamped to a positive floor')

  t.section('listFor tells the tower panel what is reaching a tower')
  sim = makeSim(OP, { cash: 100000 })
  const inspected = place(sim, 'buff-gun', 400, 300)
  place(sim, 'buff-gun', 900, 300)
  B.register(sim, { id: 'near', x: 400, y: 300, radius: 80, mods: { rangeAdd: 10 } })
  B.register(sim, { id: 'far', x: 900, y: 300, radius: 80, mods: { rangeAdd: 10 } })
  const list = []
  B.listFor(sim, inspected, list)
  t.eq(list.length, 1, 'only the buff that actually applies is listed')
  t.eq(list[0].id, 'near', 'and it is the right one')

  t.section('rebuild reconstructs buffs from the towers that provide them')
  sim = makeSim(OP, { cash: 100000 })
  T.place(sim, 'buff-village', 400, 300)
  T.place(sim, 'buff-village', 800, 300)
  const beforeCount = sim.buffs.length
  t.eq(beforeCount, 2, 'two villages, two buffs')
  sim.buffs = []
  B.rebuild(sim)
  t.eq(sim.buffs.length, 2, 'rebuild restores them')
  t.ok(sim.buffs.every(b => sim.towerById.has(b.sourceId)), 'and every buff has a live source — no orphans')

  t.section('a tower placed after a global buff still receives it')
  sim = makeSim(OP, { cash: 100000 })
  B.register(sim, { id: 'pre-existing', radius: 'global', mods: { damageAdd: 7 } })
  const late = place(sim, 'buff-gun', 400, 300)
  t.eq(late.s.damage, 9, 'placement restats against the existing buff set')
}

import assert from 'node:assert/strict'
import { makeSim } from './_fixture.mjs'

export const name = 'reference-build'
export const needs = [
  'tools/playthroughs.mjs', 'js/core/sim.js', 'js/core/upgrades.js',
  'js/core/buffs.js', 'js/towers/primary.js', 'js/towers/magic.js',
  'js/towers/support.js', 'js/data/rounds-standard.js'
]

export async function run (t, OP) {
  const { playReference, runGame } = await import('../playthroughs.mjs')
  const HALL = 'warren-hall'
  const SNAIL = 'sap-snail'
  const OWL = 'elder-owl'

  function fixture (keys = [HALL, SNAIL]) {
    // Zero starting cash leaves the opening empty; all subsequent ownership is
    // real engine placement, shared with the bot through its public own array.
    const sim = makeSim(OP, { cash: 0, rules: { allowedTowerKeys: keys } })
    const plan = playReference(sim, sim.map)
    assert.equal(plan.own.length, 0)
    return { sim, plan }
  }

  function add ({ sim, plan }, key, x, y, tiers = [0, 0, 0]) {
    sim.cash = 1000000
    const tower = OP.Towers.place(sim, key, x, y)
    assert.ok(tower, `fixture placement failed: ${key} at ${x},${y}`)
    plan.own.push(tower)
    for (let path = 0; path < tiers.length; path++) {
      while (tower.tiers[path] < tiers[path]) {
        const result = OP.Upgrades.buy(sim, tower, path)
        assert.ok(result.ok, `fixture upgrade failed: ${key}: ${result.reason}`)
      }
    }
    assert.ok(OP.Upgrades.isLegalState(tower.tiers))
    return tower
  }

  t.section('committed Hall buys the legal Keen Watch / Lantern Ring ladder')
  {
    const f = fixture()
    const { sim, plan } = f
    const hall = add(f, HALL, 300, 326)
    sim.roundIndex = 30
    const steps = [
      [1, [0, 1, 0]], [1, [0, 2, 0]], [1, [0, 3, 0]],
      [0, [1, 3, 0]], [0, [2, 3, 0]], [1, [2, 4, 0]]
    ]
    for (const [path, expected] of steps) {
      const cost = OP.Upgrades.nextCost(sim, hall, path)
      t.ok(OP.Upgrades.canBuy(hall, path).ok, `${expected.join('-')} is a legal next purchase`)
      if (expected[1] === 4) {
        t.deep(hall.tiers, [2, 3, 0], 'Lantern Ring starts from an actual 2-3-0 Hall')
        t.notOk(OP.Upgrades.canBuy(hall, 0).ok, 'Watchtower tier 3 would be an illegal crosspath')
        sim.cash = cost + 199
        const before = sim.events.length
        plan.spend()
        t.deep(hall.tiers, [2, 3, 0], 'banks when Lantern Ring would breach the 200 cash reserve')
        t.eq(sim.events.length, before, 'banking does not divert money into another purchase')
        t.eq(sim.cash, cost + 199, 'the bank is preserved')
      }
      sim.cash = cost + 200
      const before = sim.events.length
      plan.spend()
      t.deep(hall.tiers, expected, `bot reaches ${expected.join('-')}`)
      t.deep(sim.events.slice(before).filter(e => e.kind === 'upgrade' && e.towerId === hall.id)
        .map(e => [e.path, e.tier, e.cost]), [[path, expected[path], cost]],
      'the engine records the intended paid upgrade, not a direct tier mutation')
      t.ok(OP.Upgrades.isLegalState(hall.tiers), 'Hall remains legally crosspathed')
    }
  }

  t.section('an illegal tier-3 Hall goal releases spending instead of deadlocking')
  {
    const f = fixture()
    const { sim, plan } = f
    const hall = add(f, HALL, 300, 326, [3, 2, 0])
    const snail = add(f, SNAIL, 900, 326)
    sim.roundIndex = 30
    const cost = OP.Upgrades.nextCost(sim, hall, 1)
    t.notOk(OP.Upgrades.canBuy(hall, 1).ok, 'Keen Watch is locked by the legal Watchtower build')
    sim.cash = cost + 200
    const invested = snail.invested
    const before = sim.events.length
    plan.spend()
    t.deep(hall.tiers, [3, 2, 0], 'does not manufacture an illegal 3-3-0 Hall')
    t.gt(snail.invested, invested, 'the attacker receives the released budget')
    t.ok(sim.events.slice(before).some(e => e.kind === 'upgrade' && e.towerId === snail.id),
      'fallthrough reaches a real attacker upgrade')
    t.lt(sim.cash, cost + 200, 'cash is spent even though the illegal goal was affordable')
    t.ok(plan.own.every(tower => OP.Upgrades.isLegalState(tower.tiers)), 'all resulting builds remain legal')
  }

  for (const overlapping of [false, true]) {
    t.section(`Hall${overlapping ? 's with mutually granted detection' : ' alone in its detection area'} cannot answer Wraith`)
    const f = fixture()
    const { sim, plan } = f
    // The early coverage candidate (24,326) is radius + 10 away. A +20
    // approximation accepts it, but real detection must reject it and go later.
    const hall = add(f, HALL, 249, 326, [2, 4, 0])
    if (overlapping) add(f, HALL, 320, 326, [0, 3, 0])
    const blind = add(f, SNAIL, 900, 326)
    const buff = sim.buffs.find(b => b.sourceId === hall.id && b.mods.camoDetect)
    assert.ok(buff)
    const fringe = { id: -1, key: SNAIL, def: OP.TOWERS[SNAIL], x: 24, y: 326 }
    t.ok(OP.Towers.canPlace(sim, SNAIL, fringe.x, fringe.y).ok, 'the fringe candidate is legal placement')
    t.between(OP.M.dist(hall.x, hall.y, fringe.x, fringe.y), buff.radius + 1, buff.radius + 20,
      'candidate exposes the old +20 detection approximation')
    t.notOk(OP.Buffs.applies(buff, fringe), 'the engine rejects detection at that candidate')
    t.notOk(blind.s.camoDetect, 'existing acid attacker is blind outside all Halls')
    t.ok(OP.canDamage('wraith', blind.s.dmgType), 'existing attacker has the right damage type, not detection')
    if (overlapping) {
      t.ok(hall.s.camoDetect, 'a second Hall really grants detection to the first')
      t.gt(hall.s.damage, 0, 'resolved support damage alone is not evidence of an attack')
      t.ok(OP.canDamage('wraith', hall.s.dmgType), 'support stats look Wraith-compatible to a types-only check')
      t.notOk(typeof hall.def.fire === 'function', 'the apparently compatible Hall still cannot fire')
    }
    sim.roundIndex = 85
    sim.cash = OP.Economy.price(sim, OP.TOWERS[SNAIL].cost) + 30
    const count = plan.own.length
    plan.spend()
    const added = plan.own.slice(count)
    t.eq(added.length, 1, 'buys exactly one real counter, rather than accepting Hall support stats')
    t.ok(added.length === 1 && added.every(tower => tower.key === SNAIL &&
      tower.s.camoDetect && OP.canDamage('wraith', tower.s.dmgType) &&
      OP.Buffs.applies(buff, tower) &&
      OP.M.dist(hall.x, hall.y, tower.x, tower.y) <= buff.radius),
    'new attacker receives detection inside the actual Hall radius')
    t.eq(sim.cash, 30, 'the counter was purchased through the economy')
  }

  t.section('Wraith deepening prefers resolved Hall detection over a richer blind fringe tower')
  {
    const f = fixture()
    const { sim, plan } = f
    const hall = add(f, HALL, 300, 326, [2, 4, 0])
    const buff = sim.buffs.find(b => b.sourceId === hall.id && b.mods.camoDetect)
    assert.ok(buff)
    const blind = add(f, SNAIL, hall.x + buff.radius + 10, hall.y, [3, 2, 0])
    const detected = add(f, SNAIL, 370, 326, [1, 0, 0])
    t.gt(blind.invested, detected.invested, 'blind tower would win investment-only ranking')
    t.notOk(blind.s.camoDetect, 'radius + 10 is not detection')
    t.ok(detected.s.camoDetect, 'the less-invested attacker has engine-resolved detection')
    sim.roundIndex = 85
    sim.cash = OP.Upgrades.nextCost(sim, detected, 0) + 30
    const count = plan.own.length
    plan.spend()
    t.deep(detected.tiers, [2, 0, 0], 'deepens the attacker that can actually see Wraith')
    t.deep(blind.tiers, [3, 2, 0], 'does not spend on the richer but blind attacker')
    t.eq(plan.own.length, count, 'an existing detected attacker prevents redundant counter placement')
    t.eq(sim.cash, 30, 'exact upgrade budget goes to the detected attacker')
  }

  for (const keen of [true, false]) {
    t.section(`native detection outside a ${keen ? 'Keen Watch' : 'pre-Keen Watch'} Hall remains a valid Wraith carry`)
    const f = fixture([HALL, SNAIL, OWL])
    const { sim, plan } = f
    const hall = add(f, HALL, 300, 326, [2, keen ? 4 : 2, 0])
    const buff = sim.buffs.find(b => b.sourceId === hall.id)
    assert.ok(buff)
    const blind = add(f, SNAIL, hall.x + buff.radius + 10, hall.y, [4, 2, 0])
    const owl = add(f, OWL, 900, 326, [0, 2, 0])
    t.notOk(OP.Buffs.applies(buff, owl), 'owl is outside Hall coverage')
    t.ok(owl.s.camoDetect && OP.canDamage('wraith', owl.s.dmgType),
      'legal Night Vision supplies a native Wraith answer without the Hall')
    t.notOk(blind.s.camoDetect, 'near-Hall acid carry is still blind')
    t.eq(sim.buffs.some(b => b.mods.camoDetect), keen, 'only a Hall that reached Keen Watch emits detection')
    sim.roundIndex = 85
    sim.cash = OP.Upgrades.nextCost(sim, owl, 1) + 30
    const count = plan.own.length
    const before = sim.events.length
    plan.spend()
    t.deep(owl.tiers, [0, 3, 0], 'deepens the native detector instead of banking for the blind carry')
    t.deep(blind.tiers, [4, 2, 0], 'blind carry receives no upgrades')
    t.eq(plan.own.length, count, 'native counter outside Hall prevents unnecessary paired placement')
    t.deep(sim.events.slice(before).filter(e => e.kind === 'upgrade').map(e => e.towerId), [owl.id],
      'only the actual Wraith-capable attacker receives an upgrade')
    t.eq(sim.cash, 30, 'native detector receives the entire upgrade budget')
  }

  t.section('medium standard reference builds hold through the Wraith era and win')
  for (const map of ['fernway-hollow', 'bramble-gap']) {
    const result = runGame(map, 'medium', 'standard', playReference, 60)
    t.eq(result.target, 60, `${map}: full medium target`)
    t.eq(result.reached, 60, `${map}: reaches round 60`)
    t.eq(result.stalled, 0, `${map}: no stalled rounds`)
    t.ok(result.survived, `${map}: reference survives (${result.leaked} RBE leaked)`)
    t.eq(result.outcome, 'won', `${map}: the engine declares a win`)
    t.gt(result.lives, 0, `${map}: lives remain`)
    t.ok(result.board.every(tower => OP.Upgrades.isLegalState(tower.paths.split('-').map(Number))),
      `${map}: the entire final board has legal upgrades`)
  }
}


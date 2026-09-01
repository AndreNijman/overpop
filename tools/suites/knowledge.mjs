export const name = 'knowledge'
export const needs = ['js/data/knowledge.js', 'js/core/knowledge.js', 'js/ui/knowledge.js']

import { straightTrack } from './_fixture.mjs'

export function run (t, OP) {
  function sim (knowledge) {
    return OP.Sim.create({
      map: { key: 'test', paths: [straightTrack(OP, 3000)], placement: null, blockers: null },
      seed: 'knowledge',
      difficulty: 'medium',
      mode: 'standard',
      knowledge: knowledge || [],
      rules: { startCash: 650, startLives: 150 }
    })
  }

  t.section('the tree is complete and internally valid')
  t.ok(OP.KNOWLEDGE && typeof OP.KNOWLEDGE === 'object', 'OP.KNOWLEDGE exists')
  t.eq(Object.keys(OP.KNOWLEDGE).length, 26, 'twenty-six knowledge nodes ship')
  t.deep(OP.KNOWLEDGE_BRANCH_ORDER, ['primary', 'military', 'magic', 'support', 'general'],
    'all five branches have a stable display order')
  t.deep(OP.knowledgeValidate(), [], 'every prerequisite exists in its own branch')
  t.eq(OP.KNOWLEDGE_TOTAL_COST, 63, 'the full tree costs 63 KP')

  const supported = new Set([].concat(OP.Buffs.ADD_FIELDS, OP.Buffs.MUL_FIELDS, OP.Buffs.FLAG_FIELDS))
  for (const key of OP.KNOWLEDGE_ORDER) {
    const node = OP.KNOWLEDGE[key]
    t.eq(node.key, key, key + ' carries its registry key')
    t.ok(Number.isInteger(node.cost) && node.cost > 0, key + ' costs positive integer KP')
    t.ok(Array.isArray(node.prereqs), key + ' has a prerequisite list')
    for (const mod of Object.keys(node.mods || {})) {
      t.ok(supported.has(mod), key + ' uses supported buff field ' + mod)
    }
  }

  t.section('availability follows prerequisites')
  const roots = OP.knowledgeAvailable([])
  for (const key of ['gen-start-cash', 'pri-damage', 'mil-damage', 'mag-damage', 'sup-cost']) {
    t.ok(roots.indexOf(key) >= 0, key + ' is initially available')
  }
  t.notOk(roots.indexOf('pri-pierce') >= 0, 'a tier-one node starts locked')
  const afterRoot = OP.knowledgeAvailable(['pri-damage'])
  t.ok(afterRoot.indexOf('pri-pierce') >= 0, 'its first child unlocks after the root')
  t.ok(afterRoot.indexOf('pri-range') >= 0, 'both branches unlock together')

  t.section('purchases spend points and enforce the tree')
  const profile = OP.Save.defaults()
  profile.knowledgePoints = 5
  let res = OP.Knowledge.purchase(profile, 'pri-pierce')
  t.notOk(res.ok, 'a child cannot be bought before its root')
  t.eq(profile.knowledgePoints, 5, 'a refused purchase spends nothing')
  res = OP.Knowledge.purchase(profile, 'pri-damage')
  t.ok(res.ok, 'the root can be purchased')
  t.eq(profile.knowledgePoints, 4, 'its cost is deducted')
  t.deep(profile.knowledge, ['pri-damage'], 'the node is stored canonically')
  res = OP.Knowledge.purchase(profile, 'pri-pierce')
  t.ok(res.ok, 'the child can now be purchased')
  t.eq(profile.knowledgePoints, 2, 'the child cost is deducted')
  t.notOk(OP.Knowledge.purchase(profile, 'pri-pierce').ok, 'a node cannot be purchased twice')
  t.notOk(OP.Knowledge.purchase(profile, 'not-a-node').ok, 'an unknown node is refused')

  t.section('rule bonuses apply when a run is created')
  let s = sim(['gen-start-cash', 'gen-pop-income', 'gen-round-bonus'])
  t.eq(s.cash, 700, 'Deep Pockets adds 50 starting cash')
  t.close(s.rules.cashPerPopMul, 1.05, 1e-9, 'Keen Eye adds five percentage points of pop income')
  t.close(s.rules.roundBonusMul, 1.05, 1e-9, 'Round Stipend adds five percentage points')

  t.section('family stat bonuses apply through the buff engine')
  const base = sim([])
  const boosted = sim(['pri-damage', 'pri-range', 'pri-cooldown', 'pri-crit'])
  const plainTower = OP.Towers.place(base, 'acorn-fox', 300, 300, { free: true })
  const boostedTower = OP.Towers.place(boosted, 'acorn-fox', 300, 300, { free: true })
  t.ok(plainTower && boostedTower, 'comparison towers place')
  t.eq(boostedTower.s.damage, Math.round((plainTower.s.damage + 1) * 1.08),
    'additive damage resolves before the multiplicative capstone')
  t.eq(boostedTower.s.range, plainTower.s.range + 10, 'range bonus applies')
  t.close(boostedTower.s.cooldown, plainTower.s.cooldown * 0.95, 1e-9, 'cooldown is five percent faster')

  const military = sim(['mil-damage', 'mil-proj-speed'])
  const militaryTower = OP.Towers.place(military, 'longshot-lynx', 300, 300, { free: true })
  const militaryPlain = OP.Towers.place(base, 'longshot-lynx', 500, 300, { free: true })
  t.ok(militaryTower && militaryPlain, 'military comparison towers place')
  t.close(militaryTower.s.projSpeed, militaryPlain.s.projSpeed * 1.10, 1e-9,
    'projectile speed is ten percent faster rather than ten percent of normal')

  t.section('knowledge state survives sim serialisation')
  const snap = OP.Sim.serialize(boosted)
  const restored = OP.Sim.deserialize(snap,
    { key: 'test', paths: [straightTrack(OP, 3000)], placement: null, blockers: null })
  t.deep(restored.knowledge, boosted.knowledge, 'unlocked keys restore in canonical order')
}

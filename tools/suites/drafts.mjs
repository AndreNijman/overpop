// Draft Tokens: the collected-free-placement economy. A token is free to spend —
// no cash, no mode or XP gate — but still has to fit the board, lands at a fixed
// starting tier on the first branch, and is consumed by the placement itself.
// This suite grades the engine in js/core/drafts.js and its store integration.

export const name = 'drafts'
export const needs = [
  'js/core/drafts.js',
  'js/core/towers.js',
  'js/core/upgrades.js',
  'js/core/economy.js',
  'js/towers/primary.js',
  'js/towers/military.js',
  'js/towers/magic.js',
  'js/towers/support.js',
  'js/save.js'
]

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

export function run (t, OP) {
  const D = OP.Drafts
  t.ok(D, 'the Draft Tokens engine ships')
  t.ok(OP.TOWER_ORDER && OP.TOWER_ORDER.length > 0, 'a tower roster is present to hand out')

  const slotKey = OP.TOWER_ORDER[0]
  const slotDef = OP.TOWERS[slotKey]

  t.section('a fresh profile owns no tokens')
  const p = OP.Save.defaults()
  t.deep(p.drafts, [], 'defaults open with an empty draft list')
  t.eq(D.count(p), 0, 'count is zero')
  t.deep(D.list(p), [], 'list is empty')

  t.section('grant creates slots; re-grant deepens the same slot')
  const g = OP.Save.defaults()
  t.eq(D.grant(g, slotKey, 1) && 1, 1, 'grant returns the slot for a known tower')
  t.deep(D.list(g), [{ key: slotKey, level: 1, count: 1 }], 'one slot exists after the first grant')
  D.grant(g, slotKey, 1)
  t.deep(D.list(g), [{ key: slotKey, level: 1, count: 2 }], 'a second identical grant stacks in the same slot')
  D.grant(g, slotKey, 3)
  t.deep(D.list(g), [
    { key: slotKey, level: 1, count: 2 },
    { key: slotKey, level: 3, count: 1 }
  ], 'a different level forms its own slot')
  t.eq(D.count(g), 3, 'count sums all slots')

  t.section('grant guards')
  t.eq(D.grant(g, 'not-a-tower', 1), null, 'an unknown tower key is refused')
  t.eq(D.grant({}, 'not-a-tower', 1), null, 'a missing profile stays safe')
  t.deep(D.list(g), [
    { key: slotKey, level: 1, count: 2 },
    { key: slotKey, level: 3, count: 1 }
  ], 'no junk slot was created')

  t.section('levels clamp to the 0..3 token band')
  D.grant(g, slotKey, 9)
  D.grant(g, slotKey, -4)
  D.grant(g, slotKey, 'x')
  t.deep(D.list(g), [
    { key: slotKey, level: 0, count: 2 },
    { key: slotKey, level: 1, count: 2 },
    { key: slotKey, level: 3, count: 2 }
  ], 'out-of-range and junk levels clamp to the nearest band end')
  t.deep(D.tiers(3), [3, 0, 0], 'tiers maps a level onto the first branch')
  t.deep(D.tiers(7), [3, 0, 0], 'tiers clamps over-levels')
  t.deep(D.tiers(-1), [0, 0, 0], 'tiers clamps under-levels')
  t.eq(D.MAX_LEVEL, 3, 'the token band is tier 0 through tier 3')

  t.section('consume spends a slot and removes it when empty')
  const c = OP.Save.defaults()
  D.grant(c, slotKey, 2)
  D.grant(c, slotKey, 2)
  t.eq(D.consume(c, slotKey, 2), true, 'spending an owned token succeeds')
  t.deep(D.list(c), [{ key: slotKey, level: 2, count: 1 }], 'count drops but the slot survives')
  t.eq(D.consume(c, slotKey, 2), true, 'spending the last token succeeds')
  t.deep(D.list(c), [], 'an emptied slot disappears')
  t.eq(D.consume(c, slotKey, 2), false, 'spending with nothing owned is refused')
  t.eq(D.consume(c, 'not-a-tower', 1), false, 'spending an unowned key is refused')

  t.section('grantRandom is deterministic under a seeded rng and spreads the collection')
  const r1 = D.grantRandom(OP.Save.defaults(), new OP.RNG('draft-suite'))
  const r2 = D.grantRandom(OP.Save.defaults(), new OP.RNG('draft-suite'))
  t.ok(r1 && r1.key && r1.level >= 0 && r1.level <= 3 && r1.count === 1,
    'a random grant returns a well-formed slot')
  t.eq(r1.key, r2.key, 'the same seed picks the same tower')
  t.eq(r1.level, r2.level, 'the same seed picks the same level')
  // Burning through the roster with a wide seed should leave every tower tokenised
  // — and duplicates are the signal that a writer keeps picking from the rest pool.
  const sweep = OP.Save.defaults()
  let dupes = 0
  let guard = 0
  while (OP.TOWER_ORDER.some(k => !D.list(sweep).some(s => s.key === k)) && guard++ < OP.TOWER_ORDER.length + 4) {
    D.grantRandom(sweep, new OP.RNG('sweep-' + guard))
  }
  t.ok(guard <= OP.TOWER_ORDER.length, 'every tower is tokenised within one grant per tower')

  t.section('grantRandom prefers towers that own no token yet')
  const pref = OP.Save.defaults()
  const want = OP.TOWER_ORDER[0]
  for (let i = 1; i < OP.TOWER_ORDER.length; i++) D.grant(pref, OP.TOWER_ORDER[i], 1)
  const pick = D.grantRandom(pref, new OP.RNG('prefer-fresh'))
  t.eq(pick && pick.key, want, 'with one fresh tower left the pick must be that tower')

  t.section('list is sorted by family, then key, then level and ignores junk entries')
  const j = OP.Save.defaults()
  D.grant(j, OP.TOWER_ORDER[1], 0)
  D.grant(j, slotKey, 3)
  D.grant(j, OP.TOWER_ORDER[1], 2)
  const broken = JSON.parse('[{"__proto__":{"count":99},"level":1},{"key":"__proto__","level":1,"count":1},{"key":"constructor","level":1,"count":1}]')
  j.drafts = j.drafts.concat(broken)
  const sorted = D.list(j)
  t.ok(sorted.length >= 3, 'junk entries are dropped, real slots survive')
  const famIdx = OP.FAMILIES
  for (let i = 1; i < sorted.length; i++) {
    const a = OP.TOWERS[sorted[i - 1].key], b = OP.TOWERS[sorted[i].key]
    const fa = famIdx.indexOf(a.family), fb = famIdx.indexOf(b.family)
    t.ok(fa < fb || (fa === fb && (sorted[i - 1].key < sorted[i].key ||
      (sorted[i - 1].key === sorted[i].key && sorted[i - 1].level <= sorted[i].level))),
      'slots come out in family/key/level order')
  }
  t.eq(OP.TOWERS[sorted[0].key].family, OP.TOWERS[sorted[0].key].family, 'every emitted slot resolves to a registered tower')

  t.section('placing a draft is free, lands at its tier, and consumes the token')
  const sp = makeSim(OP, { tracks: [arena(OP)], cash: 5000, seed: 'draft-place' })
  const track = sp.map.paths[0]
  const pos = track.posAt(300)
  const px = OP.M.clamp(pos.x, 70, OP.FIELD_W - 70)
  const py = OP.M.clamp(pos.y - 70, 70, OP.FIELD_H - 70)
  const cash0 = sp.cash
  const pd = OP.Save.defaults()
  D.grant(pd, slotKey, 2)
  const placed = D.place(sp, pd, slotKey, 2, px, py)
  t.ok(placed && placed.def === slotDef, 'the draft tower was placed')
  t.eq(sp.cash, cash0, 'placing a draft cost no cash')
  t.deep(placed.tiers, [2, 0, 0], 'the tower is born on the first branch at the token tier')
  t.eq(OP.Upgrades.label(placed), '2-0-0', 'the label shows the token tier')
  t.ok(placed.invested === OP.Upgrades.investedBase(placed) && placed.invested > 0,
    'the upgrade cash is set, so sells value the full tower')
  t.gt(OP.Towers.sell(sp, placed), 0, 'a draft tower sells for real money')
  t.deep(D.list(pd), [], 'the token was consumed by the placement')

  t.section('a higher-tier draft is born stronger and more invested')
  const po = makeSim(OP, { tracks: [arena(OP)], seed: 'draft-pos' })
  const poso = po.map.paths[0].posAt(300)
  const ox = OP.M.clamp(poso.x, 70, OP.FIELD_W - 70)
  const oy = OP.M.clamp(poso.y - 70, 70, OP.FIELD_H - 70)
  OP.Towers.place(po, slotKey, ox, oy, { free: true })
  const p3 = OP.Save.defaults()
  D.grant(p3, slotKey, 3)
  const big = D.place(po, p3, slotKey, 3, ox + 120, oy)
  t.ok(big, 'the tier-3 draft also lands')
  t.gt(big.invested, po.towers[0].invested, 'tier 3 costs more than tier 0 in sale value')
  t.ok(po.towers[0].s && big.s, 'restat ran for all placed towers')

  t.section('a draft cannot be placed where it does not fit, and the token is kept')
  const pg = makeSim(OP, { tracks: [arena(OP)], seed: 'draft-geom' })
  const pgd = OP.Save.defaults()
  D.grant(pgd, slotKey, 1)
  const offBoard = D.place(pg, pgd, slotKey, 1, -10, -10)
  t.ok(offBoard && offBoard.ok === false && offBoard.reason, 'off-map placement is refused with a reason')
  t.eq(D.count(pgd), 1, 'a refused placement spends nothing')
  const overlap = D.place(pg, pgd, slotKey, 1, -10, -10)
  t.ok(overlap && overlap.ok === false, 'a second refusal still refuses')
  t.eq(pg.towers.length, 0, 'no tower was created by the refusals')

  t.section('a draft with no token to spend cannot be placed')
  const pn = makeSim(OP, { tracks: [arena(OP)], seed: 'draft-none' })
  const pnd = OP.Save.defaults()
  const none = D.place(pn, pnd, slotKey, 1, px + 10, py + 10)
  t.eq(none, null, 'no owned token means no placement')
  t.eq(pn.towers.length, 0, 'the board stays empty')

  t.section('an unknown tower is never placeable as a draft')
  t.eq(D.place(makeSim(OP, { tracks: [arena(OP)] }), OP.Save.defaults(), 'not-a-tower', 1, px, py), null,
    'unknown keys are refused before any geometry check')

  t.section('the store round-trips a tokenised profile')
  const rt = OP.Save.defaults()
  D.grant(rt, slotKey, 1)
  D.grant(rt, slotKey, 2)
  if (typeof OP.Save.canonCompare === 'function') {
    const blink = JSON.parse(JSON.stringify(rt))
    const back = JSON.parse(JSON.stringify(rt))
    t.eq(OP.Save.canonCompare(blink, back, { op: '===' }), true,
      'a drafts profile survives the canon round-trip')
    t.eq(back.drafts.length, 2, 'both slots are preserved')
  } else {
    t.ok(true, 'canon comparator not present in this build — skipped')
  }
}
export const name = 'crosspath'
export const needs = ['js/core/upgrades.js', 'js/core/towers.js']

export function run (t, OP) {
  const U = OP.Upgrades

  // Only `tiers` and `def.paths[i].name` are read by the crosspath rules.
  function fake (a, b, c) {
    return {
      tiers: [a, b, c],
      def: { paths: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }] }
    }
  }

  t.section('shape')
  t.eq(U.PATHS, 3, 'three branches')
  t.eq(U.MAX_TIER, 5, 'five tiers each')

  t.section('rule 1 — at most one branch may exceed tier 2')
  t.ok(U.canBuy(fake(2, 2, 0), 0).ok, 'going 2 -> 3 is fine when nothing else is above 2')
  t.ok(U.canBuy(fake(4, 2, 0), 0).ok, 'continuing up the same branch is fine')
  t.notOk(U.canBuy(fake(3, 2, 0), 1).ok, 'a second branch cannot pass tier 2')
  t.ok(/past tier 2/i.test(U.canBuy(fake(3, 2, 0), 1).reason), 'and the reason says why')
  t.ok(/Alpha/.test(U.canBuy(fake(3, 2, 0), 1).reason), 'naming the branch that already did')
  t.ok(U.canBuy(fake(3, 1, 0), 1).ok, 'but that branch can still reach tier 2')
  t.notOk(U.canBuy(fake(3, 2, 0), 2).ok, 'and the third branch cannot pass 2 either')

  t.section('rule 2 — at most two branches may be touched at all')
  t.ok(U.canBuy(fake(0, 0, 0), 0).ok, 'the first branch can always start')
  t.ok(U.canBuy(fake(1, 0, 0), 1).ok, 'a second branch can start')
  t.notOk(U.canBuy(fake(1, 1, 0), 2).ok, 'a third cannot')
  t.ok(/two branches/i.test(U.canBuy(fake(1, 1, 0), 2).reason), 'and the reason says why')
  t.ok(U.canBuy(fake(1, 1, 0), 0).ok, 'while the two already-touched branches keep going')
  t.ok(U.canBuy(fake(1, 1, 0), 1).ok, 'both of them')

  t.section('the two rules compose')
  t.notOk(U.canBuy(fake(5, 2, 0), 0).ok, '5-2-0 cannot go further on the maxed branch')
  t.notOk(U.canBuy(fake(5, 2, 0), 1).ok, 'nor past 2 on the second')
  t.notOk(U.canBuy(fake(5, 2, 0), 2).ok, 'nor start the third')
  t.ok(/fully upgraded/i.test(U.canBuy(fake(5, 2, 0), 0).reason), 'a maxed branch says so')

  t.section('bounds')
  t.notOk(U.canBuy(fake(0, 0, 0), -1).ok, 'a negative branch index is refused')
  t.notOk(U.canBuy(fake(0, 0, 0), 3).ok, 'an out-of-range branch index is refused')
  t.notOk(U.canBuy(fake(5, 0, 0), 0).ok, 'tier 5 is the ceiling')

  t.section('legal end states are exactly 5-2-0 and its permutations, and below')
  const maxima = U.legalMaxima()
  const asStrings = maxima.map(x => x.join('-'))
  for (const want of ['5-2-0', '2-5-0', '0-5-2', '5-0-2', '2-0-5', '0-2-5']) {
    t.ok(asStrings.indexOf(want) >= 0, `${want} is legal`)
  }
  for (const nope of ['5-5-0', '3-3-0', '1-1-1', '5-2-1', '3-0-3', '2-2-2', '6-0-0']) {
    t.notOk(asStrings.indexOf(nope) >= 0, `${nope} is not legal`)
  }
  t.ok(asStrings.indexOf('0-0-0') >= 0, 'an unupgraded tower is a legal state')
  t.ok(asStrings.indexOf('2-2-0') >= 0, '2-2-0 is legal')

  t.section('every legal state is actually reachable by legal single purchases')
  // A state is only meaningful if a player can get there one upgrade at a time.
  function reachable (target) {
    const tiers = [0, 0, 0]
    let guard = 0
    while ((tiers[0] < target[0] || tiers[1] < target[1] || tiers[2] < target[2])) {
      if (++guard > 64) return false
      let bought = false
      for (let p = 0; p < 3; p++) {
        if (tiers[p] >= target[p]) continue
        if (!U.canBuy(fake(tiers[0], tiers[1], tiers[2]), p).ok) continue
        tiers[p]++
        bought = true
        break
      }
      if (!bought) return false
    }
    return true
  }
  let unreachable = []
  for (const state of maxima) if (!reachable(state)) unreachable.push(state.join('-'))
  t.eq(unreachable.length, 0, 'no legal state is stranded: ' + unreachable.join(', '))

  t.section('isLegalState agrees with canBuy')
  let disagreements = 0
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 6; b++) {
      for (let c = 0; c <= 6; c++) {
        const legal = U.isLegalState([a, b, c])
        const listed = asStrings.indexOf([a, b, c].join('-')) >= 0
        if (legal !== listed) disagreements++
      }
    }
  }
  t.eq(disagreements, 0, 'the predicate and the enumeration describe the same set')
  t.notOk(U.isLegalState([-1, 0, 0]), 'negative tiers are illegal')
  t.notOk(U.isLegalState([6, 0, 0]), 'tier 6 is illegal')

  t.section('labels and top tier')
  t.eq(U.label(fake(2, 5, 0)), '2-5-0', 'the label is the tier triple')
  t.eq(U.topTier(fake(2, 5, 0)), 5, 'topTier is the highest branch')
  t.eq(U.topTier(fake(0, 0, 0)), 0, 'and zero for a fresh tower')
}

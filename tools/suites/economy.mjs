export const name = 'economy'
export const needs = ['js/core/economy.js', 'js/core/balloons.js']

import { makeSim, spawn, ticks, hit } from './_fixture.mjs'

export function run (t, OP) {
  const E = OP.Economy

  t.section('default rules cover every field the sim reads')
  const rules = E.defaultRules()
  for (const key of ['costMul', 'cashPerPopMul', 'roundBonusMul', 'startCash', 'startLives',
    'hpScale', 'speedScale', 'blimpHpMul', 'allowSell', 'allowIncome', 'allowContinue',
    'allowAbilities', 'allowPowers', 'livesRegain', 'families', 'firstRound', 'lastRound', 'sellRate']) {
    t.ok(rules[key] !== undefined, `rules.${key} has a default`)
  }

  t.section('earning')
  let sim = makeSim(OP, { cash: 0 })
  t.eq(E.earn(sim, 100, -1), 100, 'earn returns what it credited')
  t.eq(sim.cash, 100, 'cash went up')
  t.eq(sim.stats.cashEarned, 100, 'and was counted')
  t.eq(E.earn(sim, 0, -1), 0, 'earning nothing is a no-op')
  t.eq(E.earn(sim, -50, -1), 0, 'earning a negative amount is refused')
  t.eq(sim.cash, 100, 'so cash is unchanged')

  t.section('earnings are attributed to the earning tower')
  sim = makeSim(OP, { cash: 0 })
  const farm = { id: 5, earned: 0, pops: 0 }
  sim.towerById.set(5, farm)
  E.earn(sim, 240, 5)
  t.eq(farm.earned, 240, 'the tower is credited')

  t.section('spending')
  sim = makeSim(OP, { cash: 500 })
  t.ok(E.canAfford(sim, 500), 'exactly affordable counts as affordable')
  t.notOk(E.canAfford(sim, 501), 'one over does not')
  t.ok(E.spend(sim, 200), 'spending within budget succeeds')
  t.eq(sim.cash, 300, 'cash went down')
  t.eq(sim.stats.cashSpent, 200, 'and was counted')
  t.notOk(E.spend(sim, 400), 'overspending fails')
  t.eq(sim.cash, 300, 'and changes nothing — no negative balance')

  t.section('prices round up, so a shown price is never cheaper than the charge')
  sim = makeSim(OP, { cash: 10000, rules: { costMul: 1.08 } })
  t.eq(E.price(sim, 200), 216, '200 at 1.08 is 216')
  t.eq(E.price(sim, 215), 233, '215 at 1.08 rounds up from 232.2')
  sim = makeSim(OP, { cash: 10000, rules: { costMul: 0.85 } })
  t.eq(E.price(sim, 200), 170, '200 at 0.85 is 170')
  t.eq(E.price(sim, 201), 171, '201 at 0.85 rounds up from 170.85')

  t.section('sell value')
  sim = makeSim(OP, { cash: 0 })
  t.eq(E.sellValue(sim, { invested: 1000 }), Math.floor(1000 * OP.SELL_RATE), 'sell returns the standard fraction of everything invested')
  sim = makeSim(OP, { cash: 0, rules: { allowSell: false } })
  t.eq(E.sellValue(sim, { invested: 1000 }), 0, 'PURIST returns nothing, because selling is forbidden')

  t.section('losing lives')
  sim = makeSim(OP, { lives: 100 })
  E.loseLives(sim, 30)
  t.eq(sim.lives, 70, 'lives went down')
  t.eq(sim.stats.livesLost, 30, 'and were counted')
  t.notOk(sim.over, 'the game is still running')
  E.loseLives(sim, 0)
  t.eq(sim.lives, 70, 'losing zero is a no-op')

  t.section('running out of lives ends the game')
  sim = makeSim(OP, { lives: 20 })
  E.loseLives(sim, 50)
  t.eq(sim.lives, 0, 'lives clamp at zero rather than going negative')
  t.ok(sim.over, 'the game is over')
  t.eq(sim.outcome, 'leaked', 'and the reason is recorded')
  t.ok(sim.events.some(e => e.kind === 'gameover'), 'a gameover event was emitted')

  t.section('a finished game absorbs no further damage')
  const livesAfter = sim.lives
  E.loseLives(sim, 999)
  t.eq(sim.lives, livesAfter, 'further leaks do not keep subtracting')

  t.section('one life on Relentless means one leak ends it')
  sim = makeSim(OP, { lives: 1 })
  E.loseLives(sim, 1)
  t.ok(sim.over, 'a single red balloon ends a one-life run')

  t.section('regaining lives, and PURIST forbidding it')
  sim = makeSim(OP, { lives: 50 })
  t.eq(E.gainLives(sim, 10), 10, 'lives can be regained normally')
  t.eq(sim.lives, 60, 'and they are')
  sim = makeSim(OP, { lives: 50, rules: { livesRegain: false } })
  t.eq(E.gainLives(sim, 10), 0, 'PURIST refuses')
  t.eq(sim.lives, 50, 'so lives are unchanged')

  t.section('round bonus grows with the round')
  sim = makeSim(OP, { cash: 0 })
  const early = E.roundBonus(sim, 1)
  const late = E.roundBonus(sim, 80)
  t.gt(late, early, 'a later round pays more')
  t.gte(early, OP.ROUND_END_BONUS, 'round 1 pays at least the base')

  sim = makeSim(OP, { cash: 0, rules: { roundBonusMul: 0.5 } })
  t.eq(E.roundBonus(sim, 10), Math.floor(E.roundBonus(makeSim(OP, { cash: 0 }), 10) * 0.5),
    'Half Cash halves the payout')

  t.section('paying the round bonus')
  sim = makeSim(OP, { cash: 0 })
  sim.roundIndex = 12
  const paid = E.payRoundBonus(sim)
  t.eq(sim.cash, paid, 'the bonus landed in the bank')
  const ev = sim.events.find(e => e.kind === 'roundbonus')
  t.ok(ev, 'and emitted an event')
  t.eq(ev.round, 12, 'naming the round')

  t.section('cash per pop honours the difficulty multiplier')
  sim = makeSim(OP, { cash: 0 })
  sim.cashPerPopMul = 1
  hit(OP, sim, spawn(OP, sim, 'pink'), 5)
  const full = sim.cash
  sim = makeSim(OP, { cash: 0 })
  sim.cashPerPopMul = 0.5
  hit(OP, sim, spawn(OP, sim, 'pink'), 5)
  t.eq(sim.cash, full * 0.5, 'half cash gives half the pop income')

  t.section('family restrictions — modes are config, not code paths')
  sim = makeSim(OP, {})
  t.ok(E.familyAllowed(sim, 'primary'), 'everything is allowed by default')
  t.ok(E.familyAllowed(sim, 'magic'), 'including magic')

  sim = makeSim(OP, { rules: { families: ['primary'] } })
  t.ok(E.familyAllowed(sim, 'primary'), 'Primary Only allows primary')
  t.notOk(E.familyAllowed(sim, 'military'), 'and forbids military')
  t.notOk(E.familyAllowed(sim, 'magic'), 'and magic')
  t.notOk(E.familyAllowed(sim, 'support'), 'and support')

  sim = makeSim(OP, { rules: { families: ['magic', 'support'] } })
  t.ok(E.familyAllowed(sim, 'magic'), 'a multi-family restriction works')
  t.ok(E.familyAllowed(sim, 'support'), 'for both listed families')
  t.notOk(E.familyAllowed(sim, 'primary'), 'and excludes the rest')

  t.section('income towers under PURIST')
  const farmDef = { key: 'berry-warren', family: 'support', income: true }
  const gunDef = { key: 'acorn-fox', family: 'primary' }
  sim = makeSim(OP, {})
  t.ok(E.towerAllowed(sim, farmDef), 'an income tower is fine normally')
  sim = makeSim(OP, { rules: { allowIncome: false } })
  t.notOk(E.towerAllowed(sim, farmDef), 'PURIST forbids income towers')
  t.ok(E.towerAllowed(sim, gunDef), 'but not ordinary towers')

  t.section('a restricted family and a forbidden income both block placement')
  sim = makeSim(OP, { rules: { families: ['primary'], allowIncome: false } })
  t.notOk(E.towerAllowed(sim, farmDef), 'a support income tower is doubly blocked')
  t.ok(E.towerAllowed(sim, gunDef), 'and a primary tower still allowed')

  t.section('leaks charge lives end-to-end')
  sim = makeSim(OP, { trackLength: 60, lives: 200 })
  spawn(OP, sim, 'ceramic', 55)
  ticks(OP, sim, 30)
  t.eq(sim.lives, 200 - 104, 'a leaked ceramic costs its full RBE in lives')
  t.eq(sim.stats.leaked, 104, 'and the leak was counted')

  t.section('a leak that exceeds remaining lives just ends the game')
  sim = makeSim(OP, { trackLength: 60, lives: 10 })
  spawn(OP, sim, 'ceramic', 55)
  ticks(OP, sim, 30)
  t.eq(sim.lives, 0, 'lives bottom out at zero')
  t.ok(sim.over, 'and the run is over')
}

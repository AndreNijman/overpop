// Tower XP — the BTD6-style progression that gates upgrades behind usage.
//
// Pops fill a general per-round pool (scaled by a round ladder at every 10
// rounds; freeplay pays a flat 5%). When the round completes, the pool is
// shared out to every living tower by a 50/50 blend — half by how much money is
// invested in it (placement + upgrades), half by how many layers it popped this
// round. Money never buys XP: once a tier is unlocked, purchasing it is a cash
// purchase, not a progression.

export const name = 'towerxp'
export const needs = [
  'js/core/upgrades.js', 'js/core/towerxp.js', 'js/core/towers.js',
  'js/core/damage.js', 'js/core/economy.js', 'js/save.js'
]

import { makeSim, spawn, hit } from './_fixture.mjs'

export function run (t, OP, env) {
  const X = OP.TowerXp

  t.section('tower XP module exists')
  t.ok(X, 'OP.TowerXp is defined')
  t.ok(Array.isArray(X.TIER_XP), 'a tier ladder exists')
  t.eq(X.TIER_XP.length, 6, 'one entry per tier 0-5')

  t.section('tier requirement ladder')
  t.eq(X.tierRequired(0), 0, 'base tower needs no XP')
  t.eq(X.tierRequired(1), 150, 'tier 1 needs 150 XP')
  t.eq(X.tierRequired(2), 450, 'tier 2 needs 450 XP')
  t.eq(X.tierRequired(3), 1500, 'tier 3 needs 1500 XP')
  t.eq(X.tierRequired(4), 6000, 'tier 4 needs 6000 XP')
  t.eq(X.tierRequired(5), 25000, 'tier 5 needs 25000 XP')
  t.eq(X.tierRequired(6), Infinity, 'anything past tier 5 is meaningless')
  for (let i = 1; i < X.TIER_XP.length; i++) {
    t.gt(X.TIER_XP[i], X.TIER_XP[i - 1], 'the ladder is strictly increasing at tier ' + i)
  }

  t.section('one branch\'s unlock costs the marginal step of the ladder')
  t.eq(X.unlockCost(0), Infinity, 'there is no tier 0 to unlock')
  t.eq(X.unlockCost(1), 150, 'tier 1 costs 150')
  t.eq(X.unlockCost(2), 300, 'tier 2 is the step from 150 to 450')
  t.eq(X.unlockCost(3), 1050, 'tier 3 is the step from 450 to 1500')
  t.eq(X.unlockCost(4), 4500, 'tier 4 is the step from 1500 to 6000')
  t.eq(X.unlockCost(5), 19000, 'tier 5 is the step from 6000 to 25000')
  t.eq(X.unlockCost(6), Infinity, 'past tier 5 there is nothing to unlock')

  t.section('round multiplier')
  t.eq(X.roundMultiplier(0), 1, 'round 0 is 1x')
  t.eq(X.roundMultiplier(1), 1, 'the first ten rounds are 1x')
  t.eq(X.roundMultiplier(9), 1, 'round 9 is still 1x')
  t.eq(X.roundMultiplier(10), 2, 'round 10 doubles the earn')
  t.eq(X.roundMultiplier(19), 2, 'round 19 is still 2x')
  t.eq(X.roundMultiplier(20), 3, 'round 20 triples it')
  t.eq(X.roundMultiplier(60), 7, 'round 60 earns 7x')
  t.eq(X.roundMultiplier(-5), 1, 'negative round clamps to 1x')
  t.eq(X.roundMultiplier(NaN), 1, 'junk round clamps to 1x')
  t.eq(X.roundMultiplier(undefined), 1, 'missing round clamps to 1x')

  t.section('freeplay multiplier')
  t.eq(X.freeplayMultiplier(null), 1, 'null sim is full rate')
  t.eq(X.freeplayMultiplier({}), 1, 'a sim that is not freeplay is full rate')
  t.eq(X.freeplayMultiplier({ freeplay: false }), 1, 'explicitly not freeplay is full rate')
  t.eq(X.freeplayMultiplier({ freeplay: true }), 0.05, 'freeplay pays the flat 5%')

  t.section('pops fill a general round pool')
  const sim = makeSim(OP, { cash: 5000 })
  const tw = OP.Towers.place(sim, 'acorn-fox', 100, 360, { free: true })
  t.ok(tw, 'a acorn-fox tower can be placed')
  tw.invested = 100
  t.eq(tw.runXp, 0, 'placement itself grants no XP')
  t.eq(sim.roundXpPool, undefined, 'and the round pool starts empty')
  const b = spawn(OP, sim, 0, 0, 0)
  const res = hit(OP, sim, b, 20, OP.DMG.NORMAL, { sourceId: tw.id })
  t.ok(res.destroyed, 'the red balloon pops')
  t.close(sim.roundXpPool, 1, 1e-9, 'one red layer at round 0 adds 1 XP to the pool')
  t.eq(tw.runXp, 0, 'but the tower is not credited until the pool settles')
  X.settle(sim)
  t.close(tw.runXp, 1, 1e-9, 'settling pays the sole tower the whole pool')
  t.eq(sim.roundXpPool, 0, 'and empties the pool')

  t.section('the round ladder scales pop XP in-run')
  const simR = makeSim(OP, { cash: 5000 })
  const twR = OP.Towers.place(simR, 'acorn-fox', 100, 360, { free: true })
  twR.invested = 100
  simR.roundIndex = 25
  const br = spawn(OP, simR, 0, 0, 0)
  hit(OP, simR, br, 20, OP.DMG.NORMAL, { sourceId: twR.id })
  t.close(simR.roundXpPool, 3, 1e-9, 'a round-25 pop adds 1 + floor(25/10) per layer')
  X.settle(simR)
  t.close(twR.runXp, 3, 1e-9, 'and the settle pays it out')
  const before = twR.runXp
  simR.roundIndex = 9
  const br9 = spawn(OP, simR, 0, 0, 0)
  hit(OP, simR, br9, 20, OP.DMG.NORMAL, { sourceId: twR.id })
  t.close(simR.roundXpPool, 1, 1e-9, 'the multiplier recomputes per pop, per round')
  X.settle(simR)
  t.close(twR.runXp - before, 1, 1e-9, 'and each round settles into the tower')

  t.section('freeplay pays 5% for the same pop')
  const simF = makeSim(OP, { cash: 5000 })
  simF.freeplay = true
  const twF = OP.Towers.place(simF, 'acorn-fox', 100, 360, { free: true })
  twF.invested = 100
  const bf = spawn(OP, simF, 0, 0, 0)
  hit(OP, simF, bf, 20, OP.DMG.NORMAL, { sourceId: twF.id })
  t.close(simF.roundXpPool, 0.05, 1e-9, 'a freeplay pop adds 5% of the normal amount')
  X.settle(simF)
  t.close(twF.runXp, 0.05, 1e-9, 'and the paid pool matches')

t.section('pool splits 50/50 between spending and popping')
  const simP = makeSim(OP, { cash: 5000 })
  const twPa = OP.Towers.place(simP, 'acorn-fox', 100, 360, { free: true })
  twPa.invested = 300
  const twPb = OP.Towers.place(simP, 'rune-weasel', 300, 360, { free: true })
  twPb.invested = 100
  const bp = spawn(OP, simP, 0, 0, 0)
  hit(OP, simP, bp, 20, OP.DMG.NORMAL, { sourceId: twPa.id })
  t.close(simP.roundXpPool, 1, 1e-9, 'the pop fills the pool')
  X.settle(simP)
  t.close(twPa.runXp, 0.875, 1e-9, 'the popper ALSO biggest spender earns 0.5 pops + 0.375 spend = 0.875')
  t.close(twPb.runXp, 0.125, 1e-9, 'the idle $100 tower earns only 0.125 from the spend half')
  t.close(twPa.runXp + twPb.runXp, 1, 1e-9, 'and the paid shares sum to the pool')

  t.section('a cheap workhorse out-earns an idle money-sink')
  const simHW = makeSim(OP, { cash: 5000 })
  const twCheap = OP.Towers.place(simHW, 'acorn-fox', 100, 360, { free: true })
  twCheap.invested = 50
  const twSink = OP.Towers.place(simHW, 'rune-weasel', 300, 360, { free: true })
  twSink.invested = 1000
  const bHW = spawn(OP, simHW, 0, 0, 0)
  hit(OP, simHW, bHW, 20, OP.DMG.NORMAL, { sourceId: twCheap.id })
  X.settle(simHW)
  t.close(twCheap.runXp, 0.52381, 1e-4, 'cheap popper: 0.5 pops + 0.5*(50/1050) spend')
  t.close(twSink.runXp, 0.47619, 1e-4, 'idle sink: 0.5*(1000/1050) spend')
  t.ok(twCheap.runXp > twSink.runXp, 'and the popper wins despite spending 20x less')

  t.section('free placements earn from pops, nothing from spend')
  const simP2 = makeSim(OP, { cash: 5000 })
  const twPc = OP.Towers.place(simP2, 'acorn-fox', 100, 360, { free: true })
  twPc.invested = 0
  const twPd = OP.Towers.place(simP2, 'rune-weasel', 300, 360, { free: true })
  twPd.invested = 50
  const bp2 = spawn(OP, simP2, 0, 0, 0)
  hit(OP, simP2, bp2, 20, OP.DMG.NORMAL, { sourceId: twPd.id })
  X.settle(simP2)
  t.eq(twPc.runXp, 0, 'a free tower that pops nothing earns nothing')
  t.close(twPd.runXp, 1, 1e-9, 'the sole pops+spend tower takes the pool')
  const simP3 = makeSim(OP, { cash: 5000 })
  const twPe = OP.Towers.place(simP3, 'acorn-fox', 100, 360, { free: true })
  twPe.invested = 100
  const bp3 = spawn(OP, simP3, 0, 0, 0)
  hit(OP, simP3, bp3, 20, OP.DMG.NORMAL, { sourceId: twPe.id })
  X.settle(simP3)
  X.settle(simP3)
  t.close(twPe.runXp, 1, 1e-9, 'a second settle with an empty pool changes nothing')
  t.eq(twPe.roundPops, 0, 'and round pops are reset after settling')

  t.section('money never buys XP')
  const simC = makeSim(OP, { cash: 99999 })
  simC.towerXp = { 'acorn-fox': 100000 }
  const twC = OP.Towers.place(simC, 'acorn-fox', 100, 360, { free: true })
  t.eq(twC.runXp, 0, 'no XP yet')
  X.unlockCell(null, simC, 'acorn-fox', 0, 1)
  const buyResult = OP.Upgrades.buy(simC, twC, 0)
  t.ok(buyResult.ok, 'an affordable, unlocked upgrade buys')
  t.eq(twC.runXp, 0, 'the purchase grants no XP - only popping earns XP')

  t.section('money never buys XP in freeplay either')
  const simFC = makeSim(OP, { cash: 99999 })
  simFC.freeplay = true
  simFC.towerXp = { 'acorn-fox': 100000 }
  const twFC = OP.Towers.place(simFC, 'acorn-fox', 100, 360, { free: true })
  X.unlockCell(null, simFC, 'acorn-fox', 0, 1)
  const buyFC = OP.Upgrades.buy(simFC, twFC, 0)
  t.ok(buyFC.ok, 'the buy succeeds')
  t.eq(twFC.runXp, 0, 'and still grants no XP, freeplay or not')

  t.section('heroes earn no tower XP')
  const simH = makeSim(OP, { cash: 5000 })
  const fakeHero = { key: 'quincy', heroKey: 'quincy', runXp: 0 }
  t.eq(X.gainPops(simH, fakeHero, 50), 0, 'popping as a hero grants nothing')
  t.ok(!fakeHero.runXp, 'and leaves the hero untouched')
  t.notOk(X.gainCash, 'the old money-for-XP earner is gone')
  t.eq(X.gainPops(simH, null, 50), 0, 'and a null tower is a safe no-op')
  t.eq(X.gainPops(simH, undefined, 50), 0, 'an undefined tower is a safe no-op')

  t.section('available money = banked + this run, per tower type')
  const simA = makeSim(OP, { cash: 5000 })
  simA.towerXp = { 'acorn-fox': 300 }
  const twA = OP.Towers.place(simA, 'acorn-fox', 100, 360, { free: true })
  twA.runXp = 25
  t.eq(X.baseOf(simA, 'acorn-fox'), 300, 'the banked half reads back')
  t.eq(X.available(simA, 'acorn-fox'), 325, 'and sums with the live half')
  t.eq(X.available(simA, 'rune-weasel'), 0, 'an unpaid tower type has nothing')
  t.eq(X.baseOf(simA, 'missing-key'), 0, 'an unknown key banks nothing')
  const manual = { key: 'acorn-fox', runXp: 8 }
  simA.towers.push(manual)
  simA.towerById.set(999, manual)
  t.eq(X.available(simA, 'acorn-fox'), 333, 'an unregistered live tower counts too')
  simA.towers.pop()
  t.eq(X.available(simA, 'acorn-fox'), 325, 'and stops counting once sold')

  t.section('a raw sim with no bank is unenforced')
  const simRw = makeSim(OP, { cash: 5000 })
  t.eq(X.baseOf(simRw, 'acorn-fox'), 0, 'no bank reads as zero')
  t.eq(X.unlockArray(simRw, 'acorn-fox')[0], 0, 'no unlock map reads all-zero')
  t.eq(X.canUnlock(simRw, 'acorn-fox', 0, 1).ok, true, 'branch 1 tier 1 is unlocked regardless')
  t.eq(X.canUnlock(simRw, 'acorn-fox', 2, 5).ok, true, 'even branch 3 tier 5 is unlocked regardless')
  t.eq(X.canUnlock(simRw, 'acorn-fox', 2, 5).req, 19000, 'the ladder still reports its marginal cost')
  const twRw = OP.Towers.place(simRw, 'acorn-fox', 100, 360, { free: true })
  twRw.runXp = 7
  t.eq(X.available(simRw, 'acorn-fox'), 7, 'the run half still counts on a raw sim')

  t.section('upgrades are gated by the specific unlocked cell, not a tier')
  const simG = makeSim(OP, { cash: 99999 })
  simG.towerXp = {}
  const twG = OP.Towers.place(simG, 'acorn-fox', 100, 360, { free: true })
  let denied = OP.Upgrades.buy(simG, twG, 0)
  t.notOk(denied.ok, 'an upgrade with an empty progression is refused')
  t.ok(/locked/i.test(denied.reason), 'and the refusal names the locked branch')
  t.eq(twG.tiers[0], 0, 'no tier was granted')

  simG.towerXp = { 'acorn-fox': 150 }
  denied = OP.Upgrades.buy(simG, twG, 0)
  t.notOk(denied.ok, 'banked XP alone no longer unlocks — the cell must be bought')
  t.eq(twG.tiers[0], 0, 'and the tier is still not granted')

  const spent = X.unlockCell(null, simG, 'acorn-fox', 0, 1)
  t.ok(spent.ok, 'the specific cell unlocks at exactly 150 XP')
  t.eq(spent.cost, 150, 'and reports the marginal cost')
  t.eq(simG.towerXp['acorn-fox'], 0, 'the unlock SPENT the banked XP')
  t.eq(X.pathUnlocked(simG, 'acorn-fox', 0), 1, 'branch 1 now holds tier 1')
  t.eq(X.pathUnlocked(simG, 'acorn-fox', 1), 0, 'branch 2 gained nothing')
  const exact = OP.Upgrades.buy(simG, twG, 0)
  t.ok(exact.ok, 'the now-unlocked upgrade buys')
  t.eq(twG.tiers[0], 1, 'the tier was granted')
  t.eq(twG.runXp, 0, 'and the cash purchase spends no XP')
  const branch1 = OP.Upgrades.buy(simG, twG, 1)
  t.notOk(branch1.ok, 'the sibling branch is still locked by XP')

  t.section('the gate counts this run as well as the bank')
  const simL = makeSim(OP, { cash: 99999 })
  simL.towerXp = { 'acorn-fox': 60 }
  const twL = OP.Towers.place(simL, 'acorn-fox', 100, 360, { free: true })
  twL.runXp = 90
  t.eq(X.available(simL, 'acorn-fox'), 150, '60 banked + 90 this run')
  const spentLive = X.unlockCell(null, simL, 'acorn-fox', 0, 1)
  t.ok(spentLive.ok, 'the live balance unlocks the tier')
  t.eq(simL.towerXp['acorn-fox'], 0, 'the banked half was spent first')
  t.close(twL.runXp, 0, 1e-9, 'then the run half covered the rest')
  const liveBuy = OP.Upgrades.buy(simL, twL, 0)
  t.ok(liveBuy.ok, 'and the now-unlocked upgrade buys')

  t.section('an unlock opens one specific upgrade, not a whole tier')
  const profC = OP.Save.defaults()
  profC.towerXp = { 'acorn-fox': 1000 }
  const r1 = X.unlockCell(profC, null, 'acorn-fox', 0, 1)
  t.ok(r1.ok, 'branch 1 tier 1 unlocks')
  t.eq(X.profileXp(profC, 'acorn-fox'), 850, 'and spends 150 of the 1000')
  const r2 = X.unlockCell(profC, null, 'acorn-fox', 2, 1)
  t.ok(r2.ok, 'branch 3 tier 1 unlocks independently')
  t.eq(X.profileXp(profC, 'acorn-fox'), 700, 'another 150 gone')
  const skip = X.unlockCell(profC, null, 'acorn-fox', 1, 2)
  t.notOk(skip.ok, 'branch 2 tier 2 cannot skip tier 1')
  t.eq(X.profileXp(profC, 'acorn-fox'), 700, 'and a refused unlock spends nothing')
  const deep = X.unlockCell(profC, null, 'acorn-fox', 0, 2)
  t.ok(deep.ok, 'branch 1 tier 2 unlocks on top of tier 1')
  t.eq(deep.cost, 300, 'the marginal step costs 300')
  t.eq(X.profileXp(profC, 'acorn-fox'), 400, '400 left after 450 + 150')
  const poor = X.unlockCell(profC, null, 'acorn-fox', 0, 3)
  t.notOk(poor.ok, 'tier 3 at 1050 is out of reach with 400')
  t.deep(X.unlockArray(profC, 'acorn-fox'), [2, 0, 1], 'the three branches are independent')
  t.eq(X.pathUnlocked(profC, 'acorn-fox', 0), 2, 'branch 1 reads back tier 2')
  t.eq(X.pathUnlocked(profC, 'acorn-fox', 1), 0, 'branch 2 never unlocked')
  t.eq(X.pathUnlocked(profC, 'acorn-fox', 2), 1, 'branch 3 holds tier 1')
  t.eq(X.tierUnlocked(profC, 'acorn-fox', 2), true, 'the tier-wide headline sees branch 1')
  t.eq(X.tierUnlocked(profC, 'acorn-fox', 3), false, 'but tier 3 is still nowhere open')

  // A run started off that profile sees exactly the cells the profile bought.
  const simX = makeSim(OP, { cash: 99999 })
  simX.towerXp = Object.assign({}, profC.towerXp)
  simX.towerUnlocks = X.simUnlocks(profC)
  const twX = OP.Towers.place(simX, 'acorn-fox', 100, 360, { free: true })
  t.ok(OP.Upgrades.buy(simX, twX, 0).ok, 'an unlocked branch buys')
  t.notOk(OP.Upgrades.buy(simX, twX, 1).ok, 'a locked branch refuses')

  t.section('banking floors run XP into the profile at game over')
  const prof = { towerXp: {} }
  const simB = makeSim(OP, { cash: 5000 })
  const twB = OP.Towers.place(simB, 'acorn-fox', 100, 360, { free: true })
  twB.runXp = 44.6
  X.bank(prof, simB)
  t.eq(prof.towerXp['acorn-fox'], 44, 'the float is floored into banked XP')
  twB.runXp = 5.9
  X.bank(prof, simB)
  t.eq(prof.towerXp['acorn-fox'], 49, 'repeat game overs accumulate')
  t.eq(prof.towerXp.ninja, undefined, 'an absent tower type writes nothing')

  t.section('banking ignores heroes and absent towers')
  const profH = { towerXp: {} }
  const simBH = makeSim(OP, { cash: 5000 })
  simBH.towers.push({ key: 'quincy', heroKey: 'quincy', runXp: 400 }, { key: 'acorn-fox', runXp: 0 })
  X.bank(profH, simBH)
  t.deep(profH.towerXp, {}, 'nothing to bank, nothing written')
  X.bank(null, simBH)
  t.ok(true, 'a null profile is a safe no-op')

  t.section('banking carries the run into the profile, XP and unlocks')
  const profU = { towerXp: {}, towerUnlocks: {} }
  const simU = makeSim(OP, { cash: 5000 })
  const twU = OP.Towers.place(simU, 'acorn-fox', 100, 360, { free: true })
  twU.runXp = 44.6
  simU.towerUnlocks = { 'acorn-fox': [3, 0, 0] }
  X.bank(profU, simU)
  t.eq(profU.towerXp['acorn-fox'], 44, 'the float is floored into banked XP')
  t.deep(profU.towerUnlocks['acorn-fox'], [3, 0, 0], 'and the mid-run unlock survives')

  t.section('profile integration')
  t.ok(OP.Save, 'save module runs in this suite')
  const d = OP.Save.defaults()
  t.deep(d.towerXp, {}, 'defaults carry an empty towerXp map')
  t.deep(d.towerUnlocks, {}, 'defaults carry an empty towerUnlocks map')
  const roundTripped = OP.Save.migrate(JSON.parse(JSON.stringify(
    { schemaVersion: 10, stats: {}, towerXp: { 'acorn-fox': 500 } }
  )))
  t.eq(roundTripped.towerXp['acorn-fox'], 500, 'banked XP survives a save/load round trip')
  t.deep(roundTripped.towerUnlocks['acorn-fox'], [2, 2, 2],
    'a v10 save grand-fathers every branch to the tier-wide unlock it had')
  const junk = OP.Save.migrate({ schemaVersion: 8, towerXp: { toString: 2, 'acorn-fox': 1, junk: -1 } })
  t.eq(junk.towerXp['acorn-fox'], 1, 'a positive key survives')
  t.eq(junk.towerXp.junk, undefined, 'a negative value is dropped')
  t.notOk(Object.prototype.hasOwnProperty.call(junk.towerXp, 'constructor'),
    'no inherited key becomes an own key')
  const junkU = OP.Save.migrate({
    schemaVersion: 11, towerXp: { 'acorn-fox': 1 },
    towerUnlocks: { toString: 2, 'acorn-fox': [1, -5, 9], junk: 'x' }
  })
  t.deep(junkU.towerUnlocks['acorn-fox'], [1, 0, 5], 'unlock tiers clamp to the shipped tree')
  t.notOk(Object.prototype.hasOwnProperty.call(junkU.towerUnlocks, 'constructor'),
    'no inherited key becomes an own unlock key')
  const v7 = OP.Save.migrate({ schemaVersion: 7, stats: { gamesPlayed: 3 } })
  t.deep(v7.towerXp, {}, 'a v7 profile gains an empty towerXp map')
  t.deep(v7.towerUnlocks, {}, 'and an empty towerUnlocks map')
  t.eq(v7.schemaVersion, OP.Save.SCHEMA_VERSION, 'and is stamped current')
}
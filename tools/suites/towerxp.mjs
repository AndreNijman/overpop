// Tower XP — the BTD6-style progression that gates upgrades behind usage.
//
// XP is earned by using a tower: one point per popped layer (scaled by a round
// ladder at every 10 rounds) plus one point per $1 spent on its upgrades. The
// banked balance lives in the profile; each run's living towers add their
// run-earned XP on top; freeplay pays a flat 5%.

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

  t.section('pop XP accrues on living towers')
  const sim = makeSim(OP, { cash: 5000 })
  const tw = OP.Towers.place(sim, 'acorn-fox', 100, 360, { free: true })
  t.ok(tw, 'a acorn-fox tower can be placed')
  t.eq(tw.runXp, 0, 'placement itself grants no XP')
  const b = spawn(OP, sim, 0, 0, 0)
  const res = hit(OP, sim, b, 20, OP.DMG.NORMAL, { sourceId: tw.id })
  t.ok(res.destroyed, 'the red balloon pops')
  t.close(tw.runXp, 1, 1e-9, 'one red layer at round 0 earns 1 XP')

  t.section('the round ladder scales pop XP in-run')
  const simR = makeSim(OP, { cash: 5000 })
  const twR = OP.Towers.place(simR, 'acorn-fox', 100, 360, { free: true })
  simR.roundIndex = 25
  const br = spawn(OP, simR, 0, 0, 0)
  hit(OP, simR, br, 20, OP.DMG.NORMAL, { sourceId: twR.id })
  t.close(twR.runXp, 3, 1e-9, 'a round-25 pop earns 1 + floor(25/10) per layer')
  const before = twR.runXp
  simR.roundIndex = 9
  const br9 = spawn(OP, simR, 0, 0, 0)
  hit(OP, simR, br9, 20, OP.DMG.NORMAL, { sourceId: twR.id })
  t.close(twR.runXp - before, 1, 1e-9, 'the multiplier recomputes per pop, per round')

  t.section('freeplay pays 5% for the same pop')
  const simF = makeSim(OP, { cash: 5000 })
  simF.freeplay = true
  const twF = OP.Towers.place(simF, 'acorn-fox', 100, 360, { free: true })
  const bf = spawn(OP, simF, 0, 0, 0)
  hit(OP, simF, bf, 20, OP.DMG.NORMAL, { sourceId: twF.id })
  t.close(twF.runXp, 0.05, 1e-9, 'a freeplay pop earns 5% of the normal amount')

  t.section('cash XP: 1 per $1 spent on upgrades')
  const simC = makeSim(OP, { cash: 99999 })
  simC.towerXp = { 'acorn-fox': 100000 }
  const twC = OP.Towers.place(simC, 'acorn-fox', 100, 360, { free: true })
  t.eq(twC.runXp, 0, 'no XP yet')
  const buyResult = OP.Upgrades.buy(simC, twC, 0)
  t.ok(buyResult.ok, 'an affordable, XP-clear upgrade buys')
  t.close(twC.runXp, buyResult.cost, 1e-6, 'the purchase earns exactly its paid cost in XP')

  t.section('cash XP in freeplay is quartered to 5%')
  const simFC = makeSim(OP, { cash: 99999 })
  simFC.freeplay = true
  simFC.towerXp = { 'acorn-fox': 100000 }
  const twFC = OP.Towers.place(simFC, 'acorn-fox', 100, 360, { free: true })
  const buyFC = OP.Upgrades.buy(simFC, twFC, 0)
  t.ok(buyFC.ok, 'the buy succeeds')
  t.close(twFC.runXp, buyFC.cost * 0.05, 1e-6, 'freeplay upgrade XP is 5% of the spend')

  t.section('heroes earn no tower XP')
  const simH = makeSim(OP, { cash: 5000 })
  const fakeHero = { key: 'quincy', heroKey: 'quincy', runXp: 0 }
  t.eq(X.gainPops(simH, fakeHero, 50), 0, 'popping as a hero grants nothing')
  t.ok(!fakeHero.runXp, 'and leaves the hero untouched')
  t.eq(X.gainCash(simH, fakeHero, 123), 0, 'hero upgrades grant nothing either')
  t.eq(X.gainPops(simH, null, 50), 0, 'and a null tower is a safe no-op')
  t.eq(X.gainPops(simH, undefined, 50), 0, 'an undefined tower is a safe no-op')

  t.section('available money = banked + this run, per tower type')
  const simA = makeSim(OP, { cash: 5000 })
  simA.towerXp = { 'acorn-fox': 300 }
  const twA = OP.Towers.place(simA, 'acorn-fox', 100, 360, { free: true })
  twA.runXp = 25
  t.eq(X.baseOf(simA, 'acorn-fox'), 300, 'the banked half reads back')
  t.eq(X.available(simA, 'acorn-fox'), 325, 'and sums with the live half')
  t.eq(X.available(simA, 'ninja'), 0, 'an unpaid tower type has nothing')
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
  t.eq(X.canUnlock(simRw, 'acorn-fox', 1).ok, true, 'tier 1 is unlocked regardless')
  t.eq(X.canUnlock(simRw, 'acorn-fox', 5).ok, true, 'even tier 5 is unlocked regardless')
  t.eq(X.canUnlock(simRw, 'acorn-fox', 5).req, 25000, 'the ladder still reports its requirement')
  const twRw = OP.Towers.place(simRw, 'acorn-fox', 100, 360, { free: true })
  twRw.runXp = 7
  t.eq(X.available(simRw, 'acorn-fox'), 7, 'the run half still counts on a raw sim')

  t.section('upgrades are gated banked + run XP')
  const simG = makeSim(OP, { cash: 99999 })
  simG.towerXp = {}
  const twG = OP.Towers.place(simG, 'acorn-fox', 100, 360, { free: true })
  const denied = OP.Upgrades.buy(simG, twG, 0)
  t.notOk(denied.ok, 'an upgrade with 0 banked XP is refused')
  t.ok(/XP/.test(denied.reason), 'and the refusal names the XP shortfall')
  t.eq(twG.tiers[0], 0, 'no tier was granted')
  t.eq(twG.runXp, 0, 'and no XP was spent in the process')

  simG.towerXp = { 'acorn-fox': 150 }
  const exactly = OP.Upgrades.buy(simG, twG, 0)
  t.ok(exactly.ok, 'at exactly 150 XP the purchase goes through')
  t.eq(twG.tiers[0], 1, 'the tier was granted')
  t.close(twG.runXp, exactly.cost, 1e-6, 'and the spent cash starts repaying itself as XP')

  t.section('the gate counts this run as well as the bank')
  const simL = makeSim(OP, { cash: 99999 })
  simL.towerXp = { 'acorn-fox': 60 }
  const twL = OP.Towers.place(simL, 'acorn-fox', 100, 360, { free: true })
  twL.runXp = 90
  t.eq(X.available(simL, 'acorn-fox'), 150, '60 banked + 90 this run')
  const liveBuy = OP.Upgrades.buy(simL, twL, 0)
  t.ok(liveBuy.ok, 'the combined balance unlocks the tier')

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

  t.section('profile integration')
  t.ok(OP.Save, 'save module runs in this suite')
  const d = OP.Save.defaults()
  t.deep(d.towerXp, {}, 'defaults carry an empty towerXp map')
  const roundTripped = OP.Save.migrate(JSON.parse(JSON.stringify(
    Object.assign(OP.Save.defaults(), { towerXp: { 'acorn-fox': 500 } })
  )))
  t.eq(roundTripped.towerXp['acorn-fox'], 500, 'banked XP survives a save/load round trip')
  const junk = OP.Save.migrate({ schemaVersion: 8, towerXp: { toString: 2, 'acorn-fox': 1, junk: -1 } })
  t.eq(junk.towerXp['acorn-fox'], 1, 'a positive key survives')
  t.eq(junk.towerXp.junk, undefined, 'a negative value is dropped')
  t.notOk(Object.prototype.hasOwnProperty.call(junk.towerXp, 'constructor'),
    'no inherited key becomes an own key')
  const v7 = OP.Save.migrate({ schemaVersion: 7, stats: { gamesPlayed: 3 } })
  t.deep(v7.towerXp, {}, 'a v7 profile gains an empty towerXp map')
  t.eq(v7.schemaVersion, OP.Save.SCHEMA_VERSION, 'and is stamped current')
}
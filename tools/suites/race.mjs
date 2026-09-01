// The race mode (Rush Trial): timer, forced autostart, best times, and profile
// integration. Rush Trial is a speed challenge where rounds auto-start
// immediately and the clear time is the score.

export const name = 'race'
export const needs = ['js/data/modes.js', 'js/core/race.js']

import { makeSim, straightTrack } from './_fixture.mjs'

export function run (t, OP, env) {
  const R = OP.Race
  const M = OP.MODES

  t.section('rush-trial mode exists')
  t.ok(M['rush-trial'], 'rush-trial is registered')
  t.eq(M['rush-trial'].key, 'rush-trial', 'carries its own key')
  t.ok(typeof M['rush-trial'].name === 'string' && M['rush-trial'].name.length > 0, 'has a name')
  t.ok(typeof M['rush-trial'].blurb === 'string' && M['rush-trial'].blurb.length >= 40, 'has a blurb')
  t.ok(OP.MODE_ORDER.indexOf('rush-trial') >= 0, 'appears in MODE_ORDER')

  t.section('race rules are valid')
  const rules = OP.Sim.resolveRules({ difficulty: 'medium', mode: 'rush-trial' })
  t.eq(rules.lastRound, 60, 'runs 60 rounds')
  t.eq(rules.startCash, 1000, 'starts with $1000')
  t.eq(rules.allowSell, true, 'selling is allowed')
  t.eq(rules.allowIncome, true, 'income is allowed')
  t.eq(rules.allowAbilities, true, 'abilities are allowed')

  t.section('Race.isActive')
  const sim = makeSim(OP, {
    trackLength: 2400,
    roundSet: { 1: { groups: [{ tier: 'red', count: 1, spacing: 0.3 }] } },
    mode: 'rush-trial'
  })
  t.ok(R.isActive(sim), 'true for rush-trial sim')
  t.notOk(R.isActive(makeSim(OP, { trackLength: 2400, roundSet: { 1: { groups: [{ tier: 'red', count: 1 }] } } })), 'false for standard sim')
  t.notOk(R.isActive(null), 'false for null')
  t.notOk(R.isActive({}), 'false for empty object')

  t.section('Race.applyForcedAutostart')
  sim.autostart = false
  R.applyForcedAutostart(sim)
  t.ok(sim.autostart, 'forces autostart on rush-trial')
  const normalSim = makeSim(OP, { trackLength: 2400, roundSet: { 1: { groups: [{ tier: 'red', count: 1 }] } } })
  normalSim.autostart = false
  R.applyForcedAutostart(normalSim)
  t.notOk(normalSim.autostart, 'does not change non-rush-trial sim')

  t.section('Race.elapsed')
  t.eq(R.elapsed(null), 0, 'null sim returns 0')
  t.eq(R.elapsed({}), 0, 'empty sim returns 0')
  sim.time = 45.5
  t.eq(R.elapsed(sim), 45.5, 'returns sim.time')

  t.section('Race.formatTime')
  t.eq(R.formatTime(0), '—', 'zero returns dash')
  t.eq(R.formatTime(-5), '—', 'negative returns dash')
  t.eq(R.formatTime(NaN), '—', 'NaN returns dash')
  t.eq(R.formatTime(65.43), '1:05.43', 'formats minutes and seconds')
  t.eq(R.formatTime(5.1), '0:05.10', 'pads single-digit seconds')
  t.eq(R.formatTime(125.99), '2:05.99', 'formats larger times')

  t.section('Race.record and bestFor')
  const profile = OP.Save.defaults()
  t.eq(R.bestFor(profile, 'fernway-hollow', 'medium'), null, 'no initial best')

  R.record(profile, 'fernway-hollow', 'medium', { won: true, time: 120.5, pops: 5000, cash: 8000 })
  const best = R.bestFor(profile, 'fernway-hollow', 'medium')
  t.ok(best, 'best is recorded')
  t.eq(best.won, true, 'won flag is set')
  t.eq(best.time, 120.5, 'time is stored')
  t.eq(best.pops, 5000, 'pops are stored')
  t.eq(best.cash, 8000, 'cash is stored')

  t.section('Race.record ratchets — faster time wins')
  R.record(profile, 'fernway-hollow', 'medium', { won: true, time: 150.0, pops: 6000, cash: 9000 })
  const best2 = R.bestFor(profile, 'fernway-hollow', 'medium')
  t.eq(best2.time, 120.5, 'slower time is rejected')
  R.record(profile, 'fernway-hollow', 'medium', { won: true, time: 100.0, pops: 4000, cash: 7000 })
  const best3 = R.bestFor(profile, 'fernway-hollow', 'medium')
  t.eq(best3.time, 100.0, 'faster time replaces old')

  t.section('Race.record — win replaces loss')
  R.record(profile, 'fernway-hollow', 'easy', { won: false, time: 80.0, pops: 2000, cash: 3000 })
  const lossBest = R.bestFor(profile, 'fernway-hollow', 'easy')
  t.eq(lossBest.won, false, 'loss is recorded')
  R.record(profile, 'fernway-hollow', 'easy', { won: true, time: 90.0, pops: 3000, cash: 4000 })
  const winBest = R.bestFor(profile, 'fernway-hollow', 'easy')
  t.eq(winBest.won, true, 'win replaces loss')
  t.eq(winBest.time, 90.0, 'with the win\'s time')

  t.section('Race.isDone')
  t.ok(R.isDone(profile, 'fernway-hollow', 'medium'), 'completed map/diff is done')
  t.notOk(R.isDone(profile, 'fernway-hollow', 'relentless'), 'unplayed is not done')

  t.section('Race.resultFromSim')
  const sim2 = { time: 95.3, stats: { popped: 1500, cashEarned: 4200 } }
  const fromSim = R.resultFromSim(sim2, true)
  t.eq(fromSim.won, true, 'win flag')
  t.eq(fromSim.time, 95.3, 'time extracted')
  t.eq(fromSim.pops, 1500, 'pops extracted')
  t.eq(fromSim.cash, 4200, 'cash extracted')

  t.section('Race.summary')
  const summary = R.summary(profile, 'fernway-hollow', 'medium')
  t.ok(summary.best, 'has best')
  t.ok(summary.done, 'is done')
  t.ok(summary.bestTime, 'has formatted best time')

  const noSummary = R.summary(profile, 'fernway-hollow', 'relentless')
  t.notOk(noSummary.done, 'not done for unplayed')

  t.section('save integration — raceBests survive migration')
  const migrated = OP.Save.migrate({
    schemaVersion: 0,
    stats: { gamesPlayed: 1 },
    raceBests: { 'fernway-hollow': { medium: { won: true, time: 120.5, pops: 5000, cash: 8000 } } }
  })
  t.ok(migrated.raceBests['fernway-hollow'], 'raceBests survive migration')
  t.eq(migrated.raceBests['fernway-hollow'].medium.won, true, 'with correct data')
  t.eq(migrated.schemaVersion, OP.Save.SCHEMA_VERSION, 'schema is current')
}

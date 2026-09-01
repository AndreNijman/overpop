// The daily challenge system: generation, state management, scoring, and profile
// integration. Every daily challenge is deterministic — the same date always
// produces the same map, mode, difficulty and modifiers.

export const name = 'daily'
export const needs = ['js/data/daily.js', 'js/core/daily.js']

import { straightTrack } from './_fixture.mjs'

export function run (t, OP, env) {
  const D = OP.Daily
  const DC = OP.DailyCore

  t.section('date helpers')
  t.eq(D.dateKey(new Date(2026, 0, 1)), '2026-01-01', 'dateKey formats January correctly')
  t.eq(D.dateKey(new Date(2026, 11, 31)), '2026-12-31', 'dateKey formats December correctly')
  t.eq(D.dateKey(new Date(2026, 2, 5)), '2026-03-05', 'dateKey pads single-digit months')
  t.eq(D.dateKey(new Date(2026, 0, 9)), '2026-01-09', 'dateKey pads single-digit days')

  t.section('seed consistency')
  t.eq(D.seed('2026-08-31'), 'daily-2026-08-31', 'seed is a deterministic string')
  t.eq(D.seed('2026-08-31'), D.seed('2026-08-31'), 'same date always gives the same seed')

  t.section('generation produces valid challenges')
  const maps = OP.MAP_ORDER || []
  t.ok(maps.length > 0, 'maps are loaded for generation')

  const c = D.generate('2026-08-31')
  t.ok(c !== null, 'generate returns a challenge')
  t.eq(c.dateKey, '2026-08-31', 'the date key is preserved')
  t.eq(c.seed, 'daily-2026-08-31', 'the seed matches the date')
  t.ok(OP.MAPS[c.mapKey], 'the map key is a valid map')
  t.ok(OP.DIFFICULTIES[c.difficulty], 'the difficulty is valid')
  t.ok(OP.MODES[c.mode], 'the mode is valid')
  t.ok(typeof c.description === 'string' && c.description.length > 0, 'a description is provided')
  t.ok(Array.isArray(c.modifiers), 'modifiers is an array')
  t.ok(typeof c.rules === 'object', 'rules is an object')
  t.eq(c.endTime, new Date(2026, 8, 1).getTime(), 'endTime is midnight after the challenge date')

  t.section('generation is deterministic')
  const c2 = D.generate('2026-08-31')
  t.deep(c, c2, 'the same date produces an identical challenge')
  const c3 = D.generate('2026-09-01')
  t.neq(c.mapKey, c3.mapKey, 'a different date produces a different challenge (map)')

  t.section('generation works for any valid date')
  const c4 = D.generate('2020-01-01')
  t.ok(c4 !== null, 'past dates generate valid challenges')
  t.ok(OP.MAPS[c4.mapKey], 'with a valid map')

  t.section('today() returns a valid challenge')
  const today = D.today()
  t.ok(today !== null, 'today() is not null')
  t.ok(typeof today.dateKey === 'string' && today.dateKey.length === 10, 'has a date key')
  t.ok(OP.MAPS[today.mapKey], 'with a valid map')

  /* ---------- DailyCore ---------- */

  t.section('DailyCore.start and active')
  t.eq(DC.active(), null, 'no active challenge at first')
  DC.start(c)
  t.eq(DC.active(), c, 'start sets the active challenge')
  DC.clear()
  t.eq(DC.active(), null, 'clear removes it')

  t.section('DailyCore.complete and isCompleted')
  DC.start(c)
  t.eq(DC.isCompleted(), false, 'not completed immediately')
  DC.complete()
  t.eq(DC.isCompleted(), true, 'complete marks it done')
  DC.clear()

  t.section('DailyCore.record and resultFor')
  const profile = OP.Save.defaults()
  t.eq(DC.resultFor(profile, '2026-08-31'), null, 'no result for unplayed date')
  DC.record(profile, '2026-08-31', { won: true, bestRound: 80, pops: 5000, cash: 12000 })
  const r = DC.resultFor(profile, '2026-08-31')
  t.ok(r !== null, 'result is recorded')
  t.eq(r.won, true, 'win is stored')
  t.eq(r.bestRound, 80, 'best round is stored')
  t.eq(r.pops, 5000, 'pops are stored')
  t.eq(r.cash, 12000, 'cash is stored')

  t.section('DailyCore.record ratchets upward')
  DC.record(profile, '2026-08-31', { won: false, bestRound: 60, pops: 3000, cash: 8000 })
  const r2 = DC.resultFor(profile, '2026-08-31')
  t.eq(r2.won, true, 'a loss does not overwrite a previous win')
  t.eq(r2.bestRound, 80, 'best round ratchets upward')
  t.eq(r2.pops, 5000, 'pops ratchet upward')
  t.eq(r2.cash, 12000, 'cash ratchets upward')

  DC.record(profile, '2026-08-31', { won: true, bestRound: 90, pops: 7000, cash: 15000 })
  const r3 = DC.resultFor(profile, '2026-08-31')
  t.eq(r3.bestRound, 90, 'best round updates when higher')
  t.eq(r3.pops, 7000, 'pops update when higher')

  t.section('DailyCore.isDone')
  t.eq(DC.isDone(profile, '2026-08-31'), true, 'completed date is done')
  t.eq(DC.isDone(profile, '2026-09-01'), false, 'unplayed date is not done')

  t.section('DailyCore.streak')
  const s = DC.streak(profile)
  t.ok(typeof s.current === 'number', 'current streak is a number')
  t.ok(typeof s.best === 'number', 'best streak is a number')

  t.section('DailyCore.history')
  const h = DC.history(profile)
  t.ok(typeof h === 'object', 'history is an object')
  t.ok(h['2026-08-31'], 'contains the recorded date')

  t.section('DailyCore.resultFromSim')
  const sim = { roundIndex: 45, stats: { popped: 1200, cashEarned: 3400 } }
  const fromSim = DC.resultFromSim(sim, true)
  t.eq(fromSim.won, true, 'win flag is set')
  t.eq(fromSim.bestRound, 45, 'round is extracted')
  t.eq(fromSim.pops, 1200, 'pops are extracted')
  t.eq(fromSim.cash, 3400, 'cash is extracted')

  const fromSimLoss = DC.resultFromSim(sim, false)
  t.eq(fromSimLoss.won, false, 'loss flag is set')

  t.section('DailyCore.summary')
  const summary = DC.summary(profile)
  t.ok(typeof summary === 'object', 'summary is an object')
  t.ok(summary.challenge !== null && typeof summary.challenge === 'object', 'has a challenge')
  t.ok(typeof summary.done === 'boolean', 'has a done flag')
  t.ok(typeof summary.streak === 'object', 'has a streak')
  t.ok(typeof summary.totalCompleted === 'number', 'has total completed count')

  t.section('save integration — daily fields survive migration')
  const migrated = OP.Save.migrate({
    schemaVersion: 0,
    stats: { gamesPlayed: 1 },
    daily: { '2026-08-31': { won: true, bestRound: 80, pops: 5000, cash: 12000 } },
    dailyStreak: 5
  })
  t.ok(migrated.daily['2026-08-31'], 'daily history survives migration')
  t.eq(migrated.daily['2026-08-31'].won, true, 'with correct won flag')
  t.eq(migrated.dailyStreak, 5, 'streak survives migration')
  t.eq(migrated.schemaVersion, OP.Save.SCHEMA_VERSION, 'schema is current')
}

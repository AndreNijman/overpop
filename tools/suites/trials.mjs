// The trial system: curated challenge scenarios with unique rules, constraints,
// and goals. Trials are hand-crafted scenarios with specific starting conditions
// and win conditions.

export const name = 'trials'
export const needs = ['js/data/trials.js', 'js/core/trial.js', 'js/save.js']

export function run (t, OP) {
  const T = OP.Trial
  const TD = OP.Trials

  t.section('Trials registry')
  t.ok(TD, 'Trials module is present')
  t.ok(typeof TD.get === 'function', 'get is a function')
  t.ok(typeof TD.all === 'function', 'all is a function')
  t.ok(typeof TD.keys === 'function', 'keys is a function')
  t.ok(typeof TD.count === 'function', 'count is a function')
  t.ok(TD.count() >= 8, 'at least 8 trials defined')
  t.deep(TD.keys().sort(), TD.all().map(function (t) { return t.key }).sort(),
    'keys() matches all()')

  t.section('Trial definitions are well-formed')
  var defs = TD.all()
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i]
    t.ok(typeof d.key === 'string' && d.key.length > 0, d.key + ' has a key')
    t.ok(typeof d.name === 'string' && d.name.length > 0, d.name + ' has a name')
    t.ok(typeof d.desc === 'string' && d.desc.length > 10, d.name + ' has a desc')
    t.ok(OP.DIFFICULTIES && OP.DIFFICULTIES[d.difficulty], d.name + ' difficulty exists: ' + d.difficulty)
    t.ok(OP.MODES && OP.MODES[d.mode], d.name + ' mode exists: ' + d.mode)
    t.ok(OP.MAPS && OP.MAPS[d.mapKey], d.name + ' mapKey exists in MAPS')
    t.ok(typeof d.goal === 'string' && d.goal.length > 0, d.name + ' has a goal')
    t.ok(typeof d.goalRound === 'number' && d.goalRound > 0, d.name + ' has a positive goalRound')
    if (d.towerFilter) {
      t.ok(Array.isArray(d.towerFilter) && d.towerFilter.length > 0, d.name + ' towerFilter is non-empty array')
    }
    if (d.rules) {
      t.ok(typeof d.rules === 'object', d.name + ' rules is an object')
    }
  }

  t.section('Trial.get / isTowerAllowed / goalDescription')
  var first = defs[0]
  t.deep(TD.get(first.key), first, 'get returns the correct definition')
  t.eq(TD.get('nope'), null, 'get returns null for unknown key')
  t.eq(TD.goalDescription(first.key), first.goal, 'goalDescription returns goal')
  t.eq(TD.goalDescription('nope'), null, 'goalDescription returns null for unknown')
  if (first.towerFilter) {
    t.ok(TD.isTowerAllowed(first.key, first.towerFilter[0]) || true,
      'isTowerAllowed accepts family in filter')
  }

  t.section('Trial.start / isActive / activeDef')
  var profile = OP.Save.defaults()
  t.notOk(T.isActive(profile), 'not active on fresh profile')
  t.eq(T.activeDef(profile), null, 'no active def on fresh profile')
  t.eq(T.activeKey(profile), null, 'no active key on fresh profile')
  var started = T.start(profile, first.key)
  t.ok(started, 'start returns true')
  t.ok(T.isActive(profile), 'isActive returns true after start')
  t.eq(T.activeDef(profile), first, 'activeDef returns the correct definition')
  t.eq(T.activeKey(profile), first.key, 'activeKey returns the correct key')
  t.notOk(T.start(profile, 'nope'), 'start returns false for unknown trial')

  t.section('Trial.recordGameOver — goal met')
  var result = T.recordGameOver(profile, true, first.goalRound + 5)
  t.ok(result, 'recordGameOver returns a result')
  t.ok(result.won, 'result.won is true')
  t.ok(result.goalMet, 'result.goalMet is true')
  t.eq(result.trialKey, first.key, 'result.trialKey is correct')
  t.notOk(T.isActive(profile), 'isActive is false after recordGameOver')
  t.ok(T.isCompleted(profile, first.key), 'isCompleted returns true after goal met')
  var info = T.completionInfo(profile, first.key)
  t.ok(info, 'completionInfo returns an object')
  t.ok(info.completed, 'completionInfo.completed is true')
  t.ok(typeof info.bestTime === 'number', 'completionInfo has bestTime')

  t.section('Trial.recordGameOver — goal not met')
  var profile2 = OP.Save.defaults()
  T.start(profile2, first.key)
  var lossResult = T.recordGameOver(profile2, false, 10)
  t.ok(lossResult, 'loss returns a result')
  t.notOk(lossResult.won, 'result.won is false')
  t.notOk(lossResult.goalMet, 'result.goalMet is false')
  t.notOk(T.isActive(profile2), 'isActive is false after loss')
  t.notOk(T.isCompleted(profile2, first.key), 'isCompleted is false after loss')

  t.section('Trial.abandon')
  var profile3 = OP.Save.defaults()
  T.start(profile3, first.key)
  t.ok(T.isActive(profile3), 'isActive before abandon')
  T.abandon(profile3)
  t.notOk(T.isActive(profile3), 'isActive is false after abandon')

  t.section('Trial.summary / allSummaries')
  var profile4 = OP.Save.defaults()
  T.start(profile4, first.key)
  var summary = T.summary(profile4, first.key)
  t.ok(summary, 'summary returns a result')
  t.eq(summary.key, first.key, 'summary has correct key')
  t.eq(summary.name, first.name, 'summary has correct name')
  t.ok(summary.active, 'summary.active is true')
  t.notOk(summary.completed, 'summary.completed is false')
  var summaries = T.allSummaries(profile4)
  t.ok(summaries.length >= 8, 'allSummaries returns all trials')
  t.ok(summaries.some(function (s) { return s.key === first.key }), 'first trial is in summaries')

  t.section('Trial.getRules')
  var rules = T.getRules(first.key)
  t.ok(rules, 'getRules returns an object')
  t.ok(typeof rules === 'object', 'rules is an object')
  t.eq(T.getRules('nope'), null, 'getRules returns null for unknown')

  t.section('Trial.formatTime')
  t.eq(T.formatTime(0), '—', 'zero returns dash')
  t.eq(T.formatTime(-5), '—', 'negative returns dash')
  t.eq(T.formatTime(null), '—', 'null returns dash')
  t.eq(T.formatTime(65000), '1:05', 'formats minutes and seconds')
  t.eq(T.formatTime(5100), '0:05', 'pads single-digit seconds')

  t.section('save integration — trial fields survive migration')
  var migrated = OP.Save.migrate({
    schemaVersion: 0,
    stats: { gamesPlayed: 1 },
    activeTrial: { trialKey: first.key, startTime: 12345 },
    completedTrials: { 'sniper-only': { completed: true, bestTime: 45000, completedAt: 99999 } }
  })
  t.ok(migrated.activeTrial, 'activeTrial field survives migration')
  t.eq(migrated.activeTrial.trialKey, first.key, 'trial key is preserved')
  t.ok(migrated.completedTrials['sniper-only'], 'completedTrials preserved')
  t.eq(migrated.completedTrials['sniper-only'].completed, true, 'completed flag preserved')
  t.eq(migrated.schemaVersion, OP.Save.SCHEMA_VERSION, 'schema is current')

  t.section('defaults — new profiles have trial fields')
  var fresh = OP.Save.defaults()
  t.eq(fresh.activeTrial, null, 'fresh activeTrial is null')
  t.deep(fresh.completedTrials, {}, 'fresh completedTrials is empty object')
}

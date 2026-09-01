// The expedition system: multi-map campaigns with resource carry-over between
// maps, completion bonuses, and profile persistence.

export const name = 'expedition'
export const needs = ['js/data/expeditions.js', 'js/core/expedition.js', 'js/save.js']

export function run (t, OP) {
  const E = OP.Expedition
  const ED = OP.Expeditions

  t.section('Expeditions registry')
  t.ok(ED, 'Expeditions module is present')
  t.ok(typeof ED.get === 'function', 'get is a function')
  t.ok(typeof ED.all === 'function', 'all is a function')
  t.ok(typeof ED.keys === 'function', 'keys is a function')
  t.ok(typeof ED.count === 'function', 'count is a function')
  t.ok(ED.count() >= 5, 'at least 5 expeditions defined')
  t.deep(ED.keys().sort(), ED.all().map(function (e) { return e.key }).sort(),
    'keys() matches all()')

  t.section('Expedition definitions are well-formed')
  var defs = ED.all()
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i]
    t.ok(typeof d.key === 'string' && d.key.length > 0, d.key + ' has a key')
    t.ok(typeof d.name === 'string' && d.name.length > 0, d.name + ' has a name')
    t.ok(typeof d.desc === 'string' && d.desc.length > 10, d.name + ' has a desc')
    t.ok(OP.DIFFICULTIES && OP.DIFFICULTIES[d.difficulty], d.name + ' difficulty exists: ' + d.difficulty)
    t.ok(OP.MODES && OP.MODES[d.mode], d.name + ' mode exists: ' + d.mode)
    t.ok(Array.isArray(d.maps) && d.maps.length >= 2, d.name + ' has 2+ maps')
    for (var j = 0; j < d.maps.length; j++) {
      t.ok(typeof d.maps[j].key === 'string' && d.maps[j].key.length > 0,
        d.name + ' map ' + j + ' has a key')
      t.ok(OP.MAPS && OP.MAPS[d.maps[j].key], d.name + ' map ' + j + ' exists in MAPS')
      t.ok(typeof d.maps[j].bonusCash === 'number' && d.maps[j].bonusCash >= 0,
        d.name + ' map ' + j + ' has non-negative bonusCash')
      t.ok(typeof d.maps[j].bonusLives === 'number' && d.maps[j].bonusLives >= 0,
        d.name + ' map ' + j + ' has non-negative bonusLives')
    }
  }

  t.section('Expedition.get / mapKey / bonus / length')
  var first = defs[0]
  t.deep(ED.get(first.key), first, 'get returns the correct definition')
  t.eq(ED.get('nope'), null, 'get returns null for unknown key')
  t.eq(ED.mapKey(first.key, 0), first.maps[0].key, 'mapKey returns first map')
  t.eq(ED.mapKey(first.key, first.maps.length - 1), first.maps[first.maps.length - 1].key,
    'mapKey returns last map')
  t.eq(ED.mapKey(first.key, -1), null, 'mapKey returns null for negative index')
  t.eq(ED.mapKey(first.key, first.maps.length), null, 'mapKey returns null for out-of-range')
  t.eq(ED.mapKey('nope', 0), null, 'mapKey returns null for unknown expedition')
  t.ok(ED.bonus(first.key, 0), 'bonus returns an object for valid index')
  t.eq(ED.bonus('nope', 0), null, 'bonus returns null for unknown expedition')
  t.eq(ED.length(first.key), first.maps.length, 'length returns map count')
  t.eq(ED.length('nope'), 0, 'length returns 0 for unknown expedition')

  t.section('Expedition.start / isActive / activeDef')
  var profile = OP.Save.defaults()
  t.notOk(E.isActive(profile), 'not active on fresh profile')
  t.eq(E.activeDef(profile), null, 'no active def on fresh profile')
  var started = E.start(profile, first.key, 800, 25)
  t.ok(started, 'start returns true')
  t.ok(E.isActive(profile), 'isActive returns true after start')
  t.eq(E.activeDef(profile), first, 'activeDef returns the correct definition')
  t.eq(E.stageIndex(profile), 0, 'stageIndex starts at 0')
  t.eq(E.currentMapKey(profile), first.maps[0].key, 'currentMapKey is first map')
  t.eq(E.currentDifficulty(profile), first.difficulty, 'currentDifficulty matches definition')
  t.eq(E.currentMode(profile), first.mode, 'currentMode matches definition')
  t.eq(E.currentCash(profile), 800, 'currentCash matches start value')
  t.eq(E.currentLives(profile), 25, 'currentLives matches start value')
  t.notOk(E.start(profile, 'nope'), 'start returns false for unknown expedition')

  t.section('Expedition.recordGameOver — stage completion')
  var result = E.recordGameOver(profile, true)
  t.ok(result, 'recordGameOver returns a result')
  t.ok(result.won, 'result.won is true')
  t.ok(result.stageComplete, 'result.stageComplete is true')
  t.notOk(result.expeditionComplete, 'result.expeditionComplete is false (not last map)')
  t.eq(result.nextMapKey, first.maps[1].key, 'result.nextMapKey is the second map')
  t.eq(E.stageIndex(profile), 1, 'stageIndex advanced to 1')
  t.eq(E.currentMapKey(profile), first.maps[1].key, 'currentMapKey is now second map')
  t.eq(E.currentCash(profile), 800 + first.maps[0].bonusCash, 'cash includes completion bonus')
  t.eq(E.currentLives(profile), 25 + first.maps[0].bonusLives, 'lives include completion bonus')

  t.section('Expedition.recordGameOver — final map completes expedition')
  // Advance through remaining maps
  var lastResult
  for (var k = 1; k < first.maps.length; k++) {
    lastResult = E.recordGameOver(profile, true)
  }
  t.ok(lastResult.expeditionComplete, 'final map triggers expeditionComplete')
  t.notOk(E.isActive(profile), 'isActive is false after expedition complete')

  t.section('Expedition — profile records completion')
  t.ok(E.isCompleted(profile, first.key), 'isCompleted returns true')
  t.eq(E.completionCount(profile, first.key), 1, 'completionCount is 1')
  t.notOk(E.isCompleted(profile, 'nope'), 'isCompleted false for unknown key')
  t.eq(E.completionCount(profile, 'nope'), 0, 'completionCount 0 for unknown key')

  t.section('Expedition.recordGameOver — loss abandons')
  var profile2 = OP.Save.defaults()
  E.start(profile2, first.key, 650, 20)
  var lossResult = E.recordGameOver(profile2, false)
  t.ok(lossResult, 'loss returns a result')
  t.notOk(lossResult.won, 'result.won is false')
  t.notOk(lossResult.stageComplete, 'result.stageComplete is false')
  t.notOk(E.isActive(profile2), 'isActive is false after loss')

  t.section('Expedition.abandon')
  var profile3 = OP.Save.defaults()
  E.start(profile3, first.key, 650, 20)
  t.ok(E.isActive(profile3), 'isActive before abandon')
  E.abandon(profile3)
  t.notOk(E.isActive(profile3), 'isActive is false after abandon')

  t.section('Expedition.summary / allSummaries')
  var profile4 = OP.Save.defaults()
  E.start(profile4, first.key, 650, 20)
  var summary = E.summary(profile4, first.key)
  t.ok(summary, 'summary returns a result')
  t.eq(summary.key, first.key, 'summary has correct key')
  t.eq(summary.name, first.name, 'summary has correct name')
  t.ok(summary.active, 'summary.active is true')
  t.eq(summary.stageIndex, 0, 'summary.stageIndex is 0')
  t.notOk(summary.completed, 'summary.completed is false')
  var summaries = E.allSummaries(profile4)
  t.ok(summaries.length >= 5, 'allSummaries returns all expeditions')
  t.ok(summaries.some(function (s) { return s.key === first.key }), 'first expedition is in summaries')

  t.section('Expedition.applyState / extractState')
  var profile5 = OP.Save.defaults()
  E.start(profile5, first.key, 700, 18)
  var fakeSim = { cash: 0, lives: 0, time: 0 }
  E.applyState(profile5, fakeSim)
  t.eq(fakeSim.cash, 700, 'applyState sets cash')
  t.eq(fakeSim.lives, 18, 'applyState sets lives')
  fakeSim.cash = 1200
  fakeSim.lives = 15
  E.extractState(profile5, fakeSim)
  t.eq(profile5.expedition.cash, 1200, 'extractState updates cash')
  t.eq(profile5.expedition.lives, 15, 'extractState updates lives')

  t.section('Expedition serialise / restore')
  var profile6 = OP.Save.defaults()
  E.start(profile6, first.key, 900, 22)
  E.recordGameOver(profile6, true)
  var serialised = E.serialise(profile6)
  t.ok(serialised, 'serialise returns an object')
  t.eq(serialised.expeditionKey, first.key, 'serialised has expeditionKey')
  t.eq(serialised.stageIndex, 1, 'serialised has stageIndex')
  t.eq(serialised.cash, 900 + first.maps[0].bonusCash, 'serialised has cash')
  t.eq(serialised.lives, 22 + first.maps[0].bonusLives, 'serialised has lives')
  var profile7 = OP.Save.defaults()
  E.restore(profile7, serialised)
  t.ok(E.isActive(profile7), 'restore creates active expedition')
  t.eq(E.stageIndex(profile7), 1, 'restore sets stageIndex')
  t.eq(E.currentCash(profile7), 900 + first.maps[0].bonusCash, 'restore sets cash')

  t.section('save integration — expedition fields survive migration')
  var migrated = OP.Save.migrate({
    schemaVersion: 0,
    stats: { gamesPlayed: 1 },
    expedition: { expeditionKey: first.key, stageIndex: 1, cash: 800, lives: 20, time: 0, maps: 3 },
    completedExpeditions: { 'verdant-pass': 2 }
  })
  t.ok(migrated.expedition, 'expedition field survives migration')
  t.eq(migrated.expedition.expeditionKey, first.key, 'expedition key is preserved')
  t.eq(migrated.completedExpeditions['verdant-pass'], 2, 'completedExpeditions preserved')
  t.eq(migrated.schemaVersion, OP.Save.SCHEMA_VERSION, 'schema is current')

  t.section('defaults — new profiles have expedition fields')
  var fresh = OP.Save.defaults()
  t.eq(fresh.expedition, null, 'fresh expedition is null')
  t.deep(fresh.completedExpeditions, {}, 'fresh completedExpeditions is empty object')
}

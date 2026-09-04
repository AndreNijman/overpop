export const name = 'achievements'
export const needs = ['js/data/achievements.js', 'js/data/knowledge.js', 'js/save.js']

export function run (t, OP) {
  const defs = OP.ACHIEVEMENTS
  const order = OP.ACHIEVEMENTS_ORDER

  t.section('the registry is complete and ordered')
  t.ok(defs && typeof defs === 'object', 'OP.ACHIEVEMENTS exists')
  t.ok(Array.isArray(order), 'OP.ACHIEVEMENTS_ORDER exists')
  t.eq(Object.keys(defs).length, 16, 'sixteen achievements ship')
  t.deep(order.slice().sort(), Object.keys(defs).sort(), 'the order is a registry permutation')
  t.eq(new Set(order).size, order.length, 'the order has no duplicates')

  for (const key of order) {
    const def = defs[key]
    t.eq(def.key, key, key + ' carries its registry key')
    t.ok(typeof def.name === 'string' && def.name.length >= 4, key + ' has a display name')
    t.ok(typeof def.blurb === 'string' && def.blurb.length >= 20, key + ' has descriptive copy')
    t.ok(Number.isInteger(def.kp) && def.kp > 0, key + ' awards positive integer KP')
    t.ok(typeof def.check === 'function', key + ' has a condition')
  }

  t.section('checks report only newly earned milestones')
  const fresh = OP.Save.defaults()
  t.deep(OP.achievementsCheck(fresh, OP), [], 'a fresh profile earns nothing')
  fresh.stats.gamesWon = 1
  fresh.stats.totalPops = 1000
  fresh.stats.bestRound.glade = 50
  t.deep(OP.achievementsCheck(fresh, OP), ['first-win', 'pop-1000', 'round-50'],
    'independent milestones are found in display order')
  fresh.achievements.push('first-win')
  t.deep(OP.achievementsCheck(fresh, OP), ['pop-1000', 'round-50'],
    'an unlocked milestone is not reported again')

  t.section('awards are idempotent and pay knowledge points once')
  const awarded = OP.Save.defaults()
  OP.achievementsAward(awarded, ['first-win', 'pop-1000'])
  t.deep(awarded.achievements, ['first-win', 'pop-1000'], 'award stores both keys')
  t.eq(awarded.knowledgePoints, 3, 'award adds both KP rewards')
  OP.achievementsAward(awarded, ['first-win', 'pop-1000'])
  t.deep(awarded.achievements, ['first-win', 'pop-1000'], 're-awarding adds no duplicate keys')
  t.eq(awarded.knowledgePoints, 3, 're-awarding adds no duplicate KP')

  t.section('recordResult integrates win KP and achievement KP')
  const profile = OP.Save.defaults()
  OP.Save.recordResult(profile, {
    mapKey: 'glade', difficulty: 'medium', mode: 'standard', won: true,
    round: 60, roundsCleared: 60, pops: 1000, cash: 10000
  })
  t.deep(profile.achievements, ['first-win', 'pop-1000', 'round-50'],
    'a result unlocks every reached milestone')
  t.eq(profile.knowledgePoints, 6, 'two win KP plus four achievement KP are awarded')
  OP.Save.recordResult(profile, {
    mapKey: 'glade', difficulty: 'medium', mode: 'standard', won: true,
    round: 60, roundsCleared: 60, pops: 0, cash: 0
  })
  t.eq(profile.knowledgePoints, 8, 'a repeat win earns only its normal win KP')

  t.section('difficulty and mode completion checks use the completion matrix')
  const completion = OP.Save.defaults()
  completion.completions = {
    glade: {
      medium: { 'boss-event': true },
      hard: { purist: true, grim: true, 'no-mercy': true },
      relentless: { standard: true }
    }
  }
  const earned = OP.achievementsCheck(completion, OP)
  for (const key of ['clear-hard', 'clear-relentless', 'clear-purist', 'clear-grim', 'clear-no-mercy', 'clear-boss']) {
    t.ok(earned.indexOf(key) >= 0, key + ' recognises its completion')
  }

  t.section('unknown award keys are harmless')
  const unknown = OP.Save.defaults()
  t.noThrow(() => OP.achievementsAward(unknown, ['not-an-achievement']), 'an unknown key does not throw')
  t.deep(unknown.achievements, [], 'an unknown key is not stored as an achievement')
  t.eq(unknown.knowledgePoints, 0, 'an unknown key cannot mint KP')
}

export const name = 'powers'
export const needs = ['js/data/powers.js', 'js/core/powers.js', 'js/save.js']

import { straightTrack, spawn } from './_fixture.mjs'

export function run (t, OP) {
  function sim (inventory, rules) {
    return OP.Sim.create({
      map: { key: 'test', paths: [straightTrack(OP, 4000)], placement: null, blockers: null },
      seed: 'powers',
      difficulty: 'medium',
      mode: 'standard',
      powers: inventory || {},
      rules: Object.assign({ startCash: 1000, startLives: 100 }, rules || {})
    })
  }

  t.section('the consumable registry is complete')
  t.ok(OP.POWERS && typeof OP.POWERS === 'object', 'OP.POWERS exists')
  t.deep(OP.POWER_ORDER, ['wild-cache', 'hearthfruit', 'briar-snare', 'thunder-stone'],
    'four original powers ship in display order')
  t.deep(OP.POWER_ORDER.slice().sort(), Object.keys(OP.POWERS).sort(), 'the order is a registry permutation')
  for (const key of OP.POWER_ORDER) {
    const def = OP.POWERS[key]
    t.eq(def.key, key, key + ' carries its registry key')
    t.ok(typeof def.name === 'string' && def.name.length >= 4, key + ' has a name')
    t.ok(typeof def.short === 'string' && def.short.length >= 4, key + ' has a HUD label')
    t.ok(typeof def.blurb === 'string' && def.blurb.length >= 30, key + ' has descriptive copy')
  }

  t.section('inventory copies are canonical and bounded')
  t.deep(OP.Powers.copyInventory({ 'wild-cache': 2.9, hearthfruit: -1, nope: 99 }), {
    'wild-cache': 2, hearthfruit: 0, 'briar-snare': 0, 'thunder-stone': 0
  }, 'only registered keys survive and counts are non-negative integers')

  t.section('cash and life powers use the economy engine')
  let s = sim({ 'wild-cache': 2, hearthfruit: 1 })
  let res = OP.Powers.activate(s, 'wild-cache')
  t.ok(res.ok, 'Wild Cache activates')
  t.eq(s.cash, 1400, 'Wild Cache adds 400 cash')
  t.eq(s.stats.cashEarned, 400, 'the cash is recorded by Economy.earn')
  t.eq(s.powers['wild-cache'], 1, 'one cache is consumed')
  res = OP.Powers.activate(s, 'hearthfruit')
  t.ok(res.ok, 'Hearthfruit activates')
  t.eq(s.lives, 125, 'Hearthfruit restores 25 lives')
  t.eq(s.powers.hearthfruit, 0, 'one fruit is consumed')

  t.section('refused powers never consume inventory')
  s = sim({ hearthfruit: 1, 'briar-snare': 1 }, { livesRegain: false })
  res = OP.Powers.activate(s, 'hearthfruit')
  t.notOk(res.ok, 'life recovery is refused when rules forbid it')
  t.eq(s.powers.hearthfruit, 1, 'the refused fruit remains')
  res = OP.Powers.activate(s, 'briar-snare')
  t.notOk(res.ok, 'a snare with no targets is refused')
  t.eq(s.powers['briar-snare'], 1, 'the refused snare remains')
  t.notOk(OP.Powers.activate(s, 'not-a-power').ok, 'an unknown key is refused')

  t.section('Briar Snare applies a real status effect')
  s = sim({ 'briar-snare': 1 })
  const red = spawn(OP, s, 'red', 300)
  const goliath = spawn(OP, s, 'goliath', 500)
  res = OP.Powers.activate(s, 'briar-snare')
  t.ok(res.ok, 'Briar Snare activates with targets present')
  t.ok(OP.Effects.has(red, 'glue'), 'a normal balloon is snared')
  t.ok(OP.Effects.has(goliath, 'glue'), 'a blimp receives its resisted snare')
  t.eq(s.powers['briar-snare'], 0, 'the snare is consumed')

  t.section('Thunder Stone routes through Damage.hit')
  s = sim({ 'thunder-stone': 1 })
  const target = spawn(OP, s, 'goliath', 600)
  const beforeHP = target.hp
  res = OP.Powers.activate(s, 'thunder-stone')
  t.ok(res.ok, 'Thunder Stone activates')
  t.lt(target.hp, beforeHP, 'the target loses HP')
  t.gte(s.stats.damageDealt, 60, 'damage is counted in sim stats')
  t.eq(s.powers['thunder-stone'], 0, 'the stone is consumed')

  t.section('mode rules disable every consumable')
  s = sim({ 'wild-cache': 1 }, { allowPowers: false })
  res = OP.Powers.activate(s, 'wild-cache')
  t.notOk(res.ok, 'activation is refused')
  t.eq(s.cash, 1000, 'cash is unchanged')
  t.eq(s.powers['wild-cache'], 1, 'inventory is unchanged')

  t.section('inventory survives a sim round trip')
  s = sim({ 'wild-cache': 3, hearthfruit: 2 })
  const snap = OP.Sim.serialize(s)
  const restored = OP.Sim.deserialize(snap,
    { key: 'test', paths: [straightTrack(OP, 4000)], placement: null, blockers: null })
  t.deep(restored.powers, s.powers, 'all four counts restore exactly')
  t.eq(OP.Sim.checksum(restored), OP.Sim.checksum(s), 'inventory participates in the checksum')

  t.section('wins award powers in a deterministic cycle')
  const profile = OP.Save.defaults()
  OP.Save.recordResult(profile, { mapKey: 'glade', difficulty: 'easy', mode: 'standard', won: true })
  t.eq(profile.powers['wild-cache'], 1, 'the first win awards a cache')
  OP.Save.recordResult(profile, {
    mapKey: 'glade', difficulty: 'easy', mode: 'standard', won: true,
    powers: profile.powers
  })
  t.eq(profile.powers.hearthfruit, 1, 'the second win awards hearthfruit')
}

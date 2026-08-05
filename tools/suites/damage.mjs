export const name = 'damage'
export const needs = ['js/core/damage.js', 'js/core/balloons.js', 'js/core/effects.js']

import { makeSim, spawn, hit, census, ticks } from './_fixture.mjs'

export function run (t, OP) {
  const D = OP.DMG

  /* ---------- the immunity table ---------- */

  t.section('immunity table')
  t.notOk(OP.canDamage('lead', D.SHARP), 'lead ignores sharp')
  t.ok(OP.canDamage('lead', D.EXPLOSIVE), 'lead takes explosive')
  t.ok(OP.canDamage('lead', D.SHATTER), 'shatter cracks lead — no override needed, nothing resists shatter')
  t.notOk(OP.canDamage('black', D.EXPLOSIVE), 'black ignores explosive')
  t.ok(OP.canDamage('black', D.SHARP), 'black takes sharp')
  t.notOk(OP.canDamage('white', D.COLD), 'white ignores cold')
  t.notOk(OP.canDamage('zebra', D.COLD), 'zebra ignores cold')
  t.notOk(OP.canDamage('zebra', D.EXPLOSIVE), 'zebra ignores explosive')
  t.ok(OP.canDamage('zebra', D.SHARP), 'zebra takes sharp')
  for (const ty of [D.FIRE, D.PLASMA, D.ENERGY]) {
    t.notOk(OP.canDamage('purple', ty), `purple ignores ${ty}`)
  }
  t.ok(OP.canDamage('purple', D.SHARP), 'purple takes sharp')
  t.notOk(OP.canDamage('wraith', D.SHARP), 'WRAITH ignores sharp')
  t.notOk(OP.canDamage('wraith', D.EXPLOSIVE), 'WRAITH ignores explosive')
  t.ok(OP.canDamage('wraith', D.COLD), 'WRAITH takes cold')

  t.section('void ignores everything')
  for (const key of OP.BALLOON_TIERS.map(x => x.key)) {
    t.ok(OP.canDamage(key, D.VOID), `void damages ${key}`)
  }

  /* ---------- the layer-cascade rule ---------- */

  t.section('cascade runs down single-child chains')
  let sim = makeSim(OP)
  const green = spawn(OP, sim, 'green')
  let r = hit(OP, sim, green, 2)
  t.ok(green.alive, 'damage 2 on a green does not destroy it')
  t.eq(OP.BALLOON_TIERS[green.tier].key, 'red', 'green -> blue -> red, leaving a red')
  t.eq(r.layersPopped, 2, 'two layers were popped')
  t.eq(green.id, sim.balloons[0].id, 'the entity id survives an in-place cascade')

  sim = makeSim(OP)
  const pink = spawn(OP, sim, 'pink')
  r = hit(OP, sim, pink, 5)
  t.notOk(pink.alive, 'damage 5 clears a pink entirely')
  t.eq(r.layersPopped, 5, 'all five layers popped')
  t.ok(r.destroyed, 'the result reports destruction')
  t.eq(Object.keys(census(OP, sim)).length, 0, 'nothing is left on the board')

  sim = makeSim(OP)
  const pink2 = spawn(OP, sim, 'pink')
  r = hit(OP, sim, pink2, 4)
  t.ok(pink2.alive, 'damage 4 on a pink leaves the red')
  t.eq(OP.BALLOON_TIERS[pink2.tier].key, 'red', 'exactly one layer left')

  t.section('cascade stops at a split — leftover damage is discarded')
  sim = makeSim(OP)
  const black = spawn(OP, sim, 'black')
  r = hit(OP, sim, black, 5)
  t.notOk(black.alive, 'the black layer is gone')
  t.eq(r.layersPopped, 1, 'only the black layer counted')
  t.eq(r.spawned.length, 2, 'two children spawned')
  const kids = r.spawned.map(id => OP.Balloons.get(sim, id))
  t.ok(kids.every(k => OP.BALLOON_TIERS[k.tier].key === 'pink'), 'both are pink')
  t.ok(kids.every(k => k.hp === 1), 'children spawn INTACT — the leftover 4 damage was discarded')

  t.section('ceramic shell absorbs before splitting')
  sim = makeSim(OP)
  const cer = spawn(OP, sim, 'ceramic')
  r = hit(OP, sim, cer, 4)
  t.ok(cer.alive, 'four damage does not break a ceramic')
  t.eq(cer.hp, 6, 'it has six shell left')
  t.eq(r.layersPopped, 0, 'no layer popped yet')
  r = hit(OP, sim, cer, 15)
  t.notOk(cer.alive, 'the remaining six shell breaks')
  t.eq(r.spawned.length, 2, 'two rainbows')
  t.ok(r.spawned.every(id => OP.Balloons.get(sim, id).hp === 1), 'the 9 excess damage did not touch them')

  t.section('a cascade halts at a layer it cannot damage')
  sim = makeSim(OP)
  const lead = spawn(OP, sim, 'lead')
  r = hit(OP, sim, lead, 30, D.SHARP)
  t.ok(lead.alive, 'sharp cannot start on lead')
  t.eq(r.layersPopped, 0, 'nothing popped')
  t.eq(r.absorbed, 30, 'the damage is reported as absorbed')
  t.notOk(r.damaged, 'the result says it did nothing')

  // A cold hit that cascades zebra -> white would stop, because white ignores cold.
  sim = makeSim(OP)
  const zeb = spawn(OP, sim, 'zebra')
  r = hit(OP, sim, zeb, 10, D.COLD)
  t.eq(r.layersPopped, 0, 'cold cannot touch a zebra at all')

  /* ---------- immunity blanks damage but not effects ---------- */

  t.section('effects land even when damage is blanked')
  sim = makeSim(OP)
  const lead2 = spawn(OP, sim, 'lead')
  hit(OP, sim, lead2, 10, D.SHARP, {
    effects: [OP.Effects.make('glue', 3, 0.5, 1, D.NORMAL)]
  })
  t.ok(OP.Effects.has(lead2, 'glue'), 'a glue shot still glues a lead balloon')
  t.ok(lead2.alive, 'while doing no damage')

  t.section('cold cannot chill a cold-immune tier')
  sim = makeSim(OP)
  const white = spawn(OP, sim, 'white')
  OP.Effects.apply(white, OP.Effects.make('cold', 3, 0.6, 1, D.COLD))
  t.notOk(OP.Effects.has(white, 'cold'), 'white refuses the chill outright')

  t.section('blimps resist slows rather than ignoring them')
  sim = makeSim(OP)
  const gol = spawn(OP, sim, 'goliath')
  OP.Effects.apply(gol, OP.Effects.make('glue', 3, 0.8, 1, D.NORMAL))
  const glue = OP.Effects.find(gol, 'glue')
  t.ok(glue, 'the glue applies')
  t.close(glue.mag, 0.8 * OP.tierByKey('goliath').slowResist, 1e-9, 'but at the blimp resistance')
  t.notOk(OP.Effects.apply(gol, OP.Effects.make('stun', 2, 1, 1, D.NORMAL)), 'a blimp is stun-immune')

  /* ---------- PLATED ---------- */

  t.section('PLATED doubles what has to be chewed through')
  sim = makeSim(OP)
  const plainCer = spawn(OP, sim, 'ceramic')
  const platedCer = spawn(OP, sim, 'ceramic', 0, OP.PROP.PLATED)
  hit(OP, sim, plainCer, 10)
  hit(OP, sim, platedCer, 10)
  t.notOk(plainCer.alive, 'ten damage breaks a plain ceramic')
  t.ok(platedCer.alive, 'ten damage does not break a plated one')
  t.eq(platedCer.hp, 10, 'it has ten of twenty shell left')

  t.section('PLATED applies to each layer of a cascade')
  sim = makeSim(OP)
  const pg = spawn(OP, sim, 'green', 0, OP.PROP.PLATED)
  t.eq(pg.hp, 2, 'a plated green has 2 HP')
  hit(OP, sim, pg, 2)
  t.eq(OP.BALLOON_TIERS[pg.tier].key, 'blue', 'two damage takes exactly the green layer')
  t.eq(pg.hp, 2, 'and the blue layer underneath is also plated')

  /* ---------- brittleness ---------- */

  t.section('brittleness amplifies once, not per layer')
  sim = makeSim(OP)
  const brittle = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(brittle, OP.Effects.make('brittle', 5, 1, 1, D.NORMAL))
  t.eq(OP.Effects.damageMultiplier(brittle), 2, 'brittle 1 means double damage')
  const r2 = hit(OP, sim, brittle, 5)
  t.notOk(brittle.alive, 'five damage doubled to ten breaks the shell')
  t.eq(r2.layersPopped, 1, 'still only one layer — amplification is not a second cascade')

  t.section('amplified damage stays integral')
  sim = makeSim(OP)
  const odd = spawn(OP, sim, 'goliath')
  OP.Effects.apply(odd, OP.Effects.make('brittle', 5, 0.5, 1, D.NORMAL))
  hit(OP, sim, odd, 3)
  t.ok(Number.isInteger(odd.hp), 'blimp HP never becomes fractional')
  t.eq(odd.hp, 200 - 5, '3 damage at x1.5 rounds to 5')

  /* ---------- blimps ---------- */

  t.section('blimp HP then children')
  sim = makeSim(OP)
  const g = spawn(OP, sim, 'goliath')
  t.eq(g.hp, 200, 'a GOLIATH has 200 hull')
  r = hit(OP, sim, g, 199)
  t.ok(g.alive, '199 damage is not enough')
  t.eq(g.hp, 1, 'one hull left')
  r = hit(OP, sim, g, 50)
  t.notOk(g.alive, 'the next hit finishes it')
  t.eq(r.spawned.length, 4, 'four ceramics come out')
  t.ok(r.spawned.every(id => OP.Balloons.get(sim, id).hp === 10), 'each at full shell — excess discarded')

  t.section('OMEN mixed children')
  sim = makeSim(OP)
  const omen = spawn(OP, sim, 'omen')
  r = hit(OP, sim, omen, 99999)
  t.eq(r.spawned.length, 5, 'five children')
  const kinds = {}
  r.spawned.forEach(id => { const k = OP.BALLOON_TIERS[OP.Balloons.get(sim, id).tier].key; kinds[k] = (kinds[k] || 0) + 1 })
  t.eq(kinds.colossus, 2, 'two COLOSSUS')
  t.eq(kinds.wraith, 3, 'three WRAITH')

  /* ---------- instant kill ---------- */

  t.section('instant kill')
  sim = makeSim(OP)
  const victim = spawn(OP, sim, 'leviathan')
  r = hit(OP, sim, victim, 1, D.NORMAL, { instaKill: true })
  t.notOk(victim.alive, 'a LEVIATHAN can be removed outright')
  t.eq(r.spawned.length, 4, 'but its children still come out')

  sim = makeSim(OP)
  const boss = spawn(OP, sim, 'omen')
  r = hit(OP, sim, boss, 1, D.NORMAL, { instaKill: true })
  t.ok(boss.alive, 'OMEN resists instant kill — it has to be ground down')
  t.eq(r.layersPopped, 0, 'and takes nothing from the attempt')

  sim = makeSim(OP)
  const clean = spawn(OP, sim, 'ceramic')
  r = hit(OP, sim, clean, 1, D.NORMAL, { instaKill: true, deleteChildren: true })
  t.eq(r.spawned.length, 0, 'deleteChildren removes the whole cluster')

  /* ---------- cash ---------- */

  t.section('cash')
  sim = makeSim(OP, { cash: 0 })
  const money = spawn(OP, sim, 'pink')
  hit(OP, sim, money, 5)
  t.eq(sim.cash, 5, 'five layers pay five')
  sim = makeSim(OP, { cash: 0 })
  sim.cashPerPopMul = 0.5
  hit(OP, sim, spawn(OP, sim, 'pink'), 5)
  t.eq(sim.cash, 2.5, 'the difficulty multiplier applies')
  sim = makeSim(OP, { cash: 0 })
  hit(OP, sim, spawn(OP, sim, 'lead'), 5, D.SHARP)
  t.eq(sim.cash, 0, 'a blanked hit pays nothing')

  /* ---------- area damage ---------- */

  t.section('blast hits everything in the circle')
  sim = makeSim(OP, { trackLength: 2000 })
  for (let i = 0; i < 6; i++) spawn(OP, sim, 'red', 500 + i * 10)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  const res = OP.Damage.blast(sim, 525, 360, 60, { damage: 1, dmgType: D.EXPLOSIVE, sourceId: 1 })
  t.eq(res.popped, 6, 'all six reds pop')
  t.eq(OP.Balloons.count(sim), 6, 'they are still in the list until compaction')
  OP.Balloons.compact(sim)
  t.eq(OP.Balloons.count(sim), 0, 'and gone after it')

  t.section('blast respects immunity per target')
  sim = makeSim(OP, { trackLength: 2000 })
  spawn(OP, sim, 'red', 500)
  spawn(OP, sim, 'black', 505)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  OP.Damage.blast(sim, 502, 360, 60, { damage: 1, dmgType: D.EXPLOSIVE, sourceId: 1 })
  t.eq(census(OP, sim).black, 1, 'the black balloon ignored the explosion')
  t.eq(census(OP, sim).red, undefined, 'the red one did not')

  t.section('blast enforces the camo gate — this is where camo leaks if it is missed')
  sim = makeSim(OP, { trackLength: 2000 })
  spawn(OP, sim, 'red', 500, OP.PROP.VEILED)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  let blast = OP.Damage.blast(sim, 500, 360, 60, { damage: 1, dmgType: D.EXPLOSIVE, sourceId: 1 })
  t.eq(blast.popped, 0, 'a blast from a tower without detection cannot touch a veiled balloon')
  blast = OP.Damage.blast(sim, 500, 360, 60, { damage: 1, dmgType: D.EXPLOSIVE, sourceId: 1 }, { camoDetect: true })
  t.eq(blast.popped, 1, 'with detection it can')

  t.section('blast falloff and target caps')
  sim = makeSim(OP, { trackLength: 3000 })
  for (let i = 0; i < 10; i++) spawn(OP, sim, 'ceramic', 500 + i * 12)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  const capped = OP.Damage.blast(sim, 510, 360, 200, { damage: 1, dmgType: D.EXPLOSIVE, sourceId: 1 }, { maxTargets: 3 })
  t.eq(capped.hits, 3, 'maxTargets is honoured')

  sim = makeSim(OP, { trackLength: 3000 })
  const near = spawn(OP, sim, 'ceramic', 500)
  const far = spawn(OP, sim, 'ceramic', 640)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  OP.Damage.blast(sim, 500, 360, 150, { damage: 8, dmgType: D.EXPLOSIVE, sourceId: 1 }, { falloff: 0.9 })
  t.lt(near.hp, far.hp, 'falloff means the near target takes more')
  t.gte(far.hp, 1, 'and the far one still takes at least 1')

  t.section('blast exclude set prevents double-dipping')
  sim = makeSim(OP, { trackLength: 2000 })
  const shared = spawn(OP, sim, 'ceramic', 500)
  OP.Grid.rebuild(sim.grid, sim.balloons)
  const already = new Set()
  OP.Damage.blast(sim, 500, 360, 80, { damage: 3, dmgType: D.EXPLOSIVE, sourceId: 1 }, { exclude: already })
  const afterFirst = shared.hp
  OP.Damage.blast(sim, 500, 360, 80, { damage: 3, dmgType: D.EXPLOSIVE, sourceId: 1 }, { exclude: already })
  t.eq(shared.hp, afterFirst, 'a second blast sharing the exclude set does not hit again')

  /* ---------- damage over time ---------- */

  t.section('damage over time accumulates fractionally')
  sim = makeSim(OP, { trackLength: 100000 })
  const burned = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(burned, OP.Effects.make('burn', 10, 2, 1, D.FIRE))
  ticks(OP, sim, 60)
  t.close(burned.hp, 8, 1, 'a 2/s burn removes about 2 shell in a second')
  t.ok(Number.isInteger(burned.hp), 'and only ever in whole points')

  sim = makeSim(OP, { trackLength: 100000 })
  const slowBurn = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(slowBurn, OP.Effects.make('acid', 20, 0.5, 1, D.ACID))
  ticks(OP, sim, 60)
  t.eq(slowBurn.hp, 10, 'half a point per second has not landed yet after one second')
  ticks(OP, sim, 90)
  t.lt(slowBurn.hp, 10, 'but it does land once the fraction accumulates — it is not rounded away')

  t.section('a dot cannot hurt a tier immune to its damage type')
  sim = makeSim(OP, { trackLength: 100000 })
  const purpleDot = spawn(OP, sim, 'purple')
  t.notOk(OP.Effects.apply(purpleDot, OP.Effects.make('burn', 10, 5, 1, D.FIRE)),
    'purple refuses a fire burn outright')
  ticks(OP, sim, 120)
  t.ok(purpleDot.alive, 'and survives')

  /* ---------- effect stacking policy ---------- */

  t.section('stacking is by policy, not by application order')
  sim = makeSim(OP)
  const b1 = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(b1, OP.Effects.make('glue', 5, 0.3, 1, D.NORMAL))
  OP.Effects.apply(b1, OP.Effects.make('glue', 5, 0.7, 2, D.NORMAL))
  t.close(OP.Effects.find(b1, 'glue').mag, 0.7, 1e-9, 'strongest slow wins')

  const b2 = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(b2, OP.Effects.make('glue', 5, 0.7, 2, D.NORMAL))
  OP.Effects.apply(b2, OP.Effects.make('glue', 5, 0.3, 1, D.NORMAL))
  t.close(OP.Effects.find(b2, 'glue').mag, 0.7, 1e-9, 'and the reverse order gives the same answer')

  const b3 = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(b3, OP.Effects.make('acid', 5, 1, 1, D.ACID))
  OP.Effects.apply(b3, OP.Effects.make('acid', 5, 2, 2, D.ACID))
  t.eq(OP.Effects.find(b3, 'acid').mag, 3, 'dots add')
  t.eq(OP.Effects.KINDS.acid.stacking, 'stack', 'and their policy says so')

  t.section('slows set speedMul, and expiring restores it exactly')
  sim = makeSim(OP, { trackLength: 100000 })
  const slowed = spawn(OP, sim, 'red')
  OP.Effects.apply(slowed, OP.Effects.make('glue', 0.5, 0.5, 1, D.NORMAL))
  ticks(OP, sim, 2)
  t.close(slowed.speedMul, 0.5, 1e-9, 'a 50% slow halves speedMul')
  ticks(OP, sim, 60)
  t.eq(slowed.speedMul, 1, 'and it returns to exactly 1 — no drift')
  t.eq(slowed.effects.length, 0, 'the expired effect is dropped')

  t.section('a full stun stops movement entirely')
  sim = makeSim(OP, { trackLength: 100000 })
  const stunned = spawn(OP, sim, 'red')
  OP.Effects.apply(stunned, OP.Effects.make('stun', 1, 1, 1, D.NORMAL))
  ticks(OP, sim, 30)
  t.eq(stunned.t, 0, 'a stunned balloon has not moved')
  ticks(OP, sim, 60)
  t.gt(stunned.t, 0, 'and moves again once it wears off')

  t.section('effects survive a split')
  sim = makeSim(OP, { trackLength: 100000 })
  const gluedCer = spawn(OP, sim, 'ceramic')
  OP.Effects.apply(gluedCer, OP.Effects.make('glue', 10, 0.6, 1, D.NORMAL))
  const rr = hit(OP, sim, gluedCer, 10)
  const children = rr.spawned.map(id => OP.Balloons.get(sim, id))
  t.ok(children.every(c => OP.Effects.has(c, 'glue')),
    'a glued ceramic does not release two rainbows at full speed')
  t.notOk(children[0].effects === gluedCer.effects, 'children get copies, not a shared array')

  /* ---------- explanations for the UI ---------- */

  t.section('immunity explanations')
  t.ok(/lead/i.test(OP.Damage.explainImmunity('lead', D.SHARP) || ''), 'lead/sharp is explained by name')
  t.eq(OP.Damage.explainImmunity('red', D.SHARP), null, 'no explanation when there is no immunity')

  /* ---------- safety ---------- */

  t.section('safety')
  sim = makeSim(OP)
  t.noThrow(() => hit(OP, sim, null, 5), 'hitting nothing is a no-op, not a crash')
  const dead = spawn(OP, sim, 'red')
  OP.Balloons.kill(sim, dead)
  t.eq(hit(OP, sim, dead, 5).layersPopped, 0, 'hitting a dead balloon does nothing')
  t.eq(hit(OP, sim, spawn(OP, sim, 'red'), 0).layersPopped, 0, 'zero damage does nothing')
  t.eq(hit(OP, sim, spawn(OP, sim, 'red'), -3).layersPopped, 0, 'negative damage does nothing')
  t.throws(() => { OP.Damage.hit(sim, spawn(OP, sim, 'red'), { damage: 1 }).spawned.push(1) },
    'the shared empty spawned array is frozen against accidental mutation')
}

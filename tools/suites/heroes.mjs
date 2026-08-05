export const name = 'heroes'
export const needs = ['js/core/heroes.js', 'js/towers/_HERO_TEMPLATE.js']

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

export function run (t, OP, env) {
  const H = OP.Heroes
  const D = OP.DMG

  env.evalFile('js/towers/_HERO_TEMPLATE.js')
  // Suites share one bundle and run alphabetically, so the tower template may not
  // have been loaded yet by the time this suite runs. evalFile is idempotent.
  env.evalFile('js/towers/_TEMPLATE.js')

  function sim (opts) {
    return makeSim(OP, Object.assign({ tracks: [arena(OP)], cash: 100000, lives: 200 }, opts || {}))
  }
  function spot (s, at, off) {
    const p = s.map.paths[0].posAt(at === undefined ? 320 : at)
    return { x: OP.M.clamp(p.x, 60, OP.FIELD_W - 60), y: OP.M.clamp(p.y - (off === undefined ? 55 : off), 60, OP.FIELD_H - 60) }
  }

  /* ---------- the XP curve ---------- */

  t.section('the XP curve')
  t.eq(H.MAX_LEVEL, 20, 'heroes cap at level 20')
  t.eq(H.xpForLevel(1), 0, 'level 1 needs no XP')
  t.gt(H.xpForLevel(2), 0, 'level 2 needs some')
  let rising = true
  for (let lvl = 2; lvl <= 20; lvl++) if (H.xpForLevel(lvl) <= H.xpForLevel(lvl - 1)) rising = false
  t.ok(rising, 'thresholds strictly increase all the way to 20')
  const early = H.xpForLevel(3) - H.xpForLevel(2)
  const late = H.xpForLevel(20) - H.xpForLevel(19)
  t.gt(late, early * 3, 'the curve is superlinear, so the last levels genuinely arrive late')
  t.eq(H.xpForLevel(99), H.xpForLevel(20), 'asking past the cap clamps')

  t.section('levelForXP is the inverse of xpForLevel')
  let mismatch = 0
  for (let lvl = 1; lvl <= 20; lvl++) {
    if (H.levelForXP(H.xpForLevel(lvl)) !== lvl) mismatch++
    if (lvl > 1 && H.levelForXP(H.xpForLevel(lvl) - 1) !== lvl - 1) mismatch++
  }
  t.eq(mismatch, 0, 'exactly at a threshold levels up, one short does not')
  t.eq(H.levelForXP(0), 1, 'zero XP is level 1')
  t.eq(H.levelForXP(1e12), 20, 'absurd XP caps at 20')

  /* ---------- validation ---------- */

  t.section('defineHero rejects malformed definitions')
  const okBase = { range: 120, cooldown: 1, damage: 2, pierce: 2, dmgType: D.SHARP, projSpeed: 400 }
  const fullLevels = () => {
    const out = []
    for (let lvl = 2; lvl <= 20; lvl++) out.push({ level: lvl, desc: 'does a thing', apply: function (s) { s.damage += 1 } })
    return out
  }
  let seq = 0
  const base = extra => Object.assign({
    key: 'hero-bad-' + (seq++),
    name: 'Bad Hero', title: 'the Rejected',
    blurb: 'A synthetic hero used only to prove the validator rejects bad input.',
    cost: 800,
    base: Object.assign({}, okBase),
    levels: fullLevels(),
    fire: function () {}
  }, extra)

  t.throws(() => H.define(base({ key: null })), 'a missing key throws')
  t.throws(() => H.define(base({ name: null })), 'a missing name throws')
  t.throws(() => H.define(base({ title: null })), 'a missing title throws')
  t.throws(() => H.define(base({ blurb: 'short' })), 'a stub blurb throws')
  t.throws(() => H.define(base({ cost: 0 })), 'a zero cost throws')
  t.throws(() => H.define(base({ fire: null, update: null })), 'a hero that does nothing throws')
  t.throws(() => H.define(base({ base: { range: 1 } })), 'an incomplete stat block throws')
  t.throws(() => H.define(base({ base: Object.assign({}, okBase, { dmgType: 'glitter' }) })), 'an unknown damage type throws')
  t.throws(() => H.define(base({ levels: null })), 'missing levels throws')

  t.section('every level from 2 to 20 must grant something')
  const gappy = base({})
  gappy.levels = gappy.levels.filter(l => l.level !== 7 && l.level !== 13)
  let msg = ''
  try { H.define(gappy) } catch (e) { msg = e.message }
  t.ok(/level\(s\) 7, 13/.test(msg), 'a gap is named explicitly: ' + msg)

  t.throws(() => {
    const d = base({})
    d.levels.push({ level: 5, desc: 'again', apply: function () {} })
    H.define(d)
  }, 'a duplicate level throws')
  t.throws(() => {
    const d = base({})
    d.levels[0] = { level: 1, desc: 'x', apply: function () {} }
    H.define(d)
  }, 'a level below 2 throws')
  t.throws(() => {
    const d = base({})
    d.levels[3] = { level: 5, desc: 'no apply' }
    H.define(d)
  }, 'a level without apply throws')
  t.throws(() => {
    const d = base({})
    d.levels[3] = { level: 5, apply: function () {} }
    H.define(d)
  }, 'a level without desc throws')

  t.section('a hero key cannot collide with a tower key')
  t.throws(() => H.define(base({ key: 'template-critter' })), 'colliding with a tower throws')

  /* ---------- the template must satisfy its own contract ---------- */

  t.section('js/towers/_HERO_TEMPLATE.js is a valid hero')
  const tpl = OP.HEROES['template-hero']
  t.ok(tpl, 'the template registered')
  t.eq(tpl.levels.length, 19, 'nineteen level entries, 2 through 20')
  t.ok(tpl.levels.every(l => l.desc && l.desc.length > 4), 'every level has player-facing text')
  t.ok(tpl.levelsByNumber[20], 'the level table is indexed by number')
  t.ok(OP.ABILITIES['template-hero-focus'], 'its first ability registered by key')
  t.ok(OP.ABILITIES['template-hero-shock'], 'its second ability registered by key')

  /* ---------- placement ---------- */

  t.section('placement')
  let s = sim()
  const hero = H.place(s, 'template-hero', spot(s).x, spot(s).y)
  t.ok(hero, 'a hero can be placed')
  t.eq(s.heroId, hero.id, 'the sim records which entity is the hero')
  t.eq(hero.level, 1, 'starting at level 1')
  t.eq(hero.xp, 0, 'with no XP')
  t.ok(H.isHero(hero), 'it identifies as a hero')
  t.eq(H.of(s).id, hero.id, 'and can be fetched from the sim')
  t.eq(s.cash, 100000 - tpl.cost, 'and was paid for')

  t.section('only one hero per map')
  const second = H.place(s, 'template-hero', 200, 620)
  t.eq(second, null, 'a second hero is refused')
  const why = H.canPlace(s, 'template-hero', 200, 620)
  t.notOk(why.ok, 'canPlace agrees')
  t.ok(/already have a hero/i.test(why.reason), 'and says why')

  t.section('a hero obeys the same footprint rules as a tower')
  s = sim()
  t.notOk(H.canPlace(s, 'template-hero', 5, 5).ok, 'a footprint off the map is refused')
  const poor = sim({ cash: 10 })
  t.notOk(H.canPlace(poor, 'template-hero', 400, 600).ok, 'unaffordable is refused')

  /* ---------- levelling ---------- */

  t.section('XP and levelling')
  s = sim()
  const lv = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  H.grantXP(s, H.xpForLevel(2))
  t.eq(lv.level, 2, 'reaching a threshold levels up')
  t.ok(s.events.some(e => e.kind === 'herolevel' && e.level === 2), 'and emits an event')

  t.section('levels change stats')
  const atTwo = lv.s.pierce
  H.grantXP(s, H.xpForLevel(3) - lv.xp)
  t.eq(lv.level, 3, 'level 3 reached')
  t.gt(lv.s.range, tpl.base.range, 'range grew with levels')
  t.gte(atTwo, tpl.base.pierce + 1, 'and level 2 had already added pierce')

  t.section('a big XP grant can skip several levels at once')
  s = sim()
  const jumper = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  const gained = H.grantXP(s, H.xpForLevel(9))
  t.eq(jumper.level, 9, 'jumped straight to 9')
  t.eq(gained, 8, 'and reported eight levels gained')

  t.section('levelling stops at the cap')
  s = sim()
  const capped = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  H.grantXP(s, 1e9)
  t.eq(capped.level, 20, 'level 20 reached')
  t.eq(H.grantXP(s, 1e9), 0, 'and further XP grants nothing')
  t.eq(H.progress(capped), 1, 'progress reads as complete')

  t.section('level 20 stats are a real step up from level 1')
  s = sim()
  const fresh = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  const l1 = { damage: fresh.s.damage, pierce: fresh.s.pierce, cooldown: fresh.s.cooldown, shots: fresh.s.shots }
  H.grantXP(s, 1e9)
  t.gt(fresh.s.damage, l1.damage * 3, 'damage well up')
  t.gt(fresh.s.pierce, l1.pierce * 2, 'pierce well up')
  t.lt(fresh.s.cooldown, l1.cooldown * 0.7, 'and it attacks faster')
  t.gt(fresh.s.shots, l1.shots, 'and fires more projectiles')
  t.ok(fresh.s.camoDetect, 'and sees camo')

  t.section('level effects are idempotent under repeated restat')
  const fingerprint = () => [fresh.s.damage, fresh.s.pierce, fresh.s.cooldown.toFixed(9), fresh.s.range.toFixed(6), fresh.s.shots].join('|')
  const once = fingerprint()
  OP.Towers.restat(s, fresh)
  OP.Towers.restat(s, fresh)
  OP.Towers.restat(s, fresh)
  t.eq(fingerprint(), once, 'three more restats change nothing')

  t.section('progress reports the fraction toward the next level')
  s = sim()
  const prog = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  t.eq(H.progress(prog), 0, 'zero at a fresh level')
  H.grantXP(s, H.xpForLevel(2) / 2)
  t.between(H.progress(prog), 0.3, 0.7, 'about half way')

  /* ---------- XP from play ---------- */

  t.section('a hero levels from play, not from cash')
  s = sim({ lives: 100000 })
  const player = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  for (let i = 0; i < 1800; i++) {
    if (i % 5 === 0) OP.Balloons.spawn(s, { tier: 'green', path: 0, t: 0 })
    OP.Sim.step(s)
  }
  t.gt(s.stats.layersPopped, 0, 'the hero popped things')
  t.gt(player.xp, 0, 'and gained XP from it')
  t.gt(player.level, 1, `reaching level ${player.level} without spending a coin`)

  t.section('surviving a round grants a lump of XP')
  s = makeSim(OP, {
    tracks: [arena(OP)], cash: 100000, lives: 100000,
    roundSet: { 1: { groups: [{ tier: 'red', count: 3, spacing: 0.2 }] } },
    roundSetKey: 'hero-test'
  })
  const rounder = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  const before = rounder.xp
  OP.Sim.startRound(s, 1)
  OP.Sim.run(s, 60 * 120)
  t.gt(rounder.xp, before, 'XP went up over the round')
  t.gte(s.stats.roundsCleared, 1, 'and the round was cleared')

  t.section('difficulty scales the XP rate')
  s = sim({ rules: { heroXpMul: 2 } })
  const fast = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  H.grantXP(s, 100)
  t.eq(fast.xp, 200, 'a 2x rate doubles what a grant is worth')

  /* ---------- abilities ---------- */

  t.section('abilities unlock at their levels')
  s = sim()
  const abil = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  t.notOk(abil.s.ability, 'no ability at level 1')
  H.grantXP(s, H.xpForLevel(4))
  t.ok(abil.s.ability, 'the first ability appears at level 4')
  t.eq(typeof abil.s.ability.key, 'string', 'as a string key, not a closure')
  t.notOk(abil.s.ability2, 'the second is still locked')
  H.grantXP(s, H.xpForLevel(12) - abil.xp)
  t.ok(abil.s.ability2, 'and appears at level 12')

  t.section('the first ability works through the tower path')
  const act = OP.Towers.activate(s, abil)
  t.ok(act.ok, 'it activates')
  t.gt(abil.abilityCd, 0, 'and goes on cooldown')
  t.gt(abil.data.focusT, 0, 'and had an effect')

  t.section('the second ability has its own cooldown')
  const act2 = H.activateSecond(s, abil)
  t.ok(act2.ok, 'it activates')
  t.gt(abil.ability2Cd, 0, 'on its own timer')
  t.notOk(H.canActivateSecond(s, abil).ok, 'and cannot be spammed')
  OP.Sim.run(s, 60 * 60)
  t.eq(abil.ability2Cd, 0, 'the second cooldown ticks down')

  t.section('a hero with no second ability refuses cleanly')
  s = sim()
  const low = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  t.notOk(H.canActivateSecond(s, low).ok, 'refused')
  t.ok(/no second ability/i.test(H.canActivateSecond(s, low).reason), 'with a clear reason')

  t.section('modes can disable abilities')
  s = sim({ rules: { allowAbilities: false } })
  const noAb = H.place(s, 'template-hero', spot(s).x, spot(s).y, { free: true })
  H.grantXP(s, 1e9)
  t.notOk(OP.Towers.canActivate(s, noAb).ok, 'the first ability is refused')
  t.notOk(H.canActivateSecond(s, noAb).ok, 'and so is the second')

  /* ---------- serialisation ---------- */

  t.section('a hero survives a save round-trip with its level and XP')
  s = sim()
  const saved = H.place(s, 'template-hero', spot(s).x, spot(s).y)
  H.grantXP(s, H.xpForLevel(11) + 50)
  OP.Towers.activate(s, saved)
  OP.Sim.run(s, 30)

  const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
  const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
  t.eq(back.heroId, s.heroId, 'the hero id round-trips')
  const bh = back.towerById.get(back.heroId)
  t.ok(bh, 'and resolves')
  t.eq(bh.level, saved.level, 'level restored')
  t.close(bh.xp, saved.xp, 1e-6, 'XP restored')
  t.eq(bh.heroKey, 'template-hero', 'and it still knows it is a hero')
  t.eq(bh.s.damage, saved.s.damage, 'stats recompute to the same values')
  t.eq(bh.s.shots, saved.s.shots, 'including shot count')
  t.close(bh.abilityCd, saved.abilityCd, 1e-6, 'ability cooldown restored')
  t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), 'and the whole sim checksum matches')

  t.section('a hero keeps levelling identically after a reload')
  const ctl = sim({ lives: 100000 })
  H.place(ctl, 'template-hero', spot(ctl).x, spot(ctl).y, { free: true })
  for (let i = 0; i < 900; i++) {
    if (i % 5 === 0) OP.Balloons.spawn(ctl, { tier: 'green', path: 0, t: 0 })
    OP.Sim.step(ctl)
  }
  const midSnap = JSON.parse(JSON.stringify(OP.Sim.serialize(ctl)))
  const resumed = OP.Sim.deserialize(midSnap, { key: 'test', paths: [arena(OP)] })
  let diverged = -1
  for (let i = 900; i < 1500; i++) {
    if (i % 5 === 0) {
      OP.Balloons.spawn(ctl, { tier: 'green', path: 0, t: 0 })
      OP.Balloons.spawn(resumed, { tier: 'green', path: 0, t: 0 })
    }
    OP.Sim.step(ctl); OP.Sim.step(resumed)
    if (OP.Sim.checksum(ctl) !== OP.Sim.checksum(resumed)) { diverged = i; break }
  }
  t.eq(diverged, -1, diverged < 0 ? '600 further ticks in lockstep, hero XP included' : `diverged at ${diverged}`)
  t.gt(H.of(ctl).level, 1, `and the hero did level during it (${H.of(ctl).level})`)
}

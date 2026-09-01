export const name = 'hero-roster'
export const needs = ['js/towers/heroes.js']

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

/* The hero roster, verified against the framework contract in js/core/heroes.js.
   Written separately from the roster itself: the agent that authors content should
   not also author the criteria it is graded against. */

export function run (t, OP, env) {
  const H = OP.Heroes
  const M = OP.M

  const KEYS = OP.HERO_ORDER.slice()

  function sim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 1e9, lives: 1e8, seed: 'hero-roster'
    }, opts || {}))
  }
  function spot (s, at, off) {
    const p = s.map.paths[0].posAt(at === undefined ? 320 : at)
    return {
      x: M.clamp(p.x, 70, OP.FIELD_W - 70),
      y: M.clamp(p.y - (off === undefined ? 60 : off), 70, OP.FIELD_H - 70)
    }
  }
  function place (s, key) {
    const at = spot(s)
    return H.place(s, key, at.x, at.y, { free: true })
  }

  /* ---------- the roster ---------- */

  t.section('roster')
  t.eq(KEYS.length, 20, `twenty heroes registered (${KEYS.length})`)
  t.eq(new Set(KEYS).size, KEYS.length, 'keys are unique')
  t.eq(new Set(KEYS.map(k => OP.HEROES[k].name)).size, KEYS.length, 'display names are unique')
  t.eq(new Set(KEYS.map(k => OP.HEROES[k].title)).size, KEYS.length, 'titles are unique')
  t.ok(KEYS.every(k => !OP.TOWERS[k]), 'no hero key collides with a tower key')

  t.section('no borrowed proper nouns')
  const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
  const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/
  for (const k of KEYS) {
    const d = OP.HEROES[k]
    const blob = JSON.stringify({
      name: d.name, title: d.title, blurb: d.blurb,
      levels: d.levels.map(l => l.desc)
    })
    const hit = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${k} borrows nothing` + (hit ? ` — found "${hit}"` : ''))
  }

  t.section('definitions are complete')
  for (const k of KEYS) {
    const d = OP.HEROES[k]
    t.ok(d.name && d.name.length > 2, `${k} has a display name`)
    t.ok(d.title && d.title.length > 2, `${k} has a title for the select screen`)
    t.ok(d.blurb && d.blurb.length > 25, `${k} has a real blurb`)
    t.gt(d.cost, 0, `${k} costs something`)
    t.between(d.footprint, 6, 32, `${k} has a sane footprint`)
    t.ok(['land', 'water', 'any'].indexOf(d.placement) >= 0, `${k} has a valid placement rule`)
    t.gt(d.base.range, 0, `${k} has positive range`)
    t.gt(d.base.cooldown, 0, `${k} has positive cooldown`)
    t.ok(OP.DMG_ORDER.indexOf(d.base.dmgType) >= 0, `${k} has a known damage type`)
  }

  t.section('every level from 2 to 20 grants something, with player-facing text')
  for (const k of KEYS) {
    const d = OP.HEROES[k]
    const byLevel = {}
    for (const lv of d.levels) byLevel[lv.level] = lv
    const gaps = []
    const thin = []
    for (let lvl = 2; lvl <= H.MAX_LEVEL; lvl++) {
      if (!byLevel[lvl]) { gaps.push(lvl); continue }
      const desc = String(byLevel[lvl].desc || '').trim()
      if (desc.length < 5) thin.push(lvl)
    }
    t.eq(gaps.length, 0, `${k} has an effect at every level 2-20` + (gaps.length ? ` — missing ${gaps.join(',')}` : ''))
    t.eq(thin.length, 0, `${k} explains every level` + (thin.length ? ` — thin at ${thin.join(',')}` : ''))
  }

  t.section('heroes are mechanically distinct, not one statline eight times')
  const fingerprints = KEYS.map(k => {
    const b = OP.HEROES[k].base
    return [b.range, b.cooldown, b.damage, b.pierce, b.dmgType, b.shots, !!b.camoDetect].join('|')
  })
  t.gte(new Set(fingerprints).size, 7, `at least seven distinct base statlines (${new Set(fingerprints).size} of 8)`)

  const descBlobs = KEYS.map(k => OP.HEROES[k].levels.map(l => l.desc).join(' ').toLowerCase())
  let nearDuplicates = 0
  for (let i = 0; i < descBlobs.length; i++) {
    for (let j = i + 1; j < descBlobs.length; j++) {
      if (descBlobs[i] === descBlobs[j]) nearDuplicates++
    }
  }
  t.eq(nearDuplicates, 0, 'no two heroes share an identical level table')

  t.section('at least one hero is an income hero, and it declares itself')
  // PURIST bans income towers, so an income hero that does not set the flag would
  // slip through a mode restriction it is supposed to obey.
  const incomeHeroes = KEYS.filter(k => OP.HEROES[k].income)
  const mentionsCash = KEYS.filter(k =>
    /cash|money|income|\$/i.test(OP.HEROES[k].blurb + OP.HEROES[k].levels.map(l => l.desc).join(' ')))
  t.ok(incomeHeroes.length >= 1 || mentionsCash.length === 0,
    `a hero whose text promises cash must set income: true (income: ${incomeHeroes.join(',') || 'none'}; mentions cash: ${mentionsCash.join(',') || 'none'})`)

  /* ---------- placement ---------- */

  t.section('every hero places on a real map')
  for (const k of KEYS) {
    const s = sim()
    const hero = place(s, k)
    t.ok(hero, `${k} places`)
    if (!hero) continue
    t.eq(s.heroId, hero.id, `${k} is recorded as the sim's hero`)
    t.eq(hero.level, 1, `${k} starts at level 1`)
    t.eq(hero.xp, 0, `${k} starts with no XP`)
    t.ok(H.isHero(hero), `${k} identifies as a hero`)
    t.ok(hero.s, `${k} resolved its stats`)
  }

  t.section('only one hero per map, whichever two you pick')
  const s1 = sim()
  place(s1, KEYS[0])
  for (const k of KEYS) {
    const at = spot(s1, 900, 120)
    t.eq(H.place(s1, k, at.x, at.y, { free: true }), null, `${k} is refused once a hero is placed`)
  }

  /* ---------- levelling ---------- */

  t.section('every hero levels 1 to 20 one level at a time with sane stats throughout')
  for (const k of KEYS) {
    const s = sim()
    const hero = place(s, k)
    if (!hero) continue
    let broken = null
    for (let lvl = 2; lvl <= H.MAX_LEVEL; lvl++) {
      H.grantXP(s, H.xpForLevel(lvl) - hero.xp)
      if (hero.level !== lvl) { broken = `stuck at ${hero.level} trying to reach ${lvl}`; break }
      const st = hero.s
      const bad = []
      if (!(st.cooldown > 0) || !isFinite(st.cooldown)) bad.push('cooldown ' + st.cooldown)
      if (!(st.range > 0) || !isFinite(st.range)) bad.push('range ' + st.range)
      if (!(st.damage >= 0) || !isFinite(st.damage)) bad.push('damage ' + st.damage)
      if (!(st.pierce >= 1) || !isFinite(st.pierce)) bad.push('pierce ' + st.pierce)
      if (!(st.shots >= 1) || !isFinite(st.shots)) bad.push('shots ' + st.shots)
      if (st.dmgType && OP.DMG_ORDER.indexOf(st.dmgType) < 0) bad.push('dmgType ' + st.dmgType)
      if (hero.statWarnings) bad.push('engine clamped: ' + hero.statWarnings.join('; '))
      if (bad.length) { broken = `level ${lvl}: ${bad.join(', ')}`; break }
    }
    t.ok(!broken, `${k} walks 1-20 cleanly` + (broken ? ` — ${broken}` : ''))
  }

  t.section('level effects are idempotent under repeated restat')
  for (const k of KEYS) {
    const s = sim()
    const hero = place(s, k)
    if (!hero) continue
    H.grantXP(s, H.xpForLevel(14))
    const before = fingerprint(hero.s)
    OP.Towers.restat(s, hero)
    OP.Towers.restat(s, hero)
    OP.Towers.restat(s, hero)
    t.eq(fingerprint(hero.s), before, `${k} stats unchanged after three more restats`)
  }

  t.section('level 20 genuinely out-performs level 1')
  for (const k of KEYS) {
    const fresh = throughput(k, 1)
    const maxed = throughput(k, 20)
    t.gt(maxed, fresh, `${k} at 20 out-damages level 1 (${fresh} -> ${maxed})`)
  }

  /* ---------- registry hygiene ---------- */

  t.section('every ability and behaviour key a hero grants is registered')
  for (const k of KEYS) {
    const s = sim()
    const hero = place(s, k)
    if (!hero) continue
    H.grantXP(s, 1e9)
    const st = hero.s
    if (st.ability) {
      t.eq(typeof st.ability.key, 'string', `${k} ability is a string key, not a closure`)
      t.ok(OP.ABILITIES[st.ability.key], `${k} ability "${st.ability.key}" is registered`)
      t.gt(st.ability.cooldown, 0, `${k} ability has a cooldown`)
    }
    if (st.ability2) {
      t.eq(typeof st.ability2.key, 'string', `${k} second ability is a string key`)
      t.ok(OP.ABILITIES[st.ability2.key], `${k} second ability "${st.ability2.key}" is registered`)
    }
    if (st.behaviour) {
      t.ok(OP.PROJ_BEHAVIOURS[st.behaviour], `${k} behaviour "${st.behaviour}" is registered`)
    }
  }

  t.section('every projectile kind a hero emits is declared')
  const emitted = {}
  for (const k of KEYS) {
    const s = sim({ lives: 1e9 })
    const hero = place(s, k)
    if (!hero) continue
    H.grantXP(s, 1e9)
    for (let i = 0; i < 600; i++) {
      if (i % 10 === 0) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 0 })
      OP.Sim.step(s)
    }
    for (const kind in s.kindsSeen) emitted[kind] = true
  }
  const undeclared = Object.keys(emitted).filter(x => !OP.PROJ_KINDS[x])
  t.eq(undeclared.length, 0, undeclared.length
    ? `undeclared kinds render as nothing: ${undeclared.join(', ')}`
    : `all ${Object.keys(emitted).length} emitted kinds are declared`)

  t.section('a hero with no ability at low level refuses activation cleanly')
  const lowSim = sim()
  const low = place(lowSim, KEYS[0])
  const check = OP.Towers.canActivate(lowSim, low)
  t.ok(typeof check.reason === 'string', 'a refusal always carries a reason string')

  /* ---------- abilities in play ---------- */

  t.section('a maxed hero can fire whatever abilities it has')
  for (const k of KEYS) {
    const s = sim({ lives: 1e9 })
    const hero = place(s, k)
    if (!hero) continue
    H.grantXP(s, 1e9)
    for (let i = 0; i < 24; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 60 + i * 24 })
    OP.Sim.run(s, 90)
    if (hero.s.ability) {
      const res = OP.Towers.activate(s, hero)
      t.ok(res.ok, `${k} first ability activates` + (res.ok ? '' : ` — ${res.reason}`))
      t.gt(hero.abilityCd, 0, `${k} first ability goes on cooldown`)
    }
    if (hero.s.ability2) {
      const res2 = H.activateSecond(s, hero)
      t.ok(res2.ok, `${k} second ability activates` + (res2.ok ? '' : ` — ${res2.reason}`))
      t.gt(hero.ability2Cd, 0, `${k} second ability goes on its own cooldown`)
    }
    t.noThrow(() => OP.Sim.run(s, 240), `${k} survives 4s of play after activating`)
  }

  /* ---------- serialisation ---------- */

  t.section('every hero survives a save round-trip with level and XP intact')
  for (const k of KEYS) {
    const s = sim()
    const hero = place(s, k)
    if (!hero) continue
    H.grantXP(s, H.xpForLevel(13) + 25)
    if (hero.s.ability) OP.Towers.activate(s, hero)
    OP.Sim.run(s, 60)

    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
    const bh = back.towerById.get(back.heroId)
    t.ok(bh, `${k} comes back from a save`)
    if (!bh) continue
    t.eq(bh.heroKey, k, `${k} still knows it is a hero`)
    t.eq(bh.level, hero.level, `${k} level restored`)
    t.close(bh.xp, hero.xp, 1e-6, `${k} XP restored`)
    t.eq(fingerprint(bh.s), fingerprint(hero.s), `${k} stats recompute identically`)
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), `${k} whole-sim checksum matches`)
  }

  t.section('a hero keeps levelling identically after a reload')
  const ctl = sim({ lives: 1e9 })
  place(ctl, KEYS[0])
  for (let i = 0; i < 600; i++) {
    if (i % 6 === 0) OP.Balloons.spawn(ctl, { tier: 'green', path: 0, t: 0 })
    OP.Sim.step(ctl)
  }
  const midSnap = JSON.parse(JSON.stringify(OP.Sim.serialize(ctl)))
  const resumed = OP.Sim.deserialize(midSnap, { key: 'test', paths: [arena(OP)] })
  let diverged = -1
  for (let i = 600; i < 1200; i++) {
    if (i % 6 === 0) {
      OP.Balloons.spawn(ctl, { tier: 'green', path: 0, t: 0 })
      OP.Balloons.spawn(resumed, { tier: 'green', path: 0, t: 0 })
    }
    OP.Sim.step(ctl); OP.Sim.step(resumed)
    if (OP.Sim.checksum(ctl) !== OP.Sim.checksum(resumed)) { diverged = i; break }
  }
  t.eq(diverged, -1, diverged < 0
    ? '600 further ticks in lockstep, hero XP included'
    : `diverged at tick ${diverged}`)
  t.gt(H.of(ctl).level, 1, `and the hero really did level during it (${H.of(ctl).level})`)

  /* ---------- helpers ---------- */

  function fingerprint (st) {
    const keys = Object.keys(st).filter(x => typeof st[x] !== 'object' || st[x] === null).sort()
    return keys.map(x => `${x}=${typeof st[x] === 'number' ? st[x].toFixed(6) : st[x]}`).join('|')
  }

  /** Damage landed against a sustained stream, at a given level. */
  function throughput (key, level) {
    const s = sim({ lives: 1e9, seed: 'hero-measure' })
    const hero = place(s, key)
    if (!hero) return 0
    if (level > 1) H.grantXP(s, H.xpForLevel(level))
    for (let i = 0; i < 900; i++) {
      if (i % 12 === 0) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 0 })
      OP.Sim.step(s)
    }
    return s.stats.damageDealt
  }
}

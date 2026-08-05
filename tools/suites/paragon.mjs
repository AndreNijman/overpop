export const name = 'paragon'
export const needs = ['js/core/paragon.js', 'js/towers/_PARAGON_TEMPLATE.js']

import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'

export function run (t, OP, env) {
  const P = OP.Paragon

  // The paragon template is declared against the tower template, so both load.
  env.evalFile('js/towers/_TEMPLATE.js')
  env.evalFile('js/towers/_PARAGON_TEMPLATE.js')

  function sim (opts) {
    return makeSim(OP, Object.assign({ tracks: [arena(OP)], cash: 100000000, lives: 100000 }, opts || {}))
  }

  /** Place n towers of the template type, each maxed on branch 0. */
  function build (s, n, tiersEach) {
    const out = []
    for (let i = 0; i < n; i++) {
      const x = 90 + (i % 8) * 130
      const y = 640 - Math.floor(i / 8) * 90
      const tower = OP.Towers.place(s, 'template-critter', x, y, { free: true })
      if (!tower) continue
      for (let k = 0; k < (tiersEach === undefined ? 5 : tiersEach); k++) OP.Upgrades.buy(s, tower, 0)
      out.push(tower)
    }
    return out
  }

  /* ---------- validation ---------- */

  t.section('defineParagon rejects malformed definitions')
  const base = extra => Object.assign({
    towerKey: 'template-critter',
    name: 'Bad Paragon',
    blurb: 'A synthetic paragon used only to prove the validator rejects bad input.',
    cost: 100000,
    apply: function () {}
  }, extra)

  t.throws(() => P.define(base({ towerKey: null })), 'a missing towerKey throws')
  t.throws(() => P.define(base({ towerKey: 'no-such-tower' })),
    'naming a tower that does not exist throws — a renamed tower must fail here')
  t.throws(() => P.define(base({})), 'a duplicate paragon for the same tower throws')
  t.throws(() => P.define(base({ towerKey: 'template-hero' })), 'an unregistered key throws')

  // A second tower so the remaining validation cases have somewhere to attach.
  const okPath = n => ({
    name: n,
    tiers: OP.Upgrades.COST_LADDER.map((band, i) => ({
      name: n + (i + 1),
      cost: Math.round(200 * (band.min + band.max) / 2),
      desc: 'does a thing',
      apply: function (s) { s.damage += 1 }
    }))
  })
  if (!OP.TOWERS['paragon-host']) {
    OP.Towers.define({
      key: 'paragon-host', name: 'Paragon Host', family: 'primary',
      blurb: 'A synthetic host tower for exercising the paragon validator.',
      cost: 200, footprint: 12,
      base: { range: 150, cooldown: 0.9, damage: 2, pierce: 2, dmgType: OP.DMG.SHARP, projSpeed: 500 },
      paths: [okPath('A'), okPath('B'), okPath('C')],
      fire: function () {}
    })
  }
  t.throws(() => P.define(base({ towerKey: 'paragon-host', name: null })), 'a missing name throws')
  t.throws(() => P.define(base({ towerKey: 'paragon-host', blurb: 'nope' })), 'a stub blurb throws')
  t.throws(() => P.define(base({ towerKey: 'paragon-host', cost: 0 })), 'a zero cost throws')
  t.throws(() => P.define(base({ towerKey: 'paragon-host', apply: null })), 'a missing apply throws')
  t.throws(() => P.define(base({ towerKey: 'paragon-host', ability: { cooldown: 5 } })), 'an ability without a key throws')
  t.throws(() => P.define(base({ towerKey: 'paragon-host', ability: { key: 'x', cooldown: 0 } })), 'an ability without a cooldown throws')

  t.section('js/towers/_PARAGON_TEMPLATE.js is valid')
  const tpl = P.forTower('template-critter')
  t.ok(tpl, 'the template paragon registered against the template tower')
  t.ok(P.exists('template-critter'), 'exists() agrees')
  t.notOk(P.exists('paragon-host'), 'and reports false for a tower without one')
  t.eq(tpl.minTier, 5, 'it requires a tier-5 upgrade by default')
  t.ok(OP.ABILITIES['template-paragon-storm'], 'its ability registered by key')
  t.ok(P.all().length >= 1, 'all() lists it')

  /* ---------- the degree formula ---------- */

  t.section('the degree formula')
  t.eq(P.MAX_DEGREE, 100, 'degrees run to 100')
  t.eq(P.degreeFrom(0, 0, 0), 1, 'a bare minimum sacrifice is still degree 1')
  t.eq(P.degreeFrom(1e9, 1e9, 1e9), 100, 'an enormous one caps at 100')

  let rising = true
  let prev = 0
  for (let mult = 0; mult <= 20; mult++) {
    const d = P.degreeFrom(mult * 4000, mult * 8, mult * 20000)
    if (d < prev) rising = false
    prev = d
  }
  t.ok(rising, 'degree never decreases as the sacrifice grows')

  t.section('no single contribution can carry the degree alone')
  // Each term is capped at the full range then the three are averaged, so a
  // player cannot buy degree 100 with cash alone, and equally cannot be locked
  // out for having farmed pops instead of upgrades.
  const cashOnly = P.degreeFrom(1e9, 0, 0)
  const tiersOnly = P.degreeFrom(0, 1e9, 0)
  const popsOnly = P.degreeFrom(0, 0, 1e9)
  t.lte(cashOnly, 35, `cash alone reaches only degree ${cashOnly}`)
  t.lte(tiersOnly, 35, `tiers alone reaches only degree ${tiersOnly}`)
  t.lte(popsOnly, 35, `pops alone reaches only degree ${popsOnly}`)
  t.gt(P.degreeFrom(1e9, 1e9, 0), cashOnly, 'two contributions beat one')
  t.gt(P.degreeFrom(1e9, 1e9, 1e9), P.degreeFrom(1e9, 1e9, 0), 'and three beat two')

  /* ---------- eligibility ---------- */

  t.section('eligibility')
  let s = sim()
  const lone = OP.Towers.place(s, 'template-critter', 300, 620, { free: true })
  let pv = P.preview(s, lone)
  t.notOk(pv.ok, 'an unupgraded tower cannot be promoted')
  t.ok(/tier-5/.test(pv.reason), 'and the reason says what it needs')

  for (let i = 0; i < 5; i++) OP.Upgrades.buy(s, lone, 0)
  pv = P.preview(s, lone)
  t.ok(pv.ok, 'a tier-5 tower can be')
  t.gte(pv.degree, 1, 'with a degree of at least 1')
  t.eq(pv.sacrifices.length, 0, 'and nothing else on the board to consume')

  t.section('a tower without a paragon is refused')
  s = sim()
  const hostTower = OP.Towers.place(s, 'paragon-host', 300, 620, { free: true })
  for (let i = 0; i < 5; i++) OP.Upgrades.buy(s, hostTower, 0)
  t.notOk(P.preview(s, hostTower).ok, 'refused')
  t.ok(/no paragon/i.test(P.preview(s, hostTower).reason), 'and says so')

  t.section('heroes cannot become paragons')
  env.evalFile('js/towers/_HERO_TEMPLATE.js')
  s = sim()
  const hero = OP.Heroes.place(s, 'template-hero', 300, 620, { free: true })
  t.notOk(P.preview(s, hero).ok, 'refused')

  t.section('more towers on the board means a higher degree')
  const small = sim(); const big = sim()
  const fewTowers = build(small, 2)
  const manyTowers = build(big, 10)
  const smallDeg = P.preview(small, fewTowers[0]).degree
  const bigDeg = P.preview(big, manyTowers[0]).degree
  t.gt(bigDeg, smallDeg, `ten towers give a higher degree than two (${smallDeg} -> ${bigDeg})`)
  t.eq(P.preview(big, manyTowers[0]).sacrifices.length, 9, 'nine of the ten would be consumed')

  t.section('only towers of the same type count')
  s = sim()
  const mine = build(s, 3)
  const other = OP.Towers.place(s, 'paragon-host', 90, 520, { free: true })
  for (let i = 0; i < 3; i++) OP.Upgrades.buy(s, other, 0)
  t.eq(P.preview(s, mine[0]).sacrifices.length, 2, 'the other type is not consumed')
  t.ok(other.id > 0, 'and it is still standing')

  /* ---------- promotion ---------- */

  t.section('promotion')
  s = sim()
  const roster = build(s, 6)
  const chosen = roster[0]
  const expectDegree = P.preview(s, chosen).degree
  const cashBefore = s.cash
  const res = P.promote(s, chosen)

  t.ok(res.ok, 'promotion succeeds')
  t.eq(res.degree, expectDegree, 'at the previewed degree')
  t.eq(chosen.paragonDegree, expectDegree, 'recorded on the tower')
  t.eq(s.towers.length, 1, 'the other five were consumed')
  t.eq(s.towerById.get(chosen.id), chosen, 'and the promoted tower kept its id')
  t.lt(s.cash, cashBefore, 'the promotion was paid for')
  t.ok(s.events.some(e => e.kind === 'paragon' && e.degree === expectDegree), 'and emitted an event')
  t.eq(P.countOnBoard(s, 'template-critter'), 1, 'one paragon on the board')

  t.section('sacrifices are consumed, not refunded')
  s = sim()
  const doomed = build(s, 5)
  const cashAtStart = s.cash
  P.promote(s, doomed[0])
  t.lt(s.cash, cashAtStart, 'cash only went down — this is a sacrifice, not a sale')

  t.section('only one paragon of a type per map')
  s = sim()
  const two = build(s, 8)
  P.promote(s, two[0])
  const another = OP.Towers.place(s, 'template-critter', 90, 520, { free: true })
  for (let i = 0; i < 5; i++) OP.Upgrades.buy(s, another, 0)
  const blocked = P.preview(s, another)
  t.notOk(blocked.ok, 'a second is refused')
  t.ok(/one paragon of a type/i.test(blocked.reason), 'and says why')
  t.notOk(P.promote(s, another).ok, 'promote refuses too')

  t.section('an already-promoted tower cannot be promoted again')
  t.notOk(P.preview(s, two[0]).ok, 'refused')
  t.ok(/already a paragon/i.test(P.preview(s, two[0]).reason), 'with a clear reason')

  t.section('promotion is refused without the cash')
  // Build with plenty of cash, then drain it — otherwise the upgrades never land
  // and the refusal would be "needs a tier-5 upgrade" rather than "not enough cash".
  s = sim()
  const broke = build(s, 3)
  s.cash = 100
  const r = P.promote(s, broke[0])
  t.notOk(r.ok, 'refused')
  t.ok(/cash/i.test(r.reason), 'because of cash')
  t.eq(s.towers.length, 3, 'and nothing was consumed')

  /* ---------- paragon stats ---------- */

  t.section('a paragon is a large step up from a tier-5 tower')
  s = sim()
  const reference = build(s, 1)[0]
  const refStats = { damage: reference.s.damage, pierce: reference.s.pierce, cooldown: reference.s.cooldown, range: reference.s.range }

  const s2 = sim()
  const promoted = build(s2, 10)[0]
  P.promote(s2, promoted)

  t.gt(promoted.s.damage, refStats.damage * 2, 'much more damage')
  t.gt(promoted.s.pierce, refStats.pierce, 'more pierce')
  t.lt(promoted.s.cooldown, refStats.cooldown, 'faster')
  t.gt(promoted.s.range, refStats.range, 'longer range')
  t.ok(promoted.s.camoDetect, 'and always sees camo')
  t.ok(promoted.s.isParagon, 'the stat block is flagged as a paragon')
  t.eq(promoted.s.paragonDegree, promoted.paragonDegree, 'and carries the degree')
  t.eq(promoted.s.dmgType, OP.DMG.VOID, 'the template paragon deals void damage')
  t.ok(promoted.s.ability, 'and has its ability')
  t.eq(promoted.s.ability.key, 'template-paragon-storm', 'by key')

  t.section('degree actually scales the result')
  function degreeStats (towerCount) {
    const sx = sim()
    const list = build(sx, towerCount)
    P.promote(sx, list[0])
    return { degree: list[0].paragonDegree, damage: list[0].s.damage, shots: list[0].s.shots }
  }
  const low = degreeStats(2)
  const high = degreeStats(14)
  t.gt(high.degree, low.degree, `degree rose with the sacrifice (${low.degree} -> ${high.degree})`)
  t.gt(high.damage, low.damage, 'and so did damage')
  t.gte(high.shots, low.shots, 'and the volley did not shrink')

  t.section('void damage ignores every immunity')
  s = sim({ lives: 1000000 })
  const voider = build(s, 10)[0]
  P.promote(s, voider)
  // Move it next to the track and feed it the things nothing else can touch.
  const p = s.map.paths[0].posAt(320)
  voider.x = OP.M.clamp(p.x, 60, 1220)
  voider.y = OP.M.clamp(p.y - 50, 60, 660)
  OP.Towers.restat(s, voider)
  for (let i = 0; i < 300; i++) {
    if (i % 20 === 0) OP.Balloons.spawn(s, { tier: 'lead', path: 0, t: 0 })
    OP.Sim.step(s)
  }
  t.gt(s.stats.popped, 0, 'a void paragon pops lead, which no sharp tower can')

  t.section('the paragon ability runs')
  s = sim({ lives: 1000000 })
  const abil = build(s, 10)[0]
  P.promote(s, abil)
  const ap = s.map.paths[0].posAt(320)
  abil.x = OP.M.clamp(ap.x, 60, 1220); abil.y = OP.M.clamp(ap.y - 50, 60, 660)
  OP.Towers.restat(s, abil)
  for (let i = 0; i < 12; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 100 + i * 20 })
  OP.Sim.run(s, 30)
  const act = OP.Towers.activate(s, abil)
  t.ok(act.ok, 'it activates')
  t.gt(abil.abilityCd, 0, 'and goes on cooldown')
  t.gt(s.blastEvents.length, 0, 'and produced blasts')

  t.section('a paragon that overrides fire() uses its own attack')
  t.ok(P.fireFor(abil), 'the template paragon supplies a fire function')
  t.eq(P.fireFor({ key: 'paragon-host' }), null, 'a paragon without one returns null so the base attack is used')

  t.section('display name changes once promoted')
  t.eq(OP.Towers.displayName(abil), tpl.name, 'the paragon name is shown')
  t.eq(OP.Towers.displayName(reference), OP.TOWERS['template-critter'].name, 'and an unpromoted tower keeps its own')

  /* ---------- serialisation ---------- */

  t.section('a paragon survives a save round-trip')
  s = sim({ lives: 1000000 })
  const saved = build(s, 9)[0]
  P.promote(s, saved)
  OP.Sim.run(s, 60)

  const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
  const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
  const bp = back.towerById.get(saved.id)
  t.ok(bp, 'the paragon comes back')
  t.eq(bp.paragonDegree, saved.paragonDegree, 'with its degree')
  t.eq(bp.s.damage, saved.s.damage, 'and stats recomputed to the same values')
  t.eq(bp.s.dmgType, saved.s.dmgType, 'including damage type')
  t.eq(bp.s.shots, saved.s.shots, 'and shot count')
  t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), 'and the whole sim checksum matches')

  t.section('a promoted board keeps simulating identically after a reload')
  const ctl = sim({ lives: 1000000 })
  const ctlPara = build(ctl, 9)[0]
  P.promote(ctl, ctlPara)
  const cp = ctl.map.paths[0].posAt(320)
  ctlPara.x = OP.M.clamp(cp.x, 60, 1220); ctlPara.y = OP.M.clamp(cp.y - 50, 60, 660)
  OP.Towers.restat(ctl, ctlPara)
  for (let i = 0; i < 200; i++) {
    if (i % 10 === 0) OP.Balloons.spawn(ctl, { tier: 'ceramic', path: 0, t: 0 })
    OP.Sim.step(ctl)
  }
  const midSnap = JSON.parse(JSON.stringify(OP.Sim.serialize(ctl)))
  const resumed = OP.Sim.deserialize(midSnap, { key: 'test', paths: [arena(OP)] })
  let diverged = -1
  for (let i = 200; i < 600; i++) {
    if (i % 10 === 0) {
      OP.Balloons.spawn(ctl, { tier: 'ceramic', path: 0, t: 0 })
      OP.Balloons.spawn(resumed, { tier: 'ceramic', path: 0, t: 0 })
    }
    OP.Sim.step(ctl); OP.Sim.step(resumed)
    if (OP.Sim.checksum(ctl) !== OP.Sim.checksum(resumed)) { diverged = i; break }
  }
  t.eq(diverged, -1, diverged < 0 ? '400 further ticks in lockstep with a paragon on the board' : `diverged at ${diverged}`)
  t.gt(ctl.stats.popped, 0, 'and the paragon was actually working')
}

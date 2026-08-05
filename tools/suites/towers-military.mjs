// The military family: reach and utility rather than local damage.
//
// The shared floor (_towerfamily.mjs) proves these seven towers are well-formed,
// priced inside the ladder, upgradeable through every legal state and capable of
// popping something. It cannot know what makes THIS family worth its money, so
// everything after the floor call tests a specific claim a desc makes: that the
// camo upgrade really hits a Veiled balloon, that the shatter upgrade really
// cracks Lead, that the mortar really shells the point it was told to and not
// the balloon it can see, that the downwash really moves balloons backwards.

import { assertFamily, arena } from './_towerfamily.mjs'
import { makeSim } from './_fixture.mjs'

export const name = 'towers-military'
export const needs = ['js/towers/military.js']

export function run (t, OP, env) {
  const defs = assertFamily(t, OP, 'military', { expect: 7 })
  if (!defs.length) return

  const D = OP.DMG
  const M = OP.M

  /* ---------- local fixtures ---------- */

  // A straight track across the middle of the field. Everything below reasons
  // about geometry, and a serpentine makes "is the shell landing where I aimed"
  // much harder to state than it needs to be.
  function line (len) {
    return new OP.Track([{ x: 20, y: 360 }, { x: 20 + (len || 1240), y: 360 }])
  }

  function sim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [line()], cash: 100000000, lives: 100000, seed: 'mil'
    }, opts || {}))
  }

  function place (s, key, x, y) {
    return OP.Towers.place(s, key, x, y, { free: true })
  }

  /** Buy a tower up to a tier triple, free of charge concerns. */
  function upgrade (s, tower, target) {
    let guard = 0
    while (tower.tiers.join() !== target.join() && guard++ < 32) {
      let bought = false
      for (let p = 0; p < 3; p++) {
        if (tower.tiers[p] >= target[p]) continue
        if (OP.Upgrades.buy(s, tower, p).ok) { bought = true; break }
      }
      if (!bought) break
    }
    return tower.tiers.join() === target.join()
  }

  function stream (s, tier, n, from, step, props) {
    for (let i = 0; i < n; i++) {
      OP.Balloons.spawn(s, { tier: tier, path: 0, t: from + i * (step || 10), props: props || 0 })
    }
  }

  /** Place one tower, feed it a stream of one tier, return the sim. */
  function trial (key, target, tier, opts) {
    opts = opts || {}
    const s = sim(opts)
    const tower = place(s, key, opts.x === undefined ? 400 : opts.x, opts.y === undefined ? 460 : opts.y)
    if (target) upgrade(s, tower, target)
    stream(s, tier, opts.count || 30, opts.from === undefined ? 300 : opts.from, opts.step, opts.props)
    OP.Sim.run(s, opts.ticks || 420)
    return { s: s, tower: tower }
  }

  const T = {}
  for (const d of defs) T[d.key] = d

  /* ---------- roster shape ---------- */

  t.section('military: the roster is the seven towers the phase asked for')
  const want = ['longshot-lynx', 'diver-otter', 'corsair-beaver', 'biplane-magpie',
    'rotor-kestrel', 'howitzer-mole', 'gatling-raccoon']
  t.deep(OP.FAMILY_ROSTERS.military, want, 'declared roster matches the design brief, in order')
  for (const k of want) t.ok(T[k], k + ' is registered')

  t.section('military: it is priced as the expensive-but-flexible family')
  for (const d of defs) {
    t.between(d.cost, 350, 1200, `${d.key} base cost ${d.cost} sits in the family band`)
    t.notOk(d.income, `${d.key} is not an income tower (PURIST bans those)`)
  }
  const water = defs.filter(d => d.placement === 'water').map(d => d.key)
  t.deep(water, ['diver-otter', 'corsair-beaver'], 'exactly the two boats are water-only')
  t.eq(defs.filter(d => d.placement === 'any').length, 2, 'the two aircraft can be placed on land or water')

  t.section('military: no apply() touches the tower it is applied to')
  // Contract rule 2: apply(s, tower, sim) mutates the stat object and nothing
  // else. A Proxy that throws on any property access proves it, cheaply, for all
  // 105 upgrades at once — a hidden counter on `tower` would otherwise only
  // surface as a mid-round-save bug.
  const tripwire = new Proxy({}, {
    get (_o, k) { throw new Error('apply() read tower.' + String(k)) },
    set (_o, k) { throw new Error('apply() wrote tower.' + String(k)) }
  })
  for (const d of defs) {
    t.noThrow(function () {
      for (const path of d.paths) {
        const s = Object.assign({}, d.base)
        for (const up of path.tiers) up.apply(s, tripwire, null)
      }
    }, `${d.key}: every upgrade in every branch ignores the tower object`)
  }

  t.section('military: every ability and behaviour an upgrade names is registered')
  for (const d of defs) {
    const missing = []
    for (const path of d.paths) {
      const s = Object.assign({}, d.base)
      for (const up of path.tiers) {
        up.apply(s, tripwire, null)
        if (s.ability && !OP.ABILITIES[s.ability.key]) missing.push(s.ability.key)
        if (s.behaviour && !OP.PROJ_BEHAVIOURS[s.behaviour]) missing.push(s.behaviour)
      }
    }
    t.eq(missing.length, 0, `${d.key} names only registered keys` + (missing.length ? ': ' + missing.join(', ') : ''))
  }

  /* ================================================== 1. LONGSHOT LYNX ========= */

  t.section('longshot-lynx: range is not a constraint on it')
  const lynx = T['longshot-lynx']
  t.gt(lynx.base.range, 1280, 'base range covers the whole field (' + lynx.base.range + ')')
  t.ok(lynx.base.ignoresLOS, 'it ignores line of sight, so terrain never blocks it')
  {
    // Bottom-right corner, balloons entering top-left. Nothing about this
    // placement is good, and it should not matter.
    const s = sim({ blockers: [{ x: 300, y: 200, w: 600, h: 320 }] })
    place(s, 'longshot-lynx', 1200, 660)
    stream(s, 'red', 30, 60, 9)
    OP.Sim.run(s, 420)
    t.gt(s.stats.popped, 0, 'a Lynx in the far corner, behind a wall, still pops balloons across the map')
  }

  t.section('longshot-lynx: Lead needs the shatter branch')
  {
    const base = trial('longshot-lynx', null, 'lead', { count: 10, step: 16 })
    t.eq(base.s.stats.popped, 0, 'sharp rounds do nothing to Lead')
    t.eq(base.tower.s.dmgType, D.SHARP, 'and it starts on sharp damage')

    const shattered = trial('longshot-lynx', [3, 0, 0], 'lead', { count: 10, step: 16 })
    t.eq(shattered.tower.s.dmgType, D.SHATTER, 'Shatter Rounds converts the damage type')
    t.gt(shattered.s.stats.popped, 0, 'and shatter cracks Lead open — no tier resists it')
  }

  t.section('longshot-lynx: Veiled balloons need the Thermal Sight branch')
  {
    const blind = trial('longshot-lynx', null, 'red', { count: 12, step: 14, props: OP.PROP.VEILED })
    t.eq(blind.s.stats.popped, 0, 'it cannot even target a Veiled balloon at base')
    t.notOk(blind.tower.s.camoDetect, 'and does not claim to')

    const seeing = trial('longshot-lynx', [0, 0, 3], 'red', { count: 12, step: 14, props: OP.PROP.VEILED })
    t.ok(seeing.tower.s.camoDetect, 'Thermal Sight sets camoDetect')
    t.gt(seeing.s.stats.popped, 0, 'and the same Veiled stream now pops')
  }

  t.section('longshot-lynx: the crosspath rules make you choose between Lead and Veiled')
  {
    const s = sim()
    const tower = place(s, 'longshot-lynx', 400, 460)
    t.ok(upgrade(s, tower, [3, 0, 2]), 'shatter at branch-0 tier 3 with two spotting tiers is legal')
    t.eq(tower.s.dmgType, D.SHATTER, 'that build answers Lead')
    t.notOk(tower.s.camoDetect, 'but it cannot also reach Thermal Sight — one branch past tier 2')
    t.notOk(OP.Upgrades.canBuy(tower, 2).ok, 'and the engine refuses the third spotting tier')
  }

  t.section('longshot-lynx: Split Focus engages separate balloons')
  {
    const s = sim()
    const tower = place(s, 'longshot-lynx', 400, 460)
    upgrade(s, tower, [0, 0, 3])
    t.eq(tower.s.shots, 3, 'Thermal Sight fires three rounds')
    t.ok(tower.s.multiTarget, 'and marks itself multi-target')
    stream(s, 'red', 6, 300, 60)
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.projectiles.length
    lynx.fire(s, tower, s.balloons[0])
    const shots = s.projectiles.slice(before)
    t.eq(shots.length, 3, 'one volley emits three projectiles')
    const angles = new Set(shots.map(p => Math.atan2(p.vy, p.vx).toFixed(3)))
    t.eq(angles.size, 3, 'aimed along three distinct bearings — three separate balloons, not a shotgun')
  }

  t.section('longshot-lynx: the spotter network reaches every other Lynx, at any distance')
  {
    const s = sim()
    const spotter = place(s, 'longshot-lynx', 200, 620)
    const far = place(s, 'longshot-lynx', 1150, 90)
    const soloDamage = far.s.damage
    t.notOk(far.s.camoDetect, 'an unupgraded Lynx sees nothing')
    upgrade(s, spotter, [0, 0, 4])
    t.ok(far.s.camoDetect, "Spotter's Net grants Veiled detection to the other Lynx across the whole map")
    t.gt(far.s.damage, soloDamage, 'and raises its damage (' + soloDamage + ' -> ' + far.s.damage + ')')
    const net = s.buffs.filter(b => b.sourceId === spotter.id)
    t.eq(net.length, 1, 'the network is one registered buff')
    t.ok(net[0].excludeSelf, 'declared excludeSelf, so a lone Lynx cannot buff itself')
    t.eq(spotter.s.damage, spotter.sBase.damage, 'and the spotter gains nothing from its own network')
    t.gt(far.s.damage, far.sBase.damage, 'while the other Lynx clearly does')

    const otherFamily = place(s, 'gatling-raccoon', 700, 620)
    t.notOk(otherFamily.s.camoDetect, 'and the network is keyed to Lynxes only, not the whole family')

    const value = far.s.damage
    OP.Towers.sell(s, spotter)
    t.eq(s.buffs.length, 0, 'selling the spotter unregisters the network')
    t.notOk(far.s.camoDetect, 'and the other Lynx goes blind again')
    t.lt(far.s.damage, value, 'and loses the damage bonus')
  }

  t.section('longshot-lynx: Called Shot is a real ability, not a label')
  {
    const s = sim()
    const tower = place(s, 'longshot-lynx', 400, 460)
    upgrade(s, tower, [5, 0, 0])
    t.ok(tower.s.ability, 'the tier-5 upgrade attaches an ability')
    t.eq(typeof tower.s.ability.key, 'string', 'as a string key, never a closure')
    stream(s, 'ceramic', 6, 300, 40)
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.stats.shotsFired
    const res = OP.Towers.activate(s, tower)
    t.ok(res.ok, 'it activates: ' + res.reason)
    t.gt(s.stats.shotsFired - before, 1, 'and fires a volley of ' + (s.stats.shotsFired - before) + ' rounds at once')
    t.gt(tower.abilityCd, 0, 'and goes on cooldown')
  }

  /* ================================================== 2. DIVER OTTER =========== */

  t.section('diver-otter: sonar hands Veiled detection to its neighbours')
  {
    // A Lynx alone cannot see a Veiled balloon. Put an Otter next to it with
    // Sonar Burst and it can — that is the whole point of the branch.
    const without = sim()
    const blindLynx = place(without, 'longshot-lynx', 400, 460)
    stream(without, 'red', 12, 300, 14, OP.PROP.VEILED)
    OP.Sim.run(without, 420)
    t.eq(without.stats.popped, 0, 'control: the Lynx alone pops nothing Veiled')
    t.notOk(blindLynx.s.camoDetect, 'control: and has no detection')

    const with_ = sim()
    const otter = place(with_, 'diver-otter', 460, 470)
    const helped = place(with_, 'longshot-lynx', 400, 460)
    upgrade(with_, otter, [0, 3, 0])
    t.eq(otter.s.sonarTier, 1, 'Sonar Burst raises the sonar tier')
    t.ok(helped.s.camoDetect, 'the neighbouring Lynx now sees Veiled balloons')
    stream(with_, 'red', 12, 300, 14, OP.PROP.VEILED)
    OP.Sim.run(with_, 420)
    t.gt(with_.stats.popped, 0, 'and the Veiled stream is popped')

    const aura = with_.buffs.filter(b => b.sourceId === otter.id)
    t.eq(aura.length, 1, 'the sonar is a single registered buff, not a reach into the neighbour')
    t.neq(aura[0].radius, 'global', 'and it is a radius, not global')
  }

  t.section('diver-otter: two overlapping sonars resolve identically in both placement orders')
  {
    // The exact bug the unbuffed-stats rule exists to prevent: an aura radius
    // derived from tower.s would grow for whichever Otter was placed second.
    function pair (first, second) {
      const s = sim()
      const a = place(s, 'diver-otter', first[0], first[1])
      upgrade(s, a, [0, 5, 0])
      const b = place(s, 'diver-otter', second[0], second[1])
      upgrade(s, b, [0, 5, 0])
      const byPos = [a, b].sort((p, q) => p.x - q.x)
      return {
        radii: s.buffs.slice().sort((p, q) => p.x - q.x).map(x => Math.round(x.radius * 1000)),
        ranges: byPos.map(x => Math.round(x.s.range * 1000))
      }
    }
    const ab = pair([400, 470], [520, 470])
    const ba = pair([520, 470], [400, 470])
    t.deep(ab.radii, ba.radii, 'aura radii are the same whichever Otter went down first')
    t.deep(ab.ranges, ba.ranges, 'and so are the resolved ranges')
    t.eq(ab.radii.length, 2, 'both sonars registered')
  }

  t.section('diver-otter: the harpoon branch gives up everything that is not a blimp')
  {
    const s = sim()
    const tower = place(s, 'diver-otter', 400, 400)
    upgrade(s, tower, [0, 0, 4])
    t.ok(tower.s.onlyBlimps, "Whaler's Harpoon sets onlyBlimps")
    t.gt(tower.s.blimpBonus, 100, 'and carries a large blimp bonus (' + tower.s.blimpBonus + ')')

    stream(s, 'ceramic', 12, 300, 14)
    OP.Sim.run(s, 420)
    t.eq(s.stats.shotsFired, 0, 'it will not even shoot at Ceramics')

    const b = sim()
    const harpoon = place(b, 'diver-otter', 400, 400)
    upgrade(b, harpoon, [0, 0, 4])
    OP.Balloons.spawn(b, { tier: 'goliath', path: 0, t: 340 })
    OP.Sim.run(b, 420)
    t.gt(b.stats.shotsFired, 0, 'but it opens fire the moment a blimp arrives')
    t.gt(b.stats.damageDealt, 0, 'and puts damage into it')
  }

  t.section('diver-otter: the blimp bonus is a bonus, not the whole damage')
  {
    const s = sim()
    const tower = place(s, 'diver-otter', 400, 400)
    upgrade(s, tower, [0, 0, 3])
    t.gt(tower.s.blimpBonus, 0, 'Blimp Hunter grants a bonus')
    t.notOk(tower.s.onlyBlimps, 'without locking out small balloons yet')
    stream(s, 'red', 20, 300, 12)
    OP.Sim.run(s, 300)
    t.gt(s.stats.popped, 0, 'so it still clears reds')
  }

  /* ================================================== 3. CORSAIR BEAVER ======== */

  t.section('corsair-beaver: the base attack really is a fan')
  {
    const s = sim()
    const tower = place(s, 'corsair-beaver', 400, 460)
    t.gte(tower.s.shots, 3, 'it fires at least three shots a volley')
    t.gt(tower.s.spread, 0.3, 'across a real arc (' + tower.s.spread.toFixed(2) + ' rad)')
    OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 380 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.projectiles.length
    T['corsair-beaver'].fire(s, tower, s.balloons[0])
    const shots = s.projectiles.slice(before)
    t.eq(shots.length, tower.s.shots, 'one volley emits exactly `shots` projectiles')
    const angs = shots.map(p => Math.atan2(p.vy, p.vx))
    t.close(Math.max.apply(null, angs) - Math.min.apply(null, angs), tower.s.spread, 0.02,
      'and they span the declared spread')
  }

  t.section('corsair-beaver: the mortar branch trades sharp shot for explosive shells')
  {
    const s = sim()
    const tower = place(s, 'corsair-beaver', 400, 460)
    upgrade(s, tower, [0, 3, 0])
    t.eq(tower.s.dmgType, D.EXPLOSIVE, 'Heavy Mortar is explosive')
    t.gt(tower.s.blastRadius, 40, 'with a real blast radius (' + tower.s.blastRadius + ')')
    t.eq(tower.s.shots, 1, 'and one heavy shell instead of the fan')
    t.ok(tower.s.ignoresLOS, 'lobbed, so terrain does not block it')

    const black = trial('corsair-beaver', [0, 3, 0], 'black', { count: 10, step: 16 })
    t.eq(black.s.stats.popped, 0, 'Black balloons ignore the explosion entirely — the stated trade')
    const cer = trial('corsair-beaver', [0, 3, 0], 'ceramic', { count: 10, step: 16 })
    t.gt(cer.s.stats.damageDealt, 0, 'while Ceramics take the full shell')
  }

  t.section('corsair-beaver: the privateer branch launches attackers of its own')
  {
    const s = sim()
    const tower = place(s, 'corsair-beaver', 400, 460)
    upgrade(s, tower, [0, 0, 1])
    t.gt(tower.s.skiffPeriod, 0, 'Longboat sets a launch period')
    OP.Sim.run(s, 300)            // no balloons at all
    t.gt(s.kindsSeen['mil-skiff'] || 0, 0, 'skiffs launch with nothing on the board')
    t.gt(s.projectiles.filter(p => p.kind === 'mil-skiff' && p.alive).length, 0,
      'and they persist, drifting, rather than expiring instantly')

    const faster = sim()
    const up = place(faster, 'corsair-beaver', 400, 460)
    upgrade(faster, up, [0, 0, 4])
    t.lt(up.s.skiffPeriod, tower.s.skiffPeriod, 'higher tiers launch them more often')
    t.gt(up.s.skiffCount, 1, 'and more than one at a time')
    t.gt(up.s.skiffBlast, 0, 'and they detonate')
    OP.Sim.run(faster, 240)
    t.gt((faster.kindsSeen['mil-skiff'] || 0), (s.kindsSeen['mil-skiff'] || 0), 'measurably more skiffs in less time')
  }

  t.section('corsair-beaver: skiffs kill things on their own')
  {
    const s = sim()
    // Branch 2 only: the boat's own guns are unchanged, so any extra popping
    // beyond the control has to be the skiffs.
    const tower = place(s, 'corsair-beaver', 400, 460)
    upgrade(s, tower, [0, 0, 4])
    stream(s, 'red', 30, 300, 10)
    OP.Sim.run(s, 480)
    const withSkiffs = s.stats.popped

    const control = sim()
    place(control, 'corsair-beaver', 400, 460)
    stream(control, 'red', 30, 300, 10)
    OP.Sim.run(control, 480)
    t.gt(withSkiffs, control.stats.popped,
      'the armada pops more than the bare boat (' + control.stats.popped + ' -> ' + withSkiffs + ')')
  }

  /* ================================================== 4. BIPLANE MAGPIE ======== */

  t.section('biplane-magpie: it flies a circuit instead of sitting still')
  {
    const s = sim()
    const plane = place(s, 'biplane-magpie', 400, 460)
    const x0 = plane.x, y0 = plane.y
    t.eq(plane.data.cx, 400, 'it remembers the hangar it was placed on')
    OP.Sim.run(s, 30)
    t.ok(Math.abs(plane.x - x0) + Math.abs(plane.y - y0) > 5, 'half a second later it has moved')

    let maxDrift = 0
    let offField = 0
    for (let i = 0; i < 900; i++) {
      OP.Sim.step(s)
      maxDrift = Math.max(maxDrift, M.dist(plane.x, plane.y, plane.data.cx, plane.data.cy))
      if (plane.x < 0 || plane.x > OP.FIELD_W || plane.y < 0 || plane.y > OP.FIELD_H) offField++
    }
    t.lte(maxDrift, plane.s.circuitRadius + 1, 'it never strays outside its circuit radius')
    t.eq(offField, 0, 'and never leaves the field')
    t.eq(plane.data.cx, 400, 'the circuit centre never drifts')
  }

  t.section('biplane-magpie: it fires along its heading, not at its target')
  {
    const s = sim()
    const plane = place(s, 'biplane-magpie', 400, 460)
    OP.Sim.run(s, 20)                      // get it moving so a heading exists
    const b = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 380 })
    OP.Grid.rebuild(s.grid, s.balloons)
    // Put the balloon well off the flight heading and check the shot ignores it.
    b.x = plane.x; b.y = plane.y + 60
    const before = s.projectiles.length
    T['biplane-magpie'].fire(s, plane, b)
    const shot = s.projectiles[before]
    t.ok(shot, 'it fires')
    const fired = Math.atan2(shot.vy, shot.vx)
    t.close(M.angleDiff(plane.data.heading, fired), 0, 0.1, 'the round goes along the plane heading')
    const toTarget = M.angleTo(plane.x, plane.y, b.x, b.y)
    t.gt(Math.abs(M.angleDiff(toTarget, fired)), 0.2, 'and demonstrably not at the balloon')
  }

  t.section('biplane-magpie: the bomb bay carpets the ground beneath it')
  {
    const s = sim()
    const plane = place(s, 'biplane-magpie', 400, 420)
    upgrade(s, plane, [0, 3, 0])
    t.gt(plane.s.bombPeriod, 0, 'Carpet Bombing sets a drop period')
    t.gte(plane.s.bombCount, 3, 'and drops three at a time')
    stream(s, 'ceramic', 20, 300, 12)
    OP.Sim.run(s, 300)
    t.gt(s.kindsSeen['mil-bomb'] || 0, 3, 'bombs are actually emitted')
    t.gt(s.blastEvents.length, 0, 'and they detonate')
  }

  t.section('biplane-magpie: firebombs reach Lead because fire is not explosive')
  {
    const bombsOnly = trial('biplane-magpie', [0, 3, 0], 'lead', { count: 8, step: 20, y: 420, ticks: 480 })
    t.eq(bombsOnly.s.stats.popped, 0, 'explosive bombs and sharp rounds both bounce off Lead')

    const fire = trial('biplane-magpie', [0, 4, 0], 'lead', { count: 8, step: 20, y: 420, ticks: 480 })
    t.gt(fire.tower.s.burnDps, 0, 'Firebombs attach a burn')
    t.gt(fire.s.stats.popped, 0, 'and burning Lead pops')
  }

  t.section('biplane-magpie: the interceptor branch only spends rockets on blimps')
  {
    const reds = sim()
    const p1 = place(reds, 'biplane-magpie', 400, 420)
    upgrade(reds, p1, [0, 0, 3])
    t.gt(p1.s.rocketPeriod, 0, 'Rocket Pods set a rocket period')
    stream(reds, 'red', 30, 300, 10)
    OP.Sim.run(reds, 420)
    t.eq(reds.kindsSeen['mil-rocket'] || 0, 0, 'no rockets are wasted on reds')

    const blimp = sim()
    const p2 = place(blimp, 'biplane-magpie', 400, 420)
    upgrade(blimp, p2, [0, 0, 3])
    OP.Balloons.spawn(blimp, { tier: 'goliath', path: 0, t: 360 })
    OP.Sim.run(blimp, 420)
    t.gt(blimp.kindsSeen['mil-rocket'] || 0, 0, 'a blimp draws rockets immediately')
  }

  /* ================================================== 5. ROTOR KESTREL ========= */

  t.section('rotor-kestrel: it chases the leak and goes home afterwards')
  {
    const s = sim()
    const heli = place(s, 'rotor-kestrel', 200, 640)
    t.eq(heli.data.hx, 200, 'it remembers its pad')
    const far = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 900 })
    const d0 = M.dist(heli.x, heli.y, far.x, far.y)
    OP.Sim.run(s, 60)
    const d1 = M.dist(heli.x, heli.y, far.x, far.y)
    t.lt(d1, d0, 'it closes on the balloon closest to leaking (' + d0.toFixed(0) + ' -> ' + d1.toFixed(0) + ')')

    OP.Balloons.kill(s, far)
    OP.Sim.run(s, 1)
    const away = M.dist(heli.x, heli.y, heli.data.hx, heli.data.hy)
    OP.Sim.run(s, 120)
    t.lt(M.dist(heli.x, heli.y, heli.data.hx, heli.data.hy), away, 'with the board clear it heads back to the pad')
  }

  t.section('rotor-kestrel: it will not chase what it cannot see')
  {
    const s = sim()
    const heli = place(s, 'rotor-kestrel', 200, 640)
    const veiled = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 900, props: OP.PROP.VEILED })
    const d0 = M.dist(heli.x, heli.y, veiled.x, veiled.y)
    OP.Sim.run(s, 60)
    t.gte(M.dist(heli.x, heli.y, veiled.x, veiled.y), d0 - 0.001, 'a Veiled balloon does not pull it off the pad')

    const seeing = sim()
    const heli2 = place(seeing, 'rotor-kestrel', 200, 640)
    upgrade(seeing, heli2, [0, 0, 2])
    t.ok(heli2.s.camoDetect, 'Night Vision grants detection')
    const v2 = OP.Balloons.spawn(seeing, { tier: 'red', path: 0, t: 900, props: OP.PROP.VEILED })
    const e0 = M.dist(heli2.x, heli2.y, v2.x, v2.y)
    OP.Sim.run(seeing, 60)
    t.lt(M.dist(heli2.x, heli2.y, v2.x, v2.y), e0, 'and now it chases Veiled balloons too')
  }

  t.section('OP.Military.shove: the documented way to move a balloon backwards')
  {
    const s = sim()
    const b = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 400 })
    const x0 = b.x
    t.eq(OP.Military.shove(s, b, 100), 100, 'it reports the distance actually moved')
    t.eq(b.t, 300, 'and reduces t by exactly that')
    t.lt(b.x, x0, 'x/y are re-synced immediately, not left stale for a tick')

    const near = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 30 })
    t.eq(OP.Military.shove(s, near, 500), 30, 'a shove past the entry only moves what is left')
    t.eq(near.t, 0, 'and never goes below 0')

    const blimp = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 400 })
    t.eq(OP.Military.shove(s, blimp, 100), 0, 'blimps are immune to knockback')
    t.eq(blimp.t, 400, 'and do not move at all')

    OP.Balloons.kill(s, b)
    t.eq(OP.Military.shove(s, b, 50), 0, 'a dead balloon is a no-op')
    t.eq(OP.Military.shove(s, null, 50), 0, 'and so is nothing at all')
  }

  t.section('rotor-kestrel: Rotor Wash pushes what it hits')
  {
    function reached (target) {
      const s = sim()
      const heli = place(s, 'rotor-kestrel', 300, 300)
      if (target) upgrade(s, heli, target)
      const b = OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 200 })
      OP.Sim.run(s, 180)
      return b.alive ? b.t : Infinity
    }
    const plain = reached(null)
    const washed = reached([0, 1, 0])
    t.ok(isFinite(plain) && isFinite(washed), 'both balloons survive long enough to compare')
    t.lt(washed, plain, 'the washed Ceramic is further back down the track (' +
      plain.toFixed(0) + ' -> ' + washed.toFixed(0) + ')')
  }

  t.section('rotor-kestrel: Cyclone pushes balloons it is not even shooting')
  {
    // Lead is immune to the Kestrel's sharp rounds, so any movement backwards is
    // the downdraft and nothing else.
    function leadT (target) {
      const s = sim()
      const heli = place(s, 'rotor-kestrel', 300, 300)
      if (target) upgrade(s, heli, target)
      const b = OP.Balloons.spawn(s, { tier: 'lead', path: 0, t: 250 })
      OP.Sim.run(s, 240)
      return { t: b.t, popped: s.stats.popped }
    }
    const control = leadT(null)
    const cyclone = leadT([0, 3, 0])
    t.eq(control.popped, 0, 'nothing pops Lead in either run')
    t.eq(cyclone.popped, 0, 'the downdraft deals no damage of its own')
    t.lt(cyclone.t, control.t, 'but the Lead balloon is dragged backwards (' +
      control.t.toFixed(0) + ' -> ' + cyclone.t.toFixed(0) + ')')
  }

  t.section('rotor-kestrel: the Downdraft ability clears the whole board back')
  {
    const s = sim()
    const heli = place(s, 'rotor-kestrel', 300, 300)
    upgrade(s, heli, [0, 5, 0])
    t.ok(heli.s.ability, 'Maelstrom carries the ability')
    const far = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 1100 })
    const near = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 1100 })
    OP.Towers.activate(s, heli)
    t.eq(far.t, 950, 'a balloon on the far side of the map is shoved 150 back')
    t.eq(near.t, 1100, 'the blimp is not')
  }

  /* ================================================== 6. HOWITZER MOLE ========= */

  t.section('howitzer-mole: it starts aimed at the nearest track')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 500, 440)
    t.ok(mole.data.aimX !== undefined, 'placement sets an aim point')
    const near = s.map.paths[0].nearest(mole.data.aimX, mole.data.aimY)
    t.lt(near.dist, 4, 'and it sits on the track (' + near.dist.toFixed(1) + ' units off)')
    t.lte(M.dist(mole.x, mole.y, mole.data.aimX, mole.data.aimY), mole.s.range, 'inside its own range')
  }

  t.section('howitzer-mole: the aim point is clamped into range')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 200, 600)
    OP.Military.setAimPoint(s, mole, 5000, -5000)
    t.close(M.dist(mole.x, mole.y, mole.data.aimX, mole.data.aimY), mole.s.range, 1,
      'a wild request is pulled back to exactly the range limit')
    t.between(mole.data.aimX, 0, OP.FIELD_W, 'and stays on the field horizontally')
    t.between(mole.data.aimY, 0, OP.FIELD_H, 'and vertically')
  }

  t.section('howitzer-mole: it shells the point it was told to, not the balloon it can see')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 400, 520)
    OP.Military.setAimPoint(s, mole, 400, 360)          // straight up, on the track
    // Balloons live 300 units to the right — in range, so the gun opens fire,
    // but nowhere near the aim point or the shell's flight path.
    for (let i = 0; i < 40; i++) OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 660 + i * 3 })
    OP.Sim.run(s, 300)
    t.gt(s.blastEvents.length, 0, 'it fires: ' + s.blastEvents.length + ' shells landed')
    let atAim = 0, atBalloons = 0
    for (const e of s.blastEvents) {
      if (M.dist(e.x, e.y, 400, 360) < 20) atAim++
      if (e.x > 600) atBalloons++
    }
    t.eq(atAim, s.blastEvents.length, 'every shell detonated at the aim point')
    t.eq(atBalloons, 0, 'and none went after the balloons')
    t.eq(s.stats.popped, 0, 'so nothing popped — a fixed gun is exactly as good as its aim')
  }

  t.section('howitzer-mole: aimed properly it flattens the track')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 400, 520)
    OP.Military.setAimPoint(s, mole, 400, 360)
    for (let i = 0; i < 40; i++) OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 300 + i * 3 })
    OP.Sim.run(s, 420)
    t.gt(s.stats.popped, 0, 'balloons walking through the aim point are shredded (' + s.stats.popped + ')')
  }

  t.section('howitzer-mole: incendiary shells reach what the blast cannot')
  {
    // Black ignores explosive damage outright, so if a Black balloon dies here it
    // is the fire doing it.
    function blackRun (target) {
      const s = sim()
      const mole = place(s, 'howitzer-mole', 400, 520)
      if (target) upgrade(s, mole, target)
      OP.Military.setAimPoint(s, mole, 400, 360)
      for (let i = 0; i < 10; i++) OP.Balloons.spawn(s, { tier: 'black', path: 0, t: 330 + i * 8 })
      OP.Sim.run(s, 420)
      return s.stats
    }
    const plain = blackRun(null)
    t.eq(plain.popped, 0, 'plain explosive shells do nothing to Black')
    t.gt(plain.blanked, 0, 'and the engine records the blanked hits')

    const burning = blackRun([0, 2, 0])
    t.gt(burning.popped, 0, 'Incendiary Shells burn them down anyway (' + burning.popped + ' popped)')
  }

  t.section('howitzer-mole: the armour branch is brittle plus acid, and Plated feels it')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 400, 520)
    upgrade(s, mole, [0, 0, 3])
    t.gt(mole.s.brittleMag, 0, 'Plate Cutters leave balloons brittle')
    t.gt(mole.s.acidDps, 0, 'Corrosive Filler adds acid')

    function platedRBE (target) {
      const s2 = sim()
      const m = place(s2, 'howitzer-mole', 400, 520)
      if (target) upgrade(s2, m, target)
      OP.Military.setAimPoint(s2, m, 400, 360)
      for (let i = 0; i < 6; i++) {
        OP.Balloons.spawn(s2, { tier: 'ceramic', path: 0, t: 330 + i * 10, props: OP.PROP.PLATED })
      }
      OP.Sim.run(s2, 420)
      return s2.stats.damageDealt
    }
    const bare = platedRBE(null)
    const shredded = platedRBE([0, 0, 3])
    t.gt(bare, 0, 'the bare mortar does damage to Plated Ceramics (' + bare + ')')
    t.gt(shredded, bare, 'and the armour branch does considerably more (' + shredded + ')')

    const veiledSafe = new Set(Object.keys(OP.ABILITIES))
    t.ok(veiledSafe.has('mil-armour-strip'), 'the tier-5 ability key is registered')
  }

  /* ================================================== 7. GATLING RACCOON ======= */

  t.section('gatling-raccoon: it spins up while it holds one target')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 400, 440)
    OP.Balloons.spawn(s, { tier: 'colossus', path: 0, t: 380 })   // survives the whole test
    OP.Sim.run(s, 6)
    const early = s.stats.shotsFired
    OP.Sim.run(s, 54)
    const firstSecond = s.stats.shotsFired - early
    t.gt(gun.data.spin, 0, 'spin climbs while the target is held (' + gun.data.spin.toFixed(2) + ')')

    OP.Sim.run(s, 240)
    const mark = s.stats.shotsFired
    OP.Sim.run(s, 60)
    const lateSecond = s.stats.shotsFired - mark
    t.close(gun.data.spin, 1, 0.001, 'and reaches full spin')
    t.gt(lateSecond, firstSecond, 'a fully spun second fires more rounds than the first (' +
      firstSecond + ' -> ' + lateSecond + ')')
  }

  t.section('gatling-raccoon: the spin resets when the target changes')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 400, 440)
    const b = OP.Balloons.spawn(s, { tier: 'colossus', path: 0, t: 380 })
    OP.Sim.run(s, 180)
    t.gt(gun.data.spin, 0.5, 'wound up on the first target')
    OP.Balloons.kill(s, b)
    OP.Sim.run(s, 2)
    t.eq(gun.data.spin, 0, 'losing the target drops the barrels to nothing')

    const cooled = sim()
    const gun2 = place(cooled, 'gatling-raccoon', 400, 440)
    upgrade(cooled, gun2, [0, 3, 0])
    const b2 = OP.Balloons.spawn(cooled, { tier: 'colossus', path: 0, t: 380 })
    OP.Sim.run(cooled, 240)
    OP.Balloons.kill(cooled, b2)
    OP.Sim.run(cooled, 2)
    t.close(gun2.data.spin, 0.40, 0.001, 'Cryo Coolant holds it at the promised 40% floor')
  }

  t.section('gatling-raccoon: full spin means more pierce')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 400, 440)
    upgrade(s, gun, [1, 0, 0])
    OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 380 })
    OP.Grid.rebuild(s.grid, s.balloons)

    gun.data.spin = 0
    let before = s.projectiles.length
    T['gatling-raccoon'].fire(s, gun, s.balloons[0])
    const cold = s.projectiles[before].pierce

    gun.data.spin = 1
    before = s.projectiles.length
    T['gatling-raccoon'].fire(s, gun, s.balloons[0])
    const hot = s.projectiles[before].pierce

    t.eq(cold, gun.s.pierce, 'a cold barrel fires at the listed pierce (' + cold + ')')
    t.gt(hot, cold, 'a hot one punches through more (' + hot + ')')
  }

  t.section('gatling-raccoon: Overdrive locks the spin at full and then lets go')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 400, 440)
    upgrade(s, gun, [5, 0, 0])
    t.eq(gun.s.ability.key, 'mil-overdrive', 'the tier-5 ability is the overdrive')
    t.gt(gun.s.ability.duration, 0, 'and it has a duration')
    OP.Balloons.spawn(s, { tier: 'colossus', path: 0, t: 380 })
    OP.Towers.activate(s, gun)
    t.eq(gun.data.spin, 1, 'activating pins the spin at full immediately')
    OP.Sim.run(s, 30)
    t.eq(gun.data.spin, 1, 'and it stays there while the ability runs')
    OP.Sim.run(s, 400)
    t.eq(gun.abilityT, 0, 'the duration expires')
  }

  t.section('gatling-raccoon: the energy branch answers Lead and hands Purple to somebody else')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 400, 440)
    upgrade(s, gun, [0, 0, 2])
    t.eq(gun.s.dmgType, D.PLASMA, 'Ionised Barrels converts to plasma')

    const lead = trial('gatling-raccoon', [0, 0, 2], 'lead', { count: 10, step: 16, y: 440 })
    t.gt(lead.s.stats.popped, 0, 'plasma pops Lead, which sharp could not')

    const purple = trial('gatling-raccoon', [0, 0, 2], 'purple', { count: 10, step: 16, y: 440 })
    t.eq(purple.s.stats.popped, 0, 'and Purple ignores it completely')
    const sharpPurple = trial('gatling-raccoon', null, 'purple', { count: 10, step: 16, y: 440 })
    t.gt(sharpPurple.s.stats.popped, 0, 'while the unupgraded gun handled Purple fine — a real trade')

    const desc = T['gatling-raccoon'].paths[2].tiers[1].desc
    t.ok(/purple/i.test(desc), 'and the upgrade text warns the player about Purple')
    const fusion = T['gatling-raccoon'].paths[2].tiers[3].desc
    t.ok(/purple/i.test(fusion), 'as does the energy tier')
  }

  /* ---------- the rest of the abilities, each against its own desc ---------- */

  t.section('diver-otter: Sonar Bloom leaves everything nearby brittle and slowed')
  {
    const s = sim()
    const otter = place(s, 'diver-otter', 400, 400)
    upgrade(s, otter, [0, 5, 0])
    t.eq(otter.s.ability.key, 'mil-sonar-bloom', 'Abyssal Chorus carries the sonar ability')
    const near = OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 400 })
    const far = OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 1200 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Towers.activate(s, otter)
    t.ok(OP.Effects.has(near, 'brittle'), 'a balloon inside the pulse is brittle')
    t.ok(OP.Effects.has(near, 'glue'), 'and slowed')
    t.close(OP.Effects.damageMultiplier(near), 1.6, 0.001, 'brittle is the 60% the text promises')
    t.notOk(OP.Effects.has(far, 'brittle'), 'a balloon on the far side of the map is untouched')
  }

  t.section('corsair-beaver: the Broadside ability fires in every direction')
  {
    const s = sim()
    const boat = place(s, 'corsair-beaver', 400, 460)
    upgrade(s, boat, [5, 0, 0])
    t.eq(boat.s.ability.key, 'mil-broadside', 'Ship Of The Line carries the broadside')
    const before = s.projectiles.length
    OP.Towers.activate(s, boat)
    const ring = s.projectiles.slice(before)
    t.gte(ring.length, 8, 'it emits a whole ring (' + ring.length + ' shots)')
    const quadrants = new Set(ring.map(function (p) {
      const a = (Math.atan2(p.vy, p.vx) + M.TAU) % M.TAU
      return Math.floor(a / (Math.PI / 2)) % 4
    }))
    t.eq(quadrants.size, 4, 'covering all four quadrants — it does not need a target at all')
  }

  t.section('howitzer-mole: Saturation Fire scatters shells around the aim point')
  {
    const s = sim()
    const mole = place(s, 'howitzer-mole', 400, 520)
    upgrade(s, mole, [4, 0, 0])
    OP.Military.setAimPoint(s, mole, 400, 360)
    t.eq(mole.s.ability.key, 'mil-saturation', 'Bunker Buster carries Saturation Fire')
    const before = s.projectiles.length
    OP.Towers.activate(s, mole)
    const shells = s.projectiles.slice(before)
    t.eq(shells.length, 8, 'eight shells, exactly as the text says')
    const spread = new Set(shells.map(p => Math.atan2(p.vy, p.vx).toFixed(4)))
    t.gt(spread.size, 1, 'scattered rather than stacked on one point')
    OP.Sim.run(s, 120)
    t.gt(s.blastEvents.length, 0, 'and they all come down')
    for (const e of s.blastEvents) {
      // 70 units of scatter plus the blast itself.
      t.lt(M.dist(e.x, e.y, 400, 360), 140, 'a saturation shell landed near the aim point')
      break
    }
  }

  t.section('biplane-magpie: the Bombing Run lays bombs ahead of the plane')
  {
    const s = sim()
    const plane = place(s, 'biplane-magpie', 400, 300)
    upgrade(s, plane, [0, 5, 0])
    OP.Sim.run(s, 20)
    t.eq(plane.s.ability.key, 'mil-bombing-run', 'Saturation Run carries the bombing run')
    const before = s.projectiles.length
    OP.Towers.activate(s, plane)
    const bombs = s.projectiles.slice(before)
    t.eq(bombs.length, 10, 'ten bombs are laid at once')
    const head = plane.data.heading
    const along = bombs.map(p => (p.x - plane.x) * Math.cos(head) + (p.y - plane.y) * Math.sin(head))
    t.ok(along.every(v => v >= -0.001), 'every one of them is ahead of the plane, not behind it')
    t.gt(Math.max.apply(null, along), 100, 'and they run out in a line (' + Math.max.apply(null, along).toFixed(0) + ' units)')
  }

  t.section('gatling-raccoon: the Particle Lance crosses the whole map')
  {
    const s = sim()
    const gun = place(s, 'gatling-raccoon', 100, 400)
    upgrade(s, gun, [0, 0, 5])
    t.eq(gun.s.dmgType, D.ENERGY, 'the top of the branch is energy damage')
    stream(s, 'ceramic', 24, 60, 45)
    OP.Sim.run(s, 4)
    const before = s.projectiles.length
    OP.Towers.activate(s, gun)
    const beam = s.projectiles[before]
    t.ok(beam, 'the lance is emitted')
    t.gt(beam.pierce, 100, 'with pierce enough to go through everything (' + beam.pierce + ')')
    t.eq(beam.dmgType, D.ENERGY, 'as energy damage')
    const dealt = s.stats.damageDealt
    OP.Sim.run(s, 90)
    t.gt(s.stats.damageDealt - dealt, gun.s.damage * 3, 'and it hits a whole line of balloons at once')
  }

  /* ---------- upgrade text is the player-facing contract ---------- */

  t.section('military: every upgrade description says something concrete')
  // A desc is shown verbatim in the upgrade panel, so "Better." is a bug. The bar
  // is: it names a number or the mechanic it changes, and it is not a placeholder.
  //
  // Deliberately NOT a length or word-count bar. "+30 range." is ideal panel text —
  // concrete, scannable, honest — and an earlier version of this check rejected it
  // for being two words, which would only have pushed every desc toward padding.
  const CONCRETE = /\d|veiled|regen|plated|lead|black|zebra|white|purple|blimp|brittle|acid|burn|shatter|plasma|energy|explosive|cold|glue|stun|camo|spin|sonar|obstacle|track|blast|ability|aura|range|pierce|damage/i
  const PLACEHOLDER = /^(better|improved|stronger|faster|more|upgrade|tbd|todo|wip)\b|\bplaceholder\b/i
  for (const d of defs) {
    let empty = null
    let vague = null
    let placeholder = null
    for (const path of d.paths) {
      for (const up of path.tiers) {
        const desc = String(up.desc || '').trim()
        if (desc.length < 4) empty = empty || `${path.name} t${up.tier}: "${desc}"`
        if (!CONCRETE.test(desc)) vague = vague || `${path.name} t${up.tier}: "${desc}"`
        if (PLACEHOLDER.test(desc)) placeholder = placeholder || `${path.name} t${up.tier}: "${desc}"`
      }
    }
    t.notOk(empty, `${d.key} has no empty descriptions` + (empty ? ' — ' + empty : ''))
    t.notOk(vague, `${d.key} descriptions all state a number or name a mechanic` + (vague ? ' — ' + vague : ''))
    t.notOk(placeholder, `${d.key} has no placeholder text` + (placeholder ? ' — ' + placeholder : ''))
  }

  t.section('military: the family answers Lead, Veiled and blimps — but no one tower answers all three')
  {
    // Every legal tier triple, resolved through the real upgrade pipeline. The
    // crosspath rules are part of the design here: the Lynx's shatter and its
    // thermal sight both sit past tier 2, so no single Lynx gets both.
    const states = OP.Upgrades.legalMaxima()
    const answers = { lead: [], veiled: [], blimps: [] }

    function resolve (def, tiers) {
      const s = Object.assign({}, def.base)
      OP.Upgrades.applyTo(s, { def: def, tiers: tiers }, null)
      return s
    }
    // A lead balloon ignores sharp: anything else this tower can put out counts,
    // including the explosive secondaries. A blimp answer has to be a real
    // specialisation, not the 8-point bonus a tier-2 sight happens to give.
    const answersLead = s => s.dmgType !== D.SHARP || s.burnDps > 0 || s.acidDps > 0 ||
      s.rocketPeriod > 0 || s.bombPeriod > 0
    const answersVeiled = s => !!s.camoDetect || s.sonarTier > 0 || s.netTier > 0
    const answersBlimps = s => s.blimpBonus >= 90 || !!s.onlyBlimps

    for (const d of defs) {
      let all = null
      const can = { lead: false, veiled: false, blimps: false }
      for (const tiers of states) {
        const s = resolve(d, tiers)
        const l = answersLead(s), v = answersVeiled(s), b = answersBlimps(s)
        can.lead = can.lead || l
        can.veiled = can.veiled || v
        can.blimps = can.blimps || b
        if (l && v && b && !all) all = tiers.join('-')
      }
      t.notOk(all, `${d.key} has no legal build that answers Lead, Veiled and blimps at once` +
        (all ? ` — ${all} does` : ''))
      if (can.lead) answers.lead.push(d.key)
      if (can.veiled) answers.veiled.push(d.key)
      if (can.blimps) answers.blimps.push(d.key)
      t.ok(can.lead || can.veiled || can.blimps, `${d.key} answers at least one of the three threats`)
    }

    t.gte(answers.lead.length, 3, 'at least three towers can answer Lead (' + answers.lead.join(', ') + ')')
    t.gte(answers.veiled.length, 3, 'at least three can answer Veiled (' + answers.veiled.join(', ') + ')')
    t.gte(answers.blimps.length, 3, 'at least three can answer blimps (' + answers.blimps.join(', ') + ')')
    t.lte(answers.veiled.length, 5, 'but Veiled detection is not just handed to everybody')
  }

  /* ---------- family-wide behaviour under the real sim ---------- */

  t.section('military: seven military towers on one board stay deterministic')
  {
    function board (seed) {
      const s = makeSim(OP, { tracks: [arena(OP)], cash: 100000000, lives: 100000, seed: seed })
      const spots = [[120, 60], [300, 60], [500, 60], [700, 60], [900, 60], [1100, 60], [1200, 300]]
      want.forEach(function (key, i) {
        const tower = OP.Towers.place(s, key, spots[i][0], spots[i][1], { free: true })
        if (tower) OP.Upgrades.buy(s, tower, i % 3)
      })
      for (let i = 0; i < 40; i++) OP.Balloons.spawn(s, { tier: i % 7 === 0 ? 'ceramic' : 'red', path: 0, t: i * 11 })
      OP.Sim.run(s, 900)
      return s
    }
    const a = board('mil-det')
    const b = board('mil-det')
    t.eq(a.towers.length, 7, 'all seven fit on the board together')
    t.eq(OP.Sim.checksum(a), OP.Sim.checksum(b), 'two runs of the same seed agree exactly')
    t.gt(a.stats.popped, 0, 'and the board actually did something (' + a.stats.popped + ' popped)')

    const c = board('mil-other-seed')
    t.neq(OP.Sim.checksum(c), OP.Sim.checksum(a), 'a different seed diverges, so the seed is really being used')
  }

  t.section('military: the mobile towers survive a mid-round save')
  {
    const s = makeSim(OP, { tracks: [line()], cash: 100000000, lives: 100000, seed: 'mil-save' })
    const plane = OP.Towers.place(s, 'biplane-magpie', 400, 200, { free: true })
    const heli = OP.Towers.place(s, 'rotor-kestrel', 700, 200, { free: true })
    const mole = OP.Towers.place(s, 'howitzer-mole', 900, 500, { free: true })
    stream(s, 'red', 20, 200, 12)
    OP.Sim.run(s, 200)

    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [line()] })
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), 'the save round-trips to the same checksum')

    const rPlane = back.towerById.get(plane.id)
    const rHeli = back.towerById.get(heli.id)
    const rMole = back.towerById.get(mole.id)
    t.close(rPlane.x, plane.x, 0.001, 'the plane resumes at the point on its circuit it had reached')
    t.close(rPlane.data.phase, plane.data.phase, 1e-9, 'and with the same phase')
    t.eq(rPlane.data.cx, plane.data.cx, 'and remembers its hangar')
    t.close(rHeli.x, heli.x, 0.001, 'the helicopter resumes in mid-air')
    t.eq(rHeli.data.hx, heli.data.hx, 'and remembers its pad')
    t.eq(rMole.data.aimX, mole.data.aimX, 'the mortar remembers where it was aimed')

    // Nothing in tower.data may be a function or an object reference, or the save
    // above would have quietly dropped it.
    for (const tower of [rPlane, rHeli, rMole]) {
      const values = Object.keys(tower.data).map(k => typeof tower.data[k])
      t.ok(values.every(v => v === 'number' || v === 'string' || v === 'boolean'),
        tower.key + ' keeps only primitives in tower.data (' + values.join(',') + ')')
    }
  }

  t.section('military: every projectile kind this family declares is real')
  const declared = Object.keys(OP.PROJ_KINDS).filter(k => k.indexOf('mil-') === 0)
  t.gte(declared.length, 10, 'the family declares its own art kinds (' + declared.length + ')')
  t.ok(declared.every(k => OP.PROJ_KINDS[k].shape && OP.PROJ_KINDS[k].tint),
    'each with a shape and a tint for the renderer')
}

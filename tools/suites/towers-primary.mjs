// The primary family: the cheap, always-available backbone.
//
// Calls the shared floor first, then tests the things that make these seven
// towers distinctive — that the shatter upgrade really pops lead, that the camo
// upgrade really hits a VEILED balloon, that the slow really slows, that the
// boomerang really turns around, that the burst really reloads.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertFamily, arena } from './_towerfamily.mjs'
import { makeSim } from './_fixture.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const name = 'towers-primary'
export const needs = ['js/towers/primary.js']

const ROSTER = [
  'acorn-fox', 'boomer-badger', 'cannon-boar', 'thistle-hedgehog',
  'frost-hare', 'sap-snail', 'sixgun-stoat'
]

export function run (t, OP, env) {
  // Explicit keys: several other suites evaluate js/towers/_TEMPLATE.js into the
  // shared bundle context, and that file reassigns OP.FAMILY_ROSTERS.primary. The
  // floor's own docs say `keys` is the escape hatch for exactly that.
  assertFamily(t, OP, 'primary', { expect: 7, keys: ROSTER })

  t.section('primary: the file declares its own roster')
  // Read the source rather than OP.FAMILY_ROSTERS. Several suites (towerfloor,
  // towers, paragon, heroes) evaluate js/towers/_TEMPLATE.js into the shared
  // bundle context, and that file reassigns OP.FAMILY_ROSTERS.primary to
  // ['template-critter']. The declaration in *this* file is what is under test,
  // and its source is the only record of it another suite cannot overwrite.
  const source = readFileSync(resolve(REPO, 'js/towers/primary.js'), 'utf8')
  const decl = source.match(/OP\.FAMILY_ROSTERS\.primary\s*=\s*\[([^\]]*)\]/)
  if (t.ok(decl, 'js/towers/primary.js assigns OP.FAMILY_ROSTERS.primary')) {
    const listed = (decl[1].match(/'[^']+'/g) || []).map(x => x.slice(1, -1))
    t.eq(new Set(listed).size, listed.length, 'with no duplicate keys')
    t.deep(listed.slice().sort(), ROSTER.slice().sort(), 'listing exactly the seven primary keys')
  }
  // The runtime value, still checked — but tolerant of that one documented
  // clobber and nothing else, so a genuinely wrong roster still fails here.
  const live = OP.FAMILY_ROSTERS.primary || []
  const clobbered = live.length === 1 && live[0] === 'template-critter'
  const sameSet = live.length === ROSTER.length && ROSTER.every(k => live.indexOf(k) >= 0)
  t.ok(clobbered || sameSet, clobbered
    ? 'OP.FAMILY_ROSTERS.primary was overwritten by _TEMPLATE.js, which is expected under --all'
    : `OP.FAMILY_ROSTERS.primary holds the seven primary keys at runtime (${live.join(', ')})`)

  const D = OP.DMG
  const M = OP.M

  /* ---------- helpers ---------- */

  function board (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 1e9, lives: 1e8, seed: 'primary-suite'
    }, opts || {}))
  }

  /** Put a tower `off` units off the track at arc position `at`. */
  function put (s, key, at, off) {
    const p = s.map.paths[0].posAt(at === undefined ? 320 : at)
    return OP.Towers.place(s,
      key,
      M.clamp(p.x, 60, OP.FIELD_W - 60),
      M.clamp(p.y - (off === undefined ? 55 : off), 60, OP.FIELD_H - 60),
      { free: true })
  }

  /** Walk a tower to a tier triple one legal purchase at a time. */
  function build (s, tower, target) {
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

  /** Place a tower at `tiers`, feed it a stream of one tier of balloon, and
      report what happened. */
  function trial (key, tiers, tierKey, opts) {
    opts = opts || {}
    const s = board()
    const tower = put(s, key, opts.at, opts.off)
    if (!tower) return null
    if (tiers) build(s, tower, tiers)
    const n = opts.count === undefined ? 16 : opts.count
    const gap = opts.gap === undefined ? 12 : opts.gap
    const from = opts.from === undefined ? 230 : opts.from
    for (let i = 0; i < n; i++) {
      OP.Balloons.spawn(s, { tier: tierKey, path: 0, t: from + i * gap, props: opts.props || 0 })
    }
    OP.Sim.run(s, opts.ticks === undefined ? 420 : opts.ticks)
    return { sim: s, tower: tower }
  }

  function liveOfTier (s, tierKey) {
    const want = OP.tierIndex(tierKey)
    const out = []
    for (let i = 0; i < s.balloons.length; i++) {
      const b = s.balloons[i]
      if (b.alive && b.tier === want) out.push(b)
    }
    return out
  }

  function statsAt (key, tiers) {
    const s = board()
    const tower = put(s, key)
    if (tiers) build(s, tower, tiers)
    return tower.s
  }

  const def = k => OP.TOWERS[k]

  /* ==================================================================
     shape of the family
     ================================================================== */

  t.section('primary: the family is the cheap backbone it claims to be')
  for (const k of ROSTER) {
    t.between(def(k).cost, 170, 600, `${k} costs ${def(k).cost}, inside the primary band 170-600`)
    t.eq(def(k).unlockRound, 0, `${k} is available from round 1`)
    t.eq(def(k).income, false, `${k} is not an income tower, so PURIST allows it`)
  }
  t.eq(def('acorn-fox').cost, Math.min(...ROSTER.map(k => def(k).cost)),
    'Acorn Fox is the cheapest tower in the family')

  t.section('primary: every upgrade description says something concrete')
  // A desc is shown verbatim in the upgrade panel, so "Better." is a bug. The bar
  // is: it names a number or the mechanic it changes, and it is not a placeholder.
  //
  // Deliberately NOT a length or word-count bar. "+30 range." is ideal panel text —
  // concrete, scannable, honest — and an earlier version of this check rejected it
  // for being two words, which would only have pushed every desc toward padding.
  const CONCRETE = /\d|veiled|regen|plated|lead|black|zebra|white|purple|blimp|brittle|acid|burn|shatter|plasma|energy|explosive|cold|glue|stun|camo|spin|sonar|obstacle|track|blast|ability|aura|range|pierce|damage/i
  const PLACEHOLDER = /^(better|improved|stronger|faster|more|upgrade|tbd|todo|wip)\b|\bplaceholder\b/i
  const noNumber = []
  for (const d of ROSTER.map(k => OP.TOWERS[k]).filter(Boolean)) {
    let empty = null
    let vague = null
    let placeholder = null
    for (const path of d.paths) {
      for (const up of path.tiers) {
        const desc = String(up.desc || '').trim()
        if (desc.length < 4) empty = empty || `${path.name} t${up.tier}: "${desc}"`
        if (!CONCRETE.test(desc)) vague = vague || `${path.name} t${up.tier}: "${desc}"`
        if (PLACEHOLDER.test(desc)) placeholder = placeholder || `${path.name} t${up.tier}: "${desc}"`
        // A stat change the player is paying for should quote the actual number.
        if (!/\d/.test(desc)) noNumber.push(`${d.key} ${path.name} t${up.tier}`)
      }
    }
    t.notOk(empty, `${d.key} has no empty descriptions` + (empty ? ' — ' + empty : ''))
    t.notOk(vague, `${d.key} descriptions all state a number or name a mechanic` + (vague ? ' — ' + vague : ''))
    t.notOk(placeholder, `${d.key} has no placeholder text` + (placeholder ? ' — ' + placeholder : ''))
  }
  t.eq(noNumber.length, 0, noNumber.length
    ? `descriptions with no concrete numbers: ${noNumber.slice(0, 5).join(', ')}`
    : `all ${ROSTER.length * 15} upgrade descriptions quote real numbers`)

  t.section('primary: costs never decrease down a branch')
  let backwards = []
  for (const k of ROSTER) {
    for (const path of def(k).paths) {
      for (let i = 1; i < path.tiers.length; i++) {
        if (path.tiers[i].cost < path.tiers[i - 1].cost) backwards.push(`${k}/${path.name} t${i + 1}`)
      }
    }
  }
  t.eq(backwards.length, 0, backwards.length ? `cheaper than the tier below: ${backwards.join(', ')}` : 'all 21 branches are monotonic')

  t.section('primary: every ability and behaviour key resolves to a registration')
  const abilityKeys = new Set()
  const behaviourKeys = new Set()
  for (const k of ROSTER) {
    if (def(k).base.behaviour) behaviourKeys.add(def(k).base.behaviour)
    for (const target of OP.Upgrades.legalMaxima()) {
      const st = statsAt(k, target)
      if (st.ability) abilityKeys.add(st.ability.key)
      if (st.behaviour) behaviourKeys.add(st.behaviour)
    }
  }
  t.gte(abilityKeys.size, 7, `the family carries ${abilityKeys.size} distinct abilities`)
  for (const key of abilityKeys) t.ok(typeof OP.ABILITIES[key] === 'function', `ability "${key}" is registered as a function`)
  t.gte(behaviourKeys.size, 4, `the family uses ${behaviourKeys.size} distinct projectile behaviours`)
  for (const key of behaviourKeys) t.ok(!!OP.PROJ_BEHAVIOURS[key], `behaviour "${key}" is registered`)

  t.section('primary: the family covers the type chart without any one tower doing it all')
  const answers = {}
  for (const k of ROSTER) {
    const a = { camo: false, shatter: false, nonSharp: false, bigSingle: false }
    for (const target of OP.Upgrades.legalMaxima()) {
      const st = statsAt(k, target)
      if (st.camoDetect) a.camo = true
      if (st.dmgType === D.SHATTER) a.shatter = true
      if (st.dmgType !== D.SHARP) a.nonSharp = true
      if (st.damage >= 100) a.bigSingle = true
    }
    answers[k] = a
  }
  t.ok(answers['acorn-fox'].shatter, 'Acorn Fox can convert to shatter, which nothing resists — the answer to Lead')
  t.ok(answers['acorn-fox'].camo, 'Acorn Fox can be given camo detection')
  t.ok(answers['boomer-badger'].camo, 'Boomer Badger can be given camo detection')
  t.notOk(answers['cannon-boar'].camo, 'Cannon Boar never sees Veiled balloons on its own')
  t.notOk(answers['sixgun-stoat'].camo, 'Sixgun Stoat never sees Veiled balloons on its own')
  t.eq(ROSTER.filter(k => answers[k].camo).length, 2, 'exactly two of the seven can answer camo')
  t.ok(answers['cannon-boar'].bigSingle && answers['sixgun-stoat'].bigSingle,
    'Cannon Boar and Sixgun Stoat both reach 100+ damage a shot — the blimp answers')
  t.notOk(answers['frost-hare'].bigSingle, 'Frost Hare is deliberately not a blimp answer: blimps resist slows')
  t.notOk(ROSTER.some(k => answers[k].camo && answers[k].shatter && answers[k].bigSingle),
    'no single primary tower answers camo, Lead and blimps at once')

  const types = new Set(ROSTER.map(k => def(k).base.dmgType))
  t.gte(types.size, 4, `the family fires ${types.size} distinct base damage types`)

  /* ==================================================================
     1. Acorn Fox
     ================================================================== */

  t.section('acorn-fox: sharp cannot touch Lead, flint caps can')
  const foxBaseLead = trial('acorn-fox', [0, 0, 0], 'lead')
  t.eq(foxBaseLead.sim.stats.popped, 0, 'an unupgraded Fox pops nothing off a Lead balloon')
  t.gt(foxBaseLead.sim.stats.shotsFired, 0, 'even though it was shooting at it the whole time')
  t.gt(foxBaseLead.sim.stats.blanked, 0, 'and the engine recorded the hits as blanked by immunity')

  const foxShatter = trial('acorn-fox', [3, 0, 0], 'lead')
  t.eq(foxShatter.tower.s.dmgType, D.SHATTER, 'Flint Caps sets the damage type to shatter')
  t.gt(foxShatter.sim.stats.popped, 0,
    `a 3-0-0 Fox pops Lead (${foxShatter.sim.stats.popped} popped)`)

  t.section('acorn-fox: Keen Eyes is what lets it shoot a Veiled balloon')
  const foxBlind = trial('acorn-fox', [0, 2, 0], 'red', { props: OP.PROP.VEILED })
  const foxSeeing = trial('acorn-fox', [0, 3, 0], 'red', { props: OP.PROP.VEILED })
  t.notOk(foxBlind.tower.s.camoDetect, 'a 0-2-0 Fox has no camo detection')
  t.eq(foxBlind.sim.stats.popped, 0, 'and pops none of 16 Veiled reds')
  t.ok(foxSeeing.tower.s.camoDetect, 'a 0-3-0 Fox has camo detection')
  t.gt(foxSeeing.sim.stats.popped, 0, `and pops Veiled reds (${foxSeeing.sim.stats.popped})`)

  t.section('acorn-fox: ricochet refunds the pierce it spends')
  {
    const s = board()
    const target = OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 300 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const p = OP.Projectiles.spawn(s, {
      x: target.x - 40, y: target.y,
      vx: 600, vy: 0,
      kind: 'primary-acorn',
      damage: 1, dmgType: D.SHARP, pierce: 1, radius: 4, life: 1,
      ownerId: -1, behaviour: 'primary-acorn-ricochet',
      data: { bounces: 2 }
    })
    for (let i = 0; i < 20 && p.hits.size === 0 && p.alive; i++) OP.Projectiles.step(s)
    t.eq(p.hits.size, 1, 'the bouncing acorn hit exactly one balloon')
    t.eq(p.data.bounces, 1, 'and spent one of its two bounces')
    t.gte(p.pierce, 1, 'the bounce refunded the pierce, so the acorn is still travelling')
    t.ok(p.alive, 'and it is still alive after a hit that would normally end it')
  }

  t.section('acorn-fox: Stonefall actually throws something')
  {
    const s = board()
    const tower = put(s, 'acorn-fox')
    build(s, tower, [5, 0, 0])
    t.ok(tower.s.ability, 'a 5-0-0 Fox has an ability')
    t.eq(tower.s.ability.key, 'primary-acorn-storm', 'and it is the registered Stonefall key')
    for (let i = 0; i < 6; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 300 + i * 10 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.stats.shotsFired
    const res = OP.Towers.activate(s, tower)
    t.ok(res.ok, 'the ability activates')
    t.gte(s.stats.shotsFired - before, 6, `and hurled ${s.stats.shotsFired - before} homing acorns at the six ceramics`)
    t.gt(tower.abilityCd, 0, 'and went on cooldown')
  }

  /* ==================================================================
     2. Boomer Badger
     ================================================================== */

  t.section('boomer-badger: the branch turns around and the return leg hits harder')
  {
    const s = board()
    const p = OP.Projectiles.spawn(s, {
      x: 400, y: 300, vx: 300, vy: 0,
      kind: 'primary-branch',
      damage: 3, dmgType: D.SHARP, pierce: 5, radius: 6, life: 4,
      maxRange: 400, ownerId: -1,
      behaviour: 'primary-branch-arc',
      data: { out: 100, bend: 0.42, retMul: 2, retPierce: 3, turned: 0 }
    })
    t.gt(p.vx, 0, 'the branch leaves the paw travelling outward')
    for (let i = 0; i < 60 && !p.data.turned; i++) OP.Projectiles.step(s)
    t.eq(p.data.turned, 1, 'after travelling its outbound distance it turns')
    t.lt(p.vx, 0, 'and is now heading back the other way')
    t.eq(p.damage, 6, 'the return leg carries double damage (3 -> 6)')
    t.eq(p.pierce, 8, 'and regained 3 pierce as it swung round')
    t.close(Math.hypot(p.vx, p.vy), 300, 1, 'the turn does not change its speed')
    t.notOk(Math.abs(Math.atan2(p.vy, p.vx) - Math.PI) < 1e-6,
      'the return line is bent off the outbound line, so it sweeps fresh air')
  }

  t.section('boomer-badger: Wide Arc really throws more branches')
  {
    const shots = [[0, 0, 0], [1, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]]
      .map(target => statsAt('boomer-badger', target).shots)
    t.deep(shots, [1, 2, 3, 4, 6], 'branch shots go 1, 2, 3, 4, 6 down Wide Arc')
    t.gt(statsAt('boomer-badger', [5, 0, 0]).spread, 1,
      'and the fan is over a radian wide at the top')
  }

  t.section('boomer-badger: Keen Nose at tier 2 is the cheap early camo answer')
  const badgerBlind = trial('boomer-badger', [0, 0, 1], 'red', { props: OP.PROP.VEILED })
  const badgerNose = trial('boomer-badger', [0, 0, 2], 'red', { props: OP.PROP.VEILED })
  t.notOk(badgerBlind.tower.s.camoDetect, 'a 0-0-1 Badger cannot see Veiled balloons')
  t.eq(badgerBlind.sim.stats.popped, 0, 'and pops none of them')
  t.ok(badgerNose.tower.s.camoDetect, 'a 0-0-2 Badger can')
  t.gt(badgerNose.sim.stats.popped, 0, `and pops them (${badgerNose.sim.stats.popped})`)
  t.lte(def('boomer-badger').paths[2].tiers[1].cost, def('boomer-badger').cost * 0.8,
    'and that camo upgrade costs less than the tower itself')

  /* ==================================================================
     3. Cannon Boar
     ================================================================== */

  t.section('cannon-boar: explosive is blank against Black, the ironwood slug is not')
  const boarBlack = trial('cannon-boar', [0, 0, 0], 'black')
  t.eq(boarBlack.sim.stats.popped, 0, 'an unupgraded Boar pops nothing off a Black balloon')
  t.gt(boarBlack.sim.stats.shotsFired, 0, 'though it lobbed bombs at them the whole time')
  t.gt(boarBlack.sim.blastEvents.length, 0, 'and the bombs really did detonate')

  const boarSlug = trial('cannon-boar', [3, 0, 0], 'black')
  t.eq(boarSlug.tower.s.dmgType, D.NORMAL, 'Ironwood Slug trades the explosion for blunt impact')
  t.gt(boarSlug.sim.stats.popped, 0, `and a 3-0-0 Boar pops Black (${boarSlug.sim.stats.popped})`)

  const boarZebra = trial('cannon-boar', [3, 0, 0], 'zebra')
  t.gt(boarZebra.sim.stats.popped, 0, 'the same slug also gets through Zebra')

  t.section('cannon-boar: the blast is a real area, not a point')
  {
    const st = statsAt('cannon-boar', [0, 0, 0])
    t.gt(st.blastRadius, 20, `base blast radius is ${st.blastRadius}`)
    t.gt(st.pierce, 4, `and one blast can catch ${st.pierce} balloons`)
    t.gt(statsAt('cannon-boar', [0, 5, 0]).blastRadius, st.blastRadius * 1.8,
      'Cone Cluster nearly triples the blast radius by tier 5')
  }

  t.section('cannon-boar: Scattering Cone emits real sub-bombs')
  {
    const st = statsAt('cannon-boar', [0, 3, 0])
    t.gte(st.cluster, 4, 'a 0-3-0 Boar splits into at least 4 cones')
    t.eq(st.behaviour, 'primary-cone-cluster', 'via the registered cluster behaviour')
    const run = trial('cannon-boar', [0, 3, 0], 'red', { count: 24, gap: 8 })
    t.gt(run.sim.kindsSeen['primary-cone-shard'] || 0, 0,
      `and ${run.sim.kindsSeen['primary-cone-shard']} shards were actually emitted`)
    t.ok(OP.PROJ_KINDS['primary-cone-shard'], 'the shard art kind is declared, so it renders')
    // The shards inherit the bomb's damage type, so the cluster branch must NOT
    // be a stealth answer to Black. Only Ironwood Slug on branch 0 is.
    const clusterBlack = trial('cannon-boar', [0, 3, 0], 'black', { count: 24, gap: 8 })
    t.gt(clusterBlack.sim.kindsSeen['primary-cone-shard'] || 0, 0, 'the cones scatter over Black balloons too')
    t.eq(clusterBlack.sim.stats.popped, 0,
      'but they are still explosive, so Black is still immune — Ironwood Slug remains the only answer to it')
  }

  t.section('cannon-boar: the single-target branch is the blimp answer')
  {
    const st = statsAt('cannon-boar', [5, 2, 0])
    t.gte(st.damage, 100, `a 5-2-0 Boar hits for ${st.damage} a bomb`)
    const s = board()
    const tower = put(s, 'cannon-boar')
    build(s, tower, [5, 0, 0])
    OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 300 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Sim.run(s, 240)
    t.gte(s.stats.damageDealt, 200, `and chews ${s.stats.damageDealt} hull off a GOLIATH in four seconds`)
    t.gt(s.stats.popped, 0, 'which is its whole 200-point hull — the blimp came apart')
    for (let i = 0; i < 4; i++) OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 300 + i * 10 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.stats.shotsFired
    t.ok(OP.Towers.activate(s, tower).ok, 'Timber Breaker activates')
    t.gt(s.stats.shotsFired - before, 0, 'and launches siege slugs at the blimps')
  }

  /* ==================================================================
     4. Thistle Hedgehog
     ================================================================== */

  t.section('thistle-hedgehog: one volley is a full even circle of spines')
  {
    const s = board()
    const tower = put(s, 'thistle-hedgehog', 320, 40)
    OP.Balloons.spawn(s, { tier: 'lead', path: 0, t: 320 })   // immune to sharp: a stable target
    OP.Sim.step(s)
    const spines = s.projectiles.filter(p => p.alive && p.kind === 'primary-spine')
    t.eq(spines.length, tower.s.shots, `one volley emitted exactly ${tower.s.shots} spines`)
    const angles = spines.map(p => M.normalizeAngle(Math.atan2(p.vy, p.vx))).sort((a, b) => a - b)
    let worst = 0
    const want = M.TAU / spines.length
    for (let i = 0; i < angles.length; i++) {
      const gap = i === angles.length - 1
        ? angles[0] + M.TAU - angles[i]
        : angles[i + 1] - angles[i]
      worst = Math.max(worst, Math.abs(gap - want))
    }
    t.lt(worst, 1e-6, `the spines are evenly spaced ${want.toFixed(3)} radians apart, with no doubled bearing`)
    t.eq(new Set(angles.map(a => a.toFixed(4))).size, spines.length, 'no two spines share a bearing')
  }

  t.section('thistle-hedgehog: short reach at base, enormous reach down Long Quills')
  {
    const base = def('thistle-hedgehog').base.range
    t.lt(base, Math.min(...['acorn-fox', 'boomer-badger', 'cannon-boar', 'frost-hare', 'sap-snail', 'sixgun-stoat']
      .map(k => def(k).base.range)), `its ${base} range is the shortest in the family`)
    t.gt(statsAt('thistle-hedgehog', [0, 3, 0]).range, base * 1.8, 'tier 3 of Long Quills more than doubles it')
    t.gt(statsAt('thistle-hedgehog', [0, 5, 0]).range, base * 5, 'and tier 5 is over five times base range')
  }

  t.section('thistle-hedgehog: Burning Thistle really sets balloons alight')
  {
    const cold = trial('thistle-hedgehog', [0, 0, 0], 'lead', { off: 40, count: 8, gap: 14, ticks: 90 })
    const lit = trial('thistle-hedgehog', [0, 0, 1], 'lead', { off: 40, count: 8, gap: 14, ticks: 90 })
    const coldBurning = cold.sim.balloons.filter(b => b.alive && OP.Effects.has(b, 'burn')).length
    const litBurning = lit.sim.balloons.filter(b => b.alive && OP.Effects.has(b, 'burn')).length
    t.eq(coldBurning, 0, 'an unupgraded Hedgehog sets nothing burning')
    t.gt(litBurning, 0, `a 0-0-1 Hedgehog has ${litBurning} Lead balloons burning`)
    // Lead ignores sharp, so every point of damage here came from the fire.
    t.eq(cold.sim.stats.damageDealt, 0, 'and with no fire, its sharp spines do literally nothing to Lead')
    t.gt(lit.sim.stats.damageDealt, 0, `while the burn did ${lit.sim.stats.damageDealt} damage through Lead armour`)
    t.gt(statsAt('thistle-hedgehog', [0, 0, 5]).burnMag, statsAt('thistle-hedgehog', [0, 0, 1]).burnMag * 10,
      'and the burn scales more than tenfold down the branch')
  }

  /* ==================================================================
     5. Frost Hare
     ================================================================== */

  t.section('frost-hare: the slow actually slows')
  {
    const run = trial('frost-hare', [0, 0, 0], 'ceramic', { count: 10, gap: 16, ticks: 150 })
    const chilled = run.sim.balloons.filter(b => b.alive && OP.Effects.has(b, 'cold'))
    t.gt(chilled.length, 0, `${chilled.length} ceramics are chilled`)
    t.ok(chilled.every(b => b.speedMul < 1), 'and every one of them is moving slower than normal')
    const e = OP.Effects.find(chilled[0], 'cold')
    t.close(e.mag, def('frost-hare').base.coldMag, 1e-9, `the chill removes ${(e.mag * 100).toFixed(0)}% of their speed`)
    t.close(chilled[0].speedMul, 1 - e.mag, 1e-6, 'which is exactly what speedMul shows')
  }

  t.section('frost-hare: cold is blank against White, and does not even chill it')
  {
    const run = trial('frost-hare', [0, 0, 0], 'white', { count: 12, gap: 14 })
    t.eq(run.sim.stats.popped, 0, 'no White balloon is popped')
    t.eq(run.sim.balloons.filter(b => b.alive && OP.Effects.has(b, 'cold')).length, 0,
      'and none of them is even chilled — White is already cold')
    t.gt(run.sim.stats.shotsFired, 0, 'the Hare was firing regardless')
  }

  t.section('frost-hare: Flash Freeze stops simple balloons dead')
  {
    const st = statsAt('frost-hare', [3, 0, 0])
    t.gt(st.stunTime, 0, `a 3-0-0 Hare freezes for ${st.stunTime}s`)
    // A freeze is brief by design, so watch the whole run rather than its end.
    function watch (tiers) {
      const s = board()
      const tower = put(s, 'frost-hare')
      build(s, tower, tiers)
      for (let i = 0; i < 10; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 230 + i * 16 })
      let stunned = 0, halted = 0
      for (let i = 0; i < 150; i++) {
        OP.Sim.step(s)
        for (const b of s.balloons) {
          if (!b.alive) continue
          if (OP.Effects.has(b, 'stun')) stunned++
          if (b.speedMul === 0) halted++
        }
      }
      return { stunned, halted, tower }
    }
    const frozen = watch([3, 0, 0])
    const unfrozen = watch([2, 0, 0])
    t.gt(frozen.stunned, 0, `a 3-0-0 Hare froze ceramics on ${frozen.stunned} balloon-ticks`)
    t.gt(frozen.halted, 0, 'and stopped them moving entirely while frozen')
    t.eq(statsAt('frost-hare', [2, 0, 0]).stunTime, 0, 'a 2-0-0 Hare cannot freeze at all')
    t.eq(unfrozen.stunned, 0, 'and never stuns anything')
    t.eq(unfrozen.halted, 0, 'so nothing it chills ever comes to a complete stop')
  }

  t.section('frost-hare: blimps resist the slow rather than ignoring it, and never freeze')
  {
    const s = board()
    const tower = put(s, 'frost-hare')
    build(s, tower, [3, 0, 0])
    const blimp = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 320 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Sim.run(s, 150)
    const cold = OP.Effects.find(blimp, 'cold')
    t.ok(cold, 'the GOLIATH is chilled')
    const tier = OP.tierByKey('goliath')
    t.close(cold.mag, tower.s.coldMag * tier.slowResist, 1e-6,
      `but only at ${(tier.slowResist * 100).toFixed(0)}% strength (${cold.mag.toFixed(3)} not ${tower.s.coldMag})`)
    t.gt(blimp.speedMul, 0, 'so it keeps moving')
    t.notOk(OP.Effects.has(blimp, 'stun'), 'and it is never frozen solid — blimps are stun immune')
  }

  t.section('frost-hare: Wider Chill widens the puff, Frostbite makes things brittle')
  {
    const base = statsAt('frost-hare', [0, 0, 0])
    t.gt(statsAt('frost-hare', [0, 3, 0]).blastRadius, base.blastRadius * 2,
      'a 0-3-0 Hare has more than twice the puff radius')
    t.gt(statsAt('frost-hare', [0, 5, 0]).pierce, base.pierce * 4,
      'and by tier 5 a single puff chills over four times as many balloons')
    t.eq(base.brittleMag, 0, 'an unupgraded Hare makes nothing brittle')
    const run = trial('frost-hare', [0, 0, 3], 'ceramic', { count: 10, gap: 16, ticks: 150 })
    const brittle = run.sim.balloons.filter(b => b.alive && OP.Effects.has(b, 'brittle'))
    t.gt(brittle.length, 0, `a 0-0-3 Hare left ${brittle.length} ceramics brittle`)
    t.gt(OP.Effects.damageMultiplier(brittle[0]), 1,
      `and they take ${OP.Effects.damageMultiplier(brittle[0]).toFixed(2)}x damage from everything`)
  }

  /* ==================================================================
     6. Sap Snail
     ================================================================== */

  t.section('sap-snail: it is a force multiplier, not a damage dealer')
  {
    const b = def('sap-snail').base
    t.lte(b.damage, 1, `its shot does ${b.damage} damage`)
    const run = trial('sap-snail', [0, 0, 0], 'ceramic', { count: 10, gap: 16, ticks: 150 })
    const glued = run.sim.balloons.filter(x => x.alive && OP.Effects.has(x, 'glue'))
    t.gt(glued.length, 0, `but it glued ${glued.length} ceramics`)
    t.ok(glued.every(x => x.speedMul < 1), 'and every glued balloon is slowed')
    t.close(OP.Effects.find(glued[0], 'glue').mag, b.glueMag, 1e-9,
      `the sap removes ${(b.glueMag * 100).toFixed(0)}% of their speed`)
  }

  t.section('sap-snail: corrosion keeps working after the shot is gone')
  {
    const s = board()
    const tower = put(s, 'sap-snail')
    build(s, tower, [3, 0, 0])
    t.gt(tower.s.acidMag, 0, `a 3-0-0 Snail corrodes for ${tower.s.acidMag}/s`)
    OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 320 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Sim.run(s, 120)
    const blimp = s.balloons.find(b => b.alive && OP.BALLOON_TIERS[b.tier].key === 'goliath')
    t.ok(blimp && OP.Effects.has(blimp, 'acid'), 'the GOLIATH is corroding')
    // Sell the tower and clear the air: anything that happens now is the acid.
    OP.Towers.sell(s, tower)
    for (let i = s.projectiles.length - 1; i >= 0; i--) s.projectiles[i].alive = false
    OP.Sim.step(s)
    t.eq(s.projectiles.length, 0, 'with the Snail sold and the board clear of shots')
    const before = s.stats.damageDealt
    const shotsBefore = s.stats.shotsFired
    OP.Sim.run(s, 60)
    t.gt(s.stats.damageDealt - before, 0,
      `the corrosion still did ${s.stats.damageDealt - before} damage over the next second`)
    t.eq(s.stats.shotsFired, shotsBefore, 'with nothing at all firing during that second')
  }

  t.section('sap-snail: Sap Splash reaches balloons the shot never touched')
  {
    const s = board()
    const tower = put(s, 'sap-snail')
    build(s, tower, [0, 3, 0])
    t.eq(tower.s.behaviour, 'primary-sap-spread', 'a 0-3-0 Snail splashes')
    t.gt(tower.s.behR, 0, `over a ${tower.s.behR} unit radius`)
    // A tight knot of Leads: immune to acid damage? No - nothing resists acid, so
    // use Leads only as a stable, slow clump and count glue rather than pops.
    for (let i = 0; i < 14; i++) OP.Balloons.spawn(s, { tier: 'lead', path: 0, t: 318 + i * 3 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Sim.run(s, 30)
    const glued = s.balloons.filter(b => b.alive && OP.Effects.has(b, 'glue')).length
    t.gt(glued, tower.s.pierce,
      `${glued} balloons are glued from a shot that can only pierce ${tower.s.pierce}`)
  }

  t.section('sap-snail: Plate Etcher strips plating')
  {
    const plain = board()
    const t1 = put(plain, 'sap-snail')
    build(plain, t1, [0, 0, 2])
    const b1 = OP.Balloons.spawn(plain, { tier: 'ceramic', path: 0, t: 320, props: OP.PROP.PLATED })
    OP.Grid.rebuild(plain.grid, plain.balloons)
    OP.Sim.run(plain, 90)
    t.ok((b1.props & OP.PROP.PLATED) !== 0, 'a 0-0-2 Snail leaves plating alone')

    const etch = board()
    const t2 = put(etch, 'sap-snail')
    build(etch, t2, [0, 0, 3])
    t.eq(t2.s.behaviour, 'primary-sap-etch', 'a 0-0-3 Snail is an etcher')
    const b2 = OP.Balloons.spawn(etch, { tier: 'ceramic', path: 0, t: 320, props: OP.PROP.PLATED })
    OP.Grid.rebuild(etch.grid, etch.balloons)
    OP.Sim.run(etch, 90)
    t.eq(b2.props & OP.PROP.PLATED, 0, 'and it eats the plating clean off')
    t.ok(b2.alive, 'without deleting the balloon in the process')
  }

  t.section('sap-snail: brittleness really amplifies another tower')
  {
    function foxDamage (withSnail) {
      const s = board()
      const track = s.map.paths[0]
      const p = track.posAt(320)
      const fox = OP.Towers.place(s, 'acorn-fox',
        M.clamp(p.x, 60, OP.FIELD_W - 60), M.clamp(p.y - 55, 60, OP.FIELD_H - 60), { free: true })
      if (withSnail) {
        const q = track.posAt(320)
        const snail = OP.Towers.place(s, 'sap-snail',
          M.clamp(q.x + 40, 60, OP.FIELD_W - 60), M.clamp(q.y - 55, 60, OP.FIELD_H - 60), { free: true })
        build(s, snail, [0, 0, 2])
      }
      for (let i = 0; i < 3; i++) OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 300 + i * 12 })
      OP.Grid.rebuild(s.grid, s.balloons)
      OP.Sim.run(s, 300)
      return { total: s.stats.damageDealt, fox: fox }
    }
    const alone = foxDamage(false)
    const helped = foxDamage(true)
    t.gt(alone.total, 0, `a lone Fox did ${alone.total} damage to three GOLIATHs`)
    t.gt(helped.total, alone.total * 1.2,
      `with a 0-0-2 Snail softening them the board did ${helped.total} — the brittleness is real`)
  }

  t.section('sap-snail: Dissolution floods the board')
  {
    const s = board()
    const tower = put(s, 'sap-snail')
    build(s, tower, [5, 0, 0])
    t.eq(tower.s.ability.key, 'primary-snail-dissolution', 'a 5-0-0 Snail has Dissolution')
    for (let i = 0; i < 8; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 300 + i * 9 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Towers.activate(s, tower)
    const soaked = s.balloons.filter(b => b.alive && OP.Effects.has(b, 'acid') && OP.Effects.has(b, 'brittle'))
    t.gt(soaked.length, 0, `${soaked.length} ceramics are corroding and brittle at once`)
  }

  /* ==================================================================
     7. Sixgun Stoat
     ================================================================== */

  /** Count shots over `ticks` against a wall of Leads that will not die. */
  function stoatShots (tiers, ticks) {
    const s = board()
    const tower = put(s, 'sixgun-stoat')
    if (tiers) build(s, tower, tiers)
    for (let i = 0; i < 30; i++) OP.Balloons.spawn(s, { tier: 'lead', path: 0, t: 240 + i * 6 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const perTick = []
    let last = 0
    for (let i = 0; i < ticks; i++) {
      OP.Sim.step(s)
      perTick.push(s.stats.shotsFired - last)
      last = s.stats.shotsFired
    }
    return { sim: s, tower: tower, total: last, perTick: perTick }
  }

  t.section('sixgun-stoat: six shots, then a real reload pause')
  {
    const st = def('sixgun-stoat').base
    t.eq(st.burst, 6, 'the cylinder holds six')
    t.gt(st.reload, 1, `and takes ${st.reload}s to refill`)
    t.lt(st.cooldown, 0.2, `while shots inside a burst are only ${st.cooldown}s apart`)

    const run = stoatShots([0, 0, 0], 300)
    t.between(run.total, 8, 20,
      `in 5 seconds it fired ${run.total} shots — six-shot bursts with reloads, not ${Math.round(5 / st.cooldown)} continuous shots`)

    // The longest silence must be at least most of a reload.
    let longest = 0, gap = 0
    for (const n of run.perTick) {
      if (n > 0) { longest = Math.max(longest, gap); gap = 0 } else gap++
    }
    t.gte(longest, Math.floor(st.reload * 60 * 0.8),
      `and the longest gap between shots was ${longest} ticks — the reload is really happening`)
    t.eq(run.tower.data.left <= run.tower.s.burst, true, 'the magazine count never exceeds the cylinder size')
  }

  t.section('sixgun-stoat: the burst state is plain serialisable data')
  {
    const run = stoatShots([0, 0, 0], 60)
    const d = run.tower.data
    t.deep(JSON.parse(JSON.stringify(d)), d, 'tower.data round-trips through JSON unchanged')
    t.ok(Object.keys(d).every(k => typeof d[k] === 'number'), 'every field in it is a plain number')
    t.gt(Object.keys(d).length, 0, `and it is actually being used (${Object.keys(d).join(', ')})`)
  }

  t.section('sixgun-stoat: Bottomless never reloads again')
  {
    const st = statsAt('sixgun-stoat', [0, 5, 0])
    t.eq(st.reload, 0, 'a 0-5-0 Stoat has a reload time of zero')
    const base = stoatShots([0, 0, 0], 300)
    const endless = stoatShots([0, 5, 0], 300)
    t.gt(endless.total, base.total * 2,
      `and fires ${endless.total} shots in 5 seconds against the base gun's ${base.total}`)
    let longest = 0, gap = 0
    for (const n of endless.perTick) {
      if (n > 0) { longest = Math.max(longest, gap); gap = 0 } else gap++
    }
    t.lt(longest, 30, `with no gap longer than ${longest} ticks — the pause is gone`)
  }

  t.section('sixgun-stoat: One Shot is one enormous shot')
  {
    const st = statsAt('sixgun-stoat', [5, 0, 0])
    t.eq(st.burst, 1, 'a 5-0-0 Stoat holds a single round')
    t.gte(st.damage, 150, `worth ${st.damage} damage`)
    t.gt(st.damage, statsAt('sixgun-stoat', [4, 0, 0]).damage * 3, 'over triple the tier-4 shot')
    const s = board()
    const tower = put(s, 'sixgun-stoat')
    build(s, tower, [5, 0, 0])
    OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 320 })
    OP.Grid.rebuild(s.grid, s.balloons)
    OP.Sim.run(s, 300)
    t.gt(s.stats.damageDealt, st.damage, `and it put ${s.stats.damageDealt} into a GOLIATH's hull in 5 seconds`)
    for (let i = 0; i < 4; i++) OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 300 + i * 10 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const before = s.stats.shotsFired
    t.ok(OP.Towers.activate(s, tower).ok, 'Fan The Hammer activates')
    t.gt(s.stats.shotsFired - before, 0, 'and fires extra rounds')
    t.eq(tower.data.reload, 0, 'and refills the cylinder as it does')
    t.eq(tower.data.left, tower.s.burst, 'leaving a full cylinder behind')
  }

  t.section('sixgun-stoat: sharp cannot touch Lead here either')
  {
    const run = stoatShots([5, 0, 0], 300)
    t.gt(run.total, 0, 'the Stoat unloaded into a wall of Lead balloons')
    t.eq(run.sim.stats.popped, 0, 'and popped none of them — no branch of this tower answers Lead')
  }

  /* ==================================================================
     every ability, exercised
     ================================================================== */

  t.section('primary: every ability does something observable when activated')
  const ABILITY_BUILDS = [
    ['acorn-fox', [5, 0, 0]],
    ['boomer-badger', [0, 5, 0]],
    ['cannon-boar', [5, 0, 0]],
    ['thistle-hedgehog', [0, 5, 0]],
    ['frost-hare', [5, 0, 0]],
    ['sap-snail', [5, 0, 0]],
    ['sixgun-stoat', [5, 0, 0]]
  ]
  for (const [key, tiers] of ABILITY_BUILDS) {
    const s = board()
    const tower = put(s, key)
    const reached = build(s, tower, tiers)
    if (!t.ok(reached && tower.s.ability, `${key} reaches an ability at ${tiers.join('-')}`)) continue
    for (let i = 0; i < 10; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 300 + i * 8 })
    OP.Grid.rebuild(s.grid, s.balloons)
    const shots = s.stats.shotsFired
    const dmg = s.stats.damageDealt
    const chilled = s.balloons.filter(b => b.alive && b.effects.length > 0).length
    t.ok(OP.Towers.activate(s, tower).ok, `${key}'s "${tower.s.ability.name}" activates`)
    OP.Sim.run(s, 30)
    const changed = s.stats.shotsFired > shots || s.stats.damageDealt > dmg ||
      s.balloons.filter(b => b.alive && b.effects.length > 0).length > chilled
    t.ok(changed, `${key}'s ability changed the board (shots, damage or status effects)`)
    t.gt(tower.abilityCd, 0, `${key}'s ability went on its ${tower.s.ability.cooldown}s cooldown`)
  }

  /* ==================================================================
     determinism and serialisation of the family's own state
     ================================================================== */

  t.section('primary: the family is deterministic and survives a mid-round save')
  for (const key of ROSTER) {
    function play (seed) {
      const s = makeSim(OP, { tracks: [arena(OP)], cash: 1e9, lives: 1e8, seed: seed })
      const tower = put(s, key)
      build(s, tower, [3, 2, 0])
      for (let i = 0; i < 20; i++) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 200 + i * 11 })
      OP.Sim.run(s, 300)
      return s
    }
    const a = play('same-seed')
    const b = play('same-seed')
    t.eq(OP.Sim.checksum(a), OP.Sim.checksum(b), `${key} runs identically twice on one seed`)

    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(a)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(a), `${key} survives a save mid-flight`)
    OP.Sim.run(a, 120)
    OP.Sim.run(back, 120)
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(a), `${key} keeps matching for 2 seconds after resuming`)
  }
}

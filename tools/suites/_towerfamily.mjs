// The shared floor every tower-family suite must call.
//
// Written deliberately outside the fan-out. If the agent authoring
// js/towers/primary.js also authored its own pass criteria, the criteria would
// describe whatever it happened to build — and "needs-fails-not-skips" does not
// catch that, because the suite exists and passes. A family suite adds flavour on
// top of a floor it cannot lower.
//
// A family suite is expected to be:
//
//   import { assertFamily } from './_towerfamily.mjs'
//   export const name = 'towers-primary'
//   export const needs = ['js/towers/primary.js']
//   export function run (t, OP) {
//     assertFamily(t, OP, 'primary', { expect: 7 })
//     // ...family-specific assertions...
//   }

import { makeSim } from './_fixture.mjs'

/** A serpentine track inside the field, plus wide-open land to build on. */
export function arena (OP) {
  // Rounded turns rather than 180-degree reversals: a Catmull-Rom spline through
  // a hairpin overshoots hard, and a track leaving the field would clamp
  // hundreds of balloons into the grid's edge cells and measure a linear scan.
  const L = 140, R = 1140, TURN = 70
  const pts = [{ x: L, y: 160 }]
  for (let row = 0; row < 3; row++) {
    const y = 160 + row * 190
    const rightward = row % 2 === 0
    const from = rightward ? L : R
    const to = rightward ? R : L
    pts.push({ x: from, y }, { x: to, y })
    if (row < 2) {
      const out = rightward ? TURN : -TURN
      pts.push({ x: to + out, y: y + 95 })
    }
  }
  return new OP.Track(pts, { smooth: 4 })
}

/** Somewhere on the track, and a build spot a given distance off it. */
function spotNear (OP, track, t, offset) {
  const p = track.posAt(t)
  return { x: OP.M.clamp(p.x, 60, OP.FIELD_W - 60), y: OP.M.clamp(p.y - offset, 60, OP.FIELD_H - 60) }
}

function sim (OP, opts) {
  return makeSim(OP, Object.assign({
    tracks: [arena(OP)], cash: 100000000, lives: 100000
  }, opts || {}))
}

/**
 * @param {object} t      harness assertion recorder
 * @param {object} OP
 * @param {string} family 'primary' | 'military' | 'magic' | 'support'
 * @param {{expect?:number, keys?:string[]}} [opts]
 *   keys defaults to OP.FAMILY_ROSTERS[family], which the family file declares.
 *   It is explicit rather than derived from Towers.byFamily() because other
 *   suites register throwaway test towers into the same registry, and the floor
 *   must audit exactly the shipped roster.
 */
export function assertFamily (t, OP, family, opts) {
  opts = opts || {}
  const keys = opts.keys || OP.FAMILY_ROSTERS[family]

  t.section(`${family}: roster`)
  if (!t.ok(Array.isArray(keys) && keys.length > 0,
    `the family file declared OP.FAMILY_ROSTERS.${family}`)) return []
  t.eq(new Set(keys).size, keys.length, 'declared keys are unique')

  const missing = keys.filter(k => !OP.TOWERS[k])
  t.eq(missing.length, 0, missing.length ? `declared but not registered: ${missing.join(', ')}` : 'every declared key is registered')
  const defs = keys.filter(k => OP.TOWERS[k]).map(k => OP.TOWERS[k])
  if (!defs.length) return []

  if (opts.expect) t.eq(defs.length, opts.expect, `exactly ${opts.expect} ${family} towers`)
  t.ok(defs.every(d => d.family === family), 'every tower claims the right family')

  t.section(`${family}: no borrowed proper nouns`)
  // Mechanics are not protectable; names are. This catches a content agent
  // reaching for a familiar name without thinking.
  // Two lists. The acronyms collide with ordinary English ("a bad idea"), so they
  // are matched case-sensitively; the rest are unambiguous in any casing.
  const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
  const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/
  for (const d of defs) {
    const blob = JSON.stringify({
      name: d.name, blurb: d.blurb || '',
      paths: d.paths.map(p => ({ n: p.name, t: p.tiers.map(u => ({ n: u.name, d: u.desc })) }))
    })
    const hit = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${d.key} uses no borrowed proper nouns` + (hit ? ` — found "${hit}"` : ''))
  }

  t.section(`${family}: definitions are well-formed beyond what defineTower checks`)
  for (const d of defs) {
    t.ok(d.blurb && d.blurb.length > 15, `${d.key} has a shop blurb`)
    t.ok(['land', 'water', 'any'].indexOf(d.placement) >= 0, `${d.key} has a valid placement rule`)
    t.between(d.footprint, 6, 32, `${d.key} footprint is sane`)
    t.ok(d.paths.every(p => new Set(p.tiers.map(u => u.name)).size === 5),
      `${d.key} has no duplicate upgrade names within a branch`)
    t.eq(new Set(d.paths.map(p => p.name)).size, 3, `${d.key} branch names are distinct`)
  }

  t.section(`${family}: costs sit inside the shared ladder`)
  for (const d of defs) {
    const audit = OP.Upgrades.auditCosts(d)
    t.ok(audit.ok, `${d.key} cost ladder` + (audit.ok ? '' : ':\n         ' + audit.problems.join('\n         ')))
  }

  t.section(`${family}: every declared projectile kind exists`)
  // Collected during the firing checks below and asserted at the end.
  const emitted = {}

  t.section(`${family}: each tower places, aims and fires`)
  for (const d of defs) {
    const s = sim(OP)
    const track = s.map.paths[0]
    const spot = spotNear(OP, track, 300, d.placement === 'water' ? 0 : 70)
    const tower = OP.Towers.place(s, d.key, spot.x, spot.y, { free: true })
    if (!t.ok(tower, `${d.key} places on open ground`)) continue

    t.ok(tower.s, `${d.key} resolved its stats on placement`)
    t.gt(tower.s.range, 0, `${d.key} has positive range`)
    t.gt(tower.s.cooldown, 0, `${d.key} has positive cooldown`)

    // Put a stream of balloons through its range and see that something happens.
    for (let i = 0; i < 30; i++) OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 240 + i * 9 })
    OP.Sim.run(s, 240)

    const didSomething = s.stats.shotsFired > 0 || s.stats.popped > 0 ||
      s.cash > 100000000 || (tower.data && Object.keys(tower.data).length > 0)
    t.ok(didSomething, `${d.key} does something within 4 seconds of targets arriving`)

    for (const kind in s.kindsSeen) emitted[kind] = true
  }

  t.section(`${family}: attacking towers actually pop things`)
  for (const d of defs) {
    if (!d.fire) continue         // update-driven support towers are exempt
    const s = sim(OP)
    const track = s.map.paths[0]
    const spot = spotNear(OP, track, 300, 60)
    OP.Towers.place(s, d.key, spot.x, spot.y, { free: true })
    for (let i = 0; i < 40; i++) OP.Balloons.spawn(s, { tier: 'red', path: 0, t: 200 + i * 8 })
    OP.Sim.run(s, 420)
    t.gt(s.stats.popped, 0, `${d.key} pops at least one red balloon`)
    for (const kind in s.kindsSeen) emitted[kind] = true
  }

  t.section(`${family}: immunity is honoured — no tower pops what its damage type cannot`)
  for (const d of defs) {
    if (!d.fire) continue
    const immuneTier = tierImmuneTo(OP, d.base.dmgType)
    if (!immuneTier) continue     // nothing resists this type, e.g. shatter
    const s = sim(OP)
    const track = s.map.paths[0]
    const spot = spotNear(OP, track, 300, 60)
    OP.Towers.place(s, d.key, spot.x, spot.y, { free: true })
    for (let i = 0; i < 12; i++) OP.Balloons.spawn(s, { tier: immuneTier, path: 0, t: 220 + i * 14 })
    OP.Sim.run(s, 360)
    t.eq(s.stats.popped, 0,
      `${d.key} (${d.base.dmgType}) cannot pop ${immuneTier} at base — that is what upgrades are for`)
  }

  t.section(`${family}: every legal upgrade state is reachable and leaves sane stats`)
  const maxima = OP.Upgrades.legalMaxima()
  for (const d of defs) {
    let broken = null
    for (const target of maxima) {
      const s = sim(OP)
      const spot = spotNear(OP, s.map.paths[0], 300, 70)
      const tower = OP.Towers.place(s, d.key, spot.x, spot.y, { free: true })
      if (!tower) { broken = 'could not place'; break }

      // Walk there one legal purchase at a time.
      let guard = 0
      while (tower.tiers.join() !== target.join()) {
        if (++guard > 32) { broken = `stalled walking to ${target.join('-')}`; break }
        let bought = false
        for (let p = 0; p < 3; p++) {
          if (tower.tiers[p] >= target[p]) continue
          const res = OP.Upgrades.buy(s, tower, p)
          if (res.ok) { bought = true; break }
        }
        if (!bought) { broken = `could not reach ${target.join('-')}`; break }
      }
      if (broken) break

      const st = tower.s
      const bad = []
      if (!(st.cooldown > 0) || !isFinite(st.cooldown)) bad.push('cooldown ' + st.cooldown)
      if (!(st.range > 0) || !isFinite(st.range)) bad.push('range ' + st.range)
      if (!(st.damage >= 0) || !isFinite(st.damage)) bad.push('damage ' + st.damage)
      if (!(st.pierce >= 1) || !isFinite(st.pierce)) bad.push('pierce ' + st.pierce)
      if (!(st.shots >= 1) || !isFinite(st.shots)) bad.push('shots ' + st.shots)
      if (st.dmgType && OP.DMG_ORDER.indexOf(st.dmgType) < 0) bad.push('dmgType ' + st.dmgType)
      if (st.ability && typeof st.ability.key !== 'string') bad.push('ability key is not a string')
      if (st.ability && !OP.ABILITIES[st.ability.key]) bad.push('ability "' + st.ability.key + '" not registered')
      if (st.behaviour && !OP.PROJ_BEHAVIOURS[st.behaviour]) bad.push('behaviour "' + st.behaviour + '" not registered')
      // The engine clamps invalid stats so play continues, but it records what it
      // had to clamp. An upgrade producing NaN shows up here rather than being
      // silently repaired and shipping as a dead branch.
      if (tower.statWarnings) bad.push('engine had to clamp: ' + tower.statWarnings.join('; '))
      if (bad.length) { broken = `${target.join('-')} gives ${bad.join(', ')}`; break }
    }
    t.ok(!broken, `${d.key} walks every legal state cleanly` + (broken ? ` — ${broken}` : ''))
  }

  t.section(`${family}: repeated restat is idempotent`)
  // `apply` must be a pure function of the stat object. A hidden counter or an
  // accumulating side effect shows up here, because restat runs from scratch.
  for (const d of defs) {
    const s = sim(OP)
    const spot = spotNear(OP, s.map.paths[0], 300, 70)
    const tower = OP.Towers.place(s, d.key, spot.x, spot.y, { free: true })
    if (!tower) continue
    for (let i = 0; i < 3; i++) OP.Upgrades.buy(s, tower, 0)
    OP.Upgrades.buy(s, tower, 1)
    const once = statFingerprint(tower.s)
    OP.Towers.restat(s, tower)
    OP.Towers.restat(s, tower)
    OP.Towers.restat(s, tower)
    t.eq(statFingerprint(tower.s), once, `${d.key} stats are identical after three more restats`)
  }

  t.section(`${family}: a fully upgraded tower out-damages a fresh one`)
  for (const d of defs) {
    if (!d.fire) continue
    const fresh = measure(OP, d, [0, 0, 0])
    const maxed = measure(OP, d, bestFive(d))
    t.gt(fresh, 0, `${d.key} does damage at all when unupgraded (${fresh})`)
    t.gt(maxed, fresh, `${d.key} 5-2-0 out-damages 0-0-0 (${fresh} -> ${maxed})`)
  }

  t.section(`${family}: value per dollar is in the same league as its siblings`)
  // Not an absolute target — a band, so one tower cannot be an order of magnitude
  // off the rest and have it go unnoticed until the playthrough phase.
  for (const d of defs) {
    if (!d.fire) continue
    const dps = d.base.damage * (d.base.shots || 1) / d.base.cooldown
    const perDollar = dps / d.cost * 1000
    t.between(perDollar, 0.6, 60,
      `${d.key} base value/1000$ is ${perDollar.toFixed(2)} (damage ${d.base.damage} / cooldown ${d.base.cooldown} / cost ${d.cost})`)
  }

  t.section(`${family}: sell, replace and serialise`)
  for (const d of defs) {
    const s = sim(OP)
    const spot = spotNear(OP, s.map.paths[0], 300, 70)
    const tower = OP.Towers.place(s, d.key, spot.x, spot.y)
    if (!tower) continue
    OP.Upgrades.buy(s, tower, 0)
    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), `${d.key} survives a save round-trip`)
    t.gt(OP.Towers.sell(s, tower), 0, `${d.key} sells for something`)
    t.eq(s.towers.length, 0, `${d.key} leaves the board when sold`)
    t.eq(s.buffs.filter(b => b.sourceId === tower.id).length, 0, `${d.key} leaves no orphaned buff`)
  }

  t.section(`${family}: every emitted projectile kind is declared`)
  const undeclared = Object.keys(emitted).filter(k => !OP.PROJ_KINDS[k])
  t.eq(undeclared.length, 0, undeclared.length
    ? `undeclared kinds would render as nothing: ${undeclared.join(', ')} — call OP.declareProjKind()`
    : `all ${Object.keys(emitted).length} emitted kinds are declared`)

  return defs
}

/* ---------- helpers ---------- */

function statFingerprint (s) {
  const keys = Object.keys(s).filter(k => typeof s[k] !== 'object' || s[k] === null).sort()
  return keys.map(k => `${k}=${typeof s[k] === 'number' ? s[k].toFixed(6) : s[k]}`).join('|')
}

function tierImmuneTo (OP, dmgType) {
  for (const tier of OP.BALLOON_TIERS) {
    if (tier.blimp) continue
    if (tier.immuneSet[dmgType] && !OP.dmgBypasses(dmgType, dmgType)) return tier.key
  }
  return null
}

function bestFive (def) {
  // 5 on branch 0, 2 on branch 1 — a representative full build.
  return [5, 2, 0]
}

/**
 * Throughput of one tower at a given upgrade state, measured as total damage
 * landed against a SUSTAINED stream.
 *
 * Damage rather than pops: a single tower shooting ceramics may legitimately pop
 * nothing while still doing plenty of work, and a pop-count metric reads that as
 * zero. Sustained rather than one clump: a clump drifts out of range in a couple
 * of seconds and the measurement becomes "how fast does the tower start", which
 * is not what upgrades are supposed to improve.
 */
function measure (OP, def, target, tierKey) {
  const s = makeSim(OP, { tracks: [arena(OP)], cash: 1000000000, lives: 100000000, seed: 'measure' })
  const p = s.map.paths[0].posAt(320)
  const tower = OP.Towers.place(s, def.key, OP.M.clamp(p.x, 60, OP.FIELD_W - 60),
    OP.M.clamp(p.y - 55, 60, OP.FIELD_H - 60), { free: true })
  if (!tower) return 0

  let guard = 0
  while (tower.tiers.join() !== target.join() && guard++ < 32) {
    let bought = false
    for (let i = 0; i < 3; i++) {
      if (tower.tiers[i] >= target[i]) continue
      if (OP.Upgrades.buy(s, tower, i).ok) { bought = true; break }
    }
    if (!bought) break
  }

  const TICKS = 900
  for (let i = 0; i < TICKS; i++) {
    if (i % 12 === 0) OP.Balloons.spawn(s, { tier: tierKey || 'ceramic', path: 0, t: 0 })
    OP.Sim.step(s)
  }
  return s.stats.damageDealt
}

export const name = 'paragon-roster'
export const needs = ['js/towers/paragons.js']

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'
import { ROOT } from '../loadgame.mjs'

/* The shipped paragon roster.
 *
 * `tools/suites/paragon.mjs` proves the paragon MECHANISM against the template.
 * This suite proves the six paragons that actually ship: that each one is
 * reachable from a real board, that degree changes the answer, that the numbers
 * stay finite at both ends of the degree range, and that promoting is worth doing.
 *
 * Two structural decisions worth stating, because both were wrong first:
 *
 * 1. The roster is discovered by reading `towerKey:` out of js/towers/paragons.js,
 *    NOT from OP.PARAGONS and NOT from OP.FAMILY_ROSTERS. Under `--all`, several
 *    suites evalFile js/towers/_TEMPLATE.js and js/towers/_PARAGON_TEMPLATE.js into
 *    the same OP — the template reassigns FAMILY_ROSTERS.primary to its own key and
 *    registers a paragon of its own. Deriving the roster from either registry would
 *    make this suite pass or fail depending on which suites ran before it.
 *
 * 2. README.md promises "Paragon tier for a subset of towers" and names the subset.
 *    That promise is checked here as a three-way identity: README list ↔ source
 *    keys ↔ OP.PARAGONS. Any of the three drifting fails the build, which is the
 *    only thing that stops the README quietly becoming a false claim.
 */

// Two lists, as in tools/suites/_towerfamily.mjs. The acronyms collide with
// ordinary English, so they are matched case-sensitively; the rest are unambiguous.
const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/

export function run (t, OP, env) {
  const P = OP.Paragon
  const M = OP.M

  const SRC = readFileSync(resolve(ROOT, 'js/towers/paragons.js'), 'utf8')

  /* ---------- helpers ---------- */

  function sim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 2e12, lives: 1e7, seed: 'paragon-roster'
    }, opts || {}))
  }

  /** A build spot `off` units off the track, well inside the field. */
  function spotFor (s, off) {
    const p = s.map.paths[0].posAt(320)
    return {
      x: M.clamp(p.x, 60, OP.FIELD_W - 60),
      y: M.clamp(p.y - (off === undefined ? 58 : off), 60, OP.FIELD_H - 60)
    }
  }

  function upgradeTo (s, tower, target) {
    let guard = 0
    while (tower.tiers.join() !== target.join() && guard++ < 32) {
      let bought = false
      for (let i = 0; i < 3; i++) {
        if (tower.tiers[i] >= target[i]) continue
        if (OP.Upgrades.buy(s, tower, i).ok) { bought = true; break }
      }
      if (!bought) break
    }
    return tower.tiers.join() === target.join()
  }

  /** Fill the bottom of the field with `n` more towers of `key`, each `tiers` deep. */
  function fillBoard (s, key, n, tiers) {
    const out = []
    for (let i = 0; i < n; i++) {
      const tw = OP.Towers.place(s, key, 95 + (i % 8) * 145, 650 - Math.floor(i / 8) * 95, { free: true })
      if (!tw) continue
      for (let k = 0; k < (tiers === undefined ? 5 : tiers); k++) OP.Upgrades.buy(s, tw, 0)
      out.push(tw)
    }
    return out
  }

  /**
   * One tower of `key` beside the track plus `extra` sacrifices, then promote.
   * The lead tower is the one that survives, so it is the one next to the track.
   */
  function promoteBoard (key, extra, tiers) {
    const s = sim()
    const spot = spotFor(s)
    const lead = OP.Towers.place(s, key, spot.x, spot.y, { free: true })
    if (!lead) return { s: s, tower: null, ok: false, degree: 0, sacrificed: 0 }
    for (let k = 0; k < (tiers === undefined ? 5 : tiers); k++) OP.Upgrades.buy(s, lead, 0)
    const others = fillBoard(s, key, extra, tiers)
    const res = P.promote(s, lead)
    return { s: s, tower: lead, ok: res.ok, reason: res.reason, degree: res.degree, sacrificed: others.length }
  }

  /**
   * Total damage landed against a SUSTAINED stream, exactly as
   * tools/suites/_towerfamily.mjs measures it — damage rather than pops, because a
   * single tower shooting Ceramics can do plenty of work and pop nothing.
   */
  function measure (key, promote) {
    const s = makeSim(OP, {
      tracks: [arena(OP)], cash: 2e12, lives: 1e9, seed: 'paragon-measure'
    })
    const spot = spotFor(s, 55)
    const lead = OP.Towers.place(s, key, spot.x, spot.y, { free: true })
    if (!lead) return { dmg: -1, degree: 0, s: s, tower: null }
    upgradeTo(s, lead, [5, 2, 0])
    let degree = 0
    if (promote) {
      fillBoard(s, key, 7, 5)
      degree = P.promote(s, lead).degree
    }
    // Dense enough that neither build runs out of things to shoot: with a thin
    // stream both a 5-2-0 and its paragon clear everything and the measurement
    // silently becomes "how much RBE was supplied", which compares nothing.
    for (let i = 0; i < 720; i++) {
      if (i % 2 === 0) OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 0 })
      OP.Sim.step(s)
    }
    return { dmg: s.stats.damageDealt, degree: degree, s: s, tower: lead }
  }

  function fingerprint (s) {
    return Object.keys(s)
      .filter(k => typeof s[k] !== 'object' || s[k] === null)
      .sort()
      .map(k => `${k}=${typeof s[k] === 'number' ? s[k].toFixed(6) : s[k]}`)
      .join('|')
  }

  function badStats (tower) {
    const s = tower.s
    const bad = []
    const finite = (v, name) => { if (!isFinite(v)) bad.push(`${name} is ${v}`) }
    finite(s.damage, 'damage'); finite(s.pierce, 'pierce'); finite(s.cooldown, 'cooldown')
    finite(s.range, 'range'); finite(s.projSpeed, 'projSpeed'); finite(s.shots, 'shots')
    finite(s.projLife, 'projLife'); finite(s.projRadius, 'projRadius')
    if (!(s.cooldown > 0)) bad.push('cooldown ' + s.cooldown)
    if (!(s.damage >= 0)) bad.push('damage ' + s.damage)
    if (!(s.pierce >= 1)) bad.push('pierce ' + s.pierce)
    if (!(s.shots >= 1)) bad.push('shots ' + s.shots)
    if (!(s.range > 0)) bad.push('range ' + s.range)
    if (s.blastRadius !== undefined && !(s.blastRadius >= 0 && isFinite(s.blastRadius))) {
      bad.push('blastRadius ' + s.blastRadius)
    }
    if (s.dmgType && OP.DMG_ORDER.indexOf(s.dmgType) < 0) bad.push('dmgType ' + s.dmgType)
    if (tower.statWarnings) bad.push('engine had to clamp: ' + tower.statWarnings.join('; '))
    return bad
  }

  /* ======================================================================
     the roster, discovered from the source rather than from a registry
     ====================================================================== */

  t.section('the shipped roster')
  const KEYS = []
  const keyRe = /towerKey:\s*'([a-z0-9-]+)'/g
  let match
  while ((match = keyRe.exec(SRC)) !== null) KEYS.push(match[1])

  t.gt(KEYS.length, 0, `js/towers/paragons.js declares ${KEYS.length} paragons`)
  t.eq(new Set(KEYS).size, KEYS.length, 'no tower is given two paragons')
  t.eq(KEYS.length, 6, 'exactly six of the twenty-five towers get a paragon')

  const unregistered = KEYS.filter(k => !P.exists(k))
  t.eq(unregistered.length, 0, unregistered.length
    ? `declared in the source but not registered: ${unregistered.join(', ')}`
    : 'every declared paragon registered with defineParagon')

  const defs = KEYS.filter(k => P.exists(k)).map(k => P.forTower(k))
  t.eq(defs.length, KEYS.length, 'every paragon resolves through Paragon.forTower')

  t.section('every paragon names a registered tower')
  for (const def of defs) {
    t.ok(OP.TOWERS[def.towerKey], `${def.towerKey} is a registered tower`)
    t.ok(OP.TOWER_ORDER.indexOf(def.towerKey) >= 0, `${def.towerKey} is in OP.TOWER_ORDER`)
    // defineParagon throws on an unknown key, so a renamed tower fails at load.
    t.throws(() => P.define({
      towerKey: def.towerKey + '-renamed', name: 'x',
      blurb: 'a synthetic definition used only to re-prove the validator here',
      cost: 1, apply: function () {}
    }), `a paragon naming ${def.towerKey}-renamed would throw`)
  }

  t.section('the six span the whole game, not one corner of it')
  const families = defs.map(d => OP.TOWERS[d.towerKey].family)
  for (const fam of OP.FAMILIES) {
    t.ok(families.indexOf(fam) >= 0, `${fam} has at least one paragon`)
  }
  t.gte(new Set(families).size, OP.FAMILIES.length, 'all four families are represented')

  /* ======================================================================
     README.md ↔ source ↔ registry
     ====================================================================== */

  t.section('README.md lists exactly the paragons that exist')
  // Scoped to the "Paragon tier" bullet: the README's own disclaimer names
  // commercial games on purpose, and scanning the whole file would be wrong.
  const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8').split('\n')
  const start = readme.findIndex(l => /^-\s+\*\*Paragon tier\*\*/.test(l))
  t.gte(start, 0, 'README.md still has a "Paragon tier" bullet')

  const listed = []
  if (start >= 0) {
    for (let i = start + 1; i < readme.length; i++) {
      const line = readme[i]
      if (/^-\s/.test(line) || /^#/.test(line)) break        // next top-level bullet or heading
      const m = line.match(/^\s+-\s+`([a-z0-9-]+)`\s*→\s*\*\*(.+?)\*\*/)
      if (m) listed.push({ key: m[1], name: m[2] })
    }
  }

  t.eq(listed.length, KEYS.length,
    `the README lists ${listed.length} paragons and the source defines ${KEYS.length}`)
  const sortedListed = listed.map(l => l.key).sort().join(', ')
  const sortedSource = KEYS.slice().sort().join(', ')
  t.eq(sortedListed, sortedSource, 'the README list and the source agree, key for key')

  for (const entry of listed) {
    const def = P.forTower(entry.key)
    t.ok(def, `README names ${entry.key}, which has a registered paragon`)
    if (def) t.eq(entry.name, def.name, `README calls it "${def.name}"`)
  }

  // And the registry the game actually reads must not hold a shipped paragon the
  // README has never heard of. Template and fixture paragons are excluded by
  // checking against the source file, not by name.
  const registryExtras = Object.keys(OP.PARAGONS)
    .filter(k => SRC.indexOf("towerKey: '" + k + "'") >= 0)
    .filter(k => listed.every(l => l.key !== k))
  t.eq(registryExtras.length, 0, registryExtras.length
    ? `shipped but undocumented: ${registryExtras.join(', ')}`
    : 'nothing shipped is missing from the README')

  /* ======================================================================
     definitions
     ====================================================================== */

  t.section('every paragon is a complete definition')
  for (const def of defs) {
    t.ok(def.name && def.name.length > 3, `${def.towerKey}: has a display name`)
    t.neq(def.name, OP.TOWERS[def.towerKey].name, `${def.towerKey}: the paragon is not just the base name`)
    t.ok(def.blurb && def.blurb.length > 40, `${def.towerKey}: has a real blurb (${def.blurb ? def.blurb.length : 0} chars)`)
    t.gt(def.cost, 0, `${def.towerKey}: has a positive cost (${def.cost})`)
    t.between(def.minTier, 1, 5, `${def.towerKey}: minTier ${def.minTier} is inside the upgrade tree`)
    t.eq(typeof def.apply, 'function', `${def.towerKey}: has an apply()`)
    t.ok(def.fire === undefined || typeof def.fire === 'function',
      `${def.towerKey}: fire is a function or absent`)
  }

  t.section('paragon prices sit in one band across the roster')
  // There is no auditCosts for paragons, so the band is asserted here: every
  // paragon is priced against a full 5-2-0 of its own base tower, or the six end
  // up in six different economies and nothing surfaces it until a playthrough.
  for (const def of defs) {
    const base = OP.TOWERS[def.towerKey]
    let full = base.cost
    for (let i = 0; i < 5; i++) full += base.paths[0].tiers[i].cost
    for (let i = 0; i < 2; i++) full += base.paths[1].tiers[i].cost
    const ratio = def.cost / full
    t.between(ratio, 2.0, 3.5,
      `${def.towerKey}: $${def.cost} is ${ratio.toFixed(2)}x a full 5-2-0 ($${full})`)
  }

  t.section('no borrowed proper nouns anywhere in the roster')
  for (const def of defs) {
    const blob = JSON.stringify({
      name: def.name, blurb: def.blurb,
      ability: def.ability ? { name: def.ability.name, key: def.ability.key } : null
    })
    const hit = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${def.towerKey} uses no borrowed proper noun` + (hit ? ` — found "${hit}"` : ''))
  }
  const srcHit = (SRC.match(BANNED_ANY) || SRC.match(BANNED_CAPS) || [])[0]
  t.notOk(srcHit, 'js/towers/paragons.js is clean, comments included' + (srcHit ? ` — found "${srcHit}"` : ''))

  t.section('every ability is registered by string key')
  for (const def of defs) {
    if (!t.ok(def.ability, `${def.towerKey}: has an ability`)) continue
    t.eq(typeof def.ability.key, 'string', `${def.towerKey}: the ability is a string key, not a closure`)
    t.ok(OP.ABILITIES[def.ability.key], `${def.towerKey}: "${def.ability.key}" is registered in OP.ABILITIES`)
    t.eq(typeof OP.ABILITIES[def.ability.key], 'function', `${def.towerKey}: and it resolves to a function`)
    t.gt(def.ability.cooldown, 0, `${def.towerKey}: the ability has a positive cooldown`)
    t.ok(def.ability.name && def.ability.name.length > 2, `${def.towerKey}: the ability is named`)
  }

  t.section('every projectile kind the roster names is declared')
  const namedKinds = []
  const kindRe = /kind:\s*'(paragon-[a-z0-9-]+)'/g
  while ((match = kindRe.exec(SRC)) !== null) {
    if (namedKinds.indexOf(match[1]) < 0) namedKinds.push(match[1])
  }
  t.gt(namedKinds.length, 0, `the roster emits ${namedKinds.length} projectile kinds`)
  const undeclaredNamed = namedKinds.filter(k => !OP.PROJ_KINDS[k])
  t.eq(undeclaredNamed.length, 0, undeclaredNamed.length
    ? `undeclared, so they would render as nothing: ${undeclaredNamed.join(', ')}`
    : 'every kind named in the source went through OP.declareProjKind')

  /* ======================================================================
     promotion from a real board
     ====================================================================== */

  t.section('a board of each type can actually be promoted')
  for (const def of defs) {
    const key = def.towerKey
    const s = sim()
    const spot = spotFor(s)
    const lead = OP.Towers.place(s, key, spot.x, spot.y, { free: true })
    if (!t.ok(lead, `${key}: places beside the track`)) continue

    // Unupgraded, it is not eligible, and the refusal says what is missing.
    const early = P.preview(s, lead)
    t.notOk(early.ok, `${key}: an unupgraded tower cannot be promoted`)
    t.ok(/tier-\d/.test(early.reason), `${key}: and the reason names the tier it needs — "${early.reason}"`)

    for (let k = 0; k < def.minTier; k++) OP.Upgrades.buy(s, lead, 0)
    t.gte(OP.Upgrades.topTier(lead), def.minTier, `${key}: reached tier ${def.minTier} on one branch`)

    const others = fillBoard(s, key, 7, 5)
    t.gte(others.length, 5, `${key}: ${others.length} more of the same type on the board`)

    const pv = P.preview(s, lead)
    t.ok(pv.ok, `${key}: now eligible` + (pv.ok ? '' : ` — ${pv.reason}`))
    t.eq(pv.sacrifices.length, others.length, `${key}: all ${others.length} would be consumed`)
    t.gt(pv.cost, 0, `${key}: promotion has a price`)

    const before = s.towers.length
    const cashBefore = s.cash
    const res = P.promote(s, lead)
    t.ok(res.ok, `${key}: promotion succeeds` + (res.ok ? '' : ` — ${res.reason}`))
    t.between(res.degree, 1, P.MAX_DEGREE, `${key}: degree ${res.degree} is inside 1..${P.MAX_DEGREE}`)
    t.eq(lead.paragonDegree, res.degree, `${key}: the degree is recorded on the tower`)
    t.eq(s.towers.length, before - others.length, `${key}: the sacrifices left the board`)
    t.eq(s.towers.length, 1, `${key}: one tower of the type remains`)
    t.eq(s.towerById.get(lead.id), lead, `${key}: the promoted tower kept its id`)
    t.lt(s.cash, cashBefore, `${key}: and it was paid for — a sacrifice, not a sale`)
    t.eq(P.countOnBoard(s, key), 1, `${key}: one paragon on the board`)
    t.eq(OP.Towers.displayName(lead), def.name, `${key}: shown as "${def.name}" once promoted`)
    t.ok(lead.s.isParagon, `${key}: the stat block is flagged as a paragon`)
    t.eq(lead.s.paragonDegree, res.degree, `${key}: and carries the degree`)
    t.ok(lead.s.camoDetect, `${key}: sees Veiled balloons`)
    t.ok(lead.s.ability, `${key}: has an ability after promotion`)
    t.eq(lead.s.ability.key, def.ability.key,
      `${key}: it is the paragon's ability, not the tier-5 one it replaced`)

    // Only one per type, per map.
    const second = OP.Towers.place(s, key, 95, 320, { free: true })
    if (second) {
      for (let k = 0; k < def.minTier; k++) OP.Upgrades.buy(s, second, 0)
      const blocked = P.preview(s, second)
      t.notOk(blocked.ok, `${key}: a second paragon of the type is refused`)
      t.ok(/one paragon of a type/i.test(blocked.reason), `${key}: and says why — "${blocked.reason}"`)
      t.notOk(P.promote(s, second).ok, `${key}: promote refuses it too`)
    } else {
      t.fail(`${key}: could not place a second tower to prove the one-per-map rule`)
    }
    t.notOk(P.preview(s, lead).ok, `${key}: an already-promoted tower cannot be promoted again`)
  }

  /* ======================================================================
     degree is the mechanic
     ====================================================================== */

  t.section('degree scales the outcome — a small board and a big one differ')
  for (const def of defs) {
    const key = def.towerKey
    const small = promoteBoard(key, 0, 5)      // just the one tower
    const large = promoteBoard(key, 11, 5)
    if (!t.ok(small.ok && large.ok, `${key}: both boards promoted`)) continue

    t.gt(large.degree, small.degree,
      `${key}: a twelve-tower sacrifice beats a one-tower one (${small.degree} -> ${large.degree})`)
    t.gt(large.tower.s.damage, small.tower.s.damage,
      `${key}: and the damage went with it (${small.tower.s.damage} -> ${large.tower.s.damage})`)
    t.neq(fingerprint(large.tower.s), fingerprint(small.tower.s),
      `${key}: the whole stat block differs, not just one number`)
  }

  t.section('stats stay finite and sane at degree 1 and degree 100')
  for (const def of defs) {
    const key = def.towerKey
    const p = promoteBoard(key, 6, 5)
    if (!t.ok(p.ok, `${key}: promoted for the degree sweep`)) continue

    const prints = {}
    for (const degree of [1, 50, P.MAX_DEGREE]) {
      p.tower.paragonDegree = degree
      OP.Towers.restat(p.s, p.tower)
      const bad = badStats(p.tower)
      t.eq(bad.length, 0, `${key}: degree ${degree} resolves cleanly` +
        (bad.length ? ` — ${bad.join(', ')}` : ` (damage ${p.tower.s.damage}, cooldown ${p.tower.s.cooldown.toFixed(4)})`))
      prints[degree] = fingerprint(p.tower.s)
    }
    t.neq(prints[1], prints[P.MAX_DEGREE], `${key}: degree 1 and degree 100 are different towers`)
    t.neq(prints[1], prints[50], `${key}: degree never stops mattering in between`)

    // apply() must be pure: restat rebuilds from scratch on every purchase, buff
    // change and reload, so a counter or a sim write in apply shows up here.
    p.tower.paragonDegree = 60
    OP.Towers.restat(p.s, p.tower)
    const once = fingerprint(p.tower.s)
    OP.Towers.restat(p.s, p.tower)
    OP.Towers.restat(p.s, p.tower)
    OP.Towers.restat(p.s, p.tower)
    t.eq(fingerprint(p.tower.s), once, `${key}: three more restats change nothing — apply() is pure`)
  }

  /* ======================================================================
     it has to be worth doing
     ====================================================================== */

  t.section('every paragon out-damages a 5-2-0 of its base tower')
  const promotedSims = {}
  for (const def of defs) {
    const key = def.towerKey
    const plain = measure(key, false)
    const fused = measure(key, true)
    promotedSims[key] = fused

    t.gte(plain.dmg, 0, `${key}: a 5-2-0 measured (${plain.dmg} damage over 12s)`)
    t.gt(fused.degree, 0, `${key}: the paragon promoted at degree ${fused.degree}`)
    t.gt(fused.dmg, plain.dmg,
      `${key}: the paragon out-damages a 5-2-0 (${plain.dmg} -> ${fused.dmg})`)
    t.gt(fused.dmg, 0, `${key}: and it does real damage, not zero`)
  }

  t.section('nothing emits an undeclared projectile kind in play')
  for (const def of defs) {
    const key = def.towerKey
    const run = promotedSims[key]
    if (!run || !run.tower) { t.fail(`${key}: no measured run to inspect`); continue }

    // Fire the ability too — an ability that emits an undeclared kind renders as
    // nothing and would never be caught by the attack path alone.
    run.tower.abilityCd = 0
    OP.Towers.activate(run.s, run.tower)
    OP.Sim.run(run.s, 30)

    const seen = Object.keys(run.s.kindsSeen)
    t.gt(seen.length, 0, `${key}: emitted ${seen.length} projectile kinds`)
    const undeclared = seen.filter(k => !OP.PROJ_KINDS[k])
    t.eq(undeclared.length, 0, undeclared.length
      ? `${key}: undeclared kinds would render as nothing: ${undeclared.join(', ')}`
      : `${key}: all ${seen.length} emitted kinds are declared`)
  }

  t.section('every paragon ability activates and goes on cooldown')
  for (const def of defs) {
    const key = def.towerKey
    const p = promoteBoard(key, 8, 5)
    if (!t.ok(p.ok, `${key}: promoted for the ability check`)) continue
    for (let i = 0; i < 14; i++) OP.Balloons.spawn(p.s, { tier: 'ceramic', path: 0, t: 200 + i * 22 })
    OP.Sim.run(p.s, 30)

    const cashBefore = p.s.cash
    const before = {
      damage: p.s.stats.damageDealt, blasts: p.s.blastEvents.length,
      shots: p.s.stats.shotsFired, layers: p.s.stats.layersPopped
    }
    p.tower.abilityCd = 0
    const act = OP.Towers.activate(p.s, p.tower)
    t.ok(act.ok, `${key}: the ability activates` + (act.ok ? '' : ` — ${act.reason}`))
    t.gt(p.tower.abilityCd, 0, `${key}: and goes on cooldown`)
    t.notOk(OP.Towers.activate(p.s, p.tower).ok, `${key}: and cannot be spammed`)

    const did = p.s.stats.damageDealt > before.damage ||
      p.s.blastEvents.length > before.blasts ||
      p.s.stats.shotsFired > before.shots ||
      p.s.stats.layersPopped > before.layers ||
      p.s.cash > cashBefore
    t.ok(did, `${key}: activating it visibly did something`)
  }

  /* ======================================================================
     the type chart still exists
     ====================================================================== */

  t.section('VOID is used sparingly, not handed to everything')
  const voidCount = defs.filter(def => {
    const p = promoteBoard(def.towerKey, 4, 5)
    return p.ok && p.tower.s.dmgType === OP.DMG.VOID
  }).length
  t.gt(voidCount, 0, 'at least one paragon ignores every immunity, which is what VOID is for')
  t.lt(voidCount, defs.length,
    `only ${voidCount} of ${defs.length} deal VOID — a roster where everything ignores everything makes the type chart pointless`)

  t.section('OMEN resists instant-kill even from a paragon')
  // The engine honours `abilityImmune` unless a hit sets `ignoreAbilityImmunity`.
  // Nothing in the roster is allowed to set it — matched as a property assignment
  // so the header comment explaining the rule does not trip its own check.
  t.notOk(/ignoreAbilityImmunity\s*:/.test(SRC),
    'no paragon reaches past abilityImmune — the flag exists so one button cannot delete the last blimp')
  for (const def of defs) {
    const key = def.towerKey
    const p = promoteBoard(key, 8, 5)
    if (!t.ok(p.ok, `${key}: promoted for the OMEN check`)) continue

    // Worst case: the strongest version of this paragon.
    p.tower.paragonDegree = P.MAX_DEGREE
    OP.Towers.restat(p.s, p.tower)

    const omen = OP.Balloons.spawn(p.s, { tier: 'omen', path: 0, t: 300 })
    if (!t.ok(omen, `${key}: an OMEN spawned`)) continue
    // Into the grid without stepping the sim, so the paragon's own attack cannot
    // contaminate the measurement.
    OP.Grid.rebuild(p.s.grid, p.s.balloons)

    const res = OP.Damage.hit(p.s, omen, {
      damage: 1e9, dmgType: OP.DMG.VOID, sourceId: p.tower.id,
      instaKill: true, ignoreImmunity: true
    })
    t.notOk(res.destroyed, `${key}: an instant-kill from this paragon does not destroy an OMEN`)
    t.ok(omen.alive, `${key}: the OMEN is still on the track`)
    t.eq(res.layersPopped, 0, `${key}: and not a single layer came off`)

    const hpBefore = omen.hp
    p.tower.abilityCd = 0
    OP.Towers.activate(p.s, p.tower)
    t.ok(omen.alive, `${key}: one press of its ability does not take an OMEN off the board`)
    t.lte(omen.hp, hpBefore, `${key}: (it may still hurt it — ${hpBefore - omen.hp} of ${hpBefore} hull)`)
  }

  /* ======================================================================
     serialisation
     ====================================================================== */

  t.section('a promoted board survives a save round-trip')
  for (const def of defs) {
    const key = def.towerKey
    const p = promoteBoard(key, 8, 5)
    if (!t.ok(p.ok, `${key}: promoted for the save check`)) continue
    for (let i = 0; i < 200; i++) {
      if (i % 10 === 0) OP.Balloons.spawn(p.s, { tier: 'ceramic', path: 0, t: 0 })
      OP.Sim.step(p.s)
    }

    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(p.s)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
    const bp = back.towerById.get(p.tower.id)
    if (!t.ok(bp, `${key}: the paragon comes back`)) continue
    t.eq(bp.paragonDegree, p.degree, `${key}: with its degree intact (${p.degree})`)
    t.eq(bp.tiers.join('-'), p.tower.tiers.join('-'), `${key}: and its upgrade state`)
    t.eq(fingerprint(bp.s), fingerprint(p.tower.s), `${key}: stats recompute to the same values`)
    t.eq(OP.Towers.displayName(bp), def.name, `${key}: still named "${def.name}"`)

    t.eq(back.balloons.filter(b => b.alive).length, p.s.balloons.filter(b => b.alive).length,
      `${key}: the same balloons came back`)
    t.eq(back.projectiles.filter(pr => pr.alive).length, p.s.projectiles.filter(pr => pr.alive).length,
      `${key}: and the same shots in flight`)

    // One shared tick before the checksum, deliberately. `Balloons.deserialize`
    // does not restore `speedMul`: it is recomputed from the effect list, because
    // an incrementally-maintained slow drifts as effects expire (js/core/effects.js).
    // Effects tick before movement (ARCHITECTURE.md §7), so a reload is correct from
    // its first tick — but a checksum taken between load and that tick sees the
    // placeholder 1.0 on every slowed balloon. A control paragon slows the entire
    // screen, so this is the difference between asserting the round-trip and
    // asserting the order in which two fields happen to be rebuilt.
    OP.Sim.step(p.s)
    OP.Sim.step(back)
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(p.s), `${key}: and the whole sim checksum matches`)
  }

  t.section('a promoted board keeps simulating identically after a reload')
  // One board with all six on it: a divergence caused by any of them shows up.
  const lockA = sim({ lives: 1e7 })
  const placedAll = []
  defs.forEach(function (def, i) {
    const tw = OP.Towers.place(lockA, def.towerKey, 120 + i * 165, 660, { free: true })
    if (!tw) return
    for (let k = 0; k < def.minTier; k++) OP.Upgrades.buy(lockA, tw, 0)
    if (P.promote(lockA, tw).ok) placedAll.push(tw)
  })
  t.eq(placedAll.length, defs.length, `all ${defs.length} paragons stand on one board`)

  for (let i = 0; i < 180; i++) {
    if (i % 10 === 0) OP.Balloons.spawn(lockA, { tier: 'ceramic', path: 0, t: 0 })
    OP.Sim.step(lockA)
  }
  const midSnap = JSON.parse(JSON.stringify(OP.Sim.serialize(lockA)))
  const resumed = OP.Sim.deserialize(midSnap, { key: 'test', paths: [arena(OP)] })
  t.eq(OP.Sim.checksum(resumed), OP.Sim.checksum(lockA), 'the reload starts from an identical state')

  let diverged = -1
  for (let i = 180; i < 500; i++) {
    if (i % 10 === 0) {
      OP.Balloons.spawn(lockA, { tier: 'ceramic', path: 0, t: 0 })
      OP.Balloons.spawn(resumed, { tier: 'ceramic', path: 0, t: 0 })
    }
    OP.Sim.step(lockA)
    OP.Sim.step(resumed)
    if (OP.Sim.checksum(lockA) !== OP.Sim.checksum(resumed)) { diverged = i; break }
  }
  t.eq(diverged, -1, diverged < 0
    ? '320 further ticks in lockstep with six paragons on the board'
    : `diverged at tick ${diverged}`)
  t.gt(lockA.stats.popped, 0, 'and the paragons were actually working')

  /* ======================================================================
     drawing them changes nothing
     ====================================================================== */

  t.section('drawing a promoted board never mutates the simulation')
  t.ok(OP.Render && typeof OP.Render.frame === 'function', 'the renderer is loaded')
  if (OP.Render && typeof OP.Render.frame === 'function') {
    const view = (function () {
      const v = OP.Camera.create()
      OP.Camera.resize(v, env.ctx.document.createElement('canvas'), 1280, 720, 1)
      return v
    })()
    const recorder = function () {
      const calls = []
      const noop = name => function () { calls.push(name) }
      return {
        calls: calls,
        save: noop('save'), restore: noop('restore'),
        setTransform: noop('setTransform'), translate: noop('translate'),
        rotate: noop('rotate'), scale: noop('scale'),
        clearRect: noop('clearRect'), fillRect: noop('fillRect'), strokeRect: noop('strokeRect'),
        beginPath: noop('beginPath'), closePath: noop('closePath'),
        moveTo: noop('moveTo'), lineTo: noop('lineTo'), arc: noop('arc'),
        ellipse: noop('ellipse'), rect: noop('rect'), roundRect: noop('roundRect'),
        quadraticCurveTo: noop('quadraticCurveTo'), bezierCurveTo: noop('bezierCurveTo'),
        fill: noop('fill'), stroke: noop('stroke'), clip: noop('clip'),
        drawImage: noop('drawImage'), fillText: noop('fillText'), strokeText: noop('strokeText'),
        setLineDash: noop('setLineDash'), getLineDash: () => [],
        measureText: () => ({ width: 10 }),
        createLinearGradient: () => ({ addColorStop () {} }),
        createRadialGradient: () => ({ addColorStop () {} }),
        getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
      }
    }

    function sixParagons (seed) {
      const s = sim({ seed: seed, lives: 1e7 })
      defs.forEach(function (def, i) {
        const tw = OP.Towers.place(s, def.towerKey, 120 + i * 165, 660, { free: true })
        if (!tw) return
        for (let k = 0; k < def.minTier; k++) OP.Upgrades.buy(s, tw, 0)
        P.promote(s, tw)
      })
      return s
    }

    const drawn = sixParagons('draw')
    const quiet = sixParagons('draw')
    let frames = 0
    for (let i = 0; i < 150; i++) {
      if (i % 9 === 0) {
        OP.Balloons.spawn(drawn, { tier: 'ceramic', path: 0, t: 0 })
        OP.Balloons.spawn(quiet, { tier: 'ceramic', path: 0, t: 0 })
      }
      OP.Sim.step(drawn)
      OP.Sim.step(quiet)
      const ctx = recorder()
      OP.Render.frame(drawn, ctx, view, {})       // only one of the two is drawn
      if (ctx.calls.length > 0) frames++
    }
    t.eq(frames, 150, 'all 150 frames painted something')
    t.eq(OP.Sim.checksum(drawn), OP.Sim.checksum(quiet),
      'drawing 150 frames of a six-paragon board leaves the simulation bit-identical')
    t.gt(drawn.stats.popped, 0, 'and the board was busy while it was being drawn')
  }
}

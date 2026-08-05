// Self-test for the shared family floor.
//
// Proves `assertFamily` actually works — and, more importantly, that it FAILS on
// the things it claims to catch — before any content phase depends on it. A floor
// that passes everything is worse than no floor, because it launders bad content
// as verified.

export const name = 'towerfloor'
export const needs = ['js/core/towers.js', 'js/towers/_TEMPLATE.js']

import { assertFamily, arena } from './_towerfamily.mjs'

export function run (t, OP, env) {
  const D = OP.DMG

  // The template is a valid, ladder-conformant tower, so the floor must pass it.
  env.evalFile('js/towers/_TEMPLATE.js')

  t.section('the floor passes a conformant tower')
  const inner = recorder()
  assertFamily(inner, OP, 'primary', { keys: ['template-critter'], expect: 1 })
  t.eq(inner.fails.length, 0, inner.fails.length
    ? 'the template should pass its own floor, but: ' + inner.fails.slice(0, 4).join(' / ')
    : `the template cleared all ${inner.pass} floor assertions`)
  t.gt(inner.pass, 25, 'and the floor is actually checking a lot: ' + inner.pass + ' assertions')

  /* ---------- now prove it catches things ---------- */

  const ladder = OP.Upgrades.COST_LADDER
  const okPath = (n, base) => ({
    name: n,
    tiers: ladder.map((band, i) => ({
      name: n + ' ' + (i + 1),
      cost: Math.round(base * (band.min + band.max) / 2),
      desc: 'adds a small amount of something',
      apply: function (s) { s.damage += 1 }
    }))
  })
  let seq = 0
  function define (extra) {
    const key = 'floor-probe-' + (seq++)
    const base = extra.cost || 200
    return OP.Towers.define(Object.assign({
      key: key,
      name: 'Floor Probe ' + seq,
      family: 'primary',
      blurb: 'A synthetic tower used to prove the family floor rejects bad content.',
      cost: base,
      footprint: 12,
      base: {
        range: 160, cooldown: 0.8, damage: 2, pierce: 2,
        dmgType: D.SHARP, projSpeed: 500, projLife: 1.5, projRadius: 4
      },
      paths: [okPath('Alpha', base), okPath('Beta', base), okPath('Gamma', base)],
      fire: function (sim, tower, target) {
        const s = tower.s
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: extra._kind || 'floor-dart',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, ownerId: tower.id, camoDetect: s.camoDetect
        }, OP.M.angleTo(tower.x, tower.y, target.x, target.y), s.projSpeed)
      }
    }, extra))
  }
  if (!OP.PROJ_KINDS['floor-dart']) OP.declareProjKind('floor-dart', { shape: 'dart', tint: '#cccccc' })

  function floorFails (def) {
    const rec = recorder()
    assertFamily(rec, OP, 'primary', { keys: [def.key] })
    return rec.fails
  }

  t.section('a conformant synthetic tower also passes')
  const good = define({})
  const goodFails = floorFails(good)
  t.eq(goodFails.length, 0, goodFails.length
    ? 'the baseline synthetic tower should be clean, but: ' + goodFails.join(' /// ')
    : 'the baseline synthetic tower is clean')

  t.section('the floor catches an out-of-band upgrade cost')
  const pricey = define({})
  pricey.paths[0].tiers[0].cost = pricey.cost * 40      // tier 1 at 40x base
  let fails = floorFails(pricey)
  t.gt(fails.length, 0, 'a tier-1 upgrade priced like a tier-5 is rejected')
  t.ok(fails.some(f => /cost ladder/i.test(f)), 'and the failure names the cost ladder')

  t.section('the floor catches an undeclared projectile kind')
  const ghost = define({ _kind: 'floor-undeclared-kind' })
  fails = floorFails(ghost)
  t.gt(fails.length, 0, 'a tower emitting an undeclared kind is rejected')
  t.ok(fails.some(f => /undeclared kinds/i.test(f)), 'and the failure says which')

  t.section('the floor catches a borrowed proper noun')
  const borrowed = define({})
  borrowed.paths[0].tiers[2].desc = 'Pops even a MOAB with ease.'
  fails = floorFails(borrowed)
  t.gt(fails.length, 0, 'a borrowed proper noun in upgrade text is rejected')
  t.ok(fails.some(f => /borrowed proper nouns/i.test(f)), 'and the failure says so')

  t.section('the floor catches a non-idempotent apply()')
  const leaky = define({})
  let hidden = 0
  leaky.paths[0].tiers[0].apply = function (s) { hidden += 1; s.damage += hidden }
  fails = floorFails(leaky)
  t.gt(fails.length, 0, 'an apply() with a hidden accumulator is rejected')
  t.ok(fails.some(f => /restat/i.test(f)), 'and the failure points at restat idempotence')

  t.section('the floor catches a tower that never fires')
  const dud = define({})
  dud.fire = function () { /* silently does nothing */ }
  fails = floorFails(dud)
  t.gt(fails.length, 0, 'a tower whose fire() emits nothing is rejected')
  t.ok(fails.some(f => /pops at least one/i.test(f)), 'and the failure says it popped nothing')

  t.section('the floor catches an upgrade that breaks a stat')
  const broken = define({})
  broken.paths[1].tiers[3].apply = function (s) { s.cooldown = 0 / 0 }   // NaN
  fails = floorFails(broken)
  t.gt(fails.length, 0, 'an upgrade producing NaN is rejected')
  t.ok(fails.some(f => /walks every legal state/i.test(f)), 'and the failure names the state walk')

  t.section('the floor catches an unregistered ability key')
  const phantom = define({})
  phantom.paths[2].tiers[4].apply = function (s) {
    s.ability = { name: 'Nope', cooldown: 30, duration: 0, key: 'floor-never-registered' }
  }
  fails = floorFails(phantom)
  t.gt(fails.length, 0, 'a tier-5 ability pointing at nothing is rejected')

  t.section('the floor catches a missing declared roster')
  const rec = recorder()
  assertFamily(rec, OP, 'nonexistent-family')
  t.gt(rec.fails.length, 0, 'a family that never declared OP.FAMILY_ROSTERS is rejected')

  t.section('the floor catches a declared key that was never registered')
  const rec2 = recorder()
  assertFamily(rec2, OP, 'primary', { keys: ['never-defined-tower'] })
  t.gt(rec2.fails.length, 0, 'a roster naming a tower that does not exist is rejected')

  t.section('the arena helper builds a usable board')
  const track = arena(OP)
  t.gt(track.length, 2000, 'the arena track is long enough to matter')
  const b = track.bounds()
  t.gte(b.x0, 0, 'and stays inside the field horizontally')
  t.lte(b.x1, OP.FIELD_W, 'on both sides')
  t.lte(b.y1, OP.FIELD_H, 'and vertically')
}

/** A minimal stand-in for the harness recorder, so the floor can be run against
    itself and its failures inspected instead of aborting this suite. */
function recorder () {
  const rec = {
    pass: 0,
    fails: [],
    section: function () {},
    _rec: function (ok, msg) { if (ok) rec.pass++; else rec.fails.push(msg); return ok },
    ok: function (c, m) { return rec._rec(!!c, m) },
    notOk: function (c, m) { return rec._rec(!c, m) },
    eq: function (a, b, m) { return rec._rec(a === b, m) },
    neq: function (a, b, m) { return rec._rec(a !== b, m) },
    close: function (a, b, e, m) { return rec._rec(Math.abs(a - b) <= e, m) },
    gt: function (a, b, m) { return rec._rec(a > b, m) },
    gte: function (a, b, m) { return rec._rec(a >= b, m) },
    lt: function (a, b, m) { return rec._rec(a < b, m) },
    lte: function (a, b, m) { return rec._rec(a <= b, m) },
    between: function (a, lo, hi, m) { return rec._rec(a >= lo && a <= hi, m) },
    deep: function (a, b, m) { return rec._rec(JSON.stringify(a) === JSON.stringify(b), m) },
    throws: function (fn, m) { try { fn(); return rec._rec(false, m) } catch (e) { return rec._rec(true, m) } },
    noThrow: function (fn, m) { try { fn(); return rec._rec(true, m) } catch (e) { return rec._rec(false, m) } },
    fail: function (m) { return rec._rec(false, m) }
  }
  return rec
}

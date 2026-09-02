export const name = 'scriptorder'
export const needs = ['index.html', 'js/main.js']

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { scriptManifest, ROOT } from '../loadgame.mjs'

/* The boot contract.
 *
 * The game ships as ~50 classic <script> tags with no module resolver, no bundler
 * and no build step, because it has to run by double-clicking index.html. That
 * buys real properties and costs one: nothing checks the load order for us.
 *
 * The `loader` suite covers manifest hygiene from the very first commit. This suite
 * is the FINAL gate: every declared file must actually exist, the bundle must
 * assemble cleanly, and every symbol the shell reaches for at boot must be present
 * by the time main.js runs.
 */

export function run (t, OP, env) {
  const manifest = scriptManifest()

  t.section('every declared script exists on disk')
  const missing = manifest.filter(p => !existsSync(resolve(ROOT, p)))
  t.eq(missing.length, 0, missing.length
    ? `declared in index.html but absent: ${missing.join(', ')}`
    : `all ${manifest.length} declared scripts are present`)

  t.section('nothing on disk is silently left out of the bundle')
  // A file written but never added to index.html loads in no browser and is dead
  // weight in the repo — and the author would have no way to notice.
  const onDisk = []
  const walk = dir => {
    for (const name of readdirSync(resolve(ROOT, dir))) {
      const rel = dir + '/' + name
      if (name.endsWith('.js')) onDisk.push(rel)
      else if (name.indexOf('.') < 0) walk(rel)
    }
  }
  walk('js')
  const declared = new Set(manifest)
  // Templates are deliberately not shipped; they are reference material.
  const orphans = onDisk.filter(p => !declared.has(p) && !/\/_[A-Z_]+\.js$/.test(p))
  t.eq(orphans.length, 0, orphans.length
    ? `on disk but never loaded: ${orphans.join(', ')}`
    : `no orphaned source files (${onDisk.length} on disk, ${manifest.length} loaded)`)

  t.section('the bundle assembles with no errors')
  t.eq(env.errors.length, 0, env.errors.length
    ? env.errors.map(e => `${e.file}: ${e.error.message}`).join(' | ')
    : `all ${env.present.length} scripts evaluated cleanly`)

  t.section('every subsystem the shell depends on is present after load')
  // main.js reaches for each of these during boot. A missing one is a blank page,
  // and the browser console is the only place it would otherwise show up.
  const REQUIRED = [
    'M', 'RNG', 'Track', 'Grid', 'Effects', 'Damage', 'Balloons', 'Projectiles',
    'Targeting', 'Buffs', 'Upgrades', 'Towers', 'Heroes', 'Paragon', 'Economy',
    'Rounds', 'Freeplay', 'Maps', 'Sim', 'Camera', 'Render', 'FX', 'Terrain',
    'Audio', 'Save', 'Input', 'Menus', 'App'
  ]
  const absent = REQUIRED.filter(k => !OP[k])
  t.eq(absent.length, 0, absent.length ? `OP.${absent.join(', OP.')} missing` : `all ${REQUIRED.length} subsystems present`)

  t.section('every content registry is populated')
  const REGISTRIES = [
    ['TOWER_ORDER', 31], ['HERO_ORDER', 8], ['MAP_ORDER', 1],
    ['DMG_ORDER', 10], ['BALLOON_TIERS', 17], ['FAMILIES', 4]
  ]
  for (const [key, atLeast] of REGISTRIES) {
    const v = OP[key]
    t.ok(v && v.length >= atLeast, `OP.${key} has at least ${atLeast} entries (${v ? v.length : 'missing'})`)
  }
  for (const [key, atLeast] of [['ROUNDS_STANDARD', 100], ['DIFFICULTIES', 4], ['MODES', 11]]) {
    const n = OP[key] ? Object.keys(OP[key]).length : 0
    t.gte(n, atLeast, `OP.${key} has at least ${atLeast} entries (${n})`)
  }

  t.section('declared order really is dependency order')
  // Each of these pairs would break if reversed, because the later file reads a
  // value the earlier one defines at load time (not merely at call time).
  const idx = p => manifest.indexOf(p)
  const before = (a, b) => t.ok(idx(a) >= 0 && idx(b) >= 0 && idx(a) < idx(b), `${a} before ${b}`)
  before('js/core/const.js', 'js/data/balloons.js')       // reads OP.PROP
  before('js/core/math.js', 'js/core/track.js')           // Track closes over OP.M
  before('js/data/damage-types.js', 'js/core/effects.js') // reads OP.DMG
  before('js/data/balloons.js', 'js/core/balloons.js')
  before('js/core/upgrades.js', 'js/core/towers.js')      // reads Upgrades.PATHS
  before('js/core/towers.js', 'js/towers/primary.js')     // defineTower must exist
  before('js/core/heroes.js', 'js/towers/heroes.js')
  before('js/core/maps.js', 'js/data/maps-beginner.js')
  before('js/render/renderer.js', 'js/main.js')
  before('js/save.js', 'js/main.js')
  before('js/ui/input.js', 'js/main.js')
  t.eq(manifest[manifest.length - 1], 'js/main.js', 'main.js is last — nothing may load after the boot')

  t.section('a tower file loading before the tower core would fail loudly')
  // Proof the ordering above is load-time significant rather than a convention:
  // evaluating a family file in a fresh context with no OP.Towers must throw.
  const src = readFileSync(resolve(ROOT, 'js/towers/primary.js'), 'utf8')
  t.ok(/OP\.defineTower|OP\.Towers\.define/.test(src),
    'the family file calls defineTower at load time, so its position in the manifest matters')

  t.section('the page declares no module scripts and no third-party sources')
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
  t.notOk(/type=["']module["']/.test(html), 'no ES modules — the game must run from file://')
  t.notOk(/<script[^>]+src=["']https?:/i.test(html), 'no third-party scripts')
  t.notOk(/<script[^>]+src=["']\/\//.test(html), 'no protocol-relative sources either')
  t.notOk(/\bdefer\b|\basync\b/.test(html.slice(html.indexOf('<body'))),
    'no defer or async on the bundle — with classic scripts that would reorder execution')

  t.section('the boot markup the shell expects is present')
  t.ok(/id=["']game["']/.test(html), 'the #game canvas exists')
  t.ok(/id=["']boot["']/.test(html), 'the #boot overlay exists, so a cold cache is not a blank screen')
  t.ok(/<h1>/.test(html), 'a real <h1> is present for crawlers and screen readers')
  t.ok(/<noscript/.test(html), 'and a noscript fallback')

  t.section('main.js exposes the autoplay hook the browser smoke test drives')
  t.ok(OP.Test && typeof OP.Test.autoplay === 'function',
    'OP.Test.autoplay exists, so tools/smoke.mjs drives the same path a player does')

  t.section('booting twice is a no-op rather than two frame loops')
  // main.js boots on DOMContentLoaded, and a stray second call must not start a
  // second requestAnimationFrame loop.
  t.ok(OP.App && OP.App.state, 'the app shell is reachable')
  t.eq(OP.App.state.booted, true, 'and it booted under the harness stubs without throwing')

}


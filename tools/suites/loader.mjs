// Verifies the harness can load the real bundle, and that the script manifest in
// index.html is internally sound. Runs from P1.10 onward — it deliberately does
// NOT require every declared file to exist yet (that's the `scriptorder` suite,
// gated on P8.5), so it stays useful throughout the build.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scriptManifest, ROOT } from '../loadgame.mjs'

export const name = 'loader'
export const needs = ['index.html', 'sw.js']

export function run (t, OP, env) {
  const manifest = scriptManifest()

  t.section('script manifest')
  t.gt(manifest.length, 0, 'index.html declares at least one script')
  t.eq(new Set(manifest).size, manifest.length, 'no duplicate script entries')
  t.ok(manifest.every(p => p.startsWith('js/')), 'every script lives under js/')
  t.ok(manifest.every(p => p.endsWith('.js')), 'every script is a .js file')

  t.section('declared order is the dependency order')
  // const.js must come first: everything reads OP.DT / OP.PROP from it.
  t.eq(manifest[0], 'js/core/const.js', 'js/core/const.js loads first')
  t.eq(manifest[manifest.length - 1], 'js/main.js', 'js/main.js loads last')
  const idx = p => manifest.indexOf(p)
  const before = (a, b) => t.ok(idx(a) >= 0 && idx(b) >= 0 && idx(a) < idx(b), `${a} loads before ${b}`)
  before('js/core/rng.js', 'js/core/sim.js')
  before('js/data/balloons.js', 'js/core/balloons.js')
  before('js/data/damage-types.js', 'js/core/damage.js')
  before('js/core/track.js', 'js/core/maps.js')
  before('js/core/towers.js', 'js/towers/primary.js')
  before('js/core/sim.js', 'js/render/renderer.js')
  before('js/core/heroes.js', 'js/towers/heroes.js')
  before('js/save.js', 'js/main.js')

  t.section('bundle evaluation')
  t.eq(env.errors.length, 0, 'no script threw while loading',
    env.errors.map(e => `${e.file}: ${e.error.message}`).join(' | '))
  t.ok(typeof OP === 'object' && OP !== null, 'the OP global exists after load')

  t.section('no leaked globals')
  // Every file must wrap itself in an IIFE. A bare top-level `const foo` in a
  // classic script becomes a global and will collide across 50 files.
  const allowed = new Set(['OP', 'window', 'self', 'globalThis', 'top', 'parent', 'document',
    'console', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'localStorage',
    'sessionStorage', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'location', 'navigator',
    'matchMedia', 'addEventListener', 'removeEventListener', 'Image', 'Path2D', 'OffscreenCanvas',
    'ImageData', 'DOMMatrix', 'fetch', 'AudioContext', 'webkitAudioContext', 'URL',
    'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'isSecureContext', 'crypto'])
  const leaked = Object.keys(env.ctx).filter(k => !allowed.has(k))
  t.eq(leaked.length, 0, 'no file leaked a top-level binding into the global scope',
    leaked.length ? `leaked: ${leaked.join(', ')}` : '')

  t.section('service worker derives its own precache list')
  const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8')
  t.ok(/<script\[\^>\]\+src=|script\[\^>\]/.test(sw) || sw.includes('buildPrecacheList'),
    'sw.js builds its precache list from index.html rather than hardcoding it')
  t.ok(sw.includes("'./index.html'"), 'sw.js precaches the shell explicitly')
  t.ok(/CACHE_NAME\s*=\s*'overpop-/.test(sw), 'sw.js uses a namespaced cache key')

  t.section('harness stubs')
  t.ok(env.canvas && typeof env.canvas.getContext === 'function', 'a stub canvas is available')
  t.ok(env.ctx.document.getElementById('game') === env.canvas, "document.getElementById('game') resolves to it")
  t.ok(typeof env.ctx.document.createElement('canvas').getContext('2d').fillRect === 'function',
    'offscreen canvases return a usable 2d context stub')
  t.eq(env.ctx.localStorage.getItem('nope'), null, 'localStorage stub returns null for absent keys')

  t.section('build hygiene')
  t.ok(!existsSync(resolve(ROOT, 'package.json')), 'no package.json — the game has no dependencies')
  t.ok(!existsSync(resolve(ROOT, 'node_modules')), 'no node_modules')
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
  t.notOk(/type=["']module["']/.test(html), 'no ES modules in index.html (must run from file://)')
  t.notOk(/<script[^>]+src=["']https?:/i.test(html), 'no third-party scripts')
}

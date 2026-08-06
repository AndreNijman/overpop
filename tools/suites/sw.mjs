/* The service worker, and the one property that actually matters about it.

   A cached offline copy is only half a feature; the other half is noticing the
   copy is stale. This file exists because that half was missing: sw.js carried a
   hardcoded `overpop-v1`, so shipping new game code left the worker byte-identical,
   the browser never re-installed it, and returning players kept the old build until
   they hard-refreshed or cleared site data. Every suite was green throughout.

   So the assertions here are about the DEPLOY, not about JavaScript:
     - the version is a hash of the files that get precached
     - it is current on disk right now
     - the worker takes over instead of waiting for every tab to close
     - navigations are network-first, so a new build can be discovered
     - sw.js itself is never served from the cache
*/

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, scriptManifest } from '../loadgame.mjs'
import { computeStamp, readStamp, precachedFiles } from '../stamp.mjs'

export const name = 'sw'
export const needs = ['sw.js', 'index.html']

export function run (t) {
  const src = readFileSync(resolve(ROOT, 'sw.js'), 'utf8')

  t.section('the cache name is derived from a content stamp, not hardcoded')
  const stamp = readStamp()
  t.ok(stamp, `sw.js declares a VERSION (${stamp})`)
  t.neq(stamp, 'v1', 'and it is not the old hardcoded name')
  t.neq(stamp, 'dev', 'and not the unstamped placeholder')
  t.ok(/const CACHE_NAME = 'overpop-' \+ VERSION/.test(src),
    'the cache name is built from it, so a new version cannot reuse an old cache')

  t.section('THE STAMP IS CURRENT — a stale one silently hides the whole deploy')
  const { stamp: want, missing } = computeStamp()
  t.eq(missing.length, 0,
    missing.length ? `precached files missing from disk: ${missing.slice(0, 5).join(', ')}` : 'every precached file exists')
  t.eq(stamp, want,
    stamp === want
      ? `sw.js matches the ${precachedFiles().length} files it precaches`
      : `sw.js says '${stamp}' but the shipped files hash to '${want}' — run node tools/stamp.mjs`)

  t.section('the stamp actually covers the shipped bundle')
  const files = precachedFiles()
  const scripts = scriptManifest()
  t.gt(scripts.length, 40, `index.html declares ${scripts.length} scripts`)
  for (const rel of scripts) {
    if (files.indexOf(rel) < 0) { t.fail(`script not covered by the stamp: ${rel}`); break }
  }
  t.ok(scripts.every(rel => files.indexOf(rel) >= 0),
    'every script in the bundle is part of the hash, so changing any one of them re-stamps')
  t.ok(files.indexOf('index.html') >= 0, 'and so is index.html')
  t.ok(files.indexOf('style.css') >= 0, 'and the stylesheet')

  t.section('changing a shipped file changes the stamp')
  // Not a hypothetical: this is the property the whole design rests on.
  const first = computeStamp().stamp
  const idx = resolve(ROOT, 'index.html')
  const original = readFileSync(idx)
  try {
    writeFileSync(idx, original.toString() + '\n<!-- stamp probe -->\n')
    const second = computeStamp().stamp
    t.neq(second, first, 'editing index.html produces a different stamp')
  } finally {
    // Restored no matter what, so a failing assertion cannot leave the tree dirty.
    writeFileSync(idx, original)
  }
  t.eq(computeStamp().stamp, first, 'and restoring it restores the stamp, so the probe left nothing behind')

  t.section('the worker takes over rather than waiting for every tab to close')
  t.ok(/skipWaiting\(\)/.test(src), 'install calls skipWaiting')
  t.ok(/clients\.claim\(\)/.test(src), 'activate claims open clients')
  t.ok(/caches\.delete/.test(src), 'and old versions are deleted')
  t.ok(/n\.startsWith\('overpop-'\)/.test(src),
    'deleting only its own caches, by prefix, rather than everything on the origin')

  t.section('a new build can be discovered')
  t.ok(/req\.mode === 'navigate'/.test(src), 'navigations are handled specially')
  t.ok(/cache: 'no-store'/.test(src), 'and fetched fresh, so a changed document is seen')
  t.ok(/pathname\.endsWith\('\/sw\.js'\)/.test(src),
    'sw.js is excluded from the cache — a cached worker cannot notice it is stale')

  t.section("the precache is filled from the network, not the browser's HTTP cache")
  t.ok(/cache: 'reload'/.test(src),
    "precache requests use cache: 'reload', so a new version cannot be filled with old bytes")

  t.section('the page side asks for updates and applies them')
  const main = readFileSync(resolve(ROOT, 'js/main.js'), 'utf8')
  t.ok(/updateViaCache: 'none'/.test(main),
    "registration uses updateViaCache: 'none', so sw.js is revalidated over the network")
  t.ok(/controllerchange/.test(main), 'a new controller triggers the swap')
  t.ok(/\.update\(\)/.test(main) && /setInterval\(check/.test(main),
    'and updates are polled, for a page left open for hours')
  t.ok(/location\.reload\(\)/.test(main), 'applying an update reloads the page')

  t.section('but never mid-round')
  t.ok(/pendingReload/.test(main), 'an update that lands during a run is deferred')
  t.ok(/drainPendingReload/.test(main), 'and applied when the board goes idle')
  t.ok(/function boardBusy/.test(main), 'with an explicit test for whether play is in progress')
}

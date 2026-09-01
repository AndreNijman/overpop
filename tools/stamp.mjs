#!/usr/bin/env node
/* Stamp sw.js with a hash of everything it precaches.
   ==================================================================
   A service worker is only re-installed when the BYTES OF sw.js CHANGE. So a
   fixed cache name means new game code never reaches a returning player: the
   installed worker keeps serving its old cache and only a hard refresh or
   clearing site data helps. That was a real, reported bug.

   This makes the version a FUNCTION OF THE CONTENT. Change any shipped file and
   the stamp changes, so sw.js changes, so the browser installs it and the update
   lands on its own.

   Usage:
     node tools/stamp.mjs           # write the stamp
     node tools/stamp.mjs --check   # exit 1 if the stamp is stale (CI / verify)
     node tools/stamp.mjs --print   # print the computed stamp

   tools/suites/sw.mjs runs the same check, so a stale stamp fails the suite
   rather than silently shipping. */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { ROOT, scriptManifest } from './loadgame.mjs'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const PRINT = argv.includes('--print')

/** Every file the service worker will precache, in a stable order. */
export function precachedFiles () {
  const files = ['index.html', 'style.css', 'manifest.webmanifest']
  // The scripts come from index.html itself — the same list sw.js derives at
  // install time, so the stamp covers exactly what gets cached.
  for (const rel of scriptManifest()) files.push(rel)
  files.push('icons/icon-192.png', 'icons/icon-512.png')
  return files
}

export function computeStamp () {
  const h = createHash('sha256')
  const missing = []
  for (const rel of precachedFiles()) {
    let buf
    try { buf = readFileSync(resolve(ROOT, rel)) } catch (e) { missing.push(rel); continue }
    // Name as well as bytes: renaming a file must change the stamp even when its
    // contents are identical, because the URL the worker caches has changed.
    h.update(rel)
    h.update(buf)
  }
  return { stamp: h.digest('hex').slice(0, 12), missing: missing }
}

const SW = resolve(ROOT, 'sw.js')
const RE = /^const VERSION = '([^']*)'/m

export function readStamp () {
  const m = RE.exec(readFileSync(SW, 'utf8'))
  return m ? m[1] : null
}

export function writeStamp (stamp) {
  const src = readFileSync(SW, 'utf8')
  if (!RE.test(src)) throw new Error("sw.js has no `const VERSION = '...'` line to stamp")
  writeFileSync(SW, src.replace(RE, `const VERSION = '${stamp}'`))
}

const _main = fileURLToPath(import.meta.url)
if (_main && process.argv[1] && _main === resolve(process.argv[1])) {
  const { stamp, missing } = computeStamp()
  const current = readStamp()

  if (PRINT) { console.log(stamp); process.exit(0) }

  if (missing.length) {
    console.error(`stamp: ${missing.length} precached file(s) missing from disk:`)
    for (const m of missing.slice(0, 8)) console.error('  ' + m)
    process.exit(2)
  }

  if (CHECK) {
    if (current === stamp) {
      console.log(`sw.js stamp is current (${stamp})`)
      process.exit(0)
    }
    console.error(`sw.js stamp is STALE: file says '${current}', content hashes to '${stamp}'.`)
    console.error('Run `node tools/stamp.mjs` — without it, returning players keep the old build.')
    process.exit(1)
  }

  if (current === stamp) {
    console.log(`sw.js already stamped ${stamp} — nothing to do`)
  } else {
    writeStamp(stamp)
    console.log(`sw.js stamped ${current} -> ${stamp} (${precachedFiles().length} files)`)
  }
}

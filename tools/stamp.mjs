#!/usr/bin/env node
// Node 22+, zero dependencies.
// node tools/stamp.mjs           rewrite index.html so every local script and
//                                stylesheet URL carries ?v=<content hash>
// node tools/stamp.mjs --check   exit 1 if any tag is missing or stale
//
// Why: index.html is served no-store, but the scripts sit behind a CDN with
// max-age=300 and stale-while-revalidate=86400, so an unversioned
// <script src="js/ui/menus.js"> could keep running yesterday's code for a day
// after a deploy. A content hash in the URL makes every change a new URL.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = /(<script[^>]+src=|<link[^>]+rel=["']stylesheet["'][^>]+href=)(["'])([^"'?#]+)(\?v=[0-9a-f]*)?\2/gi

export function hashOf (path) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex').slice(0, 10)
}

/** Returns { html, stale: [paths whose tag is missing or out of date] }. */
export function stamp (html) {
  const stale = []
  const out = html.replace(TAG, (all, head, q, path, ver) => {
    if (/^(https?:)?\/\//i.test(path) || !existsSync(resolve(ROOT, path))) return all
    const want = '?v=' + hashOf(path)
    if (ver !== want) stale.push(path)
    return head + q + path + want + q
  })
  return { html: out, stale }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(ROOT, 'index.html')
  const { html, stale } = stamp(readFileSync(file, 'utf8'))
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error('stale: ' + stale.join(', ') + '\nrun: node tools/stamp.mjs'); process.exit(1) }
    console.log('index.html stamps are current')
  } else {
    if (stale.length) writeFileSync(file, html)
    console.log(stale.length ? `stamped ${stale.length} file(s)` : 'index.html stamps already current')
  }
}

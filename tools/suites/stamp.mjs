// Every local script and stylesheet in index.html carries ?v=<content hash>, and
// the hash is current. Without it a CDN with stale-while-revalidate can serve
// last deploy's scripts for a day, and a fix that is live is not what anyone sees.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stamp, ROOT } from '../stamp.mjs'
import { scriptManifest } from '../loadgame.mjs'

export const name = 'stamp'
export const needs = ['index.html']

export function run (t) {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
  const tags = html.match(/<script[^>]+src=["'][^"']+["']|<link[^>]+rel=["']stylesheet["'][^>]+href=["'][^"']+["']/gi) || []
  t.gt(tags.length, 50, `index.html declares ${tags.length} scripts and stylesheets`)
  const { stale } = stamp(html)
  t.eq(stale.length, 0, stale.length ? 'stale or missing: ' + stale.slice(0, 5).join(', ') + ' — run node tools/stamp.mjs' : 'every stamp matches its file')
  t.ok(scriptManifest().every(p => !p.includes('?')), 'the script manifest strips the version query')
}

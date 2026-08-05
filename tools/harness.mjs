#!/usr/bin/env node
// OVERPOP headless verification harness.
//
//   node tools/harness.mjs --list
//   node tools/harness.mjs --suite balloons
//   node tools/harness.mjs --suite balloons,damage --verbose
//   node tools/harness.mjs --all
//   node tools/harness.mjs --playthroughs
//
// Suites live in tools/suites/*.mjs and are auto-discovered, so a content phase
// can add coverage without touching this file — which is what keeps a fan-out
// from serialising on one shared test file.
//
// Each suite module exports:
//   name         string, matched by --suite
//   needs        string[] of repo-relative files that must exist
//   playthrough  optional bool, included by --playthroughs instead of --all
//   run(t, OP, env)
//
// A suite whose `needs` are missing FAILS. It does not skip — a vacuous pass is
// worse than a red build, because it lets a step be marked done on no evidence.

import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { game, ROOT } from './loadgame.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUITE_DIR = resolve(HERE, 'suites')

const tty = process.stdout.isTTY
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const dim = s => c(2, s), bold = s => c(1, s)
const green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s), cyan = s => c(36, s)

/* ---------- assertion recorder ---------- */

class T {
  constructor (suite, verbose) {
    this.suite = suite
    this.verbose = verbose
    this.pass = 0
    this.fails = []
    this.section_ = ''
  }
  section (s) { this.section_ = s; if (this.verbose) console.log(`  ${dim('· ' + s)}`) }
  _record (okFlag, msg, detail) {
    if (okFlag) {
      this.pass++
      if (this.verbose) console.log(`    ${green('ok')} ${msg}`)
    } else {
      this.fails.push({ section: this.section_, msg, detail })
      if (this.verbose) console.log(`    ${red('FAIL')} ${msg}${detail ? `\n         ${detail}` : ''}`)
    }
    return okFlag
  }
  ok (cond, msg) { return this._record(!!cond, msg, cond ? '' : `expected truthy, got ${fmt(cond)}`) }
  notOk (cond, msg) { return this._record(!cond, msg, `expected falsy, got ${fmt(cond)}`) }
  eq (a, b, msg) { return this._record(Object.is(a, b) || a === b, msg, `expected ${fmt(b)}, got ${fmt(a)}`) }
  neq (a, b, msg) { return this._record(a !== b, msg, `expected anything but ${fmt(b)}`) }
  close (a, b, eps, msg) { return this._record(Math.abs(a - b) <= eps, msg, `expected ${fmt(b)} ±${eps}, got ${fmt(a)}`) }
  gt (a, b, msg) { return this._record(a > b, msg, `expected > ${fmt(b)}, got ${fmt(a)}`) }
  gte (a, b, msg) { return this._record(a >= b, msg, `expected >= ${fmt(b)}, got ${fmt(a)}`) }
  lt (a, b, msg) { return this._record(a < b, msg, `expected < ${fmt(b)}, got ${fmt(a)}`) }
  lte (a, b, msg) { return this._record(a <= b, msg, `expected <= ${fmt(b)}, got ${fmt(a)}`) }
  between (a, lo, hi, msg) { return this._record(a >= lo && a <= hi, msg, `expected within [${lo}, ${hi}], got ${fmt(a)}`) }
  deep (a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b)
    return this._record(sa === sb, msg, `expected ${sb}, got ${sa}`)
  }
  throws (fn, msg) {
    try { fn(); return this._record(false, msg, 'expected a throw, none happened') }
    catch { return this._record(true, msg) }
  }
  noThrow (fn, msg) {
    try { fn(); return this._record(true, msg) }
    catch (e) { return this._record(false, msg, `threw ${e.message}`) }
  }
  fail (msg, detail) { return this._record(false, msg, detail) }
}

function fmt (v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6)
  if (typeof v === 'string') return JSON.stringify(v.length > 80 ? v.slice(0, 77) + '…' : v)
  if (v === null || v === undefined) return String(v)
  if (Array.isArray(v)) return `[${v.length} items]`
  if (typeof v === 'object') return `{${Object.keys(v).slice(0, 6).join(',')}${Object.keys(v).length > 6 ? ',…' : ''}}`
  return String(v)
}

/* ---------- discovery ---------- */

async function discover () {
  if (!existsSync(SUITE_DIR)) return []
  // `_`-prefixed files are shared fixtures, not suites.
  const files = readdirSync(SUITE_DIR).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).sort()
  const out = []
  for (const f of files) {
    const mod = await import(pathToFileURL(resolve(SUITE_DIR, f)).href)
    if (!mod.name || typeof mod.run !== 'function') {
      console.error(red(`suite ${f} is malformed — needs an exported name and run()`))
      process.exitCode = 1
      continue
    }
    out.push({ file: f, name: mod.name, needs: mod.needs || [], playthrough: !!mod.playthrough, run: mod.run })
  }
  return out
}

/* ---------- run ---------- */

async function main () {
  const argv = process.argv.slice(2)
  const has = f => argv.includes(f)
  const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const verbose = has('--verbose') || has('-v')

  const suites = await discover()

  if (has('--list') || argv.length === 0) {
    const g = game()
    console.log(`\n${bold('OVERPOP harness')} ${dim(`· ${suites.length} suites · bundle: ${g.present.length}/${g.order.length} files present`)}\n`)
    const w = Math.max(...suites.map(s => s.name.length), 4)
    for (const s of suites) {
      const missing = s.needs.filter(n => !existsSync(resolve(ROOT, n)))
      const state = missing.length ? red('blocked') : green('ready  ')
      console.log(`  ${state} ${s.name.padEnd(w)} ${dim(s.playthrough ? '[playthrough] ' : '')}${dim(missing.length ? `missing ${missing.join(', ')}` : s.needs.join(' '))}`)
    }
    if (g.missing.length) console.log(`\n${dim('not yet built:')} ${g.missing.length} script(s) declared in index.html`)
    if (g.errors.length) console.log(`\n${red('load errors:')} ${g.errors.map(e => `${e.file}: ${e.error.message}`).join('\n              ')}`)
    console.log()
    return
  }

  let picked
  if (has('--all')) picked = suites.filter(s => !s.playthrough)
  else if (has('--playthroughs')) picked = suites.filter(s => s.playthrough)
  else if (val('--suite')) {
    const want = val('--suite').split(',').map(s => s.trim())
    picked = want.map(w => suites.find(s => s.name === w) || { name: w, missingSuite: true, needs: [], run: null })
  } else {
    console.error(red('nothing selected. use --list, --all, --playthroughs, or --suite <name>'))
    process.exit(2)
  }

  const g = game()
  if (g.errors.length) {
    console.log(`\n${red('BUNDLE FAILED TO LOAD')}`)
    for (const e of g.errors) console.log(`  ${e.file}\n    ${e.error.stack?.split('\n').slice(0, 4).join('\n    ')}`)
    process.exit(1)
  }

  let totalPass = 0
  const failed = []

  for (const s of picked) {
    if (s.missingSuite) {
      console.log(`${red('FAIL')} ${s.name} ${dim('— no such suite')}`)
      failed.push({ name: s.name, fails: [{ msg: 'suite does not exist', detail: `add tools/suites/${s.name}.mjs` }] })
      continue
    }
    const missing = s.needs.filter(n => !existsSync(resolve(ROOT, n)))
    if (missing.length) {
      console.log(`${red('FAIL')} ${s.name} ${dim(`— not built yet: ${missing.join(', ')}`)}`)
      failed.push({ name: s.name, fails: [{ msg: 'required modules missing', detail: missing.join(', ') }] })
      continue
    }

    const t = new T(s.name, verbose)
    if (verbose) console.log(`\n${cyan(s.name)}`)
    const started = process.hrtime.bigint()
    try {
      await s.run(t, g.OP, g)
    } catch (e) {
      t.fail('suite threw', e.stack?.split('\n').slice(0, 4).join(' | '))
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    totalPass += t.pass

    if (t.fails.length) {
      failed.push({ name: s.name, fails: t.fails })
      console.log(`${red('FAIL')} ${s.name.padEnd(22)} ${dim(`${t.pass} passed, `)}${red(`${t.fails.length} failed`)} ${dim(`(${ms.toFixed(0)}ms)`)}`)
      if (!verbose) for (const f of t.fails.slice(0, 8)) console.log(`       ${red('×')} ${f.section ? dim(f.section + ' → ') : ''}${f.msg}${f.detail ? `\n         ${dim(f.detail)}` : ''}`)
      if (!verbose && t.fails.length > 8) console.log(`       ${dim(`… and ${t.fails.length - 8} more`)}`)
    } else {
      console.log(`${green('PASS')} ${s.name.padEnd(22)} ${dim(`${t.pass} assertions (${ms.toFixed(0)}ms)`)}`)
    }
  }

  const nf = failed.length
  console.log(nf
    ? `\n${red(`${nf} suite(s) failing`)} ${dim(`· ${totalPass} assertions passed`)}`
    : `\n${green(`all ${picked.length} suite(s) green`)} ${dim(`· ${totalPass} assertions`)}`)
  process.exit(nf ? 1 : 0)
}

main().catch(e => { console.error(red('harness crashed: ') + (e.stack || e.message)); process.exit(1) })

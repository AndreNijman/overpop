#!/usr/bin/env node
// OVERPOP build-state driver.
//
// Every development step is recorded in BUILD_STATE.json with a verify command,
// so the build can be paused anywhere and resumed cold — by a new session, or by
// hand — without relying on anything held in conversation context.
//
//   node tools/state.mjs brief          full resume briefing (start here)
//   node tools/state.mjs status         progress table
//   node tools/state.mjs next           the next actionable step(s)
//   node tools/state.mjs start <id>     mark in_progress
//   node tools/state.mjs done <id>      verify, then mark done + stamp commit
//   node tools/state.mjs verify <id>    run a step's verify commands
//   node tools/state.mjs verify all     run every verify for done/in_progress steps
//   node tools/state.mjs block <id> "reason"
//   node tools/state.mjs note <id> "text"
//   node tools/state.mjs selftest       validate the state file itself
//
// Verify helpers (used inside BUILD_STATE.json verify strings):
//   grep <file> <pattern>   exists <path...>   dns <host>   live <url>   hubcard

import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as dns } from 'node:dns'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE = resolve(ROOT, 'BUILD_STATE.json')
const LOG = resolve(ROOT, 'docs/BUILD_LOG.md')
const STATUSES = ['todo', 'in_progress', 'done', 'blocked']

const tty = process.stdout.isTTY
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const dim = s => c(2, s), bold = s => c(1, s)
const green = s => c(32, s), yellow = s => c(33, s), red = s => c(31, s), cyan = s => c(36, s)

const MARK = { done: green('✓'), in_progress: yellow('▸'), todo: dim('·'), blocked: red('✗') }

function load () {
  if (!existsSync(STATE)) die(`BUILD_STATE.json not found at ${STATE}`)
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch (e) { die(`BUILD_STATE.json is not valid JSON: ${e.message}`) }
}
function save (st) {
  st.updated = today()
  writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n')
}
function today () { return new Date().toISOString().slice(0, 10) }
function stamp () { return new Date().toISOString().replace('T', ' ').slice(0, 19) }
function die (msg) { console.error(red('error: ') + msg); process.exit(1) }

const allSteps = st => st.phases.flatMap(p => p.steps.map(s => ({ ...s, phase: p.id, phaseTitle: p.title })))
const findStep = (st, id) => {
  for (const p of st.phases) for (const s of p.steps) if (s.id.toLowerCase() === String(id).toLowerCase()) return { phase: p, step: s }
  return null
}
function git (args, fallback = null) {
  try { return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return fallback }
}
function logEvent (line) {
  const header = existsSync(LOG) ? '' : '# OVERPOP build log\n\nAppend-only. Written by `tools/state.mjs`.\n\n'
  appendFileSync(LOG, `${header}- \`${stamp()}\` ${line}\n`)
}

/* ---------- verify helpers ---------- */

function hGrep ([file, ...rest]) {
  const pattern = rest.join(' ')
  const path = resolve(ROOT, file)
  if (!existsSync(path)) return fail(`${file} does not exist`)
  const body = readFileSync(path, 'utf8')
  return body.includes(pattern) ? ok(`${file} contains ${JSON.stringify(pattern)}`) : fail(`${file} is missing ${JSON.stringify(pattern)}`)
}
function hExists (paths) {
  const missing = paths.filter(p => !existsSync(resolve(ROOT, p)))
  if (missing.length) return fail(`missing: ${missing.join(', ')}`)
  const empty = paths.filter(p => { const s = statSync(resolve(ROOT, p)); return s.isFile() && s.size === 0 })
  if (empty.length) return fail(`empty: ${empty.join(', ')}`)
  return ok(`${paths.length} path(s) present and non-empty`)
}
async function hDns ([host]) {
  try {
    const recs = await dns.resolveCname(host)
    return recs.some(r => r.includes('andrenijman.github.io'))
      ? ok(`${host} CNAME -> ${recs.join(', ')}`)
      : fail(`${host} CNAME is ${recs.join(', ')}, expected andrenijman.github.io`)
  } catch (e) { return fail(`${host} has no resolvable CNAME (${e.code || e.message})`) }
}
async function hLive ([url]) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return fail(`${url} returned HTTP ${res.status}`)
    const body = await res.text()
    if (!body.includes('OVERPOP')) return fail(`${url} responded ${res.status} but the body does not mention OVERPOP`)
    return ok(`${url} is live (HTTP ${res.status}, served by ${res.headers.get('server') || 'unknown'})`)
  } catch (e) { return fail(`${url} unreachable: ${e.message}`) }
}
function hHubcard () {
  const hub = resolve(ROOT, '../_ref/games-site/index.html')
  if (!existsSync(hub)) return fail('games-site working copy not found at ../_ref/games-site — clone it before this step')
  const body = readFileSync(hub, 'utf8')
  const need = [
    ['card link', 'overpop.andrenijman.com'],
    ['JSON-LD entry', '"position": 3'],
    ['meta description', 'OVERPOP']
  ]
  const missing = need.filter(([, pat]) => !body.includes(pat)).map(([label]) => label)
  return missing.length ? fail(`games-site/index.html missing: ${missing.join(', ')}`) : ok('games-site hub references OVERPOP in card, JSON-LD and meta')
}

const ok = m => ({ pass: true, msg: m })
const fail = m => ({ pass: false, msg: m })

const HELPERS = { grep: hGrep, exists: hExists, dns: hDns, live: hLive, hubcard: hHubcard }

// A verify entry is either a state.mjs helper invocation or an arbitrary shell command.
async function runVerify (cmd) {
  const m = cmd.match(/^node\s+tools\/state\.mjs\s+(\w+)\s*(.*)$/)
  if (m && HELPERS[m[1]]) {
    const args = (m[2].match(/'[^']*'|"[^"]*"|\S+/g) || []).map(a => a.replace(/^['"]|['"]$/g, ''))
    return { cmd, ...(await HELPERS[m[1]](args)) }
  }
  if (m && m[1] === 'selftest') return { cmd, ...selftest(load(), true) }
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 }).toString().trim()
    return { cmd, pass: true, msg: out.split('\n').slice(-1)[0] || 'exit 0' }
  } catch (e) {
    const out = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join('\n').trim()
    return { cmd, pass: false, msg: out.split('\n').slice(-3).join(' / ') || `exit ${e.status}` }
  }
}

async function verifyStep (step, { quiet = false } = {}) {
  if (!step.verify?.length) {
    if (!quiet) console.log(`  ${dim('no verify defined — manual step')}`)
    return true
  }
  let all = true
  for (const cmd of step.verify) {
    const r = await runVerify(cmd)
    all = all && r.pass
    if (!quiet) console.log(`  ${r.pass ? green('pass') : red('FAIL')} ${dim(cmd)}\n       ${r.msg}`)
  }
  return all
}

/* ---------- selftest ---------- */

function selftest (st, asVerify = false) {
  const errs = []
  const steps = allSteps(st)
  const ids = new Set()
  for (const s of steps) {
    if (ids.has(s.id)) errs.push(`duplicate step id ${s.id}`)
    ids.add(s.id)
    if (!STATUSES.includes(s.status)) errs.push(`${s.id}: bad status ${JSON.stringify(s.status)}`)
    if (!Array.isArray(s.deps)) errs.push(`${s.id}: deps must be an array`)
    if (!Array.isArray(s.produces)) errs.push(`${s.id}: produces must be an array`)
    if (!Array.isArray(s.verify)) errs.push(`${s.id}: verify must be an array`)
  }
  for (const s of steps) for (const d of s.deps || []) if (!ids.has(d)) errs.push(`${s.id}: unknown dep ${d}`)

  // cycle detection
  const byId = new Map(steps.map(s => [s.id, s]))
  const seen = new Map()
  const walk = (id, stack) => {
    if (stack.includes(id)) { errs.push(`dependency cycle: ${[...stack, id].join(' -> ')}`); return }
    if (seen.get(id)) return
    seen.set(id, true)
    for (const d of byId.get(id)?.deps || []) walk(d, [...stack, id])
  }
  for (const s of steps) walk(s.id, [])

  // a done step whose dep is not done is a state inconsistency worth surfacing
  for (const s of steps) {
    if (s.status !== 'done') continue
    for (const d of s.deps || []) if (byId.get(d)?.status !== 'done') errs.push(`${s.id} is done but dep ${d} is ${byId.get(d)?.status}`)
  }

  if (asVerify) return errs.length ? fail(errs.join('; ')) : ok(`${steps.length} steps, ${st.phases.length} phases, graph is acyclic and consistent`)
  if (errs.length) { errs.forEach(e => console.log(`  ${red('FAIL')} ${e}`)); process.exit(1) }
  console.log(`${green('pass')} ${steps.length} steps across ${st.phases.length} phases; graph acyclic, deps resolvable, statuses valid`)
  return ok('')
}

/* ---------- reporting ---------- */

function pct (steps) {
  const done = steps.filter(s => s.status === 'done').length
  return { done, total: steps.length, pc: steps.length ? Math.round((done / steps.length) * 100) : 0 }
}

function status (st) {
  const steps = allSteps(st)
  const { done, total, pc } = pct(steps)
  console.log(`\n${bold(st.title)} ${dim('·')} ${st.domain}`)
  console.log(`${dim('branch')} ${git('rev-parse --abbrev-ref HEAD', st.branch)} ${dim('· head')} ${git('rev-parse --short HEAD', '(no commits yet)')}`)
  console.log(`${dim('progress')} ${bold(`${done}/${total}`)} steps ${dim(`(${pc}%)`)}  ${bar(pc)}\n`)
  for (const p of st.phases) {
    const s = pct(p.steps)
    const head = s.pc === 100 ? green(`${p.id} ${p.title}`) : s.done > 0 ? yellow(`${p.id} ${p.title}`) : `${p.id} ${p.title}`
    console.log(`${head} ${dim(`${s.done}/${s.total}`)}`)
    for (const step of p.steps) {
      const extra = step.status === 'blocked' && step.note ? dim(` — ${step.note.split('.')[0]}`) : ''
      console.log(`  ${MARK[step.status]} ${dim(step.id.padEnd(6))}${step.title}${extra}`)
    }
  }
  console.log()
}
const bar = p => { const w = 24, f = Math.round((p / 100) * w); return dim('[') + green('█'.repeat(f)) + dim('░'.repeat(w - f) + ']') }

function actionable (st) {
  const steps = allSteps(st)
  const byId = new Map(steps.map(s => [s.id, s]))
  const ready = s => (s.deps || []).every(d => byId.get(d)?.status === 'done')
  return {
    inProgress: steps.filter(s => s.status === 'in_progress'),
    ready: steps.filter(s => s.status === 'todo' && ready(s)),
    waiting: steps.filter(s => s.status === 'todo' && !ready(s)),
    blocked: steps.filter(s => s.status === 'blocked')
  }
}

function next (st) {
  const { inProgress, ready, blocked } = actionable(st)
  if (inProgress.length) {
    console.log(`\n${yellow('IN PROGRESS')} — finish these before starting anything new:`)
    inProgress.forEach(printStep)
  }
  if (ready.length) {
    console.log(`\n${cyan('READY')} — deps satisfied, ${ready.length} step(s) can start now${ready.length > 1 ? ' (parallelisable)' : ''}:`)
    ready.forEach(printStep)
  } else if (!inProgress.length) {
    console.log(blocked.length ? `\n${red('NOTHING READY')} — remaining work is blocked.` : `\n${green('ALL STEPS DONE.')}`)
  }
  if (blocked.length) { console.log(`\n${red('BLOCKED')}:`); blocked.forEach(printStep) }
  console.log()
}

function printStep (s) {
  console.log(`\n  ${bold(s.id)} ${s.title}   ${dim(`[${s.phase} ${s.phaseTitle}]`)}`)
  if (s.deps?.length) console.log(`    ${dim('deps    ')} ${s.deps.join(', ')}`)
  if (s.produces?.length) console.log(`    ${dim('produces')} ${s.produces.join(', ')}`)
  if (s.verify?.length) console.log(`    ${dim('verify  ')} ${s.verify.join('  &&  ')}`)
  if (s.note) console.log(`    ${dim('note    ')} ${s.note}`)
}

function brief (st) {
  const { inProgress, ready, blocked } = actionable(st)
  const { done, total, pc } = pct(allSteps(st))
  console.log(`
${bold('═══ OVERPOP — RESUME BRIEFING ═══')}

${bold('What this is')}
  A from-scratch tower-defense game in the spirit of Bloons TD 6, for
  ${st.domain}. Vanilla JS on canvas, classic <script> tags (no ES
  modules — the game must run from file://), zero dependencies, zero build
  step, PWA. House style matches AndreNijman/pvz and AndreNijman/topout.
  Towers are woodland critters; every name is original.

${bold('Where the build is')}
  ${bold(`${done}/${total}`)} steps done ${dim(`(${pc}%)`)}   ${bar(pc)}
  branch  ${git('rev-parse --abbrev-ref HEAD', st.branch)}   head ${git('rev-parse --short HEAD', '(none)')}
  dirty   ${git('status --porcelain', '') ? yellow('yes — uncommitted changes present') : green('no')}

${bold('Read before writing code')}
  ARCHITECTURE.md  — the frozen engine contract. Do not diverge from it;
                     amend it deliberately and re-run the harness if you must.
  docs/BUILD_LOG.md — append-only history of every step transition.

${bold('The loop')}
  1. node tools/state.mjs next          pick the step
  2. node tools/state.mjs start <id>
  3. write the code
  4. node tools/state.mjs verify <id>
  5. git commit (Conventional Commits, no AI attribution)
  6. node tools/state.mjs done <id>     re-verifies, then stamps the commit
${inProgress.length ? `\n${yellow('Was mid-step when paused')} — resume here:` : ''}`)
  inProgress.forEach(printStep)
  if (ready.length) { console.log(`\n${cyan('Next up')} (${ready.length} ready):`); ready.slice(0, 4).forEach(printStep) }
  if (blocked.length) { console.log(`\n${red('Deliberately blocked')} — needs a human decision:`); blocked.forEach(printStep) }
  console.log()
}

/* ---------- mutations ---------- */

async function main () {
  const [cmd, ...args] = process.argv.slice(2)
  const st = load()

  switch (cmd) {
    case undefined:
    case 'status': return status(st)
    case 'brief': return brief(st)
    case 'next': return next(st)
    case 'selftest': return void selftest(st)

    case 'start': {
      const hit = findStep(st, args[0]) || die(`no such step: ${args[0]}`)
      const byId = new Map(allSteps(st).map(s => [s.id, s]))
      const unmet = (hit.step.deps || []).filter(d => byId.get(d)?.status !== 'done')
      if (unmet.length) console.log(yellow(`warning: unmet deps (${unmet.join(', ')}) — starting anyway`))
      hit.step.status = 'in_progress'
      hit.step.started = stamp()
      save(st); logEvent(`**start** ${hit.step.id} — ${hit.step.title}`)
      console.log(`${yellow('▸')} ${hit.step.id} in_progress — ${hit.step.title}`)
      return printStep({ ...hit.step, phase: hit.phase.id, phaseTitle: hit.phase.title })
    }

    case 'done': {
      const hit = findStep(st, args[0]) || die(`no such step: ${args[0]}`)
      const force = args.includes('--force')
      console.log(`verifying ${hit.step.id} — ${hit.step.title}`)
      const passed = await verifyStep(hit.step)
      if (!passed && !force) die(`${hit.step.id} does not verify. Fix it, or re-run with --force to record it anyway.`)
      hit.step.status = 'done'
      hit.step.finished = stamp()
      hit.step.commit = git('rev-parse --short HEAD')
      if (!passed) hit.step.note = `${hit.step.note || ''} [FORCED: verify failing at ${stamp()}]`.trim()
      save(st)
      logEvent(`**done** ${hit.step.id} — ${hit.step.title} ${hit.step.commit ? `(\`${hit.step.commit}\`)` : ''}${passed ? '' : ' — FORCED, verify failing'}`)
      console.log(`${green('✓')} ${hit.step.id} done${hit.step.commit ? ` at ${hit.step.commit}` : ''}`)
      return next(load())
    }

    case 'block': {
      const hit = findStep(st, args[0]) || die(`no such step: ${args[0]}`)
      hit.step.status = 'blocked'
      hit.step.note = args.slice(1).join(' ') || hit.step.note
      save(st); logEvent(`**blocked** ${hit.step.id} — ${hit.step.note}`)
      return console.log(`${red('✗')} ${hit.step.id} blocked — ${hit.step.note}`)
    }

    case 'note': {
      const hit = findStep(st, args[0]) || die(`no such step: ${args[0]}`)
      hit.step.note = args.slice(1).join(' ')
      save(st); logEvent(`note ${hit.step.id} — ${hit.step.note}`)
      return console.log(`noted on ${hit.step.id}`)
    }

    case 'verify': {
      if (args[0] === 'all' || !args[0]) {
        let bad = 0
        for (const s of allSteps(st)) {
          if (!['done', 'in_progress'].includes(s.status) || !s.verify?.length) continue
          console.log(`\n${s.id} ${s.title}`)
          if (!(await verifyStep(s))) bad++
        }
        console.log(bad ? `\n${red(`${bad} step(s) failing verification`)}` : `\n${green('all completed steps verify')}`)
        return process.exit(bad ? 1 : 0)
      }
      const hit = findStep(st, args[0]) || die(`no such step: ${args[0]}`)
      console.log(`${hit.step.id} ${hit.step.title}`)
      return process.exit((await verifyStep(hit.step)) ? 0 : 1)
    }

    // verify helpers, callable directly
    case 'grep': case 'exists': case 'dns': case 'live': case 'hubcard': {
      const r = await HELPERS[cmd](args)
      console.log(`${r.pass ? green('pass') : red('FAIL')} ${r.msg}`)
      return process.exit(r.pass ? 0 : 1)
    }

    default: die(`unknown command ${JSON.stringify(cmd)}. Try: brief | status | next | start | done | verify | block | note | selftest`)
  }
}

main()

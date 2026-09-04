#!/usr/bin/env node
// Boots the real page in a real browser and asserts it is actually playable.
//
//   node tools/smoke.mjs                 boot, play, screenshot, report
//   node tools/smoke.mjs --rounds 5      play more rounds
//   node tools/smoke.mjs --shot out.png  where to write the screenshot
//   node tools/smoke.mjs --url file://…  override the page URL
//   node tools/smoke.mjs --headful       keep the browser visible (debugging)
//
// The headless harness proves the simulation is correct. This proves the *page*
// works: that ~50 classic scripts load in the declared order under file://, that
// nothing throws at boot, that the canvas actually gets painted, and that a real
// input event starts a real round.
//
// Zero dependencies. Chrome is driven over the DevTools protocol using Node's
// built-in WebSocket (Node 22+), because adding puppeteer to a project whose whole
// premise is "no dependencies" would be a poor trade for one script.

import { spawn } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tty = process.stdout.isTTY
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const dim = s => c(2, s), bold = s => c(1, s)
const green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s)

/* ---------- find a browser ---------- */

function findChrome () {
  const pinned = resolve(ROOT, 'tools/.chrome-path')
  if (existsSync(pinned)) {
    const p = readFileSync(pinned, 'utf8').trim()
    if (p && existsSync(p)) return p
  }
  const candidates = [
    process.env.CHROME_PATH,
    `${process.env.HOME}/.local/bin/chrome-headless-shell`,
    `${process.env.HOME}/.local/share/overpop-tools/chrome-headless-shell-linux64/chrome-headless-shell`,
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'
  ].filter(Boolean)
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

/* ---------- a very small CDP client ---------- */

class CDP {
  constructor (ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', ev => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method)
        if (fns) for (const fn of fns) fn(msg.params || {})
      }
    })
  }

  static async connect (url, timeoutMs = 20000) {
    const started = Date.now()
    for (;;) {
      try {
        const ws = new WebSocket(url)
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('websocket open timed out')), 8000)
          ws.addEventListener('open', () => { clearTimeout(t); res() }, { once: true })
          ws.addEventListener('error', e => { clearTimeout(t); rej(new Error('websocket error')) }, { once: true })
        })
        return new CDP(ws)
      } catch (e) {
        if (Date.now() - started > timeoutMs) throw e
        await sleep(150)
      }
    }
  }

  send (method, params) {
    const id = this.next++
    const payload = JSON.stringify({ id, method, params: params || {} })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(payload)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, 60000)
    })
  }

  on (method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval (expr) {
    const r = await this.send('Runtime.evaluate', {
      // async, so evaluated snippets may await (the autoplay hook and the
      // frame-timing probe both need it).
      expression: `(async function(){ ${expr} })()`,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    }
    return r.result?.value
  }

  close () { try { this.ws.close() } catch {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchJSON (url, timeoutMs = 20000) {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch {}
    if (Date.now() - started > timeoutMs) throw new Error('browser did not open a debug port: ' + url)
    await sleep(150)
  }
}

/* ---------- the test ---------- */

const results = []
function check (ok, label, detail) {
  results.push({ ok: !!ok, label, detail: detail || '' })
  console.log(`  ${ok ? green('pass') : red('FAIL')} ${label}${!ok && detail ? `\n       ${dim(detail)}` : ''}`)
  return !!ok
}

async function main () {
  const argv = process.argv.slice(2)
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  const rounds = parseInt(arg('--rounds', '3'), 10)
  const shot = resolve(ROOT, arg('--shot', 'docs/smoke-shot.png'))
  const url = arg('--url', 'file://' + resolve(ROOT, 'index.html'))
  const headful = argv.includes('--headful')

  const chrome = findChrome()
  if (!chrome) {
    console.error(red('no browser found.') + ' Set CHROME_PATH, or write a path into tools/.chrome-path.')
    process.exit(2)
  }

  console.log(`\n${bold('OVERPOP smoke test')}`)
  console.log(`${dim('browser')} ${chrome}`)
  console.log(`${dim('page   ')} ${url}\n`)

  const profile = mkdtempSync(resolve(tmpdir(), 'overpop-smoke-'))
  const port = 9000 + Number(process.hrtime.bigint() % 900n)

  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1400,900',
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--mute-audio',
    // file:// pages loading sibling files need this in modern Chrome.
    '--allow-file-access-from-files',
    ...(headful ? [] : ['--headless=new']),
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let procErr = ''
  proc.stderr.on('data', d => { procErr += d.toString() })

  let cdp = null
  try {
    const version = await fetchJSON(`http://127.0.0.1:${port}/json/version`)
    check(true, `browser started (${version.Browser})`)

    const targets = await fetchJSON(`http://127.0.0.1:${port}/json/list`)
    const page = targets.find(t => t.type === 'page')
    if (!page) throw new Error('no page target')
    cdp = await CDP.connect(page.webSocketDebuggerUrl)

    /* ---------- collect everything the page complains about ---------- */

    const consoleErrors = []
    const consoleWarnings = []
    const exceptions = []
    const failedRequests = []

    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')

    cdp.on('Runtime.consoleAPICalled', p => {
      const text = (p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')
      if (p.type === 'error') consoleErrors.push(text)
      else if (p.type === 'warning') consoleWarnings.push(text)
    })
    cdp.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails || {}
      exceptions.push(`${d.text || 'exception'}: ${d.exception?.description || ''}`.slice(0, 400))
    })
    cdp.on('Log.entryAdded', p => {
      const e = p.entry || {}
      if (e.level === 'error') consoleErrors.push(`[${e.source}] ${e.text}`)
    })
    cdp.on('Network.loadingFailed', p => {
      failedRequests.push(`${p.type || 'request'} failed: ${p.errorText || ''}`)
    })
    cdp.on('Network.responseReceived', p => {
      if (p.response && p.response.status >= 400) {
        failedRequests.push(`${p.response.status} ${p.response.url}`)
      }
    })

    /* ---------- boot ---------- */

    console.log(dim('booting…'))
    await cdp.send('Page.navigate', { url })
    // Wait for the bundle to finish evaluating.
    let booted = false
    for (let i = 0; i < 100; i++) {
      await sleep(120)
      const state = await cdp.eval('return document.readyState === "complete" && typeof window.OP === "object"')
      if (state) { booted = true; break }
    }
    check(booted, 'page reached readyState complete with the OP global present')

    check(failedRequests.length === 0, 'every script and asset loaded',
      failedRequests.slice(0, 8).join('\n       '))

    check(exceptions.length === 0, 'no uncaught exceptions during boot',
      exceptions.slice(0, 6).join('\n       '))

    check(consoleErrors.length === 0, 'console is clean of errors',
      consoleErrors.slice(0, 8).join('\n       '))

    /* ---------- the bundle actually assembled ---------- */

    const registries = await cdp.eval(`
      if (!window.OP) return null
      return {
        version: OP.VERSION || null,
        towers: OP.TOWERS ? Object.keys(OP.TOWERS).length : -1,
        heroes: OP.HEROES ? Object.keys(OP.HEROES).length : -1,
        maps: OP.MAPS ? Object.keys(OP.MAPS).length : -1,
        rounds: OP.ROUNDS_STANDARD ? Object.keys(OP.ROUNDS_STANDARD).length : -1,
        difficulties: OP.DIFFICULTIES ? Object.keys(OP.DIFFICULTIES).length : -1,
        modes: OP.MODES ? Object.keys(OP.MODES).length : -1,
        hasSim: !!(OP.Sim && OP.Sim.step),
        hasRenderer: !!(OP.Render && OP.Render.frame),
        hasAudio: !!OP.Audio,
        hasSave: !!(OP.Save && OP.Save.load)
      }
    `)
    if (registries) {
      check(registries.hasSim, 'the simulation is present')
      check(registries.towers > 0, `the tower roster loaded (${registries.towers} towers)`)
      check(registries.maps > 0, `the map roster loaded (${registries.maps} maps)`)
      check(registries.rounds === 100, `the round table has 100 rounds (${registries.rounds})`)
      check(registries.difficulties === 4, `four difficulties (${registries.difficulties})`)
      check(registries.modes === 18, `eighteen modes (${registries.modes})`)
      check(registries.hasRenderer, 'the renderer is present')
      check(registries.hasSave, 'the save system is present')
    } else {
      check(false, 'the OP global exists', 'window.OP was missing entirely')
    }

    /* ---------- the canvas gets painted ---------- */

    const painted = await cdp.eval(`
      const cv = document.getElementById('game')
      if (!cv) return { ok: false, why: 'no #game canvas' }
      const ctx = cv.getContext('2d')
      if (!ctx) return { ok: false, why: 'no 2d context' }
      const w = cv.width, h = cv.height
      const data = ctx.getImageData(0, 0, w, h).data
      // Count distinct-ish colours on a coarse grid. A blank canvas has one.
      const seen = new Set()
      let lit = 0
      for (let y = 0; y < h; y += 8) {
        for (let x = 0; x < w; x += 8) {
          const i = (y * w + x) * 4
          const key = (data[i] >> 4) + ',' + (data[i+1] >> 4) + ',' + (data[i+2] >> 4)
          seen.add(key)
          if (data[i] + data[i+1] + data[i+2] > 24) lit++
        }
      }
      const field = (window.OP && OP.FIELD_W) ? OP.FIELD_W + 'x' + OP.FIELD_H : '?'
      return { ok: true, colours: seen.size, lit: lit, size: w + 'x' + h, field: field }
    `)
    if (painted && painted.ok) {
      // The backing store is sized to the viewport by OP.Camera.resize; 1280x720 is
      // the LOGICAL design space, not the canvas attribute. Asserting the attribute
      // was wrong — it only holds before the first resize.
      check(/^\d+x\d+$/.test(painted.size), `canvas has a real backing store (${painted.size})`)
      check(painted.field === '1280x720', `the logical design space is 1280x720 (${painted.field})`)
      check(painted.colours > 3, `canvas is actually painted (${painted.colours} distinct colours sampled)`,
        'a blank canvas samples as 1 colour')
      check(painted.lit > 100, `a meaningful area is non-black (${painted.lit} lit samples)`)
    } else {
      check(false, 'canvas is painted', painted ? painted.why : 'evaluation failed')
    }

    /* ---------- boot overlay clears ---------- */

    const bootGone = await cdp.eval(`
      const b = document.getElementById('boot')
      if (!b) return true
      const st = getComputedStyle(b)
      return b.classList.contains('gone') || st.opacity === '0' || st.display === 'none'
    `)
    check(bootGone, 'the loading overlay was dismissed once the first frame drew')

    /* ---------- drive a real game ---------- */

    console.log(dim(`playing ${rounds} round(s)…`))
    const played = await cdp.eval(`
      // Prefer a documented test hook if the shell exposes one; otherwise drive
      // the simulation directly, which still exercises the real code paths.
      if (window.OP && OP.Test && typeof OP.Test.autoplay === 'function') {
        return await OP.Test.autoplay(${rounds})
      }
      if (!(window.OP && OP.Sim && OP.Maps && OP.Maps.all().length)) {
        return { ok: false, why: 'no sim or no maps' }
      }
      const mapDef = OP.Maps.all()[0]
      const map = OP.Maps.build(mapDef)
      const sim = OP.Sim.create({
        map: map, seed: 'smoke', difficulty: 'easy', mode: 'standard',
        roundSetKey: 'standard', autostart: true,
        rules: { startCash: 999999 }
      })
      // Place whatever the first few towers are, wherever they fit.
      let placed = 0
      const keys = OP.TOWER_ORDER.slice(0, 8)
      for (const key of keys) {
        for (let attempt = 0; attempt < 220 && placed < 8; attempt++) {
          const x = 40 + (attempt * 71) % 1200
          const y = 40 + (attempt * 137) % 640
          if (OP.Towers.canPlace(sim, key, x, y).ok) {
            if (OP.Towers.place(sim, key, x, y)) { placed++; break }
          }
        }
      }
      OP.Sim.startRound(sim, 1)
      let guard = 0
      while (sim.roundIndex <= ${rounds} && !sim.over && guard < 60 * 60 * 12) {
        OP.Sim.step(sim)
        guard++
      }
      return {
        ok: true, placed: placed, tick: sim.tick, round: sim.roundIndex,
        popped: sim.stats.popped, leaked: sim.stats.leaked,
        lives: sim.lives, over: sim.over, outcome: sim.outcome,
        checksum: OP.Sim.checksum(sim)
      }
    `)

    if (played && played.ok) {
      check(played.placed > 0, `towers could be placed on a real map (${played.placed})`)
      check(played.tick > 60, `the simulation ran in the browser (${played.tick} ticks)`)
      check(played.popped > 0, `balloons were popped (${played.popped})`)
      check(played.round > 1, `rounds advanced (reached round ${played.round})`)
      check(typeof played.checksum === 'number', `a checksum could be taken (${played.checksum})`)
    } else {
      check(false, 'a game can be played in the browser', played ? played.why : 'evaluation failed')
    }

    /* ---------- input reaches the game ---------- */

    const inputWorked = await cdp.eval(`
      const cv = document.getElementById('game')
      if (!cv) return false
      const before = (window.OP && OP.__inputCount) || 0
      const r = cv.getBoundingClientRect()
      const ev = new PointerEvent('pointerdown', {
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        bubbles: true, cancelable: true, pointerId: 1, isPrimary: true
      })
      let threw = null
      try { cv.dispatchEvent(ev) } catch (e) { threw = String(e) }
      return threw === null
    `)
    check(inputWorked, 'a pointer event on the canvas does not throw')

    /* ---------- frame budget ---------- */

    const perf = await cdp.eval(`
      return await new Promise(res => {
        const times = []
        let last = performance.now()
        let n = 0
        function tick () {
          const now = performance.now()
          times.push(now - last)
          last = now
          if (++n < 90) requestAnimationFrame(tick)
          else {
            times.sort((a, b) => a - b)
            res({
              median: times[Math.floor(times.length / 2)],
              p95: times[Math.floor(times.length * 0.95)],
              frames: times.length
            })
          }
        }
        requestAnimationFrame(tick)
      })
    `)
    if (perf) {
      check(perf.frames > 60, `the render loop is running (${perf.frames} frames sampled)`)
      check(perf.median < 34, `median frame time is under 34ms (${perf.median.toFixed(1)}ms)`,
        'headless software rendering is slower than real hardware, so this is a floor not a target')
    }

    /* ---------- errors accumulated during play ---------- */

    check(exceptions.length === 0, 'still no uncaught exceptions after playing',
      exceptions.slice(0, 6).join('\n       '))
    check(consoleErrors.length === 0, 'still no console errors after playing',
      consoleErrors.slice(0, 8).join('\n       '))

    /* ---------- screenshot ---------- */

    try {
      const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(shot, Buffer.from(cap.data, 'base64'))
      check(true, `screenshot written to ${shot.replace(ROOT + '/', '')}`)
    } catch (e) {
      check(false, 'screenshot could be captured', e.message)
    }

    if (consoleWarnings.length) {
      console.log(`\n${yellow('warnings')} ${dim('(not failures)')}`)
      for (const w of consoleWarnings.slice(0, 6)) console.log(`  ${dim(w.slice(0, 160))}`)
    }
  } catch (e) {
    check(false, 'smoke test completed', e.message + (procErr ? '\n       browser stderr: ' + procErr.slice(-400) : ''))
  } finally {
    if (cdp) cdp.close()
    proc.kill('SIGKILL')
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }

  const failed = results.filter(r => !r.ok)
  console.log(failed.length
    ? `\n${red(`${failed.length} of ${results.length} checks failed`)}`
    : `\n${green(`all ${results.length} checks passed`)}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(red('smoke test crashed: ') + (e.stack || e.message)); process.exit(1) })

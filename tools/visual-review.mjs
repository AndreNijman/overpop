#!/usr/bin/env node
// Node 22+, zero dependencies. Real Chromium via CDP, following smoke.mjs.
// node tools/visual-review.mjs --probe                 validate without PNGs
// node tools/visual-review.mjs                         capture all 18 views
// node tools/visual-review.mjs --screens title,maps --viewports desktop,portrait
// Options: --browser PATH, --url URL, --out DIR, --headful, --strict-fit
// Every run uses a disposable browser profile; no existing game saves are read.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const VIEWPORTS = {
  desktop: { width: 1400, height: 900 },
  landscape: { width: 844, height: 390 },
  portrait: { width: 390, height: 844 }
}
const SCREENS = ['title', 'maps', 'settings', 'knowledge', 'gameplay-shop', 'selected-tower']

function findBrowser () {
  const pinned = resolve(ROOT, 'tools/.chrome-path')
  return [
    process.env.CHROME_PATH,
    existsSync(pinned) ? readFileSync(pinned, 'utf8').trim() : null,
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).flatMap(base => [
        resolve(base, 'Google/Chrome/Application/chrome.exe'),
        resolve(base, 'Microsoft/Edge/Application/msedge.exe')
      ]),
    `${process.env.HOME}/.local/bin/chrome-headless-shell`,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => p && existsSync(p))
}

class CDP {
  constructor (ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const p = this.pending.get(message.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(message.id)
        if (message.error) p.reject(new Error(message.error.message))
        else p.resolve(message.result)
      } else {
        for (const fn of this.listeners.get(message.method) || []) fn(message.params || {})
      }
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('CDP connection closed'))
      }
      this.pending.clear()
    })
  }

  static async connect (url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP open timed out')) }, 15000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP open failed')) }, { once: true })
    })
    return new CDP(ws)
  }

  send (method, params = {}) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, 20000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on (method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  async eval (expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result?.value
  }
}

async function main () {
  const args = process.argv.slice(2)
  const flags = new Set(['--probe', '--headful', '--strict-fit'])
  const values = new Set(['--browser', '--url', '--out', '--screens', '--viewports', '--round', '--hold'])
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) options[args[i]] = true
    else if (values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i]] = args[++i]
    else throw new Error(`Unknown option or missing value: ${args[i]}`)
  }
  const startRound = Math.max(1, parseInt(options['--round'] || '1', 10) || 1)
  const holdTicks = Math.max(1, parseInt(options['--hold'] || '90', 10) || 90)
  const screens = options['--screens']?.split(',') || SCREENS
  const viewports = options['--viewports']?.split(',') || Object.keys(VIEWPORTS)
  if (screens.some(s => !SCREENS.includes(s))) throw new Error(`Screens: ${SCREENS.join(',')}`)
  if (viewports.some(v => !VIEWPORTS[v])) throw new Error(`Viewports: ${Object.keys(VIEWPORTS).join(',')}`)
  const browser = options['--browser'] || findBrowser()
  if (!browser || !existsSync(browser)) throw new Error('No browser found; use --browser PATH or CHROME_PATH')
  const out = resolve(ROOT, options['--out'] || 'docs/visual-review')
  mkdirSync(out, { recursive: true })
  const profile = mkdtempSync(resolve(tmpdir(), 'overpop-visual-'))
  const summary = {
    browser, url: options['--url'] || pathToFileURL(resolve(ROOT, 'index.html')).href,
    startedAt: new Date().toISOString(), probe: !!options['--probe'], out,
    profile, profileRemoved: false, captures: [], errors: [], warnings: [], failures: []
  }
  let cdp
  let phase = 'launch'
  let stderr = ''
  const proc = spawn(browser, [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1400,900', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio',
    '--allow-file-access-from-files',
    ...(options['--headful'] ? [] : ['--headless=new']), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const exited = new Promise(resolve => proc.once('exit', resolve))
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser debug endpoint timed out')), 20000)
      proc.once('error', error => { clearTimeout(timer); reject(error) })
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited: ${code}`)) })
      proc.stderr.on('data', data => {
        stderr += data.toString()
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    const base = `http://${new URL(endpoint).host}`
    const version = await (await fetch(`${base}/json/version`)).json()
    summary.browserVersion = version.Browser
    const targets = await (await fetch(`${base}/json/list`)).json()
    const target = targets.find(t => t.type === 'page')
    if (!target) throw new Error('No browser page target')
    cdp = await CDP.connect(target.webSocketDebuggerUrl)
    cdp.on('Runtime.exceptionThrown', p => summary.errors.push({ phase, type: 'exception', details: p.exceptionDetails }))
    cdp.on('Runtime.consoleAPICalled', p => {
      const text = p.args.map(a => a.value ?? a.description ?? a.type).join(' ')
      if (p.type === 'error') summary.errors.push({ phase, type: 'console', text })
      if (p.type === 'warning') summary.warnings.push({ phase, type: 'console', text })
    })
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') summary.errors.push({ phase, type: 'log', text: entry.text, url: entry.url })
    })
    cdp.on('Network.loadingFailed', p => summary.errors.push({ phase, type: 'request', details: p }))
    cdp.on('Network.responseReceived', ({ response }) => {
      if (response.status >= 400) summary.errors.push({ phase, type: 'http', status: response.status, url: response.url })
    })
    for (const domain of ['Runtime', 'Page', 'Log', 'Network']) await cdp.send(`${domain}.enable`)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

    for (const viewport of viewports) {
      phase = `${viewport}/boot`
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        ...VIEWPORTS[viewport], deviceScaleFactor: 1, mobile: viewport !== 'desktop'
      })
      const navigation = await cdp.send('Page.navigate', { url: summary.url })
      if (navigation.errorText) throw new Error(navigation.errorText)
      let ready = false
      for (let i = 0; i < 150; i++) {
        await sleep(100)
        ready = await cdp.eval(`
          const S = window.OP?.App?.state
          return document.readyState === 'complete' && !!S?.booted && !!S.running &&
            S.lastFrame > 0 && S.canvas.width > 0 && !document.getElementById('boot') &&
            !!OP.Menus?.build && !!OP.Shop?.build && !!OP.TowerPanel?.build &&
            OP.MAP_ORDER.length > 0 && OP.TOWER_ORDER.length > 0
        `)
        if (ready) break
      }
      if (!ready) throw new Error(`${phase}: app did not become ready with first frame and boot overlay removed`)
      summary.apis = await cdp.eval(`
        // Deterministic first-run fixture, in memory in this disposable profile only.
        OP.App.state.profile = OP.Save.defaults()
        OP.App.state.reducedMotion = true
        return { screens: OP.Menus.screenNames(), app: Object.keys(OP.App).filter(k => typeof OP.App[k] === 'function'),
          maps: OP.MAP_ORDER.length, towers: OP.TOWER_ORDER.length, panels: OP.HUD.panelNames() }
      `)

      for (const screen of screens) {
        phase = `${viewport}/${screen}`
        console.error(`Checking ${phase}${summary.probe ? ' (no PNG)' : ''}`)
        try {
          const fixture = await cdp.eval(`
            const app = OP.App, S = app.state, screen = ${JSON.stringify(screen)}
            OP.Input.cancel(S.io)
            S.io.selectedId = -1
            S.io.overCanvas = false
            OP.Shop.closeTree()
            OP.Shop.state.scroll = 0
            OP.Shop.state.detailKey = null
            if (['title', 'maps', 'settings', 'knowledge'].includes(screen)) {
              S.sim = null
              S.screen = 'menu'
              OP.Menus.state.mapScroll = 0
              if (OP.Menus.go(app, screen) !== screen) throw new Error('Screen is not registered: ' + screen)
              return { screen }
            }
            const sim = app.startGame(OP.MAP_ORDER[0], 'medium', 'standard', { seed: 'visual-review' })
            if (!sim) throw new Error('startGame failed')
            const key = OP.TOWER_ORDER[0]
            let tower = null
            for (let attempt = 0; attempt < 240 && !tower; attempt++) {
              const x = 160 + (attempt * 71) % (OP.FIELD_W - 320)
              const y = 120 + (attempt * 137) % (OP.FIELD_H - 240)
              if (OP.Towers.canPlace(sim, key, x, y).ok) tower = OP.Towers.place(sim, key, x, y)
            }
            if (!tower || !Number.isInteger(tower.id)) throw new Error('Could not place fixture tower')
            sim.autostart = false
            OP.Sim.startRound(sim, ${startRound})
            for (let i = 0; i < ${holdTicks}; i++) OP.Sim.step(sim)
            sim.paused = true
            if (screen === 'selected-tower') S.io.selectedId = tower.id
            if (screen === 'gameplay-shop' && !OP.Shop.showing(app)) throw new Error('Shop not showing')
            if (screen === 'selected-tower' && !OP.TowerPanel.showing(app)) throw new Error('Tower panel not showing')
            return { screen, map: S.mapKey, tower: key, selectedId: S.io.selectedId, tick: sim.tick, round: sim.roundIndex }
          `)
          await cdp.eval('await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
          const fit = await cdp.eval(`
            const app = OP.App, S = app.state, canvas = S.canvas, rect = canvas.getBoundingClientRect()
            const models = S.screen === 'menu' ? [OP.Menus.build(app)] :
              [OP.HUD.build(app), (OP.Shop.showing(app) ? OP.Shop : OP.TowerPanel).build(app)]
            const round = n => Math.round(n * 100) / 100
            const toRect = r => ({ x: round(r.x), y: round(r.y), w: round(r.width ?? r.w), h: round(r.height ?? r.h) })
            const a = OP.Camera.toScreen(S.view, 0, 0), b = OP.Camera.toScreen(S.view, OP.FIELD_W, OP.FIELD_H)
            const field = { x: a.x + rect.x, y: a.y + rect.y, w: b.x - a.x, h: b.y - a.y }
            const outside = r => r.x < -1 || r.y < -1 || r.x + r.w > innerWidth + 1 || r.y + r.h > innerHeight + 1
            const widgets = models.flatMap(model => (model.widgets || []).map(w => {
              let x = w.x, y = w.y, right = x + w.w, bottom = y + w.h
              if (w.hitClip) {
                x = Math.max(x, w.hitClip.x); y = Math.max(y, w.hitClip.y)
                right = Math.min(right, w.hitClip.x + w.hitClip.w); bottom = Math.min(bottom, w.hitClip.y + w.hitClip.h)
              }
              if (right <= x || bottom <= y || w.noHit) return null
              const p = OP.Camera.toScreen(S.view, x, y), q = OP.Camera.toScreen(S.view, right, bottom)
              const bounds = { x: p.x + rect.x, y: p.y + rect.y, w: q.x - p.x, h: q.y - p.y }
              return { model: model.screen, id: w.id, label: w.label, disabled: w.disabled,
                bounds: toRect(bounds), outside: outside(bounds), smallTarget: Math.min(bounds.w, bounds.h) < 24 }
            })).filter(Boolean)
            const colours = new Set(), data = S.ctx.getImageData(0, 0, canvas.width, canvas.height).data
            for (let y = 0; y < canvas.height; y += 12) for (let x = 0; x < canvas.width; x += 12) {
              const i = (y * canvas.width + x) * 4
              colours.add((data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4))
            }
            return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
              canvas: toRect(rect), field: toRect(field), fieldOutside: outside(field),
              fieldViewportAreaRatio: round(field.w * field.h / (innerWidth * innerHeight)),
              documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
              colours: colours.size, widgets, outsideWidgets: widgets.filter(w => w.outside).map(w => w.id),
              smallTargets: widgets.filter(w => w.smallTarget && !w.disabled).map(w => w.id) }
          `)
          if (fit.colours <= 3) throw new Error(`Canvas appears blank (${fit.colours} sampled colours)`)
          if (!fit.widgets.length) throw new Error('Screen has no widgets')
          if (fit.viewport.width !== VIEWPORTS[viewport].width || fit.viewport.height !== VIEWPORTS[viewport].height) throw new Error('Viewport metrics mismatch')
          const fitOK = !fit.fieldOutside && !fit.documentOverflow && !fit.outsideWidgets.length
          // Probe the actual encoder too, but do not publish pre-review images.
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          const image = Buffer.from(shot.data, 'base64')
          if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG from browser')
          const screenshot = { width: image.readUInt32BE(16), height: image.readUInt32BE(20), bytes: image.length }
          if (screenshot.width !== VIEWPORTS[viewport].width || screenshot.height !== VIEWPORTS[viewport].height) throw new Error('Screenshot dimensions mismatch')
          let png = null
          if (!summary.probe) {
            png = resolve(out, `${viewport}-${screen}.png`)
            writeFileSync(png, image)
          }
          summary.captures.push({ viewport, screen, fixture, fitOK, fit, screenshot, png })
          if (!fitOK) summary.warnings.push({ phase, type: 'fit', text: 'Field, document, or visible widget exceeds viewport' })
          if (fit.smallTargets.length) summary.warnings.push({ phase, type: 'small-targets', count: fit.smallTargets.length })
          if (options['--strict-fit'] && !fitOK) summary.failures.push({ phase, message: 'Viewport fit failed' })
        } catch (error) {
          summary.failures.push({ phase, message: error.stack || error.message })
        }
      }
    }
  } catch (error) {
    summary.failures.push({ phase, message: error.stack || error.message, browserStderr: stderr.slice(-2000) })
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close') } catch {}
      cdp.ws.close()
    }
    await Promise.race([exited, sleep(1500)])
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL')
      await Promise.race([exited, sleep(1500)])
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      summary.profileRemoved = true
    } catch (error) {
      summary.warnings.push({ phase: 'cleanup', text: error.message })
    }
    summary.finishedAt = new Date().toISOString()
    summary.ok = !summary.errors.length && !summary.failures.length
    const json = JSON.stringify(summary, null, 2)
    const report = resolve(out, summary.probe ? 'probe-summary.json' : 'summary.json')
    writeFileSync(report, json + '\n')
    console.log(json)
    console.error(`Report: ${report}`)
    process.exitCode = summary.ok ? 0 : 1
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })

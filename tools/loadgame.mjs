// Loads the *real shipped bundle* into a Node VM.
//
// The script list is parsed out of index.html, so there is no parallel
// Node-only build to drift out of sync, and load order becomes a testable
// property (see tools/suites/loader.mjs). Anything that touches a live DOM API
// at load time will blow up here — which is the correct signal, because it would
// also break under file:// on a cold cache.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Ordered list of same-origin script srcs declared in index.html. */
export function scriptManifest () {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
  const out = []
  const re = /<script[^>]+src=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html)) !== null) {
    if (!/^https?:|^\/\//i.test(m[1])) out.push(m[1].replace(/^\.\//, ''))
  }
  return out
}

/* ---------- browser stubs ----------
   Deliberately thin. The contract says sim code must not touch the DOM at load
   time, so a fat stub would hide real violations. Canvas methods are no-ops that
   record nothing: render code is allowed to *exist*, just not to run at import. */

function makeCtx2D () {
  const noop = () => {}
  const ctx = {
    canvas: null,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, transform: noop,
    setTransform: noop, resetTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, roundRect: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    fill: noop, stroke: noop, clip: noop, drawImage: noop, putImageData: noop,
    fillText: noop, strokeText: noop, setLineDash: noop, getLineDash: () => [],
    measureText: t => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    isPointInPath: () => false,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px monospace',
    textAlign: 'start', textBaseline: 'alphabetic', shadowBlur: 0, shadowColor: 'transparent',
    imageSmoothingEnabled: true, filter: 'none', miterLimit: 10, lineDashOffset: 0
  }
  return ctx
}

function makeCanvas (w = 300, h = 150) {
  const el = makeElement('canvas')
  el.width = w
  el.height = h
  const ctx = makeCtx2D()
  ctx.canvas = el
  el.getContext = () => ctx
  el.toDataURL = () => 'data:image/png;base64,'
  el.transferControlToOffscreen = () => makeCanvas(w, h)
  return el
}

function makeElement (tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, classList: { add () {}, remove () {}, toggle () {}, contains: () => false },
    children: [], attributes: {},
    width: 0, height: 0, textContent: '', innerHTML: '', id: '', className: '',
    clientWidth: 1280, clientHeight: 720, offsetWidth: 1280, offsetHeight: 720,
    appendChild (c) { this.children.push(c); return c },
    removeChild (c) { this.children = this.children.filter(x => x !== c); return c },
    remove () {},
    setAttribute (k, v) { this.attributes[k] = v },
    getAttribute (k) { return this.attributes[k] ?? null },
    removeAttribute (k) { delete this.attributes[k] },
    addEventListener () {}, removeEventListener () {}, dispatchEvent: () => true,
    focus () {}, blur () {}, click () {},
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => null,
    requestPointerLock () {}, setPointerCapture () {}, releasePointerCapture () {}
  }
  return el
}

function makeStorage () {
  const map = new Map()
  return {
    get length () { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: k => void map.delete(String(k)),
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map)
  }
}

function makeAudioStub () {
  const noop = () => {}
  const param = (v = 0) => ({
    value: v, setValueAtTime: noop, linearRampToValueAtTime: noop,
    exponentialRampToValueAtTime: noop, setTargetAtTime: noop, cancelScheduledValues: noop,
    setValueCurveAtTime: noop
  })
  const node = () => ({
    connect: n => n, disconnect: noop, start: noop, stop: noop,
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1),
    pan: param(0), playbackRate: param(1), delayTime: param(0),
    threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0), release: param(0.25),
    type: 'sine', buffer: null, loop: false, curve: null, oversample: 'none',
    onended: null, addEventListener: noop
  })
  class AudioContextStub {
    constructor () {
      this.state = 'running'
      this.sampleRate = 48000
      this.currentTime = 0
      this.destination = node()
      this.listener = { positionX: param(), positionY: param(), positionZ: param() }
    }
    createGain () { return node() }
    createOscillator () { return node() }
    createBiquadFilter () { return node() }
    createBufferSource () { return node() }
    createStereoPanner () { return node() }
    createPanner () { return node() }
    createDelay () { return node() }
    createConvolver () { return node() }
    createDynamicsCompressor () { return node() }
    createWaveShaper () { return node() }
    createChannelMerger () { return node() }
    createChannelSplitter () { return node() }
    createAnalyser () { return { ...node(), fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData: noop } }
    createBuffer (ch = 1, len = 1) {
      return { numberOfChannels: ch, length: len, sampleRate: 48000, duration: len / 48000, getChannelData: () => new Float32Array(len) }
    }
    createPeriodicWave () { return {} }
    decodeAudioData () { return Promise.resolve(this.createBuffer()) }
    resume () { return Promise.resolve() }
    suspend () { return Promise.resolve() }
    close () { return Promise.resolve() }
  }
  return AudioContextStub
}

/**
 * Evaluate the bundle.
 * @returns {{OP:object, order:string[], missing:string[], ctx:object, errors:Array}}
 */
export function loadGame ({ silent = true, stopOnError = true } = {}) {
  const order = scriptManifest()
  const missing = order.filter(p => !existsSync(resolve(ROOT, p)))
  const present = order.filter(p => existsSync(resolve(ROOT, p)))
  const errors = []

  const canvas = makeCanvas(1280, 720)
  const doc = {
    documentElement: makeElement('html'),
    head: makeElement('head'),
    body: makeElement('body'),
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    createElement: tag => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : makeElement(tag)),
    createElementNS: (_ns, tag) => makeElement(tag),
    createDocumentFragment: () => makeElement('fragment'),
    createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    getElementById: id => (id === 'game' ? canvas : makeElement()),
    querySelector: sel => (sel === '#game' || sel === 'canvas' ? canvas : makeElement()),
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    addEventListener () {}, removeEventListener () {},
    exitPointerLock () {}, exitFullscreen () { return Promise.resolve() },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), add () {} },
    cookie: ''
  }

  const sandbox = {
    console: silent ? { ...console, log () {}, info () {}, debug () {} } : console,
    document: doc,
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 720,
    location: { href: 'https://overpop.andrenijman.com/', protocol: 'https:', hostname: 'overpop.andrenijman.com', search: '', hash: '', reload () {} },
    navigator: { userAgent: 'node-harness', language: 'en', maxTouchPoints: 0, serviceWorker: { register: () => Promise.resolve({}) }, vibrate: () => true, clipboard: { writeText: () => Promise.resolve() } },
    matchMedia: q => ({ matches: false, media: q, addEventListener () {}, removeEventListener () {}, addListener () {}, removeListener () {} }),
    addEventListener () {}, removeEventListener () {},
    Image: class { constructor () { this.width = 0; this.height = 0 } set src (_v) { this.onload?.() } },
    Path2D: class { constructor () {} addPath () {} moveTo () {} lineTo () {} arc () {} rect () {} closePath () {} },
    OffscreenCanvas: class { constructor (w, h) { return makeCanvas(w, h) } },
    ImageData: class { constructor (w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4) } },
    DOMMatrix: class { constructor () {} },
    fetch: () => Promise.reject(new Error('network access is not available in the harness')),
    AudioContext: makeAudioStub(),
    URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    isSecureContext: true,
    crypto: { getRandomValues: a => a }
  }
  sandbox.webkitAudioContext = sandbox.AudioContext
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  sandbox.top = sandbox
  sandbox.parent = sandbox

  const ctx = vm.createContext(sandbox)

  for (const rel of present) {
    const code = readFileSync(resolve(ROOT, rel), 'utf8')
    try {
      vm.runInContext(code, ctx, { filename: rel, timeout: 30_000 })
    } catch (e) {
      errors.push({ file: rel, error: e })
      if (stopOnError) break
    }
  }

  return { OP: sandbox.OP || {}, order, missing, present, ctx: sandbox, errors, canvas }
}

/** Cached loader — suites share one bundle evaluation. */
let cached = null
export function game (opts) {
  if (!cached) cached = loadGame(opts)
  return cached
}
export function reload (opts) {
  cached = loadGame(opts)
  return cached
}

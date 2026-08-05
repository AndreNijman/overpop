// The terrain painter — js/render/sprites-terrain.js.
//
// Everything here works from test maps defined in this file rather than from the
// shipped roster, so this suite tests the PAINTER and stays green when a map is
// retuned.
//
// The painter draws into an offscreen canvas exactly once per
// (map, viewport, cleared-set), and the result is blitted every frame. That makes
// three properties load-bearing, and they are what this suite is mostly about:
//
//   · DETERMINISM. The cache is rebuilt on every resize. A single Math.random in
//     here and the grass moves when the player drags the window. Asserted by
//     painting the same map into two recorders and comparing the full call
//     sequence — arguments and style assignments included, not just method names.
//   · IT MUST NOT READ `sim`. The cache key is map.key + viewport + cleared and
//     nothing else, so anything read out of the sim goes stale silently.
//   · NO NaN. A NaN lineWidth draws nothing and never throws, so "it did not
//     throw" is not evidence. Every recorded numeric argument is checked.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../loadgame.mjs'

export const name = 'sprites-terrain'
export const needs = ['js/render/sprites-terrain.js', 'js/core/maps.js']

/* ---------- the recording context ----------
   Records method calls WITH arguments, style assignments (via real accessors, so
   `ctx.fillStyle = x` is captured), and gradient colour stops. A recorder that
   only logged method names would happily call a Math.random-driven painter
   deterministic. */

const COORD_OPS = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect',
  'fillRect', 'strokeRect', 'clearRect', 'translate', 'quadraticCurveTo', 'bezierCurveTo'])

const METHODS = ['save', 'restore', 'setTransform', 'resetTransform', 'transform',
  'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect',
  'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'drawImage',
  'fillText', 'strokeText', 'setLineDash']

const PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
  'globalAlpha', 'globalCompositeOperation', 'font', 'textAlign', 'textBaseline',
  'shadowBlur', 'shadowColor', 'filter', 'lineDashOffset', 'miterLimit']

function recorder () {
  const calls = []
  const ctx = { calls }
  let gid = 0

  function push (op, args) { calls.push({ op, args }) }

  for (const m of METHODS) {
    ctx[m] = function () { push(m, Array.prototype.slice.call(arguments)) }
  }
  ctx.getLineDash = () => []
  ctx.measureText = () => ({ width: 10 })
  ctx.getImageData = (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
  ctx.isPointInPath = () => false

  function gradient (kind, args) {
    const id = ++gid
    push(kind, args)
    return {
      _grad: id,
      addColorStop (pos, colour) { push('addColorStop', [id, pos, colour]) }
    }
  }
  ctx.createLinearGradient = function () { return gradient('createLinearGradient', Array.prototype.slice.call(arguments)) }
  ctx.createRadialGradient = function () { return gradient('createRadialGradient', Array.prototype.slice.call(arguments)) }
  ctx.createPattern = function () { push('createPattern', []); return { setTransform () {} } }

  const store = {}
  for (const p of PROPS) {
    store[p] = null
    Object.defineProperty(ctx, p, {
      enumerable: true,
      get () { return store[p] },
      set (v) {
        store[p] = v
        push('set:' + p, [v && v._grad ? 'gradient#' + v._grad : v])
      }
    })
  }
  return ctx
}

/** The exact sequence, as a comparable string. */
function key (ctx) { return JSON.stringify(ctx.calls) }

/** Index of the first differing call, or -1. */
function firstDiff (a, b) {
  const n = Math.min(a.calls.length, b.calls.length)
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a.calls[i]) !== JSON.stringify(b.calls[i])) return i
  }
  return a.calls.length === b.calls.length ? -1 : n
}

function diffDetail (a, b) {
  const i = firstDiff(a, b)
  if (i < 0) return ''
  return 'call ' + i + ' of ' + a.calls.length + '/' + b.calls.length + ': ' +
    JSON.stringify(a.calls[i]) + ' vs ' + JSON.stringify(b.calls[i])
}

/** Every colour string the painter assigned or put in a gradient. */
function colours (ctx) {
  const out = []
  for (const c of ctx.calls) {
    if (c.op === 'set:fillStyle' || c.op === 'set:strokeStyle') out.push(c.args[0])
    else if (c.op === 'addColorStop') out.push(c.args[2])
  }
  return out
}

function countColour (ctx, colour) {
  let n = 0
  for (const c of colours(ctx)) if (c === colour) n++
  return n
}

/** How many coordinate-bearing calls landed within `r` of (x,y). */
function nearCount (ctx, x, y, r) {
  const r2 = r * r
  let n = 0
  for (const c of ctx.calls) {
    if (!COORD_OPS.has(c.op)) continue
    const a = c.args
    if (typeof a[0] !== 'number' || typeof a[1] !== 'number') continue
    const dx = a[0] - x, dy = a[1] - y
    if (dx * dx + dy * dy <= r2) n++
  }
  return n
}

/** Every non-finite numeric argument, described. A NaN lineWidth draws nothing. */
function badNumbers (ctx) {
  const out = []
  for (let i = 0; i < ctx.calls.length; i++) {
    const c = ctx.calls[i]
    for (let k = 0; k < c.args.length; k++) {
      const v = c.args[k]
      if (typeof v === 'number' && !Number.isFinite(v)) out.push(c.op + ' arg ' + k + ' = ' + v)
      if (typeof v === 'string' && /NaN|undefined/.test(v)) out.push(c.op + ' arg ' + k + ' = ' + v)
    }
  }
  return out
}

function opCount (ctx, op) {
  let n = 0
  for (const c of ctx.calls) if (c.op === op) n++
  return n
}

function argsOf (ctx, op) {
  const out = []
  for (const c of ctx.calls) if (c.op === op) out.push(c.args)
  return out
}

/* ---------- test maps ---------- */

function base (over) {
  return Object.assign({
    key: 'terrain-test',
    name: 'Terrain Test',
    tier: 'beginner',
    blurb: 'A test map for the terrain painter.',
    paths: [{ points: [{ x: 0, y: 360 }, { x: 420, y: 360 }, { x: 420, y: 600 }, { x: 1280, y: 600 }], smooth: 3 }],
    trackWidth: 34
  }, over || {})
}

const WILD = {
  base: '#010203',
  grass: '#112233',
  grassAlt: '#223344',
  path: '#445566',
  pathEdge: '#556677',
  water: '#667788',
  rock: '#778899',
  accent: '#8899aa',
  fog: '#99aabb',
  entry: '#aabbcc',
  exit: '#bbccdd'
}


/** Strip block and line comments so a source-level prohibition check does not trip
    on the file's own prose describing that prohibition. */
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
}

export function run (t, OP) {
  const Maps = OP.Maps
  const Terrain = OP.Terrain

  function build (over) { return Maps.build(base(over)) }

  function paint (map, sim) {
    const ctx = recorder()
    Terrain.paint(ctx, map, sim)
    return ctx
  }

  /* ================= it exists and it is shaped right ================= */

  t.section('the painter is registered where the renderer looks for it')
  t.eq(typeof Terrain, 'object', 'OP.Terrain exists')
  t.eq(typeof Terrain.paint, 'function', 'OP.Terrain.paint is a function')
  t.eq(typeof Terrain.palette, 'function', 'and it exposes the resolved palette')

  /* ================= a variety of maps ================= */

  const maps = {
    plain: build({ key: 'terrain-plain' }),
    water: build({
      key: 'terrain-water',
      water: [{ x: 120, y: 80, w: 240, h: 150 }, { cx: 980, cy: 260, r: 90 }]
    }),
    blockers: build({
      key: 'terrain-blockers',
      blocked: [{ x: 700, y: 120, w: 120, h: 90 }, { cx: 200, cy: 660, r: 50 }],
      blockers: [{ x: 560, y: 200, w: 40, h: 130 }, { x: 900, y: 430, w: 90, h: 60 }]
    }),
    rocky: build({
      key: 'terrain-rocky',
      removable: [
        { x: 250, y: 140, r: 34, cost: 200, name: 'Mossy Boulder' },
        { x: 900, y: 200, r: 28, cost: 160, name: 'Split Stone' },
        { x: 660, y: 340, r: 40, cost: 320, name: 'Hollow Stump', blocksLOS: true }
      ]
    }),
    triple: build({
      key: 'terrain-triple',
      trackWidth: 28,
      paths: [
        { points: [{ x: 0, y: 120 }, { x: 640, y: 120 }, { x: 640, y: 330 }, { x: 1280, y: 330 }], smooth: 2 },
        { points: [{ x: 0, y: 420 }, { x: 1280, y: 420 }] },
        { points: [{ x: 300, y: 720 }, { x: 300, y: 560 }, { x: 1000, y: 560 }, { x: 1000, y: 720 }], smooth: 4 }
      ]
    }),
    everything: build({
      key: 'terrain-everything',
      paths: [
        { points: [{ x: 0, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 520 }, { x: 1280, y: 520 }], smooth: 3 },
        { points: [{ x: 640, y: 0 }, { x: 640, y: 130 }, { x: 1150, y: 130 }, { x: 1150, y: 720 }], smooth: 2 }
      ],
      trackWidth: 40,
      water: [{ x: 60, y: 420, w: 260, h: 200 }, { cx: 900, cy: 300, r: 70 }],
      blocked: [{ x: 380, y: 40, w: 140, h: 90 }],
      blockers: [{ x: 240, y: 250, w: 46, h: 120 }],
      removable: [
        { x: 800, y: 620, r: 30, cost: 250, name: 'Fallen Log' },
        { x: 300, y: 120, r: 26, cost: 180, name: 'Cairn', blocksLOS: true }
      ],
      palette: { grass: '#26401f', path: '#7a6244' }
    }),
    // No optional regions AT ALL, and no palette: the hand-authored minimum a
    // map author might hand the painter. Not a built map on purpose — build()
    // helpfully fills in empty arrays and a full palette, which is precisely the
    // safety net this case must survive without.
    bare: {
      key: 'terrain-bare',
      paths: [new OP.Track([{ x: 0, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 500 }, { x: 1280, y: 500 }])]
    },
    // What the harness fixtures hand the renderer: blockers explicitly null.
    fixture: { key: 'test', paths: [new OP.Track([{ x: 0, y: 360 }, { x: 1000, y: 360 }])], placement: null, blockers: null }
  }

  t.section('paint() runs on every map shape and draws a great deal')
  const painted = {}
  for (const k of Object.keys(maps)) {
    const ctx = recorder()
    t.noThrow(() => Terrain.paint(ctx, maps[k], null), 'paint() runs on the "' + k + '" map')
    painted[k] = ctx
    t.gt(ctx.calls.length, 300, '"' + k + '" issued ' + ctx.calls.length + ' draw calls')
  }
  t.gt(painted.everything.calls.length, painted.plain.calls.length,
    'a map with water, blockers and obstacles draws more than a plain one')

  t.section('NOT ONE non-finite number reaches the canvas')
  // The failure this catches: a missing trackWidth or palette producing NaN,
  // which sets lineWidth to NaN, which draws absolutely nothing and never throws.
  for (const k of Object.keys(maps)) {
    const bad = badNumbers(painted[k])
    t.eq(bad.length, 0, '"' + k + '" emitted no NaN/Infinity arguments',
      bad.slice(0, 4).join(' | '))
  }

  t.section('paint leaves the context balanced')
  for (const k of Object.keys(maps)) {
    t.eq(opCount(painted[k], 'save'), opCount(painted[k], 'restore'),
      '"' + k + '": every save was restored, so the caller\'s transform survives')
  }

  t.section('degenerate maps do not throw')
  t.noThrow(() => Terrain.paint(recorder(), { key: 'nopaths', paths: [] }, null), 'a map with no paths')
  t.noThrow(() => Terrain.paint(recorder(), { key: 'nopathsatall' }, null), 'a map with no paths array')
  t.noThrow(() => Terrain.paint(recorder(), maps.plain), 'paint() with the sim argument omitted entirely')
  t.noThrow(() => Terrain.paint(null, maps.plain, null), 'a null context is ignored rather than throwing')
  t.noThrow(() => Terrain.paint(recorder(), null, null), 'and so is a null map')

  /* ================= determinism ================= */

  t.section('DETERMINISM — the same map paints the same way twice')
  // This is the assertion that catches a stray Math.random. The recorder captures
  // arguments and style assignments, so a jittered tuft or a random alpha fails.
  for (const k of Object.keys(maps)) {
    const a = paint(maps[k], null)
    const b = paint(maps[k], null)
    t.eq(a.calls.length, b.calls.length, '"' + k + '": same number of calls both times')
    t.eq(firstDiff(a, b), -1, '"' + k + '": the ' + a.calls.length + '-call sequence is identical',
      diffDetail(a, b))
  }

  t.section('…and that comparison is capable of failing')
  const dA = paint(maps.plain, null)
  const dB = paint(maps.triple, null)
  t.neq(key(dA), key(dB), 'two different maps produce different call sequences')
  t.gt(dA.calls.length, 500, 'the compared sequences are long enough to be meaningful (' + dA.calls.length + ' calls)')
  // Scatter is seeded off the map key, so the same geometry under a different
  // name must look different — otherwise every map in the game shares one
  // grass layout.
  const sameGeomA = paint(build({ key: 'terrain-seed-a' }), null)
  const sameGeomB = paint(build({ key: 'terrain-seed-b' }), null)
  t.neq(key(sameGeomA), key(sameGeomB), 'identical geometry under a different key scatters differently')
  const sameGeomA2 = paint(build({ key: 'terrain-seed-a' }), null)
  t.eq(key(sameGeomA), key(sameGeomA2), 'but the same key is stable — the scatter is keyed, not random')

  t.section('the source contains no wall-clock or Math.random call at all')
  // Belt and braces to the behavioural check above: the two-recorder comparison
  // would pass a painter that called Math.random exactly zero times on these
  // particular maps but reached for it on some other branch.
  // Comments are stripped first: the file documents these prohibitions in prose,
  // and a suite that failed on its own documentation would only teach the next
  // author to delete the comment.
  const src = stripComments(readFileSync(resolve(ROOT, 'js/render/sprites-terrain.js'), 'utf8'))
  t.ok(src.includes('OP.Terrain = Terrain'), 'the comment stripper left the code intact')
  t.notOk(/Math\s*\.\s*random/.test(src), 'no Math.random — the cache is rebuilt on every resize')
  t.notOk(/Date\s*\.\s*now|performance\s*\.\s*now|new\s+Date/.test(src), 'no wall clock')
  t.notOk(/\brng\b/.test(src), 'and it never consumes simulation randomness')
  t.ok(/hash1|jitter/.test(src), 'variation comes from OP.M.hash1 / OP.M.jitter instead')

  /* ================= it must not read the sim ================= */

  t.section('the painter never reads sim state — the cache key does not include it')
  const simMap = build({ key: 'terrain-sim' })
  function mkSim (map, over) {
    return OP.Sim.create(Object.assign({
      map: map, seed: 'terrain', rules: { startCash: 500, startLives: 100 }
    }, over || {}))
  }
  const simA = mkSim(simMap)
  const simB = mkSim(simMap, { seed: 'other-seed' })
  simB.cash = 999999
  simB.lives = 3
  simB.tick = 5000
  simB.time = 83.5
  simB.roundIndex = 40
  const withA = paint(simMap, simA)
  const withB = paint(simMap, simB)
  const withNone = paint(simMap, null)
  t.eq(firstDiff(withA, withB), -1, 'two sims differing in cash, lives, tick and seed paint identically',
    diffDetail(withA, withB))
  t.eq(firstDiff(withA, withNone), -1, 'and passing no sim at all changes nothing either',
    diffDetail(withA, withNone))

  /* ================= no mutation ================= */

  t.section('paint mutates neither the map nor the sim')
  const mutMap = build({
    key: 'terrain-mutation',
    water: [{ x: 100, y: 100, w: 200, h: 100 }],
    blocked: [{ cx: 1000, cy: 150, r: 60 }],
    blockers: [{ x: 500, y: 120, w: 40, h: 100 }],
    removable: [{ x: 260, y: 500, r: 30, cost: 200, name: 'Mossy Boulder' }],
    palette: { grass: '#203a1c' }
  })
  const mutSim = mkSim(mutMap)
  OP.Balloons.spawn(mutSim, { tier: 'ceramic', path: 0, t: 40 })
  OP.Sim.run(mutSim, 30)

  const mapBefore = JSON.stringify(mutMap)
  const rngBefore = [mutSim.rng.calls, mutSim.rng.a, mutSim.rng.b, mutSim.rng.c, mutSim.rng.d].join(',')
  const simBefore = JSON.stringify({
    tick: mutSim.tick, time: mutSim.time, cash: mutSim.cash, lives: mutSim.lives,
    balloons: mutSim.balloons.length, projectiles: mutSim.projectiles.length,
    towers: mutSim.towers.length, roundIndex: mutSim.roundIndex, over: mutSim.over,
    pops: mutSim.popEvents.length, leaks: mutSim.leakEvents.length,
    events: mutSim.events.length, stats: mutSim.stats
  })
  const checksumBefore = OP.Sim.checksum(mutSim)
  const paletteRef = mutMap.palette

  Terrain.paint(recorder(), mutMap, mutSim)

  t.eq(JSON.stringify(mutMap), mapBefore, 'the map is byte-identical afterwards')
  t.eq(mutMap.palette, paletteRef, 'and the palette object was not replaced')
  t.eq(JSON.stringify({
    tick: mutSim.tick, time: mutSim.time, cash: mutSim.cash, lives: mutSim.lives,
    balloons: mutSim.balloons.length, projectiles: mutSim.projectiles.length,
    towers: mutSim.towers.length, roundIndex: mutSim.roundIndex, over: mutSim.over,
    pops: mutSim.popEvents.length, leaks: mutSim.leakEvents.length,
    events: mutSim.events.length, stats: mutSim.stats
  }), simBefore, 'the sim is unchanged')
  t.eq(OP.Sim.checksum(mutSim), checksumBefore, 'the determinism checksum is unchanged')
  t.eq([mutSim.rng.calls, mutSim.rng.a, mutSim.rng.b, mutSim.rng.c, mutSim.rng.d].join(','), rngBefore,
    'and sim.rng was not advanced by a single draw — render randomness never comes from there')

  // The mutation snapshot only proves anything if it can see a change.
  const canary = JSON.stringify(mutMap)
  mutMap.cleared.push(0)
  t.neq(JSON.stringify(mutMap), canary, 'the map snapshot is sensitive enough to notice a change')
  mutMap.cleared.length = 0

  /* ================= the palette ================= */

  t.section('a missing palette still produces a deliberate result')
  const barePal = Terrain.palette(maps.bare)
  t.eq(typeof barePal.grass, 'string', 'palette() fills in a default ground colour')
  t.ok(Object.keys(Terrain.DEFAULT_PALETTE).every(k => typeof barePal[k] === 'string' && barePal[k].length > 0),
    'every key the painter reads has a non-empty default')
  const bareColours = colours(painted.bare)
  t.gt(bareColours.length, 12, 'the palette-less map still assigned ' + bareColours.length + ' colours')
  t.eq(bareColours.filter(c => typeof c !== 'string' || !c.length).length, 0,
    'none of them is empty or a non-string')
  t.gt(new Set(bareColours).size, 8, 'and they are genuinely varied (' + new Set(bareColours).size + ' distinct)')
  t.ok(bareColours.includes(Terrain.DEFAULT_PALETTE.grass), 'the default ground colour was actually used')
  t.ok(bareColours.includes(Terrain.DEFAULT_PALETTE.path), 'and the default road colour')

  t.section('every palette key a map may author reaches the canvas')
  const wild = build({
    key: 'terrain-wild',
    water: [{ x: 100, y: 60, w: 200, h: 120 }],
    blocked: [{ x: 760, y: 90, w: 120, h: 90 }],
    blockers: [{ x: 560, y: 120, w: 40, h: 110 }],
    removable: [{ x: 250, y: 470, r: 30, cost: 200, name: 'Mossy Boulder' }],
    palette: WILD
  })
  const wildCtx = paint(wild, null)
  for (const k of Object.keys(WILD)) {
    t.ok(countColour(wildCtx, WILD[k]) > 0, 'palette.' + k + ' (' + WILD[k] + ') was used verbatim')
  }
  t.notOk(colours(painted.plain).includes(WILD.grass), 'a map that did not author it does not get it')

  t.section('the road is visibly a different colour from buildable ground')
  // The gameplay affordance: you may not build on the road, so it must not look
  // like ground. Distinct hint colours must both survive to the canvas.
  const contrast = build({ key: 'terrain-contrast', palette: { grass: '#101010', grassAlt: '#181818', path: '#efefef', pathEdge: '#c0c0c0' } })
  const cCtx = paint(contrast, null)
  t.ok(countColour(cCtx, '#101010') > 0, 'the ground colour is on the canvas')
  t.ok(countColour(cCtx, '#efefef') > 0, 'so is the road colour')
  t.ok(countColour(cCtx, '#c0c0c0') > 0, 'and the road gets its own edge, so it reads as a track and not a stripe')

  t.section('water is only painted where a map declares it')
  t.ok(countColour(paint(build({ key: 'terrain-wet2', water: [{ x: 200, y: 200, w: 100, h: 100 }], palette: { water: '#0000ff' } }), null), '#0000ff') > 0,
    'a declared water region paints in the water colour')
  t.eq(countColour(paint(build({ key: 'terrain-dry2', palette: { water: '#0000ff' } }), null), '#0000ff'), 0,
    'a dry map paints no water at all')

  /* ================= the path reads as a path ================= */

  t.section('the path is walked with track.sample() and drawn over its whole length')
  const straight = build({
    key: 'terrain-straight',
    paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }] }],
    trackWidth: 34
  })
  const sCtx = paint(straight, null)
  const track = straight.paths[0]
  for (const frac of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const p = track.posAt(track.length * frac)
    t.gt(nearCount(sCtx, p.x, p.y, 14), 0, 'the road was drawn at ' + Math.round(frac * 100) + '% along the track')
  }
  t.gt(opCount(sCtx, 'stroke'), 5, 'the road is built from several stroked passes, not one flat line')

  t.section('the painted road is narrower than the unbuildable margin')
  // trackWidth is authored to cover the road PLUS a tower radius, so a player who
  // aims at bare ground beside the paint must not be refused.
  const wideMargin = build({ key: 'terrain-margin', trackWidth: 60, paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }] }] })
  const wCtx = paint(wideMargin, null)
  const widths = argsOf(wCtx, 'set:lineWidth').map(a => a[0])
  t.gt(Math.max(...widths), 40, 'a 60-unit margin paints a substantial road (widest stroke ' + Math.max(...widths) + ')')
  t.lt(Math.max(...widths), 60 * 2, 'but never as wide as the full 120-unit unbuildable corridor')

  /* ================= entry and exit markers ================= */

  t.section('every path gets an entry marker and an exit marker')
  // The painter's own invariant: ctx.translate is used only by the markers, and
  // the raw palette.entry / palette.exit strings only inside them. So the marker
  // colour count is exactly proportional to the number of paths.
  const mk = c => build({ key: 'terrain-mk-' + c.paths.length, paths: c.paths, trackWidth: 30, palette: { entry: '#00ff88', exit: '#ff00cc' } })
  const one = paint(mk({ paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }] }] }), null)
  const three = paint(mk({
    paths: [
      { points: [{ x: 0, y: 140 }, { x: 1280, y: 140 }] },
      { points: [{ x: 0, y: 380 }, { x: 1280, y: 380 }] },
      { points: [{ x: 0, y: 620 }, { x: 1280, y: 620 }] }
    ]
  }), null)
  const entry1 = countColour(one, '#00ff88')
  const exit1 = countColour(one, '#ff00cc')
  t.gt(entry1, 0, 'the entry colour is used (' + entry1 + ' assignments per marker)')
  t.gt(exit1, 0, 'so is the exit colour (' + exit1 + ' per marker)')
  t.eq(countColour(three, '#00ff88'), entry1 * 3, 'three paths get exactly three entry markers')
  t.eq(countColour(three, '#ff00cc'), exit1 * 3, 'and exactly three exit markers')
  t.neq('#00ff88', '#ff00cc', 'entry and exit are different colours, so direction is readable')
  t.neq(entry1, exit1, 'and they are different shapes too — not one glyph in two tints')

  t.section('the markers sit exactly on each path\'s endpoints')
  const tri = maps.triple
  const spots = argsOf(painted.triple, 'translate').map(a => ({ x: a[0], y: a[1] }))
  t.eq(spots.length, tri.paths.length * 2, 'one marker transform per endpoint, three paths -> six')
  const found = (x, y) => spots.some(s => Math.abs(s.x - x) < 1e-6 && Math.abs(s.y - y) < 1e-6)
  for (let i = 0; i < tri.paths.length; i++) {
    const p = tri.paths[i]
    const a = p.posAt(0), b = p.posAt(p.length)
    t.ok(found(a.x, a.y), 'path ' + i + ' has a marker on its entry (' + a.x.toFixed(0) + ',' + a.y.toFixed(0) + ')')
    t.ok(found(b.x, b.y), 'path ' + i + ' has a marker on its exit (' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ')')
    t.notOk(found(p.posAt(p.length * 0.5).x, p.posAt(p.length * 0.5).y),
      'and nothing in the middle of path ' + i + ' — markers mark the ends, not the road')
  }

  /* ================= blocked terrain and LOS blockers ================= */

  t.section('a line-of-sight blocker is painted as something solid and tall')
  const noWall = build({ key: 'terrain-nowall' })
  const wall = build({ key: 'terrain-nowall', blockers: [{ x: 560, y: 300, w: 60, h: 120 }] })
  const nCtx = paint(noWall, null)
  const wCtx2 = paint(wall, null)
  t.gt(wCtx2.calls.length, nCtx.calls.length, 'declaring a blocker adds drawing')
  const inside = nearCount(wCtx2, 590, 360, 90) - nearCount(nCtx, 590, 360, 90)
  t.gt(inside, 8, 'and ' + inside + ' of the new calls are on the blocker itself')
  // "Tall" means it draws above its own top edge: a cast shadow below and a lit
  // cap above are what make a rectangle read as a rock rather than a floor tile.
  const aboveTop = nearCount(wCtx2, 590, 285, 22) - nearCount(nCtx, 590, 285, 22)
  t.gt(aboveTop, 0, 'including geometry above the rect, which is what makes it look tall')

  t.section('blocked terrain is painted, and separately from LOS blockers')
  const bare2 = build({ key: 'terrain-bl' })
  const withBlocked = build({ key: 'terrain-bl', blocked: [{ x: 700, y: 120, w: 120, h: 90 }] })
  const bl = paint(withBlocked, null)
  const noBl = paint(bare2, null)
  t.gt(nearCount(bl, 760, 165, 70) - nearCount(noBl, 760, 165, 70), 8, 'the blocked rect was filled and hatched')
  t.gt(opCount(bl, 'clip'), 0, 'the hatch is clipped to the region rather than bleeding across the map')
  t.eq(opCount(noBl, 'clip'), 0, 'and a map with no blocked terrain clips nothing')

  t.section('a circular blocked region works as well as a rect')
  const circleBlocked = paint(build({ key: 'terrain-bc', blocked: [{ cx: 400, cy: 200, r: 70 }] }), null)
  const circleBare = paint(build({ key: 'terrain-bc' }), null)
  t.gt(nearCount(circleBlocked, 400, 200, 75) - nearCount(circleBare, 400, 200, 75), 8,
    'the circle was painted too — regions are rect OR circle')

  t.section('water regions are painted, rect and circle alike')
  const wetMap = build({ key: 'terrain-wet', water: [{ x: 120, y: 80, w: 240, h: 150 }, { cx: 980, cy: 260, r: 90 }] })
  const dryMap = build({ key: 'terrain-wet' })
  const wet = paint(wetMap, null)
  const dry = paint(dryMap, null)
  // NOT a call-count increase: the painter correctly omits ground scatter inside a
  // pond, so water REPLACES detail rather than adding to it and the delta is
  // legitimately negative. What matters is that the region is painted at all, and
  // that it is painted differently from dry ground.
  for (const [label, x, y, r] of [['rectangular', 240, 155, 130], ['circular', 980, 260, 95]]) {
    const w = nearCount(wet, x, y, r)
    const d = nearCount(dry, x, y, r)
    t.gt(w, 0, `the ${label} pond region is painted (${w} calls)`)
    t.neq(w, d, `and differs from dry ground there (wet ${w} vs dry ${d})`)
  }

  /* ================= cleared obstacles ================= */

  t.section('an uncleared obstacle is drawn; a cleared one is not')
  // The comparison works because the painter is deterministic and its ground
  // scatter never reads `cleared`: everything else near the obstacle contributes
  // the same number of calls to both paints, so the difference is the boulder.
  const obsDef = base({
    key: 'terrain-cleared',
    paths: [{ points: [{ x: 0, y: 40 }, { x: 1280, y: 40 }] }],
    trackWidth: 30,
    removable: [
      { x: 300, y: 450, r: 40, cost: 200, name: 'Mossy Boulder' },
      { x: 900, y: 450, r: 40, cost: 240, name: 'Split Stone' }
    ]
  })
  const oNone = Maps.build(obsDef)
  const o0 = Maps.build(obsDef); o0.cleared = [0]
  const o1 = Maps.build(obsDef); o1.cleared = [1]
  const oBoth = Maps.build(obsDef); oBoth.cleared = [0, 1]
  const cNone = paint(oNone, null)
  const c0 = paint(o0, null)
  const c1 = paint(o1, null)
  const cBoth = paint(oBoth, null)

  const at = (ctx, i) => nearCount(ctx, obsDef.removable[i].x, obsDef.removable[i].y, obsDef.removable[i].r + 8)
  t.gt(at(cNone, 0), 10, 'obstacle 0 is drawn when uncleared (' + at(cNone, 0) + ' calls on it)')
  t.gt(at(cNone, 1), 10, 'obstacle 1 too')
  t.lt(at(c0, 0), at(cNone, 0), 'clearing obstacle 0 removes its drawing')
  t.eq(at(c0, 1), at(cNone, 1), 'and leaves obstacle 1 drawn exactly as before')
  t.eq(at(c1, 0), at(cNone, 0), 'clearing obstacle 1 leaves obstacle 0 alone')
  t.lt(at(c1, 1), at(cNone, 1), 'while removing its own')
  t.lt(at(cBoth, 0), at(cNone, 0), 'clearing both removes the first')
  t.lt(at(cBoth, 1), at(cNone, 1), 'and the second')
  t.lt(cBoth.calls.length, cNone.calls.length, 'so the whole paint is smaller with both cleared')
  t.eq(firstDiff(paint(o0, null), c0), -1, 'and a partially-cleared map still paints deterministically')

  t.section('the "clear me" affordance goes away with the obstacle')
  const ringMap = Maps.build(base({
    key: 'terrain-ring',
    removable: [{ x: 300, y: 450, r: 40, cost: 200, name: 'Mossy Boulder' }],
    palette: { accent: '#ff4400' }
  }))
  t.gt(countColour(paint(ringMap, null), '#ff4400'), 0, 'an uncleared obstacle is ringed in the accent colour')
  ringMap.cleared = [0]
  t.eq(countColour(paint(ringMap, null), '#ff4400'), 0, 'a cleared one has no ring, because it is not there')

  t.section('clearing through the real Maps.clearObstacle path also drops its LOS blocker')
  // This is how the game actually clears things: the obstacle-derived blocker
  // leaves map.blockers via syncBlockers, so the tall rock must vanish with the
  // boulder rather than being painted from map.blockersAll.
  const losMap = Maps.build(base({
    key: 'terrain-los',
    paths: [{ points: [{ x: 0, y: 40 }, { x: 1280, y: 40 }] }],
    trackWidth: 30,
    removable: [{ x: 640, y: 420, r: 44, cost: 100, name: 'Hollow Stump', blocksLOS: true }]
  }))
  const losSim = mkSim(losMap, { rules: { startCash: 5000, startLives: 100 } })
  t.eq(losMap.blockers.length, 1, 'the obstacle contributed an LOS blocker')
  const beforeClear = paint(losMap, null)
  t.gt(nearCount(beforeClear, 640, 420, 60), 10, 'the stump is painted while it stands')
  t.eq(Maps.clearObstacle(losSim, 0).ok, true, 'the player pays to clear it')
  t.eq(losMap.blockers.length, 0, 'and its LOS blocker went with it')
  const afterClear = paint(losMap, null)
  t.lt(nearCount(afterClear, 640, 420, 60), nearCount(beforeClear, 640, 420, 60),
    'so nothing is painted there any more — not the boulder and not a leftover tall rock')
  t.eq(badNumbers(afterClear).length, 0, 'and the cleared paint is still free of NaN')

  /* ================= the renderer's own call site ================= */

  t.section('the renderer\'s terrain cache drives this painter end to end')
  const view = OP.Camera.create()
  const canvas = { width: 0, height: 0, getContext: () => null }
  OP.Camera.resize(view, canvas, 1280, 720, 1)
  const cacheSim = mkSim(Maps.build(base({
    key: 'terrain-cache',
    removable: [{ x: 300, y: 460, r: 30, cost: 200, name: 'Mossy Boulder' }]
  })))
  const first = OP.Render.terrainCache(view, cacheSim)
  t.ok(first, 'terrainCache produced a canvas using OP.Terrain.paint')
  t.ok(OP.Render.terrainCache(view, cacheSim) === first, 'and caches it rather than repainting per frame')
  cacheSim.map.cleared = [0]
  t.notOk(OP.Render.terrainCache(view, cacheSim) === first, 'clearing an obstacle invalidates the cache')
}

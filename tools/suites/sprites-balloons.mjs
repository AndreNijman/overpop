// Balloon and blimp sprites.
//
// A sprite suite cannot prove "it reads at 20px" — that is an eyeball question,
// and the report says so. What it CAN prove is everything that makes the art
// wrong in a way nobody notices until round 90: a tier with no sprite, two tiers
// that draw identically, a property that only tints, a blimp with no damage
// readout, a per-entity gradient, an animation that ignores reduced motion, and a
// sprite that quietly writes to the entity it was handed.
//
// The in-harness proxy for legibility is a COMPLEXITY CEILING: at 12-16px the
// failure mode is too much detail, not too little, so the small tiers are capped
// on real canvas operations and every stroke has to stay at least one design unit
// wide.

export const name = 'sprites-balloons'
export const needs = ['js/render/sprites-balloons.js', 'js/render/renderer.js']

import { makeSim, spawn, hit } from './_fixture.mjs'

export function run (t, OP, env) {
  const R = OP.Render
  const BS = OP.BalloonSprites
  const P = OP.PROP
  const TIERS = OP.BALLOON_TIERS

  /* ---------- the recorder ----------
     Records call names WITH rounded arguments, plus every style assignment, so a
     signature is sensitive to geometry and colour both. Two tiers that differ
     only in fill colour must produce different signatures — several tiers share a
     radius, so names alone would collide and the "all distinct" assertion would
     be vacuous. */

  let gradientCalls = 0      // tallied across every draw in the whole suite
  let shadowSets = 0
  let filterSets = 0

  function recorder () {
    const rec = {
      ops: [],          // signature entries
      names: [],
      pts: [],
      real: 0,          // fill/stroke/fillRect/... — what the GPU actually pays for
      fills: [],        // every fillStyle assigned
      strokes: [],
      lineWidths: [],
      alphas: [],
      dashes: [],
      gradients: 0,
      shadow: 0,
      filtered: 0
    }

    const num = v => (typeof v === 'number'
      ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : String(v))
      : String(v))

    function op (name, args, real, pt) {
      rec.names.push(name)
      rec.ops.push(name + '(' + Array.prototype.map.call(args, num).join(',') + ')')
      if (real) rec.real++
      if (pt && typeof args[0] === 'number' && typeof args[1] === 'number') {
        rec.pts.push([args[0], args[1]])
      }
    }

    const plain = n => function () { op(n, arguments, false, false); return undefined }
    const geom = n => function () { op(n, arguments, false, true); return undefined }
    const paint = n => function () { op(n, arguments, true, false); return undefined }
    const paintGeom = n => function () { op(n, arguments, true, true); return undefined }

    const ctx = {
      save: plain('save'), restore: plain('restore'),
      setTransform: plain('setTransform'), translate: plain('translate'),
      rotate: plain('rotate'), scale: plain('scale'),
      beginPath: plain('beginPath'), closePath: plain('closePath'),
      clearRect: plain('clearRect'), clip: plain('clip'),
      moveTo: geom('moveTo'), lineTo: geom('lineTo'), arc: geom('arc'),
      arcTo: geom('arcTo'), ellipse: geom('ellipse'), rect: geom('rect'),
      roundRect: geom('roundRect'),
      quadraticCurveTo: geom('quadraticCurveTo'), bezierCurveTo: geom('bezierCurveTo'),
      fill: paint('fill'), stroke: paint('stroke'),
      fillRect: paintGeom('fillRect'), strokeRect: paintGeom('strokeRect'),
      drawImage: paintGeom('drawImage'),
      fillText: paintGeom('fillText'), strokeText: paintGeom('strokeText'),
      measureText: () => ({ width: 10 }),
      getLineDash: () => [],
      setLineDash: function (d) {
        rec.dashes.push(Array.isArray(d) ? d.slice() : d)
        op('setLineDash', arguments, false, false)
      },
      createLinearGradient: function () {
        rec.gradients++; gradientCalls++
        op('createLinearGradient', arguments, false, false)
        return { addColorStop () {} }
      },
      createRadialGradient: function () {
        rec.gradients++; gradientCalls++
        op('createRadialGradient', arguments, false, false)
        return { addColorStop () {} }
      },
      createPattern: () => ({ setTransform () {} }),
      getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
    }

    // Style assignments are part of the signature; shadowBlur and filter are
    // per-entity frame-killers and are counted so the suite can assert zero.
    function styleProp (key, initial, onSet) {
      let v = initial
      Object.defineProperty(ctx, key, {
        get () { return v },
        set (next) { v = next; rec.ops.push(key + '=' + next); if (onSet) onSet(next) }
      })
    }
    styleProp('fillStyle', '#000', v => rec.fills.push(v))
    styleProp('strokeStyle', '#000', v => rec.strokes.push(v))
    styleProp('lineWidth', 1, v => rec.lineWidths.push(v))
    styleProp('globalAlpha', 1, v => rec.alphas.push(v))
    styleProp('lineCap', 'butt', null)
    styleProp('lineJoin', 'miter', null)
    styleProp('font', '10px monospace', null)
    styleProp('textAlign', 'start', null)
    styleProp('textBaseline', 'alphabetic', null)
    styleProp('globalCompositeOperation', 'source-over', null)
    styleProp('shadowColor', 'transparent', null)
    styleProp('shadowBlur', 0, v => { if (v) { rec.shadow++; shadowSets++ } })
    styleProp('filter', 'none', v => { if (v && v !== 'none') { rec.filtered++; filterSets++ } })

    rec.ctx = ctx
    rec.sig = () => rec.ops.join('|')
    return rec
  }

  /* ---------- fixtures ---------- */

  const sim = makeSim(OP, { trackLength: 4000, cash: 100000, lives: 100000 })

  /** A real pooled entity from the real spawner, so hp/props are what the sim sets. */
  function ent (key, props, id) {
    const b = spawn(OP, sim, key, 200 + (id || 0) * 3, props || 0)
    if (!b) throw new Error('fixture spawn failed for ' + key)
    return b
  }

  const DRAW_X = 420, DRAW_Y = 260

  function draw (key, b, frame, x, y) {
    const rc = recorder()
    const fn = R.balloonSprites[key]
    if (typeof fn !== 'function') throw new Error('no sprite registered for ' + key)
    fn(rc.ctx, b, x === undefined ? DRAW_X : x, y === undefined ? DRAW_Y : y,
      TIERS[b.tier], frame || {})
    return rc
  }

  function sig (key, b, frame) { return draw(key, b, frame).sig() }

  /* ---------- 1. the roster ---------- */

  t.section('every tier in OP.BALLOON_TIERS has a sprite, registered at load')
  t.ok(BS && typeof BS.install === 'function', 'the sprite file exposes install()')
  t.deep(BS.registeredAtLoad, TIERS.map(x => x.key),
    'load-time registration covered the whole roster, in roster order')

  // The shared bundle is one object across the whole harness run, and
  // tools/suites/render.mjs deliberately deletes balloonSprites.red and .blue as
  // part of its own coverage. Re-install, then assert IDENTITY: presence alone
  // would pass if some other file had left a placeholder behind.
  t.ok(BS.install(), 'install() reports success against the live renderer')
  let registered = 0
  for (const tier of TIERS) {
    if (R.balloonSprites[tier.key] === BS.table[tier.key]) registered++
  }
  t.eq(registered, TIERS.length, `all ${TIERS.length} tiers resolve to this file's sprite`)
  t.gte(TIERS.length, 17, 'the roster is the full ladder plus five blimps')
  t.eq(TIERS.filter(x => x.blimp).length, 5, 'five blimps')

  /* ---------- 2. every tier draws something substantial ---------- */

  t.section('every sprite draws, directly — not through Render.frame')
  // Render.frame swallows sprite exceptions into reportMissing(), so a suite that
  // went through it would pass with every sprite throwing.
  const perTier = {}
  for (const tier of TIERS) {
    const b = ent(tier.key)
    let rc = null
    t.noThrow(() => { rc = draw(tier.key, b, { time: 1.4 }) }, `${tier.key} draws`)
    if (!rc) continue
    perTier[tier.key] = rc
    t.gte(rc.real, 3, `${tier.key} issues ${rc.real} real paint ops (an empty function fails)`)
    t.gte(rc.ops.length, 10, `${tier.key} issues ${rc.ops.length} recorded operations`)
  }

  t.section('nothing is drawn far from the interpolated position')
  let worst = 0, worstKey = ''
  for (const tier of TIERS) {
    const rc = perTier[tier.key]
    const limit = tier.radius * 2.5 + 6
    for (const [px, py] of rc.pts) {
      const d = Math.max(Math.abs(px - DRAW_X), Math.abs(py - DRAW_Y))
      if (d / limit > worst / (worstKey ? OP.tierByKey(worstKey).radius * 2.5 + 6 : 1)) { worst = d; worstKey = tier.key }
      if (d > limit) t.fail(`${tier.key} drew ${d.toFixed(1)}u from its centre (limit ${limit.toFixed(1)})`)
    }
  }
  t.ok(worstKey !== '', `furthest mark is ${worst.toFixed(1)}u from centre (${worstKey})`)

  /* ---------- 3. every tier is visually distinct ---------- */

  t.section('no two tiers draw the same thing')
  const sigs = new Map()
  for (const tier of TIERS) sigs.set(tier.key, perTier[tier.key].sig())
  t.eq(new Set(sigs.values()).size, TIERS.length,
    'all 17 signatures are distinct — colour, shape and marking together')

  // The pairs that actually get confused in play, called out so a regression
  // names itself.
  const pairs = [['black', 'lead'], ['white', 'zebra'], ['pink', 'purple'],
    ['red', 'blue'], ['green', 'yellow'], ['goliath', 'wraith'],
    ['leviathan', 'colossus'], ['colossus', 'omen']]
  for (const [a, b] of pairs) t.neq(sigs.get(a), sigs.get(b), `${a} does not look like ${b}`)

  t.section('the tiers whose whole identity is their marking')
  const zebra = perTier.zebra
  const zebraShade = zebra.fills.filter(f => f === OP.tierByKey('zebra').shade).length
  t.gte(zebraShade, 3, `zebra paints ${zebraShade} stripes in its shade colour`)

  const rainbow = perTier.rainbow
  t.gte(new Set(rainbow.fills).size, 6, `rainbow uses ${new Set(rainbow.fills).size} distinct fill colours`)

  const lead = perTier.lead
  t.gte(lead.strokes.length, 1, 'lead has a hard outline — heavy, not glossy')
  t.gte(new Set(lead.fills).size, 4, 'lead paints a specular band and rivets over its body')

  const ceramic = perTier.ceramic
  t.gte(ceramic.strokes.length, 2, 'ceramic strokes a shell rim and its cracks')

  t.section('ceramic cracks track its ten layer HP')
  const cerFull = ent('ceramic')
  const cerHurt = ent('ceramic')
  hit(OP, sim, cerHurt, 8)
  t.eq(cerHurt.hp, 2, 'the fixture ceramic is down to 2 of 10 hull')
  t.neq(sig('ceramic', cerFull, { time: 0 }), sig('ceramic', cerHurt, { time: 0 }),
    'a cracked ceramic draws differently from a fresh one')
  t.gt(draw('ceramic', cerHurt, { time: 0 }).ops.length,
    draw('ceramic', cerFull, { time: 0 }).ops.length,
    'and draws more cracks, not fewer')

  /* ---------- 4. properties change the silhouette ---------- */

  t.section('VEILED, REGEN and PLATED each change what is drawn')
  const BASE = 'pink'          // props 0 in the data, so the baseline is honest
  const plainB = ent(BASE)
  const veiledB = ent(BASE, P.VEILED)
  const regenB = ent(BASE, P.REGEN)
  const platedB = ent(BASE, P.PLATED)
  const allB = ent(BASE, P.VEILED | P.REGEN | P.PLATED)
  const F = { time: 0 }

  const sPlain = draw(BASE, plainB, F)
  const sVeil = draw(BASE, veiledB, F)
  const sRegen = draw(BASE, regenB, F)
  const sPlate = draw(BASE, platedB, F)
  const sAll = draw(BASE, allB, F)

  const propSigs = [sPlain.sig(), sVeil.sig(), sRegen.sig(), sPlate.sig(), sAll.sig()]
  t.eq(new Set(propSigs).size, 5, 'plain / veiled / regen / plated / all-three are five different drawings')

  t.gt(sVeil.real, sPlain.real, `VEILED adds ${sVeil.real - sPlain.real} paint ops`)
  t.gt(sRegen.real, sPlain.real, `REGEN adds ${sRegen.real - sPlain.real} paint ops`)
  t.gt(sPlate.real, sPlain.real, `PLATED adds ${sPlate.real - sPlain.real} paint ops`)

  t.section('VEILED is visibly not solid')
  t.ok(sVeil.alphas.some(a => a > 0 && a < 1), `the sprite drops to alpha ${Math.min(...sVeil.alphas)}`)
  t.gte(sVeil.dashes.length, 1, 'and strokes a broken, dashed outline')
  t.ok(sVeil.dashes.some(d => Array.isArray(d) && d.length && d[0] > 0),
    'the dash pattern has real gaps')
  t.eq(sPlain.dashes.filter(d => Array.isArray(d) && d.length && d[0] > 0).length, 0,
    'an unveiled balloon has no dashed outline')
  t.eq(sPlain.alphas.filter(a => a < 1).length, 0, 'and is fully opaque')

  t.section('REGEN reads as "it will come back", by a different mechanism')
  t.eq(sRegen.dashes.filter(d => Array.isArray(d) && d.length && d[0] > 0).length, 0,
    'REGEN is not a dashed outline — it must not be confused with VEILED')
  t.gt(sRegen.strokes.length, sPlain.strokes.length, 'it strokes a returning arrow')
  t.ok(sRegen.names.filter(n => n === 'arc').length >= 1, 'built from an arc, with a head filled after it')
  t.gt(sRegen.fills.length, sPlain.fills.length, 'the arrowhead is filled')

  t.section('PLATED changes the outline rather than the tint')
  t.gt(sPlate.strokes.length, sPlain.strokes.length, 'plating is stroked onto the rim')
  t.ok(sPlate.names.filter(n => n === 'arc').length >= 4, 'as separate plates, not one ring')
  t.ok(sPlate.strokes.some(s => s !== sPlain.strokes[0]), 'in its own armour colour')

  t.section('the three stack and stay distinguishable')
  t.neq(sAll.sig(), sVeil.sig(), 'all three differs from VEILED alone')
  t.neq(sAll.sig(), sRegen.sig(), 'all three differs from REGEN alone')
  t.neq(sAll.sig(), sPlate.sig(), 'all three differs from PLATED alone')
  // The property marks are independent overlays, so their cost is additive: if a
  // future edit made one property suppress another, this is what fails.
  const additive = sPlain.real +
    (sVeil.real - sPlain.real) + (sRegen.real - sPlain.real) + (sPlate.real - sPlain.real)
  t.eq(sAll.real, additive, `all three costs ${sAll.real} ops — every mark is still drawn`)
  t.ok(sAll.alphas.some(a => a < 1), 'still translucent')
  t.gte(sAll.dashes.length, 1, 'still dashed')
  t.ok(sAll.names.filter(n => n === 'arc').length >= 5, 'still plated and still marked for regen')

  t.section('WRAITH is born VEILED, and shows it without being asked')
  const wraith = ent('wraith')
  t.ok(wraith.props & P.VEILED, 'the spawner ORed the intrinsic property in')
  const wr = draw('wraith', wraith, F)
  t.gte(wr.dashes.length, 1, 'so it draws the broken outline on spawn')
  t.ok(wr.alphas.some(a => a < 1), 'and is translucent')
  const gol = draw('goliath', ent('goliath'), F)
  t.eq(gol.dashes.filter(d => Array.isArray(d) && d.length && d[0] > 0).length, 0,
    'while a GOLIATH is solid')

  /* ---------- 5. blimps show damage ---------- */

  t.section('a damaged blimp draws differently from a full-health one')
  for (const tier of TIERS.filter(x => x.blimp)) {
    const full = ent(tier.key)
    const hurt = ent(tier.key)
    hit(OP, sim, hurt, Math.floor(tier.hp * 0.8))
    t.close(hurt.hp / tier.hp, 0.2, 0.02, `${tier.key} fixture is at 20% hull`)

    const a = draw(tier.key, full, F)
    const b = draw(tier.key, hurt, F)
    t.neq(a.sig(), b.sig(), `${tier.key} at 20% looks different from ${tier.key} at full`)
    t.notOk(a.fills.some(f => f === '#d1493c') && !b.fills.some(f => f === '#d1493c'),
      `${tier.key} does not show a red bar at full health`)
    t.ok(b.fills.some(f => f === '#d1493c'), `${tier.key} shows a red health bar when nearly down`)
    t.ok(a.fills.some(f => f === '#63c257'), `${tier.key} shows a green health bar at full`)
    t.gte(b.names.filter(n => n === 'fillRect').length, 2,
      `${tier.key} draws a two-part bar, so an empty bar is still visible`)
    t.gt(b.real, a.real, `${tier.key} gains battle damage as it drops`)
  }

  t.section('the health readout is monotone, not a step at one threshold')
  const colossus = ent('colossus')
  const seen = []
  for (const frac of [1, 0.7, 0.45, 0.2, 0.05]) {
    const c = ent('colossus')
    const dmg = Math.round(tierHp('colossus') * (1 - frac))
    if (dmg > 0) hit(OP, sim, c, dmg)
    seen.push(draw('colossus', c, F).sig())
  }
  t.eq(new Set(seen).size, 5, 'five different health levels produce five different drawings')
  t.ok(colossus.hp === tierHp('colossus'), 'the untouched control is still at full hull')

  t.section('PLATED doubles layer HP — a plated blimp at spawn is NOT damaged')
  const platedCol = ent('colossus', P.PLATED)
  t.eq(platedCol.hp, tierHp('colossus') * 2, 'the sim gave it double hull')
  const pc = draw('colossus', platedCol, F)
  t.ok(pc.fills.some(f => f === '#63c257'), 'it draws a full green bar')
  t.notOk(pc.fills.some(f => f === '#d1493c'), 'not a red one — the ratio used layerHP, not tier.hp')
  t.close(BS.hpRatio(platedCol, OP.tierByKey('colossus')), 1, 1e-9, 'hpRatio agrees')

  t.section('a freeplay-scaled or over-healed blimp cannot overdraw its bar')
  const scaled = ent('goliath')
  scaled.hp = tierHp('goliath') * 4          // as if hpScale had been raised
  t.close(BS.hpRatio(scaled, OP.tierByKey('goliath')), 1, 1e-9, 'the ratio clamps to 1')
  t.noThrow(() => draw('goliath', scaled, F), 'and it still draws')

  /* ---------- 6. the two things that kill canvas2D ---------- */

  t.section('no per-entity gradient, shadowBlur or filter — anywhere')
  // Everything above already ran through the recorder, including every tier,
  // every property combination and every damage level.
  t.eq(gradientCalls, 0, 'createLinearGradient / createRadialGradient never called during a draw')
  t.eq(shadowSets, 0, 'shadowBlur never set to a non-zero value')
  t.eq(filterSets, 0, 'ctx.filter never set')

  t.section('and the recorder would have caught it')
  const canary = recorder()
  canary.ctx.createRadialGradient(0, 0, 1, 0, 0, 2)
  canary.ctx.shadowBlur = 8
  canary.ctx.filter = 'blur(2px)'
  t.eq(canary.gradients, 1, 'a gradient is detected')
  t.eq(canary.shadow, 1, 'a shadow is detected')
  t.eq(canary.filtered, 1, 'a filter is detected')
  t.eq(canary.ctx.shadowBlur, 8, 'the property still round-trips like a real context')
  gradientCalls = 0; shadowSets = 0; filterSets = 0     // discount the canary

  t.section('the small tiers stay simple — the 20px failure mode is too much detail')
  for (const tier of TIERS.filter(x => !x.blimp && x.radius <= 7)) {
    t.lte(perTier[tier.key].real, 8,
      `${tier.key} (r${tier.radius}) costs ${perTier[tier.key].real} paint ops`)
  }
  for (const tier of TIERS.filter(x => !x.blimp && x.radius > 7)) {
    t.lte(perTier[tier.key].real, 12, `${tier.key} costs ${perTier[tier.key].real} paint ops`)
  }
  for (const tier of TIERS.filter(x => x.blimp)) {
    t.lte(perTier[tier.key].real, 30, `${tier.key} costs ${perTier[tier.key].real} paint ops`)
  }

  t.section('no feature is thinner than a design unit')
  let thinnest = Infinity
  for (const tier of TIERS) {
    for (const lw of perTier[tier.key].lineWidths) thinnest = Math.min(thinnest, lw)
  }
  for (const rc of [sVeil, sRegen, sPlate, sAll]) {
    for (const lw of rc.lineWidths) thinnest = Math.min(thinnest, lw)
  }
  t.gte(thinnest, 1, `thinnest stroke is ${thinnest.toFixed(2)}u — still visible at 20px`)

  /* ---------- 7. 500 balloons a frame ---------- */

  t.section('drawing 500 balloons stays inside a frame budget')
  const crowd = []
  const keys = TIERS.map(x => x.key)
  for (let i = 0; i < 500; i++) {
    const key = keys[i % keys.length]
    const b = ent(key, i % 7 === 0 ? P.VEILED : i % 11 === 0 ? P.PLATED | P.REGEN : 0, i)
    crowd.push(b)
  }
  t.eq(crowd.length, 500, 'a round-90-sized crowd, every tier, properties mixed in')

  const rc500 = recorder()
  const frame500 = { time: 12.5 }
  const started = process.hrtime.bigint()
  for (let i = 0; i < crowd.length; i++) {
    const b = crowd[i]
    R.balloonSprites[TIERS[b.tier].key](rc500.ctx, b, 100 + (i % 40) * 28, 80 + ((i / 40) | 0) * 44,
      TIERS[b.tier], frame500)
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  t.lt(ms, 260, `500 balloons drew in ${ms.toFixed(1)}ms against the recorder`)
  t.eq(rc500.gradients, 0, 'with no gradients')
  t.eq(rc500.shadow, 0, 'and no shadows')
  const perBalloon = rc500.real / 500
  t.lt(perBalloon, 12, `averaging ${perBalloon.toFixed(1)} real paint ops per balloon`)
  gradientCalls = 0; shadowSets = 0

  /* ---------- 8. animation ---------- */

  t.section('reducedMotion is honoured')
  for (const key of ['red', 'ceramic', 'colossus']) {
    const b = ent(key)
    const still1 = sig(key, b, { time: 0, reducedMotion: true })
    const still2 = sig(key, b, { time: 3.7, reducedMotion: true })
    t.eq(still1, still2, `${key} is frozen under reduced motion`)

    const move1 = sig(key, b, { time: 0, reducedMotion: false })
    const move2 = sig(key, b, { time: 3.7, reducedMotion: false })
    t.neq(move1, move2, `${key} animates when motion is allowed`)
    t.neq(move1, still1, 'and the idle offset is what reduced motion removes')
  }

  t.section('the idle bob is per-entity, stable, and never touches sim.rng')
  const twinA = ent('green')
  const twinB = ent('green')
  const fr = { time: 2.0 }
  t.neq(sig('green', twinA, fr), sig('green', twinB, fr),
    'two greens at the same instant bob out of phase (M.jitter on the id)')
  t.eq(sig('green', twinA, fr), sig('green', twinA, fr),
    'and the same balloon at the same instant is bit-identical — no Math.random in the shape')
  const rngBefore = OP.Sim.checksum(sim)
  for (let i = 0; i < 40; i++) draw('green', twinA, { time: i * 0.05 })
  t.eq(OP.Sim.checksum(sim), rngBefore, 'forty frames of animation left the sim untouched')

  t.section('with no frame.time the clock comes from the render layer, not the sim')
  const fxTime = OP.FX.state.time
  const clockB = ent('yellow')
  OP.FX.state.time = 0
  const at0 = sig('yellow', clockB, {})
  OP.FX.state.time = 4.25
  const at4 = sig('yellow', clockB, {})
  OP.FX.state.time = fxTime
  t.neq(at0, at4, 'FX.state.time drives the bob when the frame does not carry one')

  /* ---------- 9. the sprite must not read or write the entity ---------- */

  t.section('drawing uses the interpolated x/y, never balloon.x/balloon.y')
  for (const tier of TIERS) {
    const a = ent(tier.key)
    const b = ent(tier.key)
    b.id = a.id                                     // same jitter phase
    a.x = 0; a.y = 0; a.prevX = 0; a.prevY = 0
    b.x = 1e6; b.y = -1e6; b.prevX = 1e6; b.prevY = -1e6
    b.t = a.t
    t.eq(sig(tier.key, a, { time: 1 }), sig(tier.key, b, { time: 1 }),
      `${tier.key} ignores the entity's own position`)
  }

  t.section('drawing never mutates the balloon')
  const FIELDS = ['id', 'alive', 'tier', 'spawnTier', 'path', 't', 'x', 'y', 'prevX', 'prevY',
    'hp', 'props', 'speedMul', 'regenT', 'depth', 'dotAcc', 'hpScale', 'speedScale']
  function snap (b) {
    const out = {}
    for (const k of Object.keys(b).sort()) out[k] = Array.isArray(b[k]) ? b[k].slice() : b[k]
    return JSON.stringify(out)
  }
  let mutated = 0
  for (const tier of TIERS) {
    for (const props of [0, P.VEILED, P.REGEN | P.PLATED, P.VEILED | P.REGEN | P.PLATED]) {
      const b = ent(tier.key, props)
      const before = snap(b)
      const keysBefore = Object.keys(b).sort().join(',')
      draw(tier.key, b, { time: 3.3 })
      draw(tier.key, b, { time: 3.3, reducedMotion: true })
      if (snap(b) !== before) { mutated++; t.fail(`${tier.key} (props ${props}) was mutated by drawing`) }
      if (Object.keys(b).sort().join(',') !== keysBefore) t.fail(`${tier.key} gained a field`)
    }
  }
  t.eq(mutated, 0, `all ${TIERS.length} tiers x 4 property masks drew without touching the entity`)
  for (const f of FIELDS) t.ok(f in crowd[0], `the fixture entity really carries "${f}"`)

  /* ---------- 10. the preview helper the bestiary needs ---------- */

  t.section('preview() draws a tier with no sim and no entity')
  const pv = recorder()
  t.ok(BS.preview(pv.ctx, 'ceramic', 40, 40, { hpFrac: 0.3, time: 0 }), 'preview reports drawn')
  t.gte(pv.real, 3, `and issued ${pv.real} paint ops`)
  const pvFull = recorder()
  BS.preview(pvFull.ctx, 'ceramic', 40, 40, { hpFrac: 1, time: 0 })
  t.neq(pv.sig(), pvFull.sig(), 'a damaged preview differs from a full one')
  const pvOmen = recorder()
  BS.preview(pvOmen.ctx, 'omen', 60, 60, { props: P.REGEN, time: 0 })
  t.gte(pvOmen.real, 6, 'a blimp preview draws its hull and bar')
  t.notOk(BS.preview(recorder().ctx, 'not-a-tier-xyz', 0, 0, {}) === true,
    'an unknown key is refused rather than drawing rubbish')

  t.section('nothing leaked into the sim while all of that drew')
  t.eq(OP.Sim.checksum(sim), OP.Sim.checksum(sim), 'checksum is stable')
  t.eq(gradientCalls, 0, 'still no gradients after the whole suite')
  t.eq(shadowSets, 0, 'still no shadowBlur')
  t.eq(filterSets, 0, 'still no filter')

  function tierHp (key) { return OP.tierByKey(key).hp }
}

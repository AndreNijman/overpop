;(function (OP) {
  'use strict'

  const M = OP.M

  /* The frame.

     Two rules, and the whole render layer hangs off them:

     1. RENDERING NEVER MUTATES SIM STATE. Not a style preference — the harness
        runs the simulation with no renderer at all and the determinism checksums
        must be identical either way. Anything a renderer needs to remember lives
        in `view`, never on a sim entity.

     2. The sim is never advanced to draw a frame. Smooth motion comes from
        interpolating between the last two ticks with `Sim.alpha(sim)`.

     Sprites are supplied by the js/render/sprites-*.js files through registries.
     A missing sprite draws a loud magenta placeholder and is reported once, rather
     than silently drawing nothing — an invisible balloon is a far worse bug than
     an ugly one, and it is the failure mode this arrangement is designed to catch. */

  const Render = {}

  /* ---------- sprite registries ----------
     Filled by the sprite files. Keys are balloon tier keys, tower keys, and
     projectile kinds. */

  Render.balloonSprites = {}    // tierKey -> fn(ctx, b, ctx2)
  Render.towerSprites = {}      // towerKey -> fn(ctx, tower, ctx2)
  Render.projSprites = {}       // kind    -> fn(ctx, p, ctx2)
  Render.fxDrawers = {}         // fx kind -> fn(ctx, fx, ctx2)

  Render.registerBalloon = function (key, fn) { Render.balloonSprites[key] = fn }
  Render.registerTower = function (key, fn) { Render.towerSprites[key] = fn }
  Render.registerProjectile = function (key, fn) { Render.projSprites[key] = fn }
  Render.registerFX = function (key, fn) { Render.fxDrawers[key] = fn }

  // Every missing sprite is reported exactly once, with a count, so a console is
  // useful rather than a wall of the same line.
  const missing = {}
  function reportMissing (kind, key) {
    const id = kind + ':' + key
    if (missing[id]) { missing[id]++; return }
    missing[id] = 1
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('OVERPOP: no ' + kind + ' sprite for "' + key + '" — drawing a placeholder')
    }
  }
  Render.missingSprites = function () { return Object.assign({}, missing) }

  function placeholder (ctx, x, y, r, label) {
    ctx.save()
    ctx.fillStyle = '#ff00aa'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(4, r), 0, M.TAU)
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  /* ---------- extra layers ----------
     The UI registers itself here rather than the renderer knowing about the UI. */

  const layers = []

  /**
   * @param {string} name
   * @param {number} order  lower draws earlier. Terrain is 0, entities 100-400,
   *                        HUD 1000+.
   * @param {function} fn   (ctx, sim, view, frame) => void
   */
  Render.registerLayer = function (name, order, fn) {
    Render.unregisterLayer(name)
    layers.push({ name: name, order: order, fn: fn })
    layers.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order
      return a.name < b.name ? -1 : 1     // stable, never insertion order
    })
    return name
  }

  Render.unregisterLayer = function (name) {
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].name === name) { layers.splice(i, 1); return true }
    }
    return false
  }

  Render.layerNames = function () { return layers.map(function (l) { return l.name }) }

  Render.LAYER = {
    TERRAIN: 0, TRACK: 10, DECAL: 20,
    TOWER_BASE: 100, PROJECTILE: 200, BALLOON: 300, TOWER: 350,
    FX: 400, OVERLAY: 500, HUD: 1000, MODAL: 2000
  }

  /* ---------- terrain cache ----------
     The map is static for a whole game. Repainting a few hundred polyline
     segments and every rock every frame is the single easiest thing to get wrong
     here, so it is painted once into an offscreen canvas and blitted. */

  Render.terrainCache = function (view, sim) {
    // The board fit is baked into the bitmap rather than applied at blit time, so
    // the terrain is rendered once at its true on-screen size instead of being
    // resampled from a larger one every frame. It therefore has to be part of the
    // key: a stale full-size bitmap would blit at the wrong scale.
    const bs = OP.Camera.board().scale
    const es = view.scale * bs
    const key = sim.map.key + '@' + view.cw + 'x' + view.ch + '#' + bs +
      '|' + (sim.map.cleared ? sim.map.cleared.join(',') : '')
    if (view._terrainKey === key && view._terrain) return view._terrain

    const w = Math.max(1, Math.round(OP.FIELD_W * es))
    const h = Math.max(1, Math.round(OP.FIELD_H * es))

    let cv
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(w, h)
    else if (typeof document !== 'undefined') {
      cv = document.createElement('canvas')
      cv.width = w; cv.height = h
    } else return null

    const c2 = cv.getContext('2d')
    if (!c2) return null
    c2.setTransform(es, 0, 0, es, 0, 0)

    if (OP.Terrain && OP.Terrain.paint) OP.Terrain.paint(c2, sim.map, sim)
    else fallbackTerrain(c2, sim.map)

    view._terrain = cv
    view._terrainKey = key
    return cv
  }

  /** Used until js/render/sprites-terrain.js is present. Deliberately plain. */
  function fallbackTerrain (ctx, map) {
    ctx.fillStyle = '#16211a'
    ctx.fillRect(0, 0, OP.FIELD_W, OP.FIELD_H)
    ctx.strokeStyle = '#3c3227'
    ctx.lineWidth = (map.trackWidth || 20) * 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < map.paths.length; i++) {
      const pts = map.paths[i].sample(14)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
      ctx.stroke()
    }
  }

  Render.invalidateTerrain = function (view) { view._terrain = null; view._terrainKey = null }

  /* ---------- the frame ---------- */

  /**
   * Draw one frame. Never mutates `sim`.
   *
   * @param {object} sim
   * @param {CanvasRenderingContext2D} ctx  the visible canvas context
   * @param {object} view                   from OP.Camera.create()
   * @param {object} [frame]                { reducedMotion, showTrails, selected, hover, placing }
   */
  Render.frame = function (sim, ctx, view, frame) {
    frame = frame || {}
    const alpha = OP.Sim.alpha(sim)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#070a08'
    ctx.fillRect(0, 0, view.cw, view.ch)

    /* Board content is drawn under the BOARD transform so the whole map fits
       beside the sidebar; chrome is drawn under the plain field transform. One
       seam, at LAYER.HUD. */
    const b = OP.Camera.applyBoard(view, ctx)
    ctx.beginPath()
    ctx.rect(0, 0, OP.FIELD_W, OP.FIELD_H)
    ctx.clip()

    // terrain
    const terrain = Render.terrainCache(view, sim)
    if (terrain) {
      ctx.save()
      // The cache is a field-sized bitmap at view.scale, so it is blitted under
      // the raw device transform and offset by the board translate — which must
      // itself be in device pixels, hence the extra view.scale.
      ctx.setTransform(1, 0, 0, 1,
        view.ox + (view.shakeX + b.ox) * view.scale,
        view.oy + (view.shakeY + b.oy) * view.scale)
      ctx.drawImage(terrain, 0, 0)
      ctx.restore()
    } else {
      fallbackTerrain(ctx, sim.map)
    }

    const before = Render.LAYER.TOWER_BASE
    drawLayers(ctx, sim, view, frame, -Infinity, before)

    drawTowerBases(ctx, sim, view, frame)
    drawProjectiles(ctx, sim, view, frame, alpha)
    drawBalloons(ctx, sim, view, frame, alpha)
    drawTowers(ctx, sim, view, frame, alpha)
    drawFX(ctx, sim, view, frame)

    drawLayers(ctx, sim, view, frame, before, Render.LAYER.HUD)
    ctx.restore()

    // Chrome: field space, unscaled by the board fit.
    OP.Camera.apply(view, ctx)
    drawLayers(ctx, sim, view, frame, Render.LAYER.HUD, Infinity)
    ctx.restore()
  }

  function drawLayers (ctx, sim, view, frame, from, to) {
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (l.order < from || l.order >= to) continue
      ctx.save()
      try { l.fn(ctx, sim, view, frame) } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('OVERPOP: layer "' + l.name + '" threw', e)
        }
        Render.unregisterLayer(l.name)   // a throwing layer must not kill every frame
        i--
      }
      ctx.restore()
    }
  }

  /* ---------- entity passes ---------- */

  function drawTowerBases (ctx, sim, view, frame) {
    // Range circle for the selected or hovered tower, and the placement preview.
    const highlight = frame.selected || frame.hover
    if (highlight && highlight.s) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(highlight.x, highlight.y, highlight.s.range, 0, M.TAU)
      ctx.fillStyle = 'rgba(111, 174, 127, 0.10)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(111, 174, 127, 0.55)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    }
    if (frame.placing) {
      const p = frame.placing
      ctx.save()
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.range || 100, 0, M.TAU)
      ctx.fillStyle = p.ok ? 'rgba(111, 174, 127, 0.12)' : 'rgba(220, 80, 70, 0.12)'
      ctx.fill()
      ctx.strokeStyle = p.ok ? 'rgba(111, 174, 127, 0.7)' : 'rgba(220, 80, 70, 0.8)'
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.footprint || 14, 0, M.TAU)
      ctx.fillStyle = p.ok ? 'rgba(111, 174, 127, 0.35)' : 'rgba(220, 80, 70, 0.35)'
      ctx.fill()
      ctx.restore()
    }
  }

  function drawProjectiles (ctx, sim, view, frame, alpha) {
    const list = sim.projectiles
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!p.alive) continue
      const x = OP.Camera.lerpX(p, alpha)
      const y = OP.Camera.lerpY(p, alpha)
      const fn = Render.projSprites[p.kind]
      if (fn) {
        ctx.save()
        try { fn(ctx, p, x, y, frame) } catch (e) { reportMissing('projectile', p.kind + ' (threw)') }
        ctx.restore()
      } else {
        // Not a placeholder: a declared kind with no drawer yet gets its registry
        // hint, which is enough to be visible and correctly coloured.
        const spec = OP.PROJ_KINDS[p.kind]
        if (!spec) reportMissing('projectile', p.kind)
        ctx.save()
        ctx.fillStyle = spec ? spec.tint : '#ff00aa'
        ctx.beginPath()
        ctx.arc(x, y, spec ? spec.size : 4, 0, M.TAU)
        ctx.fill()
        ctx.restore()
      }
    }
  }

  function drawBalloons (ctx, sim, view, frame, alpha) {
    const list = sim.balloons
    // Back to front along the track, so the leader overlaps what is behind it.
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue
      const tier = OP.BALLOON_TIERS[b.tier]
      const x = OP.Camera.lerpX(b, alpha)
      const y = OP.Camera.lerpY(b, alpha)
      const fn = Render.balloonSprites[tier.key]
      if (fn) {
        ctx.save()
        try { fn(ctx, b, x, y, tier, frame) } catch (e) { reportMissing('balloon', tier.key + ' (threw)') }
        ctx.restore()
      } else {
        reportMissing('balloon', tier.key)
        ctx.save()
        ctx.fillStyle = tier.colour
        ctx.beginPath()
        ctx.arc(x, y, tier.radius, 0, M.TAU)
        ctx.fill()
        ctx.strokeStyle = tier.shade
        ctx.lineWidth = 1.5
        ctx.stroke()
        if (b.props & OP.PROP.VEILED) { ctx.globalAlpha = 0.45; ctx.fill() }
        ctx.restore()
      }
    }
  }

  function drawTowers (ctx, sim, view, frame, alpha) {
    const list = sim.towers
    for (let i = 0; i < list.length; i++) {
      const tower = list[i]
      const fn = Render.towerSprites[tower.key]
      if (fn) {
        ctx.save()
        try { fn(ctx, tower, tower.x, tower.y, frame) } catch (e) { reportMissing('tower', tower.key + ' (threw)') }
        ctx.restore()
      } else {
        reportMissing('tower', tower.key)
        placeholder(ctx, tower.x, tower.y, tower.def.footprint * 0.8, tower.key)
      }
    }
  }

  function drawFX (ctx, sim, view, frame) {
    if (OP.FX && OP.FX.draw) {
      try { OP.FX.draw(ctx, sim, view, frame) } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: FX threw', e)
      }
    }
  }

  /* ---------- diagnostics ---------- */

  /** A one-line summary for the smoke test and the debug overlay. */
  Render.stats = function (sim) {
    return {
      balloons: sim.balloons.length,
      projectiles: sim.projectiles.length,
      towers: sim.towers.length,
      layers: layers.length,
      missingSprites: Object.keys(missing).length
    }
  }

  OP.Render = Render
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

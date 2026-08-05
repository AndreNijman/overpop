;(function (OP) {
  'use strict'

  const M = OP.M

  /* The view transform.

     The renderer always works in the fixed 1280x720 design space. The camera's
     only job is to map that onto whatever the canvas actually is, and to convert
     pointer coordinates back — so no drawing code and no input code ever has to
     know the viewport size.

     Letterboxed, never stretched: aspect distortion on a game whose whole read is
     "is that balloon inside that circle" would be a real problem, not a cosmetic
     one. */

  const Camera = {}

  Camera.create = function () {
    return {
      // canvas backing-store size
      cw: OP.FIELD_W,
      ch: OP.FIELD_H,
      dpr: 1,
      // design-space -> canvas
      scale: 1,
      ox: 0,
      oy: 0,
      // optional world offset, for screen shake and the map pan on wide screens
      shakeX: 0, shakeY: 0, shakeT: 0, shakeMag: 0
    }
  }

  /**
   * Size the backing store to the element and recompute the letterbox.
   * Call on resize and on devicePixelRatio change, not per frame.
   */
  Camera.resize = function (view, canvas, cssW, cssH, dpr) {
    dpr = Math.min(dpr || 1, 2.5)     // beyond ~2.5 the cost buys nothing visible
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    view.cw = w
    view.ch = h
    view.dpr = dpr

    const sx = w / OP.FIELD_W
    const sy = h / OP.FIELD_H
    view.scale = Math.min(sx, sy)
    view.ox = Math.round((w - OP.FIELD_W * view.scale) / 2)
    view.oy = Math.round((h - OP.FIELD_H * view.scale) / 2)
    return view
  }

  /** Apply the transform to a context. Paired with ctx.restore(). */
  Camera.apply = function (view, ctx) {
    ctx.save()
    ctx.setTransform(view.scale, 0, 0, view.scale,
      view.ox + view.shakeX * view.scale,
      view.oy + view.shakeY * view.scale)
  }

  /* ---------- coordinate conversion ---------- */

  /** Pointer event coordinates (CSS pixels relative to the canvas) -> design space. */
  Camera.toWorld = function (view, cssX, cssY, out) {
    out = out || { x: 0, y: 0 }
    out.x = (cssX * view.dpr - view.ox) / view.scale
    out.y = (cssY * view.dpr - view.oy) / view.scale
    return out
  }

  Camera.toScreen = function (view, wx, wy, out) {
    out = out || { x: 0, y: 0 }
    out.x = (wx * view.scale + view.ox) / view.dpr
    out.y = (wy * view.scale + view.oy) / view.dpr
    return out
  }

  /** Is this design-space point inside the visible field? */
  Camera.inField = function (x, y) {
    return x >= 0 && x <= OP.FIELD_W && y >= 0 && y <= OP.FIELD_H
  }

  /* ---------- screen shake ----------
     Purely cosmetic and deliberately driven by Math.random rather than sim.rng:
     it must never be able to influence the simulation. */

  Camera.shake = function (view, magnitude, seconds) {
    if (magnitude > view.shakeMag) {
      view.shakeMag = magnitude
      view.shakeT = seconds
    }
  }

  Camera.stepShake = function (view, dt, reducedMotion) {
    if (reducedMotion) { view.shakeX = 0; view.shakeY = 0; view.shakeT = 0; return }
    if (view.shakeT <= 0) { view.shakeX = 0; view.shakeY = 0; view.shakeMag = 0; return }
    view.shakeT = Math.max(0, view.shakeT - dt)
    const falloff = view.shakeT
    const mag = view.shakeMag * falloff
    view.shakeX = (Math.random() * 2 - 1) * mag
    view.shakeY = (Math.random() * 2 - 1) * mag
    if (view.shakeT === 0) view.shakeMag = 0
  }

  /* ---------- interpolation ----------
     Entities carry prevX/prevY from the last completed tick. Drawing at
     prev + (cur - prev) * alpha is what makes 60Hz simulation look smooth on a
     144Hz display without ever advancing the simulation to draw a frame. */

  Camera.lerpX = function (e, alpha) { return e.prevX + (e.x - e.prevX) * alpha }
  Camera.lerpY = function (e, alpha) { return e.prevY + (e.y - e.prevY) * alpha }

  OP.Camera = Camera
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

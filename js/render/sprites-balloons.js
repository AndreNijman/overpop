;(function (OP) {
  'use strict'

  const SPRITES = { red: function () {} }
  const registeredAtLoad = []

  function install (R) {
    R = R || OP.Render
    if (!R || typeof R.registerBalloon !== 'function') return false
    registeredAtLoad.length = 0
    for (const k in SPRITES) { R.registerBalloon(k, SPRITES[k]); registeredAtLoad.push(k) }
    return true
  }

  OP.BalloonSprites = { table: SPRITES, install: install, registeredAtLoad: registeredAtLoad }

  if (!install()) {
    const prev = Object.getOwnPropertyDescriptor(OP, 'Render')
    let held = prev && 'value' in prev ? prev.value : undefined
    Object.defineProperty(OP, 'Render', {
      configurable: true,
      enumerable: true,
      get: function () { return prev && prev.get ? prev.get.call(OP) : held },
      set: function (v) {
        if (prev && prev.set) prev.set.call(OP, v)
        else held = v
        install(v)
      }
    })
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

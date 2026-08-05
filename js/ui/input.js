;(function (OP) {
  'use strict'

  const M = OP.M

  /* Input.

     One pointer abstraction over mouse, touch and pen, because the alternative is
     three nearly-identical code paths that drift. Pointer Events give us that for
     free everywhere that matters.

     Input NEVER touches the simulation directly. It resolves a gesture into an
     intent — "place this tower here", "select that tower", "start the round" — and
     hands it to a registered action handler. That separation is what lets the
     smoke test drive the game without synthesising events, and what stops a
     half-finished drag from corrupting sim state.

     Coordinates arrive in CSS pixels and are converted to the fixed 1280x720
     design space by OP.Camera, so nothing downstream knows the viewport size. */

  const Input = {}

  const LONG_PRESS_MS = 420
  const TAP_SLOP = 8          // design units of movement still counted as a tap

  Input.create = function () {
    return {
      // live pointer state
      down: false,
      x: 0, y: 0,             // design space
      downX: 0, downY: 0,
      downAt: 0,
      moved: 0,
      pointerId: -1,
      overCanvas: false,

      // interaction mode
      mode: 'idle',           // 'idle' | 'placing' | 'aiming'
      placingKey: null,       // tower or hero key being placed
      placingIsHero: false,
      aimingTowerId: -1,      // for towers that target a point

      selectedId: -1,
      hoverId: -1,

      // keyboard
      keys: {},

      // wired listeners, so detach can remove exactly what was added
      _bound: null,
      _handlers: {}
    }
  }

  /** One shared instance, for the shell. */
  Input.state = Input.create()

  /**
   * Register the intent handlers. Everything the player can do goes through
   * exactly one of these, and each returns nothing — the shell decides what to do.
   *
   *   place(key, x, y, isHero)   confirm a placement
   *   widget(x, y, selectedId)   an on-canvas panel claims the tap; return true to
   *                              stop it reaching the board. Gets the LIVE selection.
   *   select(towerId)            select or deselect (-1)
   *   aim(towerId, x, y)         set a point-target tower's aim point
   *   context(towerId, x, y)     long-press / right-click on a tower
   *   key(name, ev)              a keyboard shortcut fired
   *   cancel()                   the current mode was abandoned
   */
  Input.setHandlers = function (io, handlers) {
    io._handlers = handlers || {}
  }

  /* ---------- attach / detach ---------- */

  Input.attach = function (io, canvas, view) {
    Input.detach(io)
    if (!canvas || !canvas.addEventListener) return io

    const toWorld = ev => {
      const r = canvas.getBoundingClientRect()
      return OP.Camera.toWorld(view, ev.clientX - r.left, ev.clientY - r.top)
    }

    const onDown = ev => {
      if (io.down) return               // ignore a second finger mid-gesture
      const p = toWorld(ev)
      io.down = true
      io.pointerId = ev.pointerId === undefined ? 0 : ev.pointerId
      io.x = p.x; io.y = p.y
      io.downX = p.x; io.downY = p.y
      io.downAt = nowMs()
      io.moved = 0
      if (canvas.setPointerCapture && ev.pointerId !== undefined) {
        try { canvas.setPointerCapture(ev.pointerId) } catch (e) { /* not fatal */ }
      }
      if (ev.preventDefault) ev.preventDefault()
    }

    const onMove = ev => {
      const p = toWorld(ev)
      io.overCanvas = true
      if (io.down) io.moved += M.dist(io.x, io.y, p.x, p.y)
      io.x = p.x; io.y = p.y
    }

    const onUp = ev => {
      if (!io.down) return
      const p = toWorld(ev)
      io.x = p.x; io.y = p.y
      const heldMs = nowMs() - io.downAt
      const wasTap = io.moved <= TAP_SLOP
      io.down = false
      io.pointerId = -1
      if (ev.preventDefault) ev.preventDefault()

      // A long press on a tower is the touch equivalent of a right-click.
      if (wasTap && heldMs >= LONG_PRESS_MS) {
        fire(io, 'context', io._towerAt ? io._towerAt(p.x, p.y) : -1, p.x, p.y)
        return
      }
      if (wasTap) Input.tap(io, p.x, p.y)
    }

    const onCancel = () => { io.down = false; io.pointerId = -1 }
    const onLeave = () => { io.overCanvas = false; io.hoverId = -1 }
    const onContext = ev => {
      if (ev.preventDefault) ev.preventDefault()
      const p = toWorld(ev)
      fire(io, 'context', io._towerAt ? io._towerAt(p.x, p.y) : -1, p.x, p.y)
    }

    const onKeyDown = ev => {
      io.keys[ev.key] = true
      // Escape always abandons whatever mode we are in — the one shortcut a player
      // will reach for without being told.
      if (ev.key === 'Escape') { Input.cancel(io); return }
      fire(io, 'key', ev.key, ev)
    }
    const onKeyUp = ev => { io.keys[ev.key] = false }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('contextmenu', onContext)

    const target = typeof window !== 'undefined' ? window : null
    if (target) {
      target.addEventListener('keydown', onKeyDown)
      target.addEventListener('keyup', onKeyUp)
    }

    io._bound = {
      canvas, target,
      onDown, onMove, onUp, onCancel, onLeave, onContext, onKeyDown, onKeyUp
    }
    return io
  }

  Input.detach = function (io) {
    const b = io._bound
    if (!b) return
    b.canvas.removeEventListener('pointerdown', b.onDown)
    b.canvas.removeEventListener('pointermove', b.onMove)
    b.canvas.removeEventListener('pointerup', b.onUp)
    b.canvas.removeEventListener('pointercancel', b.onCancel)
    b.canvas.removeEventListener('pointerleave', b.onLeave)
    b.canvas.removeEventListener('contextmenu', b.onContext)
    if (b.target) {
      b.target.removeEventListener('keydown', b.onKeyDown)
      b.target.removeEventListener('keyup', b.onKeyUp)
    }
    io._bound = null
  }

  function nowMs () {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0
  }

  function fire (io, name) {
    const fn = io._handlers[name]
    if (typeof fn !== 'function') return false
    const args = Array.prototype.slice.call(arguments, 2)
    try { fn.apply(null, args) } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: input handler "' + name + '" threw', e)
    }
    return true
  }

  /**
   * A tower-lookup function the shell installs, so input can resolve a point to a
   * tower id without holding a reference to the sim.
   */
  Input.setTowerLookup = function (io, fn) { io._towerAt = fn }

  /* ---------- modes ---------- */

  Input.beginPlacing = function (io, key, isHero) {
    io.mode = 'placing'
    io.placingKey = key
    io.placingIsHero = !!isHero
    io.selectedId = -1
    return io
  }

  Input.beginAiming = function (io, towerId) {
    io.mode = 'aiming'
    io.aimingTowerId = towerId
    return io
  }

  Input.cancel = function (io) {
    const had = io.mode !== 'idle'
    io.mode = 'idle'
    io.placingKey = null
    io.placingIsHero = false
    io.aimingTowerId = -1
    if (had) fire(io, 'cancel')
    return io
  }

  /**
   * Resolve a tap into an intent. Exposed separately from the event listener so
   * the smoke test and the UI suite can drive it directly.
   */
  Input.tap = function (io, x, y) {
    if (io.mode === 'placing' && io.placingKey) {
      fire(io, 'place', io.placingKey, x, y, io.placingIsHero)
      return 'place'
    }
    if (io.mode === 'aiming' && io.aimingTowerId >= 0) {
      fire(io, 'aim', io.aimingTowerId, x, y)
      return 'aim'
    }

    // An on-canvas panel gets FIRST REFUSAL on the tap, before the selection is
    // touched. Without this, pressing an upgrade or sell button cleared the
    // selection on the way through — closing the very panel the press was aimed at,
    // because the press landed on empty ground as far as the tower lookup was
    // concerned. A UI layer returns true from `widget` to claim the tap.
    if (io._handlers.widget) {
      let claimed = false
      try { claimed = !!io._handlers.widget(x, y, io.selectedId) } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: widget handler threw', e)
      }
      if (claimed) return 'widget'
    }

    const id = io._towerAt ? io._towerAt(x, y) : -1
    // Tapping the already-selected tower deselects it, which is what every player
    // tries first when they want the range circle to go away.
    const next = (id >= 0 && id === io.selectedId) ? -1 : id
    io.selectedId = next
    fire(io, 'select', next)
    return next >= 0 ? 'select' : 'deselect'
  }

  /** Refresh what the pointer is hovering. Called once per frame by the shell. */
  Input.updateHover = function (io) {
    if (!io.overCanvas || io.mode !== 'idle') { io.hoverId = -1; return -1 }
    io.hoverId = io._towerAt ? io._towerAt(io.x, io.y) : -1
    return io.hoverId
  }

  /**
   * The placement preview the renderer draws, or null.
   * Asks the real placement rules so the preview cannot disagree with what a tap
   * will actually be allowed to do.
   */
  Input.placementPreview = function (io, sim) {
    if (io.mode !== 'placing' || !io.placingKey) return null
    const def = io.placingIsHero ? OP.HEROES[io.placingKey] : OP.TOWERS[io.placingKey]
    if (!def) return null
    const check = io.placingIsHero
      ? OP.Heroes.canPlace(sim, io.placingKey, io.x, io.y)
      : OP.Towers.canPlace(sim, io.placingKey, io.x, io.y)
    return {
      x: io.x, y: io.y,
      range: def.base.range,
      footprint: def.footprint,
      ok: check.ok,
      reason: check.reason,
      key: io.placingKey
    }
  }

  Input.isDown = function (io, key) { return !!io.keys[key] }

  OP.Input = Input
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

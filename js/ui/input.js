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
      x: 0, y: 0,             // FIELD space — what the HUD, shop and panels hit-test
      bx: 0, by: 0,           // BOARD space — what the simulation uses
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
   *   wheel(dy, x, y)            a scroll gesture; return true if it was consumed
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
      setPoint(io, p)
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
      setPoint(io, p)
    }

    const onUp = ev => {
      if (!io.down) return
      const p = toWorld(ev)
      setPoint(io, p)
      const heldMs = nowMs() - io.downAt
      const wasTap = io.moved <= TAP_SLOP
      io.down = false
      io.pointerId = -1
      if (ev.preventDefault) ev.preventDefault()

      // A long press on a tower is the touch equivalent of a right-click.
      if (wasTap && heldMs >= LONG_PRESS_MS) {
        Input.context(io, p.x, p.y)
        return
      }
      if (wasTap) Input.tap(io, p.x, p.y)
    }

    /* Wheel is scroll, and scroll is a UI concern only — it never reaches the
       board. The default is prevented ONLY when a handler says it consumed the
       gesture, so a wheel over the map still does whatever the page would do
       rather than being silently swallowed. */
    const onWheel = ev => {
      const p = toWorld(ev)
      setPoint(io, p)
      io.overCanvas = true
      // deltaMode 1 is lines and 2 is pages; browsers disagree on pixel
      // magnitude, so normalise to something roughly like pixels here and let
      // the panel decide how far a notch should travel.
      const unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? 100 : 1)
      const consumed = Input.wheel(io, (ev.deltaY || 0) * unit, p.x, p.y)
      if (consumed && ev.preventDefault) ev.preventDefault()
    }

    const onCancel = () => { io.down = false; io.pointerId = -1 }
    const onLeave = () => { io.overCanvas = false; io.hoverId = -1 }
    const onContext = ev => {
      if (ev.preventDefault) ev.preventDefault()
      const p = toWorld(ev)
      setPoint(io, p)
      Input.context(io, p.x, p.y)
    }

    const onKeyDown = ev => {
      io.keys[ev.key] = true
      /* Escape abandons whatever mode we are in — the one shortcut a player will
         reach for without being told. But a modal overlay gets FIRST REFUSAL:
         otherwise Escape cancelled a placement the player had already forgotten
         about while leaving the panel they were actually looking at open, which
         reads as Escape being broken. Same shape as `widget` claiming a tap. */
      if (ev.key === 'Escape') {
        if (!claim(io, 'key', ev.key, ev)) Input.cancel(io)
        return
      }
      fire(io, 'key', ev.key, ev)
    }
    const onKeyUp = ev => { io.keys[ev.key] = false }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('contextmenu', onContext)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const target = typeof window !== 'undefined' ? window : null
    if (target) {
      target.addEventListener('keydown', onKeyDown)
      target.addEventListener('keyup', onKeyUp)
    }

    io._bound = {
      canvas, target,
      onDown, onMove, onUp, onCancel, onLeave, onContext, onWheel, onKeyDown, onKeyUp
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
    b.canvas.removeEventListener('wheel', b.onWheel)
    if (b.target) {
      b.target.removeEventListener('keydown', b.onKeyDown)
      b.target.removeEventListener('keyup', b.onKeyUp)
    }
    io._bound = null
  }

  /**
   * Record a pointer position in BOTH spaces, always together.
   *
   * `x/y` is field space, which is what the HUD, the shop and the tower panel
   * hit-test against. `bx/by` is board space, which is what the simulation uses.
   * They differ because the board is scaled to fit beside the sidebar, and the one
   * way to guarantee they never disagree is to have a single writer.
   */
  function setPoint (io, p) {
    io.x = p.x; io.y = p.y
    const b = toBoard(p.x, p.y)
    io.bx = b.x; io.by = b.y
  }

  /**
   * Public: move the pointer to a FIELD position, keeping board space in step.
   *
   * Anything that wants to place the pointer without a real event — the smoke
   * test, the suites, an autoplay hook — must go through this. Assigning `io.x`
   * directly leaves `io.bx` stale, and the two spaces then disagree silently,
   * which shows up as the placement preview pointing somewhere the tap will not
   * land.
   */
  Input.setPoint = function (io, x, y) {
    setPoint(io, { x: x, y: y })
    return io
  }

  /** Field -> board, tolerating a Camera that has not loaded yet. */
  function toBoard (x, y) {
    if (OP.Camera && OP.Camera.fieldToBoard) return OP.Camera.fieldToBoard(x, y)
    return { x: x, y: y }
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

  /** Like `fire`, but reports whether the handler CLAIMED the event. */
  function claim (io, name) {
    const fn = io._handlers[name]
    if (typeof fn !== 'function') return false
    const args = Array.prototype.slice.call(arguments, 2)
    try { return !!fn.apply(null, args) } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: input handler "' + name + '" threw', e)
      return false
    }
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
    /* `x, y` arrive in FIELD space, because that is what a widget hit-test needs.
       Everything sim-facing below gets BOARD space instead: the board is scaled to
       fit beside the sidebar, so a press at field x=900 is not at world x=900. */
    const b = toBoard(x, y)

    if (io.mode === 'placing' && io.placingKey) {
      fire(io, 'place', io.placingKey, b.x, b.y, io.placingIsHero)
      return 'place'
    }
    if (io.mode === 'aiming' && io.aimingTowerId >= 0) {
      fire(io, 'aim', io.aimingTowerId, b.x, b.y)
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

    const id = io._towerAt ? io._towerAt(b.x, b.y) : -1
    // Tapping the already-selected tower deselects it, which is what every player
    // tries first when they want the range circle to go away.
    const next = (id >= 0 && id === io.selectedId) ? -1 : id
    io.selectedId = next
    fire(io, 'select', next)
    return next >= 0 ? 'select' : 'deselect'
  }

  /**
   * Resolve a long-press or right-click. Field coordinates in; the tower lookup
   * and the handler both get board coordinates.
   */
  Input.context = function (io, x, y) {
    const b = toBoard(x, y)
    const id = io._towerAt ? io._towerAt(b.x, b.y) : -1
    fire(io, 'context', id, b.x, b.y)
    return id
  }

  /**
   * Resolve a scroll gesture. Exposed separately from the listener for the same
   * reason as `tap`: the suites drive it directly.
   *
   * Returns true when a handler claimed it. Unclaimed scroll is not an error —
   * most of the screen has nothing to scroll.
   */
  Input.wheel = function (io, dy, x, y) {
    const fn = io._handlers.wheel
    if (typeof fn !== 'function') return false
    try { return !!fn(dy, x, y) } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('OVERPOP: wheel handler threw', e)
      return false
    }
  }

  /** Refresh what the pointer is hovering. Called once per frame by the shell. */
  Input.updateHover = function (io) {
    if (!io.overCanvas || io.mode !== 'idle') { io.hoverId = -1; return -1 }
    io.hoverId = io._towerAt ? io._towerAt(io.bx, io.by) : -1
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
    // Board space: the preview is drawn under the board transform alongside the
    // towers it is about to join, and asked of the real placement rules, which
    // only know world coordinates.
    const check = io.placingIsHero
      ? OP.Heroes.canPlace(sim, io.placingKey, io.bx, io.by)
      : OP.Towers.canPlace(sim, io.placingKey, io.bx, io.by)
    return {
      x: io.bx, y: io.by,
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

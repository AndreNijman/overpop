;(function (OP) {
  'use strict'

  const M = OP.M

  /* Visual effects: pops, blasts, floating text, life-loss flashes.

     FX are PURELY COSMETIC and live entirely outside the simulation. They are
     driven by draining the sim's event queues (popEvents, blastEvents, leakEvents,
     events), which the sim only ever appends to. Consequences worth being explicit
     about:

       - FX may use Math.random freely. They cannot desynchronise a replay because
         nothing here is ever read back into sim state. The determinism suite
         asserts exactly this by draining the queues on one of two identical runs
         and checking the checksums still match.

       - FX are pooled and hard-capped. Round 90 produces thousands of pops a
         second; an unbounded particle list would be the first thing to fall over,
         and it would look like the *simulation* had slowed down. */

  const FX = {}

  const MAX_PARTICLES = 900
  const MAX_FLOATERS = 60

  FX.create = function () {
    return {
      particles: [],
      pool: [],
      floaters: [],
      flash: 0,          // white-out on a life lost
      flashColour: '#e06a5a',
      time: 0,
      lastPopIndex: 0,
      lastBlastIndex: 0,
      lastLeakIndex: 0,
      lastEventIndex: 0,
      reducedMotion: false,
      dropped: 0         // particles refused because of the cap; shown in debug
    }
  }

  /** One shared instance, so the renderer does not need to be handed one. */
  FX.state = FX.create()

  function particle (fx) {
    const p = fx.pool.pop()
    if (p) return p
    return { alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 2, life: 0, maxLife: 1, colour: '#fff', kind: 'dot', spin: 0, drag: 0.9 }
  }

  function emit (fx, def) {
    if (fx.particles.length >= MAX_PARTICLES) { fx.dropped++; return null }
    const p = particle(fx)
    p.alive = true
    p.x = def.x; p.y = def.y
    p.vx = def.vx || 0; p.vy = def.vy || 0
    p.r = def.r || 2
    p.life = def.life || 0.4
    p.maxLife = p.life
    p.colour = def.colour || '#fff'
    p.kind = def.kind || 'dot'
    p.spin = def.spin || 0
    p.drag = def.drag === undefined ? 0.90 : def.drag
    fx.particles.push(p)
    return p
  }
  FX.emit = emit

  /* ---------- event-driven spawning ---------- */

  /**
   * Drain whatever the sim has appended since last frame.
   *
   * The queues are append-only and capped by the sim, so this tracks its own read
   * index and tolerates the sim having trimmed from the front — otherwise a long
   * round would replay old pops after a trim.
   */
  FX.consume = function (fx, sim) {
    fx.lastPopIndex = drain(sim.popEvents, fx.lastPopIndex, function (e) {
      popBurst(fx, e)
    })
    fx.lastBlastIndex = drain(sim.blastEvents, fx.lastBlastIndex, function (e) {
      blastRing(fx, e)
    })
    fx.lastLeakIndex = drain(sim.leakEvents, fx.lastLeakIndex, function (e) {
      fx.flash = Math.min(1, fx.flash + Math.min(0.6, 0.12 + e.cost / 400))
      floater(fx, e.x, e.y, '-' + e.cost, '#e06a5a')
    })
    fx.lastEventIndex = drain(sim.events, fx.lastEventIndex, function (e) {
      if (e.kind === 'roundbonus') floater(fx, OP.FIELD_W / 2, 90, OP.M.money(e.amount), '#9fe8c6')
      else if (e.kind === 'herolevel') floater(fx, OP.FIELD_W / 2, 130, 'Level ' + e.level, '#ffd97a')
      else if (e.kind === 'paragon') floater(fx, OP.FIELD_W / 2, 130, 'Degree ' + e.degree, '#f2e6c8')
    })
  }

  function drain (queue, from, fn) {
    // The sim trims from the front when a queue gets long, so an index past the
    // end means a trim happened: resync rather than replaying stale events.
    if (from > queue.length) from = 0
    for (let i = from; i < queue.length; i++) fn(queue[i])
    return queue.length
  }

  function popBurst (fx, e) {
    const tier = OP.BALLOON_INDEX[e.tier] !== undefined ? OP.tierByKey(e.tier) : null
    const colour = tier ? tier.colour : '#e8e2d4'
    const big = tier && tier.blimp
    const n = fx.reducedMotion ? (big ? 6 : 2) : (big ? 26 : 7)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * M.TAU
      const speed = (big ? 90 : 45) * (0.4 + Math.random() * 0.9)
      emit(fx, {
        x: e.x, y: e.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: (big ? 3.5 : 2) * (0.6 + Math.random() * 0.8),
        life: (big ? 0.7 : 0.35) * (0.7 + Math.random() * 0.6),
        colour: colour,
        kind: 'shard',
        spin: (Math.random() * 2 - 1) * 8
      })
    }
    if (big) {
      emit(fx, { x: e.x, y: e.y, r: 4, life: 0.45, colour: '#fff6e0', kind: 'ring' })
      // A blimp going down is worth a jolt. The view is attached by the shell; if
      // nothing attached one, skip rather than inventing a fake object.
      if (FX.view) OP.Camera.shake(FX.view, 5, 0.22)
    }
  }

  function blastRing (fx, e) {
    emit(fx, {
      x: e.x, y: e.y,
      r: Math.max(6, e.radius * 0.35),
      life: fx.reducedMotion ? 0.14 : 0.30,
      colour: '#ffcf8a',
      kind: 'blast',
      drag: 1
    })
    const n = fx.reducedMotion ? 0 : Math.min(14, Math.round(e.radius / 8))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * M.TAU + Math.random() * 0.3
      emit(fx, {
        x: e.x, y: e.y,
        vx: Math.cos(a) * e.radius * 1.6, vy: Math.sin(a) * e.radius * 1.6,
        r: 2.4, life: 0.22 + Math.random() * 0.14,
        colour: '#ffb26a', kind: 'shard'
      })
    }
  }

  function floater (fx, x, y, text, colour) {
    if (fx.floaters.length >= MAX_FLOATERS) fx.floaters.shift()
    fx.floaters.push({ x: x, y: y, text: String(text), colour: colour || '#fff', life: 1.1, maxLife: 1.1 })
  }
  FX.floater = floater

  /** Public: something worth a number on screen happened. */
  FX.say = function (x, y, text, colour) { floater(FX.state, x, y, text, colour) }

  /* ---------- stepping ---------- */

  /**
   * Advance the effects by real elapsed time — NOT by sim ticks. FX run at the
   * display rate; the simulation does not.
   */
  FX.step = function (fx, dt) {
    fx.time += dt
    const list = fx.particles
    let w = 0
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      p.life -= dt
      if (p.life <= 0) { p.alive = false; fx.pool.push(p); continue }
      if (p.kind === 'blast' || p.kind === 'ring') {
        p.r += dt * 260
      } else {
        p.x += p.vx * dt
        p.y += p.vy * dt
        const d = Math.pow(p.drag, dt * 60)
        p.vx *= d
        p.vy *= d
        p.vy += 120 * dt
      }
      list[w++] = p
    }
    list.length = w

    let fw = 0
    for (let i = 0; i < fx.floaters.length; i++) {
      const f = fx.floaters[i]
      f.life -= dt
      if (f.life <= 0) continue
      f.y -= dt * 26
      fx.floaters[fw++] = f
    }
    fx.floaters.length = fw

    if (fx.flash > 0) fx.flash = Math.max(0, fx.flash - dt * 2.2)
  }

  /* ---------- drawing ---------- */

  FX.draw = function (ctx, sim, view, frame) {
    const fx = FX.state
    fx.reducedMotion = !!(frame && frame.reducedMotion)

    for (let i = 0; i < fx.particles.length; i++) {
      const p = fx.particles[i]
      const t = p.life / p.maxLife
      ctx.globalAlpha = M.clamp01(t)
      if (p.kind === 'blast' || p.kind === 'ring') {
        ctx.strokeStyle = p.colour
        ctx.lineWidth = Math.max(1, 4 * t)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, M.TAU)
        ctx.stroke()
      } else {
        ctx.fillStyle = p.colour
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * (0.5 + t * 0.5), 0, M.TAU)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    if (fx.floaters.length) {
      ctx.font = '600 18px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < fx.floaters.length; i++) {
        const f = fx.floaters[i]
        ctx.globalAlpha = M.clamp01(f.life / f.maxLife)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillText(f.text, f.x + 1.5, f.y + 1.5)
        ctx.fillStyle = f.colour
        ctx.fillText(f.text, f.x, f.y)
      }
      ctx.globalAlpha = 1
    }

    if (fx.flash > 0) {
      ctx.fillStyle = fx.flashColour
      ctx.globalAlpha = fx.flash * 0.32
      ctx.fillRect(0, 0, OP.FIELD_W, OP.FIELD_H)
      ctx.globalAlpha = 1
    }
  }

  FX.reset = function () {
    const fresh = FX.create()
    for (const key in fresh) FX.state[key] = fresh[key]
  }

  FX.count = function () { return FX.state.particles.length + FX.state.floaters.length }

  OP.FX = FX
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

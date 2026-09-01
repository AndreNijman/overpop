;(function (OP) {
  'use strict'

  /* Seeded RNG — sfc32 with a splitmix32 seed expansion.
     Chosen because its entire state is four uint32s, which means it serialises
     as plain data alongside the rest of the sim (see ARCHITECTURE.md §0) and a
     saved mid-round game resumes onto the exact same random sequence.

     Hard rule: the simulation reads randomness ONLY from sim.rng. Render and
     audio may use Math.random() freely — they can never feed back into sim
     state, so they can never desync a replay. */

  function splitmix32 (a) {
    return function () {
      a |= 0
      a = (a + 0x9e3779b9) | 0
      let t = a ^ (a >>> 16)
      t = Math.imul(t, 0x21f0aaad)
      t = t ^ (t >>> 15)
      t = Math.imul(t, 0x735a2d97)
      return (t = t ^ (t >>> 15)) >>> 0
    }
  }

  // Any seed shape -> a stable uint32.
  function hashSeed (seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return (seed >>> 0) || 0x9e3779b9
    const s = String(seed === undefined || seed === null ? 'overpop' : seed)
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  function RNG (seed) {
    if (!(this instanceof RNG)) return new RNG(seed)
    this.seed = seed
    const sm = splitmix32(hashSeed(seed))
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm()
    this.calls = 0
    // Discard a short warm-up so nearby integer seeds don't correlate early.
    for (let i = 0; i < 12; i++) this.u32()
    this.calls = 0
  }

  RNG.prototype.u32 = function () {
    let a = this.a, b = this.b, c = this.c, d = this.d
    const t = (a + b | 0) + d | 0
    d = d + 1 | 0
    a = b ^ (b >>> 9)
    b = c + (c << 3) | 0
    c = (c << 21) | (c >>> 11)
    c = c + t | 0
    this.a = a; this.b = b; this.c = c; this.d = d
    this.calls++
    return t >>> 0
  }

  /** Float in [0, 1). */
  RNG.prototype.next = function () { return this.u32() / 4294967296 }

  /** Integer in [0, n). Rejection-free and bias-free enough for game use. */
  RNG.prototype.int = function (n) {
    if (n <= 0) return 0
    return Math.floor(this.next() * n)
  }

  /** Float in [lo, hi). */
  RNG.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo) }

  /** Integer in [lo, hi] inclusive. */
  RNG.prototype.intRange = function (lo, hi) { return lo + this.int(hi - lo + 1) }

  RNG.prototype.chance = function (p) { return this.next() < p }

  RNG.prototype.sign = function () { return this.u32() & 1 ? 1 : -1 }

  RNG.prototype.pick = function (arr) {
    return arr.length ? arr[this.int(arr.length)] : undefined
  }

  /** Weighted pick. weights[i] pairs with items[i]; non-positive weights skipped. */
  RNG.prototype.weighted = function (items, weights) {
    let total = 0
    for (let i = 0; i < items.length; i++) if (weights[i] > 0) total += weights[i]
    if (total <= 0) return undefined
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      if (!(weights[i] > 0)) continue
      r -= weights[i]
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }

  /** Fisher-Yates, in place. */
  RNG.prototype.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    return arr
  }

  /** Approximately normal, mean 0, sd 1. Sum-of-uniforms — cheap and bounded. */
  RNG.prototype.gauss = function () {
    return (this.next() + this.next() + this.next() + this.next() + this.next() + this.next() - 3) / 0.7071
  }

  /** Uniform point inside a circle. */
  RNG.prototype.inCircle = function (r) {
    const a = this.next() * Math.PI * 2
    const d = Math.sqrt(this.next()) * r
    return { x: Math.cos(a) * d, y: Math.sin(a) * d }
  }

  /* ---------- serialisation ---------- */

  RNG.prototype.state = function () {
    return { a: this.a, b: this.b, c: this.c, d: this.d, calls: this.calls, seed: this.seed }
  }

  RNG.prototype.setState = function (s) {
    // The generator keeps its state as signed 32-bit values (`|0` semantics in
    // u32). `>>> 0` here would flip them to unsigned and `Sim.checksum` — which
    // folds rng.a/b/c/d directly — would read a different number than the live
    // generator, so a save/load would compare as "divergent" even though the
    // random sequence is identical. Preserve signedness with `| 0`.
    this.a = s.a | 0; this.b = s.b | 0; this.c = s.c | 0; this.d = s.d | 0
    this.calls = s.calls | 0
    this.seed = s.seed
    return this
  }

  RNG.prototype.clone = function () {
    return new RNG(this.seed).setState(this.state())
  }

  /** A child stream derived deterministically from this one. Useful for giving a
      subsystem its own sequence without coupling it to global call ordering. */
  RNG.prototype.fork = function (label) {
    return new RNG(`${hashSeed(this.seed)}:${label}:${this.u32()}`)
  }

  RNG.fromState = function (s) { return new RNG(s.seed).setState(s) }

  OP.RNG = RNG
  OP.hashSeed = hashSeed
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

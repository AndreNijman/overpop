;(function (OP) {
  'use strict'

  /* Audio: every sound synthesised at runtime. No sample files anywhere.

     Three things make or break this file:

     1. VOICE LIMITING IS MANDATORY. Round 90 produces hundreds of pops per second.
        Without a cap the WebAudio graph accumulates thousands of nodes, the audio
        thread starves, and — because the audio thread starving stalls the main
        thread's scheduling — it presents as the *game* being slow. The cap is the
        single most important thing here.

     2. Nothing is created until the first user gesture. Browsers suspend an
        AudioContext created before one, and a suspended context that is never
        resumed silently drops everything.

     3. Audio never touches sim state and may use Math.random freely.

     Everything is scheduled a few milliseconds ahead of currentTime; scheduling at
     exactly currentTime produces clicks on most implementations. */

  const Audio = {}

  const MAX_VOICES = 18            // simultaneous scheduled sounds
  const SAME_SOUND_MIN_GAP = 0.022 // seconds; collapses a burst of identical pops
  const LOOKAHEAD = 0.012

  Audio.state = {
    ctx: null,
    master: null,
    sfxBus: null,
    musicBus: null,
    comp: null,
    ready: false,
    unlocked: false,
    voices: 0,
    lastAt: {},          // sound key -> last scheduled time
    sfxVolume: 0.7,
    musicVolume: 0.35,
    muted: false,
    music: null,
    suppressed: 0        // sounds dropped by the limiter, for the debug overlay
  }

  /* ---------- lifecycle ---------- */

  /** Create the graph. Safe to call repeatedly; only the first call builds it. */
  Audio.init = function () {
    const S = Audio.state
    if (S.ctx) return S.ctx
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
      : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null)
    if (!Ctor) return null

    let ctx
    try { ctx = new Ctor() } catch (e) { return null }
    S.ctx = ctx

    S.master = ctx.createGain()
    S.master.gain.value = S.muted ? 0 : 1

    // A limiter on the master bus, so a hundred simultaneous pops cannot clip.
    S.comp = ctx.createDynamicsCompressor()
    S.comp.threshold.value = -14
    S.comp.knee.value = 24
    S.comp.ratio.value = 9
    S.comp.attack.value = 0.003
    S.comp.release.value = 0.18

    S.sfxBus = ctx.createGain()
    S.sfxBus.gain.value = S.sfxVolume
    S.musicBus = ctx.createGain()
    S.musicBus.gain.value = S.musicVolume

    S.sfxBus.connect(S.comp)
    S.musicBus.connect(S.comp)
    S.comp.connect(S.master)
    S.master.connect(ctx.destination)

    S.ready = true
    return ctx
  }

  /**
   * Call from the first real user gesture. Browsers will not start a context
   * without one, and a context created earlier stays suspended.
   */
  Audio.unlock = function () {
    const S = Audio.state
    Audio.init()
    if (!S.ctx) return false
    if (S.ctx.state === 'suspended' && S.ctx.resume) S.ctx.resume()
    S.unlocked = true
    return true
  }

  Audio.setSfxVolume = function (v) {
    const S = Audio.state
    S.sfxVolume = OP.M.clamp01(v)
    if (S.sfxBus) S.sfxBus.gain.value = S.sfxVolume
  }
  Audio.setMusicVolume = function (v) {
    const S = Audio.state
    S.musicVolume = OP.M.clamp01(v)
    if (S.musicBus) S.musicBus.gain.value = S.musicVolume
  }
  Audio.setMuted = function (on) {
    const S = Audio.state
    S.muted = !!on
    if (S.master) S.master.gain.value = S.muted ? 0 : 1
  }
  Audio.isReady = function () { return !!(Audio.state.ctx && Audio.state.unlocked) }

  /* ---------- the voice limiter ---------- */

  function claim (key) {
    const S = Audio.state
    if (!S.ctx || !S.unlocked || S.muted) return null
    const now = S.ctx.currentTime

    // Collapse a burst of the same sound in the same instant into one voice. Six
    // reds popping on one tick should sound like one pop, not six.
    const last = S.lastAt[key] || -1
    if (now - last < SAME_SOUND_MIN_GAP) { S.suppressed++; return null }

    if (S.voices >= MAX_VOICES) { S.suppressed++; return null }

    S.lastAt[key] = now
    S.voices++
    return now + LOOKAHEAD
  }

  function release () {
    const S = Audio.state
    S.voices = Math.max(0, S.voices - 1)
  }

  /** An envelope-shaped gain node that frees its voice slot when it finishes. */
  function envelope (at, attack, hold, decay, peak, bus) {
    const S = Audio.state
    const g = S.ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), at + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay)
    g.connect(bus || S.sfxBus)
    return g
  }

  function osc (type, freq, at) {
    const o = Audio.state.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, at)
    return o
  }

  function stopAt (node, t) {
    node.stop(t)
    node.onended = release
  }

  /** A short burst of filtered noise — the basis of every pop and impact. */
  function noise (at, seconds) {
    const S = Audio.state
    const n = Math.max(1, Math.floor(S.ctx.sampleRate * seconds))
    const buf = S.ctx.createBuffer(1, n, S.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      // Decaying white noise, so the buffer itself carries the transient shape.
      data[i] = (Math.random() * 2 - 1) * (1 - i / n)
    }
    const src = S.ctx.createBufferSource()
    src.buffer = buf
    return src
  }

  /* ---------- the sound bank ---------- */

  const BANK = {}

  /** Register a sound. fn(at, opts) builds and schedules the graph. */
  Audio.define = function (key, fn) { BANK[key] = fn }
  Audio.has = function (key) { return !!BANK[key] }
  Audio.keys = function () { return Object.keys(BANK).sort() }

  /** Play a registered sound. Silently does nothing if audio is not ready. */
  Audio.play = function (key, opts) {
    const fn = BANK[key]
    if (!fn) return false
    const at = claim(key)
    if (at === null) return false
    try { fn(at, opts || {}) } catch (e) { release(); return false }
    return true
  }

  /* pop — pitched by balloon size, so the ear can tell a red from a ceramic. */
  Audio.define('pop', function (at, o) {
    const S = Audio.state
    const size = OP.M.clamp01(o.size === undefined ? 0.3 : o.size)
    const base = 900 - size * 560
    const src = noise(at, 0.06)
    const filt = S.ctx.createBiquadFilter()
    filt.type = 'bandpass'
    filt.frequency.setValueAtTime(base, at)
    filt.Q.value = 1.6
    const env = envelope(at, 0.002, 0, 0.055, 0.22 + size * 0.1)
    src.connect(filt); filt.connect(env)
    src.start(at)
    stopAt(src, at + 0.08)
  })

  /* blimpPop — a bigger, lower, longer event with a body thump. */
  Audio.define('blimpPop', function (at, o) {
    const S = Audio.state
    const src = noise(at, 0.5)
    const filt = S.ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.setValueAtTime(1400, at)
    filt.frequency.exponentialRampToValueAtTime(180, at + 0.4)
    const env = envelope(at, 0.004, 0.03, 0.42, 0.5)
    src.connect(filt); filt.connect(env)
    src.start(at)
    stopAt(src, at + 0.55)

    const thump = osc('sine', 120, at)
    thump.frequency.exponentialRampToValueAtTime(38, at + 0.35)
    const tenv = envelope(at, 0.006, 0.02, 0.34, 0.6)
    thump.connect(tenv)
    thump.start(at)
    thump.stop(at + 0.42)
  })

  Audio.define('shoot', function (at, o) {
    const S = Audio.state
    const pitch = 320 + (o.pitch || 0) * 220
    const o1 = osc('triangle', pitch, at)
    o1.frequency.exponentialRampToValueAtTime(pitch * 0.55, at + 0.05)
    const env = envelope(at, 0.002, 0, 0.05, 0.10)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.07)
  })

  Audio.define('explode', function (at) {
    const S = Audio.state
    const src = noise(at, 0.35)
    const filt = S.ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.setValueAtTime(2200, at)
    filt.frequency.exponentialRampToValueAtTime(220, at + 0.3)
    const env = envelope(at, 0.003, 0.01, 0.3, 0.35)
    src.connect(filt); filt.connect(env)
    src.start(at)
    stopAt(src, at + 0.4)
  })

  Audio.define('freeze', function (at) {
    const o1 = osc('sine', 1800, at)
    o1.frequency.exponentialRampToValueAtTime(600, at + 0.22)
    const env = envelope(at, 0.01, 0.02, 0.2, 0.16)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.26)
  })

  Audio.define('place', function (at) {
    const o1 = osc('sine', 420, at)
    o1.frequency.setValueAtTime(620, at + 0.06)
    const env = envelope(at, 0.004, 0.03, 0.12, 0.25)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.2)
  })

  Audio.define('upgrade', function (at) {
    const notes = [523.25, 659.25, 783.99]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.055
      const o1 = osc('triangle', notes[i], t)
      const env = envelope(t, 0.004, 0.02, 0.13, 0.20)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.18)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('sell', function (at) {
    const o1 = osc('triangle', 520, at)
    o1.frequency.exponentialRampToValueAtTime(240, at + 0.16)
    const env = envelope(at, 0.004, 0, 0.16, 0.18)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.2)
  })

  Audio.define('deny', function (at) {
    const o1 = osc('square', 180, at)
    const env = envelope(at, 0.003, 0.02, 0.08, 0.12)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.14)
  })

  Audio.define('leak', function (at) {
    const o1 = osc('sawtooth', 200, at)
    o1.frequency.exponentialRampToValueAtTime(90, at + 0.3)
    const env = envelope(at, 0.006, 0.04, 0.28, 0.34)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.36)
  })

  Audio.define('roundStart', function (at) {
    const notes = [392, 523.25]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.09
      const o1 = osc('triangle', notes[i], t)
      const env = envelope(t, 0.006, 0.04, 0.16, 0.18)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.22)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('roundEnd', function (at) {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.06
      const o1 = osc('sine', notes[i], t)
      const env = envelope(t, 0.005, 0.03, 0.18, 0.16)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.24)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('ability', function (at) {
    const o1 = osc('sawtooth', 220, at)
    o1.frequency.exponentialRampToValueAtTime(1400, at + 0.24)
    const filt = Audio.state.ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.setValueAtTime(900, at)
    filt.frequency.exponentialRampToValueAtTime(4200, at + 0.24)
    const env = envelope(at, 0.008, 0.03, 0.22, 0.26)
    o1.connect(filt); filt.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.3)
  })

  Audio.define('levelUp', function (at) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.05
      const o1 = osc('triangle', notes[i], t)
      const env = envelope(t, 0.004, 0.02, 0.2, 0.17)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.26)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('gameOver', function (at) {
    const notes = [392, 349.23, 293.66, 220]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.19
      const o1 = osc('triangle', notes[i], t)
      const env = envelope(t, 0.01, 0.09, 0.3, 0.24)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.42)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('victory', function (at) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
    for (let i = 0; i < notes.length; i++) {
      const t = at + i * 0.11
      const o1 = osc('triangle', notes[i], t)
      const env = envelope(t, 0.006, 0.06, 0.26, 0.2)
      o1.connect(env)
      o1.start(t)
      o1.stop(t + 0.36)
      if (i === notes.length - 1) o1.onended = release
    }
  })

  Audio.define('ui', function (at) {
    const o1 = osc('sine', 880, at)
    const env = envelope(at, 0.002, 0.01, 0.05, 0.09)
    o1.connect(env)
    o1.start(at)
    stopAt(o1, at + 0.08)
  })

  /* ---------- music beds ----------
     A slow arpeggio over a drone, scheduled a bar at a time. Deliberately sparse:
     a tower-defense session runs for an hour and anything busier becomes
     unbearable long before that. */

  const SCALE = [0, 3, 5, 7, 10]     // minor pentatonic — hard to make sound wrong
  const ROOTS = { calm: 110, tense: 98, boss: 87.31 }

  Audio.startMusic = function (mood) {
    const S = Audio.state
    if (!S.ctx || !S.unlocked) return false
    Audio.stopMusic()
    const root = ROOTS[mood] || ROOTS.calm

    const drone = osc('sawtooth', root / 2, S.ctx.currentTime)
    const dfilt = S.ctx.createBiquadFilter()
    dfilt.type = 'lowpass'
    dfilt.frequency.value = mood === 'boss' ? 320 : 220
    const dgain = S.ctx.createGain()
    dgain.gain.value = 0.10
    drone.connect(dfilt); dfilt.connect(dgain); dgain.connect(S.musicBus)
    drone.start()

    S.music = { mood: mood, drone: drone, dgain: dgain, timer: null, step: 0, root: root }

    const stepSeconds = mood === 'boss' ? 0.28 : 0.44
    S.music.timer = setInterval(function () {
      const m = S.music
      if (!m || !S.ctx) return
      const at = S.ctx.currentTime + LOOKAHEAD
      const degree = SCALE[(m.step * 3) % SCALE.length]
      const octave = 1 + ((m.step >> 2) % 2)
      const freq = m.root * Math.pow(2, degree / 12) * octave
      const o1 = osc(mood === 'boss' ? 'square' : 'triangle', freq, at)
      const g = S.ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.055, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + stepSeconds * 1.6)
      o1.connect(g); g.connect(S.musicBus)
      o1.start(at)
      o1.stop(at + stepSeconds * 1.7)
      m.step++
    }, stepSeconds * 1000)

    return true
  }

  Audio.stopMusic = function () {
    const S = Audio.state
    if (!S.music) return
    if (S.music.timer) clearInterval(S.music.timer)
    try {
      S.music.dgain.gain.setTargetAtTime(0.0001, S.ctx.currentTime, 0.12)
      S.music.drone.stop(S.ctx.currentTime + 0.6)
    } catch (e) { /* already stopped */ }
    S.music = null
  }

  /* ---------- driving it from the sim ----------
     Same pattern as FX: drain the append-only event queues, never read sim state
     back into anything. */

  Audio.cursors = { pop: 0, blast: 0, leak: 0, event: 0 }

  Audio.consume = function (sim) {
    if (!Audio.isReady()) {
      // Keep the cursors current even while muted, so unmuting mid-round does not
      // replay a thousand banked pops at once.
      Audio.cursors.pop = sim.popEvents.length
      Audio.cursors.blast = sim.blastEvents.length
      Audio.cursors.leak = sim.leakEvents.length
      Audio.cursors.event = sim.events.length
      return
    }

    Audio.cursors.pop = sweep(sim.popEvents, Audio.cursors.pop, function (e) {
      const tier = OP.BALLOON_INDEX[e.tier] !== undefined ? OP.tierByKey(e.tier) : null
      if (tier && tier.blimp) Audio.play('blimpPop')
      else Audio.play('pop', { size: tier ? tier.index / OP.BALLOON_TIERS.length : 0.3 })
    })
    Audio.cursors.blast = sweep(sim.blastEvents, Audio.cursors.blast, function () {
      Audio.play('explode')
    })
    Audio.cursors.leak = sweep(sim.leakEvents, Audio.cursors.leak, function () {
      Audio.play('leak')
    })
    Audio.cursors.event = sweep(sim.events, Audio.cursors.event, function (e) {
      if (e.kind === 'roundstart') Audio.play('roundStart')
      else if (e.kind === 'roundend') Audio.play('roundEnd')
      else if (e.kind === 'place') Audio.play('place')
      else if (e.kind === 'upgrade') Audio.play('upgrade')
      else if (e.kind === 'sell') Audio.play('sell')
      else if (e.kind === 'ability') Audio.play('ability')
      else if (e.kind === 'herolevel') Audio.play('levelUp')
      else if (e.kind === 'paragon') Audio.play('victory')
      else if (e.kind === 'gameover') Audio.play(e.reason === 'won' ? 'victory' : 'gameOver')
    })
  }

  function sweep (queue, from, fn) {
    if (from > queue.length) from = 0     // the sim trimmed the queue; resync
    for (let i = from; i < queue.length; i++) fn(queue[i])
    return queue.length
  }

  Audio.debug = function () {
    const S = Audio.state
    return {
      ready: !!S.ctx, unlocked: S.unlocked, muted: S.muted,
      voices: S.voices, suppressed: S.suppressed,
      sounds: Object.keys(BANK).length,
      music: S.music ? S.music.mood : null
    }
  }

  OP.Audio = Audio
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

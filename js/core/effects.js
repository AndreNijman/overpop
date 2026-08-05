;(function (OP) {
  'use strict'

  /* Status effects on balloons.

     Every effect is a plain record so it serialises, and stacking is resolved by
     a documented policy per kind rather than by whatever order things happened
     to be applied in. Order-dependent stacking is the classic source of "two
     identical towers give different results depending on placement order". */

  const Effects = {}

  // strongest : only the largest magnitude of this kind applies (slows)
  // refresh   : reapplying resets the timer, magnitude unchanged (stuns)
  // stack     : magnitudes add, capped (damage-over-time, brittleness)
  const KINDS = {
    cold: { stacking: 'strongest', slows: true, label: 'Chilled' },
    glue: { stacking: 'strongest', slows: true, label: 'Glued' },
    stun: { stacking: 'refresh', slows: true, label: 'Stunned' },
    acid: { stacking: 'stack', dot: true, label: 'Corroding', cap: 40 },
    burn: { stacking: 'stack', dot: true, label: 'Burning', cap: 40 },
    brittle: { stacking: 'strongest', amplify: true, label: 'Brittle', cap: 3 }
  }

  Effects.KINDS = KINDS

  /**
   * @param {string} kind
   * @param {number} duration  seconds
   * @param {number} magnitude for slows: fraction of speed removed (0..1)
   *                           for dots: damage per second
   *                           for brittle: extra damage multiplier - 1
   * @param {number} sourceId  tower id, for attribution
   * @param {string} dmgType   damage type a dot deals (immunity still applies)
   */
  Effects.make = function (kind, duration, magnitude, sourceId, dmgType) {
    return {
      kind: kind,
      t: duration,
      mag: magnitude,
      src: sourceId | 0,
      dmg: dmgType || OP.DMG.NORMAL,
      acc: 0   // fractional damage carried between ticks, so a 0.5/s dot works
    }
  }

  Effects.copy = function (e) {
    return { kind: e.kind, t: e.t, mag: e.mag, src: e.src, dmg: e.dmg, acc: e.acc }
  }

  Effects.serialize = Effects.copy
  Effects.deserialize = Effects.copy

  /**
   * Apply an effect to a balloon, honouring the tier's resistances.
   * Returns true if anything changed.
   */
  Effects.apply = function (b, e) {
    const tier = OP.BALLOON_TIERS[b.tier]
    const spec = KINDS[e.kind]
    if (!spec) return false

    // A tier immune to the effect's damage type ignores its damage-over-time
    // entirely — a white balloon does not take cold damage from being chilled.
    if (spec.dot && tier.immuneSet[e.dmg]) return false

    // Cold cannot chill something already immune to cold.
    if (e.kind === 'cold' && tier.immuneSet.cold) return false

    if (spec.slows && tier.blimp) {
      if (e.kind === 'stun' && tier.stunImmune) return false
      // Blimps resist slows rather than ignoring them.
      const resist = tier.slowResist === undefined ? 1 : tier.slowResist
      e = Effects.copy(e)
      e.mag *= resist
      if (e.mag <= 0.001) return false
    }

    const existing = findKind(b, e.kind)
    if (!existing) { b.effects.push(Effects.copy(e)); return true }

    switch (spec.stacking) {
      case 'refresh':
        existing.t = Math.max(existing.t, e.t)
        return true
      case 'stack':
        existing.mag = Math.min(spec.cap || Infinity, existing.mag + e.mag)
        existing.t = Math.max(existing.t, e.t)
        return true
      case 'strongest':
      default:
        if (e.mag > existing.mag) { existing.mag = e.mag; existing.src = e.src }
        existing.t = Math.max(existing.t, e.t)
        return true
    }
  }

  function findKind (b, kind) {
    for (let i = 0; i < b.effects.length; i++) if (b.effects[i].kind === kind) return b.effects[i]
    return null
  }
  Effects.find = findKind

  Effects.has = function (b, kind) { return !!findKind(b, kind) }

  /** Extra damage multiplier from brittleness. 1 when unaffected. */
  Effects.damageMultiplier = function (b) {
    const e = findKind(b, 'brittle')
    return e ? 1 + e.mag : 1
  }

  /**
   * Step 5 of the update order: tick durations, apply damage-over-time, and
   * recompute speedMul from scratch.
   *
   * Recomputing rather than incrementally adjusting matters: an incremental
   * speedMul drifts as effects expire and eventually leaves a balloon
   * permanently slowed by a freeze that ended ten rounds ago.
   */
  Effects.tick = function (sim) {
    const list = sim.balloons
    const dt = OP.DT
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue

      let slowest = 0      // largest single slow fraction
      let dot = 0          // total damage per second
      let dotType = OP.DMG.NORMAL
      let w = 0

      for (let e = 0; e < b.effects.length; e++) {
        const eff = b.effects[e]
        eff.t -= dt
        if (eff.t <= 0) continue     // dropped by the compaction below

        const spec = KINDS[eff.kind]
        if (spec.slows && eff.mag > slowest) slowest = eff.mag
        if (spec.dot) { dot += eff.mag; dotType = eff.dmg }

        b.effects[w++] = eff
      }
      b.effects.length = w

      b.speedMul = Math.max(0, 1 - Math.min(1, slowest))

      if (dot > 0) {
        // Accumulate fractional damage so a 0.5/s corrosion actually lands
        // instead of rounding to nothing every tick.
        b.dotAcc = (b.dotAcc || 0) + dot * dt
        if (b.dotAcc >= 1) {
          const whole = Math.floor(b.dotAcc)
          b.dotAcc -= whole
          OP.Damage.hit(sim, b, { damage: whole, dmgType: dotType, sourceId: -1, fromEffect: true })
        }
      }
    }
  }

  /** Remove every effect — used when a balloon is recycled. */
  Effects.clear = function (b) { b.effects.length = 0; b.dotAcc = 0; b.speedMul = 1 }

  OP.Effects = Effects
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

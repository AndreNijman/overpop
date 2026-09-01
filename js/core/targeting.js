;(function (OP) {
  'use strict'

  const M = OP.M

  /* Target acquisition.

     One entry point, so the camo rule has one home. See ARCHITECTURE.md §5.

     Two properties are load-bearing:

     - **The camo gate lives here and in AoE candidate filtering, both.** VEILED is
       a *targeting* restriction, not damage immunity. Enforce it in only one of
       the two places and camo leaks through the other.

     - **Ties break on ascending balloon id, never on iteration order.** Grid
       bucket order is an implementation detail of the spatial hash; letting it
       decide which of two equidistant balloons gets shot would make the sim
       depend on grid geometry, and replays would diverge the moment cell size
       changed. */

  const Targeting = {}

  /* ---------- comparators ----------
     compare(sim, a, b) < 0  means `a` is the better target.
     Every comparator must end with the id tiebreak. */

  function remainingOf (sim, b) {
    return sim.map.paths[b.path].length - b.t
  }

  function strengthOf (b) {
    return b.isBoss ? b.hp : OP.remainingRBE(b)
  }

  const COMPARATORS = {
    first: {
      label: 'First',
      hint: 'Whatever is closest to leaking.',
      compare: function (sim, a, b) {
        const d = remainingOf(sim, a) - remainingOf(sim, b)
        return d !== 0 ? d : a.id - b.id
      }
    },
    last: {
      label: 'Last',
      hint: 'Whatever is furthest from the exit.',
      compare: function (sim, a, b) {
        const d = remainingOf(sim, b) - remainingOf(sim, a)
        return d !== 0 ? d : a.id - b.id
      }
    },
    close: {
      label: 'Close',
      hint: 'Whatever is nearest this tower.',
      compare: function (sim, a, b) {
        const d = a._tdist - b._tdist
        return d !== 0 ? d : a.id - b.id
      }
    },
    strong: {
      label: 'Strong',
      hint: 'Whatever has the most layers left. Ties go to First.',
      compare: function (sim, a, b) {
        const d = strengthOf(b) - strengthOf(a)
        if (d !== 0) return d
        const r = remainingOf(sim, a) - remainingOf(sim, b)
        return r !== 0 ? r : a.id - b.id
      }
    }
  }

  OP.TARGET_COMPARATORS = COMPARATORS

  /** Families may add modes (a sniper's anti-blimp priority, say) without
      touching this file — which is what keeps the P3 fan-out from serialising. */
  Targeting.registerMode = function (key, spec) {
    if (COMPARATORS[key]) throw new Error('targeting mode already registered: ' + key)
    if (typeof spec.compare !== 'function') throw new Error('targeting mode needs a compare(): ' + key)
    COMPARATORS[key] = { label: spec.label || key, hint: spec.hint || '', compare: spec.compare }
    return key
  }

  Targeting.modeLabel = function (key) { return (COMPARATORS[key] || { label: key }).label }
  Targeting.modeHint = function (key) { return (COMPARATORS[key] || { hint: '' }).hint }
  Targeting.hasMode = function (key) { return !!COMPARATORS[key] }

  /* ---------- line of sight ---------- */

  /**
   * Can this tower see that point? Maps declare `blockers` as axis-aligned rects
   * (rock outcrops, buildings). A tower with `s.ignoresLOS` — anything lobbing
   * over terrain — skips the check entirely.
   */
  Targeting.hasLineOfSight = function (sim, x1, y1, x2, y2) {
    const blockers = sim.map.blockers
    if (!blockers || !blockers.length) return true
    for (let i = 0; i < blockers.length; i++) {
      const r = blockers[i]
      if (M.segRectHit(x1, y1, x2, y2, r.x, r.y, r.w, r.h)) return false
    }
    return true
  }

  /* ---------- validity ---------- */

  /**
   * Is this balloon a legal target for this tower right now?
   * Assumes the range check already happened (the grid query does it).
   */
  Targeting.isValid = function (sim, tower, b) {
    if (!b.alive) return false
    const s = tower.s

    if (b.isBoss) {
      if (s.noBlimps) return false
      if (!s.ignoresLOS && !Targeting.hasLineOfSight(sim, tower.x, tower.y, b.x, b.y)) return false
      return true
    }

    // The camo gate. Enforced here and in OP.Damage.blast — both, or camo leaks.
    if ((b.props & OP.PROP.VEILED) && !s.camoDetect) return false

    const tier = OP.BALLOON_TIERS[b.tier]
    if (s.onlyBlimps && !tier.blimp) return false
    if (s.noBlimps && tier.blimp) return false

    if (!s.ignoresLOS && !Targeting.hasLineOfSight(sim, tower.x, tower.y, b.x, b.y)) return false

    return true
  }

  /**
   * Fill `out` with every legal target in range, id-sorted.
   * `out` is caller-owned; nothing is allocated per call.
   */
  Targeting.candidates = function (sim, tower, out) {
    const s = tower.s
    OP.Grid.queryCircle(sim.grid, tower.x, tower.y, s.range, out)
    let w = 0
    for (let i = 0; i < out.length; i++) {
      const b = out[i]
      if (!Targeting.isValid(sim, tower, b)) continue
      // Cached for the `close` comparator so it isn't recomputed per comparison.
      b._tdist = M.dist2(tower.x, tower.y, b.x, b.y)
      out[w++] = b
    }
    out.length = w
    const boss = sim.boss
    if (boss && boss.alive && M.dist2(tower.x, tower.y, boss.x, boss.y) <= s.range * s.range &&
        Targeting.isValid(sim, tower, boss)) {
      boss._tdist = M.dist2(tower.x, tower.y, boss.x, boss.y)
      out.push(boss)
    }
    return out
  }

  /**
   * The single best target for `mode`, or -1.
   * Returns an **id**, not the object, so tower state stays serialisable.
   */
  Targeting.acquire = function (sim, tower, mode) {
    const cmp = COMPARATORS[mode] || COMPARATORS.first
    const scratch = sim._targetScratch || (sim._targetScratch = [])
    Targeting.candidates(sim, tower, scratch)
    if (!scratch.length) return -1

    let best = scratch[0]
    for (let i = 1; i < scratch.length; i++) {
      if (cmp.compare(sim, scratch[i], best) < 0) best = scratch[i]
    }
    return best.id
  }

  /**
   * The best `max` targets for `mode`, as ids, best first.
   * For towers that fire several shots at distinct balloons.
   */
  Targeting.acquireMany = function (sim, tower, mode, max, out) {
    const cmp = COMPARATORS[mode] || COMPARATORS.first
    const scratch = sim._targetScratch || (sim._targetScratch = [])
    Targeting.candidates(sim, tower, scratch)
    out.length = 0
    if (!scratch.length) return out

    // Copy, because sorting the shared scratch would surprise the next caller.
    const list = scratch.slice()
    list.sort(function (a, b) { return cmp.compare(sim, a, b) })
    const n = Math.min(max, list.length)
    for (let i = 0; i < n; i++) out.push(list[i].id)
    return out
  }

  /** Is anything at all shootable? Cheap pre-check before a full acquire. */
  Targeting.hasTarget = function (sim, tower) {
    const scratch = sim._targetScratch || (sim._targetScratch = [])
    Targeting.candidates(sim, tower, scratch)
    return scratch.length > 0
  }

  /**
   * Keep an existing target if it is still legal, otherwise acquire a new one.
   * Towers with wind-up or a burst should use this so they don't twitch between
   * equally-valid targets every tick.
   */
  Targeting.retainOrAcquire = function (sim, tower, mode) {
    if (tower.targetId >= 0) {
      const held = sim.byId.get(tower.targetId)
      if (held && held.alive && Targeting.isValid(sim, tower, held) &&
          M.dist2(tower.x, tower.y, held.x, held.y) <= tower.s.range * tower.s.range) {
        return tower.targetId
      }
    }
    tower.targetId = Targeting.acquire(sim, tower, mode)
    return tower.targetId
  }

  /** Where to aim to intercept a moving balloon. Falls back to its position when
      the projectile is too slow to lead. */
  Targeting.leadPoint = function (sim, tower, b, projSpeed, out) {
    out = out || { x: 0, y: 0 }
    if (!projSpeed || projSpeed <= 0) { out.x = b.x; out.y = b.y; return out }

    const track = sim.map.paths[b.path]
    const tier = b.isBoss ? null : OP.BALLOON_TIERS[b.tier]
    const bSpeed = b.isBoss
      ? b.speed * OP.BASE_SPEED * b.speedMul
      : tier.speed * OP.BASE_SPEED * b.speedMul * b.speedScale

    // Iterate twice: guess flight time from current distance, refine once.
    let flight = Math.sqrt(M.dist2(tower.x, tower.y, b.x, b.y)) / projSpeed
    for (let i = 0; i < 2; i++) {
      track.posInto(Math.min(track.length, b.t + bSpeed * flight), out)
      flight = Math.sqrt(M.dist2(tower.x, tower.y, out.x, out.y)) / projSpeed
    }
    return out
  }

  OP.Targeting = Targeting
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

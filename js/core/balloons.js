;(function (OP) {
  'use strict'

  const M = OP.M
  const P = OP.PROP

  /* Balloon entities.

     A balloon is a *tier index* plus position and state — not a subclass, not a
     new object per layer. Popping a layer in a single-child chain mutates the
     tier in place and keeps the entity id, which is what makes two things fall
     out for free:

       - regen can never climb past a split, because a split creates new
         entities whose spawnTier is their own tier;
       - the layer-cascade rule (ARCHITECTURE.md §3) is just "keep going while
         the chain is single-child".

     Entities are pooled and every field is a primitive, so the whole live set
     serialises for mid-round save (§0). */

  const Balloons = {}

  /* ---------- RBE ---------- */

  const rbeMemo = Object.create(null)

  /** Red-balloon-equivalent of a full, undamaged tier. Computed, never tabled. */
  OP.balloonRBE = function (key, depth) {
    if (rbeMemo[key] !== undefined) return rbeMemo[key]
    depth = depth || 0
    if (depth > OP.MAX_CASCADE_DEPTH) throw new Error('balloon child cycle at tier ' + key)
    const tier = OP.tierByKey(key)
    let total = tier.hp
    for (let i = 0; i < tier.children.length; i++) {
      const c = tier.children[i]
      total += c.count * OP.balloonRBE(c.tier, depth + 1)
    }
    rbeMemo[key] = total
    return total
  }

  /** RBE a *live* balloon still represents: its remaining layer HP plus children. */
  OP.remainingRBE = function (b) {
    const tier = OP.BALLOON_TIERS[b.tier]
    let total = b.hp
    for (let i = 0; i < tier.children.length; i++) {
      total += tier.children[i].count * OP.balloonRBE(tier.children[i].tier)
    }
    return total
  }

  /** Full layer HP for a tier, accounting for PLATED. */
  OP.layerHP = function (tier, props) {
    return (props & P.PLATED) ? tier.hp * 2 : tier.hp
  }

  /* ---------- pool ---------- */

  function blank () {
    return {
      id: 0, alive: false,
      tier: 0, spawnTier: 0,
      path: 0, t: 0,
      x: 0, y: 0, prevX: 0, prevY: 0,
      hp: 1,
      props: 0,
      speedMul: 1,
      regenT: 0,
      depth: 0,
      dotAcc: 0,
      effects: [],
      // Set by the round runner so freeplay scaling is per-balloon rather than a
      // hidden global read at damage time.
      hpScale: 1, speedScale: 1
    }
  }

  Balloons.reset = function (sim) {
    sim.balloons = []
    sim.balloonPool = []
    sim.byId = new Map()
  }

  /**
   * @param {object} sim
   * @param {{tier:string|number, path?:number, t?:number, props?:number,
   *          depth?:number, hpScale?:number, speedScale?:number}} def
   */
  Balloons.spawn = function (sim, def) {
    if (sim.balloons.length >= OP.MAX_BALLOONS) return null

    const ti = typeof def.tier === 'number' ? def.tier : OP.tierIndex(def.tier)
    const tier = OP.BALLOON_TIERS[ti]

    const b = sim.balloonPool.pop() || blank()
    b.id = sim.nextEntityId++
    b.alive = true
    b.tier = ti
    b.spawnTier = ti
    b.path = def.path || 0
    b.t = def.t || 0
    b.props = (def.props || 0) | tier.props
    b.speedMul = 1
    b.regenT = 0
    b.depth = def.depth || 0
    b.dotAcc = 0
    b.effects.length = 0
    b.hpScale = def.hpScale || 1
    b.speedScale = def.speedScale || 1
    b.hp = Math.max(1, Math.round(OP.layerHP(tier, b.props) * b.hpScale))

    const track = sim.map.paths[b.path]
    track.posInto(b.t, b)
    b.prevX = b.x
    b.prevY = b.y

    sim.balloons.push(b)
    sim.byId.set(b.id, b)
    if (sim.grid) OP.Grid.insert(sim.grid, b)
    sim.stats.spawned++
    return b
  }

  Balloons.get = function (sim, id) { return sim.byId.get(id) }

  Balloons.kill = function (sim, b) {
    if (!b.alive) return
    b.alive = false
    sim.byId.delete(b.id)
  }

  /* ---------- children ---------- */

  /**
   * Spawn the children of `parent` and retire it. Used by the damage resolver
   * when a tier splits into more than one child.
   *
   * Children are fanned along the track by CHILD_SPREAD so a cluster does not
   * render or collide as a single point. The fan is symmetric and index-derived,
   * never random — a split must not consume sim randomness, or replaying a
   * damage event would desync.
   */
  Balloons.spawnChildren = function (sim, parent, out) {
    const tier = OP.BALLOON_TIERS[parent.tier]
    if (!tier.children.length) return 0
    if (parent.depth >= OP.MAX_CASCADE_DEPTH) return 0

    let total = 0
    for (let i = 0; i < tier.children.length; i++) total += tier.children[i].count

    let n = 0
    let made = 0
    for (let ci = 0; ci < tier.children.length; ci++) {
      const spec = tier.children[ci]
      for (let k = 0; k < spec.count; k++) {
        const offset = OP.CHILD_SPREAD * (n - (total - 1) / 2)
        const child = Balloons.spawn(sim, {
          tier: spec.tier,
          path: parent.path,
          t: Math.max(0, parent.t + offset),
          // Children inherit VEILED and PLATED. REGEN is inherited but its timer
          // restarts, because the child is a fresh layer.
          props: parent.props,
          depth: parent.depth + 1,
          hpScale: parent.hpScale,
          speedScale: parent.speedScale
        })
        n++
        if (child) {
          // Carry status effects across the split — a frozen ceramic should not
          // release two rainbows at full speed.
          for (let e = 0; e < parent.effects.length; e++) {
            child.effects.push(OP.Effects.copy(parent.effects[e]))
          }
          if (out) out.push(child.id)
          made++
        }
      }
    }
    return made
  }

  /* ---------- per-tick systems ---------- */

  /** Step 3 of the update order: advance along the track. */
  Balloons.move = function (sim) {
    const list = sim.balloons
    const dt = OP.DT
    const base = OP.BASE_SPEED
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue
      b.prevX = b.x
      b.prevY = b.y
      if (b.speedMul <= 0) continue
      const tier = OP.BALLOON_TIERS[b.tier]
      b.t += tier.speed * base * b.speedMul * b.speedScale * dt
      sim.map.paths[b.path].posInto(b.t, b)
    }
  }

  /** Step 4: anything at or past its exit leaks.
      Returns the total life cost and records events; charging lives is the
      economy's job, called from the sim step. Keeping that out of here is what
      lets the balloon model be tested without an economy. */
  Balloons.leakCheck = function (sim) {
    const list = sim.balloons
    let leaked = 0
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive) continue
      const track = sim.map.paths[b.path]
      if (b.t < track.length) continue
      const cost = OP.remainingRBE(b)
      leaked += cost
      sim.stats.leaked += cost
      sim.leakEvents.push({ id: b.id, tier: OP.BALLOON_TIERS[b.tier].key, cost: cost, x: b.x, y: b.y })
      Balloons.kill(sim, b)
    }
    return leaked
  }

  /** Part of step 5: REGEN balloons climb back toward the tier they spawned as. */
  Balloons.regenTick = function (sim) {
    const list = sim.balloons
    const dt = OP.DT
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (!b.alive || !(b.props & P.REGEN)) continue
      if (b.tier >= b.spawnTier) { b.regenT = 0; continue }
      b.regenT += dt
      if (b.regenT < OP.REGEN_PERIOD) continue
      b.regenT -= OP.REGEN_PERIOD
      b.tier++
      const tier = OP.BALLOON_TIERS[b.tier]
      b.hp = Math.max(1, Math.round(OP.layerHP(tier, b.props) * b.hpScale))
      sim.stats.regrown++
    }
  }

  /** Step 11: two-pointer compaction. Order-preserving, so entity iteration
      order stays ascending-by-id and the sim stays deterministic. A swap-remove
      would be faster and would silently make replays diverge. */
  Balloons.compact = function (sim) {
    const list = sim.balloons
    let w = 0
    for (let r = 0; r < list.length; r++) {
      const b = list[r]
      if (b.alive) { list[w++] = b; continue }
      b.effects.length = 0
      sim.balloonPool.push(b)
    }
    list.length = w
  }

  /* ---------- queries ---------- */

  Balloons.count = function (sim) { return sim.balloons.length }

  Balloons.totalRBE = function (sim) {
    let total = 0
    for (let i = 0; i < sim.balloons.length; i++) {
      if (sim.balloons[i].alive) total += OP.remainingRBE(sim.balloons[i])
    }
    return total
  }

  /** The balloon closest to leaking, ignoring camo gating. HUD use only —
      targeting must go through OP.Targeting so the camo rule is enforced. */
  Balloons.leader = function (sim) {
    let best = null, bestRem = Infinity
    for (let i = 0; i < sim.balloons.length; i++) {
      const b = sim.balloons[i]
      if (!b.alive) continue
      const rem = sim.map.paths[b.path].length - b.t
      if (rem < bestRem) { bestRem = rem; best = b }
    }
    return best
  }

  /* ---------- serialisation ---------- */

  Balloons.serialize = function (sim) {
    const out = []
    for (let i = 0; i < sim.balloons.length; i++) {
      const b = sim.balloons[i]
      if (!b.alive) continue
      out.push({
        id: b.id,
        tier: OP.BALLOON_TIERS[b.tier].key,
        spawnTier: OP.BALLOON_TIERS[b.spawnTier].key,
        path: b.path, t: b.t, hp: b.hp, props: b.props,
        regenT: b.regenT, depth: b.depth,
        // The accumulated fraction of a damage-over-time tick. Small, but a save
        // that dropped it would resume a burning balloon slightly healthier.
        dotAcc: b.dotAcc || 0,
        // speedMul is DERIVED from the effect list and recomputed every tick — but
        // the checksum is taken between ticks, so a save made while a balloon was
        // slowed reloaded it at full speed and the checksums disagreed. Persisting
        // it costs one number and removes the discrepancy entirely.
        speedMul: b.speedMul === undefined ? 1 : b.speedMul,
        hpScale: b.hpScale, speedScale: b.speedScale,
        effects: b.effects.map(OP.Effects.serialize)
      })
    }
    return out
  }

  Balloons.deserialize = function (sim, arr) {
    Balloons.reset(sim)
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]
      const b = sim.balloonPool.pop() || blank()
      b.id = s.id
      b.alive = true
      b.tier = OP.tierIndex(s.tier)
      b.spawnTier = OP.tierIndex(s.spawnTier)
      b.path = s.path
      b.t = s.t
      b.hp = s.hp
      b.props = s.props
      b.regenT = s.regenT
      b.depth = s.depth
      b.dotAcc = s.dotAcc || 0
      b.hpScale = s.hpScale
      b.speedScale = s.speedScale
      b.speedMul = s.speedMul === undefined ? 1 : s.speedMul
      b.effects.length = 0
      for (let e = 0; e < (s.effects || []).length; e++) b.effects.push(OP.Effects.deserialize(s.effects[e]))
      sim.map.paths[b.path].posInto(b.t, b)
      b.prevX = b.x; b.prevY = b.y
      sim.balloons.push(b)
      sim.byId.set(b.id, b)
    }
    // Keep ascending-id iteration order, which the determinism guarantee rests on.
    sim.balloons.sort(function (a, c) { return a.id - c.id })
  }

  OP.Balloons = Balloons
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

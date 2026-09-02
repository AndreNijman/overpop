;(function (OP) {
  'use strict'

  /* The round runner.

     A round is a list of spawn groups. Each group releases `count` balloons of one
     tier, `spacing` seconds apart, starting `delay` seconds into the round. That
     one shape covers everything the game needs: a steady stream, a tight clump
     (spacing 0), a staggered mix (several groups with different delays), and a
     blimp arriving alone at the back.

     Timing is accumulated in whole ticks rather than compared against a float
     clock, so the same round always releases on the same ticks — which is what
     makes a determinism checksum meaningful.

     Round data lives in js/data/rounds-standard.js and rounds-alternate.js. */

  const Rounds = {}

  /**
   * Group shape (as authored in the data files):
   *   { tier, count, spacing, delay, path, props, hpScale, speedScale }
   * Only `tier` and `count` are required.
   */
  Rounds.normalizeGroup = function (g) {
    return {
      tier: g.tier,
      count: g.count === undefined ? 1 : g.count,
      spacing: g.spacing === undefined ? 0.4 : g.spacing,
      delay: g.delay || 0,
      path: g.path === undefined ? -1 : g.path,   // -1 = spread across paths
      props: g.props || 0,
      hpScale: g.hpScale || 0,      // 0 = inherit from rules
      speedScale: g.speedScale || 0
    }
  }

  /** Total RBE of a round definition — the headline number the HUD shows. */
  Rounds.roundRBE = function (def) {
    let total = 0
    for (let i = 0; i < def.groups.length; i++) {
      const g = def.groups[i]
      total += (g.count === undefined ? 1 : g.count) * OP.balloonRBE(g.tier)
    }
    return total
  }

  /** How long a round takes to fully release, in seconds. */
  Rounds.roundDuration = function (def) {
    let longest = 0
    for (let i = 0; i < def.groups.length; i++) {
      const g = Rounds.normalizeGroup(def.groups[i])
      const end = g.delay + Math.max(0, g.count - 1) * g.spacing
      if (end > longest) longest = end
    }
    return longest
  }

  /* ---------- starting a round ---------- */

  /**
   * Arm the runner for `roundIndex`. Does not spawn anything yet — the first
   * release happens on the next Rounds.tick.
   */
  Rounds.begin = function (sim, roundIndex) {
    const def = Rounds.definition(sim, roundIndex)
    sim.roundIndex = roundIndex
    sim.round = {
      index: roundIndex,
      tick: 0,
      groups: def.groups.map(function (g, i) {
        const n = Rounds.normalizeGroup(g)
        return {
          tier: n.tier,
          remaining: n.count,
          spacing: n.spacing,
          delay: n.delay,
          path: n.path,
          props: n.props,
          hpScale: n.hpScale,
          speedScale: n.speedScale,
          nextTick: Math.round(n.delay / OP.DT),
          seq: i
        }
      }),
      rbe: Rounds.roundRBE(def),
      released: 0,
      done: false
    }
    sim.events.push({ kind: 'roundstart', round: roundIndex, rbe: sim.round.rbe })
    return sim.round
  }

  /**
   * The round definition for an index, from the active round set, falling through
   * to the freeplay generator past the end of the table.
   */
  Rounds.definition = function (sim, roundIndex) {
    const set = sim.roundSet || OP.ROUNDS_STANDARD
    const def = set && set[roundIndex]
    if (def) return def
    if (OP.Freeplay && OP.Freeplay.generate) return OP.Freeplay.generate(sim, roundIndex)

    // Falling through to here means the round table is missing an entry the game
    // asked for. Repeating the last authored round keeps play going, but it is
    // recorded as an error event rather than silently substituted — a quiet
    // substitution here once made a reloaded save diverge from its own future.
    const keys = set ? Object.keys(set) : []
    const last = keys.length ? set[keys[keys.length - 1]] : { groups: [{ tier: 'red', count: 10 }] }
    sim.events.push({ kind: 'error', what: 'missing-round', round: roundIndex, set: sim.roundSetKey })
    return last
  }

  /* ---------- per-tick release ---------- */

  /**
   * Step 2 of the update order. Releases whatever is due this tick.
   *
   * Balloons are spread across paths when a group declares `path: -1`, cycling by
   * release index so a two-path map gets an even split without consuming sim
   * randomness.
   */
  Rounds.tick = function (sim) {
    const r = sim.round
    if (!r || r.done) return 0

    const pathCount = sim.map.paths.length
    const rules = sim.rules
    let released = 0

    for (let i = 0; i < r.groups.length; i++) {
      const g = r.groups[i]
      if (g.remaining <= 0) continue

      // A group with spacing 0 dumps its whole count on one tick — that is how a
      // tight clump is authored.
      while (g.remaining > 0 && r.tick >= g.nextTick) {
        const tier = OP.tierByKey(g.tier)
        const b = OP.Balloons.spawn(sim, {
          tier: g.tier,
          path: g.path >= 0 ? Math.min(g.path, pathCount - 1) : (r.released % pathCount),
          t: 0,
          props: g.props,
          hpScale: (g.hpScale || rules.hpScale) * (tier.blimp ? rules.blimpHpMul : 1),
          speedScale: g.speedScale || rules.speedScale
        })
        if (!b) break                      // hit the entity ceiling; try again next tick
        g.remaining--
        r.released++
        released++
        if (g.spacing <= 0) {
          if (g.remaining <= 0) break
          continue                          // same tick
        }
        g.nextTick += Math.max(1, Math.round(g.spacing / OP.DT))
      }
    }

    r.tick++
    return released
  }

  /** Has everything for this round been released? */
  Rounds.allReleased = function (sim) {
    const r = sim.round
    if (!r) return true
    for (let i = 0; i < r.groups.length; i++) if (r.groups[i].remaining > 0) return false
    return true
  }

  /** Is the round over — everything released and nothing left alive? */
  Rounds.isComplete = function (sim) {
    if (!Rounds.allReleased(sim)) return false
    return sim.balloons.length === 0
  }

  /**
   * Called from the sim step once the round is complete. Pays the bonus,
   * shares the round's tower-XP pool out, marks the round done, and either
   * arms the next round or ends a won game.
   */
  Rounds.complete = function (sim) {
    const r = sim.round
    if (!r || r.done) return false
    r.done = true
    sim.stats.roundsCleared++
    if (OP.TowerXp && OP.TowerXp.settle) OP.TowerXp.settle(sim)
    OP.Economy.payRoundBonus(sim)
    sim.events.push({ kind: 'roundend', round: r.index })

    if (r.index >= sim.rules.lastRound && !sim.freeplay) {
      OP.Economy.endGame(sim, 'won')
      return true
    }
    return true
  }

  /** Arm the next round. Called by the shell when the player starts it, or
      immediately when autostart is on. */
  Rounds.next = function (sim) {
    if (sim.over) return null
    return Rounds.begin(sim, sim.roundIndex + 1)
  }

  /* ---------- serialisation ---------- */

  Rounds.serialize = function (sim) {
    const r = sim.round
    if (!r) return null
    return {
      index: r.index, tick: r.tick, released: r.released, rbe: r.rbe, done: r.done,
      groups: r.groups.map(function (g) {
        return {
          tier: g.tier, remaining: g.remaining, spacing: g.spacing, delay: g.delay,
          path: g.path, props: g.props, hpScale: g.hpScale, speedScale: g.speedScale,
          nextTick: g.nextTick, seq: g.seq
        }
      })
    }
  }

  Rounds.deserialize = function (sim, snap) {
    if (!snap) { sim.round = null; return }
    sim.roundIndex = snap.index
    sim.round = {
      index: snap.index, tick: snap.tick, released: snap.released,
      rbe: snap.rbe, done: snap.done,
      groups: snap.groups.map(function (g) { return Object.assign({}, g) })
    }
  }

  OP.Rounds = Rounds
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

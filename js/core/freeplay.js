;(function (OP) {
  'use strict'

  /* Freeplay — rounds past the end of the authored table.

     The authored sets stop at 100. A player who wins and keeps going needs an
     unbounded supply of rounds, and OP.Rounds.definition falls through to here
     for any index the active set does not cover.

     THE ONE RULE THAT MATTERS: a generated round is a pure function of its round
     index. Nothing here reads sim.rng, and nothing here reads mutable sim state.

     The reason is in OP.Sim.deserialize (js/core/sim.js): a save stores the RNG
     *state*, not the sequence of rounds. If round 137 were rolled from sim.rng,
     then saving during round 136 and reloading would produce a different round
     137 to the one the un-interrupted run would have produced — the RNG would
     have been advanced a different number of times by the towers that fired
     before the save. The round table is content, and content must not depend on
     the simulation's entropy budget. Everything below is integer arithmetic on
     roundIndex.

     The only sim field consulted is sim.rules.hpScale / sim.rules.speedScale, and
     only because OP.Rounds.tick treats a per-group scale as an OVERRIDE of the
     rules value (`g.hpScale || rules.hpScale`). A generated round must set those
     fields per group, so it has to fold the rules value in itself or a mode that
     scales HP would silently stop applying in freeplay. Rules are part of the
     save and are restored verbatim, so this stays deterministic across a
     reload. */

  const Freeplay = {}

  // The authored sets are 1..100; anything above is generated.
  Freeplay.LAST_AUTHORED = 100
  Freeplay.FIRST = Freeplay.LAST_AUTHORED + 1

  // Six decimal places. Enough that the scaling curves stay *strictly* increasing
  // for any round anyone will ever reach, without leaking long float tails into
  // every serialised group.
  function q (v) { return Math.round(v * 1e6) / 1e6 }

  /** How far past the authored table this round is. Always at least 1, so a
      short custom round set that runs out early still gets a sane round rather
      than a zero- or negative-scaled one. */
  function overshoot (roundIndex) {
    const n = Math.floor(Number(roundIndex))
    if (!isFinite(n)) return 1
    return Math.max(1, n - Freeplay.LAST_AUTHORED)
  }

  /**
   * The HUD's copy of the difficulty curve — and the single source of truth for
   * the scaling the generator writes into each group.
   *
   *   hpScale    quadratic. Gentle for the first stretch (round 120 is about
   *              1.4x, which a maxed board handles) and then genuinely steep,
   *              because freeplay is meant to end eventually.
   *   speedScale asymptotic, approaching 1.9x but never reaching it. Speed is
   *              the dangerous knob: doubling a pink balloon's speed can put it
   *              past a tower between two ticks, so this one is bounded by
   *              construction rather than by a clamp someone can tune away.
   */
  Freeplay.scaleFor = function (roundIndex) {
    const over = overshoot(roundIndex)
    return {
      hpScale: q(1 + 0.015 * over + 0.00025 * over * over),
      speedScale: q(1 + 0.9 * (over / (60 + over)))
    }
  }

  /* ---------- composition ---------- */

  // Spacing tightens as the rounds climb: the same count arriving over less time.
  // Also keeps a round's release window bounded — without it, a round-500 group
  // of 400 GOLIATHs at 0.45s apart would take three minutes to come out.
  function pace (base, over) {
    return Math.max(0.05, q(base * 60 / (60 + over)))
  }

  /* Entity ceilings. OP.MAX_BALLOONS is 4000 and a released blimp becomes
     thousands of children on the way down, so counts stop growing long before
     the spawner starts refusing balloons. Reached around round 1200; blimp
     density still climbs monotonically for every round below that. */
  const CAP = {
    ceramic: 400, rainbow: 80, goliath: 600, wraith: 400,
    leviathan: 300, colossus: 200, omen: 100
  }

  function capped (key, n) { return Math.min(CAP[key], n) }

  /**
   * The round definition for `roundIndex`. Same shape as an authored round:
   * `{ groups: [...] }` with plain-data groups.
   *
   * @param {object|null} sim  only sim.rules is read; may be null
   * @param {number} roundIndex
   */
  Freeplay.generate = function (sim, roundIndex) {
    const over = overshoot(roundIndex)
    const sc = Freeplay.scaleFor(Freeplay.LAST_AUTHORED + over)

    const rules = (sim && sim.rules) || null
    const ruleHp = rules && rules.hpScale > 0 ? rules.hpScale : 1
    const ruleSpeed = rules && rules.speedScale > 0 ? rules.speedScale : 1
    const hpScale = q(sc.hpScale * ruleHp)
    const speedScale = q(sc.speedScale * ruleSpeed)

    const P = OP.PROP

    // Property rotation. Derived from `over` so it is fixed per round index, and
    // offset by different moduli so a round rarely gets all three at once.
    const chaff = (over % 3 === 0 ? P.VEILED : 0) | (over % 4 === 0 ? P.REGEN : 0)
    const shell = (over % 5 === 0 ? P.PLATED : 0)
    const blimpProps = (over % 6 === 0 ? P.VEILED : 0)

    // Blimp density climbs on three different periods, so the mix keeps changing
    // instead of every round being the previous one plus a bit.
    const counts = {
      ceramic: capped('ceramic', 24 + Math.floor(over / 4) * 2 + (over % 11) * 4),
      rainbow: capped('rainbow', 20 + (over % 9) * 3),
      goliath: capped('goliath', 10 + over + (over % 7) * 2),
      wraith: capped('wraith', 6 + Math.floor(over / 2) + (over % 5)),
      leviathan: capped('leviathan', 5 + Math.floor(over / 3)),
      colossus: capped('colossus', 4 + Math.floor(over / 5)),
      omen: capped('omen', 3 + Math.floor(over / 12))
    }

    const plan = [
      ['ceramic', counts.ceramic, 0.22, 0, chaff],
      ['rainbow', counts.rainbow, 0.30, 1.5, shell],
      ['goliath', counts.goliath, 0.45, 3, blimpProps],
      ['wraith', counts.wraith, 1.10, 5, 0],
      ['leviathan', counts.leviathan, 1.60, 7, 0],
      ['colossus', counts.colossus, 2.00, 9, 0],
      ['omen', counts.omen, 2.60, 11, 0]
    ]

    const groups = []
    for (let i = 0; i < plan.length; i++) {
      const row = plan[i]
      if (!(row[1] > 0)) continue
      groups.push({
        tier: row[0],
        count: row[1],
        spacing: pace(row[2], over),
        delay: row[3],
        path: -1,
        props: row[4],
        hpScale: hpScale,
        speedScale: speedScale
      })
    }

    // Belt and braces. Every count above starts at 3 or more, so this cannot
    // trigger today — but an empty round would silently complete the instant it
    // began and hand the player a free round bonus forever, which is a worse
    // failure than a hardcoded fallback wave.
    if (!groups.length) {
      groups.push({
        tier: 'ceramic', count: 24, spacing: 0.2, delay: 0, path: -1, props: 0,
        hpScale: hpScale, speedScale: speedScale
      })
    }

    return { groups: groups }
  }

  OP.Freeplay = Freeplay
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

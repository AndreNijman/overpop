;(function (OP) {
  'use strict'

  /* Freeplay â€” rounds past the end of the authored table.

     The authored sets stop at 100. A player who wins and keeps going needs an
     unbounded supply of rounds, and OP.Rounds.definition falls through to here
     for any index the active set does not cover.

     THE ONE RULE THAT MATTERS: a generated round is a pure function of its round
     index. Nothing here reads sim.rng, and nothing here reads mutable sim state.

     The reason is in OP.Sim.deserialize (js/core/sim.js): a save stores the RNG
     *state*, not the sequence of rounds. If round 137 were rolled from sim.rng,
     then saving during round 136 and reloading would produce a different round
     137 to the one the un-interrupted run would have produced â€” the RNG would
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
   * The HUD's copy of the difficulty curve â€” and the single source of truth for
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
  // Also keeps a round's release window bounded â€” without it, a round-500 group
  // of 400 GOLIATHs at 0.45s apart would take three minutes to come out.
  function pace (base, over) {
    return Math.max(0.05, q(base * 60 / (60 + over)))
  }

  /* Entity ceilings. OP.MAX_BALLOONS is 4000 and a released blimp becomes
     hundreds of children on the way down, so counts stop growing long before the
     spawner starts refusing balloons: every cap together is 1730 balloons of
     initial release, leaving more than half the pool for the cascade. The first
     blimp cap binds around round 345; below that, blimp density climbs every
     single round. */
  const CAP = {
    ceramic: 300, rainbow: 150, goliath: 500, wraith: 300,
    leviathan: 250, colossus: 150, omen: 80
  }

  function capped (key, n) { return Math.min(CAP[key], n) }

  /* Blimp packs arrive on one tick on a rotation, but only while the pack is
     small enough for that to read as a formation rather than a single sprite
     with eighty blimps stacked inside it. */
  function spacingFor (base, over, clump, count) {
    return clump && count <= 8 ? 0 : pace(base, over)
  }

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

    /* Counts grow on five different periods, so the mix shifts as the rounds
       climb â€” the GOLIATH count piles up fastest, the OMEN count slowest.

       Every term here is monotonically non-decreasing in `over`, and the GOLIATH
       term rises every single round, so both blimp density and round RBE
       increase strictly from one freeplay round to the next. That is the reason
       the round-to-round variety below lives in spacing, delays and properties
       rather than in the counts: a `over % 7` term in a count looks like harmless
       texture and actually makes round 108 lighter than round 107. */
    const counts = {
      ceramic: capped('ceramic', 24 + Math.floor(over / 2) * 3),
      rainbow: capped('rainbow', 20 + Math.floor(over / 3) * 2),
      goliath: capped('goliath', 10 + over * 2),
      wraith: capped('wraith', 6 + Math.floor(over / 2)),
      leviathan: capped('leviathan', 5 + Math.floor(over / 3)),
      // The base blimp counts are set so that round 101 is heavier than round 100
      // of either authored set. A dip at the seam would hand a player who just
      // won the game an easier round than the one they beat.
      colossus: capped('colossus', 6 + Math.floor(over / 5)),
      omen: capped('omen', 5 + Math.floor(over / 12))
    }

    // tier, count, base spacing, delay, props, arrives-as-one-tick-clump
    const plan = [
      ['ceramic', counts.ceramic, over % 2 === 0 ? 0.18 : 0.26, 0, chaff, false],
      ['rainbow', counts.rainbow, 0.30, 1.5, shell, false],
      ['goliath', counts.goliath, 0.45, 3 + (over % 3), blimpProps, false],
      ['wraith', counts.wraith, 1.10, 5, 0, over % 4 === 0],
      ['leviathan', counts.leviathan, 1.60, 7, 0, over % 3 === 0],
      ['colossus', counts.colossus, 2.00, 9, 0, over % 5 === 0],
      ['omen', counts.omen, 2.60, 11, 0, over % 7 === 0]
    ]

    const groups = []
    for (let i = 0; i < plan.length; i++) {
      const row = plan[i]
      if (!(row[1] > 0)) continue
      groups.push({
        tier: row[0],
        count: row[1],
        spacing: spacingFor(row[2], over, row[5], row[1]),
        delay: row[3],
        path: -1,
        props: row[4],
        hpScale: hpScale,
        speedScale: speedScale
      })
    }

    // Belt and braces. Every count above starts at 3 or more, so this cannot
    // trigger today â€” but an empty round would silently complete the instant it
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

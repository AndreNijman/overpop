;(function (OP) {
  'use strict'

  /* Difficulties.

     A difficulty is a pure config delta over OP.Economy.defaultRules(), layered by
     OP.Sim.resolveRules as: defaults -> difficulty -> mode -> explicit overrides.
     Nothing in the simulation asks which difficulty is running; it only reads
     sim.rules. That is what keeps four difficulties from becoming four subtly
     divergent engines (ARCHITECTURE.md §8).

     Two rules therefore matter more than any single number here:

     1. Every field named below must be a real field of Economy.defaultRules(),
        or a field some core file genuinely reads. A misspelt rule name does not
        throw — it lands on sim.rules, is never read, and the difficulty silently
        does nothing. tools/suites/modes.mjs asserts there are no unknown keys.

     2. `medium` is the reference balance, so every value it names is IDENTICAL to
        the engine default. Medium is the identity delta: it exists so the menu has
        a middle entry and so a save records which difficulty was played, not to
        nudge anything. All of easy's generosity lives on easy.

     Income scales down as difficulty rises (cashPerPopMul, roundBonusMul) while
     prices scale up (costMul), so the squeeze comes from both sides rather than
     from one large multiplier that would make one field carry the whole curve.

     heroXpMul: read by OP.Heroes.xpRate. A hundred-round Relentless run pops far
     more layers than a forty-round Easy run, so a flat rate would see a hero cap
     out a third of the way through Relentless while never passing the mid teens on
     Easy. The multiplier is what makes "level 20 arrives late in the run" mean the
     same thing at both ends of the ladder. */

  const DIFFICULTIES = {
    easy: {
      key: 'easy',
      name: 'Easy',
      blurb: 'Forty rounds, cheaper critters and a deep pool of lives. Room to learn what each tower actually does.',
      rules: {
        startLives: 200,
        startCash: 650,
        costMul: 0.85,
        cashPerPopMul: 1.1,
        roundBonusMul: 1.1,
        heroXpMul: 1.35,
        firstRound: 1,
        lastRound: 40
      }
    },

    medium: {
      key: 'medium',
      name: 'Medium',
      blurb: 'The reference balance. Sixty rounds at honest prices, with no thumb on either side of the scale.',
      rules: {
        // Every one of these equals the engine default, deliberately. See the
        // header note: medium is the identity delta.
        startLives: 150,
        startCash: 650,
        costMul: 1,
        cashPerPopMul: 1,
        roundBonusMul: 1,
        heroXpMul: 1,
        firstRound: 1,
        lastRound: 60
      }
    },

    hard: {
      key: 'hard',
      name: 'Hard',
      blurb: 'Eighty rounds, opening on round three. Towers cost more, pops pay less, and the early lead never arrives.',
      rules: {
        startLives: 100,
        startCash: 650,
        costMul: 1.08,
        cashPerPopMul: 0.9,
        roundBonusMul: 0.9,
        heroXpMul: 0.85,
        firstRound: 3,
        lastRound: 80
      }
    },

    relentless: {
      key: 'relentless',
      name: 'Relentless',
      blurb: 'One life, a hundred rounds, and the same starting cash as everyone else. A single leak ends the run.',
      rules: {
        startLives: 1,
        startCash: 650,
        costMul: 1.2,
        cashPerPopMul: 0.8,
        roundBonusMul: 0.8,
        heroXpMul: 0.7,
        firstRound: 6,
        lastRound: 100
      }
    }
  }

  /* Menu order, easiest first. Load-bearing: the harness drives its monotonicity
     checks through this array, and the difficulty-select screen renders it. */
  OP.DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'relentless']

  /** Position on the ladder, or -1. Used for gating and for save-file sorting. */
  OP.difficultyRank = function (key) {
    return OP.DIFFICULTY_ORDER.indexOf(key)
  }

  OP.DIFFICULTIES = DIFFICULTIES
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

;(function (OP) {
  'use strict'

  /* Game modes.

     A mode is a CONFIG DELTA. Nothing in the simulation branches on a mode name —
     there is no `if (sim.mode === 'half-cash')` anywhere, and there must never be
     one. A mode says what it changes by naming fields on sim.rules, and the engine
     that already honours those fields does the rest (ARCHITECTURE.md §8).

     That constraint is the whole reason eleven modes are affordable. The moment one
     mode earns a code path, every later feature has to be tested against it
     separately, and the eleven become eleven engines. Concretely: while writing
     these I wanted "denser waves" for Onslaught and "no consumable powers" for
     PURIST. Neither has a rule field, so neither is here — see the notes on those
     two entries. The fix for a missing mode behaviour is a new rule field in
     Economy.defaultRules() plus the one engine site that reads it, not a branch.

     Layering, from OP.Sim.resolveRules: defaults -> difficulty -> mode -> explicit
     overrides. Note that layering ASSIGNS rather than composes. A mode that sets
     cashPerPopMul: 0.5 REPLACES the difficulty's value; it does not halve it. So
     Half Cash on Hard pays 0.5 per pop, not 0.9 * 0.5 = 0.45. Every mode figure
     below is therefore absolute and is written relative to the engine default of 1.

     A misspelt rule name is silent — it lands on sim.rules, nothing reads it, and
     the mode does nothing at all. tools/suites/modes.mjs asserts that every field
     named here is real. */

  const MODES = {
    standard: {
      key: 'standard',
      name: 'Standard',
      blurb: 'The game as designed. The difficulty decides everything; the mode changes nothing at all.',
      // The identity delta, on purpose. Standard exists so the mode select has a
      // default and so a save records that no delta was applied.
      rules: {}
    },

    'primary-only': {
      key: 'primary-only',
      name: 'Primary Only',
      blurb: 'Only the primary critters may be placed. No village support, no magic, no artillery — just fundamentals.',
      rules: { families: ['primary'] }
    },

    'military-only': {
      key: 'military-only',
      name: 'Military Only',
      blurb: 'Only the military critters may be placed. Plenty of raw damage, and nothing that sees a veiled balloon for free.',
      rules: { families: ['military'] }
    },

    'magic-only': {
      key: 'magic-only',
      name: 'Magic Only',
      blurb: 'Only the magic critters may be placed. Strong against ceramics and blimps, thin against anything immune.',
      rules: { families: ['magic'] }
    },

    deflation: {
      key: 'deflation',
      name: 'Deflation',
      blurb: 'One fixed pile of cash, mid-game rounds, and not a coin more. Every purchase is spent from a budget that never refills.',
      rules: {
        startCash: 20000,   // the entire budget for the run
        cashPerPopMul: 0,   // pops pay nothing
        roundBonusMul: 0,   // and neither does surviving a round
        allowIncome: false, // so income towers cannot reopen the tap
        firstRound: 31      // starts mid-game, where 20k is a real decision
        // lastRound is left to the difficulty: Deflation shortens the run from the
        // front, it does not decide how long the difficulty runs. Selling stays
        // legal — recovering sellRate of a misplacement is the actual puzzle.
      }
    },

    onslaught: {
      key: 'onslaught',
      name: 'Onslaught',
      blurb: 'Tougher, quicker balloons from the first round. The same rounds you know, arriving with more behind them.',
      rules: {
        hpScale: 1.2,
        speedScale: 1.15
        // True density — tighter spacing inside a round — belongs to the round set,
        // not here: there is no spacingMul rule field, and inventing a mode-only
        // code path in Rounds.tick to get one is exactly what §8 forbids. If
        // density is wanted later, add spacingMul to Economy.defaultRules() and
        // read it in Rounds.tick, and this entry gains one line.
      }
    },

    'half-cash': {
      key: 'half-cash',
      name: 'Half Cash',
      blurb: 'Every pop and every round pays half. Prices are untouched, so the whole run is one long income problem.',
      rules: {
        // Absolute, not relative — see the header note on assignment vs composition.
        cashPerPopMul: 0.5,
        roundBonusMul: 0.5
      }
    },

    'double-hp-blimps': {
      key: 'double-hp-blimps',
      name: 'Double HP Blimps',
      blurb: 'Every blimp hull is twice as thick. The balloon rounds are unchanged; the blimp rounds are a different game.',
      // Applies to blimp tiers only, in Rounds.tick. Ordinary balloons are untouched.
      rules: { blimpHpMul: 2 }
    },

    'alternate-waves': {
      key: 'alternate-waves',
      name: 'Alternate Waves',
      blurb: 'A different hundred rounds. Familiar tiers in unfamiliar order, so a memorised build stops working.',
      rules: {},
      // Not a rule: the round table is chosen by key at game start, and the KEY is
      // what a save records so a resumed run continues on the same waves. Route
      // game start through OP.modeConfig() and this reaches sim.roundSetKey.
      roundSetKey: 'alternate'
    },

    reverse: {
      key: 'reverse',
      name: 'Reverse',
      blurb: 'Every track runs backwards. The same map, with entry and exit swapped and all your good placements in the wrong half.',
      // A map-level flag, honoured by the map loader (P5.1) when it builds Tracks:
      // the polyline is reversed before the Track is constructed, so the sim keeps
      // using one scalar t per balloon and nothing downstream changes.
      rules: { reversePaths: true }
    },

    purist: {
      key: 'purist',
      name: 'PURIST',
      blurb: 'No selling, no income, no continues, no lives regained, one life. The honest measure of a build.',
      rules: {
        startLives: 1,
        allowSell: false,
        allowIncome: false,
        allowContinue: false,
        livesRegain: false
        // §8 also lists "no powers". There are no consumable powers in this build
        // and no allowPowers rule field to express it; allowAbilities means tower
        // and hero abilities, which PURIST deliberately keeps — a build without
        // abilities is not a purer build, just a smaller one.
      }
    }
  }

  /* Menu order. Load-bearing: the mode-select screen renders this, and the harness
     asserts it is a permutation of the registry so a new mode cannot be added
     without appearing in the menu. */
  OP.MODE_ORDER = [
    'standard',
    'primary-only',
    'military-only',
    'magic-only',
    'deflation',
    'onslaught',
    'half-cash',
    'double-hp-blimps',
    'alternate-waves',
    'reverse',
    'purist'
  ]

  /* ---------- availability ---------- */

  /* Exactly one restriction in the whole matrix, and it needs a reason.

     PURIST forces startLives to 1 and takes away selling, income, continues and
     regained lives — it replaces the difficulty's safety net rather than adding to
     its pressure. On Easy that produces the cheapest towers in the game, forty
     rounds, and a badge that reads as the hardest thing in the matrix; the mode
     would be measuring nothing. §8 calls PURIST "the honesty check on the whole
     balance pass", so it is offered only where the balance being checked is the
     real one.

     Everything else is unrestricted on purpose. Easy Onslaught and Easy Double HP
     Blimps are how a player finds out what those modes do before committing eighty
     rounds to one, and gating them would only push players to learn the mode on a
     run they cannot finish.

     This is a MENU gate. The sim never consults it: OP.Sim.create honours whatever
     difficulty and mode it is handed, because a save from a future ruleset must
     still load. */
  const MODE_MIN_DIFFICULTY = { purist: 'hard' }

  /**
   * May this mode be started on this difficulty?
   * Unknown keys are refused rather than defaulted — a menu should not offer a
   * combination it cannot name.
   * @returns {boolean}
   */
  OP.modeAllowedOn = function (modeKey, difficultyKey) {
    if (!MODES[modeKey]) return false
    const rank = OP.difficultyRank ? OP.difficultyRank(difficultyKey) : -1
    if (rank < 0) return false
    const min = MODE_MIN_DIFFICULTY[modeKey]
    if (!min) return true
    return rank >= OP.difficultyRank(min)
  }

  /* ---------- game-start config ---------- */

  /**
   * Build the OP.Sim.create config for a chosen difficulty and mode.
   *
   * This exists because a mode's round set is NOT a rule: OP.Sim.create reads
   * config.roundSetKey, and OP.Sim.resolveRules only ever looks at mode.rules. A
   * shell that hands Sim.create a bare { difficulty, mode } therefore starts
   * Alternate Waves on the standard round table and nothing complains — the same
   * class of silent nothing as a misspelt rule name. Every game start goes through
   * here.
   *
   * Unknown keys fall back to the defaults rather than throwing, because the inputs
   * are menu selections and a stale save should load rather than blow up.
   *
   * @param {string} modeKey
   * @param {string} difficultyKey
   * @param {object} [extra] merged first, so an explicit roundSetKey still wins
   * @returns {object} config for OP.Sim.create
   */
  OP.modeConfig = function (modeKey, difficultyKey, extra) {
    const mode = MODES[modeKey] ? modeKey : 'standard'
    const diff = (OP.DIFFICULTIES && OP.DIFFICULTIES[difficultyKey]) ? difficultyKey : 'medium'
    const config = Object.assign({}, extra || {})
    config.difficulty = diff
    config.mode = mode
    if (config.roundSetKey === undefined) {
      config.roundSetKey = MODES[mode].roundSetKey || 'standard'
    }
    return config
  }

  OP.MODES = MODES
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

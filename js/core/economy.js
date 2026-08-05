;(function (OP) {
  'use strict'

  /* Cash, lives, and the rules that scale them.

     Every difficulty and mode difference is expressed as a field on `sim.rules`,
     resolved once when the game is created. Nothing in the simulation branches on
     "if mode === 'half-cash'" — a mode is a config delta, not a code path
     (ARCHITECTURE.md §8). That is what keeps eleven modes from becoming eleven
     sets of subtly divergent behaviour. */

  const Economy = {}

  /** Defaults for every rule the sim reads. Difficulty and mode data override. */
  Economy.defaultRules = function () {
    return {
      costMul: 1,           // tower and upgrade prices
      cashPerPopMul: 1,     // cash per layer popped
      roundBonusMul: 1,     // end-of-round payout
      startCash: 650,
      startLives: 150,
      hpScale: 1,           // balloon layer HP
      speedScale: 1,        // balloon speed
      blimpHpMul: 1,        // Double HP Blimps
      allowSell: true,      // PURIST forbids selling
      allowIncome: true,    // PURIST forbids income towers
      allowContinue: true,  // PURIST forbids continues
      allowAbilities: true,
      livesRegain: true,    // PURIST forbids regaining lives
      families: null,       // null = all; ['primary'] for Primary Only
      firstRound: 1,
      lastRound: 60,
      sellRate: OP.SELL_RATE
    }
  }

  /* ---------- cash ---------- */

  Economy.earn = function (sim, amount, sourceId) {
    if (!(amount > 0)) return 0
    sim.cash += amount
    sim.stats.cashEarned += amount
    if (sourceId >= 0 && sim.towerById) {
      const tower = sim.towerById.get(sourceId)
      if (tower) tower.earned += amount
    }
    return amount
  }

  Economy.canAfford = function (sim, amount) { return sim.cash >= amount }

  Economy.spend = function (sim, amount) {
    if (sim.cash < amount) return false
    sim.cash -= amount
    sim.stats.cashSpent += amount
    return true
  }

  /** Price of a thing after the difficulty multiplier. Always rounded up, so a
      displayed price is never cheaper than what gets charged. */
  Economy.price = function (sim, base) {
    return Math.ceil(base * sim.rules.costMul)
  }

  /** What selling returns. Sums everything invested, including upgrades. */
  Economy.sellValue = function (sim, tower) {
    if (!sim.rules.allowSell) return 0
    return Math.floor(tower.invested * sim.rules.sellRate)
  }

  /* ---------- lives ---------- */

  Economy.loseLives = function (sim, n) {
    if (!(n > 0) || sim.over) return 0
    sim.lives -= n
    sim.stats.livesLost += n
    if (sim.lives <= 0) {
      sim.lives = 0
      Economy.endGame(sim, 'leaked')
    }
    return n
  }

  Economy.gainLives = function (sim, n) {
    if (!sim.rules.livesRegain || !(n > 0)) return 0
    sim.lives += n
    return n
  }

  Economy.endGame = function (sim, reason) {
    if (sim.over) return
    sim.over = true
    sim.outcome = reason      // 'leaked' | 'won' | 'quit'
    sim.events.push({ kind: 'gameover', reason: reason, round: sim.roundIndex })
  }

  /* ---------- round payouts ---------- */

  /**
   * End-of-round cash. Grows with the round number so the curve keeps up with
   * balloon HP, then is scaled by difficulty and mode.
   */
  Economy.roundBonus = function (sim, roundIndex) {
    // Scales with the round's OWN weight, not just its number.
    //
    // A flat `base + round * 2` fell behind almost immediately: balloon RBE grows
    // superlinearly while income grew linearly, so by the early teens a reasonable
    // build could no longer afford to keep pace and died there — measured, not
    // guessed (see docs/BALANCE.md). Tying part of the payout to the round's RBE
    // makes income track the threat by construction, so the curve cannot silently
    // drift out of step again when round data is retuned.
    const def = OP.Rounds && OP.Rounds.definition ? OP.Rounds.definition(sim, roundIndex) : null
    const rbe = def ? OP.Rounds.roundRBE(def) : 0
    const base = OP.ROUND_END_BONUS + roundIndex * 3 + rbe * 0.22
    return Math.floor(base * sim.rules.roundBonusMul)
  }

  Economy.payRoundBonus = function (sim) {
    const amount = Economy.roundBonus(sim, sim.roundIndex)
    Economy.earn(sim, amount, -1)
    sim.events.push({ kind: 'roundbonus', round: sim.roundIndex, amount: amount })
    return amount
  }

  /* ---------- placement legality ---------- */

  /** Is this tower family allowed by the current mode? */
  Economy.familyAllowed = function (sim, family) {
    const allowed = sim.rules.families
    if (!allowed) return true
    return allowed.indexOf(family) >= 0
  }

  /** Is this specific tower placeable at all right now? */
  Economy.towerAllowed = function (sim, def) {
    if (!Economy.familyAllowed(sim, def.family)) return false
    if (def.income && !sim.rules.allowIncome) return false
    return true
  }

  OP.Economy = Economy
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

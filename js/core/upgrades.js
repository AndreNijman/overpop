;(function (OP) {
  'use strict'

  /* Upgrade trees and the crosspath rules.

     Two rules, and they compose (ARCHITECTURE.md §6):

       1. At most ONE branch may exceed tier 2.
       2. At most TWO branches may have any upgrades at all.

     Legal maxima are therefore 5-2-0 and its permutations. Everything the UI
     needs to explain a lock comes back as a reason string, because a greyed
     button with no explanation is the single most common complaint about
     upgrade trees. */

  const Upgrades = {}

  Upgrades.MAX_TIER = 5
  Upgrades.PATHS = 3

  /**
   * Can this branch be upgraded one step?
   * @returns {{ok:boolean, reason:string}}
   */
  Upgrades.canBuy = function (tower, pathIdx) {
    const tiers = tower.tiers
    if (pathIdx < 0 || pathIdx >= Upgrades.PATHS) return no('That branch does not exist.')

    const next = tiers[pathIdx] + 1
    if (next > Upgrades.MAX_TIER) return no('This branch is fully upgraded.')

    if (next > 2) {
      for (let i = 0; i < Upgrades.PATHS; i++) {
        if (i !== pathIdx && tiers[i] > 2) {
          return no('Only one branch can go past tier 2, and ' +
            tower.def.paths[i].name + ' already has.')
        }
      }
    }

    if (tiers[pathIdx] === 0) {
      let touched = 0
      for (let i = 0; i < Upgrades.PATHS; i++) if (tiers[i] > 0) touched++
      if (touched >= 2) return no('Only two branches can be upgraded on one tower.')
    }

    return { ok: true, reason: '' }
  }

  function no (reason) { return { ok: false, reason: reason } }

  /** Every legal end-state of a tower's tree. Used by the balance suite. */
  Upgrades.legalMaxima = function () {
    const out = []
    for (let a = 0; a <= 5; a++) {
      for (let b = 0; b <= 5; b++) {
        for (let c = 0; c <= 5; c++) {
          if (Upgrades.isLegalState([a, b, c])) out.push([a, b, c])
        }
      }
    }
    return out
  }

  /** Is this tier triple reachable at all? */
  Upgrades.isLegalState = function (tiers) {
    let overTwo = 0
    let touched = 0
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i] < 0 || tiers[i] > Upgrades.MAX_TIER) return false
      if (tiers[i] > 2) overTwo++
      if (tiers[i] > 0) touched++
    }
    return overTwo <= 1 && touched <= 2
  }

  /** The upgrade definition for a branch's next step, or null. */
  Upgrades.nextUpgrade = function (tower, pathIdx) {
    const path = tower.def.paths[pathIdx]
    if (!path) return null
    return path.tiers[tower.tiers[pathIdx]] || null
  }

  /** Its price after the difficulty multiplier. */
  Upgrades.nextCost = function (sim, tower, pathIdx) {
    const up = Upgrades.nextUpgrade(tower, pathIdx)
    if (!up) return Infinity
    return OP.Economy.price(sim, up.cost)
  }

  /**
   * Buy one upgrade. Returns {ok, reason}.
   * Charges cash, records the investment, and restats the tower.
   */
  Upgrades.buy = function (sim, tower, pathIdx) {
    const legal = Upgrades.canBuy(tower, pathIdx)
    if (!legal.ok) return legal

    const up = Upgrades.nextUpgrade(tower, pathIdx)
    if (!up) return no('Nothing left to buy on this branch.')

    const cost = OP.Economy.price(sim, up.cost)
    if (!OP.Economy.canAfford(sim, cost)) return no('Not enough cash.')
    OP.Economy.spend(sim, cost)

    tower.tiers[pathIdx]++
    tower.invested += cost
    OP.Towers.restat(sim, tower)

    // A tower whose upgrade turned it into a buff source has to re-register,
    // and every other tower has to restat because a new buff now exists.
    if (tower.def.buffs) {
      OP.Buffs.unregisterBySource(sim, tower.id)
      tower.def.buffs(sim, tower)
      OP.Towers.restatAll(sim)
    }

    sim.events.push({ kind: 'upgrade', towerId: tower.id, path: pathIdx, tier: tower.tiers[pathIdx], cost: cost })
    return { ok: true, reason: '', cost: cost, upgrade: up }
  }

  /**
   * Apply purchased upgrades to a stat object.
   * Order is fixed: branch 0 -> 1 -> 2, tier 1 -> 5. Fixed order matters because
   * an `apply` that multiplies and one that adds do not commute.
   */
  Upgrades.applyTo = function (s, tower, sim) {
    const paths = tower.def.paths
    for (let p = 0; p < paths.length; p++) {
      const owned = tower.tiers[p]
      for (let tier = 0; tier < owned; tier++) {
        const up = paths[p].tiers[tier]
        if (up && up.apply) up.apply(s, tower, sim)
      }
    }
    return s
  }

  /** Total spent on upgrades so far, before the difficulty multiplier. */
  Upgrades.investedBase = function (tower) {
    let total = 0
    const paths = tower.def.paths
    for (let p = 0; p < paths.length; p++) {
      for (let tier = 0; tier < tower.tiers[p]; tier++) total += paths[p].tiers[tier].cost
    }
    return total
  }

  /** A short label like "2-5-0" for the UI and for save summaries. */
  Upgrades.label = function (tower) { return tower.tiers.join('-') }

  /** Highest tier reached on any branch — gates paragons and some abilities. */
  Upgrades.topTier = function (tower) {
    return Math.max(tower.tiers[0], tower.tiers[1], tower.tiers[2])
  }

  OP.Upgrades = Upgrades
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

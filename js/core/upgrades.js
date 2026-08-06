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

    // A tower whose upgrade turned it into a buff source has to re-register its
    // aura, and every other tower has to restat because a new buff now exists.
    // restatAll does both, with the unbuffed-stats swap.
    if (tower.def.buffs) OP.Towers.restatAll(sim)

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

  /* ---------- what a tower can answer, now and later ----------

     A player deciding what to buy needs one question answered: can this thing
     pop the balloons that are about to arrive, and if not, can it learn to?
     Reading a damage type off a card and cross-referencing it against an
     immunity table is not an answer, it is homework.

     So this projects it. `now` is what the tower does unupgraded; `later` is what
     any legal upgrade path could give it. Both are DERIVED — from the same
     immunity data the damage resolver uses and from the real `apply` functions —
     so a tower retuned tomorrow reports itself correctly with nobody editing a
     description. Hand-written trait lists rot silently, which is worse than
     having none.

     The result is cached per tower key: it is a pure function of content, the
     shop asks for it every frame, and applying 15 upgrade functions per tower
     per frame would be absurd. */

  const TRAIT_CACHE = {}

  /** Damage types this tower can ever deal, and whether it can ever see camo. */
  function projectCapabilities (def, sim) {
    const types = {}
    let camoNow = !!def.base.camoDetect
    let camoLater = camoNow
    let partial = false
    types[def.base.dmgType] = true

    const paths = def.paths || []
    for (let p = 0; p < paths.length; p++) {
      // Walk one branch at a time, cumulatively: a tier-4 that changes the damage
      // type only does so on top of tiers 1-3, so applying them in isolation
      // would report a type the player can never actually reach.
      const s = Object.assign({}, def.base)
      const stub = { key: def.key, def: def, tiers: [0, 0, 0], id: 0, s: s }
      const tiers = paths[p].tiers || []
      for (let t = 0; t < tiers.length; t++) {
        const up = tiers[t]
        stub.tiers[p] = t + 1
        if (!up || typeof up.apply !== 'function') continue
        // An `apply` that needs more of a live sim than this stub provides must
        // not be reported as "grants nothing" — that would understate the tower.
        try { up.apply(s, stub, sim) } catch (e) { partial = true; continue }
        if (s.dmgType) types[s.dmgType] = true
        if (s.camoDetect) camoLater = true
      }
    }

    return {
      now: { dmgType: def.base.dmgType, camo: camoNow },
      types: Object.keys(types),
      camoLater: camoLater,
      partial: partial
    }
  }

  /**
   * Which notable balloon tiers this tower answers.
   *
   * "Notable" is derived, not listed: a tier is worth reporting when something in
   * the game is immune to it. That way a new immunity added to the balloon table
   * shows up in the shop automatically.
   */
  Upgrades.traits = function (def, sim) {
    if (!def || !def.base) return null
    if (TRAIT_CACHE[def.key]) return TRAIT_CACHE[def.key]

    const cap = projectCapabilities(def, sim)
    const nowTypes = [cap.now.dmgType]
    const pops = []

    const order = OP.BALLOON_TIERS || []
    for (let i = 0; i < order.length; i++) {
      const tier = order[i]
      if (!tier || !tier.immuneSet) continue
      let immuneToSomething = false
      for (const k in tier.immuneSet) { if (tier.immuneSet[k]) { immuneToSomething = true; break } }
      if (!immuneToSomething) continue

      const now = nowTypes.some(function (ty) { return OP.canDamage(tier.key, ty) })
      const later = cap.types.some(function (ty) { return OP.canDamage(tier.key, ty) })
      pops.push({ tier: tier.key, label: tier.label || tier.key, now: now, later: later })
    }

    const out = {
      key: def.key,
      dmgType: cap.now.dmgType,
      types: cap.types,
      camoNow: cap.now.camo,
      camoLater: cap.camoLater,
      partial: cap.partial,
      pops: pops,
      // The headline: what it cannot pop at all, and what an upgrade would fix.
      blindTo: pops.filter(function (p) { return !p.now && !p.later }).map(function (p) { return p.label }),
      fixable: pops.filter(function (p) { return !p.now && p.later }).map(function (p) { return p.label })
    }
    TRAIT_CACHE[def.key] = out
    return out
  }

  /** Test hook: content suites register throwaway towers into the same registry. */
  Upgrades.clearTraitCache = function () {
    for (const k in TRAIT_CACHE) delete TRAIT_CACHE[k]
  }

  /* ---------- the cost ladder ----------

     Four agents author 375 upgrade costs across four files. Without a shared
     budget they produce four different economies, and it does not surface until
     the playthrough phase — at which point fixing it means rewriting all four
     files, which is exactly what the fan-out was meant to avoid.

     So costs are expressed as multiples of the tower's own base cost, with a
     declared band per tier, and every family file is audited against it by
     tools/suites/_towerfamily.mjs. A tower outside the band fails its own step. */

  Upgrades.COST_LADDER = [
    { tier: 1, min: 0.35, max: 0.90, note: 'a cheap first pick, affordable the round after placing' },
    { tier: 2, min: 0.70, max: 1.60, note: 'still an early-game purchase' },
    { tier: 3, min: 1.80, max: 4.00, note: 'the mid-game commitment that locks the crosspath' },
    { tier: 4, min: 6.00, max: 20.00, note: 'a late-game power spike, often with an ability' },
    { tier: 5, min: 55.00, max: 140.00, note: 'an end-game centrepiece' }
  ]

  // Total investment to reach a 5-2-0, base cost included, as a multiple of base.
  Upgrades.TOTAL_BAND = { min: 60, max: 200 }

  /**
   * Audit one tower definition against the ladder.
   * @returns {{ok:boolean, problems:string[], total:number}}
   */
  Upgrades.auditCosts = function (def) {
    const problems = []
    const base = def.cost

    for (let p = 0; p < def.paths.length; p++) {
      const path = def.paths[p]
      for (let i = 0; i < path.tiers.length; i++) {
        const up = path.tiers[i]
        const band = Upgrades.COST_LADDER[i]
        const ratio = up.cost / base
        if (ratio < band.min || ratio > band.max) {
          problems.push(def.key + ' "' + path.name + '" tier ' + (i + 1) + ': cost ' + up.cost +
            ' is ' + ratio.toFixed(2) + 'x base (' + base + '), outside ' +
            band.min + '-' + band.max + 'x — ' + band.note)
        }
      }
    }

    // Cheapest legal 5-2-0: max one branch, cheapest second branch to tier 2.
    let best = Infinity
    for (let five = 0; five < 3; five++) {
      let five5 = base
      for (let i = 0; i < 5; i++) five5 += def.paths[five].tiers[i].cost
      for (let two = 0; two < 3; two++) {
        if (two === five) continue
        let total = five5
        for (let i = 0; i < 2; i++) total += def.paths[two].tiers[i].cost
        if (total < best) best = total
      }
    }
    const totalRatio = best / base
    if (totalRatio < Upgrades.TOTAL_BAND.min || totalRatio > Upgrades.TOTAL_BAND.max) {
      problems.push(def.key + ': a full 5-2-0 costs ' + Math.round(best) + ' (' +
        totalRatio.toFixed(1) + 'x base), outside the ' + Upgrades.TOTAL_BAND.min + '-' +
        Upgrades.TOTAL_BAND.max + 'x band')
    }

    return { ok: problems.length === 0, problems: problems, total: best }
  }

  OP.Upgrades = Upgrades
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

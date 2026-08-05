;(function (OP) {
  'use strict'

  /* Paragons.

     A paragon is a tier-6 fusion: you sacrifice your investment in one tower type
     across the whole board and get back a single tower whose power scales with a
     `degree` derived from what you gave up. Degree, not a fixed statline — which
     is what makes it a decision rather than just another upgrade to buy.

     Degree comes from three contributions, each capped so no single one can carry
     it alone:

       - cash value of the sacrificed towers of that type
       - total upgrade tiers sacrificed
       - pops accumulated by those towers

     Not every tower gets a paragon, and the README says which. A paragon is
     declared against an existing tower key, and `defineParagon` validates that
     the base tower exists — a paragon for a tower that was renamed must fail at
     load, not produce an unreachable upgrade. */

  const Paragon = {}

  Paragon.MAX_DEGREE = 100

  // Each contribution is normalised against these, then the three are averaged
  // and scaled. Tuned so a realistic full-board sacrifice lands around degree
  // 40-70 and degree 100 requires a deliberate, expensive effort.
  Paragon.WEIGHTS = {
    cashPer: 900,      // cash sacrificed per degree-point of the cash term
    tiersPer: 1.4,     // upgrade tiers sacrificed per degree-point
    popsPer: 4200      // pops per degree-point
  }

  /* ---------- registry ---------- */

  Paragon.define = function (def) {
    validate(def)
    def.minTier = def.minTier === undefined ? 5 : def.minTier
    OP.PARAGONS[def.towerKey] = def
    return def
  }

  function bad (def, msg) {
    throw new Error('paragon "' + ((def && def.towerKey) || '?') + '": ' + msg)
  }

  function validate (def) {
    if (!def || typeof def !== 'object') bad(def, 'definition must be an object')
    if (!def.towerKey || typeof def.towerKey !== 'string') bad(def, 'needs a towerKey')
    if (!OP.TOWERS[def.towerKey]) {
      bad(def, 'names a tower that is not registered — a renamed tower must fail here, ' +
        'not ship as an unreachable upgrade')
    }
    if (OP.PARAGONS[def.towerKey]) bad(def, 'already has a paragon')
    if (!def.name) bad(def, 'needs a display name')
    if (!def.blurb || def.blurb.length < 20) bad(def, 'needs a blurb')
    if (!(def.cost > 0)) bad(def, 'needs a positive cost')
    if (typeof def.apply !== 'function') bad(def, 'needs apply(s, tower, sim, degree)')
    if (def.fire !== undefined && typeof def.fire !== 'function') bad(def, 'fire must be a function if present')
    if (def.ability) {
      if (!def.ability.key) bad(def, 'ability needs a registry key')
      if (!(def.ability.cooldown > 0)) bad(def, 'ability needs a positive cooldown')
    }
  }

  Paragon.forTower = function (towerKey) { return OP.PARAGONS[towerKey] || null }
  Paragon.exists = function (towerKey) { return !!OP.PARAGONS[towerKey] }
  Paragon.all = function () {
    return Object.keys(OP.PARAGONS).sort().map(function (k) { return OP.PARAGONS[k] })
  }

  /* ---------- eligibility ---------- */

  /**
   * Which towers on the board would be consumed, and what degree that yields.
   * @returns {{ok:boolean, reason:string, degree:number, sacrifices:object[],
   *            cash:number, tiers:number, pops:number, cost:number}}
   */
  Paragon.preview = function (sim, tower) {
    const def = OP.PARAGONS[tower.key]
    const empty = { ok: false, reason: '', degree: 0, sacrifices: [], cash: 0, tiers: 0, pops: 0, cost: 0 }

    if (!def) return Object.assign(empty, { reason: 'This tower has no paragon.' })
    if (tower.paragonDegree > 0) return Object.assign(empty, { reason: 'Already a paragon.' })
    if (tower.heroKey) return Object.assign(empty, { reason: 'Heroes cannot become paragons.' })
    if (OP.Upgrades.topTier(tower) < def.minTier) {
      return Object.assign(empty, {
        reason: 'Needs a tier-' + def.minTier + ' upgrade on this tower first.'
      })
    }
    if (Paragon.countOnBoard(sim, tower.key) > 0) {
      return Object.assign(empty, { reason: 'Only one paragon of a type per map.' })
    }

    // Everything of the same key except the tower being promoted.
    const sacrifices = []
    let cash = 0, tiers = 0, pops = 0
    for (let i = 0; i < sim.towers.length; i++) {
      const other = sim.towers[i]
      if (other.key !== tower.key || other.id === tower.id) continue
      if (other.paragonDegree > 0) continue
      sacrifices.push(other)
      cash += other.invested
      tiers += other.tiers[0] + other.tiers[1] + other.tiers[2]
      pops += other.pops
    }

    // The promoted tower's own investment counts too — you are not throwing it away.
    cash += tower.invested
    tiers += tower.tiers[0] + tower.tiers[1] + tower.tiers[2]
    pops += tower.pops

    const degree = Paragon.degreeFrom(cash, tiers, pops)
    const cost = OP.Economy.price(sim, def.cost)

    return {
      ok: true, reason: '', degree: degree, sacrifices: sacrifices,
      cash: cash, tiers: tiers, pops: pops, cost: cost
    }
  }

  /**
   * The degree formula. Each term is capped at the full range on its own, then
   * the three are averaged — so a player cannot reach degree 100 purely by
   * throwing cash at it, and equally cannot be locked out by having farmed pops
   * instead of buying upgrades.
   */
  Paragon.degreeFrom = function (cash, tiers, pops) {
    const W = Paragon.WEIGHTS
    const cashTerm = Math.min(Paragon.MAX_DEGREE, cash / W.cashPer)
    const tierTerm = Math.min(Paragon.MAX_DEGREE, tiers / W.tiersPer)
    const popTerm = Math.min(Paragon.MAX_DEGREE, pops / W.popsPer)
    const avg = (cashTerm + tierTerm + popTerm) / 3
    return OP.M.clamp(Math.floor(avg) + 1, 1, Paragon.MAX_DEGREE)
  }

  Paragon.countOnBoard = function (sim, towerKey) {
    let n = 0
    for (let i = 0; i < sim.towers.length; i++) {
      if (sim.towers[i].key === towerKey && sim.towers[i].paragonDegree > 0) n++
    }
    return n
  }

  /* ---------- promotion ---------- */

  /**
   * Consume the sacrifices and promote `tower`. Returns {ok, reason, degree}.
   * The promoted tower keeps its id, so anything holding a reference to it — a
   * projectile in flight, the selected-tower UI — stays valid.
   */
  Paragon.promote = function (sim, tower) {
    const preview = Paragon.preview(sim, tower)
    if (!preview.ok) return { ok: false, reason: preview.reason, degree: 0 }
    if (!OP.Economy.canAfford(sim, preview.cost)) {
      return { ok: false, reason: 'Not enough cash.', degree: 0 }
    }
    OP.Economy.spend(sim, preview.cost)

    // Remove the sacrifices without refunding — this is a sacrifice, not a sale.
    for (let i = 0; i < preview.sacrifices.length; i++) {
      const victim = preview.sacrifices[i]
      if (victim.def.onSell) victim.def.onSell(sim, victim)
      OP.Buffs.unregisterBySource(sim, victim.id)
      const at = sim.towers.indexOf(victim)
      if (at >= 0) sim.towers.splice(at, 1)
      sim.towerById.delete(victim.id)
    }

    tower.paragonDegree = preview.degree
    tower.invested += preview.cost + preview.cash - tower.invested
    tower.tiers = [5, 5, 5]     // a paragon is beyond the tree; shown as maxed
    OP.Towers.restatAll(sim)

    sim.events.push({
      kind: 'paragon', towerId: tower.id, key: tower.key,
      degree: preview.degree, sacrificed: preview.sacrifices.length
    })
    return { ok: true, reason: '', degree: preview.degree }
  }

  /**
   * Called from Towers.restat when paragonDegree > 0.
   *
   * The paragon's own `apply` receives the degree and does the scaling. A shared
   * baseline is applied first so every paragon is at least a coherent tier-6
   * tower even before its own definition runs.
   */
  Paragon.applyStats = function (s, tower, sim) {
    const def = OP.PARAGONS[tower.key]
    if (!def) return s
    const degree = tower.paragonDegree
    const d = degree / Paragon.MAX_DEGREE      // 0..1

    // Shared baseline: a paragon is always a large step up, then its own
    // definition shapes the identity.
    s.damage = Math.round(s.damage * (2.5 + d * 3.5))
    s.pierce = Math.round(s.pierce * (1.8 + d * 2.2))
    s.cooldown = s.cooldown * (0.55 - d * 0.25)
    s.range = s.range * (1.25 + d * 0.35)
    s.camoDetect = true
    s.isParagon = true
    s.paragonDegree = degree

    def.apply(s, tower, sim, degree)

    if (def.ability) {
      s.ability = {
        name: def.ability.name || def.name,
        cooldown: def.ability.cooldown,
        duration: def.ability.duration || 0,
        key: def.ability.key
      }
    }
    return s
  }

  /** The fire function to use for a promoted tower, if the paragon overrides it. */
  Paragon.fireFor = function (tower) {
    const def = OP.PARAGONS[tower.key]
    return def && def.fire ? def.fire : null
  }

  /** Display name once promoted. */
  Paragon.nameFor = function (tower) {
    const def = OP.PARAGONS[tower.key]
    return def ? def.name : tower.def.name
  }

  OP.Paragon = Paragon
  OP.defineParagon = Paragon.define
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

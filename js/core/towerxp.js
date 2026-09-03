;(function (OP) {
  'use strict'

/* Tower XP — BTD6-style progression on top of the upgrade tree.

      Every upgrade is gated by tower-type XP. XP is earned *by using towers*:
      popping balloons fills a general pool, and when a round completes that pool
      is shared out to every living tower by a 50/50 blend — half by the money
      invested in it (placement + upgrades), half by how many layers it actually
      popped this round. Money never grants XP — buying an unlocked tier is
      precisely that, a purchase, not a progression. A tower you never place and
      invest in earns nothing.

      The player-level XP (`playerXp`) and hero XP (`hero.xp`) are separate
      systems that predate this one; nothing here touches them.

      Two clocks are involved in a run:

        sim.towerXp   banked XP, a copy of the profile's towerXp made at start /
                      resume. Lives on the sim so a resumed run sees the same
                      total it started with.
        sim.roundXpPool   XP earned from pops this round, undivided. Shared to the
                          living towers when the round completes.

      tower.runXp is the sum of every round's share the tower has been paid so
      far. It is summed with sim.towerXp for gating, and banked into the profile
      at game over.

      /resume is lossless: tower.runXp and sim.roundXpPool are serialized, and
      the profile copy persists, so a half-finished run reloaded mid-freeplay
      keeps every point it earned. A run you walk away from banks nothing — the
      profile only gains what a run *completed*. */

  const TowerXp = {}

  /* Cumulative XP needed to buy into each tier. Index = tier number, so a 0-0-0
     base tower needs 0 XP (its first tier-$150 step — and in practice its $150
     *upgrade* — is gated by tier 1's requirement, but placing the tower itself
     is free). Higher tiers are deliberately steep: the rewards of a 5-2-0 are
     supposed to be the reward of *turning up with that tower a lot*. */
  TowerXp.TIER_XP = [0, 150, 450, 1500, 6000, 25000]

  /* Freeplay pays a flat 5% of normal XP: [user request] "freeplay should earn
     you 5% of the normal xp." Applied uniformly. */
  TowerXp.FREEPLAY_RATE = 0.05

  TowerXp.tierRequired = function (tier) {
    const req = TowerXp.TIER_XP[tier]
    return req === undefined ? Infinity : req
  }

  /* The round ladder: every 10 rounds, each pop is worth one point more. A pop
     in round 1-9 is worth 1, round 10-19 worth 2, and so on. Deep runs, and
     deep-run *towers*, climb faster — which is the whole point of the system. */
  TowerXp.roundMultiplier = function (roundIndex) {
    const r = Math.max(0, Math.floor(roundIndex || 0))
    return 1 + Math.floor(r / 10)
  }

  TowerXp.freeplayMultiplier = function (sim) {
    return sim && sim.freeplay ? TowerXp.FREEPLAY_RATE : 1
  }

  /* XP banked from previous runs for a tower type. Missing sim.towerXp (raw
     Sim.create sims used by the test harness, speedrun tools, the menu preview)
     reads as 0 — but `available` still counts that run's own tower.runXp, and
     `canUnlock` reports unlimited when there is NO sim.towerXp at all, so a
     tower sim that never had progression attached cannot come up short. */
  TowerXp.baseOf = function (sim, towerKey) {
    const map = sim && sim.towerXp
    if (!map) return 0
    const v = map[towerKey]
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0
  }

  /* How much a tower type could spend RIGHT NOW: banked base plus whatever
     living towers of that type earned this run. Both halves stay in sync with
     the last point earned — buy a tier, and the price comes out of the same
     balance the gate just measured. */
  TowerXp.available = function (sim, towerKey) {
    let total = TowerXp.baseOf(sim, towerKey)
    const towers = sim && sim.towers
    if (!Array.isArray(towers)) return total
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (t && t.key === towerKey && !t.heroKey && t.runXp > 0) total += t.runXp
    }
    return total
  }

  /** Gate check for buying INTO `tier`. Missing sim.towerXp (a raw sim with no
      progression attached: test harness, menu preview) is UNENFORCED — unlimited,
      so a sim orphaned from the profile cannot come up short on a purchase. */
  TowerXp.canUnlock = function (sim, towerKey, tier) {
    const have = TowerXp.available(sim, towerKey)
    const req = TowerXp.tierRequired(tier)
    if (!sim || !sim.towerXp) return { ok: true, req: req, have: Infinity }
    return { ok: have >= req, have: have, req: req }
  }

  /* The one earner. Adds every pop to the round pool — no tower is credited
     yet, because the pool is divided at round end. The popping tower is still
     noted so its *share* of the pool reflects what it actually did this round
     (a pops-weighted blend with spending). Heroes earn nothing: a hero's `xp`
     field is hero XP, a separate system, and counting their pops here would
     cross the two. Returns the point amount so the suite can assert the exact
     ladder. */
  TowerXp.gainPops = function (sim, tower, layers) {
    if (!tower || tower.heroKey || !(layers > 0)) return 0
    const amount = layers * TowerXp.roundMultiplier(sim && sim.roundIndex) *
      TowerXp.freeplayMultiplier(sim)
    if (!sim) return amount
    sim.roundXpPool = (sim.roundXpPool || 0) + amount
    tower.roundPops = (tower.roundPops || 0) + layers
    return amount
  }

  /* How much of the pool goes to the *usage* side vs the *spending* side. A
     50/50 blend means a tower earns half its XP by being the biggest spender
     and half by being the biggest popper — a cheap workhorse that pops a lot
     still out-earns an idle money-sink. */
  TowerXp.POPS_WEIGHT = 0.5

  /* Share the round pool out to the living towers. The pool is split between
     two "buckets" by POPS_WEIGHT: the pops bucket is divided by how many layers
     each tower popped this round; the spending bucket by how much money is
     invested in each tower (placement + upgrades). Free placements (invested 0)
     still earn from the pops bucket if they actually pop — nothing was spent on
     them, but they still used the board. Called at round completion and at game
     over. */
  TowerXp.settle = function (sim) {
    if (!sim || !(sim.roundXpPool > 0)) return sim
    const pool = sim.roundXpPool
    sim.roundXpPool = 0
    const towers = Array.isArray(sim.towers) ? sim.towers : []
    const w = Math.max(0, Math.min(1, TowerXp.POPS_WEIGHT))
    const spendPool = pool * (1 - w)
    const popsPool = pool * w
    let spendTotal = 0
    let popsTotal = 0
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (!t || t.heroKey) continue
      if (t.invested > 0) spendTotal += t.invested
      if (t.roundPops > 0) popsTotal += t.roundPops
    }
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (!t || t.heroKey) continue
      const spendShare = spendTotal > 0 ? (t.invested > 0 ? t.invested / spendTotal : 0) : 0
      const popsShare = popsTotal > 0 ? (t.roundPops > 0 ? t.roundPops / popsTotal : 0) : 0
      const paid = spendPool * spendShare + popsPool * popsShare
      if (paid > 0) t.runXp = (t.runXp || 0) + paid
    }
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (t && !t.heroKey) t.roundPops = 0
    }
    return sim
  }

  /* One-time move at game over: floor each living tower's float into the
     profile's per-key balance. Zero-point towers write nothing, so a tower
     placed and never paid for leaves the balance exactly where it was. */
  TowerXp.bank = function (profile, sim) {
    const towers = sim && sim.towers
    if (!profile || !Array.isArray(towers)) return profile
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (!t || t.heroKey || !(t.runXp > 0)) continue
      const key = t.key
      if (typeof key !== 'string' || key === '' || key === '__proto__') continue
      if (typeof profile.towerXp !== 'object' || profile.towerXp === null ||
          Array.isArray(profile.towerXp)) profile.towerXp = {}
      const prev = typeof profile.towerXp[key] === 'number' && isFinite(profile.towerXp[key])
        ? profile.towerXp[key] : 0
      profile.towerXp[key] = prev + Math.floor(t.runXp)
    }
    return profile
  }

  OP.TowerXp = TowerXp
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
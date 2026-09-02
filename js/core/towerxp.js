;(function (OP) {
  'use strict'

/* Tower XP — BTD6-style progression on top of the upgrade tree.

      Every upgrade is gated by tower-type XP. XP is earned *by using towers*:
      popping balloons fills a general pool, and when a round completes that pool
      is shared out to every living tower in proportion to the money invested in
      it (placement + upgrades). Money never grants XP — buying an unlocked tier
      is precisely that, a purchase, not a progression. A tower you never place
      and invest in earns nothing.

      The player-level XP (`playerXp`) and hero XP (`hero.xp`) are separate
      systems that predate this one; nothing here touches them.

      Two clocks are involved in a run:

        sim.towerXp   banked XP, a copy of the profile's towerXp made at start /
                      resume. Lives on the sim so a resumed run sees the same
                      total it started with.
        sim.roundXpPool   XP earned from pops this round, undivided. Flushed to
                          the living towers when the round completes.

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
     yet, because the pool is divided by *spending*, not by who popped. Returns
     the point amount so the suite can assert the exact ladder. Heroes earn
     nothing: a hero's `xp` field is hero XP, a separate system, and counting
     their pops here would cross the two. */
  TowerXp.gainPops = function (sim, tower, layers) {
    if (!tower || tower.heroKey || !(layers > 0)) return 0
    const amount = layers * TowerXp.roundMultiplier(sim && sim.roundIndex) *
      TowerXp.freeplayMultiplier(sim)
    if (!sim) return amount
    sim.roundXpPool = (sim.roundXpPool || 0) + amount
    return amount
  }

  /* Share the round pool out to the living towers, each tower getting a slice
     proportional to the money invested in it (placement + upgrades, i.e.
     `tower.invested`). Free placements (invested 0) get nothing — nothing was
     spent on them. Called at round completion and at game over. */
  TowerXp.settle = function (sim) {
    if (!sim || !(sim.roundXpPool > 0)) return sim
    const pool = sim.roundXpPool
    sim.roundXpPool = 0
    const towers = Array.isArray(sim.towers) ? sim.towers : []
    let total = 0
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (t && !t.heroKey && t.invested > 0) total += t.invested
    }
    if (!(total > 0)) return sim
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i]
      if (t && !t.heroKey && t.invested > 0) {
        t.runXp = (t.runXp || 0) + pool * (t.invested / total)
      }
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
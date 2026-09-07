;(function (OP) {
  'use strict'

/* Tower XP — BTD6-style progression on top of the upgrade tree.

      Every upgrade is gated by tower-type XP. XP is earned *by using towers*:
      popping balloons fills a general pool, and when a round completes that pool
      is shared out to every living tower by a 50/50 blend — half by the money
      invested in it (placement + upgrades), half by how many layers it actually
      popped this round. Money never grants XP — buying an unlocked upgrade is
      precisely that, a purchase, not a progression. A tower you never place and
      invest in earns nothing.

      An unlock is ONE upgrade, not a whole tier. Reaching tier 2's total does
      not silently open all three branches: XP buys the exact (branch, tier) cell
      you choose, and is *spent* doing it. The lifetime pool still banks from
      completed runs exactly as before — the ladder below is the cumulative cost
      of advancing ONE branch to that tier — and unlocking a tier costs the
      marginal step to it (tier 3 costs tierRequired(3) - tierRequired(2)).

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

  /* The cost to unlock ONE (branch, tier) cell: the marginal step of the
     cumulative ladder. Advancing a branch from tier 1 to 2 costs 450-150=300;
     the ladder above only ever reads as "what one branch has spent". */
  TowerXp.unlockCost = function (tier) {
    if (!(tier >= 1)) return Infinity
    return TowerXp.tierRequired(tier) - TowerXp.tierRequired(tier - 1)
  }

  /* Lifetime banked XP for a tower type, straight off the profile. The menu
     screens have a profile, not a sim, so they read this rather than
     `baseOf`/`available` (which expect sim.towerXp). */
  TowerXp.profileXp = function (profile, towerKey) {
    return TowerXp.bankedOf(profile, towerKey)
  }

  /* Whatever holder is in front of us — profile or sim — the banked half of the
     tower type's XP reads the same way: towerKey -> non-negative integer. */
  TowerXp.bankedOf = function (holder, towerKey) {
    const map = holder && holder.towerXp
    if (!map) return 0
    const v = map[towerKey]
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0
  }

  /* The unlock map is an array of "highest tier unlocked on this branch", one
     entry per branch, 0..5. Missing profiling reads all-zero — the menu only
     shows what the save says, no synthetic unlocks. */
  TowerXp.unlockArray = function (holder, towerKey) {
    const lu = holder && holder.towerUnlocks
    const arr = lu && Array.isArray(lu[towerKey]) ? lu[towerKey] : [0, 0, 0]
    const out = [0, 0, 0]
    for (let p = 0; p < 3; p++) {
      const n = Number(arr[p])
      out[p] = Number.isInteger(n) && n > 0 ? Math.min(n, UpgradesMaxTier()) : 0
    }
    return out
  }
  function UpgradesMaxTier () {
    return (typeof OP.Upgrades !== 'undefined' && OP.Upgrades && OP.Upgrades.MAX_TIER)
      ? OP.Upgrades.MAX_TIER : 5
  }

  /* Highest tier unlocked on one branch, 0..5. */
  TowerXp.pathUnlocked = function (holder, towerKey, path) {
    const a = TowerXp.unlockArray(holder, towerKey)
    return a[path] === undefined ? 0 : a[path]
  }

  /* Whether ANY branch has reached `tier` — the tier-wide headline kept for
     compat (a whole tier can now be bought per branch, so this reads "has the
     tower type ever unlocked a tier-N upgrade"). */
  TowerXp.tierUnlocked = function (profile, towerKey, tier) {
    return Math.max.apply(null, TowerXp.unlockArray(profile, towerKey)) >= tier
  }

  /* Whether a specific (branch, tier) upgrade is UNLOCKED — the gate a run
     actually consults. A missing sim.towerXp (raw Sim.create sims from the test
     harness, speedrun tools, the menu preview) is UNENFORCED — unlimited — so a
     tower sim that never had progression attached cannot come up short. */
  TowerXp.cellUnlocked = function (sim, towerKey, path, tier) {
    if (!sim || !sim.towerXp) return true
    return TowerXp.pathUnlocked(sim, towerKey, path) >= tier
  }

  /* A clean copy of the profile's unlock map, for riding onto a sim at
     start/resume. Cloned so the run can spend on its own copy. */
  TowerXp.simUnlocks = function (profile) {
    const lu = profile && profile.towerUnlocks
    const out = {}
    if (!lu || typeof lu !== 'object') return out
    for (const key in lu) {
      if (!Array.isArray(lu[key])) continue
      out[key] = TowerXp.unlockArray(profile, key).slice()
    }
    return out
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
    return TowerXp.bankedOf(sim, towerKey)
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

  /** Gate check for buying INTO one (branch, tier) upgrade. Missing
      sim.towerXp (a raw sim with no progression attached: test harness, menu
      preview) is UNENFORCED — unlimited, so a sim orphaned from the profile
      cannot come up short on a purchase. `req` is the marginal XP cost of the
      cell; `have` is banked + this run, what a spend at that moment could use. */
  TowerXp.canUnlock = function (sim, towerKey, path, tier) {
    const req = TowerXp.unlockCost(tier)
    if (!sim || !sim.towerXp) return { ok: true, req: req, have: Infinity, reason: '' }
    if (TowerXp.cellUnlocked(sim, towerKey, path, tier)) {
      return { ok: true, req: req, have: TowerXp.available(sim, towerKey), reason: '' }
    }
    const have = TowerXp.available(sim, towerKey)
    return {
      ok: false, req: req, have: have,
      reason: 'Branch ' + (path + 1) + ' tier ' + tier + ' is locked — unlock it for ' +
        Math.floor(req) + ' XP (you have ' + Math.floor(have) + ').'
    }
  }

  /** SPEND XP to unlock ONE (branch, tier) upgrade, permanently. Everything is
      housed on `profile` so the unlock survives; when `sim` is present (a run is
      live) the same cell is recorded and paid for on the run's own copy too, so
      the gate and the balance it just measured stay in sync.
      The spend draws on the same "banked + this run" pool `available` reports —
      banked half first, then live runXp — so what the run can unlock right now
      is exactly what the run says the tower type holds. */
  TowerXp.unlockCell = function (profile, sim, towerKey, path, tier) {
    if (!Number.isInteger(path) || path < 0 || path > 2) {
      return { ok: false, reason: 'That branch does not exist.' }
    }
    if (!Number.isInteger(tier) || tier < 1 || tier > UpgradesMaxTier()) {
      return { ok: false, reason: 'No such tier.' }
    }
    const cost = TowerXp.unlockCost(tier)
    const onRun = !!(sim && sim.towerXp)
    const holder = onRun ? sim : profile
    const have = onRun ? TowerXp.available(sim, towerKey) : TowerXp.profileXp(profile, towerKey)
    if (have + 1e-9 < cost) {
      return { ok: false, reason: 'Needs ' + Math.floor(cost) + ' XP — you have ' + Math.floor(have) + '.' }
    }
    if (tier > 1 && TowerXp.pathUnlocked(holder, towerKey, path) < tier - 1) {
      return { ok: false, reason: 'Unlock branch ' + (path + 1) + ' tier ' + (tier - 1) + ' first.' }
    }

    // Spend banked first, then live runXp, until the marginal cost is covered.
    let remaining = cost
    if (holder && holder.towerXp) {
      const cur = TowerXp.bankedOf(holder, towerKey)
      if (cur > 0) {
        const take = Math.min(cur, remaining)
        holder.towerXp[towerKey] = cur - take
        remaining -= take
      }
    }
    if (onRun && remaining > 1e-9) {
      const towers = Array.isArray(sim.towers) ? sim.towers : []
      for (let i = 0; i < towers.length && remaining > 1e-9; i++) {
        const t = towers[i]
        if (!t || t.key !== towerKey || t.heroKey || !(t.runXp > 0)) continue
        const take = Math.min(t.runXp, remaining)
        t.runXp -= take
        remaining -= take
      }
    }

    TowerXp.recordUnlock(profile, towerKey, path, tier)
    if (sim) TowerXp.recordUnlock(sim, towerKey, path, tier)
    return { ok: true, cost: cost, have: Math.max(0, have - cost) }
  }

  /* Write one unlocked cell into a holder's unlock map. The array is cloned
     so the sim and the profile never share storage. */
  TowerXp.recordUnlock = function (holder, towerKey, path, tier) {
    if (!holder) return holder
    const lu = holder.towerUnlocks && typeof holder.towerUnlocks === 'object'
      ? holder.towerUnlocks : {}
    const arr = (Array.isArray(lu[towerKey]) ? lu[towerKey].slice() : [0, 0, 0])
    arr[path] = Math.max(TowerXp.pathUnlocked(holder, towerKey, path), tier)
    lu[towerKey] = [arr[0] | 0, arr[1] | 0, arr[2] | 0]
    holder.towerUnlocks = lu
    return holder
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
     profile's per-key balance, and union any unlocks earned mid-run into the
     profile's unlock map. Zero-point towers write nothing, so a tower placed
     and never paid for leaves the balance exactly where it was. */
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
    // A mid-run unlock spent the run's own XP; the profile has to remember the
    // cell it bought (the banked XP for it was spent on the run's copy too).
    const lu = sim && sim.towerUnlocks
    if (lu && typeof lu === 'object') {
      if (typeof profile.towerUnlocks !== 'object' || profile.towerUnlocks === null ||
          Array.isArray(profile.towerUnlocks)) profile.towerUnlocks = {}
      for (const key in lu) {
        if (!Array.isArray(lu[key])) continue
        for (let p = 0; p < 3; p++) {
          if (lu[key][p] > TowerXp.pathUnlocked(profile, key, p)) {
            TowerXp.recordUnlock(profile, key, p, lu[key][p])
          }
        }
      }
    }
    return profile
  }

  OP.TowerXp = TowerXp
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
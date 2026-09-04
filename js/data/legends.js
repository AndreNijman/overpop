;(function (OP) {
  'use strict'

  /* Legends — definitions for the rogue-lite campaign ("our Rogue Legends").

     A campaign is a run through a series of stages. Each stage is a tiled
     board of nodes the player moves along; most nodes are battles. Win a
     battle to move on, lose one and the run is over. Cash and lives carry
     between battles, and collecting Artifacts (passive relics, powered by the
     same mod/rule machinery as Monkey Knowledge) makes later battles easier.

     The whole thing lives entirely inside the profile block (see core/legends.js)
     and reuses the existing BTD6 battle engine — a battle is just a normal map
     game with escalating rounds + an artifact roll on the sim.

     This data file is runtime immutable; every table below is deep-frozen at the
     bottom so a stray mutation from a screen can never corrupt a save. */

  var LegendsData = {}

  /* The campaign: four stages of escalating intensity. Each stage produces a
     BOARD of nodes (see core/legends.js). `frontier` and `elite` tune how the
     battle rounds scale with your position in the campaign. */
  var CAMPAIGN = {
    key: 'legends',
    name: 'Legends',
    stages: [
      { boardLength: 6, tier: 'beginner', difficulty: 'easy',   boss: 'elite'   },
      { boardLength: 7, tier: 'beginner', difficulty: 'medium', boss: 'elite'   },
      { boardLength: 8, tier: 'intermediate', difficulty: 'hard',   boss: 'elite' },
      { boardLength: 9, tier: 'intermediate', difficulty: 'hard',   boss: 'elite' }
    ]
  }

  /* Node kinds a board can contain. */
  LegendsData.BATTLE = 'battle'
  LegendsData.CHEST = 'chest'
  LegendsData.ELITE = 'elite'
  LegendsData.BOSS = 'boss'
  LegendsData.MERCHANT = 'merchant'
  LegendsData.MINIGAME = 'minigame'

  /* The three official Rogue Legends mini-games. A Mini-game tile is one of
     these, rolled deterministically per seed+node; each has its own goal that
     must be reached for the win to pay out an artifact. */
  LegendsData.LEAST_CASH = 'least-cash'
  LegendsData.RACE = 'race'
  LegendsData.ENDURANCE = 'endurance'
  LegendsData.MINI_TYPES = [LegendsData.LEAST_CASH, LegendsData.RACE, LegendsData.ENDURANCE]

  /* Goal scalars for each mini-game type, by stage index (0..last). Budgets and
     times grow a little per stage so a later mini-game is a bit harder to hit
     than an early one, mirroring Rogue Legends' difficulty scaling. */
  var MINI_GOALS = {
    leastCashBudget: [1200, 1500, 1800, 2200],
    raceSeconds: [60, 70, 80, 90],
    endurancePops: [1200, 2000, 3000, 4500]
  }

  /* Artifact rarities, ordered common < rare < legendary. */
  LegendsData.COMMON = 'common'
  LegendsData.RARE = 'rare'
  LegendsData.LEGENDARY = 'legendary'

  /* Artifacts. `mods` becomes a global tower buff; `ruleOverrides` is folded
     into sim.rules at battle start — the exact same shapes Monkey Knowledge
     uses, so they ride the tower buff + rules machinery with zero engine work.
     `rarity` drives how common the drop is, weighted up over the campaign. */
  var ARTIFACTS = [
    { key: 'sharpen', name: 'Sharpen', rarity: 'common', blurb: 'All critters deal one more damage for the rest of the campaign.', mods: { damageAdd: 1 } },
    { key: 'pinpoint', name: 'Pinpoint', rarity: 'common', blurb: 'All critters gain 12 range for the rest of the campaign.', mods: { rangeAdd: 12 } },
    { key: 'buckshot', name: 'Buckshot', rarity: 'common', blurb: 'All critters pierce one extra target for the rest of the campaign.', mods: { pierceAdd: 2 } },
    { key: 'deep-pockets', name: 'Deep Pockets', rarity: 'common', blurb: 'Start the next battle with $250 extra cash.', ruleOverrides: { startCash: 250 } },
    { key: 'greed', name: 'Greed', rarity: 'common', blurb: 'Earn 25% more cash from every pop this battle.', ruleOverrides: { cashPerPopMul: 0.25 } },
    { key: 'vigor', name: 'Vigor', rarity: 'common', blurb: 'Carry 10 bonus lives into every battle.', ruleOverrides: { startLives: 10 } },
    { key: 'scope', name: 'Scope', rarity: 'rare', blurb: 'All critters gain 20 range for the rest of the campaign.', mods: { rangeAdd: 20 } },
    { key: 'razor', name: 'Razor Coating', rarity: 'rare', blurb: 'All critters deal 2 more damage for the rest of the campaign.', mods: { damageAdd: 2 } },
    { key: 'annihilation', name: 'Annihilation', rarity: 'legendary', blurb: 'Ferocious power: all critters deal 3 more damage and pierce 3 targets.', mods: { damageAdd: 3, pierceAdd: 3 } }
  ]

  /* First battle grants a free pick from the starter pool so every run opens
     with a real artifact. */
  var STARTERS = ['sharpen', 'pinpoint', 'buckshot', 'greed', 'vigor']

  /* Drop weighting by stage (index 0..last): how likely a loot roll lands on
     each rarity. Later stages lean on rares and legendaries. */
  var RARITY_WEIGHTS = [
    [{ rarity: LegendsData.COMMON, w: 80 }, { rarity: LegendsData.RARE, w: 20 }],
    [{ rarity: LegendsData.COMMON, w: 55 }, { rarity: LegendsData.RARE, w: 35 }, { rarity: LegendsData.LEGENDARY, w: 10 }],
    [{ rarity: LegendsData.COMMON, w: 30 }, { rarity: LegendsData.RARE, w: 50 }, { rarity: LegendsData.LEGENDARY, w: 20 }],
    [{ rarity: LegendsData.COMMON, w: 15 }, { rarity: LegendsData.RARE, w: 55 }, { rarity: LegendsData.LEGENDARY, w: 30 }]
  ]

  /* Merchant price by stage (scaled up so buying stays a real choice). */
  var MERCHANT_PRICE = [250, 400, 550, 700]

  /* ---------- lookup ---------- */

  LegendsData.campaign = function () { return CAMPAIGN }

  LegendsData.getArtifact = function (key) {
    for (var i = 0; i < ARTIFACTS.length; i++) {
      if (ARTIFACTS[i].key === key) return ARTIFACTS[i]
    }
    return null
  }

  LegendsData.allArtifacts = function () { return ARTIFACTS }

  LegendsData.starterKeys = function () { return STARTERS.slice() }

  LegendsData.stages = function () { return CAMPAIGN.stages }

  LegendsData.dropWeights = function (stage) {
    var s = Math.max(0, Math.min(stage || 0, RARITY_WEIGHTS.length - 1))
    return RARITY_WEIGHTS[s]
  }

  LegendsData.merchantPrice = function (stage) {
    var s = Math.max(0, Math.min(stage || 0, MERCHANT_PRICE.length - 1))
    return MERCHANT_PRICE[s]
  }

  /* The goal value for a mini-game type at a stage: a cash budget (Least Cash),
     a time-in-seconds target (Race) or a pop target (Endurance Race). */
  LegendsData.miniGoal = function (type, stage) {
    var s = Math.max(0, Math.min(stage || 0, MINI_GOALS.leastCashBudget.length - 1))
    if (type === LegendsData.LEAST_CASH) return MINI_GOALS.leastCashBudget[s]
    if (type === LegendsData.RACE) return MINI_GOALS.raceSeconds[s]
    if (type === LegendsData.ENDURANCE) return MINI_GOALS.endurancePops[s]
    return null
  }

  /* The player-facing label for a mini-game type. */
  LegendsData.miniName = function (type) {
    if (type === LegendsData.LEAST_CASH) return 'Least Cash'
    if (type === LegendsData.RACE) return 'Race'
    if (type === LegendsData.ENDURANCE) return 'Endurance Race'
    return 'Mini-game'
  }

  /* ---------- deep freeze ---------- */

  function deepFreeze (obj) {
    Object.freeze(obj)
    for (var k = 0; k < Object.keys(obj).length; k++) {
      var v = obj[Object.keys(obj)[k]]
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
    }
    return obj
  }

  deepFreeze(CAMPAIGN)
  deepFreeze(ARTIFACTS)
  deepFreeze(STARTERS)
  deepFreeze(RARITY_WEIGHTS)
  deepFreeze(MERCHANT_PRICE)
  deepFreeze(MINI_GOALS)

  OP.LegendsData = LegendsData
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

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

  /* Artifacts. `mods` becomes a global tower buff; `ruleOverrides` is folded
     into sim.rules at battle start — the exact same shapes Monkey Knowledge
     uses, so they ride the tower buff + rules machinery with zero engine work. */
  var ARTIFACTS = [
    { key: 'sharpen', name: 'Sharpen', blurb: 'All critters deal one more damage for the rest of the campaign.', mods: { damageAdd: 1 } },
    { key: 'pinpoint', name: 'Pinpoint', blurb: 'All critters gain 12 range for the rest of the campaign.', mods: { rangeAdd: 12 } },
    { key: 'buckshot', name: 'Buckshot', blurb: 'All critters pierce one extra bloon for the rest of the campaign.', mods: { pierceAdd: 2 } },
    { key: 'deep-pockets', name: 'Deep Pockets', blurb: 'Start the next battle with $250 extra cash.', ruleOverrides: { startCash: 250 } },
    { key: 'greed', name: 'Greed', blurb: 'Earn 25% more cash from every pop this battle.', ruleOverrides: { cashPerPopMul: 0.25 } },
    { key: 'vigor', name: 'Vigor', blurb: 'Carry 10 bonus lives into every battle.', ruleOverrides: { startLives: 10 } }
  ]

  /* First battle grants a free pick from the starter pool so every run opens
     with a real artifact. */
  var STARTERS = ['sharpen', 'pinpoint', 'buckshot', 'greed', 'vigor']

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

  OP.LegendsData = LegendsData
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

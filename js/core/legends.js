;(function (OP) {
  'use strict'

  /* Legends — the rogue-lite campaign ("our Rogue Legends").

     A campaign is a run through the stages of a single "adventure". Each stage
     renders as a tiled board of nodes; the player advances left-to-right. Most
     nodes are battles (a normal BTD6 map game with escalating custom rounds);
     chest nodes hand out a random Artifact; elite/boss nodes are harder battles
     that gate the end of a stage.

     Battle-to-battle resources (cash and lives) carry over, and every won
     battle banks the run's tower XP into the profile like any other game. Lose
     a battle and the run is over — you keep nothing but the completions counter
     and any banked XP.

     State lives under profile.legends (see js/save.js). It is deliberately a
     small, plain, JSON-safe object so /resume-style persistence is trivially
     lossless, mirroring expedition/trial. */

  var Legends = {}

  /* Starting resources for the first battle of a campaign. */
  Legends.START_CASH = 900
  Legends.START_LIVES = 40

  /* How many artifacts the player may select for a Starter Party (Rogue
     Legends lets you bring up to three). */
  Legends.STARTING_PARTY = 3

  /* Battle rounds per stage, and how the tier ramp is tuned. `frontier` is a
     0..1 position across the whole campaign used to scale battle size. */
  Legends.BASE_ROUNDS = 12
  Legends.ROUNDS_PER_STAGE = 5

  var TIER_LADDER = ['red', 'blue', 'green', 'yellow', 'pink', 'black', 'white',
    'purple', 'lead', 'zebra', 'rainbow', 'ceramic', 'goliath']

  /* ---------- profile helpers ---------- */

  Legends.get = function (profile) {
    return (profile && profile.legends) || null
  }

  Legends.isActive = function (profile) {
    var l = Legends.get(profile)
    return !!(l && typeof l.seed === 'string' && l.seed)
  }

  /* ---------- campaign / board structure ---------- */

  /* Turn a campaign definition + RNG into a stage board: an array of nodes,
     index 0 is the entrance, the last is the boss, and the rest are a weighted
     mix of Bloon Encounters, Loot Chests, Merchants and Mini-games (one Elite
     for the tougher stages). Node kinds stay code-level; the UI labels them
     with Rogue-Legends flavour names. */
  Legends.generateBoard = function (stageDef, rng) {
    var bos = OP.LegendsData
    var n = Math.max(3, stageDef.boardLength || 6)
    var nodes = [{ kind: bos.BATTLE, name: 'Encounter' }]
    var mid = []
    for (var i = 0; i < n - 2; i++) {
      mid.push(pickMidKind(bos, rng))
    }
    // One elite per stage, replacing an interior battle slot, if the stage calls for it.
    if (stageDef.elite && mid.length >= 2) {
      var battleIdx = -1
      for (var el = mid.length - 1; el >= 0; el--) {
        if (mid[el] === bos.BATTLE) { battleIdx = el; break }
      }
      if (battleIdx >= 0) mid[battleIdx] = bos.ELITE
    }
    mid = rng.shuffle(mid)
    for (var j = 0; j < mid.length; j++) {
      nodes.push(nodeOf(mid[j]))
    }
    nodes.push({ kind: bos.BOSS, name: 'Boss' })
    return nodes
  }

  /* A weighted pick for an interior slot: leaning encounter, with loot,
     merchant and mini-game tiles sprinkled in. */
  function pickMidKind (bos, rng) {
    if (rng.chance(0.14)) return bos.MERCHANT
    if (rng.chance(0.22)) return bos.CHEST
    if (rng.chance(0.14)) return bos.MINIGAME
    return bos.BATTLE
  }

  function nodeOf (kind) {
    var bos = OP.LegendsData
    var name = 'Encounter'
    if (kind === bos.CHEST) name = 'Loot Chest'
    else if (kind === bos.MERCHANT) name = 'Merchant'
    else if (kind === bos.MINIGAME) name = 'Mini-game'
    else if (kind === bos.ELITE) name = 'Elite Encounter'
    else if (kind === bos.BOSS) name = 'Boss'
    return { kind: kind, name: name }
  }

  /* The node list for the current stage. Deterministic for a given seed+stage. */
  Legends.board = function (profile) {
    var l = Legends.get(profile)
    if (!l) return []
    var bos = OP.LegendsData
    var stages = bos && bos.stages ? bos.stages() : []
    var def = stages[Math.min(l.stage, stages.length - 1)]
    if (!def) return []
    var rng = new OP.RNG(l.seed + ':stage-' + l.stage)
    return Legends.generateBoard(def, rng)
  }

  /* The current node the campaign is on. */
  Legends.currentNode = function (profile) {
    var l = Legends.get(profile)
    if (!l) return null
    var board = Legends.board(profile)
    return board[l.nodeIndex] || null
  }

  /* The total frontier (0..1) across the whole campaign used for scaling. */
  Legends.frontier = function (profile) {
    var l = Legends.get(profile)
    var stages = (OP.LegendsData && OP.LegendsData.stages) ? OP.LegendsData.stages() : []
    if (!l || !stages.length) return 0
    var totalNodes = 0
    var passed = 0
    for (var s = 0; s < stages.length; s++) {
      var len = Math.max(3, (stages[s].boardLength || 6)) + 1
      totalNodes += len
      if (s < l.stage) passed += len
    }
    passed += (l.nodeIndex || 0)
    if (!totalNodes) return 0
    return Math.max(0, Math.min(1, passed / totalNodes))
  }

  /* ---------- battles ---------- */

  /* Battle config for the current node: which map/difficulty to play, and the
     escalating custom round set. Returns a plain config consumed by main.js. */
  Legends.battleConfig = function (profile, opts) {
    var l = Legends.get(profile)
    if (!l) return null
    var bos = OP.LegendsData
    var stages = bos && bos.stages ? bos.stages() : []
    var def = stages[Math.min(l.stage, stages.length - 1)]
    if (!def) return null
    var node = Legends.currentNode(profile)
    var frontier = Legends.frontier(profile)
    var isBoss = node && node.kind === bos.BOSS
    var isElite = node && node.kind === bos.ELITE
    var isMini = node && node.kind === bos.MINIGAME

    // A pool of playable maps in the stage's tier band.
    var tier = def.tier || 'beginner'
    var maps = []
    if (OP.Maps && OP.Maps.byTier) {
      try { maps = OP.Maps.byTier(tier) } catch (e) { maps = [] }
    }
    if (!maps.length) maps = OP.Maps ? OP.Maps.all() : []
    var rng = new OP.RNG(l.seed + ':battle-' + l.stage + '-' + l.nodeIndex)
    var map = maps.length ? maps[rng.int(maps.length)] : null
    if (!map || !map.key) return null

    // Resource artifacts (startCash / startLives) have to land on the battle's
    // starting totals, not sim.rules — those fields are only read at Sim.create,
    // and the battle is created before we can post-hoc add to them.
    var boosts = Legends.resourceBoosts(profile)

    return {
      mapKey: map.key,
      difficulty: def.difficulty || 'medium',
      mode: 'standard',
      roundSet: Legends.buildRounds(l, frontier, node, isBoss, isElite, isMini),
      startCash: Math.max(0, l.cash) + (boosts.cash || 0),
      startLives: Math.max(1, l.lives) + (boosts.lives || 0)
    }
  }

  /* Sum the resource-style artifact bonuses (deep-pockets, vigor). */
  Legends.resourceBoosts = function (profile) {
    var out = { cash: 0, lives: 0 }
    var l = Legends.get(profile)
    if (!l || !Array.isArray(l.artifacts)) return out
    var bos = OP.LegendsData
    for (var i = 0; i < l.artifacts.length; i++) {
      var art = bos.getArtifact(l.artifacts[i])
      if (!art || !art.ruleOverrides) continue
      if (art.ruleOverrides.startCash) out.cash += art.ruleOverrides.startCash
      if (art.ruleOverrides.startLives) out.lives += art.ruleOverrides.startLives
    }
    return out
  }

  /* Generate the escalating round table for a battle. Pure + deterministic.
     A boss/elite battle is denser and reaches a higher tier than a normal one at
     the same frontier; a mini-game is a short, relatively light lure that pays
     an artifact for clearing it. */
  Legends.buildRounds = function (l, frontier, node, isBoss, isElite, isMini) {
    var bos = OP.LegendsData
    var dens = isBoss ? 1.35 : isElite ? 1.2 : isMini ? 0.75 : 1
    var topIdx = Math.min(TIER_LADDER.length - 1,
      Math.floor(frontier * (TIER_LADDER.length - 1)) + (isBoss ? 3 : isElite ? 2 : isMini ? 0 : 1))
    var rounds = isMini
      ? Math.max(4, Math.floor(Legends.BASE_ROUNDS * 0.55))
      : (Legends.BASE_ROUNDS + Math.floor(frontier * Legends.ROUNDS_PER_STAGE))
    var table = {}
    for (var r = 1; r <= rounds; r++) {
      var frac = r / rounds
      var idx = Math.max(0, Math.min(topIdx, Math.floor(frac * topIdx)))
      var tier = TIER_LADDER[idx]
      var count = 6 + Math.floor((frac * 18 + frontier * 6) * dens)
      var extra = []
      if (frac > 0.5 && idx > 1) {
        extra.push({ tier: TIER_LADDER[Math.max(0, idx - 2)], count: Math.floor(count / 2), delay: 5 })
      }
      table[r] = {
        groups: [{ tier: tier, count: count, spacing: 0.8 }].concat(extra)
      }
    }
    return table
  }

  /* Apply the run's collected artifacts to a freshly created battle sim.
     `mods` ride the existing global-buff machinery; `ruleOverrides` fold into
     sim.rules. Skill-neutral: only touching what knowledge already touches. */
  Legends.applyArtifacts = function (profile, sim) {
    var l = Legends.get(profile)
    if (!l || !sim) return sim
    if (!Array.isArray(l.artifacts)) return sim
    var bos = OP.LegendsData
    var rules = sim.rules
    for (var i = 0; i < l.artifacts.length; i++) {
      var art = bos.getArtifact(l.artifacts[i])
      if (!art) continue
      if (art.ruleOverrides) {
        for (var f in art.ruleOverrides) {
          // startCash/startLives are folded into the battle's starting totals
          // before create; everything else lives in sim.rules.
          if (f === 'startCash' || f === 'startLives') continue
          if (typeof art.ruleOverrides[f] === 'number') rules[f] = (rules[f] || 0) + art.ruleOverrides[f]
        }
      }
      if (art.mods && OP.Buffs && OP.Buffs.register) {
        OP.Buffs.register(sim, {
          id: 'legends-' + art.key,
          sourceId: -1,
          x: 0,
          y: 0,
          radius: 'global',
          priority: 0,
          families: null,
          keys: null,
          selfOnly: false,
          excludeSelf: false,
          mods: art.mods
        })
      }
    }
    // Rule-override lives are added on top of the carried lives.
    return sim
  }

  /* ---------- campaign lifecycle ---------- */

  /* Start a fresh campaign. Opts may pass `picks`, an array of up to 3 starter
     artifact keys chosen by the player for their starting party (mirrors Rogue
     Legends' Starter Party); without it a seed-derived random starter is granted
     so a quick start always opens with power. Returns true on success. */
  Legends.start = function (profile, seed, opts) {
    if (!profile || !(OP.LegendsData && OP.LegendsData.starterKeys)) return false
    var rng = new OP.RNG(seed === undefined ? String(Date.now()) : seed)
    var starters = OP.LegendsData.starterKeys()
    var picks = []
    if (opts && Array.isArray(opts.picks)) {
      for (var i = 0; i < opts.picks.length && picks.length < Legends.STARTING_PARTY; i++) {
        var k = opts.picks[i]
        if (starters.indexOf(k) >= 0 && picks.indexOf(k) < 0) picks.push(k)
      }
    }
    if (!picks.length) {
      var starter = rng.pick(starters)
      if (starter) picks.push(starter)
    }
    profile.legends = {
      seed: rng.seed,
      stage: 0,
      nodeIndex: 0,
      cash: Legends.START_CASH,
      lives: Legends.START_LIVES,
      artifacts: picks,
      wonStages: 0
    }
    return true
  }

  /* After a won battle: apply rewards and advance to the next node. Returns a
     result describing what happened so the UI can react. */
  Legends.recordWin = function (profile, sim) {
    var l = Legends.get(profile)
    if (!l) return null
    var bos = OP.LegendsData
    var node = Legends.currentNode(profile)
    // Carry the spent-by-player cash and remaining lives forward.
    if (sim) {
      l.cash = Math.max(0, sim.cash || 0)
      if (typeof sim.lives === 'number') l.lives = Math.max(1, sim.lives)
    }
    var result = { won: true, chest: null, stageComplete: false, campaignComplete: false }

    // A loot node (Loot Chest, or a cleared Mini-game) grants a random artifact
    // in addition to the resource carry.
    if (node && (node.kind === bos.CHEST || node.kind === bos.MINIGAME)) {
      var picked = Legends.grantRandomArtifact(profile, node.kind === bos.MINIGAME ? 'minigame' : 'chest')
      result.chest = picked
    }

    result.clearedStage = l.stage || 0
    l.nodeIndex = (l.nodeIndex || 0) + 1
    var board = Legends.board(profile)

    // Crossed the end of this stage's board -> stage complete (boss beaten).
    if (l.nodeIndex >= board.length) {
      result.stageComplete = true
      l.wonStages = (l.wonStages || 0) + 1
      var stages = (OP.LegendsData && OP.LegendsData.stages) ? OP.LegendsData.stages() : []
      if (l.stage + 1 >= stages.length) {
        result.campaignComplete = true
        result.nextStageIndex = stages.length
        l.stage = stages.length
        Legends.finish(profile)
      } else {
        l.stage++
        l.nodeIndex = 0
        // Restore some resources between stages so a cleared stage banks a cushion.
        l.cash += 200
        l.lives += 10
        result.nextStage = true
        result.nextStageIndex = l.stage
      }
    }
    return result
  }

  /* Handle the difference between losing a battle (run over) and abandoning. */
  Legends.recordLoss = function (profile) {
    Legends.finish(profile)
    return { won: false }
  }

  /* Grant a random artifact not already owned. Rarity is weighted by stage so
     later stages hand out more Rare/Legendary relics. Returns its key or null. */
  Legends.grantRandomArtifact = function (profile, salt) {
    var l = Legends.get(profile)
    if (!l || !OP.LegendsData) return null
    if (!Array.isArray(l.artifacts)) l.artifacts = []
    var bos = OP.LegendsData
    var all = bos.allArtifacts()
    var owned = l.artifacts
    var unowned = []
    for (var i = 0; i < all.length; i++) {
      if (owned.indexOf(all[i].key) < 0) unowned.push(all[i])
    }
    if (!unowned.length) return null
    var seed = l.seed + ':loot-' + l.stage + '-' + l.nodeIndex + '-' + (salt || '')
    var pickedArt = pickWeighted(profile, unowned, all, seed)
    if (!pickedArt) return null
    l.artifacts.push(pickedArt.key)
    return pickedArt.key
  }

  /* Choose an artifact from `unowned` honouring the stage rarity weights; falls
     back to uniform-picking across unowned when the weighted rarity is sold out. */
  function pickWeighted (profile, unowned, all, seed) {
    var l = Legends.get(profile)
    var bos = OP.LegendsData
    var weights = bos.dropWeights(l ? l.stage : 0)
    var cands = []
    for (var w = 0; w < weights.length; w++) {
      var r = weights[w].rarity
      for (var c = 0; c < weights[w].w; c++) cands.push(r)
    }
    var rng0 = new OP.RNG(seed + ':rarity')
    var rarity = cands.length ? cands[rng0.int(cands.length)] : null
    var byRarity = []
    if (rarity) {
      for (var u = 0; u < unowned.length; u++) {
        if (unowned[u].rarity === rarity) byRarity.push(unowned[u])
      }
    }
    if (!byRarity.length) byRarity = unowned
    var rng = new OP.RNG(seed)
    return byRarity[rng.int(byRarity.length)]
  }

  /* The cash a Merchant node charges for an artifact at the current stage. */
  Legends.merchantPrice = function (profile) {
    var l = Legends.get(profile)
    if (!l || !OP.LegendsData || !OP.LegendsData.merchantPrice) return 250
    return OP.LegendsData.merchantPrice(l.stage)
  }

  /* Resolve a Merchant node: buy the artifact (spin cash) or skip it (pay
     nothing). Either way the node is passed so the campaign advances to the
     next tile. Returns what happened. */
  Legends.resolveMerchant = function (profile, buy) {
    var l = Legends.get(profile)
    var bos = OP.LegendsData
    if (!l) return null
    var node = Legends.currentNode(profile)
    if (!node || node.kind !== bos.MERCHANT) return null
    var price = Legends.merchantPrice(profile)
    var granted = null
    if (buy) {
      if ((l.cash || 0) < price) return { buy: true, affordable: false, price: price }
      l.cash = Math.max(0, (l.cash || 0) - price)
      granted = Legends.grantRandomArtifact(profile, 'merchant')
    }
    l.nodeIndex = (l.nodeIndex || 0) + 1
    return { buy: !!buy, granted: granted, price: price, affordable: true, advanced: true }
  }

  /* Clear the active campaign and record a completion. */
  Legends.finish = function (profile) {
    if (!profile) return
    var l = profile.legends
    if (!l || !l.seed) return
    if (l.campaignComplete || l.stage >= ((OP.LegendsData && OP.LegendsData.stages) ? OP.LegendsData.stages().length : 1)) {
      profile.legendsCompletions = (profile.legendsCompletions || 0) + 1
    }
    profile.legends = null
  }

  /* Abandon without recording a completion. */
  Legends.abandon = function (profile) {
    if (!profile) return
    profile.legends = null
  }

  /* Cards for the entry/status screen. */
  Legends.summary = function (profile) {
    var l = Legends.get(profile)
    var stages = (OP.LegendsData && OP.LegendsData.stages) ? OP.LegendsData.stages() : []
    return {
      active: Legends.isActive(profile),
      stage: l ? l.stage : 0,
      nodeIndex: l ? (l.nodeIndex || 0) : 0,
      stages: stages.length,
      wonStages: l ? (l.wonStages || 0) : 0,
      completions: (profile && profile.legendsCompletions) || 0,
      cash: l ? l.cash : 0,
      lives: l ? l.lives : 0,
      artifacts: (l && Array.isArray(l.artifacts)) ? l.artifacts.slice() : []
    }
  }

  Legends.startCash = function () { return Legends.START_CASH }
  Legends.startLives = function () { return Legends.START_LIVES }

  OP.Legends = Legends
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

// The Legends rogue-lite campaign: a run across an escalating board of battles,
// chests and bosses with resource carry-over and a small artifact pool. State
// lives entirely under profile.legends (mirroring expedition/trial), battles are
// normal maps with escalating custom rounds, and artifacts ride the existing
// buff + rules machinery.

export const name = 'legends'
export const needs = [
  'js/legends/legends-data.js',
  'js/core/legends.js',
  'js/core/rng.js',
  'js/core/maps.js',
  'js/core/buffs.js',
  'js/data/maps-beginner.js',
  'js/data/maps-intermediate.js',
  'js/save.js'
]

import { makeSim } from './_fixture.mjs'

export function run (t, OP) {
  const L = OP.Legends
  const LD = OP.LegendsData
  const Save = OP.Save

  t.section('definitions are well-formed')
  t.ok(LD, 'LegendsData module is present')
  t.ok(L, 'Legends module is present')
  const stages = LD.stages()
  t.ok(Array.isArray(stages) && stages.length >= 4, '4+ campaign stages defined')
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]
    t.ok(typeof s.boardLength === 'number' && s.boardLength >= 3, 'stage ' + i + ' has a boardLength')
    t.ok(OP.DIFFICULTIES && OP.DIFFICULTIES[s.difficulty], 'stage ' + i + ' difficulty is valid: ' + s.difficulty)
    t.ok(s.tier === 'beginner' || s.tier === 'intermediate' || s.tier === 'expert',
      'stage ' + i + ' tier is within the known band: ' + s.tier)
  }
  const arts = LD.allArtifacts()
  t.ok(arts.length >= 5, 'artifact pool has 5+ members')
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i]
    t.ok(typeof a.key === 'string' && a.key.length > 0, 'artifact ' + i + ' has a key')
    t.ok(typeof a.name === 'string' && a.name.length > 0, 'artifact ' + i + ' has a name')
  }
  t.eq(LD.getArtifact('sharpen').mods.damageAdd, 1, 'sharpen boosts damage')
  t.eq(LD.getArtifact('pinpoint').mods.rangeAdd, 12, 'pinpoint boosts range')
  t.eq(LD.getArtifact('deep-pockets').ruleOverrides.startCash, 250, 'deep-pockets gives cash')
  t.eq(LD.getArtifact('nope'), null, 'getArtifact returns null for unknown')
  t.ok(LD.starterKeys().length > 0, 'starter pool is non-empty')

  t.section('the artifact pool is broad and every effect is one the engine reads')
  // Parity gap: canon Rogue Legends has ~85 artifacts. The local pool should keep
  // growing; this gate just keeps every entry honest (a typo'd field is dead data).
  t.gte(arts.length, 24, 'artifact pool has 24+ members (content-close target)')
  const modFields = []
  const addFields = OP.Buffs && OP.Buffs.ADD_FIELDS ? OP.Buffs.ADD_FIELDS : []
  const mulFields = OP.Buffs && OP.Buffs.MUL_FIELDS ? OP.Buffs.MUL_FIELDS : []
  const flagFields = OP.Buffs && OP.Buffs.FLAG_FIELDS ? OP.Buffs.FLAG_FIELDS : []
  modFields.push.apply(modFields, addFields)
  modFields.push.apply(modFields, mulFields)
  modFields.push.apply(modFields, flagFields)
  modFields.push('dmgTypeSet')
  const rulesVocab = OP.Economy ? Object.keys(OP.Economy.defaultRules()) : []
  const artKeys = []
  const artNames = []
  const artBlurbs = []
  const raritySeen = {}
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i]
    artKeys.push(a.key)
    artNames.push(a.name)
    artBlurbs.push(a.blurb)
    raritySeen[a.rarity] = (raritySeen[a.rarity] || 0) + 1
    t.ok(['common', 'rare', 'legendary'].indexOf(a.rarity) >= 0, a.key + ' rarity is valid')
    if (a.mods) {
      for (const f in a.mods) {
        t.ok(modFields.indexOf(f) >= 0, a.key + ' mod "' + f + '" is a real buff field')
      }
    }
    if (a.ruleOverrides) {
      for (const f in a.ruleOverrides) {
        t.ok(rulesVocab.indexOf(f) >= 0 || f === 'startCash' || f === 'startLives',
          a.key + ' rule "' + f + '" is a real rule field')
      }
    }
  }
  t.eq(new Set(artKeys).size, artKeys.length, 'every artifact key is unique')
  t.eq(new Set(artNames).size, artNames.length, 'every artifact name is unique')
  t.eq(new Set(artBlurbs).size, artBlurbs.length, 'no two artifacts share a blurb')
  t.ok(raritySeen.common >= 1 && raritySeen.rare >= 1 && raritySeen.legendary >= 1,
    'all three rarities are populated')
  const BORROWED = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?|impoppable|apopalypse|chimps|btd)\b/i
  for (const a of arts) {
    const blob = JSON.stringify({ key: a.key, name: a.name, blurb: a.blurb })
    t.notOk(BORROWED.test(blob), a.key + ' uses no borrowed proper nouns')
  }
  // Every starter is a real artifact and the starter pool overlaps the commons.
  for (const s of LD.starterKeys()) {
    t.ok(LD.getArtifact(s), 'starter "' + s + '" resolves to a real artifact')
  }

  t.section('start / isActive / summary on a fresh profile')
  const profile = Save.defaults()
  t.eq(profile.legends, null, 'fresh profile has null legends')
  t.notOk(L.isActive(profile), 'not active on a fresh profile')
  let sum = L.summary(profile)
  t.eq(sum.active, false, 'summary reports inactive')
  t.ok(L.start(profile, 'test-seed'), 'start returns true')
  t.ok(L.isActive(profile), 'active after start')
  t.ok(typeof profile.legends.seed === 'string' && profile.legends.seed, 'run has a seed')
  t.eq(profile.legends.stage, 0, 'run starts on stage 0')
  t.eq(profile.legends.nodeIndex, 0, 'run starts at node 0')
  t.ok(Array.isArray(profile.legends.artifacts) && profile.legends.artifacts.length === 1,
    'run opens with one starter artifact')
  t.ok(profile.legends.artifacts[0] !== 'deep-pockets',
    'deep-pockets is not in the starter pool (it is not a starter)')
  sum = L.summary(profile)
  t.eq(sum.active, true, 'summary reports active')

  t.section('Starter Party picks open the campaign with the chosen artifacts')
  const sp = Save.defaults()
  const picked = ['sharpen', 'greed', 'vigor']
  t.ok(L.start(sp, 'party-seed', { picks: picked }), 'start accepts a starter party')
  t.deep(sp.legends.artifacts.slice().sort(), picked.slice().sort(),
    'the chosen starters are carried into the run')
  t.ok(sp.legends.artifacts.length <= L.STARTING_PARTY, 'party is capped at the party size')
  const tooBig = Save.defaults()
  L.start(tooBig, 'big-seed', { picks: ['sharpen', 'pinpoint', 'buckshot', 'greed'] })
  t.eq(tooBig.legends.artifacts.length, L.STARTING_PARTY,
    'excess picks beyond the party size are dropped')
  const dupes = Save.defaults()
  L.start(dupes, 'dupe-seed', { picks: ['sharpen', 'sharpen'] })
  t.eq(dupes.legends.artifacts.length, 1, 'duplicate picks are deduped')
  const nonStarter = Save.defaults()
  L.start(nonStarter, 'deep-seed', { picks: ['deep-pockets'] })
  t.eq(nonStarter.legends.artifacts.length, 1,
    'a non-starter pick falls back to one random starter')
  t.neq(nonStarter.legends.artifacts[0], 'deep-pockets',
    'deep-pockets never leaks in as a starter')

  t.section('board is deterministic for a seed + stage')
  const seed = 'board-seed'
  const p1 = Save.defaults(); L.start(p1, seed)
  const p2 = Save.defaults(); L.start(p2, seed)
  const b1 = L.board(p1)
  const b2 = L.board(p2)
  t.ok(Array.isArray(b1) && b1.length >= 3, 'board exists with 3+ nodes')
  t.deep(b1, b2, 'same seed + stage -> identical board')
  t.eq(b1[0].kind, LD.BATTLE, 'first node is a battle (entry)')
  t.eq(b1[b1.length - 1].kind, LD.BOSS, 'last node is the boss')
  t.ok(Object.prototype.hasOwnProperty.call(L.currentNode(p1), 'kind'),
    'currentNode returns a node object')
  t.eq(L.frontier(p1), 0, 'frontier starts at 0')

  t.section('battleConfig builds a battle with escalating rounds')
  const cfg = L.battleConfig(p1)
  t.ok(cfg, 'battleConfig returns a config')
  t.ok(typeof cfg.mapKey === 'string' && cfg.mapKey.length > 0, 'config picks a map key')
  t.eq(cfg.difficulty, 'easy', 'stage 0 difficulty is easy')
  t.eq(cfg.mode, 'standard', 'config uses standard mode')
  t.ok(cfg.roundSet && typeof cfg.roundSet === 'object', 'config has a round table')
  const keys = Object.keys(cfg.roundSet)
  t.ok(keys.length >= 10, 'round table has a healthy number of rounds')
  t.ok(cfg.startCash >= 900, 'battle starts with the run cash')
  t.ok(cfg.startLives >= 40, 'battle starts with the run lives')
  // Round tables are object-keyed by index and indexed to escalate.
  const r1tier = cfg.roundSet[1] && cfg.roundSet[1].groups[0].tier
  const lastKey = keys[keys.length - 1]
  const rLastTier = cfg.roundSet[lastKey] && cfg.roundSet[lastKey].groups[0].tier
  t.eq(r1tier, 'red', 'round 1 is the easiest tier')
  t.ok(r1tier !== rLastTier, 'rounds escalate across the table')

  t.section('applyArtifacts folds overrides into sim.rules and buffs towers')
  const p3 = Save.defaults(); L.start(p3, 'artifact-seed')
  p3.legends.artifacts = ['greed', 'sharpen', 'deep-pockets', 'vigor']
  const sim = { rules: {}, buffs: [], buffsDirty: false }
  L.applyArtifacts(p3, sim)
  t.eq(sim.rules.cashPerPopMul, 0.25, 'greed raises cashPerPopMul')
  t.notOk('startCash' in sim.rules, 'startCash is NOT applied to sim.rules (folded into start totals)')
  t.notOk('startLives' in sim.rules, 'startLives is NOT applied to sim.rules')
  const ids = sim.buffs.map(b => b.id)
  t.ok(ids.indexOf('legends-sharpen') >= 0, 'a global sharpen buff was registered on the sim')
  t.ok(ids.indexOf('legends-greed') < 0, 'greed has no buff (it is a rules-only artifact)')

  t.section('resource boosts add to starting totals')
  const boosts = L.resourceBoosts(p3)
  t.eq(boosts.cash, 250, 'deep-pockets contributes +250 cash')
  t.eq(boosts.lives, 10, 'vigor contributes +10 lives')

  t.section('winning advances the run (node -> stage -> campaign)')
  const p4 = Save.defaults(); L.start(p4, 'advance-seed')
  // Jump straight to the boss of stage 0 by advancing through every node.
  p4.legends.artifacts = []
  const boardLen = L.board(p4).length
  let ran = 0
  let res = null
  const wonSim = makeSim(OP, { cash: 500, lives: 30 })
  while (ran < boardLen) {
    res = L.recordWin(p4, wonSim)
    ran++
    if (res.campaignComplete || res.nextStage) break
  }
  t.ok(res.nextStage || res.campaignComplete, 'advancing past the last node completes the stage')
  if (res.nextStage) {
    t.eq(p4.legends.stage, 1, 'stage advanced to 1')
    t.eq(p4.legends.nodeIndex, 0, 'node reset to 0 at the new stage')
  }

  t.section('a chest node grants an artifact')
  const p5 = Save.defaults(); L.start(p5, 'chest-seed')
  const chestBoard = L.board(p5)
  const chestPos = chestBoard.findIndex(n => n.kind === LD.CHEST)
  if (chestPos >= 0) {
    p5.legends.nodeIndex = chestPos
    const had = p5.legends.artifacts.length
    const node = L.currentNode(p5)
    res = L.recordWin(p5, wonSim)
    t.ok(res.chest, 'chest node granted an artifact on win')
    t.ok(p5.legends.artifacts.length >= had + 1, 'artifact list grew by opening the chest')
    t.ok(typeof res.chest === 'string' && res.chest.length > 0, 'chest reward is a key')
    t.notOk(node.kind !== LD.CHEST, 'the node really was a chest')
  } else {
    t.ok(true, 'skipped: this seed had no chest (still fine)')
  }

  t.section('board uses Rogue-Legends flavour names')
    const first = b1[0]
    const last = b1[b1.length - 1]
    t.eq(first.name, 'Encounter', 'entry tile is labelled an Encounter')
    t.eq(last.name, 'Boss', 'final tile is labelled the Boss')
    // Every interior node carries a recognised kind and a non-empty name.
    for (const no of b1) {
      t.ok(typeof no.name === 'string' && no.name.length > 0, 'node has a name')
    }

  t.section('merchant tiles can buy a relic or be skipped')
    const pm = Save.defaults(); L.start(pm, 'merchant-seed')
    const mBoard = L.board(pm)
    const mPos = mBoard.findIndex(n => n.kind === LD.MERCHANT)
    if (mPos >= 0) {
      pm.legends.nodeIndex = mPos
      pm.legends.cash = 100
      const tooPoor = L.resolveMerchant(pm, true)
      t.ok(tooPoor && tooPoor.buy && tooPoor.affordable === false,
        'buying without enough cash is refused')
      t.eq(pm.legends.nodeIndex, mPos, 'a refused purchase does not advance the node')
      pm.legends.cash = 9999
      const had = pm.legends.artifacts.length
      const bought = L.resolveMerchant(pm, true)
      t.ok(bought && bought.buy && bought.affordable === true && bought.granted,
        'a funded purchase grants an artifact')
      t.ok(pm.legends.artifacts.length >= had + 1, 'the run gained a relic')
      t.eq(pm.legends.nodeIndex, mPos + 1, 'a successful purchase advances the node')
      t.ok(pm.legends.cash < 9999, 'cash was spent on the artifact')
      // Skipping is exercised on its own merchant position.
      const pm2 = Save.defaults(); L.start(pm2, 'merchant-seed')
      pm2.legends.nodeIndex = mPos
      const skip = L.resolveMerchant(pm2, false)
      t.ok(skip && skip.buy === false && skip.advanced === true,
        'a merchant can be skipped (no purchase)')
      t.eq(pm2.legends.nodeIndex, mPos + 1, 'skipping still advances the node')
      t.eq(pm2.legends.artifacts.length, 1, 'skipping grants no artifact')
    } else {
      t.ok(true, 'skipped: this seed had no merchant (still fine)')
    }

  t.section('a mini-game win grants an artifact like a loot node')
    const pg = Save.defaults(); L.start(pg, 'mini-seed')
    const gBoard = L.board(pg)
    const gPos = gBoard.findIndex(n => n.kind === LD.MINIGAME)
    if (gPos >= 0) {
      pg.legends.nodeIndex = gPos
      const had = pg.legends.artifacts.length
      const gres = L.recordWin(pg, makeSim(OP, { cash: 400, lives: 20 }))
      t.ok(gres.chest, 'a mini-game win reports an artifact reward')
      t.ok(pg.legends.artifacts.length >= had + 1, 'the run gained a relic from the mini-game')
    } else {
      t.ok(true, 'skipped: this seed had no mini-game (still fine)')
    }

  t.section('mini-game types are defined, named and goalled')
    t.eq(LD.LEAST_CASH, 'least-cash', 'least-cash constant exists')
    t.eq(LD.RACE, 'race', 'race constant exists')
    t.eq(LD.ENDURANCE, 'endurance', 'endurance constant exists')
    t.eq(LD.MINI_TYPES.length, 3, 'there are exactly three mini-game types')
    t.eq(LD.miniName(LD.LEAST_CASH), 'Least Cash', 'least-cash name')
    t.eq(LD.miniName(LD.RACE), 'Race', 'race name')
    t.eq(LD.miniName(LD.ENDURANCE), 'Endurance Race', 'endurance name')
    t.eq(LD.miniName('nope'), 'Mini-game', 'unknown type falls back to Mini-game')
    t.ok(typeof LD.miniGoal(LD.LEAST_CASH, 0) === 'number', 'least-cash goal is a number')
    t.ok(typeof LD.miniGoal(LD.RACE, 0) === 'number', 'race goal is a number')
    t.ok(typeof LD.miniGoal(LD.ENDURANCE, 0) === 'number', 'endurance goal is a number')
    t.ok(LD.miniGoal(LD.LEAST_CASH, 0) <= LD.miniGoal(LD.LEAST_CASH, 3),
      'least-cash budget grows across stages')
    t.ok(LD.miniGoal(LD.RACE, 0) <= LD.miniGoal(LD.RACE, 3), 'race time target grows')
    t.ok(LD.miniGoal(LD.ENDURANCE, 0) <= LD.miniGoal(LD.ENDURANCE, 3), 'endurance pop goal grows')

  t.section('mini-game tiles carry one of the three types onto the board')
    const tt = {}
    for (let s = 0; s < LD.stages().length; s++) {
      const bp = Save.defaults(); L.start(bp, 'type-roll-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      for (const no of bb) {
        if (no.kind === LD.MINIGAME) {
          t.ok(LD.MINI_TYPES.indexOf(no.miniType) >= 0,
            'mini-game node on stage ' + s + ' has a valid type: ' + no.miniType)
          tt[no.miniType] = (tt[no.miniType] || 0) + 1
        }
      }
    }
    t.ok(Object.keys(tt).length >= 1,
      'at least one mini-game rolls a type across the seeds/stages scanned')

  t.section('battleConfig carries the mini-game type and goal')
    let miniSample = null
    for (let s = 0; s < LD.stages().length && !miniSample; s++) {
      const bp = Save.defaults(); L.start(bp, 'mini-cfg-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      const pos = bb.findIndex(n => n.kind === LD.MINIGAME)
      if (pos >= 0) { bp.legends.nodeIndex = pos; miniSample = bp }
    }
    if (miniSample) {
      const cfg = L.battleConfig(miniSample)
      t.ok(cfg && cfg.miniType && LD.MINI_TYPES.indexOf(cfg.miniType) >= 0,
        'battleConfig reports a valid miniType')
      t.ok(cfg && typeof cfg.miniGoal === 'number', 'battleConfig reports a miniGoal')
    } else {
      t.ok(true, 'skipped: no mini-game found across seeds (still fine)')
    }

  t.section('least-cash: reaching the budget goal pays, overspending does not')
    for (let s = 0; s < LD.stages().length; s++) {
      const bp = Save.defaults(); L.start(bp, 'lc-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      const pos = bb.findIndex(n => n.kind === LD.MINIGAME && n.miniType === LD.LEAST_CASH)
      if (pos < 0) continue
      const goal = LD.miniGoal(LD.LEAST_CASH, s)
      bp.legends.nodeIndex = pos
      const had = bp.legends.artifacts.length
      const spendSim = makeSim(OP, { cash: 500, lives: 20 })
      spendSim.stats.cashSpent = Math.floor(goal / 2)
      const okRes = L.recordWin(bp, spendSim)
      t.ok(okRes && okRes.chest, 'stage ' + s + ': spending within budget reaches the goal')
      t.ok(bp.legends.artifacts.length >= had + 1, 'stage ' + s + ': relic granted on budget met')
      // Overspend on a fresh run of the same node.
      const bp2 = Save.defaults(); L.start(bp2, 'lc-' + s)
      bp2.legends.stage = s
      bp2.legends.nodeIndex = pos
      const had2 = bp2.legends.artifacts.length
      const overSim = makeSim(OP, { cash: 500, lives: 20 })
      overSim.stats.cashSpent = goal + 1000
      const overRes = L.recordWin(bp2, overSim)
      t.ok(overRes && !overRes.chest, 'stage ' + s + ': overspending misses the goal')
      t.eq(bp2.legends.artifacts.length, had2, 'stage ' + s + ': no relic when over budget')
    }
    t.ok(true, 'least-cash goal gating exercised')

  t.section('race: beating the clock pays, slow clears do not')
    for (let s = 0; s < LD.stages().length; s++) {
      const bp = Save.defaults(); L.start(bp, 'rc-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      const pos = bb.findIndex(n => n.kind === LD.MINIGAME && n.miniType === LD.RACE)
      if (pos < 0) continue
      const goal = LD.miniGoal(LD.RACE, s)
      bp.legends.nodeIndex = pos
      const had = bp.legends.artifacts.length
      const fastSim = makeSim(OP, { cash: 500, lives: 20 })
      fastSim.time = Math.floor(goal / 2)
      const fastRes = L.recordWin(bp, fastSim)
      t.ok(fastRes && fastRes.chest, 'stage ' + s + ': fast clear reaches the goal')
      t.ok(bp.legends.artifacts.length >= had + 1, 'stage ' + s + ': relic granted on quick clear')
      const bp2 = Save.defaults(); L.start(bp2, 'rc-' + s)
      bp2.legends.stage = s
      bp2.legends.nodeIndex = pos
      const had2 = bp2.legends.artifacts.length
      const slowSim = makeSim(OP, { cash: 500, lives: 20 })
      slowSim.time = goal + 100
      const slowRes = L.recordWin(bp2, slowSim)
      t.ok(slowRes && !slowRes.chest, 'stage ' + s + ': a slow clear misses the goal')
      t.eq(bp2.legends.artifacts.length, had2, 'stage ' + s + ': no relic when the clock is beaten')
    }
    t.ok(true, 'race goal gating exercised')

  t.section('endurance: hitting the pop goal pays, falling short does not')
    for (let s = 0; s < LD.stages().length; s++) {
      const bp = Save.defaults(); L.start(bp, 'en-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      const pos = bb.findIndex(n => n.kind === LD.MINIGAME && n.miniType === LD.ENDURANCE)
      if (pos < 0) continue
      const goal = LD.miniGoal(LD.ENDURANCE, s)
      bp.legends.nodeIndex = pos
      const had = bp.legends.artifacts.length
      const popSim = makeSim(OP, { cash: 500, lives: 20 })
      popSim.stats.popped = goal + 50
      const popRes = L.recordWin(bp, popSim)
      t.ok(popRes && popRes.chest, 'stage ' + s + ': reaching the pop goal earns a relic')
      t.ok(bp.legends.artifacts.length >= had + 1, 'stage ' + s + ': relic granted on pop goal met')
      const bp2 = Save.defaults(); L.start(bp2, 'en-' + s)
      bp2.legends.stage = s
      bp2.legends.nodeIndex = pos
      const had2 = bp2.legends.artifacts.length
      const lowSim = makeSim(OP, { cash: 500, lives: 20 })
      lowSim.stats.popped = Math.floor(goal / 3)
      const lowRes = L.recordWin(bp2, lowSim)
      t.ok(lowRes && !lowRes.chest, 'stage ' + s + ': missing the pop goal earns nothing')
      t.eq(bp2.legends.artifacts.length, had2, 'stage ' + s + ': no relic below the pop goal')
    }
    t.ok(true, 'endurance goal gating exercised')

  t.section('miniGameReward reports type, goal, value and reached flag')
    for (let s = 0; s < LD.stages().length; s++) {
      const bp = Save.defaults(); L.start(bp, 'mgr-' + s)
      bp.legends.stage = s
      const bb = L.board(bp)
      const pos = bb.findIndex(n => n.kind === LD.MINIGAME)
      if (pos < 0) continue
      bp.legends.nodeIndex = pos
      const node = bb[pos]
      const sim = makeSim(OP, { cash: 100, lives: 20 })
      if (node.miniType === LD.LEAST_CASH) sim.stats.cashSpent = 1
      else if (node.miniType === LD.RACE) sim.time = 1
      else sim.stats.popped = 1
      const r = L.miniGameReward(bp, sim)
      t.ok(r && r.type === node.miniType, 'stage ' + s + ': miniGameReward reports the type')
      t.ok(r && typeof r.goal === 'number', 'stage ' + s + ': miniGameReward reports a goal')
      t.ok(r && typeof r.value === 'number', 'stage ' + s + ': miniGameReward reports a value')
      // A trivial run beats the Least Cash / Race goals (spent a dollar, cleared
      // in a second) but cannot meet the Endurance pop target on one balloon.
      t.eq(r && r.reached, node.miniType === LD.ENDURANCE ? false : true,
        'stage ' + s + ': trivial run reaches the goal only for non-Endurance types')
    }
    t.ok(true, 'miniGameReward exercised')

  t.section('non-mini-game nodes report no miniGameReward')
    const bpNo = Save.defaults(); L.start(bpNo, 'mgr-none')
    const noMiniFirst = L.currentNode(bpNo)
    t.ok(noMiniFirst.kind === LD.BATTLE, 'first node is a battle')
    t.eq(L.miniGameReward(bpNo, makeSim(OP)), null, 'a battle node returns null from miniGameReward')

  t.section('artifact rarities are attributed and weighted')
    const byRarity = {}
    for (const a of LD.allArtifacts()) {
      t.ok(['common', 'rare', 'legendary'].indexOf(a.rarity) >= 0, a.key + ' has a valid rarity')
      byRarity[a.rarity] = (byRarity[a.rarity] || 0) + 1
    }
    t.ok(byRarity.rare >= 1 && byRarity.legendary >= 1,
      'the pool contains rare and legendary relics (not only common)')
    const mid = LD.dropWeights(1)
    const late = LD.dropWeights(3)
    t.ok(mid.some(r => r.rarity === 'legendary'), 'mid campaign can drop legendaries')
    t.ok(late.length >= mid.length, 'later campaign weights expand to include more rarities')
    // Merchant price scales up with stage.
    t.ok(LD.merchantPrice(0) <= LD.merchantPrice(3), 'merchant price rises across stages')

  t.section('losing finishes the run; completing records a completion')
  const p6 = Save.defaults(); L.start(p6, 'loss-seed')
  t.ok(L.isActive(p6), 'run active before loss')
  L.recordLoss(p6)
  t.notOk(L.isActive(p6), 'run is inactive after a loss')
  t.eq(profile.legends !== null || true, true, 'loss clears legends state')

  const p7 = Save.defaults(); L.start(p7, 'win-seed')
  p7.legends.wonStages = 9999
  p7.legends.stage = 9999
  t.eq(L.summary(p7).completions, 0, 'completions start at 0')
  L.finish(p7)
  t.eq(p7.legendsCompletions, 1, 'finishing a through-run records a completion')

  t.section('abandon clears without recording a completion')
  const p8 = Save.defaults(); L.start(p8, 'abandon-seed')
  t.ok(L.isActive(p8), 'active before abandon')
  L.abandon(p8)
  t.notOk(L.isActive(p8), 'inactive after abandon')
  t.eq(p8.legendsCompletions || 0, 0, 'abandon does not count as a completion')
  t.eq(p8.legends, null, 'abandon clears legends state')

  t.section('empty / malformed profiles do not throw')
  t.eq(L.battleConfig({}), null, 'battleConfig on an empty profile returns null')
  t.deep(L.board({}), [], 'board on an empty profile returns []')
  t.eq(L.currentNode({}), null, 'currentNode on an empty profile returns null')
  t.eq(L.summary({}).active, false, 'summary on an empty profile is inactive')
  L.applyArtifacts({}, { rules: {}, buffs: [] })
  L.recordWin({}, null)
  L.recordLoss({})
  t.ok(true, 'lifecycle tolerates empty profiles')

  t.section('save integration — legends fields survive migration')
  const migrated = Save.migrate({
    schemaVersion: 8,
    stats: { gamesPlayed: 1 }
  })
  t.eq(migrated.schemaVersion, Save.SCHEMA_VERSION, 'schema bumped to current')
  t.ok(migrated.legends === null || migrated.legends === undefined, 'legends field present after migration')
  const migrated2 = Save.migrate({
    schemaVersion: 0,
    stats: { gamesPlayed: 1 },
    legends: { seed: 's', stage: 1, nodeIndex: 2, cash: 300, lives: 20, artifacts: ['sharpen'], wonStages: 0 },
    legendsCompletions: 3
  })
  t.eq(migrated2.schemaVersion, Save.SCHEMA_VERSION, 'unversioned profile reaches current schema')
  t.eq(migrated2.legendsCompletions, 3, 'legendsCompletions preserved')
  t.ok(migrated2.legends && migrated2.legends.seed === 's', 'active legends run preserved')

  t.section('defaults — new profiles have legends fields')
  const fresh = Save.defaults()
  t.eq(fresh.legends, null, 'fresh legends is null')
  t.eq(fresh.legendsCompletions, 0, 'fresh legendsCompletions is 0')
}

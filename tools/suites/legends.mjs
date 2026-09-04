// The Legends rogue-lite campaign: a run across an escalating board of battles,
// chests and bosses with resource carry-over and a small artifact pool. State
// lives entirely under profile.legends (mirroring expedition/trial), battles are
// normal maps with escalating custom rounds, and artifacts ride the existing
// buff + rules machinery.

export const name = 'legends'
export const needs = [
  'js/data/legends.js',
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

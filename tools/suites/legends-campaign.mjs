import { loadGame } from '../loadgame.mjs'

export const name = 'legends-campaign'
export const needs = ['js/core/legends.js', 'js/legends/legends-data.js', 'js/main.js', 'js/save.js']

function fixture (env) {
  const { OP } = env
  const app = OP.App
  app.state.profile = OP.Save.defaults()
  app.state.io = OP.Input.create()
  app.state.view = OP.Camera.create()
  return app
}

function startCampaign (OP, app, opts) {
  const profile = app.state.profile
  OP.Legends.start(profile, 'test-seed', opts || {})
  return profile
}

export function run (t) {
  const env = loadGame()
  const { OP } = env
  const app = fixture(env)

  t.section('campfire node generates on the board')
  {
    var hasCampfire = false
    for (var attempt = 0; attempt < 50 && !hasCampfire; attempt++) {
      var profile = OP.Save.defaults()
      OP.Legends.start(profile, 'campfire-test-' + attempt, {})
      var board = OP.Legends.board(profile)
      for (var i = 0; i < board.length; i++) {
        if (board[i].kind === 'campfire') { hasCampfire = true; break }
      }
    }
    t.ok(hasCampfire, 'at least one board out of 50 has a campfire node')
  }

  t.section('campfire heals lives')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var campIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'campfire') { campIdx = i; break }
    }
    if (campIdx < 0) {
      t.ok(true, 'no campfire on this board, skipping heal test')
    } else {
      profile.legends.nodeIndex = campIdx
      profile.legends.lives = 10
      var before = profile.legends.lives
      var res = OP.Legends.resolveCampfire(profile)
      t.ok(res, 'resolveCampfire returns a result')
      t.gt(res.healed, 0, 'healed amount is positive')
      t.gt(profile.legends.lives, before, 'lives increased after campfire')
      t.eq(profile.legends.nodeIndex, campIdx + 1, 'nodeIndex advanced')
    }
  }

  t.section('campfire does not exceed max lives')
  {
    var profile = startCampaign(OP, app)
    profile.legends.lives = 80
    var board = OP.Legends.board(profile)
    var campIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'campfire') { campIdx = i; break }
    }
    if (campIdx >= 0) {
      profile.legends.nodeIndex = campIdx
      OP.Legends.resolveCampfire(profile)
      t.lte(profile.legends.lives, 80, 'lives capped at 80 (START_LIVES * 2)')
    }
  }

  t.section('campfire only resolves on campfire nodes')
  {
    var profile = startCampaign(OP, app)
    profile.legends.nodeIndex = 0
    var res = OP.Legends.resolveCampfire(profile)
    t.eq(res, null, 'resolveCampfire returns null on a non-campfire node')
  }

  t.section('merchant reroll price is half of buy price')
  {
    var profile = startCampaign(OP, app)
    var buyPrice = OP.Legends.merchantPrice(profile)
    var rrPrice = OP.Legends.merchantRerollPrice(profile)
    t.eq(rrPrice, Math.floor(buyPrice * 0.5), 'reroll price is half of buy price')
  }

  t.section('merchant reroll spends cash and grants an artifact')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var merchIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'merchant') { merchIdx = i; break }
    }
    if (merchIdx < 0) {
      t.ok(true, 'no merchant on this board, skipping reroll test')
    } else {
      profile.legends.nodeIndex = merchIdx
      profile.legends.cash = 9999
      var artsBefore = profile.legends.artifacts.length
      var res = OP.Legends.resolveMerchantReroll(profile)
      t.ok(res, 'resolveMerchantReroll returns a result')
      t.ok(res.ok, 'reroll succeeds')
      t.gt(res.price, 0, 'reroll has a positive price')
      t.lt(profile.legends.cash, 9999, 'cash was spent')
      t.gt(profile.legends.artifacts.length, artsBefore, 'new artifact was granted')
      t.eq(profile.legends.nodeIndex, merchIdx, 'nodeIndex did not advance on reroll')
    }
  }

  t.section('merchant reroll fails when too poor')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var merchIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'merchant') { merchIdx = i; break }
    }
    if (merchIdx >= 0) {
      profile.legends.nodeIndex = merchIdx
      profile.legends.cash = 0
      var res = OP.Legends.resolveMerchantReroll(profile)
      t.ok(res, 'returns a result')
      t.notOk(res.ok, 'reroll fails when poor')
      t.notOk(res.affordable, 'not affordable')
    }
  }

  t.section('merchant reroll only resolves on merchant nodes')
  {
    var profile = startCampaign(OP, app)
    profile.legends.nodeIndex = 0
    var res = OP.Legends.resolveMerchantReroll(profile)
    t.eq(res, null, 'returns null on a non-merchant node')
  }

  t.section('campaign state persists through save/load')
  {
    var profile = startCampaign(OP, app)
    OP.Legends.start(profile, 'persist-test', { hero: OP.HERO_ORDER[0], picks: ['sharpen'] })
    OP.Save.save(profile)
    var loaded = OP.Save.load()
    t.ok(loaded.legends, 'legends state is saved')
    t.eq(loaded.legends.seed, 'persist-test', 'seed is preserved')
    t.ok(loaded.legends.artifacts.length > 0, 'starter artifacts are preserved')
    t.eq(loaded.legends.heroKey, OP.HERO_ORDER[0], 'hero key is preserved')
  }

  t.section('four stages exist with escalating board lengths')
  {
    var stages = OP.LegendsData.stages()
    t.eq(stages.length, 4, 'there are four stages')
    for (var i = 1; i < stages.length; i++) {
      t.gte(stages[i].boardLength, stages[i - 1].boardLength,
        'stage ' + (i + 1) + ' board length >= stage ' + i)
    }
  }

  t.section('28 artifacts exist across three rarities')
  {
    var all = OP.LegendsData.allArtifacts()
    t.gte(all.length, 28, 'at least 28 artifacts')
    var rarities = {}
    for (var i = 0; i < all.length; i++) {
      var r = all[i].rarity || 'common'
      rarities[r] = (rarities[r] || 0) + 1
    }
    t.ok(rarities.common > 0, 'has common artifacts')
    t.ok(rarities.rare > 0, 'has rare artifacts')
    t.ok(rarities.legendary > 0, 'has legendary artifacts')
  }

  t.section('five boosts exist')
  {
    var boosts = OP.LegendsData.allBoosts()
    t.eq(boosts.length, 5, 'there are five boosts')
    for (var i = 0; i < boosts.length; i++) {
      t.ok(boosts[i].key, 'boost ' + i + ' has a key')
      t.ok(boosts[i].name, 'boost ' + i + ' has a name')
    }
  }

  t.section('campfire is a recognized node kind')
  {
    t.eq(OP.LegendsData.CAMPFIRE, 'campfire', 'CAMPFIRE constant is defined')
    var stages = OP.LegendsData.stages()
    for (var s = 0; s < stages.length; s++) {
      OP.Legends.start(app.state.profile, 'kind-test-' + s, {})
      app.state.profile.legends.stage = s
      var board = OP.Legends.board(app.state.profile)
      for (var i = 0; i < board.length; i++) {
        var kinds = ['battle', 'chest', 'elite', 'boss', 'merchant', 'minigame', 'boost', 'campfire']
        t.ok(kinds.indexOf(board[i].kind) >= 0, 'stage ' + (s + 1) + ' node ' + i + ' is valid kind: ' + board[i].kind)
      }
    }
  }

  t.section('recordWin handles campfire node reward')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var campIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'campfire') { campIdx = i; break }
    }
    if (campIdx >= 0) {
      profile.legends.nodeIndex = campIdx
      var before = profile.legends.lives
      var res = OP.Legends.recordWin(profile, null)
      t.ok(res, 'recordWin returns a result')
      t.ok(res.won, 'won is true')
      t.ok(res.healed > 0, 'healed is positive')
    }
  }

  t.section('chest node generates 3 selectable rewards')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var chestIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'chest') { chestIdx = i; break }
    }
    if (chestIdx < 0) {
      t.pass('no chest on this board, skipping')
    } else {
      profile.legends.nodeIndex = chestIdx
      var res = OP.Legends.recordWin(profile, null)
      t.ok(res, 'recordWin returns a result')
      t.ok(res.won, 'won is true')
      t.ok(Array.isArray(res.chestOptions), 'chestOptions is an array')
      t.ok(res.chestOptions.length === 3, 'chestOptions has 3 options')
      t.ok(profile.legends.pendingChest, 'pendingChest is set in profile')
      t.ok(profile.legends.pendingChest.length === 3, 'pendingChest has 3 entries')
      for (var ci = 0; ci < res.chestOptions.length; ci++) {
        var opt = res.chestOptions[ci]
        t.ok(opt.key, 'option ' + ci + ' has key: ' + opt.key)
        t.ok(opt.name, 'option ' + ci + ' has name: ' + opt.name)
        t.ok(opt.rarity, 'option ' + ci + ' has rarity: ' + opt.rarity)
        t.ok(opt.blurb, 'option ' + ci + ' has blurb')
      }
    }
  }

  t.section('chest reward options are all different')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var chestIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'chest') { chestIdx = i; break }
    }
    if (chestIdx >= 0) {
      profile.legends.nodeIndex = chestIdx
      OP.Legends.recordWin(profile, null)
      var opts = profile.legends.pendingChest
      var keys = {}
      var allUnique = true
      for (var k = 0; k < opts.length; k++) {
        if (keys[opts[k].key]) allUnique = false
        keys[opts[k].key] = true
      }
      t.ok(allUnique, 'all 3 chest options are unique artifacts')
    }
  }

  t.section('claimChestReward grants chosen artifact')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var chestIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'chest') { chestIdx = i; break }
    }
    if (chestIdx >= 0) {
      profile.legends.nodeIndex = chestIdx
      OP.Legends.recordWin(profile, null)
      var beforeLen = profile.legends.artifacts.length
      var pick = OP.Legends.claimChestReward(profile, 0)
      t.ok(pick, 'claimChestReward returns a result')
      t.ok(pick.key, 'claimed result has key')
      t.ok(pick.advanced, 'advanced is true')
      t.eq(profile.legends.artifacts.length, beforeLen + 1, 'artifact count increased by 1')
      t.eq(profile.legends.artifacts[beforeLen], pick.key, 'claimed artifact added to list')
      t.ok(!profile.legends.pendingChest, 'pendingChest cleared')
    }
  }

  t.section('claimChestReward rejects invalid index')
  {
    var profile = startCampaign(OP, app)
    var board = OP.Legends.board(profile)
    var chestIdx = -1
    for (var i = 0; i < board.length; i++) {
      if (board[i].kind === 'chest') { chestIdx = i; break }
    }
    if (chestIdx >= 0) {
      profile.legends.nodeIndex = chestIdx
      OP.Legends.recordWin(profile, null)
      var beforeLen = profile.legends.artifacts.length
      var pick = OP.Legends.claimChestReward(profile, 99)
      t.ok(!pick, 'invalid index returns null')
      t.eq(profile.legends.artifacts.length, beforeLen, 'no artifact added')
    }
  }

  t.section('previewChestRewards falls back to draft when no unowned artifacts')
  {
    var profile = startCampaign(OP, app)
    // Own all artifacts
    var all = OP.LegendsData.allArtifacts()
    for (var i = 0; i < all.length; i++) {
      profile.legends.artifacts.push(all[i].key)
    }
    var opts = OP.Legends.previewChestRewards(profile)
    t.ok(Array.isArray(opts), 'returns an array')
    t.eq(opts.length, 0, 'empty options when all owned')
    t.ok(Array.isArray(profile.legends.pendingChest), 'pendingChest set')
    t.eq(profile.legends.pendingChest.length, 0, 'pendingChest empty')
  }
}

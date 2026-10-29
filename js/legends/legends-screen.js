;(function (OP) {
  'use strict'

  /* Legends board screen — the tile map for the active campaign.

     Renders the current stage as a horizontal row of tiles from the entrance
     (left) to the boss (right). The current node is highlighted; a FIGHT button
     launches that node's battle. Status (cash / lives / artifacts) runs along
     the top so the player always sees their carry-over and collected relics.

     This is a menu screen in the same sense as bestiary/expedition: pure build
     + paint + activate, no sim, only reaching into OP.Legends for state. */

  var LegendsScreen = {}

  var PAD = 96
  var FIELD_W = OP.FIELD_W
  var FIELD_H = OP.FIELD_H

  function state (app) { return OP.Legends ? OP.Legends.summary(app.state && app.state.profile) : null }
  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus && OP.Menus.COLOURS ? OP.Menus.COLOURS : {} }

  function artName (k) {
    var d = OP.LegendsData && OP.LegendsData.getArtifact ? OP.LegendsData.getArtifact(k) : null
    return d ? d.name : k
  }

  function build (app) {
    var U = ui()
    var C = colours()
    if (!U) return { screen: 'legends', backdrop: 'solid', marks: [], widgets: [] }
    var marks = []
    var widgets = []
    var profile = app && app.state ? app.state.profile : null
    var sum = state(app)

    // The shared menu header: title top-left, BACK top-right, a rule under both.
    marks.push(U.tracked(PAD, 84, 'LEGENDS', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    widgets.push(U.button('legends.back', FIELD_W - PAD - 96, 62, 96, 32, {
      label: 'BACK', action: 'back', align: 'center'
    }))

    if (!sum || !sum.active) {
      // Entry screen — build a Starter Party (up to 3 artifacts), then begin.
      // Artifacts on the left, heroes on the right, actions underneath; the old
      // stacked layout ran off the bottom of the field.
      var starters = (OP.LegendsData && OP.LegendsData.starterKeys)
        ? OP.LegendsData.starterKeys() : []
      var pickState = (OP.Menus && OP.Menus.state && OP.Menus.state.legendsStart) || null
      var picks = (pickState && Array.isArray(pickState.picks)) ? pickState.picks.slice() : []
      var maxParty = OP.Legends && OP.Legends.STARTING_PARTY ? OP.Legends.STARTING_PARTY : 3
      var contentW = FIELD_W - PAD * 2

      marks.push(U.text(PAD, 108, 'A rogue-lite campaign of rising stages. Pick up to ' + maxParty + ' artifacts and a hero, then begin.',
        { size: 11, colour: C.dim }))
      marks.push(U.rule(PAD, 126, contentW))

      var top = 172
      var leftW = 520
      marks.push(U.tracked(PAD, 156, 'STARTER PARTY  ' + picks.length + '/' + maxParty, { size: 11, colour: C.gold, track: 0.22, weight: '700' }))
      var shown = 0
      for (var a = 0; a < starters.length; a++) {
        var art = (OP.LegendsData && OP.LegendsData.getArtifact)
          ? OP.LegendsData.getArtifact(starters[a]) : null
        if (!art) continue
        var sel = picks.indexOf(art.key) >= 0
        widgets.push(U.row('legends.pick.' + art.key, PAD, top + shown * 50, leftW, 44, {
          label: art.name, sub: art.blurb, note: sel ? 'IN PARTY' : '',
          action: 'legends-pick', arg: art.key, selected: sel
        }))
        shown++
      }

      // Hero selection — pick one hero to carry into the campaign.
      var heroKey = (pickState && pickState.hero) ? pickState.hero : null
      var heroes = OP.HERO_ORDER ? OP.HERO_ORDER.slice() : []
      var hx0 = PAD + leftW + 24
      var heroW = FIELD_W - PAD - hx0
      marks.push(U.tracked(hx0, 156, 'HERO', { size: 11, colour: C.gold, track: 0.22, weight: '700' }))
      marks.push(U.text(FIELD_W - PAD, 156, heroKey && OP.HEROES && OP.HEROES[heroKey]
        ? OP.HEROES[heroKey].name : 'none picked: the first available deploys',
        { size: 11, colour: heroKey ? C.moss : C.faint, align: 'right' }))
      var perCol = Math.max(1, Math.ceil(heroes.length / 2))
      var hColW = Math.floor((heroW - 12) / 2)
      var hRowH = Math.min(30, Math.floor((shown * 50 - 6 + 4) / perCol) - 4)
      for (var hi = 0; hi < heroes.length; hi++) {
        var hk = heroes[hi]
        var hDef = OP.HEROES && OP.HEROES[hk] ? OP.HEROES[hk] : null
        if (!hDef) continue
        widgets.push(U.row('legends.hero.' + hk, hx0 + Math.floor(hi / perCol) * (hColW + 12),
          top + (hi % perCol) * (hRowH + 4), hColW, hRowH, {
            label: hDef.name, note: '$' + hDef.cost,
            action: 'legends-hero', arg: hk, selected: heroKey === hk
          }))
      }

      var startY = 584
      widgets.push(U.button('legends.start', PAD, startY, leftW, 54, {
        label: 'BEGIN RUN', tone: 'primary', action: 'legends-start', align: 'center',
        sub: picks.length ? 'start with your chosen artifacts' : 'start with a random artifact'
      }))
      widgets.push(U.button('legends.quick', hx0, startY, heroW, 54, {
        label: 'CLEAR PICKS', action: 'legends-clear', align: 'center',
        sub: 'empty the party and begin with a random artifact'
      }))
      marks.push(U.rule(PAD, 676, contentW, { alpha: 0.6 }))
      marks.push(U.text(PAD, 700, 'ESC back · artifacts last the whole campaign; the hero deploys on every battlefield',
        { size: 11, colour: C.faint }))
      return model(marks, widgets, 'legends.start')
    }

    // Status bar.
    marks.push(U.text(PAD, 128, 'STAGE ' + (sum.stage + 1) + ' / ' + sum.stages, { size: 11, colour: C.moss, track: 0.3 }))
    marks.push(U.text(PAD, 150, 'CASH $' + Math.floor(sum.cash) + '   ·   LIVES ' + sum.lives, { size: 12, colour: C.ink, weight: '600' }))
    var artLine = 'ARTIFACTS: ' + (sum.artifacts.length ? sum.artifacts.map(artName).join(', ') : 'none')
    marks.push(U.text(PAD, 172, artLine, { size: 10, colour: C.dim }))
    // Hero + Boost status
    var heroName = sum.heroKey && OP.HEROES && OP.HEROES[sum.heroKey]
      ? OP.HEROES[sum.heroKey].name : 'none'
    var boostLine = sum.boost
      ? 'BOOST: ' + (OP.LegendsData && OP.LegendsData.getBoost
        ? (OP.LegendsData.getBoost(sum.boost.key) || {}).name || sum.boost.key
        : sum.boost.key) + ' (' + sum.boost.battlesLeft + ' left)'
      : ''
    marks.push(U.text(PAD + 500, 172, 'HERO: ' + heroName + (boostLine ? '   ·   ' + boostLine : ''),
      { size: 10, colour: sum.boost ? '#d4a843' : C.dim }))
    // Party display
    var party = (OP.Legends && OP.Legends.partyList) ? OP.Legends.partyList(profile) : []
    var partyNames = []
    for (var pi = 0; pi < party.length; pi++) {
      var pDef = OP.TOWERS && OP.TOWERS[party[pi].key]
      var pName = pDef ? pDef.name : party[pi].key
      var tStr = party[pi].tiers.join('-')
      partyNames.push(pName + (tStr !== '0-0-0' ? ' ' + tStr : ''))
    }
    var partyLine = 'PARTY: ' + (partyNames.length ? partyNames.join(', ') : 'empty')
    marks.push(U.text(PAD, 192, partyLine, { size: 10, colour: party.length ? C.dim : C.faint }))
    marks.push(U.rule(PAD, 208, FIELD_W - PAD * 2))

    // The board: one tile per node, entrance..boss.
    var board = OP.Legends.board ? OP.Legends.board(profile) : []
    if (!board.length) {
      marks.push(U.text(PAD, 220, 'This stage has no nodes.', { size: 13, colour: C.dim }))
      return model(marks, widgets)
    }

    var tileW = 96
    var tileGap = 18
    var totalW = board.length * tileW + (board.length - 1) * tileGap
    var x0 = (FIELD_W - totalW) / 2
    var tileY = 250
    var tileH = 110
    var current = sum.nodeIndex

    for (var i = 0; i < board.length; i++) {
      var node = board[i]
      var cx = x0 + i * (tileW + tileGap)
      var isHere = i === current
      var reached = i <= current
      var col = isHere ? '#d4a843' : reached ? '#6a9955' : C.dim
      marks.push(U.box(cx, tileY, tileW, tileH, { stroke: col, lineWidth: 2 }))
      marks.push(U.text(cx + tileW / 2, tileY + 28, nodeLabel(node), {
        size: 9, colour: isHere ? '#d4a843' : reached ? C.ink : C.faint, align: 'center'
      }))
      marks.push(U.text(cx + tileW / 2, tileY + tileH - 18, nodeKind(node), {
        size: 8, colour: reached ? C.moss : C.faint, align: 'center', track: 0.2
      }))
      if (isHere) {
        marks.push(U.text(cx + tileW / 2, tileY + 52, 'YOU ARE HERE', { size: 7, colour: '#d4a843', align: 'center' }))
      }
    }

    // Action row.
    var currentNode = (OP.Legends && OP.Legends.currentNode) ? OP.Legends.currentNode(profile) : null
    var isBoss = currentNode && currentNode.kind === 'boss'
    var isElite = currentNode && currentNode.kind === 'elite'
    var isChest = currentNode && currentNode.kind === 'chest'
    var isMerchant = currentNode && currentNode.kind === 'merchant'
    var isMini = currentNode && currentNode.kind === 'minigame'
    var isCampfire = currentNode && currentNode.kind === 'campfire'
    var pendingChest = profile.legends && profile.legends.pendingChest

    if (isChest && pendingChest && pendingChest.length) {
      marks.push(U.text(PAD, 440, 'Choose a relic from the chest:', { size: 12, colour: C.ink, weight: '600' }))
      for (var ci = 0; ci < pendingChest.length; ci++) {
        var opt = pendingChest[ci]
        var rarityCol = opt.rarity === 'legendary' ? '#d4a843' : opt.rarity === 'rare' ? '#7a6fd4' : C.moss
        var cx = PAD + ci * 280
        widgets.push(U.button('legends.chest-' + ci, cx, 460, 260, 80, {
          label: opt.name, tone: 'primary', action: 'legends-chest', arg: ci,
          sub: (opt.blurb || '') + ' [' + (opt.rarity || 'common').toUpperCase() + ']'
        }))
        marks.push(U.text(cx + 130, 460 + 20, opt.rarity ? opt.rarity.toUpperCase() : 'COMMON', {
          size: 8, colour: rarityCol, align: 'center', track: 0.2
        }))
      }
    } else if (isMerchant) {
      var mPrice = (OP.Legends && OP.Legends.merchantPrice) ? OP.Legends.merchantPrice(profile) : 250
      var rrPrice = (OP.Legends && OP.Legends.merchantRerollPrice) ? OP.Legends.merchantRerollPrice(profile) : Math.floor(mPrice * 0.5)
      var canAfford = sum.cash >= mPrice
      var canReroll = sum.cash >= rrPrice
      marks.push(U.text(PAD, 474, 'A travelling merchant offers a relic for $' + mPrice + '.',
        { size: 11, colour: C.dim }))
      widgets.push(U.button('legends.buy', PAD, 430, 260, 58, {
        label: 'BUY ARTIFACT', tone: 'primary', action: 'legends-buy',
        sub: canAfford ? 'spend $' + mPrice + ' on a random relic' : 'not enough cash'
      }))
      widgets.push(U.button('legends.reroll', PAD + 272, 430, 120, 58, {
        label: 'REROLL', action: 'legends-reroll',
        sub: canReroll ? '$' + rrPrice : 'not enough cash'
      }))
      widgets.push(U.button('legends.skip', PAD, 430 + 72, 260, 46, {
        label: 'SKIP', action: 'legends-skip', sub: 'pass on this merchant'
      }))
      // Party replace: swap a party member for a random new tower
      var party = (OP.Legends && OP.Legends.partyList) ? OP.Legends.partyList(profile) : []
      var rpPrice = (OP.Legends && OP.Legends.merchantReplacePrice) ? OP.Legends.merchantReplacePrice(profile) : 200
      for (var ri = 0; ri < party.length; ri++) {
        var rpDef = OP.TOWERS && OP.TOWERS[party[ri].key]
        var rpName = rpDef ? rpDef.name : party[ri].key
        var canRp = sum.cash >= rpPrice
        widgets.push(U.button('legends.replace-' + ri, PAD + 400, 430 + ri * 34, 200, 30, {
          label: 'REPLACE ' + rpName.toUpperCase(), action: 'legends-replace', arg: ri,
          sub: canRp ? 'swap for $' + rpPrice : 'not enough cash'
        }))
      }
    } else if (isCampfire) {
      var healAmount = Math.max(5, Math.floor(40 * 0.25))
      marks.push(U.text(PAD, 474, 'A warm campfire restores ' + healAmount + ' lives.',
        { size: 11, colour: C.dim }))
      widgets.push(U.button('legends.rest', PAD, 430, 300, 58, {
        label: 'REST', tone: 'primary', action: 'legends-rest',
        sub: 'heal and continue'
      }))
      widgets.push(U.button('legends.abandon', PAD, 430 + 72, 300, 46, {
        label: 'ABANDON RUN', action: 'legends-abandon', sub: 'lose everything, keep nothing'
      }))
    } else {
      var fightLabel = isBoss ? 'FACE THE BOSS'
        : isElite ? 'ELITE ENCOUNTER'
        : isChest ? 'OPEN THE CHEST'
        : isMini ? miniActionLabel(currentNode)
        : 'FIGHT'
      var fightSub = isChest
        ? 'a battle, then a random artifact'
        : isMini
        ? miniActionSub(currentNode, OP.LegendsData)
        : 'win a battle to advance'
      if (isBoss) {
        var encounter = OP.Legends.battleConfig(profile)
        var boss = encounter && encounter.boss && OP.bossByKey(encounter.boss.key)
        if (boss) {
          fightSub = boss.name + ' · Round ' + encounter.rules.lastRound
          marks.push(U.text(PAD + 340, 452, 'Defeat ' + boss.name + ' and clear all balloons.',
            { size: 12, colour: C.ink }))
          marks.push(U.text(PAD + 340, 476, 'The boss arrives on round ' + encounter.rules.lastRound + '.',
            { size: 11, colour: C.dim }))
        }
      }
      widgets.push(U.button('legends.fight', PAD, 430, 300, 58, {
        label: fightLabel, tone: 'primary', action: 'legends-fight', arg: 'next',
        sub: fightSub
      }))
      widgets.push(U.button('legends.abandon', PAD, 430 + 72, 300, 46, {
        label: 'ABANDON RUN', action: 'legends-abandon', sub: 'lose everything, keep nothing'
      }))
    }
    return model(marks, widgets)
  }

  function nodeLabel (node) { return (node && node.name) || 'Node' }
  function nodeKind (node) { return node ? String(node.kind).toUpperCase() : '' }

  /* Action-button copy for a Mini-game node: name + the goal to reach. Stays in
     generic Rogue-Legends language (no borrowed proper nouns). */
  function miniActionLabel (node) {
    var t = node && node.miniType
    if (t === 'least-cash') return 'SPEND UNDER THE BUDGET'
    if (t === 'race') return 'BEAT THE CLOCK'
    if (t === 'endurance') return 'ENDURANCE: OUTRUN'
    return 'PLAY MINI-GAME'
  }

  function miniActionSub (node, LD) {
    if (!node || !node.miniType || !LD) return 'win the node to earn a relic'
    var goal = LD.miniGoal ? LD.miniGoal(node.miniType, 0) : null
    var verb = 'win the node to earn a relic; beat the goal for a loot roll'
    if (node.miniType === 'least-cash') {
      return 'keep tower spending within the budget to earn a relic'
    }
    if (node.miniType === 'race') {
      return 'clear the node fast to earn a relic'
    }
    if (node.miniType === 'endurance') {
      return 'pop as many as you can to earn a relic'
    }
    return verb
  }

  function paint (ctx, app) {
    var U = ui()
    if (!U || !U.paint) return 0
    return U.paint(ctx, build(app), { hoverId: OP.Menus ? OP.Menus.state.hoverId : null })
  }

  function activate (app, w) {
    if (!w) return false
    if (w.action === 'legends-fight' || w.action === 'legends-start') {
      if (app && app.startLegends) { app.startLegends() }
      else if (OP.Menus) OP.Menus.go(app, 'maps')
      return true
    }
    if (w.action === 'legends-pick') {
      // Starter Party toggle: add/remove the clicked artifact (max 3).
      var ms = OP.Menus && OP.Menus.state
      if (!ms) return false
      var pickState = ms.legendsStart = (ms.legendsStart || { picks: [] })
      if (!Array.isArray(pickState.picks)) pickState.picks = []
      var key = w.arg
      var at = pickState.picks.indexOf(key)
      var maxParty = OP.Legends && OP.Legends.STARTING_PARTY ? OP.Legends.STARTING_PARTY : 3
      if (at >= 0) {
        pickState.picks.splice(at, 1)
      } else if (pickState.picks.length < maxParty) {
        pickState.picks.push(key)
      }
      return true
    }
    if (w.action === 'legends-hero') {
      var ms = OP.Menus && OP.Menus.state
      if (!ms) return false
      var pickState = ms.legendsStart = (ms.legendsStart || { picks: [] })
      pickState.hero = w.arg
      return true
    }
    if (w.action === 'legends-clear') {
      var sc = OP.Menus && OP.Menus.state
      if (sc) sc.legendsStart = null
      return true
    }
    if (w.action === 'legends-buy' || w.action === 'legends-skip') {
      if (app && app.legendsMerchant) app.legendsMerchant(w.action === 'legends-buy')
      return true
    }
    if (w.action === 'legends-reroll') {
      if (app && app.legendsMerchantReroll) app.legendsMerchantReroll()
      return true
    }
    if (w.action === 'legends-rest') {
      if (app && app.legendsCampfire) app.legendsCampfire()
      return true
    }
    if (w.action === 'legends-chest') {
      if (app && app.legendsClaimChest) app.legendsClaimChest(w.arg)
      return true
    }
    if (w.action === 'legends-replace') {
      if (app && app.legendsPartyReplace) app.legendsPartyReplace(w.arg)
      return true
    }
    if (w.action === 'legends-abandon') {
      var profile = app && app.state ? app.state.profile : null
      if (OP.Legends) OP.Legends.abandon(profile)
      if (app && app.quitToMenu) app.quitToMenu()
      return true
    }
    return false
  }

  function model (marks, widgets, defaultId) {
    return {
      screen: 'legends', backdrop: 'solid', marks: marks, widgets: widgets,
      defaultId: defaultId || 'legends.fight'
    }
  }

  LegendsScreen.build = build
  LegendsScreen.paint = paint
  LegendsScreen.activate = activate
  LegendsScreen.back = function () { return 'title' }

  LegendsScreen.install = function (app) {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('legends', {
        build: build,
        paint: function (ctx, m) {
          var U = ui()
          return U ? U.paint(ctx, m, { hoverId: OP.Menus ? OP.Menus.state.hoverId : null }) : 0
        },
        activate: activate,
        back: function () { return 'title' }
      })
    }
    return LegendsScreen
  }

  OP.LegendsScreen = LegendsScreen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
// build-epoch 2026-09-04D (hero + boost nodes)

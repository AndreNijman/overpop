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

  var PAD = 40
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

    marks.push(U.tracked(PAD, 90, 'LEGENDS', { size: 30, colour: C.ink, track: 0.2, weight: '600' }))

    if (!sum || !sum.active) {
      // Entry screen — build a Starter Party (up to 3 artifacts), then begin.
      var starters = (OP.LegendsData && OP.LegendsData.starterKeys)
        ? OP.LegendsData.starterKeys() : []
      var pickState = (OP.Menus && OP.Menus.state && OP.Menus.state.legendsStart) || null
      var picks = (pickState && Array.isArray(pickState.picks)) ? pickState.picks.slice() : []
      var maxParty = OP.Legends && OP.Legends.STARTING_PARTY ? OP.Legends.STARTING_PARTY : 3

      marks.push(U.text(PAD, 140, 'No campaign in progress. Build a Starter Party, then begin.',
        { size: 11, colour: C.dim }))
      marks.push(U.tracked(PAD, 176, 'STARTER PARTY', { size: 18, colour: C.moss, track: 0.24, weight: '600' }))
      marks.push(U.text(PAD + 2, 200, 'Pick up to ' + maxParty + ' artifacts to carry into the campaign.',
        { size: 10, colour: C.dim }))
      marks.push(U.rule(PAD, 218, FIELD_W - PAD * 2))

      var cardW = 360
      var cardH = 78
      var gap = 24
      var rowY0 = 252
      for (var a = 0; a < starters.length; a++) {
        var artKey = starters[a]
        var art = (OP.LegendsData && OP.LegendsData.getArtifact)
          ? OP.LegendsData.getArtifact(artKey) : null
        if (!art) continue
        var col = a % 3
        var row = Math.floor(a / 3)
        var ax = PAD + col * (cardW + gap)
        var ay = rowY0 + row * (cardH + 16)
        var sel = picks.indexOf(art.key) >= 0
        widgets.push(U.button('legends.pick.' + art.key, ax, ay, cardW, cardH, {
          label: art.name, action: 'legends-pick', arg: art.key, selected: sel,
          sub: art.blurb, align: 'left'
        }))
      }

      var vy = rowY0 + 2 * (cardH + 16) + 8
      marks.push(U.text(PAD, vy, picks.length + ' / ' + maxParty + ' selected' +
        (picks.length === maxParty ? '  (party full)' : ''),
        { size: 11, colour: picks.length ? C.moss : C.dim }))

      widgets.push(U.button('legends.start', PAD, vy + 24, 360, 54, {
        label: 'BEGIN RUN', tone: 'primary', action: 'legends-start',
        sub: picks.length ? 'start with your chosen artifacts' : 'start with a random artifact'
      }))
      widgets.push(U.button('legends.quick', PAD + 384, vy + 24, 360, 54, {
        label: 'CLEAR PICKS', action: 'legends-clear',
        sub: 'clear the party, begin with a random artifact'
      }))
      widgets.push(U.button('legends.back', FIELD_W - PAD - 120, 60, 120, 38, {
        label: '< BACK', action: 'back'
      }))
      return model(marks, widgets, 'legends.start')
    }

    // Status bar.
    marks.push(U.text(PAD, 128, 'STAGE ' + (sum.stage + 1) + ' / ' + sum.stages, { size: 11, colour: C.moss, track: 0.3 }))
    marks.push(U.text(PAD, 150, 'CASH $' + Math.floor(sum.cash) + '   ·   LIVES ' + sum.lives, { size: 12, colour: C.ink, weight: '600' }))
    var artLine = 'ARTIFACTS: ' + (sum.artifacts.length ? sum.artifacts.map(artName).join(', ') : 'none')
    marks.push(U.text(PAD, 172, artLine, { size: 10, colour: C.dim }))
    marks.push(U.rule(PAD, 190, FIELD_W - PAD * 2))

    // The board: one tile per node, entrance..boss.
    var board = OP.Legends.board ? OP.Legends.board(profile) : []
    if (!board.length) {
      marks.push(U.text(PAD, 220, 'This stage has no nodes.', { size: 13, colour: C.dim }))
      widgets.push(U.button('legends.back', FIELD_W - PAD - 120, 60, 120, 38, { label: '< BACK', action: 'back' }))
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

    if (isMerchant) {
      var mPrice = (OP.Legends && OP.Legends.merchantPrice) ? OP.Legends.merchantPrice(profile) : 250
      var canAfford = sum.cash >= mPrice
      marks.push(U.text(PAD, 474, 'A travelling merchant offers a relic for $' + mPrice + '.',
        { size: 11, colour: C.dim }))
      widgets.push(U.button('legends.buy', PAD, 430, 300, 58, {
        label: 'BUY ARTIFACT', tone: 'primary', action: 'legends-buy',
        sub: canAfford ? 'spend $' + mPrice + ' on a random relic' : 'not enough cash'
      }))
      widgets.push(U.button('legends.skip', PAD, 430 + 72, 300, 46, {
        label: 'SKIP', action: 'legends-skip', sub: 'pass on this merchant'
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
      widgets.push(U.button('legends.fight', PAD, 430, 300, 58, {
        label: fightLabel, tone: 'primary', action: 'legends-fight', arg: 'next',
        sub: fightSub
      }))
      widgets.push(U.button('legends.abandon', PAD, 430 + 72, 300, 46, {
        label: 'ABANDON RUN', action: 'legends-abandon', sub: 'lose everything, keep nothing'
      }))
    }
    widgets.push(U.button('legends.back', FIELD_W - PAD - 120, 60, 120, 38, {
      label: '< BACK', action: 'back'
    }))

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
    if (w.action === 'legends-clear') {
      var sc = OP.Menus && OP.Menus.state
      if (sc) sc.legendsStart = null
      return true
    }
    if (w.action === 'legends-buy' || w.action === 'legends-skip') {
      if (app && app.legendsMerchant) app.legendsMerchant(w.action === 'legends-buy')
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

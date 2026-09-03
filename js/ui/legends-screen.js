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
      marks.push(U.text(PAD, 148, 'No campaign in progress.', { size: 15, colour: C.dim }))
      marks.push(U.rule(PAD, 178, FIELD_W - PAD * 2))
      marks.push(U.text(PAD, 200, 'Rogue-Legends-style campaign. Beat battles to advance',
        { size: 11, colour: C.dim }))
      marks.push(U.text(PAD, 218, 'across escalating stages, collect artifacts, and keep',
        { size: 11, colour: C.dim }))
      marks.push(U.text(PAD, 236, 'your cash and lives between battles. Lose a battle and',
        { size: 11, colour: C.dim }))
      marks.push(U.text(PAD, 254, 'the run is over.', { size: 11, colour: C.dim }))
      widgets.push(U.button('legends.start', PAD, 300, 360, 58, {
        label: 'START NEW RUN', tone: 'primary', action: 'legends-start',
        sub: 'begin a fresh campaign'
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
    var fightLabel = isBoss ? 'FACE THE BOSS' : isElite ? 'ELITE BATTLE' : isChest ? 'OPEN THE CHEST' : 'FIGHT'
    var fightSub = isChest
      ? 'a battle, then a random artifact'
      : 'win a battle to advance'

    widgets.push(U.button('legends.fight', PAD, 430, 300, 58, {
      label: fightLabel, tone: 'primary', action: 'legends-fight', arg: 'next',
      sub: fightSub
    }))
    widgets.push(U.button('legends.abandon', PAD, 430 + 72, 300, 46, {
      label: 'ABANDON RUN', action: 'legends-abandon', sub: 'lose everything, keep nothing'
    }))
    widgets.push(U.button('legends.back', FIELD_W - PAD - 120, 60, 120, 38, {
      label: '< BACK', action: 'back'
    }))

    return model(marks, widgets)
  }

  function nodeLabel (node) { return (node && node.name) || 'Node' }
  function nodeKind (node) { return node ? String(node.kind).toUpperCase() : '' }

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

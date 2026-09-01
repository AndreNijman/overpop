;(function (OP) {
  'use strict'

  const Screen = {}
  const PAD = 96
  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus.COLOURS }
  function profileOf (app) { return app && app.state ? app.state.profile : null }

  Screen.build = function (app) {
    const U = ui()
    if (!U) return { screen: 'knowledge', backdrop: 'solid', marks: [], widgets: [] }
    const C = colours()
    const profile = profileOf(app) || { knowledge: [], knowledgePoints: 0 }
    const unlocked = new Set(profile.knowledge || [])
    const marks = []
    const widgets = []

    marks.push(U.tracked(PAD, 84, 'CRITTER WISDOM', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 108, 'Spend knowledge points on permanent bonuses for future runs.', { size: 11, colour: C.dim }))
    marks.push(U.text(FIELD_W - PAD - 118, 84, 'KP ' + (profile.knowledgePoints || 0), {
      size: 18, colour: C.gold, align: 'right', weight: '600'
    }))
    widgets.push(U.button('knowledge.back', FIELD_W - PAD - 96, 62, 96, 32, {
      label: 'BACK', action: 'back', align: 'center'
    }))
    marks.push(U.rule(PAD, 126, FIELD_W - PAD * 2))

    const branches = OP.KNOWLEDGE_BRANCH_ORDER || []
    const branchNames = OP.KNOWLEDGE_BRANCH_NAMES || {}
    for (let b = 0; b < branches.length; b++) {
      const branch = branches[b]
      const x = PAD + b * 216
      marks.push(U.tracked(x, 154, (branchNames[branch] || branch).toUpperCase(), {
        size: 10, colour: C.moss, track: 0.18, weight: '600'
      }))

      const nodes = []
      for (const key of (OP.KNOWLEDGE_ORDER || [])) {
        const node = OP.KNOWLEDGE && OP.KNOWLEDGE[key]
        if (node && node.branch === branch) nodes.push(node)
      }

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const owned = unlocked.has(node.key)
        const prereqs = node.prereqs.every(k => unlocked.has(k))
        const affordable = (profile.knowledgePoints || 0) >= node.cost
        const available = !owned && prereqs
        let sub = owned ? 'UNLOCKED' : available ? node.cost + ' KP' : 'LOCKED'
        if (available && !affordable) sub = node.cost + ' KP / NEED MORE'
        widgets.push(U.button('knowledge.' + node.key, x, 168 + i * 78, 200, 66, {
          label: node.name.toUpperCase(),
          sub: sub,
          action: 'knowledge-buy',
          arg: node.key,
          selected: owned,
          disabled: owned || !available || !affordable,
          reason: owned ? 'Already unlocked.' : !prereqs ? 'Unlock its prerequisites first.' : 'Not enough knowledge points.'
        }))
      }
    }

    const notice = OP.Menus && OP.Menus.state ? OP.Menus.state.notice : ''
    if (notice) marks.push(U.text(FIELD_W - PAD, 700, notice, { size: 10, colour: C.warn, align: 'right' }))
    marks.push(U.text(PAD, 700, 'Select an available node to unlock it.', { size: 10, colour: C.faint }))
    return { screen: 'knowledge', backdrop: 'solid', marks: marks, widgets: widgets }
  }

  Screen.activate = function (app, w) {
    if (!w || w.action !== 'knowledge-buy') return false
    const profile = profileOf(app)
    const res = OP.Knowledge.purchase(profile, w.arg)
    if (OP.Menus && OP.Menus.state) {
      OP.Menus.state.notice = res.ok ? res.node.name + ' unlocked.' : res.reason
    }
    if (res.ok && OP.Save && OP.Save.save) OP.Save.save(profile)
    return true
  }

  Screen.install = function () {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('knowledge', {
        build: Screen.build,
        activate: Screen.activate,
        back: function () { return 'title' }
      })
    }
    return Screen
  }

  OP.KnowledgeScreen = Screen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

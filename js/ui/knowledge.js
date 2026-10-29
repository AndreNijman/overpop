;(function (OP) {
  'use strict'

  const Screen = {}
  const PAD = 96
  const FIELD_W = OP.FIELD_W

  function ui () { return OP.Menus && OP.Menus.UI ? OP.Menus.UI : null }
  function colours () { return OP.Menus.COLOURS }
  function profileOf (app) { return app && app.state ? app.state.profile : null }

  // Which branch tab is open and which node the detail panel describes. The
  // old screen laid all seven branches side by side, which ran off the right
  // edge and showed only the first seven nodes of each; most were unreachable.
  Screen.state = { branch: null, key: null }
  const state = Screen.state

  function nodesOf (branch) {
    const nodes = []
    for (const key of (OP.KNOWLEDGE_ORDER || [])) {
      const node = OP.KNOWLEDGE && OP.KNOWLEDGE[key]
      if (node && node.branch === branch) nodes.push(node)
    }
    return nodes
  }

  function statusOf (node, profile, unlocked, unlockedKeys) {
    const owned = unlocked.has(node.key)
    const prereqs = node.prereqs.every(k => unlocked.has(k))
    const gated = prereqs && OP.knowledgeGateOpen && !OP.knowledgeGateOpen(node, unlockedKeys)
    const affordable = (profile.knowledgePoints || 0) >= node.cost
    const available = !owned && prereqs && !gated
    return {
      owned: owned,
      available: available,
      affordable: affordable,
      reason: owned ? 'Already unlocked.'
        : !prereqs ? 'Unlock its prerequisites first.'
        : gated ? 'Invest more knowledge points in this branch first.'
        : !affordable ? 'Not enough knowledge points.'
        : ''
    }
  }

  Screen.build = function (app) {
    const U = ui()
    if (!U) return { screen: 'knowledge', backdrop: 'solid', marks: [], widgets: [] }
    const C = colours()
    const profile = profileOf(app) || { knowledge: [], knowledgePoints: 0 }
    const unlocked = new Set(profile.knowledge || [])
    const unlockedKeys = profile.knowledge || []
    const kp = profile.knowledgePoints || 0
    const marks = []
    const widgets = []
    const contentW = FIELD_W - PAD * 2

    marks.push(U.tracked(PAD, 84, 'CRITTER WISDOM', { size: 20, colour: C.ink, track: 0.26, weight: '600' }))
    marks.push(U.text(PAD, 108, 'Spend knowledge points on permanent bonuses for future runs.', { size: 11, colour: C.dim }))
    marks.push(U.text(FIELD_W - PAD - 118, 84, 'KP ' + kp, {
      size: 18, colour: C.gold, align: 'right', weight: '600'
    }))
    widgets.push(U.button('knowledge.back', FIELD_W - PAD - 96, 62, 96, 32, {
      label: 'BACK', action: 'back', align: 'center'
    }))

    const branches = OP.KNOWLEDGE_BRANCH_ORDER || []
    const branchNames = OP.KNOWLEDGE_BRANCH_NAMES || {}
    if (!branches.length) return { screen: 'knowledge', backdrop: 'solid', marks: marks, widgets: widgets }
    if (branches.indexOf(state.branch) < 0) state.branch = branches[0]

    /* ----- one tab per branch, with how much of it is owned ----- */
    const tabW = Math.floor(contentW / branches.length)
    for (let b = 0; b < branches.length; b++) {
      const branch = branches[b]
      const all = nodesOf(branch)
      const owned = all.filter(n => unlocked.has(n.key)).length
      widgets.push(U.tab('knowledge.tab.' + branch, PAD + b * tabW, 124, tabW, 34, {
        label: (branchNames[branch] || branch).toUpperCase() + '  ' + owned + '/' + all.length,
        selected: branch === state.branch, action: 'knowledge-branch', arg: branch
      }))
    }

    /* ----- the branch's nodes, two columns filled top to bottom ----- */
    const nodes = nodesOf(state.branch)
    if (!nodes.some(n => n.key === state.key)) {
      const firstOpen = nodes.find(n => statusOf(n, profile, unlocked, unlockedKeys).available)
      state.key = (firstOpen || nodes[0] || {}).key || null
    }
    const top = 176
    const bottom = 664
    const listW = 620
    const gapX = 12
    const colW = Math.floor((listW - gapX) / 2)
    const perCol = Math.max(1, Math.ceil(nodes.length / 2))
    const gapY = 6
    const rowH = Math.min(48, Math.floor((bottom - top + gapY) / perCol) - gapY)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const st = statusOf(node, profile, unlocked, unlockedKeys)
      const col = Math.floor(i / perCol)
      const x = PAD + col * (colW + gapX)
      const y = top + (i % perCol) * (rowH + gapY)
      widgets.push(U.row('knowledge.' + node.key, x, y, colW, rowH, {
        label: node.name,
        sub: st.owned ? 'Unlocked' : st.available ? (st.affordable ? 'Ready to unlock' : 'Need ' + (node.cost - kp) + ' more KP') : 'Locked',
        note: st.owned ? '' : node.cost + ' KP',
        swatch: st.owned ? C.moss : st.available ? C.gold : '#3e2a18',
        selected: node.key === state.key,
        action: 'knowledge-pick',
        arg: node.key
      }))
    }

    /* ----- detail: what the picked node does and what it needs ----- */
    const sel = nodes.find(n => n.key === state.key)
    const dx = PAD + listW + 24
    const dw = FIELD_W - PAD - dx
    marks.push(U.box(dx, top, dw, bottom - top, { fill: '#5a3a1e', stroke: '#2a1a0a', alpha: 0.97 }))
    if (sel) {
      const st = statusOf(sel, profile, unlocked, unlockedKeys)
      const ix = dx + 18
      const iw = dw - 36
      marks.push(U.text(ix, top + 36, U.clipText(sel.name.toUpperCase(), 20, iw), { size: 20, colour: C.ink, weight: '700' }))
      marks.push(U.text(ix, top + 58, (branchNames[sel.branch] || sel.branch).toUpperCase() + ' · TIER ' + (sel.tier || 1) + ' · ' + sel.cost + ' KP', {
        size: 11, colour: C.moss, weight: '600'
      }))
      const blurb = U.wrapText(sel.blurb || '', 13, iw, 5)
      for (let i = 0; i < blurb.length; i++) {
        marks.push(U.text(ix, top + 92 + i * 19, blurb[i], { size: 13, colour: C.ink }))
      }
      let y = top + 92 + Math.max(1, blurb.length) * 19 + 18
      marks.push(U.rule(ix, y - 12, iw, { alpha: 0.6 }))
      marks.push(U.tracked(ix, y + 6, 'NEEDS', { size: 10, colour: C.faint, track: 0.24, weight: '600' }))
      if (!sel.prereqs.length) {
        marks.push(U.text(ix + 80, y + 6, 'Nothing. A root of this branch.', { size: 12, colour: C.dim }))
        y += 22
      } else {
        for (let i = 0; i < sel.prereqs.length; i++) {
          const pre = OP.KNOWLEDGE[sel.prereqs[i]]
          const have = unlocked.has(sel.prereqs[i])
          marks.push(U.text(ix + 80, y + 6 + i * 20, (pre ? pre.name : sel.prereqs[i]) + (have ? '  (owned)' : '  (missing)'), {
            size: 12, colour: have ? C.moss : C.warn
          }))
        }
        y += sel.prereqs.length * 20 + 2
      }
      if (sel.gate) {
        const invested = OP.knowledgeBranchInvested ? OP.knowledgeBranchInvested(unlockedKeys, sel.branch) : 0
        marks.push(U.tracked(ix, y + 6, 'BRANCH', { size: 10, colour: C.faint, track: 0.24, weight: '600' }))
        marks.push(U.text(ix + 80, y + 6, invested + ' / ' + sel.gate + ' KP invested here', {
          size: 12, colour: invested >= sel.gate ? C.moss : C.warn
        }))
      }

      const by = bottom - 62
      if (st.owned) {
        marks.push(U.text(ix, by + 28, 'Unlocked. It applies to every run that allows knowledge.', { size: 12, colour: C.moss }))
      } else {
        widgets.push(U.button('knowledge.buy', ix, by, iw, 44, {
          label: 'UNLOCK FOR ' + sel.cost + ' KP',
          align: 'center',
          tone: 'primary',
          action: 'knowledge-buy',
          arg: sel.key,
          disabled: !st.available || !st.affordable,
          reason: st.reason
        }))
        if (st.reason) marks.push(U.text(ix + iw / 2, by - 10, st.reason, { size: 11, colour: C.warn, align: 'center' }))
      }
    }

    marks.push(U.rule(PAD, 676, contentW, { alpha: 0.6 }))
    const notice = OP.Menus && OP.Menus.state ? OP.Menus.state.notice : ''
    if (notice) marks.push(U.text(FIELD_W - PAD, 700, notice, { size: 11, colour: C.warn, align: 'right' }))
    marks.push(U.text(PAD, 700, 'ESC back · pick a branch, then a node · KP come from wins and achievements', { size: 11, colour: C.faint }))
    return {
      screen: 'knowledge', backdrop: 'solid', marks: marks, widgets: widgets,
      defaultId: state.key ? 'knowledge.' + state.key : 'knowledge.back'
    }
  }

  Screen.activate = function (app, w) {
    if (!w) return false
    if (w.action === 'knowledge-branch') { state.branch = w.arg; state.key = null; return true }
    if (w.action === 'knowledge-pick') { state.key = w.arg; return true }
    if (w.action !== 'knowledge-buy') return false
    const profile = profileOf(app)
    const res = OP.Knowledge.purchase(profile, w.arg)
    if (OP.Menus && OP.Menus.state) {
      OP.Menus.state.notice = res.ok ? res.node.name + ' unlocked.' : res.reason
    }
    if (res.ok && OP.Save && OP.Save.save) OP.Save.save(profile)
    return true
  }

  /** Left/right step through the branch tabs. */
  Screen.key = function (app, key) {
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false
    const branches = OP.KNOWLEDGE_BRANCH_ORDER || []
    if (!branches.length) return false
    const i = Math.max(0, branches.indexOf(state.branch))
    state.branch = branches[(i + (key === 'ArrowRight' ? 1 : branches.length - 1)) % branches.length]
    state.key = null
    return true
  }

  Screen.install = function () {
    if (OP.Menus && OP.Menus.registerScreen) {
      OP.Menus.registerScreen('knowledge', {
        build: Screen.build,
        activate: Screen.activate,
        key: Screen.key,
        back: function () { return 'title' }
      })
    }
    return Screen
  }

  OP.KnowledgeScreen = Screen
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

/**
 * KNOWLEDGE — resolution and application.
 *
 * This module bridges the knowledge tree data with the live simulation.
 * It handles:
 *  - Applying knowledge rule overrides to sim.rules at game start
 *  - Registering knowledge stat mods as global buffs at sim creation
 *  - Providing read-only accessors for the UI
 *
 * Knowledge bonuses are deterministic config deltas — no randomness,
 * no code paths, consistent with ARCHITECTURE §8.
 */
;(function () {
  'use strict'

  const Knowledge = {}

  /**
   * Apply knowledge rule overrides to a resolved rules object.
   * Called after Sim.resolveRules so knowledge sits on top of
   * difficulty + mode resolution.
   *
   * @param {Object}  rules     resolved sim.rules (mutated in place)
   * @param {string[]} unlocked  set of unlocked knowledge node keys
   * @returns {Object}          the mutated rules object
   */
  Knowledge.applyRules = function (rules, unlocked) {
    if (!OP.KNOWLEDGE || !unlocked || !unlocked.length) return rules
    const overrides = OP.knowledgeRules(unlocked)
    for (const f in overrides) {
      const v = overrides[f]
      if (typeof v === 'number') {
        // Additive for numeric fields
        rules[f] = (rules[f] || 0) + v
      } else {
        // Boolean / other: assign
        rules[f] = v
      }
    }
    return rules
  }

  /**
   * Register knowledge stat mods as global buffs on the sim.
   * Called once at sim creation, after towers are placed.
   * Uses the existing Buffs infrastructure with radius 'global'.
   *
   * @param {Object}  sim       the live sim
   * @param {string[]} unlocked  set of unlocked knowledge node keys
   */
  Knowledge.registerBuffs = function (sim, unlocked) {
    if (!OP.Buffs || !OP.KNOWLEDGE || !unlocked || !unlocked.length) return

    // One buff per node lets Buffs apply additive and multiplicative fields with
    // its existing commutative rules. Pre-merging multipliers by addition would
    // turn two 0.95 cooldown modifiers into a harmful 1.90 multiplier.
    for (const k of unlocked) {
      const n = OP.KNOWLEDGE[k]
      if (!n || !n.mods || !Object.keys(n.mods).length) continue
      OP.Buffs.register(sim, {
        id: 'knowledge-' + k,
        sourceId: -1,
        x: 0,
        y: 0,
        radius: 'global',
        priority: 0,
        families: n.family ? [n.family] : null,
        keys: null,
        selfOnly: false,
        excludeSelf: false,
        mods: n.mods
      })
    }
  }

  Knowledge.canPurchase = function (profile, key) {
    const node = OP.KNOWLEDGE && OP.KNOWLEDGE[key]
    if (!node) return { ok: false, reason: 'Unknown knowledge node.' }
    if (!profile) return { ok: false, reason: 'No player profile.' }
    const unlocked = Array.isArray(profile.knowledge) ? profile.knowledge : []
    if (unlocked.indexOf(key) >= 0) return { ok: false, reason: 'Already unlocked.' }
    for (let i = 0; i < node.prereqs.length; i++) {
      if (unlocked.indexOf(node.prereqs[i]) < 0) return { ok: false, reason: 'Unlock its prerequisites first.' }
    }
    const points = typeof profile.knowledgePoints === 'number' ? profile.knowledgePoints : 0
    if (points < node.cost) return { ok: false, reason: 'Not enough knowledge points.' }
    return { ok: true, reason: '', node: node }
  }

  Knowledge.purchase = function (profile, key) {
    const allowed = Knowledge.canPurchase(profile, key)
    if (!allowed.ok) return allowed
    if (!Array.isArray(profile.knowledge)) profile.knowledge = []
    profile.knowledge.push(key)
    profile.knowledge.sort()
    profile.knowledgePoints -= allowed.node.cost
    return { ok: true, reason: '', node: allowed.node, remaining: profile.knowledgePoints }
  }

  /**
   * Compute the total cost of all unlocked nodes.
   *
   * @param {string[]} unlocked  set of unlocked node keys
   * @returns {number}           total KP spent
   */
  Knowledge.spent = function (unlocked) {
    let total = 0
    for (const k of (unlocked || [])) {
      const n = OP.KNOWLEDGE[k]
      if (n) total += n.cost
    }
    return total
  }

  /**
   * Summary of the knowledge tree for the UI.
   *
   * @param {string[]} unlocked  set of unlocked node keys
   * @returns {Object}           { nodes, branches, available, spent, totalCost }
   */
  Knowledge.summary = function (unlocked) {
    const u = new Set(unlocked || [])
    const nodes = []
    for (const k in OP.KNOWLEDGE) {
      const n = OP.KNOWLEDGE[k]
      nodes.push({
        key: n.key,
        name: n.name,
        blurb: n.blurb,
        branch: n.branch,
        tier: n.tier,
        cost: n.cost,
        prereqs: n.prereqs,
        unlocked: u.has(k),
        available: n.prereqs.every(p => u.has(p)) && !u.has(k)
      })
    }
    return {
      nodes,
      branches: OP.KNOWLEDGE_BRANCH_ORDER,
      branchNames: OP.KNOWLEDGE_BRANCH_NAMES,
      available: OP.knowledgeAvailable(unlocked),
      spent: Knowledge.spent(unlocked),
      totalCost: OP.KNOWLEDGE_TOTAL_COST
    }
  }

  OP.Knowledge = Knowledge
})()

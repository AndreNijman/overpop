/**
 * KNOWLEDGE — the persistent skill tree.
 *
 * Knowledge is OVERPOP's cross-run progression system.  Players earn
 * knowledge points by completing rounds and finishing games; they spend
 * those points on a branching tree of passive bonuses that apply to every
 * subsequent run.  The tree is themed as "Critic Wisdom" — the accumulated
 * expertise of the woodland critics who judge your performance.
 *
 * ARCHITECTURE
 * ============
 * Each node is a plain object keyed by a unique id.  Nodes belong to one
 * of five branches (primary, military, magic, support, general).  A node
 * requires one or more parent nodes to be unlocked before it can be
 * purchased.  The cost is in knowledge points (KP), earned after each run.
 *
 * Bonuses are expressed as stat deltas — the same shape the buff system
 * uses.  When a node is unlocked, its mods are added to a global pool
 * that is applied to every tower at restat time, and its ruleOverrides
 * are folded into sim.rules at game start.
 *
 * The data is a plain IIFE attaching to OP.KNOWLEDGE.
 */
;(function () {
  'use strict'

  /**
   * A single node in the knowledge tree.
   *
   * @typedef {Object} KnowledgeNode
   * @property {string}   key           unique id
   * @property {string}   name          display name
   * @property {string}   blurb         flavour text (rendered in the tree UI)
   * @property {string}   branch        one of 'primary','military','magic','support','general'
   * @property {number}   tier          0 = root (free first pick), 1–4 deeper tiers
   * @property {number}   cost          KP to unlock
   * @property {string[]} prereqs       keys of nodes that must be unlocked first
   * @property {Object}   mods          stat deltas applied to towers (same shape as buff mods)
   * @property {Object}  [ruleOverrides] deltas applied to sim.rules at game start
   * @property {string}  [family]       if set, mods only apply to towers in this family
   */

  /** @type {Object<string, KnowledgeNode>} */
  const TREE = {

    /* ==================== GENERAL BRANCH ==================== */

    'gen-start-cash': {
      key: 'gen-start-cash',
      name: 'Deep Pockets',
      blurb: 'A few extra coins in your pouch before the first round.',
      branch: 'general',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: {},
      ruleOverrides: { startCash: 50 }
    },
    'gen-pop-income': {
      key: 'gen-pop-income',
      name: 'Keen Eye',
      blurb: 'Every pop earns a fraction more — the critics demand a detailed accounting.',
      branch: 'general',
      tier: 1,
      cost: 2,
      prereqs: ['gen-start-cash'],
      mods: {},
      ruleOverrides: { cashPerPopMul: 0.05 }
    },
    'gen-round-bonus': {
      key: 'gen-round-bonus',
      name: 'Round Stipend',
      blurb: 'A small bonus at the end of each round, courtesy of the critic fund.',
      branch: 'general',
      tier: 1,
      cost: 2,
      prereqs: ['gen-start-cash'],
      mods: {},
      ruleOverrides: { roundBonusMul: 0.05 }
    },
    'gen-extra-life': {
      key: 'gen-extra-life',
      name: 'Thick Fur',
      blurb: 'One extra life.  The forest is forgiving — once.',
      branch: 'general',
      tier: 2,
      cost: 3,
      prereqs: ['gen-pop-income'],
      mods: {},
      ruleOverrides: { startLives: 1 }
    },
    'gen-sell-rate': {
      key: 'gen-sell-rate',
      name: 'Haggle',
      blurb: 'You get a better price when you sell a tower.',
      branch: 'general',
      tier: 2,
      cost: 3,
      prereqs: ['gen-round-bonus'],
      mods: {},
      ruleOverrides: { sellRate: 0.05 }
    },
    'gen-hero-xp': {
      key: 'gen-hero-xp',
      name: 'Mentorship',
      blurb: 'Your hero learns a little faster from every encounter.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-extra-life', 'gen-sell-rate'],
      mods: {},
      ruleOverrides: { heroXpMul: 0.10 }
    },

    /* ==================== PRIMARY BRANCH ==================== */

    'pri-damage': {
      key: 'pri-damage',
      name: 'Sharpened Claws',
      blurb: 'Primary critters deal a point of extra damage.',
      branch: 'primary',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: { damageAdd: 1 },
      family: 'primary'
    },
    'pri-pierce': {
      key: 'pri-pierce',
      name: 'Thick Hide',
      blurb: 'Primary projectiles pierce through one extra target.',
      branch: 'primary',
      tier: 1,
      cost: 2,
      prereqs: ['pri-damage'],
      mods: { pierceAdd: 1 },
      family: 'primary'
    },
    'pri-range': {
      key: 'pri-range',
      name: 'Wider View',
      blurb: 'Primary towers see a little further into the forest.',
      branch: 'primary',
      tier: 1,
      cost: 2,
      prereqs: ['pri-damage'],
      mods: { rangeAdd: 10 },
      family: 'primary'
    },
    'pri-cooldown': {
      key: 'pri-cooldown',
      name: 'Quick Paws',
      blurb: 'Primary towers attack a fraction faster.',
      branch: 'primary',
      tier: 2,
      cost: 3,
      prereqs: ['pri-pierce', 'pri-range'],
      mods: { cooldownMul: 0.95 },
      family: 'primary'
    },
    'pri-crit': {
      key: 'pri-crit',
      name: 'Predator Edge',
      blurb: 'Primary attacks deal eight percent more damage.',
      branch: 'primary',
      tier: 3,
      cost: 4,
      prereqs: ['pri-cooldown'],
      mods: { damageMul: 1.08 },
      family: 'primary'
    },

    /* ==================== MILITARY BRANCH ==================== */

    'mil-damage': {
      key: 'mil-damage',
      name: 'Calibrated Sights',
      blurb: 'Military critters deal a point of extra damage.',
      branch: 'military',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: { damageAdd: 1 },
      family: 'military'
    },
    'mil-range': {
      key: 'mil-range',
      name: 'Scout Owl',
      blurb: 'Military towers see further — the owl watches from above.',
      branch: 'military',
      tier: 1,
      cost: 2,
      prereqs: ['mil-damage'],
      mods: { rangeAdd: 15 },
      family: 'military'
    },
    'mil-proj-speed': {
      key: 'mil-proj-speed',
      name: 'Fletching',
      blurb: 'Military projectiles fly faster and arrive sooner.',
      branch: 'military',
      tier: 1,
      cost: 2,
      prereqs: ['mil-damage'],
      mods: { projSpeedMul: 1.10 },
      family: 'military'
    },
    'mil-camo': {
      key: 'mil-camo',
      name: 'Night Eyes',
      blurb: 'Military towers gain the ability to spot veiled targets.',
      branch: 'military',
      tier: 2,
      cost: 3,
      prereqs: ['mil-range', 'mil-proj-speed'],
      mods: { camoDetect: true },
      family: 'military'
    },
    'mil-los': {
      key: 'mil-los',
      name: 'Treetop Vigil',
      blurb: 'Military towers ignore line-of-sight blockers.',
      branch: 'military',
      tier: 3,
      cost: 4,
      prereqs: ['mil-camo'],
      mods: { ignoresLOS: true },
      family: 'military'
    },

    /* ==================== MAGIC BRANCH ==================== */

    'mag-damage': {
      key: 'mag-damage',
      name: 'Arcane Squeeze',
      blurb: 'Magic critters deal a point of extra damage.',
      branch: 'magic',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: { damageAdd: 1 },
      family: 'magic'
    },
    'mag-pierce': {
      key: 'mag-pierce',
      name: 'Chain Spark',
      blurb: 'Magic projectiles pierce through one extra target.',
      branch: 'magic',
      tier: 1,
      cost: 2,
      prereqs: ['mag-damage'],
      mods: { pierceAdd: 1 },
      family: 'magic'
    },
    'mag-range': {
      key: 'mag-range',
      name: 'Far Sight',
      blurb: 'Magic towers project their influence further.',
      branch: 'magic',
      tier: 1,
      cost: 2,
      prereqs: ['mag-damage'],
      mods: { rangeAdd: 10 },
      family: 'magic'
    },
    'mag-cooldown': {
      key: 'mag-cooldown',
      name: 'Quick Cast',
      blurb: 'Magic towers recover from their cooldown a little faster.',
      branch: 'magic',
      tier: 2,
      cost: 3,
      prereqs: ['mag-pierce', 'mag-range'],
      mods: { cooldownMul: 0.95 },
      family: 'magic'
    },
    'mag-brittle': {
      key: 'mag-brittle',
      name: 'Frostbrand',
      blurb: 'Magic attacks deal ten percent more damage.',
      branch: 'magic',
      tier: 3,
      cost: 4,
      prereqs: ['mag-cooldown'],
      mods: { damageMul: 1.10 },
      family: 'magic'
    },

    /* ==================== SUPPORT BRANCH ==================== */

    'sup-cost': {
      key: 'sup-cost',
      name: 'Long Reach',
      blurb: 'Support critters begin with five extra range.',
      branch: 'support',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: { rangeAdd: 5 },
      family: 'support'
    },
    'sup-range': {
      key: 'sup-range',
      name: 'Wide Aura',
      blurb: 'Support towers radiate their buffs further.',
      branch: 'support',
      tier: 1,
      cost: 2,
      prereqs: ['sup-cost'],
      mods: { rangeAdd: 15 },
      family: 'support'
    },
    'sup-pierce': {
      key: 'sup-pierce',
      name: 'Shared Vigour',
      blurb: 'Support projectiles pierce through one extra target.',
      branch: 'support',
      tier: 1,
      cost: 2,
      prereqs: ['sup-cost'],
      mods: { pierceAdd: 1 },
      family: 'support'
    },
    'sup-damage': {
      key: 'sup-damage',
      name: 'War Cry',
      blurb: 'Support critters deal a point of extra damage.',
      branch: 'support',
      tier: 2,
      cost: 3,
      prereqs: ['sup-range', 'sup-pierce'],
      mods: { damageAdd: 1 },
      family: 'support'
    },
    'sup-cooldown': {
      key: 'sup-cooldown',
      name: 'Inspiration',
      blurb: 'Support towers attack a fraction faster.',
      branch: 'support',
      tier: 3,
      cost: 4,
      prereqs: ['sup-damage'],
      mods: { cooldownMul: 0.95 },
      family: 'support'
    }
  }

  /** Display order for the five branches (left to right in the tree UI). */
  const BRANCH_ORDER = ['primary', 'military', 'magic', 'support', 'general']

  /** Branch display names. */
  const BRANCH_NAMES = {
    primary: 'Primary',
    military: 'Military',
    magic: 'Magic',
    support: 'Support',
    general: 'General'
  }

  /** Total KP cost of every node in the tree. */
  let totalCost = 0
  for (const k in TREE) totalCost += TREE[k].cost

  /* ---------- public API ---------- */

  OP.KNOWLEDGE = TREE
  OP.KNOWLEDGE_ORDER = Object.keys(TREE)
  OP.KNOWLEDGE_BRANCH_ORDER = BRANCH_ORDER
  OP.KNOWLEDGE_BRANCH_NAMES = BRANCH_NAMES
  OP.KNOWLEDGE_TOTAL_COST = totalCost

  /**
   * Validate that the tree is well-formed: every prereq exists, no cycles,
   * tiers are monotonically increasing along each branch.
   */
  OP.knowledgeValidate = function () {
    const keys = new Set(Object.keys(TREE))
    const errors = []
    for (const k in TREE) {
      const n = TREE[k]
      for (const p of n.prereqs) {
        if (!keys.has(p)) errors.push(`${k}: prereq "${p}" does not exist`)
        if (TREE[p] && TREE[p].branch !== n.branch) {
          errors.push(`${k}: prereq "${p}" is in a different branch`)
        }
      }
      if (n.tier > 0 && n.prereqs.length === 0) {
        errors.push(`${k}: non-root node has no prereqs`)
      }
    }
    return errors
  }

  /**
   * Given a set of unlocked node keys, return the set of keys that are
   * purchasable (all prereqs met, not already unlocked).
   */
  OP.knowledgeAvailable = function (unlocked) {
    const u = new Set(unlocked || [])
    const available = []
    for (const k in TREE) {
      if (u.has(k)) continue
      const n = TREE[k]
      if (n.prereqs.every(p => u.has(p))) available.push(k)
    }
    return available
  }

  /**
   * Compute the total stat mods from a set of unlocked knowledge nodes.
   * Returns a flat mods object suitable for merging into tower stats.
   *
   * @param {string[]} unlocked  set of unlocked node keys
   * @param {string}  [family]   if set, only include nodes matching this family or with no family
   * @returns {Object}           merged mods
   */
  OP.knowledgeMods = function (unlocked, family) {
    const mods = {}
    for (const k of (unlocked || [])) {
      const n = TREE[k]
      if (!n || !n.mods) continue
      if (n.family && family && n.family !== family) continue
      for (const f in n.mods) {
        const v = n.mods[f]
        if (typeof v === 'boolean') {
          mods[f] = mods[f] || v
        } else if (typeof v === 'number') {
          mods[f] = /Mul$/.test(f) ? (mods[f] === undefined ? 1 : mods[f]) * v : (mods[f] || 0) + v
        }
      }
    }
    return mods
  }

  /**
   * Compute the total rule overrides from a set of unlocked knowledge nodes.
   * Returns a flat object of rule deltas to fold into sim.rules.
   *
   * @param {string[]} unlocked  set of unlocked node keys
   * @returns {Object}           merged rule overrides
   */
  OP.knowledgeRules = function (unlocked) {
    const rules = {}
    for (const k of (unlocked || [])) {
      const n = TREE[k]
      if (!n || !n.ruleOverrides) continue
      for (const f in n.ruleOverrides) {
        const v = n.ruleOverrides[f]
        if (typeof v === 'number') {
          rules[f] = (rules[f] || 0) + v
        } else {
          rules[f] = v
        }
      }
    }
    return rules
  }

  /**
   * Calculate KP earned from a completed game.
   *
   * @param {Object} result  from Save.recordResult
   * @returns {number}       knowledge points earned
   */
  OP.knowledgeEarn = function (result) {
    if (!result || !result.won) return 0
    let kp = 1  // base KP for winning
    // Difficulty bonus
    const diffRank = { easy: 0, medium: 1, hard: 2, relentless: 3 }
    kp += diffRank[result.difficulty] || 0
    // Mode bonus
    const modeBonus = {
      'primary-only': 1, 'military-only': 1, 'magic-only': 1,
      'deflation': 1, 'onslaught': 1, 'half-cash': 2,
      'double-hp-blimps': 1, 'alternate-waves': 1, 'reverse': 1,
      'purist': 2, 'grim': 3, 'rampart': 3, 'no-mercy': 3,
      'boss-event': 2, 'boss-event-elite': 3
    }
    kp += modeBonus[result.mode] || 0
    return kp
  }
})()

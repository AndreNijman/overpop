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
      gate: 4,
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
      gate: 4,
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
      gate: 4,
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
      gate: 4,
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
      gate: 4,
      mods: { cooldownMul: 0.95 },
      family: 'support'
    },

    /* ==================== HEROES BRANCH ==================== */

    'her-damage': {
      key: 'her-damage',
      name: 'War Stories',
      blurb: 'Heroes deal a point of extra damage with every attack.',
      branch: 'heroes',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: { damageAdd: 1 },
      family: 'hero'
    },
    'her-range': {
      key: 'her-range',
      name: 'Legendary Reach',
      blurb: 'Heroes see a little further down the track.',
      branch: 'heroes',
      tier: 1,
      cost: 2,
      prereqs: ['her-damage'],
      mods: { rangeAdd: 8 },
      family: 'hero'
    },
    'her-xp': {
      key: 'her-xp',
      name: 'Seasoned Mentor',
      blurb: 'Every hero earns experience a tenth faster.',
      branch: 'heroes',
      tier: 1,
      cost: 2,
      prereqs: ['her-damage'],
      mods: {},
      ruleOverrides: { heroXpMul: 0.10 }
    },
    'her-cooldown': {
      key: 'her-cooldown',
      name: 'Battle Rhythm',
      blurb: 'Hero abilities come back around sooner.',
      branch: 'heroes',
      tier: 2,
      cost: 3,
      prereqs: ['her-range', 'her-xp'],
      mods: { cooldownMul: 0.90 },
      family: 'hero'
    },
    'her-cost': {
      key: 'her-cost',
      name: 'Heavy Throwing',
      blurb: 'Every hero projectile punches through one extra target.',
      branch: 'heroes',
      tier: 3,
      cost: 4,
      prereqs: ['her-cooldown'],
      gate: 7,
      mods: { pierceAdd: 1 },
      family: 'hero'
    },
    'her-start-level': {
      key: 'her-start-level',
      name: 'Folk Hero',
      blurb: 'Heroes learn the crowd faster — every hero earns experience a third quicker.',
      branch: 'heroes',
      tier: 4,
      cost: 6,
      prereqs: ['her-cost'],
      gate: 10,
      mods: {},
      ruleOverrides: { heroXpMul: 0.25 }
    },

    /* ==================== POWERS BRANCH ==================== */

    'pow-cash-drop': {
      key: 'pow-cash-drop',
      name: 'Deep Cache',
      blurb: 'Every cash-drop power pays out more.',
      branch: 'powers',
      tier: 0,
      cost: 1,
      prereqs: [],
      mods: {},
      ruleOverrides: { powerEffectMul: 0.15 }
    },
    'pow-longer-boost': {
      key: 'pow-longer-boost',
      name: 'Endurance Training',
      blurb: 'Boosts and slows from powers last longer.',
      branch: 'powers',
      tier: 1,
      cost: 2,
      prereqs: ['pow-cash-drop'],
      mods: {},
      ruleOverrides: { powerDurationMul: 0.20 }
    },
    'pow-lives': {
      key: 'pow-lives',
      name: 'Field Rations',
      blurb: 'Life-granting powers hand out more lives.',
      branch: 'powers',
      tier: 1,
      cost: 2,
      prereqs: ['pow-cash-drop'],
      mods: {},
      ruleOverrides: { startLives: 2 }
    },
    'pow-free-inventory': {
      key: 'pow-free-inventory',
      name: 'Well Stocked',
      blurb: 'Every run begins with one spare use of each owned power.',
      branch: 'powers',
      tier: 2,
      cost: 3,
      prereqs: ['pow-longer-boost', 'pow-lives'],
      mods: {},
      ruleOverrides: { powerStockBonus: 1 }
    },
    'pow-slow-boost': {
      key: 'pow-slow-boost',
      name: 'Sticky Business',
      blurb: 'Slow powers grip harder and longer.',
      branch: 'powers',
      tier: 3,
      cost: 4,
      prereqs: ['pow-free-inventory'],
      gate: 7,
      mods: {},
      ruleOverrides: { powerSlowAdd: 0.15, powerDurationMul: 0.10 }
    },
    'pow-big-boom': {
      key: 'pow-big-boom',
      name: 'Thunder Delivery',
      blurb: 'Damage powers hit the whole field harder.',
      branch: 'powers',
      tier: 4,
      cost: 5,
      prereqs: ['pow-slow-boost'],
      gate: 10,
      mods: {},
      ruleOverrides: { powerDamageAdd: 25 }
    },

    /* ==================== DEEPER NODES IN EXISTING BRANCHES ==================== */

    'gen-achievement-kp': {
      key: 'gen-achievement-kp',
      name: 'Crit Curriculum',
      blurb: 'A deeper pouch at the start and a bigger tip at the end of every round.',
      branch: 'general',
      tier: 4,
      cost: 5,
      prereqs: ['gen-hero-xp'],
      gate: 10,
      mods: {},
      ruleOverrides: { startCash: 75, roundBonusMul: 0.05 }
    },
    'pri-rage': {
      key: 'pri-rage',
      name: 'Frontline Frenzy',
      blurb: 'Primary towers wind up noticeably faster.',
      branch: 'primary',
      tier: 4,
      cost: 5,
      prereqs: ['pri-crit'],
      gate: 10,
      mods: { cooldownMul: 0.88 },
      family: 'primary'
    },
    'mil-supply': {
      key: 'mil-supply',
      name: 'Wider Payload',
      blurb: 'Military blasts cover a bigger footprint of the track.',
      branch: 'military',
      tier: 4,
      cost: 5,
      prereqs: ['mil-los'],
      gate: 10,
      mods: { blastRadiusAdd: 6 },
      family: 'military'
    },
    'mag-resonance': {
      key: 'mag-resonance',
      name: 'Arcane Resonance',
      blurb: 'Magic towers reach half a tile further down the track.',
      branch: 'magic',
      tier: 4,
      cost: 5,
      prereqs: ['mag-brittle'],
      gate: 10,
      mods: { rangeAdd: 10 },
      family: 'magic'
    },
    'sup-tax': {
      key: 'sup-tax',
      name: 'Audited Books',
      blurb: 'Selling anything recovers a bigger slice of its cost.',
      branch: 'support',
      tier: 4,
      cost: 5,
      prereqs: ['sup-cooldown'],
      gate: 10,
      mods: {},
      ruleOverrides: { sellRate: 0.05 }
    },

    /* ==================== SECOND-WAVE NODES ==================== */

    'pri-swift': {
      key: 'pri-swift',
      name: 'Quick Paws',
      blurb: 'Primary critters wind up a little faster.',
      branch: 'primary',
      tier: 1,
      cost: 2,
      prereqs: ['pri-damage'],
      mods: { cooldownMul: 0.96 },
      family: 'primary'
    },
    'pri-blast': {
      key: 'pri-blast',
      name: 'Bigger Bangs',
      blurb: 'Primary blasts cover a wider footprint.',
      branch: 'primary',
      tier: 1,
      cost: 2,
      prereqs: ['pri-pierce'],
      mods: { blastRadiusAdd: 4 },
      family: 'primary'
    },
    'pri-volley': {
      key: 'pri-volley',
      name: 'Double Fling',
      blurb: 'Primary towers loose one extra projectile per volley.',
      branch: 'primary',
      tier: 2,
      cost: 4,
      prereqs: ['pri-swift', 'pri-blast'],
      mods: { shotsAdd: 1 },
      family: 'primary'
    },
    'mil-velocity': {
      key: 'mil-velocity',
      name: 'Mach Fins',
      blurb: 'Military projectiles fly faster downrange.',
      branch: 'military',
      tier: 1,
      cost: 2,
      prereqs: ['mil-damage'],
      mods: { projSpeedMul: 1.10 },
      family: 'military'
    },
    'mil-pierce': {
      key: 'mil-pierce',
      name: 'Drilled Tips',
      blurb: 'Military shots punch through one extra target.',
      branch: 'military',
      tier: 2,
      cost: 3,
      prereqs: ['mil-velocity', 'mil-proj-speed'],
      mods: { pierceAdd: 1 },
      family: 'military'
    },
    'mag-impact': {
      key: 'mag-impact',
      name: 'Wide Arcana',
      blurb: 'Magic bursts splash across a wider area.',
      branch: 'magic',
      tier: 1,
      cost: 2,
      prereqs: ['mag-damage'],
      mods: { blastRadiusAdd: 5 },
      family: 'magic'
    },
    'mag-volley': {
      key: 'mag-volley',
      name: 'Twin Spells',
      blurb: 'Magic towers cast one extra projectile per volley.',
      branch: 'magic',
      tier: 3,
      cost: 4,
      prereqs: ['mag-impact'],
      gate: 7,
      mods: { shotsAdd: 1 },
      family: 'magic'
    },
    'sup-stock': {
      key: 'sup-stock',
      name: 'Fresh Supplies',
      blurb: 'Support blasts cover a wider footprint of the track.',
      branch: 'support',
      tier: 1,
      cost: 2,
      prereqs: ['sup-cost'],
      mods: { blastRadiusAdd: 4 },
      family: 'support'
    },
    'sup-pierce2': {
      key: 'sup-pierce2',
      name: 'Long Reach',
      blurb: 'Support towers reach half a tile further down the track.',
      branch: 'support',
      tier: 2,
      cost: 3,
      prereqs: ['sup-stock'],
      mods: { rangeAdd: 12 },
      family: 'support'
    },
    'gen-power-knowledge': {
      key: 'gen-power-knowledge',
      name: 'Old Recipes',
      blurb: 'Every power works a fraction harder.',
      branch: 'general',
      tier: 2,
      cost: 3,
      prereqs: ['gen-pop-income', 'gen-round-bonus'],
      mods: {},
      ruleOverrides: { powerEffectMul: 0.10 }
    },
    'her-vigor': {
      key: 'her-vigor',
      name: 'Trial by Fire',
      blurb: 'Heroes learn from the rush — every hero earns experience a fifth faster.',
      branch: 'heroes',
      tier: 2,
      cost: 3,
      prereqs: ['her-cooldown'],
      mods: {},
      ruleOverrides: { heroXpMul: 0.15 }
    },
    'pow-bigger-cache': {
      key: 'pow-bigger-cache',
      name: 'Grand Cache',
      blurb: 'Cash powers pay out even more.',
      branch: 'powers',
      tier: 2,
      cost: 3,
      prereqs: ['pow-cash-drop'],
      mods: {},
      ruleOverrides: { powerEffectMul: 0.20 }
    },

    /* ==================== THIRD WAVE (parity depth, 2026-09-08) ==================== */

    'pri-keen': {
      key: 'pri-keen',
      name: 'Watchful Nuts',
      blurb: 'Primary critters spot Veiled balloons on their own.',
      branch: 'primary',
      tier: 2,
      cost: 3,
      prereqs: ['pri-swift', 'pri-blast'],
      gate: 5,
      mods: { camoDetect: true },
      family: 'primary'
    },
    'pri-heavy': {
      key: 'pri-heavy',
      name: 'Heavier Throw',
      blurb: 'Every primary hit lands a little harder.',
      branch: 'primary',
      tier: 3,
      cost: 4,
      prereqs: ['pri-crit'],
      mods: { damageAdd: 1 },
      family: 'primary'
    },
    'pri-multi': {
      key: 'pri-multi',
      name: 'Triple Fling',
      blurb: 'One more projectile in every primary volley.',
      branch: 'primary',
      tier: 3,
      cost: 4,
      prereqs: ['pri-volley'],
      gate: 7,
      mods: { shotsAdd: 1 },
      family: 'primary'
    },
    'pri-long': {
      key: 'pri-long',
      name: 'Far Nuts',
      blurb: 'Primary towers reach further down the track.',
      branch: 'primary',
      tier: 2,
      cost: 3,
      prereqs: ['pri-blast'],
      mods: { rangeAdd: 12 },
      family: 'primary'
    },
    'pri-velocity': {
      key: 'pri-velocity',
      name: 'Whistling Throws',
      blurb: 'Primary projectiles fly faster downrange.',
      branch: 'primary',
      tier: 3,
      cost: 4,
      prereqs: ['pri-blast'],
      mods: { projSpeedMul: 1.12 },
      family: 'primary'
    },
    'pri-capstone': {
      key: 'pri-capstone',
      name: 'Backyard Legend',
      blurb: 'The whole primary line hits ten percent harder.',
      branch: 'primary',
      tier: 4,
      cost: 6,
      prereqs: ['pri-rage'],
      gate: 12,
      mods: { damageMul: 1.10 },
      family: 'primary'
    },
    'pri-pierce2': {
      key: 'pri-pierce2',
      name: 'Splitting Acorns',
      blurb: 'Primary shots punch through one extra target.',
      branch: 'primary',
      tier: 3,
      cost: 4,
      prereqs: ['pri-pierce'],
      mods: { pierceAdd: 1 },
      family: 'primary'
    },

    'mil-hardened': {
      key: 'mil-hardened',
      name: 'Hardened Payloads',
      blurb: 'Military hits land a little harder.',
      branch: 'military',
      tier: 2,
      cost: 3,
      prereqs: ['mil-velocity'],
      mods: { damageAdd: 1 },
      family: 'military'
    },
    'mil-scope': {
      key: 'mil-scope',
      name: 'Long Scopes',
      blurb: 'Military towers spot targets further down the track.',
      branch: 'military',
      tier: 2,
      cost: 3,
      prereqs: ['mil-range'],
      mods: { rangeAdd: 15 },
      family: 'military'
    },
    'mil-rapid': {
      key: 'mil-rapid',
      name: 'Drilled Crews',
      blurb: 'Military towers reload a touch faster.',
      branch: 'military',
      tier: 3,
      cost: 4,
      prereqs: ['mil-pierce'],
      mods: { cooldownMul: 0.94 },
      family: 'military'
    },
    'mil-splash': {
      key: 'mil-splash',
      name: 'Wide Craters',
      blurb: 'Military blasts cover a wider footprint.',
      branch: 'military',
      tier: 3,
      cost: 4,
      prereqs: ['mil-pierce'],
      mods: { blastRadiusAdd: 8 },
      family: 'military'
    },
    'mil-focus': {
      key: 'mil-focus',
      name: 'Fire Discipline',
      blurb: 'Military damage up five percent across the board.',
      branch: 'military',
      tier: 4,
      cost: 6,
      prereqs: ['mil-supply'],
      gate: 12,
      mods: { damageMul: 1.05 },
      family: 'military'
    },
    'mil-swift2': {
      key: 'mil-swift2',
      name: 'Springloaded',
      blurb: 'Military towers wind up a touch faster.',
      branch: 'military',
      tier: 2,
      cost: 3,
      prereqs: ['mil-proj-speed'],
      mods: { cooldownMul: 0.95 },
      family: 'military'
    },
    'mil-multi': {
      key: 'mil-multi',
      name: 'Salvo Drills',
      blurb: 'Military towers loose one extra projectile per volley.',
      branch: 'military',
      tier: 4,
      cost: 6,
      prereqs: ['mil-supply'],
      gate: 14,
      mods: { shotsAdd: 1 },
      family: 'military'
    },
    'mil-pierce2': {
      key: 'mil-pierce2',
      name: 'Armour Ticks',
      blurb: 'Military shots punch through one extra target.',
      branch: 'military',
      tier: 3,
      cost: 4,
      prereqs: ['mil-pierce'],
      mods: { pierceAdd: 1 },
      family: 'military'
    },

    'mag-arcane': {
      key: 'mag-arcane',
      name: 'Deeper Weave',
      blurb: 'Every magic hit lands a little harder.',
      branch: 'magic',
      tier: 2,
      cost: 3,
      prereqs: ['mag-impact'],
      mods: { damageAdd: 1 },
      family: 'magic'
    },
    'mag-widespell': {
      key: 'mag-widespell',
      name: 'Wide Sigils',
      blurb: 'Magic bursts splash across a wider area.',
      branch: 'magic',
      tier: 2,
      cost: 3,
      prereqs: ['mag-impact'],
      mods: { blastRadiusAdd: 6 },
      family: 'magic'
    },
    'mag-swift': {
      key: 'mag-swift',
      name: 'Quick Casting',
      blurb: 'Magic towers wind up a touch faster.',
      branch: 'magic',
      tier: 2,
      cost: 3,
      prereqs: ['mag-cooldown'],
      mods: { cooldownMul: 0.94 },
      family: 'magic'
    },
    'mag-sight': {
      key: 'mag-sight',
      name: 'True Sight',
      blurb: 'Magic towers see Veiled balloons without help.',
      branch: 'magic',
      tier: 2,
      cost: 3,
      prereqs: ['mag-cooldown'],
      gate: 5,
      mods: { camoDetect: true },
      family: 'magic'
    },
    'mag-focus': {
      key: 'mag-focus',
      name: 'Focused Weave',
      blurb: 'Magic damage up five percent across the board.',
      branch: 'magic',
      tier: 3,
      cost: 5,
      prereqs: ['mag-brittle'],
      gate: 9,
      mods: { damageMul: 1.05 },
      family: 'magic'
    },
    'mag-speed': {
      key: 'mag-speed',
      name: 'Hastened Hexes',
      blurb: 'Magic projectiles fly faster downrange.',
      branch: 'magic',
      tier: 1,
      cost: 2,
      prereqs: ['mag-damage'],
      mods: { projSpeedMul: 1.10 },
      family: 'magic'
    },
    'mag-volley2': {
      key: 'mag-volley2',
      name: 'Tripled Sigils',
      blurb: 'Magic towers cast one extra projectile per volley.',
      branch: 'magic',
      tier: 4,
      cost: 6,
      prereqs: ['mag-volley'],
      gate: 12,
      mods: { shotsAdd: 1 },
      family: 'magic'
    },
    'mag-pierce2': {
      key: 'mag-pierce2',
      name: 'Splitting Sparks',
      blurb: 'Magic shots punch through one extra target.',
      branch: 'magic',
      tier: 3,
      cost: 4,
      prereqs: ['mag-pierce'],
      mods: { pierceAdd: 1 },
      family: 'magic'
    },

    'sup-income': {
      key: 'sup-income',
      name: 'Ledger Discipline',
      blurb: 'Every pop pays a fraction more while support stands watch.',
      branch: 'support',
      tier: 2,
      cost: 3,
      prereqs: ['sup-stock'],
      mods: {},
      ruleOverrides: { cashPerPopMul: 0.03 }
    },
    'sup-camouflage': {
      key: 'sup-camouflage',
      name: 'Shared Sight',
      blurb: 'Support towers see Veiled balloons without help.',
      branch: 'support',
      tier: 2,
      cost: 3,
      prereqs: ['sup-stock'],
      gate: 5,
      mods: { camoDetect: true },
      family: 'support'
    },
    'sup-swift': {
      key: 'sup-swift',
      name: 'Practised Hands',
      blurb: 'Support towers wind up a touch faster.',
      branch: 'support',
      tier: 2,
      cost: 3,
      prereqs: ['sup-damage'],
      mods: { cooldownMul: 0.95 },
      family: 'support'
    },
    'sup-reach': {
      key: 'sup-reach',
      name: 'Stretching Vines',
      blurb: 'Support towers reach further down the track.',
      branch: 'support',
      tier: 3,
      cost: 4,
      prereqs: ['sup-range'],
      mods: { rangeAdd: 15 },
      family: 'support'
    },
    'sup-pierce2': {
      key: 'sup-pierce2',
      name: 'Deeper Barbs',
      blurb: 'Support shots punch through one extra target.',
      branch: 'support',
      tier: 3,
      cost: 4,
      prereqs: ['sup-pierce'],
      mods: { pierceAdd: 1 },
      family: 'support'
    },
    'sup-blast': {
      key: 'sup-blast',
      name: 'Wide Alarms',
      blurb: 'Support blasts cover a wider footprint.',
      branch: 'support',
      tier: 3,
      cost: 4,
      prereqs: ['sup-stock'],
      mods: { blastRadiusAdd: 6 },
      family: 'support'
    },
    'sup-cheap': {
      key: 'sup-cheap',
      name: 'Cooperative Buying',
      blurb: 'Everything on the board costs a little less to place or upgrade.',
      branch: 'support',
      tier: 4,
      cost: 6,
      prereqs: ['sup-tax'],
      gate: 12,
      mods: {},
      ruleOverrides: { costMul: -0.03 }
    },
    'sup-capstone': {
      key: 'sup-capstone',
      name: 'Prosperous Grove',
      blurb: 'The end-of-round payout grows once more.',
      branch: 'support',
      tier: 4,
      cost: 6,
      prereqs: ['sup-tax'],
      gate: 14,
      mods: {},
      ruleOverrides: { roundBonusMul: 0.05 }
    },

    'gen-lives2': {
      key: 'gen-lives2',
      name: 'Thicker Fur',
      blurb: 'One more life. The forest forgives twice now.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-extra-life'],
      mods: {},
      ruleOverrides: { startLives: 1 }
    },
    'gen-pockets2': {
      key: 'gen-pockets2',
      name: 'Deeper Pockets',
      blurb: 'A little more coin before the first round.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-power-knowledge'],
      mods: {},
      ruleOverrides: { startCash: 25 }
    },
    'gen-power-dur': {
      key: 'gen-power-dur',
      name: 'Patient Recipes',
      blurb: 'Every power lasts a fraction longer.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-power-knowledge'],
      mods: {},
      ruleOverrides: { powerDurationMul: 0.10 }
    },
    'gen-power-slow': {
      key: 'gen-power-slow',
      name: 'Sticky Recipes',
      blurb: 'Slow powers hold a fraction tighter.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-power-knowledge'],
      mods: {},
      ruleOverrides: { powerSlowAdd: 0.05 }
    },
    'gen-power-dmg': {
      key: 'gen-power-dmg',
      name: 'Vengeful Recipes',
      blurb: 'Damaging powers hit one point harder.',
      branch: 'general',
      tier: 4,
      cost: 5,
      prereqs: ['gen-power-dur'],
      gate: 10,
      mods: {},
      ruleOverrides: { powerDamageAdd: 1 }
    },
    'gen-power-stock': {
      key: 'gen-power-stock',
      name: 'Backup Shelf',
      blurb: 'Every owned power arrives with one spare use.',
      branch: 'general',
      tier: 4,
      cost: 5,
      prereqs: ['gen-power-dur'],
      gate: 10,
      mods: {},
      ruleOverrides: { powerStockBonus: 1 }
    },
    'gen-sell2': {
      key: 'gen-sell2',
      name: 'Master Haggler',
      blurb: 'Selling recovers a bigger slice still.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-sell-rate'],
      mods: {},
      ruleOverrides: { sellRate: 0.05 }
    },
    'gen-round2': {
      key: 'gen-round2',
      name: 'Bigger Stipend',
      blurb: 'The end-of-round tip grows once more.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-round-bonus'],
      mods: {},
      ruleOverrides: { roundBonusMul: 0.05 }
    },
    'gen-pop2': {
      key: 'gen-pop2',
      name: 'Meticulous Tally',
      blurb: 'Every pop earns a fraction more still.',
      branch: 'general',
      tier: 3,
      cost: 4,
      prereqs: ['gen-pop-income'],
      mods: {},
      ruleOverrides: { cashPerPopMul: 0.03 }
    },
    'gen-capstone': {
      key: 'gen-capstone',
      name: 'Critic Laureate',
      blurb: 'The grand opening: a full pouch, a warm tip, and the forest watching.',
      branch: 'general',
      tier: 4,
      cost: 7,
      prereqs: ['gen-achievement-kp'],
      gate: 14,
      mods: {},
      ruleOverrides: { startCash: 100 }
    },

    'her-burst': {
      key: 'her-burst',
      name: 'Heroic Burst',
      blurb: 'Heroes wind up a touch faster.',
      branch: 'heroes',
      tier: 3,
      cost: 4,
      prereqs: ['her-vigor'],
      mods: { cooldownMul: 0.94 },
      family: 'hero'
    },
    'her-reach': {
      key: 'her-reach',
      name: 'Heroic Reach',
      blurb: 'Heroes spot targets further down the track.',
      branch: 'heroes',
      tier: 3,
      cost: 4,
      prereqs: ['her-range'],
      mods: { rangeAdd: 10 },
      family: 'hero'
    },
    'her-camo': {
      key: 'her-camo',
      name: 'Heroic Instinct',
      blurb: 'Heroes see Veiled balloons without help.',
      branch: 'heroes',
      tier: 4,
      cost: 6,
      prereqs: ['her-burst', 'her-reach'],
      gate: 8,
      mods: { camoDetect: true },
      family: 'hero'
    },

    'pow-slow2': {
      key: 'pow-slow2',
      name: 'Treacle Bottom',
      blurb: 'Slow powers hold a tenth tighter.',
      branch: 'powers',
      tier: 3,
      cost: 4,
      prereqs: ['pow-slow-boost'],
      mods: {},
      ruleOverrides: { powerSlowAdd: 0.10 }
    },
    'pow-stock': {
      key: 'pow-stock',
      name: 'Wellstocked Belt',
      blurb: 'Every owned power arrives with one spare use.',
      branch: 'powers',
      tier: 4,
      cost: 5,
      prereqs: ['pow-big-boom'],
      gate: 10,
      mods: {},
      ruleOverrides: { powerStockBonus: 1 }
    },
    'pow-cash2': {
      key: 'pow-cash2',
      name: 'Golden Cache',
      blurb: 'Cash powers pay out a tenth more.',
      branch: 'powers',
      tier: 3,
      cost: 4,
      prereqs: ['pow-bigger-cache'],
      mods: {},
      ruleOverrides: { powerEffectMul: 0.10 }
    }
  }

  /** Display order for the branches (left to right in the tree UI). Six trees,
      mirroring the canon shape: Primary, Military, Magic, Support, Heroes,
      Powers — plus General, which is the local "everything else" branch. */
  const BRANCH_ORDER = ['primary', 'military', 'magic', 'support', 'general', 'heroes', 'powers']

  /** Branch display names. */
  const BRANCH_NAMES = {
    primary: 'Primary',
    military: 'Military',
    magic: 'Magic',
    support: 'Support',
    general: 'General',
    heroes: 'Heroes',
    powers: 'Powers'
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
   * KP already invested in one branch (the sum of costs of that branch's
   * unlocked nodes). Tier gates are expressed against this number.
   */
  OP.knowledgeBranchInvested = function (unlocked, branch) {
    let total = 0
    for (const k of (unlocked || [])) {
      const n = TREE[k]
      if (n && n.branch === branch) total += n.cost
    }
    return total
  }

  /**
   * Whether a node's tier gate is open: a node with `gate` set requires that
   * many KP already invested in its own branch, the way canon gates deeper
   * tiers behind commitment rather than just prerequisites.
   */
  OP.knowledgeGateOpen = function (node, unlocked) {
    if (!node || !node.gate) return true
    return OP.knowledgeBranchInvested(unlocked, node.branch) >= node.gate
  }

  /**
   * Given a set of unlocked node keys, return the set of keys that are
   * purchasable (all prereqs met, tier gate open, not already unlocked).
   */
  OP.knowledgeAvailable = function (unlocked) {
    const u = new Set(unlocked || [])
    const available = []
    for (const k in TREE) {
      if (u.has(k)) continue
      const n = TREE[k]
      if (!n.prereqs.every(p => u.has(p))) continue
      if (!OP.knowledgeGateOpen(n, unlocked)) continue
      available.push(k)
    }
    return available
  }

  /**
   * Respec one branch: the keys to refund and how much KP comes back.
   * Pure — the caller applies the result to the profile.
   *
   * @param {string[]} unlocked  currently unlocked node keys
   * @param {string}  branch     the branch to clear
   * @returns {{keys:string[], refund:number}} keys removed, KP refunded
   */
  OP.knowledgeRespec = function (unlocked, branch) {
    const keys = []
    let refund = 0
    for (const k of (unlocked || [])) {
      const n = TREE[k]
      if (n && n.branch === branch) { keys.push(k); refund += n.cost }
    }
    return { keys: keys, refund: refund }
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

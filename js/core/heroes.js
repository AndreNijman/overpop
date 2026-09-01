;(function (OP) {
  'use strict'

  /* Heroes.

     A hero is a tower with an XP curve instead of an upgrade tree. One per game,
     placed once, levelling to 20 off pops and round survival. Levels are not
     bought — which is why a hero's power curve is the one thing in the game the
     player cannot rush with cash.

     `defineHero` validates as hard as `defineTower` for the same reason: the
     roster is a fan-out phase, and a hero missing a level-20 unlock or carrying a
     closure in its state must fail at load with a message naming it. */

  const Heroes = {}

  Heroes.MAX_LEVEL = 20

  /* ---------- XP curve ----------
     Thresholds are cumulative XP to REACH a level. Superlinear, so the last few
     levels genuinely arrive late in a run rather than midway. */

  // Coefficient tuned so level 2 arrives inside the first couple of rounds (a
  // hero that sits at level 1 for ten rounds reads as broken), while level 20
  // still needs most of a hundred-round run.
  const CURVE = [0]
  for (let lvl = 2; lvl <= 20; lvl++) {
    CURVE[lvl - 1] = Math.round(90 * Math.pow(lvl - 1, 1.85))
  }
  Heroes.CURVE = CURVE

  /** Cumulative XP needed to reach `level`. */
  Heroes.xpForLevel = function (level) {
    if (level <= 1) return 0
    return CURVE[Math.min(level, Heroes.MAX_LEVEL) - 1]
  }

  /** Level implied by an XP total. */
  Heroes.levelForXP = function (xp) {
    let lvl = 1
    while (lvl < Heroes.MAX_LEVEL && xp >= CURVE[lvl]) lvl++
    return lvl
  }

  /* XP is earned two ways: per layer popped anywhere on the board, and a lump at
     the end of each round. The round lump is what stops a hero placed on a
     late-game map from being stuck at level 1 while the board is already hard. */
  Heroes.XP_PER_LAYER = 1
  Heroes.XP_PER_ROUND = 60

  /**
   * Difficulty scales how fast a hero levels — a longer game on Relentless would
   * otherwise reach level 20 far earlier in relative terms than a short Easy game.
   */
  Heroes.xpRate = function (sim) {
    return sim.rules.heroXpMul === undefined ? 1 : sim.rules.heroXpMul
  }

  /* ---------- registry ---------- */

  Heroes.define = function (def) {
    validate(def)

    def.footprint = def.footprint === undefined ? 14 : def.footprint
    def.placement = def.placement || 'land'
    def.base.shots = def.base.shots === undefined ? 1 : def.base.shots
    def.base.spread = def.base.spread || 0
    def.base.projLife = def.base.projLife === undefined ? 1.5 : def.base.projLife
    def.base.projRadius = def.base.projRadius === undefined ? 4 : def.base.projRadius
    def.base.camoDetect = !!def.base.camoDetect
    def.base.targetModes = def.base.targetModes || OP.TARGET_MODES.slice()

    // Index the level table by level for O(1) lookup during resolution.
    def.levelsByNumber = {}
    for (let i = 0; i < def.levels.length; i++) def.levelsByNumber[def.levels[i].level] = def.levels[i]

    OP.HEROES[def.key] = def
    OP.HERO_ORDER.push(def.key)
    return def
  }

  function bad (def, msg) {
    throw new Error('hero "' + ((def && def.key) || '?') + '": ' + msg)
  }

  const REQUIRED_BASE = ['range', 'cooldown', 'damage', 'pierce', 'dmgType', 'projSpeed']

  function validate (def) {
    if (!def || typeof def !== 'object') bad(def, 'definition must be an object')
    if (!def.key || typeof def.key !== 'string') bad(def, 'needs a string key')
    if (OP.HEROES[def.key]) bad(def, 'key is already registered')
    if (OP.TOWERS[def.key]) bad(def, 'key collides with a tower')
    if (!def.name) bad(def, 'needs a display name')
    if (!def.title) bad(def, 'needs a short title for the hero select screen')
    if (!def.blurb || def.blurb.length < 20) bad(def, 'needs a blurb describing its identity')
    if (!(def.cost > 0)) bad(def, 'needs a positive cost')
    if (typeof def.fire !== 'function' && typeof def.update !== 'function') {
      bad(def, 'needs fire() or update()')
    }
    if (!def.base || typeof def.base !== 'object') bad(def, 'needs a base stat block')
    for (let i = 0; i < REQUIRED_BASE.length; i++) {
      if (def.base[REQUIRED_BASE[i]] === undefined) bad(def, 'base.' + REQUIRED_BASE[i] + ' is required')
    }
    if (!(def.base.range > 0)) bad(def, 'base.range must be positive')
    if (!(def.base.cooldown > 0)) bad(def, 'base.cooldown must be positive')
    if (OP.DMG_ORDER.indexOf(def.base.dmgType) < 0) bad(def, 'unknown base.dmgType: ' + def.base.dmgType)

    if (!Array.isArray(def.levels)) bad(def, 'needs a levels array')

    let prev = 1
    const seen = {}
    for (let i = 0; i < def.levels.length; i++) {
      const lv = def.levels[i]
      const where = 'level entry ' + i
      if (!lv || typeof lv !== 'object') bad(def, where + ' is not an object')
      if (!(lv.level >= 2 && lv.level <= Heroes.MAX_LEVEL)) {
        bad(def, where + ': level must be 2..' + Heroes.MAX_LEVEL + ', got ' + lv.level)
      }
      if (seen[lv.level]) bad(def, 'level ' + lv.level + ' is defined twice')
      seen[lv.level] = true
      if (lv.level < prev) bad(def, 'levels must be listed in ascending order')
      prev = lv.level
      if (!lv.desc) bad(def, 'level ' + lv.level + ' needs a desc for the hero panel')
      if (typeof lv.apply !== 'function') bad(def, 'level ' + lv.level + ' needs apply(s, hero, sim)')
    }

    // Every level from 2 to 20 must do something, or the curve has dead steps
    // that read as a bug to the player.
    const missing = []
    for (let lvl = 2; lvl <= Heroes.MAX_LEVEL; lvl++) if (!seen[lvl]) missing.push(lvl)
    if (missing.length) bad(def, 'no effect defined for level(s) ' + missing.join(', ') +
      ' — every level from 2 to ' + Heroes.MAX_LEVEL + ' must grant something')
  }

  Heroes.get = function (key) {
    const def = OP.HEROES[key]
    if (!def) throw new Error('unknown hero: ' + key)
    return def
  }

  Heroes.all = function () { return OP.HERO_ORDER.map(function (k) { return OP.HEROES[k] }) }

  /* ---------- placement ---------- */

  Heroes.canPlace = function (sim, key, x, y) {
    const def = OP.HEROES[key]
    if (!def) return { ok: false, reason: 'Unknown hero.' }
    if (OP.Coop && !OP.Coop.canPlace(sim)) return { ok: false, reason: 'Wait for the player swap.' }
    if (sim.heroId >= 0) return { ok: false, reason: 'You already have a hero on this map.' }
    const cost = OP.Economy.price(sim, def.cost)
    if (!OP.Economy.canAfford(sim, cost)) return { ok: false, reason: 'Not enough cash.' }
    return OP.Towers.canPlaceShape(sim, def, x, y)
  }

  /**
   * Place the hero. Internally it IS a tower — same entity shape, same firing
   * pass, same serialisation — with `heroKey` set and levels standing in for the
   * upgrade tree. Reusing the tower entity is what keeps heroes out of every
   * other subsystem.
   */
  Heroes.place = function (sim, key, x, y, opts) {
    opts = opts || {}
    if (!OP.HEROES[key]) return null

    // `free` waives the COST, not the invariants. One hero per map is a rule of the
    // game, not a price — letting free placement bypass it meant an insta-placement
    // or a test could put eight heroes on one board.
    if (sim.heroId >= 0) return null

    if (!opts.free) {
      const check = Heroes.canPlace(sim, key, x, y)
      if (!check.ok) return null
    }
    const def = Heroes.get(key)
    const cost = opts.free ? 0 : OP.Economy.price(sim, def.cost)
    if (!opts.free) OP.Economy.spend(sim, cost)

    const hero = {
      id: sim.nextEntityId++,
      key: key,
      heroKey: key,
      def: def,
      x: x, y: y,
      tiers: [0, 0, 0],          // unused for heroes, kept so shared code is uniform
      level: 1,
      xp: 0,
      targetMode: def.base.targetModes[0],
      targetId: -1,
      cooldown: 0,
      angle: 0,
      invested: cost,
      pops: 0,
      earned: 0,
      abilityCd: 0,
      abilityT: 0,
      ability2Cd: 0,
      paragonDegree: 0,
      placedRound: sim.roundIndex,
      s: null,
      sBase: null,
      data: {}
    }

    sim.towers.push(hero)
    sim.towerById.set(hero.id, hero)
    sim.heroId = hero.id
    OP.Towers.restat(sim, hero)
    if (def.buffs) OP.Towers.restatAll(sim)
    if (def.onPlace) def.onPlace(sim, hero)

    sim.events.push({ kind: 'hero', towerId: hero.id, key: key, level: 1 })
    return hero
  }

  /** Apply level effects to a stat object. Called from Towers.restat. */
  Heroes.applyLevels = function (s, hero, sim) {
    const def = hero.def
    for (let lvl = 2; lvl <= hero.level; lvl++) {
      const entry = def.levelsByNumber[lvl]
      if (entry && entry.apply) entry.apply(s, hero, sim)
    }
    return s
  }

  /* ---------- levelling ---------- */

  Heroes.grantXP = function (sim, amount) {
    if (sim.heroId < 0 || !(amount > 0)) return 0
    const hero = sim.towerById.get(sim.heroId)
    if (!hero || hero.level >= Heroes.MAX_LEVEL) return 0

    hero.xp += amount * Heroes.xpRate(sim)
    const want = Heroes.levelForXP(hero.xp)
    if (want <= hero.level) return 0

    const gained = want - hero.level
    hero.level = want
    OP.Towers.restat(sim, hero)
    if (hero.def.buffs) OP.Towers.restatAll(sim)
    sim.events.push({ kind: 'herolevel', towerId: hero.id, level: hero.level })
    if (hero.def.onLevel) hero.def.onLevel(sim, hero)
    return gained
  }

  /**
   * Step 11 of the update order. XP from layers popped this tick, plus the
   * round-end lump when a round completes.
   *
   * Reads the pop counter rather than hooking the damage resolver, so heroes stay
   * a leaf subsystem that nothing else has to know about.
   */
  Heroes.step = function (sim) {
    if (sim.heroId < 0) return
    const hero = sim.towerById.get(sim.heroId)
    if (!hero) { sim.heroId = -1; return }

    const layers = sim.stats.layersPopped
    const last = hero.data._xpMark === undefined ? layers : hero.data._xpMark
    if (layers > last) Heroes.grantXP(sim, (layers - last) * Heroes.XP_PER_LAYER)
    hero.data._xpMark = layers

    const cleared = sim.stats.roundsCleared
    const lastRound = hero.data._roundMark === undefined ? cleared : hero.data._roundMark
    if (cleared > lastRound) Heroes.grantXP(sim, (cleared - lastRound) * Heroes.XP_PER_ROUND)
    hero.data._roundMark = cleared

    if (hero.ability2Cd > 0) hero.ability2Cd = Math.max(0, hero.ability2Cd - OP.DT)
  }

  Heroes.isHero = function (tower) { return !!tower.heroKey }

  Heroes.of = function (sim) {
    return sim.heroId >= 0 ? sim.towerById.get(sim.heroId) : null
  }

  /** Progress toward the next level, 0..1. 1 at max level. */
  Heroes.progress = function (hero) {
    if (hero.level >= Heroes.MAX_LEVEL) return 1
    const from = Heroes.xpForLevel(hero.level)
    const to = Heroes.xpForLevel(hero.level + 1)
    return OP.M.clamp01((hero.xp - from) / (to - from))
  }

  /** Second ability, unlocked at a level the hero declares. */
  Heroes.canActivateSecond = function (sim, hero) {
    if (!hero.s.ability2) return { ok: false, reason: 'No second ability.' }
    if (!sim.rules.allowAbilities) return { ok: false, reason: 'Abilities are disabled in this mode.' }
    if (hero.ability2Cd > 0) return { ok: false, reason: 'On cooldown (' + hero.ability2Cd.toFixed(1) + 's).' }
    return { ok: true, reason: '' }
  }

  Heroes.activateSecond = function (sim, hero) {
    const check = Heroes.canActivateSecond(sim, hero)
    if (!check.ok) return check
    const fn = OP.ABILITIES[hero.s.ability2.key]
    if (!fn) return { ok: false, reason: 'Ability "' + hero.s.ability2.key + '" is not registered.' }
    fn(sim, hero)
    hero.ability2Cd = hero.s.ability2.cooldown
    sim.events.push({ kind: 'ability', towerId: hero.id, ability: hero.s.ability2.key })
    return { ok: true, reason: '' }
  }

  OP.Heroes = Heroes
  OP.defineHero = Heroes.define
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

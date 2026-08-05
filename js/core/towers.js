;(function (OP) {
  'use strict'

  const M = OP.M

  /* Towers: the definition registry, placement, and the per-tick firing pass.
     This is the contract the content phases write against (ARCHITECTURE.md §6).

     `defineTower` validates hard and throws on anything malformed. That is
     deliberate. Twenty-five towers get authored across four separate files, and a
     tower with four branches, or six tiers, or a missing `fire`, must fail at
     load with a message naming the file — not silently produce a tower that
     cannot be upgraded past tier 4 and gets noticed in a playtest three phases
     later. */

  const Towers = {}

  /* ---------- definition registry ---------- */

  const REQUIRED_BASE = ['range', 'cooldown', 'damage', 'pierce', 'dmgType', 'projSpeed']

  Towers.define = function (def) {
    validate(def)

    def.paths.forEach(function (path, pi) {
      path.index = pi
      path.tiers.forEach(function (up, ti) { up.tier = ti + 1; up.path = pi })
    })

    // Fill in the optional fields once, so nothing downstream has to guard.
    def.footprint = def.footprint === undefined ? 14 : def.footprint
    def.placement = def.placement || 'land'
    def.unlockRound = def.unlockRound || 0
    def.income = !!def.income
    def.base.shots = def.base.shots === undefined ? 1 : def.base.shots
    def.base.spread = def.base.spread || 0
    def.base.projLife = def.base.projLife === undefined ? 1.5 : def.base.projLife
    def.base.projRadius = def.base.projRadius === undefined ? 4 : def.base.projRadius
    def.base.camoDetect = !!def.base.camoDetect
    def.base.targetModes = def.base.targetModes || OP.TARGET_MODES.slice()

    OP.TOWERS[def.key] = def
    OP.TOWER_ORDER.push(def.key)
    return def
  }

  function bad (def, msg) {
    throw new Error('tower "' + ((def && def.key) || '?') + '": ' + msg)
  }

  function validate (def) {
    if (!def || typeof def !== 'object') bad(def, 'definition must be an object')
    if (!def.key || typeof def.key !== 'string') bad(def, 'needs a string key')
    if (OP.TOWERS[def.key]) bad(def, 'key is already registered')
    if (!def.name) bad(def, 'needs a display name')
    if (OP.FAMILIES.indexOf(def.family) < 0) {
      bad(def, 'family must be one of ' + OP.FAMILIES.join(', ') + ', got ' + def.family)
    }
    if (!(def.cost > 0)) bad(def, 'needs a positive cost')
    if (typeof def.fire !== 'function' && typeof def.update !== 'function') {
      bad(def, 'needs fire() or update() — a tower that does nothing is a bug, not a design')
    }
    if (!def.base || typeof def.base !== 'object') bad(def, 'needs a base stat block')
    for (let i = 0; i < REQUIRED_BASE.length; i++) {
      if (def.base[REQUIRED_BASE[i]] === undefined) bad(def, 'base.' + REQUIRED_BASE[i] + ' is required')
    }
    if (!(def.base.range > 0)) bad(def, 'base.range must be positive')
    if (!(def.base.cooldown > 0)) bad(def, 'base.cooldown must be positive')
    if (OP.DMG_ORDER.indexOf(def.base.dmgType) < 0) bad(def, 'base.dmgType is not a known damage type: ' + def.base.dmgType)

    if (!Array.isArray(def.paths) || def.paths.length !== OP.Upgrades.PATHS) {
      bad(def, 'needs exactly ' + OP.Upgrades.PATHS + ' upgrade branches, got ' + (def.paths ? def.paths.length : 0))
    }
    def.paths.forEach(function (path, pi) {
      if (!path.name) bad(def, 'branch ' + pi + ' needs a name')
      if (!Array.isArray(path.tiers) || path.tiers.length !== OP.Upgrades.MAX_TIER) {
        bad(def, 'branch "' + path.name + '" needs exactly ' + OP.Upgrades.MAX_TIER +
          ' tiers, got ' + (path.tiers ? path.tiers.length : 0))
      }
      let prev = 0
      path.tiers.forEach(function (up, ti) {
        const where = 'branch "' + path.name + '" tier ' + (ti + 1)
        if (!up || typeof up !== 'object') bad(def, where + ' is not an object')
        if (!up.name) bad(def, where + ' needs a name')
        if (!(up.cost > 0)) bad(def, where + ' needs a positive cost')
        if (up.cost < prev) bad(def, where + ' costs less than the tier below it (' + up.cost + ' < ' + prev + ')')
        prev = up.cost
        if (!up.desc) bad(def, where + ' needs a desc for the upgrade panel')
        if (typeof up.apply !== 'function') bad(def, where + ' needs apply(s, tower, sim)')
      })
    })
  }

  Towers.get = function (key) {
    const def = OP.TOWERS[key]
    if (!def) throw new Error('unknown tower: ' + key)
    return def
  }

  Towers.all = function () { return OP.TOWER_ORDER.map(function (k) { return OP.TOWERS[k] }) }

  Towers.byFamily = function (family) {
    return Towers.all().filter(function (d) { return d.family === family })
  }

  /* ---------- stat resolution ---------- */

  /**
   * Rebuild `tower.s` from scratch. Called on place, on upgrade, and whenever the
   * buff set changes — never per tick.
   */
  function shallowClone (src) {
    const out = {}
    for (const key in src) {
      const v = src[key]
      out[key] = Array.isArray(v) ? v.slice() : v
    }
    return out
  }

  Towers.restat = function (sim, tower) {
    const def = tower.def
    const s = shallowClone(def.base)

    // A hero levels instead of buying upgrades; everything else walks its tree.
    if (tower.heroKey) OP.Heroes.applyLevels(s, tower, sim)
    else OP.Upgrades.applyTo(s, tower, sim)

    // Snapshot the stats BEFORE buffs. Aura geometry must be derived from this,
    // never from `tower.s` — otherwise two mutually-overlapping support towers
    // register different aura radii depending on which was placed first, because
    // the second one computes its radius with the first one's range buff already
    // applied. `def.buffs` is documented to read `tower.sBase`.
    tower.sBase = shallowClone(s)

    OP.Buffs.apply(sim, tower, s)

    if (tower.paragonDegree > 0 && OP.Paragon && OP.Paragon.applyStats) {
      OP.Paragon.applyStats(s, tower, sim)
    }

    // Guard rails the content phases cannot accidentally breach. The game keeps
    // running on a clamped value, but the clamp is RECORDED — a silently repaired
    // NaN is an authoring bug that would otherwise never surface, so the family
    // floor asserts this list is empty.
    const warn = []
    if (!(s.cooldown > 0)) { warn.push('cooldown was ' + s.cooldown); s.cooldown = 1 / 240 }
    if (!(s.damage >= 0)) { warn.push('damage was ' + s.damage); s.damage = 0 }
    if (!(s.pierce >= 1)) { warn.push('pierce was ' + s.pierce); s.pierce = 1 }
    if (!(s.shots >= 1)) { warn.push('shots was ' + s.shots); s.shots = 1 }
    if (!(s.range > 0)) { warn.push('range was ' + s.range); s.range = 1 }
    if (!isFinite(s.projSpeed)) { warn.push('projSpeed was ' + s.projSpeed); s.projSpeed = 1 }
    tower.statWarnings = warn.length ? warn : null

    tower.s = s
    return s
  }

  /**
   * Call a tower's `buffs` hook with its UNBUFFED stats visible as `tower.s`.
   *
   * Aura geometry must not depend on other towers' buffs, or two overlapping
   * support towers register different radii depending on placement order. Rather
   * than trusting every content author to remember to read `sBase`, the swap is
   * done here so reading `tower.s` inside `buffs()` is simply correct.
   */
  Towers.registerAuras = function (sim, tower) {
    if (!tower.def.buffs) return
    const resolved = tower.s
    tower.s = tower.sBase
    try {
      OP.Buffs.unregisterBySource(sim, tower.id)
      tower.def.buffs(sim, tower)
    } finally {
      tower.s = resolved
    }
  }

  /**
   * Restat every tower. Two passes, deliberately:
   *   1. resolve sBase for everyone, so aura geometry is known and buff-free
   *   2. re-register every aura from sBase, then resolve final stats
   * One pass would make a tower's aura depend on whether its neighbour had been
   * restatted yet, which is the order dependence this whole module exists to
   * avoid.
   */
  Towers.restatAll = function (sim) {
    const list = sim.towers
    for (let i = 0; i < list.length; i++) Towers.restat(sim, list[i])

    let anyAuras = false
    for (let i = 0; i < list.length; i++) if (list[i].def.buffs) { anyAuras = true; break }
    if (anyAuras) {
      for (let i = 0; i < list.length; i++) Towers.registerAuras(sim, list[i])
      for (let i = 0; i < list.length; i++) Towers.restat(sim, list[i])
    }
    sim.buffsDirty = false
  }

  /* ---------- placement ---------- */

  /**
   * Can this tower go here? Returns {ok, reason} so the UI explains refusals.
   * Checks, in order: mode restrictions, cash, the map's placement mask, overlap
   * with existing towers.
   */
  Towers.canPlace = function (sim, key, x, y) {
    const def = OP.TOWERS[key]
    if (!def) return { ok: false, reason: 'Unknown tower.' }

    if (!OP.Economy.towerAllowed(sim, def)) {
      return { ok: false, reason: def.income && !sim.rules.allowIncome
        ? 'Income towers are disabled in this mode.'
        : OP.FAMILY_LABELS[def.family] + ' towers are disabled in this mode.' }
    }

    const cost = OP.Economy.price(sim, def.cost)
    if (!OP.Economy.canAfford(sim, cost)) return { ok: false, reason: 'Not enough cash.' }

    return Towers.canPlaceShape(sim, def, x, y)
  }

  /**
   * The purely geometric half of placement: bounds, the map's placement mask, and
   * overlap. Shared with heroes, which have their own cost and one-per-map rules
   * but the same footprint behaviour.
   */
  Towers.canPlaceShape = function (sim, def, x, y) {
    if (x - def.footprint < 0 || x + def.footprint > OP.FIELD_W ||
        y - def.footprint < 0 || y + def.footprint > OP.FIELD_H) {
      return { ok: false, reason: 'Off the map.' }
    }

    if (OP.Maps && OP.Maps.canPlace) {
      const mapCheck = OP.Maps.canPlace(sim.map, def, x, y)
      if (!mapCheck.ok) return mapCheck
    }

    for (let i = 0; i < sim.towers.length; i++) {
      const other = sim.towers[i]
      const min = def.footprint + other.def.footprint
      if (M.dist2(x, y, other.x, other.y) < min * min) {
        return { ok: false, reason: 'Too close to ' + other.def.name + '.' }
      }
    }

    if (sim.towers.length >= OP.MAX_TOWERS) return { ok: false, reason: 'Too many towers.' }

    return { ok: true, reason: '' }
  }

  /** Place a tower, charging for it. Returns the tower, or null with the reason
      available from canPlace. */
  Towers.place = function (sim, key, x, y, opts) {
    opts = opts || {}
    if (!opts.free) {
      const check = Towers.canPlace(sim, key, x, y)
      if (!check.ok) return null
    }
    const def = Towers.get(key)
    const cost = opts.free ? 0 : OP.Economy.price(sim, def.cost)
    if (!opts.free) OP.Economy.spend(sim, cost)

    const tower = {
      id: sim.nextEntityId++,
      key: key,
      def: def,
      x: x, y: y,
      tiers: [0, 0, 0],
      targetMode: def.base.targetModes[0],
      targetId: -1,
      cooldown: 0,
      angle: 0,
      invested: cost,
      pops: 0,
      earned: 0,
      abilityCd: 0,
      abilityT: 0,
      paragonDegree: 0,
      placedRound: sim.roundIndex,
      s: null,
      data: {}
    }

    sim.towers.push(tower)
    sim.towerById.set(tower.id, tower)
    Towers.restat(sim, tower)

    if (def.buffs) Towers.restatAll(sim)     // registers this tower's aura too
    if (def.onPlace) def.onPlace(sim, tower)

    sim.events.push({ kind: 'place', towerId: tower.id, key: key, x: x, y: y, cost: cost })
    return tower
  }

  Towers.sell = function (sim, tower) {
    if (!sim.rules.allowSell) return 0
    const value = OP.Economy.sellValue(sim, tower)
    if (tower.def.onSell) tower.def.onSell(sim, tower)
    OP.Buffs.unregisterBySource(sim, tower.id)

    const i = sim.towers.indexOf(tower)
    if (i >= 0) sim.towers.splice(i, 1)
    sim.towerById.delete(tower.id)

    OP.Economy.earn(sim, value, -1)
    Towers.restatAll(sim)
    sim.events.push({ kind: 'sell', towerId: tower.id, value: value })
    return value
  }

  Towers.setTargetMode = function (sim, tower, mode) {
    if (tower.s.targetModes.indexOf(mode) < 0) return false
    tower.targetMode = mode
    tower.targetId = -1
    return true
  }

  Towers.cycleTargetMode = function (sim, tower, dir) {
    const modes = tower.s.targetModes
    const at = modes.indexOf(tower.targetMode)
    const next = (at + (dir || 1) + modes.length) % modes.length
    tower.targetMode = modes[next]
    tower.targetId = -1
    return tower.targetMode
  }

  /* ---------- the firing pass ---------- */

  // A tower firing faster than one shot per tick catches up across ticks, but
  // never more than this many in a single tick — otherwise a cooldown driven to
  // near-zero by buffs would stall the whole frame.
  const MAX_SHOTS_PER_TICK = 8

  /**
   * Step 8 of the update order: cooldowns, targeting, firing.
   */
  Towers.step = function (sim) {
    if (sim.buffsDirty) Towers.restatAll(sim)

    const dt = OP.DT
    const list = sim.towers
    for (let i = 0; i < list.length; i++) {
      const tower = list[i]
      const def = tower.def

      if (tower.abilityCd > 0) tower.abilityCd = Math.max(0, tower.abilityCd - dt)
      if (tower.abilityT > 0) {
        tower.abilityT = Math.max(0, tower.abilityT - dt)
        if (tower.abilityT === 0 && def.onAbilityEnd) def.onAbilityEnd(sim, tower)
      }

      if (def.update) def.update(sim, tower, dt)

      // A paragon may replace the base tower's attack entirely.
      const fire = tower.paragonDegree > 0
        ? (OP.Paragon.fireFor(tower) || def.fire)
        : def.fire
      if (!fire) continue

      tower.cooldown -= dt

      // Nothing to shoot at: hold the shot ready rather than banking cooldown.
      const targetId = OP.Targeting.retainOrAcquire(sim, tower, tower.targetMode)
      if (targetId < 0) {
        if (tower.cooldown < 0) tower.cooldown = 0
        continue
      }

      const target = sim.byId.get(targetId)
      if (target) tower.angle = M.angleTo(tower.x, tower.y, target.x, target.y)

      let fired = 0
      while (tower.cooldown <= 0 && fired < MAX_SHOTS_PER_TICK) {
        fire(sim, tower, target)
        tower.cooldown += tower.s.cooldown
        fired++
      }
      if (tower.cooldown < 0) tower.cooldown = 0
    }
  }

  /* ---------- abilities ---------- */

  Towers.canActivate = function (sim, tower) {
    if (!tower.s.ability) return { ok: false, reason: 'This tower has no ability.' }
    if (!sim.rules.allowAbilities) return { ok: false, reason: 'Abilities are disabled in this mode.' }
    if (tower.abilityCd > 0) return { ok: false, reason: 'On cooldown (' + tower.abilityCd.toFixed(1) + 's).' }
    return { ok: true, reason: '' }
  }

  Towers.activate = function (sim, tower) {
    const check = Towers.canActivate(sim, tower)
    if (!check.ok) return check
    const ability = tower.s.ability
    const fn = OP.ABILITIES[ability.key]
    if (!fn) return { ok: false, reason: 'Ability "' + ability.key + '" is not registered.' }

    fn(sim, tower)
    tower.abilityCd = ability.cooldown
    tower.abilityT = ability.duration || 0
    sim.events.push({ kind: 'ability', towerId: tower.id, ability: ability.key })
    return { ok: true, reason: '' }
  }

  /* ---------- queries ---------- */

  Towers.at = function (sim, x, y) {
    // Nearest first, so overlapping footprints resolve predictably.
    let best = null, bestD = Infinity
    for (let i = 0; i < sim.towers.length; i++) {
      const tower = sim.towers[i]
      const d = M.dist2(x, y, tower.x, tower.y)
      if (d <= tower.def.footprint * tower.def.footprint && d < bestD) { best = tower; bestD = d }
    }
    return best
  }

  Towers.totalInvested = function (sim) {
    let total = 0
    for (let i = 0; i < sim.towers.length; i++) total += sim.towers[i].invested
    return total
  }

  Towers.countOfKey = function (sim, key) {
    let n = 0
    for (let i = 0; i < sim.towers.length; i++) if (sim.towers[i].key === key) n++
    return n
  }

  Towers.reset = function (sim) {
    sim.towers = []
    sim.towerById = new Map()
  }

  /** Display name, accounting for paragon promotion. */
  Towers.displayName = function (tower) {
    if (tower.paragonDegree > 0 && OP.Paragon.exists(tower.key)) return OP.Paragon.nameFor(tower)
    return tower.def.name
  }

  /* ---------- serialisation ----------
     `def` is looked up from `key` rather than stored, and `s` is recomputed
     rather than saved. Both would otherwise embed object references into the
     save file and break the moment a tower is retuned. */

  Towers.serialize = function (sim) {
    return sim.towers.map(function (tower) {
      return {
        id: tower.id, key: tower.key, x: tower.x, y: tower.y,
        tiers: tower.tiers.slice(),
        targetMode: tower.targetMode, targetId: tower.targetId,
        cooldown: tower.cooldown, angle: tower.angle,
        invested: tower.invested, pops: tower.pops, earned: tower.earned,
        abilityCd: tower.abilityCd, abilityT: tower.abilityT,
        paragonDegree: tower.paragonDegree, placedRound: tower.placedRound,
        heroKey: tower.heroKey || null,
        level: tower.level === undefined ? 0 : tower.level,
        xp: tower.xp === undefined ? 0 : tower.xp,
        ability2Cd: tower.ability2Cd === undefined ? 0 : tower.ability2Cd,
        data: JSON.parse(JSON.stringify(tower.data || {}))
      }
    })
  }

  Towers.deserialize = function (sim, arr) {
    Towers.reset(sim)
    OP.Buffs.reset(sim)
    sim.heroId = -1
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]
      const tower = {
        id: s.id, key: s.key,
        def: s.heroKey ? OP.Heroes.get(s.heroKey) : Towers.get(s.key),
        heroKey: s.heroKey || undefined,
        level: s.level || undefined,
        xp: s.xp || 0,
        ability2Cd: s.ability2Cd || 0,
        x: s.x, y: s.y, tiers: s.tiers.slice(),
        targetMode: s.targetMode, targetId: s.targetId,
        cooldown: s.cooldown, angle: s.angle,
        invested: s.invested, pops: s.pops, earned: s.earned,
        abilityCd: s.abilityCd, abilityT: s.abilityT,
        paragonDegree: s.paragonDegree || 0, placedRound: s.placedRound,
        s: null, sBase: null, data: s.data || {}
      }
      if (tower.heroKey) sim.heroId = tower.id
      sim.towers.push(tower)
      sim.towerById.set(tower.id, tower)
    }
    sim.towers.sort(function (a, b) { return a.id - b.id })
    OP.Buffs.rebuild(sim)
    Towers.restatAll(sim)
  }

  OP.Towers = Towers
  OP.defineTower = Towers.define
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

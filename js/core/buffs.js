;(function (OP) {
  'use strict'

  const M = OP.M

  /* Support-tower buffs.

     A support tower does NOT reach into its neighbours and mutate them. It
     registers a modifier, and stat resolution collects every applicable modifier
     and applies them in one pass (ARCHITECTURE.md §6).

     Why it matters: two overlapping villages must produce identical stats
     regardless of which was placed first. Sequential mutation cannot promise
     that, and the bug it produces — "my tower is weaker than my friend's
     identical tower" — is close to undiagnosable from a bug report.

     The aggregation rules:
       *Add  fields sum
       *Mul  fields multiply
       booleans OR together
       dmgTypeSet resolves to the highest `priority`, ties broken by lowest id

     Sum and product are commutative, so those are order-free by construction.
     dmgTypeSet is the one genuinely ordered decision, so it is resolved by an
     explicit declared priority rather than by whatever order the list came in. */

  const Buffs = {}

  const ADD = ['rangeAdd', 'damageAdd', 'pierceAdd', 'projSpeedAdd', 'shotsAdd', 'blastRadiusAdd']
  const MUL = ['rangeMul', 'cooldownMul', 'damageMul', 'projSpeedMul', 'blastRadiusMul']
  const FLAG = ['camoDetect', 'ignoresLOS', 'onlyBlimps', 'noBlimps']

  Buffs.ADD_FIELDS = ADD
  Buffs.MUL_FIELDS = MUL
  Buffs.FLAG_FIELDS = FLAG

  Buffs.reset = function (sim) {
    sim.buffs = []
    sim.buffsDirty = true
  }

  /**
   * @param {object} sim
   * @param {object} spec
   *   id        {string}  stable and unique per source+kind
   *   sourceId  {number}  the tower providing it
   *   x, y      {number}  centre, ignored when radius is 'global'
   *   radius    {number|'global'}
   *   priority  {number}  higher wins for dmgTypeSet; default 0
   *   families  {string[]} restrict to these tower families
   *   keys      {string[]} restrict to these tower keys
   *   selfOnly  {boolean}  applies only to the source tower
   *   excludeSelf {boolean} applies to everyone but the source
   *   mods      {object}
   */
  Buffs.register = function (sim, spec) {
    if (!spec.id) throw new Error('a buff needs a stable id')
    Buffs.unregisterById(sim, spec.id)
    sim.buffs.push({
      id: spec.id,
      sourceId: spec.sourceId === undefined ? -1 : spec.sourceId,
      x: spec.x || 0,
      y: spec.y || 0,
      radius: spec.radius === undefined ? 'global' : spec.radius,
      priority: spec.priority || 0,
      families: spec.families || null,
      keys: spec.keys || null,
      selfOnly: !!spec.selfOnly,
      excludeSelf: !!spec.excludeSelf,
      mods: spec.mods || {}
    })
    // Registration order must not matter, so keep the list canonically sorted.
    sim.buffs.sort(byPriorityThenId)
    sim.buffsDirty = true
    return spec.id
  }

  function byPriorityThenId (a, b) {
    if (a.priority !== b.priority) return b.priority - a.priority
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  Buffs.unregisterById = function (sim, id) {
    for (let i = 0; i < sim.buffs.length; i++) {
      if (sim.buffs[i].id === id) { sim.buffs.splice(i, 1); sim.buffsDirty = true; return true }
    }
    return false
  }

  Buffs.unregisterBySource = function (sim, sourceId) {
    let removed = 0
    for (let i = sim.buffs.length - 1; i >= 0; i--) {
      if (sim.buffs[i].sourceId === sourceId) { sim.buffs.splice(i, 1); removed++ }
    }
    if (removed) sim.buffsDirty = true
    return removed
  }

  /** Does this buff apply to this tower? */
  Buffs.applies = function (buff, tower) {
    if (buff.selfOnly && buff.sourceId !== tower.id) return false
    if (buff.excludeSelf && buff.sourceId === tower.id) return false
    if (buff.families && buff.families.indexOf(tower.def.family) < 0) return false
    if (buff.keys && buff.keys.indexOf(tower.key) < 0) return false
    if (buff.radius !== 'global') {
      if (M.dist2(buff.x, buff.y, tower.x, tower.y) > buff.radius * buff.radius) return false
    }
    return true
  }

  /**
   * Apply every applicable buff to a resolved stat object, in one pass.
   * Called as step 3 of stat resolution, after upgrades and before freezing.
   */
  Buffs.apply = function (sim, tower, s) {
    const list = sim.buffs
    if (!list || !list.length) return s

    let add = null
    let mul = null
    let flags = null
    let typeSet = null      // { dmgType, priority, id }
    let count = 0

    for (let i = 0; i < list.length; i++) {
      const buff = list[i]
      if (!Buffs.applies(buff, tower)) continue
      count++
      const mods = buff.mods

      for (let a = 0; a < ADD.length; a++) {
        const key = ADD[a]
        if (mods[key] === undefined) continue
        add = add || {}
        add[key] = (add[key] || 0) + mods[key]
      }
      for (let m = 0; m < MUL.length; m++) {
        const key = MUL[m]
        if (mods[key] === undefined) continue
        mul = mul || {}
        mul[key] = (mul[key] === undefined ? 1 : mul[key]) * mods[key]
      }
      for (let f = 0; f < FLAG.length; f++) {
        const key = FLAG[f]
        if (!mods[key]) continue
        flags = flags || {}
        flags[key] = true
      }
      if (mods.dmgTypeSet) {
        // The list is already sorted by (priority desc, id asc), so the first one
        // encountered is the winner. No comparison needed, and no ambiguity.
        if (!typeSet) typeSet = { dmgType: mods.dmgTypeSet, priority: buff.priority, id: buff.id }
      }
    }

    s.buffCount = count
    if (!count) return s

    if (add) {
      if (add.rangeAdd) s.range += add.rangeAdd
      if (add.damageAdd) s.damage += add.damageAdd
      if (add.pierceAdd) s.pierce += add.pierceAdd
      if (add.projSpeedAdd) s.projSpeed += add.projSpeedAdd
      if (add.shotsAdd) s.shots += add.shotsAdd
      if (add.blastRadiusAdd && s.blastRadius) s.blastRadius += add.blastRadiusAdd
    }
    if (mul) {
      if (mul.rangeMul !== undefined) s.range *= mul.rangeMul
      if (mul.cooldownMul !== undefined) s.cooldown *= mul.cooldownMul
      if (mul.damageMul !== undefined) s.damage = Math.max(0, Math.round(s.damage * mul.damageMul))
      if (mul.projSpeedMul !== undefined) s.projSpeed *= mul.projSpeedMul
      if (mul.blastRadiusMul !== undefined && s.blastRadius) s.blastRadius *= mul.blastRadiusMul
    }
    if (flags) {
      for (const key in flags) if (flags[key]) s[key] = true
    }
    if (typeSet) s.dmgType = typeSet.dmgType

    // A cooldown of zero would fire an unbounded number of times per tick.
    if (s.cooldown < 1 / 240) s.cooldown = 1 / 240

    return s
  }

  /** Every buff currently reaching this tower — for the tower panel. */
  Buffs.listFor = function (sim, tower, out) {
    out.length = 0
    for (let i = 0; i < sim.buffs.length; i++) {
      if (Buffs.applies(sim.buffs[i], tower)) out.push(sim.buffs[i])
    }
    return out
  }

  /* ---------- serialisation ----------
     Buffs are re-registered by their source towers on load, so they are not part
     of the save payload. Recording them would risk a buff outliving its tower. */

  Buffs.rebuild = function (sim) {
    sim.buffs = []
    // Towers.restatAll resolves sBase first, then re-registers every aura from
    // it, then resolves final stats — see the comment there for why one pass is
    // not enough.
    OP.Towers.restatAll(sim)
    sim.buffs.sort(byPriorityThenId)
    sim.buffsDirty = true
  }

  OP.Buffs = Buffs
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

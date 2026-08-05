;(function (OP) {
  'use strict'

  /* Damage resolution.

     This is the only place in the codebase permitted to change a balloon's tier
     or HP. Everything else — projectiles, dots, abilities, blasts — routes
     through Damage.hit.

     THE LAYER-CASCADE RULE (ARCHITECTURE.md §3), stated once, here, in code:

       Damage cascades down single-child chains only. It stops at any split.

     So damage 2 on a green pops green then blue and leaves a red, because
     green -> blue -> red is a single-child chain. Damage 5 on a black pops the
     black layer and stops: two pinks spawn intact and the leftover 4 damage is
     discarded, because black splits.

     Clusters are killed by PIERCE, not by excess damage. A projectile that pops
     a balloon may hit the resulting children in the same tick, spending one
     pierce per child. That asymmetry is what makes pierce a real stat instead of
     a rounding detail. */

  const Damage = {}

  /** Can `dmgType` hurt this tier at all? A table lookup plus the two overrides. */
  OP.canDamage = function (tierKey, dmgType) {
    const tier = typeof tierKey === 'number' ? OP.BALLOON_TIERS[tierKey] : OP.tierByKey(tierKey)
    return canDamageTier(tier, dmgType)
  }

  function canDamageTier (tier, dmgType) {
    if (!tier.immuneSet[dmgType]) return true
    // Immune to this type — unless the type is a documented universal override.
    return OP.dmgBypasses(dmgType, dmgType)
  }
  Damage.canDamageTier = canDamageTier

  /**
   * Apply one hit to one balloon.
   *
   * @param {object} sim
   * @param {object} b       the balloon
   * @param {object} hit
   *   damage        {number}  layers/HP to remove
   *   dmgType       {string}  OP.DMG.*
   *   sourceId      {number}  tower id, -1 for effects and the environment
   *   ignoreImmunity{boolean} paragon-tier override
   *   effects       {Array}   status effects to apply on contact
   *   instaKill     {boolean} removes the whole balloon (blimps may resist)
   * @returns {{
   *   damaged:boolean, layersPopped:number, cashEarned:number,
   *   destroyed:boolean, spawned:number[], absorbed:number
   * }}
   */
  Damage.hit = function (sim, b, hit) {
    const res = { damaged: false, layersPopped: 0, cashEarned: 0, destroyed: false, spawned: EMPTY, absorbed: 0 }
    if (!b || !b.alive) return res

    const dmgType = hit.dmgType || OP.DMG.NORMAL
    let tier = OP.BALLOON_TIERS[b.tier]

    // Status effects land even when the damage itself is blanked — a glue shot
    // that can't hurt a lead balloon still glues it.
    if (hit.effects) {
      for (let i = 0; i < hit.effects.length; i++) OP.Effects.apply(b, hit.effects[i])
    }

    const ignore = hit.ignoreImmunity || dmgType === OP.DMG.VOID

    if (hit.instaKill) return instaKill(sim, b, hit, res)

    if (!ignore && !canDamageTier(tier, dmgType)) {
      res.absorbed = hit.damage
      sim.stats.blanked = (sim.stats.blanked || 0) + 1
      return res
    }

    // Brittleness amplifies incoming damage. Applied once, on entry, not per
    // layer — otherwise a cascade compounds it. Kept integral so blimp HP never
    // drifts into fractions that render badly and compare awkwardly.
    const amp = OP.Effects.damageMultiplier(b)
    let remaining = amp === 1 ? hit.damage : Math.max(1, Math.round(hit.damage * amp))
    if (!(remaining > 0)) return res

    res.damaged = true
    let guard = 0

    while (remaining > 0 && b.alive) {
      if (++guard > OP.MAX_CASCADE_DEPTH * 2) break

      tier = OP.BALLOON_TIERS[b.tier]

      // Each layer is immunity-checked independently. A cascade halts the moment
      // it reaches a layer this damage type cannot touch — the classic case being
      // a sharp shot cascading down into a lead layer.
      if (!ignore && !canDamageTier(tier, dmgType)) {
        res.absorbed += remaining
        break
      }

      if (remaining < b.hp) {
        b.hp -= remaining
        remaining = 0
        break
      }

      // This layer is gone.
      remaining -= b.hp
      res.layersPopped++
      res.cashEarned += tier.cash
      sim.stats.layersPopped++

      const children = tier.children

      if (children.length === 0) {
        // Terminal tier: the balloon is finished.
        destroy(sim, b, hit, res)
        break
      }

      if (children.length === 1 && children[0].count === 1) {
        // Single-child chain: mutate in place, keep the id, keep spawnTier so
        // REGEN still knows how far back it may climb. The cascade continues.
        b.tier = OP.tierIndex(children[0].tier)
        const next = OP.BALLOON_TIERS[b.tier]
        b.hp = Math.max(1, Math.round(OP.layerHP(next, b.props) * b.hpScale))
        continue
      }

      // A split. Children spawn intact and any leftover damage is discarded.
      const spawned = []
      OP.Balloons.spawnChildren(sim, b, spawned)
      res.spawned = spawned
      destroy(sim, b, hit, res)
      break
    }

    if (res.cashEarned > 0) award(sim, hit, res)
    return res
  }

  // Frozen so a caller that tries to push into a no-spawn result fails loudly
  // rather than corrupting the shared array.
  const EMPTY = Object.freeze([])

  function destroy (sim, b, hit, res) {
    res.destroyed = true
    sim.stats.popped++
    sim.popEvents.push({ id: b.id, tier: OP.BALLOON_TIERS[b.tier].key, x: b.x, y: b.y, src: hit.sourceId })
    OP.Balloons.kill(sim, b)
  }

  function award (sim, hit, res) {
    const cash = res.cashEarned * (sim.cashPerPopMul === undefined ? 1 : sim.cashPerPopMul)
    res.cashEarned = cash
    if (OP.Economy && OP.Economy.earn) OP.Economy.earn(sim, cash, hit.sourceId)
    else { sim.cash += cash; sim.stats.cashEarned += cash }
    if (hit.sourceId >= 0 && sim.towerById) {
      const tower = sim.towerById.get(hit.sourceId)
      if (tower) tower.pops += res.layersPopped
    }
  }

  /**
   * Remove a balloon outright. Blimps with `abilityImmune` shrug this off, which
   * is what stops a single ability from deleting the final blimp — the OMEN has
   * to be ground down.
   */
  function instaKill (sim, b, hit, res) {
    const tier = OP.BALLOON_TIERS[b.tier]
    if (tier.abilityImmune && !hit.ignoreAbilityImmunity) {
      res.absorbed = Infinity
      return res
    }
    res.damaged = true
    res.layersPopped = 1
    res.cashEarned = tier.cash
    sim.stats.layersPopped++
    const spawned = []
    if (tier.children.length && !hit.deleteChildren) {
      OP.Balloons.spawnChildren(sim, b, spawned)
      res.spawned = spawned
    }
    destroy(sim, b, hit, res)
    award(sim, hit, res)
    return res
  }

  /**
   * Area damage. Every balloon whose hull intersects the circle takes one hit.
   *
   * The camo gate is enforced here as well as in targeting: an AoE from a tower
   * without detection must not clip a veiled balloon it could never have
   * targeted. Enforcing it in only one of the two places is how camo leaks.
   */
  Damage.blast = function (sim, x, y, radius, hit, opts) {
    opts = opts || {}
    const scratch = sim._blastScratch || (sim._blastScratch = [])
    OP.Grid.queryCircleFat(sim.grid, x, y, radius, scratch)

    let hitCount = 0
    let popped = 0
    const detects = !!opts.camoDetect
    const maxTargets = opts.maxTargets === undefined ? Infinity : opts.maxTargets

    // scratch is id-sorted by the grid, so a capped blast always picks the same
    // victims for the same board state.
    for (let i = 0; i < scratch.length && hitCount < maxTargets; i++) {
      const b = scratch[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !detects) continue
      if (opts.exclude && opts.exclude.has(b.id)) continue

      // Falloff, if the caller wants it.
      let dmg = hit.damage
      if (opts.falloff) {
        const d = Math.sqrt(OP.M.dist2(x, y, b.x, b.y))
        const f = 1 - OP.M.clamp01(d / radius) * opts.falloff
        dmg = Math.max(1, Math.round(dmg * f))
      }

      const r = Damage.hit(sim, b, {
        damage: dmg,
        dmgType: hit.dmgType,
        sourceId: hit.sourceId,
        effects: hit.effects,
        ignoreImmunity: hit.ignoreImmunity,
        instaKill: hit.instaKill
      })
      if (r.damaged) hitCount++
      if (r.destroyed) popped++
      if (opts.exclude) opts.exclude.add(b.id)
    }
    return { hits: hitCount, popped: popped }
  }

  /** Human-readable reason a hit did nothing — used by the tower panel. */
  Damage.explainImmunity = function (tierKey, dmgType) {
    const tier = typeof tierKey === 'number' ? OP.BALLOON_TIERS[tierKey] : OP.tierByKey(tierKey)
    if (canDamageTier(tier, dmgType)) return null
    const meta = OP.DMG_META[dmgType]
    return `${tier.name} ignores ${meta ? meta.label.toLowerCase() : dmgType} damage`
  }

  OP.Damage = Damage
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

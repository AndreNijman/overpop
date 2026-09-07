;(function (OP) {
  'use strict'

  const Powers = {}

  function count (v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0
  }

  Powers.copyInventory = function (raw) {
    const out = {}
    const order = OP.POWER_ORDER || []
    for (let i = 0; i < order.length; i++) {
      const key = order[i]
      out[key] = count(raw && raw[key])
    }
    return out
  }

  Powers.init = function (sim, inventory) {
    sim.powers = Powers.copyInventory(inventory)
    // Knowledge's Powers tree can stock one spare use of every owned power at
    // the start of each run (pow-free-inventory's rule delta).
    const bonus = (sim.rules && sim.rules.powerStockBonus) || 0
    if (bonus > 0) {
      for (const k in sim.powers) {
        if (sim.powers[k] > 0) sim.powers[k] += bonus
      }
    }
    return sim.powers
  }

  Powers.canActivate = function (sim, key) {
    const def = OP.POWERS && OP.POWERS[key]
    if (!def) return { ok: false, reason: 'Unknown power.' }
    if (!sim || sim.over) return { ok: false, reason: 'No active run.' }
    if (!sim.rules.allowPowers) return { ok: false, reason: 'Powers are disabled in this mode.' }
    if (!sim.powers || count(sim.powers[key]) <= 0) return { ok: false, reason: 'None left.' }
    if (def.effect === 'lives' && !sim.rules.livesRegain) {
      return { ok: false, reason: 'Lives cannot be regained in this mode.' }
    }
    if (def.effect === 'slow' && !hasBalloons(sim)) {
      return { ok: false, reason: 'No targets on the board.' }
    }
    if (def.effect === 'damage' && !hasTargets(sim)) {
      return { ok: false, reason: 'No targets on the board.' }
    }
    return { ok: true, reason: '' }
  }

  function hasBalloons (sim) {
    for (let i = 0; i < sim.balloons.length; i++) if (sim.balloons[i].alive) return true
    return false
  }

  function hasTargets (sim) {
    return hasBalloons(sim) || !!(sim.boss && sim.boss.alive)
  }

  Powers.activate = function (sim, key) {
    const allowed = Powers.canActivate(sim, key)
    if (!allowed.ok) return allowed

    const def = OP.POWERS[key]
    let affected = 0

    // Knowledge's Powers tree strengthens effects through rule deltas. They are
    // deltas (knowledge rules fold additively), so the multiplier is 1 + delta.
    const r = sim.rules || {}
    const effectMul = 1 + (r.powerEffectMul || 0)
    const durationMul = 1 + (r.powerDurationMul || 0)

    if (def.effect === 'cash') {
      const amount = Math.round(def.amount * effectMul)
      OP.Economy.earn(sim, amount, -1)
      affected = amount
    } else if (def.effect === 'lives') {
      affected = OP.Economy.gainLives(sim, Math.round(def.amount * effectMul))
    } else if (def.effect === 'slow') {
      for (let i = 0; i < sim.balloons.length; i++) {
        const b = sim.balloons[i]
        if (!b.alive) continue
        if (OP.Effects.apply(b, OP.Effects.make('glue', def.duration * durationMul, def.magnitude + (r.powerSlowAdd || 0), -1, OP.DMG.NORMAL))) affected++
      }
    } else if (def.effect === 'damage') {
      const dmg = def.damage + (r.powerDamageAdd || 0)
      const end = sim.balloons.length
      for (let i = 0; i < end; i++) {
        const b = sim.balloons[i]
        if (!b.alive) continue
        OP.Damage.hit(sim, b, { damage: dmg, dmgType: def.dmgType, sourceId: -1 })
        affected++
      }
      if (sim.boss && sim.boss.alive && OP.Boss) {
        OP.Boss.damage(sim, { damage: dmg, dmgType: def.dmgType, sourceId: -1 })
        affected++
      }
    }

    sim.powers[key]--
    sim.events.push({ kind: 'power', key: key, affected: affected })
    return { ok: true, reason: '', affected: affected, remaining: sim.powers[key] }
  }

  Powers.rewardKey = function (profile) {
    const order = OP.POWER_ORDER || []
    if (!order.length) return null
    const wins = profile && profile.stats ? profile.stats.gamesWon : 0
    return order[Math.max(0, wins - 1) % order.length]
  }

  OP.Powers = Powers
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

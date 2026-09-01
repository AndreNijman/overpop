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

    if (def.effect === 'cash') {
      OP.Economy.earn(sim, def.amount, -1)
      affected = def.amount
    } else if (def.effect === 'lives') {
      affected = OP.Economy.gainLives(sim, def.amount)
    } else if (def.effect === 'slow') {
      for (let i = 0; i < sim.balloons.length; i++) {
        const b = sim.balloons[i]
        if (!b.alive) continue
        if (OP.Effects.apply(b, OP.Effects.make('glue', def.duration, def.magnitude, -1, OP.DMG.NORMAL))) affected++
      }
    } else if (def.effect === 'damage') {
      const end = sim.balloons.length
      for (let i = 0; i < end; i++) {
        const b = sim.balloons[i]
        if (!b.alive) continue
        OP.Damage.hit(sim, b, { damage: def.damage, dmgType: def.dmgType, sourceId: -1 })
        affected++
      }
      if (sim.boss && sim.boss.alive && OP.Boss) {
        OP.Boss.damage(sim, { damage: def.damage, dmgType: def.dmgType, sourceId: -1 })
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

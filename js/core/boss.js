;(function (OP) {
  'use strict'

  /* Boss Bloon system.

     A boss is a separate entity from the balloon pool. It moves along a track,
     has massive HP, spawns minions periodically, and may have triggered
     abilities. If the boss reaches the exit or is not killed within its time
     limit, the player loses.

     Bosses are NOT balloon tiers — their lifecycle differs: they don't split,
     they have a timeout, they spawn minions on a schedule, and they have a
     visible health bar. The boss entity lives on sim.boss.

     Damage routing: towers target balloons as normal. When a projectile hits the
     boss (checked in Projectiles.step), it calls Boss.damage. The boss is
     targetable by default; camo bosses use the same VEILED property check.

     Damage to the boss also counts toward pop stats and paragon degree
     calculations. */

  const Boss = {}

  /** Boss spawn events emitted to the HUD/audio layer. */
  Boss.SPAWN_INTERVAL = 20  // rounds between tier spawns

  /* ---------- boss entity ---------- */

  /**
   * Create a boss entity. Does NOT place it on the map — Boss.spawn does.
   */
  function createEntity (bossDef, tier, elite, path, startT) {
    return {
      id: -1,
      isBoss: true,
      alive: true,
      def: bossDef,
      tier: tier,
      elite: !!elite,
      hp: OP.bossHP(bossDef, tier, elite),
      maxHP: OP.bossHP(bossDef, tier, elite),
      speed: OP.bossSpeed(bossDef, tier, elite),
      radius: OP.bossRadius(bossDef, tier),
      path: path,
      t: startT || 0,
      x: 0, y: 0, prevX: 0, prevY: 0,
      slowResist: bossDef.slowResist || 0,
      stunImmune: !!bossDef.stunImmune,
      abilityImmune: !!bossDef.abilityImmune,
      // Speed modification from status effects
      speedMul: 1,
      // Minion spawn schedule
      minionTimer: 0,
      minionInterval: 0,
      minionWave: 0,
      // Ability cooldown
      abilityCd: 0,
      abilityActive: false,
      abilityTimer: 0,
      // Time limit: player has 20 rounds to kill the boss (tracked in ticks)
      timeLimit: 0,
      ticksAlive: 0,
      // Pop stats for paragon degree
      totalDamageDealt: 0
    }
  }

  /* ---------- spawning ---------- */

  /**
   * Spawn a boss on the sim. Called when a boss event round arrives.
   * @param {object} sim
   * @param {string} bossKey   key into OP.BOSSES
   * @param {number} tier      1-5
   * @param {boolean} elite
   * @returns {object|null} the boss entity, or null if no boss is active
   */
  Boss.spawn = function (sim, bossKey, tier, elite) {
    if (sim.boss && sim.boss.alive) return null  // boss already alive

    const bossDef = OP.bossByKey(bossKey)
    if (!bossDef) return null

    const path = 0  // bosses always take path 0
    const boss = createEntity(bossDef, tier, elite, path, 0)
    boss.id = sim.nextEntityId++

    // Position at start of track
    const track = sim.map.paths[path]
    track.posInto(0, boss)
    boss.prevX = boss.x
    boss.prevY = boss.y

    // Minion interval: spawn minions every N seconds based on tier
    boss.minionInterval = Math.max(3, 12 - tier * 2)
    boss.minionTimer = boss.minionInterval  // first spawn after interval

    // Time limit: 20 rounds worth of ticks (20 * ~1800 ticks/round at 60fps)
    boss.timeLimit = 20 * 1800

    // Ability cooldown starts at 0 so first trigger is after cooldown
    const ability = OP.bossAbility(bossDef, tier)
    boss.abilityCd = ability ? ability.cooldown * 60 : 0  // convert to ticks

    sim.boss = boss
    sim.byId.set(boss.id, boss)
    sim.events.push({
      kind: 'bossspawn',
      boss: bossKey,
      tier: tier,
      elite: elite,
      hp: boss.hp,
      maxHP: boss.maxHP
    })

    return boss
  }

  /* ---------- damage ---------- */

  /**
   * Apply damage to the boss. Called from the projectile hit path.
   * @param {object} sim
   * @param {object} hit  { damage, dmgType, sourceId, effects, ignoreImmunity, instaKill }
   * @returns {{ damaged:boolean, layersPopped:number, cashEarned:number, destroyed:boolean }}
   */
  Boss.damage = function (sim, hit) {
    const boss = sim.boss
    const res = { damaged: false, layersPopped: 0, cashEarned: 0, destroyed: false }

    if (!boss || !boss.alive) return res

    // Apply status effects even if damage is blanked
    if (hit.effects) {
      for (let i = 0; i < hit.effects.length; i++) {
        const e = hit.effects[i]
        if (e.kind === 'cold') {
          boss.speedMul = Math.min(boss.speedMul, 1 - (1 - boss.slowResist) * 0.4)
        } else if (e.kind === 'glue') {
          boss.speedMul = Math.min(boss.speedMul, 1 - (1 - boss.slowResist) * 0.3)
        } else if (e.kind === 'stun') {
          if (!boss.stunImmune) boss.speedMul = 0
        } else if (e.kind === 'brittle') {
          // Brittle amplifies damage — applied in the damage calc below
        }
      }
    }

    // Calculate damage with brittleness amplifier
    let damage = hit.damage || 0
    // Check for brittle effect on the boss (simplified — no full effect stack)
    if (hit.effects) {
      for (let i = 0; i < hit.effects.length; i++) {
        if (hit.effects[i].kind === 'brittle') {
          damage = Math.round(damage * 1.5)
          break
        }
      }
    }

    if (damage <= 0) return res

    res.damaged = true
    boss.hp -= damage
    boss.totalDamageDealt += damage
    sim.stats.damageDealt += damage

    // Award cash
    const cashPerDamage = 0.1  // 1 cent per HP of boss damage
    const cash = Math.floor(damage * cashPerDamage * (sim.cashPerPopMul || 1))
    if (cash > 0) {
      res.cashEarned = cash
      OP.Economy.earn(sim, cash, hit.sourceId)
    }

    // Award pop stats
    if (hit.sourceId >= 0 && sim.towerById) {
      const tower = sim.towerById.get(hit.sourceId)
      if (tower) tower.pops += Math.ceil(damage / 10)
    }
    sim.stats.layersPopped += Math.ceil(damage / 10)

    // Boss killed
    if (boss.hp <= 0) {
      boss.hp = 0
      boss.alive = false
      res.destroyed = true

      // Award kill cash
      const killCash = Math.floor(boss.maxHP * 0.01)
      OP.Economy.earn(sim, killCash, hit.sourceId)

      sim.events.push({
        kind: 'bosskill',
        boss: boss.def.key,
        tier: boss.tier,
        elite: boss.elite,
        cash: killCash
      })

      // Spawn remaining minions on death
      const minionSchedule = OP.bossMinions(boss.def, boss.tier)
      if (minionSchedule) {
        for (let i = 0; i < minionSchedule.count; i++) {
          OP.Balloons.spawn(sim, {
            tier: minionSchedule.tier,
            path: boss.path,
            t: Math.max(0, boss.t - i * 7)
          })
        }
      }

      sim.byId.delete(boss.id)
      sim.boss = null
    }

    return res
  }

  /* ---------- per-tick systems ---------- */

  /**
   * Move the boss along the track. Called from Sim.step.
   */
  Boss.move = function (sim) {
    const boss = sim.boss
    if (!boss || !boss.alive) return

    boss.prevX = boss.x
    boss.prevY = boss.y

    const track = sim.map.paths[boss.path]
    const dt = OP.DT
    boss.t += boss.speed * OP.BASE_SPEED * boss.speedMul * dt
    track.posInto(boss.t, boss)

    boss.ticksAlive++
    boss.speedMul = 1  // reset for next tick's status effects

    // Check if boss reached the exit
    if (boss.t >= track.length) {
      boss.alive = false
      sim.byId.delete(boss.id)
      sim.events.push({ kind: 'bossreach', boss: boss.def.key, tier: boss.tier })
      OP.Economy.endGame(sim, 'leaked')
    }

    // Time limit check
    if (boss.ticksAlive >= boss.timeLimit) {
      boss.alive = false
      sim.byId.delete(boss.id)
      sim.events.push({ kind: 'bosstimeout', boss: boss.def.key, tier: boss.tier })
      OP.Economy.endGame(sim, 'leaked')
    }
  }

  /**
   * Boss minion spawning. Called from Sim.step.
   */
  Boss.minionTick = function (sim) {
    const boss = sim.boss
    if (!boss || !boss.alive) return

    const minionSchedule = OP.bossMinions(boss.def, boss.tier)
    if (!minionSchedule) return

    boss.minionTimer--
    if (boss.minionTimer > 0) return

    // Spawn one minion
    const track = sim.map.paths[boss.path]
    const spawnT = Math.max(0, boss.t - 30)  // spawn behind the boss
    OP.Balloons.spawn(sim, {
      tier: minionSchedule.tier,
      path: boss.path,
      t: spawnT
    })

    boss.minionWave++
    if (boss.minionWave >= minionSchedule.count) {
      boss.minionWave = 0
      boss.minionTimer = boss.minionInterval
    } else {
      boss.minionTimer = Math.max(1, Math.round(minionSchedule.spacing * 60))
    }
  }

  /**
   * Boss ability tick. Called from Sim.step.
   */
  Boss.abilityTick = function (sim) {
    const boss = sim.boss
    if (!boss || !boss.alive) return

    const ability = OP.bossAbility(boss.def, boss.tier)
    if (!ability) return

    if (boss.abilityActive) {
      boss.abilityTimer--
      if (boss.abilityTimer <= 0) {
        boss.abilityActive = false
      }
      return
    }

    boss.abilityCd--
    if (boss.abilityCd <= 0) {
      boss.abilityActive = true
      boss.abilityTimer = 180  // 3 seconds active
      boss.abilityCd = ability.cooldown * 60

      // Execute boss ability
      Boss.executeAbility(sim, boss, ability)
    }
  }

  /**
   * Execute a boss ability.
   */
  Boss.executeAbility = function (sim, boss, ability) {
    sim.events.push({
      kind: 'bossability',
      boss: boss.def.key,
      tier: boss.tier,
      ability: ability.key
    })

    if (ability.key === 'elder-worm-summon') {
      // Spawn a wave of minions
      const schedule = OP.bossMinions(boss.def, boss.tier)
      if (schedule) {
        const count = Math.min(schedule.count, 8)
        for (let i = 0; i < count; i++) {
          OP.Balloons.spawn(sim, {
            tier: schedule.tier,
            path: boss.path,
            t: Math.max(0, boss.t - i * 10)
          })
        }
      }
    } else if (ability.key === 'storm-drake-shock') {
      // Find nearest tower and stun it (disable fire for 3 seconds)
      let nearest = null
      let nearestDist = Infinity
      for (let i = 0; i < sim.towers.length; i++) {
        const t = sim.towers[i]
        const d = Math.sqrt(OP.M.dist2(boss.x, boss.y, t.x, t.y))
        if (d < nearestDist && d < 200) {
          nearestDist = d
          nearest = t
        }
      }
      if (nearest) {
        nearest.stunnedT = 180  // 3 seconds
      }
    } else if (ability.key === 'void-maw-warp') {
      // Reduce range of nearby towers by 30% for 5 seconds
      for (let i = 0; i < sim.towers.length; i++) {
        const t = sim.towers[i]
        const d = Math.sqrt(OP.M.dist2(boss.x, boss.y, t.x, t.y))
        if (d < 150) {
          t.rangeWarpT = 300  // 5 seconds
          t.rangeWarpMul = 0.7
        }
      }
    }
  }

  /* ---------- queries ---------- */

  /** Is a boss active on this sim? */
  Boss.isActive = function (sim) {
    return !!(sim.boss && sim.boss.alive)
  }

  /** Boss HP fraction (0-1) for the health bar. */
  Boss.hpFraction = function (sim) {
    if (!sim.boss || !sim.boss.alive) return 0
    return sim.boss.hp / sim.boss.maxHP
  }

  /** Boss info for the HUD. */
  Boss.info = function (sim) {
    if (!sim.boss || !sim.boss.alive) return null
    return {
      name: sim.boss.def.name,
      tier: sim.boss.tier,
      elite: sim.boss.elite,
      hp: sim.boss.hp,
      maxHP: sim.boss.maxHP,
      fraction: sim.boss.hp / sim.boss.maxHP,
      colour: sim.boss.def.colour,
      shade: sim.boss.def.shade
    }
  }

  /* ---------- serialisation ---------- */

  Boss.serialize = function (sim) {
    if (!sim.boss) return null
    const b = sim.boss
    return {
      alive: b.alive,
      id: b.id,
      bossKey: b.def.key,
      tier: b.tier,
      elite: b.elite,
      hp: b.hp,
      maxHP: b.maxHP,
      path: b.path,
      t: b.t,
      speedMul: b.speedMul,
      minionTimer: b.minionTimer,
      minionInterval: b.minionInterval,
      minionWave: b.minionWave,
      abilityCd: b.abilityCd,
      abilityActive: b.abilityActive,
      abilityTimer: b.abilityTimer,
      ticksAlive: b.ticksAlive,
      timeLimit: b.timeLimit,
      totalDamageDealt: b.totalDamageDealt
    }
  }

  Boss.deserialize = function (sim, snap) {
    if (!snap) { sim.boss = null; return }
    const bossDef = OP.bossByKey(snap.bossKey)
    if (!bossDef) { sim.boss = null; return }

    const boss = createEntity(bossDef, snap.tier, snap.elite, snap.path, snap.t)
    boss.id = snap.id === undefined ? sim.nextEntityId++ : snap.id
    boss.alive = snap.alive
    boss.hp = snap.hp
    boss.maxHP = snap.maxHP
    boss.speedMul = snap.speedMul
    boss.minionTimer = snap.minionTimer
    boss.minionInterval = snap.minionInterval === undefined ? Math.max(3, 12 - boss.tier * 2) : snap.minionInterval
    boss.minionWave = snap.minionWave
    boss.abilityCd = snap.abilityCd
    boss.abilityActive = snap.abilityActive
    boss.abilityTimer = snap.abilityTimer
    boss.ticksAlive = snap.ticksAlive
    boss.timeLimit = snap.timeLimit === undefined ? 20 * 1800 : snap.timeLimit
    boss.totalDamageDealt = snap.totalDamageDealt

    // Reposition on track
    const track = sim.map.paths[boss.path]
    track.posInto(boss.t, boss)
    boss.prevX = boss.x
    boss.prevY = boss.y

    sim.boss = boss
    if (boss.alive) sim.byId.set(boss.id, boss)
  }

  OP.Boss = Boss
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

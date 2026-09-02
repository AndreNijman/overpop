;(function (OP) {
  'use strict'

  /* The simulation.

     One fixed-timestep step function, in the exact order documented in
     ARCHITECTURE.md §7. That order is frozen: reordering it changes behaviour in
     ways that are individually tiny and collectively produce leak reports nobody
     can reproduce, and it invalidates every recorded determinism checksum.

     The sim knows nothing about rendering, input, or audio. It can be run flat
     out in Node with no canvas at all, which is what makes "rounds 1-100
     verified" a claim backed by evidence rather than by hand-playing. */

  const Sim = {}

  /**
   * @param {object} config
   *   map        {object} { key, paths: [Track], blockers?, placement? }
   *   seed       {*}
   *   difficulty {string} key into OP.DIFFICULTIES
   *   mode       {string} key into OP.MODES
   *   roundSetKey{string} key into OP.ROUND_SETS; recorded in saves
   *   roundSet   {object} explicit round table, overrides roundSetKey
   *   rules      {object} explicit overrides, applied last
   */
  Sim.create = function (config) {
    config = config || {}
    if (!config.map || !config.map.paths || !config.map.paths.length) {
      throw new Error('Sim.create needs a map with at least one path')
    }

    const rules = Sim.resolveRules(config)

    // Apply knowledge rule overrides (persistent skill tree bonuses)
    if (OP.Knowledge && OP.Knowledge.applyRules && config.knowledge && config.knowledge.length) {
      OP.Knowledge.applyRules(rules, config.knowledge)
    }

    const sim = {
      // identity
      seed: config.seed === undefined ? 'overpop' : config.seed,
      difficulty: config.difficulty || 'medium',
      mode: config.mode || 'standard',
      map: config.map,

      // clocks
      tick: 0,
      time: 0,
      accumulator: 0,
      speed: 1,
      paused: false,

      // rng — the ONLY randomness the sim may read
      rng: new OP.RNG(config.seed === undefined ? 'overpop' : config.seed),

      // rules
      rules: rules,
      // The KEY is what gets saved. Restoring a game by key rather than by
      // embedding the table means an Alternate Waves save resumes on alternate
      // waves — and it means retuned round data reaches existing saves.
      roundSetKey: config.roundSetKey || 'standard',
      roundSet: config.roundSet || OP.ROUND_SETS[config.roundSetKey || 'standard'] ||
                OP.ROUNDS_STANDARD || null,
      freeplay: false,
      freeplayBaseline: null,

      // entities
      balloons: [], balloonPool: [], byId: new Map(),
      projectiles: [], projPool: [],
      towers: [], towerById: new Map(),
      buffs: [], buffsDirty: false,
      heroId: -1,
      boss: null,
      nextEntityId: 1,

      // state
      cash: rules.startCash,
      lives: rules.startLives,
      cashPerPopMul: rules.cashPerPopMul,
      roundIndex: rules.firstRound - 1,
      round: null,
      autostart: !!config.autostart,
      over: false,
      outcome: null,

      // event queues — the renderer and audio drain these; the sim only appends
      leakEvents: [], popEvents: [], blastEvents: [], events: [],

      stats: {
        spawned: 0, popped: 0, leaked: 0, regrown: 0, blanked: 0,
        layersPopped: 0, shotsFired: 0, projHits: 0, damageDealt: 0,
        cashEarned: 0, cashSpent: 0, livesLost: 0, roundsCleared: 0
      },

      // kind -> count of projectiles emitted, for the render-coverage assertion
      kindsSeen: {},

      grid: OP.Grid.create(OP.FIELD_W, OP.FIELD_H),

      // Knowledge: the set of unlocked skill tree nodes for this run
      knowledge: Array.isArray(config.knowledge)
        ? config.knowledge.filter(k => OP.KNOWLEDGE && OP.KNOWLEDGE[k]).slice().sort()
        : [],

      // Persistent consumables copied from the player profile for this run
      powers: {}
    }

    OP.Balloons.reset(sim)
    OP.Projectiles.reset(sim)
    OP.Towers.reset(sim)
    OP.Buffs.reset(sim)
    sim.buffsDirty = false

    // Register knowledge stat buffs globally
    if (OP.Knowledge && OP.Knowledge.registerBuffs && sim.knowledge.length) {
      OP.Knowledge.registerBuffs(sim, sim.knowledge)
    }

    // Initialise coop state if rules.coop is set
    if (OP.Coop && OP.Coop.init) OP.Coop.init(sim)

    if (OP.Powers && OP.Powers.init) OP.Powers.init(sim, config.powers)

    return sim
  }

  /**
   * Difficulty and mode are pure config deltas, layered in a fixed order:
   * defaults, then difficulty, then mode, then explicit overrides. A mode is
   * never a branch inside the sim (ARCHITECTURE.md §8).
   */
  Sim.resolveRules = function (config) {
    const rules = OP.Economy.defaultRules()

    const diff = OP.DIFFICULTIES && OP.DIFFICULTIES[config.difficulty || 'medium']
    if (diff) applyRules(rules, diff.rules || diff)

    const mode = OP.MODES && OP.MODES[config.mode || 'standard']
    if (mode) applyRules(rules, mode.rules || {})

    if (config.rules) applyRules(rules, config.rules)
    return rules
  }

  function applyRules (into, from) {
    for (const key in from) {
      if (key === 'rules') continue
      into[key] = from[key]
    }
    return into
  }

  /* ---------- the step ---------- */

  /**
   * Exactly one fixed tick. See ARCHITECTURE.md §7 — this order is the contract.
   */
  Sim.step = function (sim) {
    if (sim.over) return

    // 1. clocks
    sim.tick++
    sim.time += OP.DT

    // 2. round runner
    if (sim.round && !sim.round.done) OP.Rounds.tick(sim)

    // 3. status effects — before movement, so a new slow bites this tick
    OP.Effects.tick(sim)

    // 3b. boss systems — before movement so the boss is positioned correctly
    if (OP.Boss) {
      OP.Boss.move(sim)
      OP.Boss.minionTick(sim)
      OP.Boss.abilityTick(sim)
    }

    // 4. regen
    OP.Balloons.regenTick(sim)

    // 5. movement
    OP.Balloons.move(sim)

    // 6. leaks
    const leaked = OP.Balloons.leakCheck(sim)
    if (leaked > 0) OP.Economy.loseLives(sim, leaked)

    // 7. spatial index
    OP.Grid.rebuild(sim.grid, sim.balloons)

    // 8. towers
    if (sim.towers.length) OP.Towers.step(sim)

    // 9 + 10. projectiles, and the blasts they cause
    if (sim.projectiles.length) OP.Projectiles.step(sim)

    // 11. heroes level from what just happened
    if (sim.heroId >= 0 && OP.Heroes && OP.Heroes.step) OP.Heroes.step(sim)

    // 12. compaction
    OP.Balloons.compact(sim)
    OP.Projectiles.compact(sim)

    // 13. round completion and payouts
    if (!sim.over && sim.round && !sim.round.done && OP.Rounds.isComplete(sim)) {
      OP.Rounds.complete(sim)

      // Coop: swap active player at round end
      if (OP.Coop && OP.Coop.swap && sim.coop && !sim.over) {
        OP.Coop.swap(sim)
      }

      // Boss event: spawn boss at appropriate rounds
      if (!sim.over && OP.Boss && sim.mode && sim.mode.indexOf('boss-event') === 0) {
        const bossKey = sim.rules.bossKey
        if (bossKey) {
          const bossDef = OP.bossByKey(bossKey)
          if (bossDef) {
            const roundNum = sim.roundIndex
            const firstBoss = bossDef.spawnsOnRound
            const interval = bossDef.tierInterval
            const elite = !!sim.rules.bossElite

            if (roundNum >= firstBoss && (roundNum - firstBoss) % interval === 0) {
              const tier = Math.min(
                Math.floor((roundNum - firstBoss) / interval) + 1,
                bossDef.maxTiers
              )
              // Only spawn if no boss is alive
              if (!sim.boss || !sim.boss.alive) {
                OP.Boss.spawn(sim, bossKey, tier, elite)
              }
            }
          }
        }
      }

      if (sim.autostart && !sim.over) OP.Rounds.next(sim)
    }

    trimQueues(sim)
  }

  // The FX queues are drained by the renderer. Headless there is no renderer, so
  // cap them — a hundred-round verification run would otherwise accumulate
  // hundreds of thousands of dead event objects.
  const QUEUE_CAP = 4096
  function trimQueues (sim) {
    if (sim.popEvents.length > QUEUE_CAP) sim.popEvents.splice(0, sim.popEvents.length - QUEUE_CAP)
    if (sim.leakEvents.length > QUEUE_CAP) sim.leakEvents.splice(0, sim.leakEvents.length - QUEUE_CAP)
    if (sim.blastEvents.length > QUEUE_CAP) sim.blastEvents.splice(0, sim.blastEvents.length - QUEUE_CAP)
    if (sim.events.length > QUEUE_CAP) sim.events.splice(0, sim.events.length - QUEUE_CAP)
  }

  /**
   * Advance by real elapsed time. Runs whole ticks only, and never more than
   * MAX_STEPS_PER_FRAME in one call — a backgrounded tab must not come back and
   * simulate thirty seconds in one frame.
   *
   * `sim.speed` multiplies how many ticks run, never the size of a tick.
   */
  Sim.advance = function (sim, wallDt) {
    if (OP.Coop && OP.Coop.advance && sim.coop && sim.coop.swapping) OP.Coop.advance(sim, wallDt)
    if (sim.paused || sim.over) return 0
    sim.accumulator += Math.min(wallDt, 0.25) * sim.speed
    let ran = 0
    while (sim.accumulator >= OP.DT && ran < OP.MAX_STEPS_PER_FRAME) {
      sim.accumulator -= OP.DT
      Sim.step(sim)
      ran++
    }
    // Discard any backlog beyond what we were willing to run, rather than
    // carrying it and stuttering for the next several frames.
    if (sim.accumulator > OP.DT * OP.MAX_STEPS_PER_FRAME) sim.accumulator = 0
    return ran
  }

  /** Fraction of a tick elapsed — the render interpolation alpha. */
  Sim.alpha = function (sim) { return OP.M.clamp01(sim.accumulator / OP.DT) }

  /* ---------- checksum ---------- */

  function mix (h, v) {
    h ^= v | 0
    h = Math.imul(h, 16777619)
    return h >>> 0
  }
  function mixFloat (h, v, scale) {
    return mix(h, Math.round(v * scale))
  }

  /**
   * A 32-bit fold over everything that can affect the future of the simulation.
   *
   * Iteration order is deterministic (all entity lists are ascending-by-id), so
   * this is an *ordered* fold — stricter than an order-insensitive one, and it
   * will catch an accidental reordering as well as a value change.
   *
   * The RNG state is included deliberately: two runs that reach the same board
   * by consuming different amounts of randomness are NOT the same state, and
   * would diverge on the next roll.
   */
  Sim.checksum = function (sim) {
    let h = 2166136261 >>> 0

    h = mix(h, sim.tick)
    h = mixFloat(h, sim.cash, 100)
    h = mix(h, sim.lives)
    h = mix(h, sim.roundIndex)
    h = mix(h, sim.over ? 1 : 0)
    h = mix(h, sim.freeplay ? 1 : 0)
    h = mix(h, sim.stats.popped)
    h = mix(h, sim.stats.leaked)
    h = mix(h, sim.stats.layersPopped)
    h = mix(h, sim.stats.shotsFired)

    h = mix(h, sim.rng.a); h = mix(h, sim.rng.b)
    h = mix(h, sim.rng.c); h = mix(h, sim.rng.d)
    h = mix(h, sim.rng.calls)

    for (let i = 0; i < sim.balloons.length; i++) {
      const b = sim.balloons[i]
      if (!b.alive) continue
      h = mix(h, b.id)
      h = mix(h, b.tier)
      h = mix(h, b.spawnTier)
      h = mix(h, b.hp)
      h = mix(h, b.path)
      h = mix(h, b.props)
      h = mixFloat(h, b.t, 100)
      h = mixFloat(h, b.speedMul, 1000)
      h = mixFloat(h, b.dotAcc || 0, 1000)
      h = mix(h, b.effects.length)
    }

    for (let i = 0; i < sim.projectiles.length; i++) {
      const p = sim.projectiles[i]
      if (!p.alive) continue
      h = mix(h, p.id)
      h = mixFloat(h, p.x, 10)
      h = mixFloat(h, p.y, 10)
      h = mix(h, p.pierce)
      h = mix(h, p.hits.size)
      h = mixFloat(h, p.life, 1000)
    }

    for (let i = 0; i < sim.towers.length; i++) {
      const tower = sim.towers[i]
      h = mix(h, tower.id)
      h = mix(h, tower.tiers[0] * 100 + tower.tiers[1] * 10 + tower.tiers[2])
      h = mixFloat(h, tower.cooldown, 1000)
      h = mixFloat(h, tower.abilityCd, 100)
      h = mix(h, tower.pops)
    }

    if (sim.round) {
      h = mix(h, sim.round.tick)
      h = mix(h, sim.round.released)
      for (let i = 0; i < sim.round.groups.length; i++) {
        h = mix(h, sim.round.groups[i].remaining)
        h = mix(h, sim.round.groups[i].nextTick)
      }
    }

    // Boss state
    if (sim.boss && sim.boss.alive) {
      h = mix(h, 0xB055)  // boss present marker
      h = mix(h, sim.boss.tier)
      h = mix(h, sim.boss.elite ? 1 : 0)
      h = mixFloat(h, sim.boss.hp, 10)
      h = mixFloat(h, sim.boss.t, 100)
      h = mix(h, sim.boss.minionWave)
      h = mix(h, sim.boss.abilityCd)
    }

    if (OP.POWER_ORDER && sim.powers) {
      for (let i = 0; i < OP.POWER_ORDER.length; i++) {
        h = mix(h, sim.powers[OP.POWER_ORDER[i]] || 0)
      }
    }

    if (sim.coop) {
      const coop = OP.Coop.serialize(sim)
      h = mix(h, coop.active)
      h = mixFloat(h, coop.players[0].cash, 100)
      h = mixFloat(h, coop.players[1].cash, 100)
    }

    return h >>> 0
  }

  /* ---------- serialisation ---------- */

  Sim.serialize = function (sim) {
    return {
      version: OP.VERSION,
      seed: sim.seed,
      difficulty: sim.difficulty,
      mode: sim.mode,
      mapKey: sim.map.key,
      roundSetKey: sim.roundSetKey,
      tick: sim.tick,
      time: sim.time,
      speed: sim.speed,
      rng: sim.rng.state(),
      rules: Object.assign({}, sim.rules),
      cash: sim.cash,
      lives: sim.lives,
      cashPerPopMul: sim.cashPerPopMul,
      roundIndex: sim.roundIndex,
      roundXpPool: sim.roundXpPool || 0,
      autostart: sim.autostart,
      freeplay: sim.freeplay,
      freeplayBaseline: sim.freeplayBaseline
        ? Object.assign({}, sim.freeplayBaseline)
        : null,
      over: sim.over,
      outcome: sim.outcome,
      nextEntityId: sim.nextEntityId,
      heroId: sim.heroId,
      // Map-level state the player paid for. The Tracks are rebuilt from the
      // definition, but which removable obstacles have been cleared is a purchase,
      // not derived geometry — without this a resumed run silently puts every
      // paid-for rock back and un-builds the towers' sight lines.
      cleared: sim.map && Array.isArray(sim.map.cleared) ? sim.map.cleared.slice() : [],
      stats: Object.assign({}, sim.stats),
      balloons: OP.Balloons.serialize(sim),
      projectiles: OP.Projectiles.serialize(sim),
      towers: OP.Towers.serialize(sim),
      boss: OP.Boss ? OP.Boss.serialize(sim) : null,
      round: OP.Rounds.serialize(sim),
      knowledge: sim.knowledge || [],
      powers: OP.Powers ? OP.Powers.copyInventory(sim.powers) : {},
      coop: OP.Coop ? OP.Coop.serialize(sim) : null
    }
  }

  /**
   * Rebuild a sim from a snapshot. `map` must be supplied by the caller, because
   * a Track is derived data and is rebuilt from the map definition rather than
   * stored — storing 300 interpolated polyline points per path would bloat the
   * save and pin it to one version of the smoothing code.
   */
  Sim.deserialize = function (snap, map, opts) {
    if (!map) throw new Error('Sim.deserialize needs the map for this save')
    opts = opts || {}

    const sim = Sim.create({
      map: map,
      seed: snap.seed,
      difficulty: snap.difficulty,
      mode: snap.mode,
      rules: snap.rules,
      autostart: snap.autostart,
      roundSetKey: snap.roundSetKey,
      roundSet: opts.roundSet || null,
      knowledge: snap.knowledge || [],
      powers: snap.powers || {}
    })
    // Only insist on a round set if this save is actually part-way through a
    // game. A snapshot taken before any round started has nothing to resume, and
    // demanding a table for it would make tower-level round-trip tests
    // impossible for no benefit.
    const midGame = !!snap.round || snap.roundIndex >= ((snap.rules && snap.rules.firstRound) || 1)
    if (!sim.roundSet && midGame) {
      throw new Error('Sim.deserialize: no round set for key "' + snap.roundSetKey +
        '" — register it in OP.ROUND_SETS or pass opts.roundSet')
    }

    sim.tick = snap.tick
    sim.time = snap.time
    sim.speed = snap.speed
    sim.rng = OP.RNG.fromState(snap.rng)
    sim.cash = snap.cash
    sim.lives = snap.lives
    sim.cashPerPopMul = snap.cashPerPopMul
    sim.roundIndex = snap.roundIndex
    sim.roundXpPool = snap.roundXpPool || 0
    sim.freeplay = !!snap.freeplay
    sim.freeplayBaseline = snap.freeplayBaseline
      ? Object.assign({}, snap.freeplayBaseline)
      : null
    sim.over = snap.over
    sim.outcome = snap.outcome
    sim.heroId = snap.heroId === undefined ? -1 : snap.heroId
    sim.stats = Object.assign(sim.stats, snap.stats)

    // Cleared obstacles, before towers: this is what re-filters the map's LOS
    // blocker list, and a tower's first acquire must see the same sight lines the
    // save was taken with. Absent on snapshots from before the field existed, so
    // the guard keeps those loading.
    if (Array.isArray(snap.cleared) && OP.Maps && OP.Maps.restoreCleared) {
      OP.Maps.restoreCleared(sim, snap.cleared)
    }

    // Towers first: buff rebuilding and stat resolution depend on them, and
    // balloons must be able to look up a tower id for pop attribution.
    OP.Towers.deserialize(sim, snap.towers || [])
    OP.Balloons.deserialize(sim, snap.balloons || [])
    OP.Projectiles.deserialize(sim, snap.projectiles || [])
    if (OP.Boss) OP.Boss.deserialize(sim, snap.boss || null)
    OP.Rounds.deserialize(sim, snap.round)

    // nextEntityId last, because the deserialisers do not allocate ids but
    // Sim.create reset it.
    sim.nextEntityId = Math.max(snap.nextEntityId || 1, sim.nextEntityId)

    OP.Grid.rebuild(sim.grid, sim.balloons)

    // Restore coop state if present in the snapshot
    if (snap.coop && sim.coop && OP.Coop) OP.Coop.restore(sim, snap.coop)

    return sim
  }

  /* ---------- helpers for the shell and the harness ---------- */

  Sim.canEnterFreeplay = function (sim) {
    return !!(sim && sim.over && sim.outcome === 'won' && !sim.freeplay)
  }

  Sim.enterFreeplay = function (sim) {
    if (!Sim.canEnterFreeplay(sim)) return false
    sim.freeplayBaseline = {
      round: sim.roundIndex,
      roundsCleared: sim.stats.roundsCleared,
      pops: sim.stats.popped,
      cash: sim.stats.cashEarned
    }
    sim.freeplay = true
    sim.over = false
    sim.outcome = null
    return true
  }

  Sim.startRound = function (sim, index) {
    return OP.Rounds.begin(sim, index === undefined ? sim.roundIndex + 1 : index)
  }

  Sim.setSpeed = function (sim, speed) {
    sim.speed = OP.M.clamp(Math.round(speed), 1, 3)
    return sim.speed
  }

  Sim.togglePause = function (sim) { sim.paused = !sim.paused; return sim.paused }

  /** Run n ticks flat out, ignoring wall time. Used by the harness. */
  Sim.run = function (sim, ticks) {
    for (let i = 0; i < ticks && !sim.over; i++) Sim.step(sim)
    return sim.tick
  }

  /**
   * Run until the current round completes, or until `maxTicks` elapses.
   * Returns { completed, ticks, leaked }.
   */
  Sim.runRound = function (sim, maxTicks) {
    maxTicks = maxTicks || 60 * 600
    const leakedBefore = sim.stats.leaked
    let ran = 0
    while (ran < maxTicks && !sim.over && sim.round && !sim.round.done) {
      Sim.step(sim)
      ran++
    }
    return {
      completed: !!(sim.round && sim.round.done),
      ticks: ran,
      leaked: sim.stats.leaked - leakedBefore
    }
  }

  /** Total live RBE — the one number that says whether the board is winning. */
  Sim.pressure = function (sim) { return OP.Balloons.totalRBE(sim) }

  OP.Sim = Sim
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

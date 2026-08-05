// Shared test fixtures.
//
// Prefers the real OP.Sim.create once it exists, and falls back to a hand-built
// stub before then. That means suites written during P1.3 keep working unchanged
// after P1.7 lands — and if the stub and the real sim ever disagree about which
// fields exist, the suites that use them fail, which is the point.

/** A simple left-to-right track of the given length. */
export function straightTrack (OP, length = 1000, y = 360) {
  return new OP.Track([{ x: 0, y }, { x: length, y }])
}

/** A track with a corner, for heading and multi-segment coverage. */
export function cornerTrack (OP, leg = 500) {
  return new OP.Track([{ x: 0, y: 100 }, { x: leg, y: 100 }, { x: leg, y: 100 + leg }])
}

/**
 * A sim usable by the core suites.
 * @param {object} OP
 * @param {{tracks?:Array, seed?:*, cash?:number, lives?:number, grid?:boolean}} [opts]
 */
export function makeSim (OP, opts = {}) {
  const tracks = opts.tracks || [straightTrack(OP, opts.trackLength || 1000)]

  if (OP.Sim && typeof OP.Sim.create === 'function' && !opts.forceStub) {
    const sim = OP.Sim.create({
      map: { key: 'test', paths: tracks, placement: null },
      seed: opts.seed === undefined ? 'test' : opts.seed,
      cash: opts.cash === undefined ? 10000 : opts.cash,
      lives: opts.lives === undefined ? 150 : opts.lives,
      difficulty: opts.difficulty || 'medium',
      mode: opts.mode || 'standard'
    })
    return sim
  }

  const sim = {
    tick: 0,
    time: 0,
    rng: new OP.RNG(opts.seed === undefined ? 'test' : opts.seed),
    map: { key: 'test', paths: tracks, placement: null },
    balloons: [],
    balloonPool: [],
    byId: new Map(),
    projectiles: [],
    projPool: [],
    towers: [],
    towerById: new Map(),
    nextEntityId: 1,
    cash: opts.cash === undefined ? 10000 : opts.cash,
    lives: opts.lives === undefined ? 150 : opts.lives,
    speedScale: 1,
    cashPerPopMul: 1,
    over: false,
    leakEvents: [],
    popEvents: [],
    stats: { spawned: 0, popped: 0, leaked: 0, regrown: 0, cashEarned: 0, layersPopped: 0, shotsFired: 0 },
    grid: opts.grid === false ? null : OP.Grid.create(OP.FIELD_W, OP.FIELD_H),
    _stub: true
  }
  return sim
}

/** Spawn one balloon and return it. */
export function spawn (OP, sim, tier, t = 0, props = 0) {
  return OP.Balloons.spawn(sim, { tier, path: 0, t, props })
}

/** Apply a single hit and return the resolution result. */
export function hit (OP, sim, balloon, damage, dmgType, extra = {}) {
  return OP.Damage.hit(sim, balloon, Object.assign({
    damage,
    dmgType: dmgType || OP.DMG.NORMAL,
    sourceId: -1
  }, extra))
}

/** Run n sim ticks using whatever systems currently exist. */
export function ticks (OP, sim, n) {
  for (let i = 0; i < n; i++) {
    if (OP.Sim && typeof OP.Sim.step === 'function' && !sim._stub) OP.Sim.step(sim)
    else stubStep(OP, sim)
  }
  return sim
}

// Mirrors the documented update order (ARCHITECTURE.md §7) with only the
// subsystems that exist so far.
function stubStep (OP, sim) {
  sim.tick++
  sim.time += OP.DT
  if (OP.Balloons) OP.Balloons.move(sim)
  if (OP.Balloons) OP.Balloons.leakCheck(sim)
  if (OP.Effects) OP.Effects.tick(sim)
  if (OP.Balloons) OP.Balloons.regenTick(sim)
  if (OP.Grid && sim.grid) OP.Grid.rebuild(sim.grid, sim.balloons)
  if (OP.Balloons) OP.Balloons.compact(sim)
}

/** Count live balloons by tier key. */
export function census (OP, sim) {
  const out = {}
  for (const b of sim.balloons) {
    if (!b.alive) continue
    const k = OP.BALLOON_TIERS[b.tier].key
    out[k] = (out[k] || 0) + 1
  }
  return out
}

/** Total live RBE — the single number that says whether the board is winning. */
export function rbe (OP, sim) {
  return OP.Balloons.totalRBE(sim)
}

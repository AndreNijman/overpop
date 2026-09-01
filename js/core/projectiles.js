;(function (OP) {
  'use strict'

  const M = OP.M

  /* Projectiles.

     Three rules do most of the work here, and all three are the kind of thing
     that looks fine and is quietly wrong (ARCHITECTURE.md §4):

     1. A projectile never hits the same balloon twice. Each carries a `hits` set.
        Without it every tower silently does double damage, and nothing surfaces
        the bug except profiling damage totals.

     2. Pierce counts DISTINCT balloons, not collision events.

     3. Collision is swept, not sampled. At round 80+ a balloon covers more than
        its own diameter per tick, so a point-in-circle test at the new position
        lets it phase through a tower's fire.

     Two projectile shapes, distinguished by blastRadius:
       blastRadius === 0  a piercing shot — hits up to `pierce` distinct balloons
                          along its path over its whole life
       blastRadius > 0    a bomb — explodes on first contact (or on expiry if
                          blastOnExpiry), damaging up to `pierce` balloons in the
                          radius, then dies

     Everything is pooled and every field is primitive, so the live set
     serialises. Behaviour hooks are STRING KEYS into OP.PROJ_BEHAVIOURS, never
     function references — a closure in entity state would make the sim
     unserialisable and break mid-round save. */

  const Projectiles = {}

  // Largest balloon hull, so a swept query never misses a blimp it clips.
  let MAX_HULL = 0

  function blank () {
    return {
      id: 0, alive: false,
      x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0,
      originX: 0, originY: 0,
      kind: 'dart',
      damage: 1, dmgType: 'sharp', pierce: 1, radius: 4,
      life: 1, age: 0, maxRange: 0, travelled: 0,
      ownerId: -1,
      camoDetect: false,
      ignoreImmunity: false,
      instaKill: false,
      effects: null,
      blastRadius: 0, blastOnExpiry: false, blastFalloff: 0,
      homing: 0, turnRate: 0, targetId: -1,
      gravity: 0,
      behaviour: '',
      hits: new Set(),
      data: null
    }
  }

  Projectiles.reset = function (sim) {
    sim.projectiles = []
    sim.projPool = []
    if (!MAX_HULL) {
      for (let i = 0; i < OP.BALLOON_TIERS.length; i++) {
        if (OP.BALLOON_TIERS[i].radius > MAX_HULL) MAX_HULL = OP.BALLOON_TIERS[i].radius
      }
    }
  }

  /**
   * Fire a projectile. See the field list in ARCHITECTURE.md §4.
   * Returns the projectile, or null if the pool ceiling is reached.
   */
  Projectiles.spawn = function (sim, def) {
    if (sim.projectiles.length >= OP.MAX_PROJECTILES) return null

    const p = sim.projPool.pop() || blank()
    p.id = sim.nextEntityId++
    p.alive = true
    p.x = def.x; p.y = def.y
    p.prevX = def.x; p.prevY = def.y
    p.originX = def.x; p.originY = def.y
    p.vx = def.vx || 0; p.vy = def.vy || 0
    p.kind = def.kind || 'dart'
    p.damage = def.damage === undefined ? 1 : def.damage
    p.dmgType = def.dmgType || OP.DMG.SHARP
    p.pierce = def.pierce === undefined ? 1 : def.pierce
    p.radius = def.radius === undefined ? 4 : def.radius
    p.life = def.life === undefined ? 1 : def.life
    p.age = 0
    p.maxRange = def.maxRange || 0
    p.travelled = 0
    p.ownerId = def.ownerId === undefined ? -1 : def.ownerId
    p.camoDetect = !!def.camoDetect
    p.ignoreImmunity = !!def.ignoreImmunity
    p.instaKill = !!def.instaKill
    p.effects = def.effects || null
    p.blastRadius = def.blastRadius || 0
    p.blastOnExpiry = !!def.blastOnExpiry
    p.blastFalloff = def.blastFalloff || 0
    p.homing = def.homing || 0
    p.turnRate = def.turnRate || 0
    p.targetId = def.targetId === undefined ? -1 : def.targetId
    p.gravity = def.gravity || 0
    p.behaviour = def.behaviour || ''
    p.data = def.data ? Object.assign({}, def.data) : null
    p.hits.clear()

    sim.projectiles.push(p)
    sim.stats.shotsFired++
    // Record every kind actually emitted, so a playthrough can be checked against
    // the declared registry rather than trusting that the two lists agree.
    if (sim.kindsSeen) sim.kindsSeen[p.kind] = (sim.kindsSeen[p.kind] || 0) + 1
    return p
  }

  /** Convenience: aim at a speed and angle rather than a velocity vector. */
  Projectiles.fireAt = function (sim, def, angle, speed) {
    def.vx = Math.cos(angle) * speed
    def.vy = Math.sin(angle) * speed
    return Projectiles.spawn(sim, def)
  }

  Projectiles.kill = function (sim, p) { p.alive = false }

  /* ---------- the step ---------- */

  /**
   * Steps 9 and 10 of the update order: move every projectile, resolve swept
   * collisions in nearest-first order, cascade damage, and let a piercing shot
   * spend remaining pierce on the children it just created.
   *
   * Projectiles are processed in ascending id order and candidates arrive
   * id-sorted from the grid, so the whole pass is deterministic.
   */
  Projectiles.step = function (sim) {
    const list = sim.projectiles
    const dt = OP.DT
    const cand = sim._projCand || (sim._projCand = [])
    const order = sim._projOrder || (sim._projOrder = [])

    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!p.alive) continue

      const behaviour = p.behaviour ? OP.PROJ_BEHAVIOURS[p.behaviour] : null

      p.age += dt
      if (behaviour && behaviour.onStep) behaviour.onStep(sim, p, dt)

      // Homing: steer toward a live target, if it is still alive.
      if (p.homing > 0 && p.targetId >= 0) {
        const target = sim.byId.get(p.targetId)
        if (target && target.alive) {
          const want = M.angleTo(p.x, p.y, target.x, target.y)
          const have = Math.atan2(p.vy, p.vx)
          const speed = Math.hypot(p.vx, p.vy)
          const next = M.rotateToward(have, want, (p.turnRate || p.homing) * dt)
          p.vx = Math.cos(next) * speed
          p.vy = Math.sin(next) * speed
        } else {
          p.targetId = -1
        }
      }

      if (p.gravity) p.vy += p.gravity * dt

      p.prevX = p.x; p.prevY = p.y
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.travelled += Math.hypot(p.x - p.prevX, p.y - p.prevY)

      // Expiry by lifetime, by range, or by leaving the field with a wide margin.
      p.life -= dt
      const expired = p.life <= 0 ||
        (p.maxRange > 0 && p.travelled >= p.maxRange) ||
        p.x < -200 || p.x > OP.FIELD_W + 200 || p.y < -200 || p.y > OP.FIELD_H + 200

      if (expired) {
        if (p.blastRadius > 0 && p.blastOnExpiry) explode(sim, p, p.x, p.y)
        if (behaviour && behaviour.onExpire) behaviour.onExpire(sim, p)
        p.alive = false
        continue
      }

      // --- swept collision ---
      const pad = p.radius + MAX_HULL
      OP.Grid.querySegment(sim.grid, p.prevX, p.prevY, p.x, p.y, pad, cand)
      if (!cand.length) continue

      // Resolve nearest-first: a piercing shot should hit what it reaches first.
      order.length = 0
      for (let c = 0; c < cand.length; c++) {
        const b = cand[c]
        if (!b.alive) continue
        if (p.hits.has(b.id)) continue
        if ((b.props & OP.PROP.VEILED) && !p.camoDetect) continue
        const hull = OP.BALLOON_TIERS[b.tier].radius
        const tHit = M.sweepCircle(p.prevX, p.prevY, p.x, p.y, b.x, b.y, p.radius + hull)
        if (tHit < 0) continue
        order.push({ t: tHit, b: b })
      }
      if (!order.length) continue
      if (order.length > 1) order.sort(byT)

      if (p.blastRadius > 0) {
        // A bomb: detonate at the first contact point and stop there.
        const first = order[0]
        const hx = p.prevX + (p.x - p.prevX) * first.t
        const hy = p.prevY + (p.y - p.prevY) * first.t
        explode(sim, p, hx, hy)
        if (behaviour && behaviour.onHit) behaviour.onHit(sim, p, first.b, null)
        p.alive = false
        continue
      }

      // A piercing shot: spend pierce down the nearest-first list, and then on
      // the children any of those pops creates. Same projectile, one pierce per
      // distinct balloon — the whole reason pierce is a meaningful stat.
      //
      // Children are appended to the end of the work list rather than re-sorted
      // in: they sit at their parent's position anyway, and appending keeps the
      // pass a single forward scan with no re-processing.
      const work = sim._projWork || (sim._projWork = [])
      work.length = 0
      for (let k = 0; k < order.length; k++) work.push(order[k].b)

      for (let qi = 0; qi < work.length && p.pierce > 0; qi++) {
        const b = work[qi]
        if (!b.alive || p.hits.has(b.id)) continue

        p.hits.add(b.id)
        p.pierce--
        sim.stats.projHits = (sim.stats.projHits || 0) + 1

        const res = OP.Damage.hit(sim, b, {
          damage: p.damage,
          dmgType: p.dmgType,
          sourceId: p.ownerId,
          effects: p.effects,
          ignoreImmunity: p.ignoreImmunity,
          instaKill: p.instaKill
        })

        if (behaviour && behaviour.onHit) behaviour.onHit(sim, p, b, res)

        // Children are already in the grid, so this same sweep can reach them.
        if (res.spawned.length && p.pierce > 0 && work.length < 512) {
          for (let s = 0; s < res.spawned.length; s++) {
            const child = sim.byId.get(res.spawned[s])
            if (!child || !child.alive || p.hits.has(child.id)) continue
            if ((child.props & OP.PROP.VEILED) && !p.camoDetect) continue
            const hull = OP.BALLOON_TIERS[child.tier].radius
            if (M.sweepCircle(p.prevX, p.prevY, p.x, p.y, child.x, child.y, p.radius + hull) < 0) continue
            work.push(child)
          }
        }
      }

      if (p.pierce <= 0) p.alive = false

      // Boss collision check — after balloon collisions
      if (p.alive) bossHitCheck(sim, p)
    }
  }

  /* ---------- boss collision ---------- */

  /**
   * After balloon collision, check if the projectile also hits the boss.
   * The boss is a single entity not in the spatial grid, so this is a direct
   * distance check — O(1) per projectile. Boss collision uses a unique hit id
   * (bossHit marker) so a projectile can hit the boss once per flight.
   */
  function bossHitCheck (sim, p) {
    if (!p.alive || !OP.Boss) return
    const boss = sim.boss
    if (!boss || !boss.alive) return

    // Boss hit marker: use negative boss tier as unique id in the hits set
    const bossMarker = -(boss.tier * 1000 + 999)
    if (p.hits.has(bossMarker)) return

    // Distance check
    const dx = p.x - boss.x
    const dy = p.y - boss.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const hitDist = p.radius + boss.radius

    if (dist >= hitDist) return

    p.hits.add(bossMarker)
    p.pierce--
    sim.stats.projHits = (sim.stats.projHits || 0) + 1

    OP.Boss.damage(sim, {
      damage: p.damage,
      dmgType: p.dmgType,
      sourceId: p.ownerId,
      effects: p.effects,
      ignoreImmunity: p.ignoreImmunity,
      instaKill: p.instaKill
    })

    if (p.pierce <= 0) p.alive = false
  }

  function byT (a, b) {
    if (a.t !== b.t) return a.t - b.t
    return a.b.id - b.b.id   // stable tiebreak, never iteration order
  }

  function explode (sim, p, x, y) {
    const r = OP.Damage.blast(sim, x, y, p.blastRadius, {
      damage: p.damage,
      dmgType: p.dmgType,
      sourceId: p.ownerId,
      effects: p.effects,
      ignoreImmunity: p.ignoreImmunity,
      instaKill: p.instaKill
    }, {
      camoDetect: p.camoDetect,
      falloff: p.blastFalloff,
      maxTargets: p.pierce,
      exclude: p.hits
    })
    sim.blastEvents.push({ x: x, y: y, radius: p.blastRadius, kind: p.kind, hits: r.hits })
    return r
  }
  Projectiles.explode = explode

  /** Step 12: recycle. */
  Projectiles.compact = function (sim) {
    const list = sim.projectiles
    let w = 0
    for (let r = 0; r < list.length; r++) {
      const p = list[r]
      if (p.alive) { list[w++] = p; continue }
      p.hits.clear()
      p.effects = null
      p.data = null
      sim.projPool.push(p)
    }
    list.length = w
  }

  Projectiles.count = function (sim) { return sim.projectiles.length }

  /* ---------- serialisation ---------- */

  const FIELDS = ['id', 'x', 'y', 'prevX', 'prevY', 'vx', 'vy', 'originX', 'originY', 'kind',
    'damage', 'dmgType', 'pierce', 'radius', 'life', 'age', 'maxRange', 'travelled',
    'ownerId', 'camoDetect', 'ignoreImmunity', 'instaKill', 'blastRadius', 'blastOnExpiry',
    'blastFalloff', 'homing', 'turnRate', 'targetId', 'gravity', 'behaviour']

  Projectiles.serialize = function (sim) {
    const out = []
    for (let i = 0; i < sim.projectiles.length; i++) {
      const p = sim.projectiles[i]
      if (!p.alive) continue
      const o = {}
      for (let f = 0; f < FIELDS.length; f++) o[FIELDS[f]] = p[FIELDS[f]]
      o.hits = Array.from(p.hits)
      o.effects = p.effects ? p.effects.map(OP.Effects.serialize) : null
      o.data = p.data ? Object.assign({}, p.data) : null
      out.push(o)
    }
    return out
  }

  Projectiles.deserialize = function (sim, arr) {
    Projectiles.reset(sim)
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i]
      const p = sim.projPool.pop() || blank()
      for (let f = 0; f < FIELDS.length; f++) p[FIELDS[f]] = s[FIELDS[f]]
      p.alive = true
      p.hits.clear()
      for (let h = 0; h < s.hits.length; h++) p.hits.add(s.hits[h])
      p.effects = s.effects ? s.effects.map(OP.Effects.deserialize) : null
      p.data = s.data ? Object.assign({}, s.data) : null
      sim.projectiles.push(p)
    }
    sim.projectiles.sort(function (a, b) { return a.id - b.id })
  }

  OP.Projectiles = Projectiles
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

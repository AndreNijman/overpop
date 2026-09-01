;(function (OP) {
  'use strict'

/* MILITARY — reach and utility rather than raw local damage.
 *
 * The family thesis: where you put a Primary tower decides most of what it is
 * worth, and these deliberately weaken that link. The Longshot Lynx does not
 * care where it sits, the Diver Otter and the Corsair Beaver take water that
 * nothing else can use, the Biplane Magpie and the Rotor Kestrel do not sit
 * still at all, the Howitzer Mole shoots at a point the player picks
 * instead of at a balloon, the Gatling Raccoon spins up, and the Brood Mother
 * Moth seeds the track with eggs that hatch into temporary hunters.
   *
   * Conventions this file follows (ARCHITECTURE.md §6):
   *   - every stat an upgrade touches exists in `base` with a default, so
   *     `s.foo += 1` can never produce NaN and every `apply` is idempotent;
   *   - nothing is stored on `tower` by an `apply`; per-tower mutable state
   *     lives in `tower.data` and is written only by update()/fire();
   *   - abilities and projectile behaviours are string keys, never closures;
   *   - the only randomness is sim.rng.
   */

  const M = OP.M
  const D = OP.DMG

  /* ---------- shared helpers, exposed for the UI and the suite ---------- */

  const Military = {}

  /**
   * Shove a balloon BACKWARDS along its own track.
   *
   * The one supported way to reduce `balloon.t`. Two rules live here rather than
   * at every call site, because getting either wrong is invisible until a replay
   * desyncs or a balloon teleports:
   *
   *   1. `t` is clamped at 0 — the track entry. A negative `t` would clamp
   *      inside Track.posInto anyway, but the balloon's own `t` would keep
   *      drifting negative and it would then need seconds of "travel" before it
   *      appeared to move at all.
   *   2. Blimps are immune to knockback (ARCHITECTURE.md §2), so this is a
   *      no-op on them and reports the 0 it actually moved.
   *
   * x/y are re-synced immediately: projectiles later in the same tick collide
   * against x/y, not against t.
   *
   * @returns {number} distance actually moved backwards, in units
   */
  Military.shove = function (sim, b, distance) {
    if (!b || !b.alive || !(distance > 0)) return 0
    if (OP.BALLOON_TIERS[b.tier].blimp) return 0
    const before = b.t
    b.t = Math.max(0, b.t - distance)
    const moved = before - b.t
    if (moved > 0) sim.map.paths[b.path].posInto(b.t, b)
    return moved
  }

  /**
   * Point a fixed-aim tower (the Howitzer Mole) at a map position.
   * Clamped into the tower's own range and onto the field, so the UI can pass a
   * raw cursor position and get a legal aim point back.
   */
  Military.setAimPoint = function (sim, tower, x, y) {
    const range = tower.s ? tower.s.range : tower.def.base.range
    const d = M.dist(tower.x, tower.y, x, y)
    if (d > range) {
      const a = M.angleTo(tower.x, tower.y, x, y)
      x = tower.x + Math.cos(a) * range
      y = tower.y + Math.sin(a) * range
    }
    tower.data.aimX = M.clamp(x, 4, OP.FIELD_W - 4)
    tower.data.aimY = M.clamp(y, 4, OP.FIELD_H - 4)
    return tower.data
  }

  /**
   * The default aim point: the nearest spot on any track that is inside range.
   * A freshly placed mortar should already be shelling something useful.
   */
  Military.defaultAimPoint = function (sim, tower) {
    const paths = sim.map.paths
    let best = null
    for (let i = 0; i < paths.length; i++) {
      const near = paths[i].nearest(tower.x, tower.y)
      if (!best || near.dist < best.dist) best = near
    }
    if (!best) return Military.setAimPoint(sim, tower, tower.x, tower.y)
    return Military.setAimPoint(sim, tower, best.x, best.y)
  }

  /** Lazily ensure an aim point exists — a save restore does not call onPlace. */
  function ensureAim (sim, tower) {
    if (tower.data.aimX === undefined) Military.defaultAimPoint(sim, tower)
    return tower.data
  }

  /**
   * The balloon closest to leaking anywhere on the map, honouring this tower's
   * camo detection. Used by the Rotor Kestrel to decide what to chase — it is a
   * movement decision, not target acquisition, so it deliberately ignores range.
   */
  Military.leakLeader = function (sim, tower) {
    const detects = tower.s.camoDetect
    let best = null
    let bestRem = Infinity
    for (let i = 0; i < sim.balloons.length; i++) {
      const b = sim.balloons[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !detects) continue
      const rem = sim.map.paths[b.path].length - b.t
      if (rem < bestRem || (rem === bestRem && best && b.id < best.id)) { bestRem = rem; best = b }
    }
    return best
  }

  OP.Military = Military

  /* ---------- scratch, reused to keep the hot loop allocation-free ----------
     Module-level and never stored on an entity, so nothing here can leak into a
     save file. Separate arrays per call site so a nested call cannot stomp an
     outer one. */

  const IDS = []
  const IDS2 = []
  const SCAN = []
  const AIM = { x: 0, y: 0 }

  function isBlimp (b) { return !!OP.BALLOON_TIERS[b.tier].blimp }

  /** Damage one shot should carry, including any anti-blimp bonus. */
  function shotDamage (s, target) {
    return target && isBlimp(target) ? s.damage + s.blimpBonus : s.damage
  }

  /** Status effects a shot carries, or null. Rebuilt per shot; small and flat. */
  function shotEffects (s, ownerId) {
    let out = null
    if (s.burnDps > 0) (out = out || []).push(OP.Effects.make('burn', s.burnTime, s.burnDps, ownerId, D.FIRE))
    if (s.acidDps > 0) (out = out || []).push(OP.Effects.make('acid', s.acidTime, s.acidDps, ownerId, D.ACID))
    if (s.brittleMag > 0) (out = out || []).push(OP.Effects.make('brittle', s.brittleTime, s.brittleMag, ownerId, D.NORMAL))
    if (s.glueMag > 0) (out = out || []).push(OP.Effects.make('glue', s.glueTime, s.glueMag, ownerId, D.NORMAL))
    return out
  }

  /** Symmetric offset for shot `i` of `n` across `spread` radians. */
  function fanOffset (i, n, spread) {
    return n === 1 ? 0 : spread * (i / (n - 1) - 0.5)
  }

  /** The path this tower sits closest to, plus the nearest point on it. */
  function nearestPath (sim, x, y) {
    const paths = sim.map.paths
    let bestTrack = null
    let best = null
    for (let i = 0; i < paths.length; i++) {
      const near = paths[i].nearest(x, y)
      if (!best || near.dist < best.dist) { best = near; bestTrack = paths[i] }
    }
    return bestTrack ? { track: bestTrack, near: best } : null
  }

  /* ---------- projectile art kinds ---------- */

  OP.declareProjKind('mil-round', { shape: 'dart', tint: '#d8dee8', size: 3, trail: true })
  OP.declareProjKind('mil-slug', { shape: 'spike', tint: '#e8d67d', size: 5, trail: true })
  OP.declareProjKind('mil-spear', { shape: 'dart', tint: '#9fd8e8', size: 4 })
  OP.declareProjKind('mil-harpoon', { shape: 'spike', tint: '#6fa8c8', size: 6, trail: true })
  OP.declareProjKind('mil-ball', { shape: 'ball', tint: '#4a4f57', size: 5, spin: true })
  OP.declareProjKind('mil-shell', { shape: 'shell', tint: '#8e8a6a', size: 6, trail: true })
  OP.declareProjKind('mil-skiff', { shape: 'boat', tint: '#a9834f', size: 7, spin: true })
  OP.declareProjKind('mil-tracer', { shape: 'dart', tint: '#f2e9a0', size: 3, trail: true })
  OP.declareProjKind('mil-bomb', { shape: 'ball', tint: '#3c3a34', size: 5 })
  OP.declareProjKind('mil-rocket', { shape: 'rocket', tint: '#e08a3c', size: 5, trail: true })
  OP.declareProjKind('mil-wash', { shape: 'ring', tint: '#bcd8e8', size: 8 })
  OP.declareProjKind('mil-plasma', { shape: 'orb', tint: '#b678e8', size: 4, trail: true })
  OP.declareProjKind('mil-lance', { shape: 'beam', tint: '#7de8c6', size: 7, trail: true })

  // Brood Mother Moth: eggs and hatchlings
  OP.declareProjKind('moth-egg', { shape: 'blob', tint: '#c8b878', size: 4 })
  OP.declareProjKind('moth-hatchling', { shape: 'dart', tint: '#e0c870', size: 4, trail: true, spin: true })
  OP.declareProjKind('moth-swarm', { shape: 'orb', tint: '#f0d860', size: 3, trail: true })

  /* ---------- projectile behaviours ---------- */

  /* A drifting attacker launched by the Corsair Beaver. It wanders on a fixed
     turn rate picked once at launch, so its whole future is one number in
     `data` and the sim stays serialisable. */
  OP.PROJ_BEHAVIOURS['mil-skiff'] = {
    onStep: function (sim, p, dt) {
      if (!p.data || !p.data.turn) return
      const speed = Math.hypot(p.vx, p.vy)
      const a = Math.atan2(p.vy, p.vx) + p.data.turn * dt
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed
    }
  }

  /* The Rotor Kestrel's rotor wash: every hit shoves the balloon back down the
     track. Blimps are unmoved — that is enforced inside Military.shove. */
  OP.PROJ_BEHAVIOURS['mil-downwash'] = {
    onHit: function (sim, p, balloon, res) {
      if (!p.data || !(p.data.shove > 0)) return
      Military.shove(sim, balloon, p.data.shove)
    }
  }

  /* ---------- abilities ---------- */

  OP.ABILITIES['mil-called-shot'] = function (sim, tower) {
    const s = tower.s
    OP.Targeting.acquireMany(sim, tower, 'strong', 6, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y, kind: 'mil-slug',
        damage: s.damage * 6, dmgType: D.SHATTER, pierce: s.pierce + 4,
        radius: s.projRadius + 2, life: 3, ownerId: tower.id,
        camoDetect: s.camoDetect, homing: 12, turnRate: 12, targetId: b.id
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
  }

  OP.ABILITIES['mil-sonar-bloom'] = function (sim, tower) {
    const s = tower.s
    OP.Grid.queryCircle(sim.grid, tower.x, tower.y, s.range * 1.6, SCAN)
    for (let i = 0; i < SCAN.length; i++) {
      const b = SCAN[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !s.camoDetect) continue
      OP.Effects.apply(b, OP.Effects.make('brittle', 8, 0.6, tower.id, D.NORMAL))
      OP.Effects.apply(b, OP.Effects.make('glue', 4, 0.35, tower.id, D.NORMAL))
    }
  }

  OP.ABILITIES['mil-harpoon-volley'] = function (sim, tower) {
    const s = tower.s
    OP.Targeting.acquireMany(sim, tower, 'strong', 8, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y, kind: 'mil-harpoon',
        damage: (s.damage + s.blimpBonus) * 2, dmgType: s.dmgType, pierce: s.pierce,
        radius: s.projRadius + 2, life: 3, ownerId: tower.id,
        camoDetect: s.camoDetect, homing: 10, turnRate: 10, targetId: b.id
      }, M.angleTo(tower.x, tower.y, b.x, b.y), s.projSpeed)
    }
  }

  OP.ABILITIES['mil-broadside'] = function (sim, tower) {
    const s = tower.s
    const n = Math.max(8, s.shots * 2)
    for (let i = 0; i < n; i++) {
      OP.Projectiles.fireAt(sim, {
        x: tower.x, y: tower.y, kind: 'mil-ball',
        damage: s.damage * 2, dmgType: s.dmgType, pierce: s.pierce + 2,
        radius: s.projRadius + 1, life: s.projLife * 1.5,
        blastRadius: s.blastRadius, blastOnExpiry: false,
        ownerId: tower.id, camoDetect: s.camoDetect,
        effects: shotEffects(s, tower.id)
      }, M.TAU * (i / n), s.projSpeed)
    }
  }

  OP.ABILITIES['mil-bombardment'] = function (sim, tower) {
    const s = tower.s
    OP.Targeting.acquireMany(sim, tower, 'strong', 10, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      lobShell(sim, tower, b.x + sim.rng.range(-18, 18), b.y + sim.rng.range(-18, 18),
        s.damage * 2, Math.max(30, s.blastRadius) * 1.2, 'mil-shell')
    }
  }

  OP.ABILITIES['mil-bombing-run'] = function (sim, tower) {
    const s = tower.s
    const head = tower.data.heading || 0
    for (let i = 0; i < 10; i++) {
      const d = 26 * i
      dropBomb(sim, tower, tower.x + Math.cos(head) * d, tower.y + Math.sin(head) * d,
        s.bombDamage * 2, Math.max(30, s.bombBlast) * 1.15)
    }
  }

  OP.ABILITIES['mil-hunter-salvo'] = function (sim, tower) {
    const s = tower.s
    OP.Targeting.acquireMany(sim, tower, 'strong', 8, IDS)
    for (let i = 0; i < IDS.length; i++) {
      const b = sim.byId.get(IDS[i])
      if (!b || !b.alive) continue
      fireRocket(sim, tower, b, s.rocketDamage * 2 + s.blimpBonus, Math.max(24, s.rocketBlast))
    }
  }

  OP.ABILITIES['mil-downdraft'] = function (sim, tower) {
    // The whole board, not just its range: this is the Kestrel's one global play.
    for (let i = 0; i < sim.balloons.length; i++) Military.shove(sim, sim.balloons[i], 150)
  }

  OP.ABILITIES['mil-saturation'] = function (sim, tower) {
    const s = tower.s
    const d = ensureAim(sim, tower)
    for (let i = 0; i < 8; i++) {
      lobShell(sim, tower, d.aimX + sim.rng.range(-70, 70), d.aimY + sim.rng.range(-70, 70),
        s.damage, s.blastRadius, 'mil-shell')
    }
  }

  OP.ABILITIES['mil-firestorm'] = function (sim, tower) {
    const s = tower.s
    const d = ensureAim(sim, tower)
    OP.Grid.queryCircle(sim.grid, d.aimX, d.aimY, 220, SCAN)
    for (let i = 0; i < SCAN.length; i++) {
      const b = SCAN[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !s.camoDetect) continue
      OP.Effects.apply(b, OP.Effects.make('burn', 8, Math.max(20, s.burnDps), tower.id, D.FIRE))
    }
  }

  OP.ABILITIES['mil-armour-strip'] = function (sim, tower) {
    const s = tower.s
    const d = ensureAim(sim, tower)
    OP.Grid.queryCircle(sim.grid, d.aimX, d.aimY, 200, SCAN)
    for (let i = 0; i < SCAN.length; i++) {
      const b = SCAN[i]
      if (!b.alive) continue
      if ((b.props & OP.PROP.VEILED) && !s.camoDetect) continue
      OP.Effects.apply(b, OP.Effects.make('brittle', 10, 1.0, tower.id, D.NORMAL))
      OP.Effects.apply(b, OP.Effects.make('acid', 10, Math.max(12, s.acidDps), tower.id, D.ACID))
    }
  }

  /* Overdrive locks the spin-up at full for its duration; update() reads
     tower.abilityT, so nothing needs to be stored anywhere else. */
  OP.ABILITIES['mil-overdrive'] = function (sim, tower) {
    tower.data.spin = 1
  }

  OP.ABILITIES['mil-particle-lance'] = function (sim, tower) {
    const s = tower.s
    const target = sim.byId.get(tower.targetId)
    const a = target ? M.angleTo(tower.x, tower.y, target.x, target.y) : tower.angle
    OP.Projectiles.fireAt(sim, {
      x: tower.x, y: tower.y, kind: 'mil-lance',
      damage: s.damage * 8, dmgType: s.dmgType, pierce: 400,
      radius: s.projRadius + 6, life: 1.4, maxRange: OP.FIELD_W,
      ownerId: tower.id, camoDetect: s.camoDetect
    }, a, s.projSpeed * 1.6)
  }

  /* ---------- small emitters shared by several towers ---------- */

  /** A lobbed shell that detonates where it was aimed, not where it collides. */
  function lobShell (sim, tower, x, y, damage, blast, kind) {
    const s = tower.s
    const dist = Math.max(12, M.dist(tower.x, tower.y, x, y))
    const speed = s.projSpeed
    OP.Projectiles.fireAt(sim, {
      x: tower.x, y: tower.y, kind: kind || 'mil-shell',
      damage: damage, dmgType: s.dmgType, pierce: s.pierce,
      radius: s.projRadius, life: dist / speed + 0.05, maxRange: dist,
      blastRadius: blast, blastOnExpiry: true, blastFalloff: s.blastFalloff,
      ownerId: tower.id, camoDetect: s.camoDetect,
      effects: shotEffects(s, tower.id)
    }, M.angleTo(tower.x, tower.y, x, y), speed)
  }

  /** A bomb dropped at a point beneath a flying tower. */
  function dropBomb (sim, tower, x, y, damage, blast) {
    const s = tower.s
    OP.Projectiles.spawn(sim, {
      x: x, y: y, vx: 0, vy: 0, kind: 'mil-bomb',
      damage: damage, dmgType: D.EXPLOSIVE, pierce: s.pierce + 6,
      radius: 3, life: 0.35,
      blastRadius: blast, blastOnExpiry: true, blastFalloff: 0.25,
      ownerId: tower.id, camoDetect: s.camoDetect,
      effects: shotEffects(s, tower.id)
    })
  }

  /** A homing explosive rocket. */
  function fireRocket (sim, tower, target, damage, blast) {
    const s = tower.s
    OP.Projectiles.fireAt(sim, {
      x: tower.x, y: tower.y, kind: 'mil-rocket',
      damage: damage, dmgType: D.EXPLOSIVE, pierce: s.pierce + 2,
      radius: s.projRadius + 1, life: 3,
      blastRadius: blast, blastOnExpiry: false,
      homing: 8, turnRate: 8, targetId: target.id,
      ownerId: tower.id, camoDetect: s.camoDetect,
      effects: shotEffects(s, tower.id)
    }, M.angleTo(tower.x, tower.y, target.x, target.y), s.projSpeed)
  }

  /** First blimp in range, or null. Drives the anti-blimp branches. */
  function blimpInRange (sim, tower) {
    OP.Grid.queryCircle(sim.grid, tower.x, tower.y, tower.s.range, SCAN)
    for (let i = 0; i < SCAN.length; i++) {
      const b = SCAN[i]
      if (!b.alive || !isBlimp(b)) continue
      if ((b.props & OP.PROP.VEILED) && !tower.s.camoDetect) continue
      return b
    }
    return null
  }

  /* ---------- the roster ---------- */

  OP.FAMILY_ROSTERS.military = [
    'longshot-lynx',
    'diver-otter',
    'corsair-beaver',
    'biplane-magpie',
    'rotor-kestrel',
    'howitzer-mole',
    'gatling-raccoon',
    'brood-mother-moth'
  ]

  /* ============================================================ 1. LONGSHOT LYNX
     Unlimited range and no line-of-sight check, so placement is free. Pays for it
     with a slow, single-target attack that needs upgrades to matter. */

  OP.defineTower({
    key: 'longshot-lynx',
    name: 'Longshot Lynx',
    family: 'military',
    blurb: 'Shoots anywhere on the map from anywhere on the map, over anything in the way. Slow, heavy, patient.',

    cost: 900,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 4000,            // the whole field several times over
      cooldown: 1.55,
      damage: 4,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 1500,
      projLife: 2.5,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: true,       // a rifle does not care about the rock outcrop
      shots: 1,
      spread: 0,
      multiTarget: false,
      blimpBonus: 0,
      netTier: 0,             // spotter-network strength, 0 = none
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Marksmanship',
        tiers: [
          { name: 'Steady Breath', cost: 450, desc: '+2 damage per shot, for 6 total.',
            apply: function (s) { s.damage += 2 } },
          { name: 'Hollow Points', cost: 990, desc: '+3 damage and +1 pierce, so a round carries through two balloons.',
            apply: function (s) { s.damage += 3; s.pierce += 1 } },
          { name: 'Shatter Rounds', cost: 2350, desc: 'Rounds become shatter damage: nothing in the game resists it, so Lead cracks open. +3 damage.',
            apply: function (s) { s.dmgType = D.SHATTER; s.damage += 3 } },
          { name: 'Heavy Barrel', cost: 9900, desc: '+14 damage and +1 pierce. A single round now clears a Ceramic shell.',
            apply: function (s) { s.damage += 14; s.pierce += 1 } },
          { name: 'One Shot', cost: 75600, desc: '+65 damage and +2 pierce. Ability: Called Shot — six homing shatter rounds at the six strongest balloons, each for six times damage. 45s cooldown.',
            apply: function (s) {
              s.damage += 65
              s.pierce += 2
              s.ability = { name: 'Called Shot', cooldown: 45, duration: 0, key: 'mil-called-shot' }
            } }
        ]
      },
      {
        name: 'Rapid Cycling',
        tiers: [
          { name: 'Smooth Action', cost: 405, desc: '20% faster attack.',
            apply: function (s) { s.cooldown *= 0.80 } },
          { name: 'Quick Hands', cost: 900, desc: 'Another 18% faster attack.',
            apply: function (s) { s.cooldown *= 0.82 } },
          { name: 'Semi-Automatic', cost: 2150, desc: '35% faster attack and +1 damage — a little over two rounds a second.',
            apply: function (s) { s.cooldown *= 0.65; s.damage += 1 } },
          { name: 'Full Automatic', cost: 9000, desc: '45% faster attack and +3 damage. Roughly four rounds a second.',
            apply: function (s) { s.cooldown *= 0.55; s.damage += 3 } },
          { name: 'Suppressing Fire', cost: 70200, desc: 'Fires 3 rounds per burst, 40% faster again, +10 damage and +2 pierce.',
            apply: function (s) {
              s.cooldown *= 0.60
              s.shots = 3
              s.spread = Math.max(s.spread, 0.10)
              s.damage += 10
              s.pierce += 2
            } }
        ]
      },
      {
        name: 'Spotting Scope',
        tiers: [
          { name: 'Field Glasses', cost: 380, desc: '+1 pierce and 30% faster rounds.',
            apply: function (s) { s.pierce += 1; s.projSpeed *= 1.30 } },
          { name: 'Split Focus', cost: 855, desc: 'Engages 2 separate balloons per shot instead of putting both rounds into one.',
            apply: function (s) { s.multiTarget = true; s.shots = Math.max(s.shots, 2); s.spread = Math.max(s.spread, 0.08) } },
          { name: 'Thermal Sight', cost: 2025, desc: 'Sees Veiled balloons, and engages 3 separate balloons per shot.',
            apply: function (s) { s.camoDetect = true; s.multiTarget = true; s.shots = Math.max(s.shots, 3) } },
          { name: "Spotter's Net", cost: 8550, desc: '4 balloons per shot, +6 damage, +2 pierce. Every other Longshot Lynx on the map — at any distance — sees Veiled balloons and deals 15% more damage.',
            apply: function (s) { s.shots = Math.max(s.shots, 4); s.damage += 6; s.pierce += 2; s.netTier = 1 } },
          { name: 'Command Nest', cost: 66600, desc: '5 balloons per shot and +20 damage. Every other Longshot Lynx gains Veiled detection, 30% more damage and attacks 20% faster.',
            apply: function (s) { s.shots = Math.max(s.shots, 5); s.damage += 20; s.netTier = 2 } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      const n = s.shots

      // Split Focus and up spread the burst across separate balloons; anything
      // left over doubles up on the primary target with a slight fan.
      let found = 0
      if (s.multiTarget && n > 1) {
        OP.Targeting.acquireMany(sim, tower, tower.targetMode, n, IDS)
        found = IDS.length
      }

      for (let i = 0; i < n; i++) {
        let b = target
        if (i < found) {
          const cand = sim.byId.get(IDS[i])
          if (cand && cand.alive) b = cand
        }
        if (!b) continue
        OP.Targeting.leadPoint(sim, tower, b, s.projSpeed, AIM)
        const angle = M.angleTo(tower.x, tower.y, AIM.x, AIM.y) +
          (i < found ? 0 : fanOffset(i, n, s.spread))
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: s.dmgType === D.SHATTER ? 'mil-slug' : 'mil-round',
          damage: shotDamage(s, b), dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, maxRange: 3000,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: shotEffects(s, tower.id)
        }, angle, s.projSpeed)
      }
    },

    /* The spotter network. Global rather than a radius: the whole point of this
       tower is that distance is not a constraint on it. Registered by key so it
       can only ever reach other Lynxes. */
    buffs: function (sim, tower) {
      const tier = tower.s.netTier
      if (!tier) return
      const mods = tier >= 2
        ? { camoDetect: true, damageMul: 1.30, cooldownMul: 0.80 }
        : { camoDetect: true, damageMul: 1.15 }
      OP.Buffs.register(sim, {
        id: 'mil-spotter:' + tower.id,
        sourceId: tower.id,
        radius: 'global',
        priority: 1,
        excludeSelf: true,
        keys: ['longshot-lynx'],
        mods: mods
      })
    }
  })

  /* ============================================================== 2. DIVER OTTER
     Water only. Cheap sustained damage, a sonar branch that hands camo detection
     to everything around it, and a harpoon branch that gives up small balloons
     entirely in exchange for blimp damage. */

  OP.defineTower({
    key: 'diver-otter',
    name: 'Diver Otter',
    family: 'military',
    blurb: 'Works from under the surface, firing spears upward. Cheap for what it does, if you have the water.',

    cost: 650,
    footprint: 12,
    placement: 'water',
    unlockRound: 0,

    base: {
      range: 190,
      cooldown: 0.75,
      damage: 1,
      pierce: 3,
      dmgType: D.SHARP,
      projSpeed: 520,
      projLife: 1.4,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: false,
      shots: 1,
      spread: 0,
      blimpBonus: 0,
      onlyBlimps: false,
      sonarTier: 0,
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Spearfishing',
        tiers: [
          { name: 'Barbed Tips', cost: 295, desc: '+1 damage per spear.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Twin Spears', cost: 650, desc: 'Throws 2 spears per shot in a narrow arc.',
            apply: function (s) { s.shots = 2; s.spread = 0.16 } },
          { name: 'Hardened Shafts', cost: 1550, desc: '+2 damage and +2 pierce per spear, so one throw clears a whole clump.',
            apply: function (s) { s.damage += 2; s.pierce += 2 } },
          { name: 'Deep Volley', cost: 6500, desc: '4 spears per shot and +4 damage — a wall of spears across the water.',
            apply: function (s) { s.shots = 4; s.spread = Math.max(s.spread, 0.34); s.damage += 4 } },
          { name: 'Riptide Barrage', cost: 50700, desc: '6 spears per shot, +14 damage, +4 pierce, and 30% faster.',
            apply: function (s) {
              s.shots = 6
              s.spread = Math.max(s.spread, 0.50)
              s.damage += 14
              s.pierce += 4
              s.cooldown *= 0.70
            } }
        ]
      },
      {
        name: 'Sonar',
        tiers: [
          { name: 'Clicks', cost: 275, desc: '+30 range, which is also how far the sonar branch reaches later.',
            apply: function (s) { s.range += 30 } },
          { name: 'Echo Pulse', cost: 620, desc: '+30 range, and it sees Veiled balloons itself.',
            apply: function (s) { s.range += 30; s.camoDetect = true } },
          { name: 'Sonar Burst', cost: 1475, desc: 'Every tower inside the Otter\'s own attack range sees Veiled balloons too.',
            apply: function (s) { s.sonarTier = 1 } },
          { name: 'Deep Scan', cost: 6175, desc: 'The sonar reaches 20% further than its attack range, and towers inside it also gain +10% range. +2 damage.',
            apply: function (s) { s.sonarTier = 2; s.damage += 2 } },
          { name: 'Abyssal Chorus', cost: 48100, desc: 'Sonar reaches 60% past its attack range and grants +20% range as well as Veiled detection. +18 damage. Ability: Sonar Bloom — everything nearby takes 60% more damage for 8s and is slowed. 40s cooldown.',
            apply: function (s) {
              s.sonarTier = 3
              s.damage += 18
              s.ability = { name: 'Sonar Bloom', cooldown: 40, duration: 0, key: 'mil-sonar-bloom' }
            } }
        ]
      },
      {
        name: 'Harpoon',
        tiers: [
          { name: 'Heavy Line', cost: 325, desc: '+2 damage and 40% faster spears.',
            apply: function (s) { s.damage += 2; s.projSpeed *= 1.40 } },
          { name: 'Grappling Head', cost: 715, desc: '+2 damage, and +6 extra damage against blimps.',
            apply: function (s) { s.damage += 2; s.blimpBonus += 6 } },
          { name: 'Blimp Hunter', cost: 1700, desc: '+4 damage and +30 extra damage against blimps.',
            apply: function (s) { s.damage += 4; s.blimpBonus += 30 } },
          { name: "Whaler's Harpoon", cost: 7150, desc: 'Ignores everything that is not a blimp — and fires through obstacles. +25 damage, +90 against blimps.',
            apply: function (s) {
              s.onlyBlimps = true
              s.ignoresLOS = true
              s.damage += 25
              s.blimpBonus += 90
            } },
          { name: 'Leviathan Line', cost: 54600, desc: 'Still blimps only: +120 damage, +400 against blimps, 40% faster. Ability: Harpoon Volley — eight double-damage harpoons at the eight biggest targets. 50s cooldown.',
            apply: function (s) {
              s.damage += 120
              s.blimpBonus += 400
              s.cooldown *= 0.60
              s.ability = { name: 'Harpoon Volley', cooldown: 50, duration: 0, key: 'mil-harpoon-volley' }
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s
      OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, AIM.x, AIM.y)
      const kind = s.onlyBlimps || s.blimpBonus >= 30 ? 'mil-harpoon' : 'mil-spear'
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: kind,
          damage: shotDamage(s, target), dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, maxRange: s.range * 1.3,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: shotEffects(s, tower.id)
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    },

    /* Sonar. The radius is derived from `tower.s.range`, which inside a buffs
       hook is the UNBUFFED stat block — so two overlapping Otters resolve to the
       same radii whichever order they were placed in. */
    buffs: function (sim, tower) {
      const tier = tower.s.sonarTier
      if (!tier) return
      const grow = tier >= 3 ? 1.60 : tier >= 2 ? 1.20 : 1.00
      const mods = { camoDetect: true }
      if (tier >= 3) mods.rangeMul = 1.20
      else if (tier >= 2) mods.rangeMul = 1.10
      OP.Buffs.register(sim, {
        id: 'mil-sonar:' + tower.id,
        sourceId: tower.id,
        x: tower.x, y: tower.y,
        radius: tower.s.range * grow,
        priority: 0,
        mods: mods
      })
    }
  })

  /* =========================================================== 3. CORSAIR BEAVER
     Water only. A broadside of many weak shots, a mortar branch that trades the
     fan for one heavy explosive shell, and a branch that launches its own small
     drifting attackers that fight on their own. */

  OP.defineTower({
    key: 'corsair-beaver',
    name: 'Corsair Beaver',
    family: 'military',
    blurb: 'A dammed-up gunboat that fires a whole fan of shot at once. Wide coverage, thin damage.',

    cost: 800,
    footprint: 15,
    placement: 'water',
    unlockRound: 0,

    base: {
      range: 175,
      cooldown: 1.20,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 430,
      projLife: 1.3,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: false,
      shots: 3,
      spread: 0.55,
      blastRadius: 0,
      blastFalloff: 0,
      blimpBonus: 0,
      mortar: false,          // true once it trades the fan for a lobbed shell
      skiffPeriod: 0, skiffCount: 0, skiffDamage: 0, skiffPierce: 0,
      skiffBlast: 0, skiffHoming: false,
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Broadside',
        tiers: [
          { name: 'Grapeshot', cost: 360, desc: '4 shots per broadside and +1 pierce.',
            apply: function (s) { s.shots = 4; s.pierce += 1 } },
          { name: 'Double-Shotted', cost: 800, desc: '+1 damage per shot.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Chain Shot', cost: 1925, desc: '6 shots per broadside, +1 damage and +1 pierce.',
            apply: function (s) { s.shots = 6; s.damage += 1; s.pierce += 1 } },
          { name: 'Full Broadside', cost: 8000, desc: '9 shots per broadside, +4 damage, +2 pierce and a wider arc.',
            apply: function (s) { s.shots = 9; s.damage += 4; s.pierce += 2; s.spread = 0.85 } },
          { name: 'Ship Of The Line', cost: 62400, desc: '14 shots across a 70-degree arc, +16 damage, +5 pierce, 25% faster. Ability: Broadside — a full ring of double-damage shot in every direction. 35s cooldown.',
            apply: function (s) {
              s.shots = 14
              s.damage += 16
              s.pierce += 5
              s.spread = 1.20
              s.cooldown *= 0.75
              s.ability = { name: 'Broadside', cooldown: 35, duration: 0, key: 'mil-broadside' }
            } }
        ]
      },
      {
        name: 'Mortar Boat',
        tiers: [
          { name: 'Powder Charge', cost: 400, desc: '+1 damage and 25% faster shot.',
            apply: function (s) { s.damage += 1; s.projSpeed *= 1.25 } },
          { name: 'Bombard', cost: 880, desc: 'Every shot becomes a small explosive bomb with a 26-unit blast. Black and Zebra balloons ignore explosions entirely, so this is a real trade. +1 damage.',
            apply: function (s) {
              s.dmgType = D.EXPLOSIVE
              s.blastRadius = 26
              s.blastFalloff = 0.3
              s.damage += 1
            } },
          { name: 'Heavy Mortar', cost: 2075, desc: 'Drops the fan for a single lobbed shell: 48-unit blast, +6 damage, +4 pierce, fires over obstacles.',
            apply: function (s) {
              s.dmgType = D.EXPLOSIVE
              s.shots = 1
              s.spread = 0
              s.blastRadius = 48
              s.blastFalloff = 0.2
              s.damage += 6
              s.pierce += 4
              s.ignoresLOS = true
              s.mortar = true
            } },
          { name: 'Siege Mortar', cost: 8800, desc: '64-unit blast, +18 damage, +6 pierce and +60 range.',
            apply: function (s) { s.blastRadius += 16; s.damage += 18; s.pierce += 6; s.range += 60 } },
          { name: 'Dreadnought Guns', cost: 67200, desc: '2 shells per shot, 86-unit blast, +90 damage, +10 pierce. Ability: Bombardment — ten shells across the ten biggest targets. 40s cooldown.',
            apply: function (s) {
              s.shots = 2
              s.spread = 0.25
              s.blastRadius += 22
              s.damage += 90
              s.pierce += 10
              s.ability = { name: 'Bombardment', cooldown: 40, duration: 0, key: 'mil-bombardment' }
            } }
        ]
      },
      {
        name: 'Privateer',
        tiers: [
          { name: 'Longboat', cost: 335, desc: 'Launches a drifting skiff every 3.5s that carries 2 damage through up to 6 balloons.',
            apply: function (s) { s.skiffPeriod = 3.5; s.skiffCount = 1; s.skiffDamage = 2; s.skiffPierce = 6 } },
          { name: 'Press-Ganged Crew', cost: 760, desc: 'A skiff every 2.4s, each with 4 damage and 8 pierce.',
            apply: function (s) { s.skiffPeriod = 2.4; s.skiffDamage += 2; s.skiffPierce += 2 } },
          { name: 'Boarding Party', cost: 1800, desc: 'Skiffs hunt the nearest balloon instead of drifting, with 8 damage and 14 pierce.',
            apply: function (s) { s.skiffHoming = true; s.skiffDamage += 4; s.skiffPierce += 6 } },
          { name: 'Corsair Fleet', cost: 7600, desc: '2 skiffs at a time, every 1.8s, 22 damage each, and each detonates for a 34-unit blast.',
            apply: function (s) {
              s.skiffPeriod = 1.8
              s.skiffCount = 2
              s.skiffDamage += 14
              s.skiffBlast = 34
            } },
          { name: 'Privateer Armada', cost: 59200, desc: '3 skiffs every 1.1s, 90 damage each, 50-unit blasts, 20 pierce.',
            apply: function (s) {
              s.skiffPeriod = 1.1
              s.skiffCount = 3
              s.skiffDamage += 68
              s.skiffPierce += 6
              s.skiffBlast = 50
            } }
        ]
      }
    ],

    fire: function (sim, tower, target) {
      const s = tower.s

      if (s.mortar) {
        // A lobbed shell: it lands where the balloon is going to be.
        OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
        for (let i = 0; i < s.shots; i++) {
          const jx = s.shots === 1 ? 0 : sim.rng.range(-20, 20)
          const jy = s.shots === 1 ? 0 : sim.rng.range(-20, 20)
          lobShell(sim, tower, AIM.x + jx, AIM.y + jy, shotDamage(s, target), s.blastRadius, 'mil-shell')
        }
        return
      }

      const centre = M.angleTo(tower.x, tower.y, target.x, target.y)
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: s.blastRadius > 0 ? 'mil-bomb' : 'mil-ball',
          damage: shotDamage(s, target), dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, maxRange: s.range * 1.2,
          blastRadius: s.blastRadius, blastFalloff: s.blastFalloff,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: shotEffects(s, tower.id)
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    },

    /* Skiffs are launched on their own clock, whether or not the boat has a
       target — they are the branch's whole identity. */
    update: function (sim, tower, dt) {
      const s = tower.s
      if (!(s.skiffPeriod > 0)) return
      const data = tower.data
      if (data.skiffT === undefined) data.skiffT = 0
      data.skiffT += dt
      if (data.skiffT < s.skiffPeriod) return
      data.skiffT -= s.skiffPeriod

      const held = tower.targetId >= 0 ? sim.byId.get(tower.targetId) : null
      for (let i = 0; i < s.skiffCount; i++) {
        const angle = held && held.alive
          ? M.angleTo(tower.x, tower.y, held.x, held.y) + sim.rng.range(-0.3, 0.3)
          : sim.rng.range(0, M.TAU)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'mil-skiff',
          damage: s.skiffDamage, dmgType: s.dmgType === D.EXPLOSIVE ? D.EXPLOSIVE : D.SHARP,
          pierce: s.skiffPierce, radius: 6, life: 7,
          blastRadius: s.skiffBlast, blastOnExpiry: s.skiffBlast > 0, blastFalloff: 0.2,
          ownerId: tower.id, camoDetect: s.camoDetect,
          homing: s.skiffHoming && held && held.alive ? 3 : 0,
          turnRate: 3,
          targetId: s.skiffHoming && held && held.alive ? held.id : -1,
          behaviour: 'mil-skiff',
          data: { turn: sim.rng.range(-0.7, 0.7) },
          effects: shotEffects(s, tower.id)
        }, angle, 110)
      }
    }
  })

  /* =========================================================== 4. BIPLANE MAGPIE
     Does not sit still: it flies a fixed figure-eight around where it was placed
     and fires along its heading rather than at a target. Targeting modes barely
     matter to it — what matters is what its circuit crosses. */

  OP.defineTower({
    key: 'biplane-magpie',
    name: 'Biplane Magpie',
    family: 'military',
    blurb: 'Flies a fixed figure-eight around its hangar and fires straight ahead. Where it points is where it hits.',

    cost: 1100,
    footprint: 12,
    placement: 'any',
    unlockRound: 0,

    base: {
      range: 165,
      cooldown: 0.42,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 620,
      projLife: 0.9,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: true,       // it is above the terrain
      shots: 1,
      spread: 0.05,
      blimpBonus: 0,
      circuitRadius: 62,
      circuitSpeed: 1.5,      // radians per second
      bombPeriod: 0, bombCount: 0, bombDamage: 0, bombBlast: 0,
      rocketPeriod: 0, rocketCount: 0, rocketDamage: 0, rocketBlast: 0,
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      // It shoots where it is flying, so a priority list would be a lie. Two
      // modes only, and they only decide whether it bothers to open fire.
      targetModes: ['close', 'first']
    },

    paths: [
      {
        name: 'Airframe',
        tiers: [
          { name: 'Twin Guns', cost: 550, desc: '2 rounds per burst.',
            apply: function (s) { s.shots = 2; s.spread = 0.08 } },
          { name: 'Rifled Barrels', cost: 1200, desc: '+1 damage per round.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Tight Circuit', cost: 2850, desc: '30% faster attack, and a tighter, quicker circuit that keeps it over the track.',
            apply: function (s) { s.cooldown *= 0.70; s.circuitRadius = 46; s.circuitSpeed = 2.2 } },
          { name: 'Nose Cannon', cost: 12100, desc: '+6 damage and +3 pierce, so a pass cuts through a whole clump.',
            apply: function (s) { s.damage += 6; s.pierce += 3 } },
          { name: 'Gunship', cost: 92400, desc: '4 rounds per burst, +22 damage, +6 pierce, 30% faster again.',
            apply: function (s) {
              s.shots = 4
              s.spread = 0.16
              s.damage += 22
              s.pierce += 6
              s.cooldown *= 0.70
            } }
        ]
      },
      {
        name: 'Bomb Bay',
        tiers: [
          { name: 'Bomb Racks', cost: 495, desc: 'Drops an explosive bomb every 1.2s as it flies: 3 damage in a 26-unit blast.',
            apply: function (s) { s.bombPeriod = 1.2; s.bombCount = 1; s.bombDamage = 3; s.bombBlast = 26 } },
          { name: 'Heavier Bombs', cost: 1100, desc: 'Bombs every 1.0s for 7 damage in a 34-unit blast.',
            apply: function (s) { s.bombPeriod = 1.0; s.bombDamage += 4; s.bombBlast += 8 } },
          { name: 'Carpet Bombing', cost: 2650, desc: '3 bombs in a line behind the plane every 0.9s, 12 damage each, 40-unit blasts.',
            apply: function (s) { s.bombPeriod = 0.9; s.bombCount = 3; s.bombDamage += 5; s.bombBlast += 6 } },
          { name: 'Firebombs', cost: 11000, desc: 'Bombs set balloons burning for 12 damage a second over 4s. Fire is not explosive, so this reaches Lead — but Purple ignores it. +16 bomb damage.',
            apply: function (s) {
              s.bombDamage += 16
              s.burnDps += 12
              s.burnTime = Math.max(s.burnTime, 4)
            } },
          { name: 'Saturation Run', cost: 85800, desc: '6 bombs every 0.7s, 90 damage each, 56-unit blasts, burning for 40 a second. Ability: Bombing Run — ten double-strength bombs laid out ahead of the plane. 40s cooldown.',
            apply: function (s) {
              s.bombPeriod = 0.7
              s.bombCount = 6
              s.bombDamage += 62
              s.bombBlast += 16
              s.burnDps += 28
              s.burnTime = Math.max(s.burnTime, 5)
              s.ability = { name: 'Bombing Run', cooldown: 40, duration: 0, key: 'mil-bombing-run' }
            } }
        ]
      },
      {
        name: 'Interceptor',
        tiers: [
          { name: 'Armour-Piercing', cost: 460, desc: '+2 damage and 50% faster rounds.',
            apply: function (s) { s.damage += 2; s.projSpeed *= 1.50 } },
          { name: 'Tracers', cost: 1050, desc: '+1 pierce, +30 range, and +8 damage against blimps.',
            apply: function (s) { s.pierce += 1; s.range += 30; s.blimpBonus += 8 } },
          { name: 'Rocket Pods', cost: 2475, desc: 'Fires a homing rocket every 1.6s whenever a blimp is in range: 20 damage in a 28-unit blast.',
            apply: function (s) { s.rocketPeriod = 1.6; s.rocketCount = 1; s.rocketDamage = 20; s.rocketBlast = 28 } },
          { name: 'Hunter Killer', cost: 10500, desc: '2 rockets every 1.3s for 55 damage each, and +90 damage against blimps.',
            apply: function (s) {
              s.rocketPeriod = 1.3
              s.rocketCount = 2
              s.rocketDamage += 35
              s.rocketBlast += 8
              s.blimpBonus += 90
            } },
          { name: 'Sky Reaper', cost: 81400, desc: '4 rockets every 0.9s for 220 damage each, +500 damage against blimps. Ability: Hunter Salvo — eight double-damage rockets at the eight biggest targets. 45s cooldown.',
            apply: function (s) {
              s.rocketPeriod = 0.9
              s.rocketCount = 4
              s.rocketDamage += 165
              s.rocketBlast += 12
              s.blimpBonus += 500
              s.ability = { name: 'Hunter Salvo', cooldown: 45, duration: 0, key: 'mil-hunter-salvo' }
            } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      const s = tower.s
      const r = s.circuitRadius
      // Keep the whole circuit on the field, so the plane never pins to an edge.
      tower.data.cx = M.clamp(tower.x, r + 10, OP.FIELD_W - r - 10)
      tower.data.cy = M.clamp(tower.y, r * 0.6 + 10, OP.FIELD_H - r * 0.6 - 10)
      tower.data.phase = 0
      tower.data.heading = 0
    },

    /* The flight path. A lemniscate around the placement point: one phase
       number in `tower.data` is the entire state, so it serialises and replays
       exactly. */
    update: function (sim, tower, dt) {
      const s = tower.s
      const data = tower.data
      if (data.cx === undefined) {
        data.cx = tower.x; data.cy = tower.y; data.phase = 0; data.heading = 0
      }

      const px = tower.x, py = tower.y
      data.phase = (data.phase + s.circuitSpeed * dt) % M.TAU
      const r = s.circuitRadius
      tower.x = M.clamp(data.cx + Math.cos(data.phase) * r, 6, OP.FIELD_W - 6)
      tower.y = M.clamp(data.cy + Math.sin(data.phase * 2) * r * 0.55, 6, OP.FIELD_H - 6)
      if (tower.x !== px || tower.y !== py) data.heading = M.angleTo(px, py, tower.x, tower.y)

      if (s.bombPeriod > 0) {
        if (data.bombT === undefined) data.bombT = 0
        data.bombT += dt
        if (data.bombT >= s.bombPeriod) {
          data.bombT -= s.bombPeriod
          // Laid out behind the plane, so a pass covers a strip of track.
          const back = data.heading + Math.PI
          for (let i = 0; i < s.bombCount; i++) {
            dropBomb(sim, tower,
              tower.x + Math.cos(back) * 22 * i,
              tower.y + Math.sin(back) * 22 * i,
              s.bombDamage, s.bombBlast)
          }
        }
      }

      if (s.rocketPeriod > 0) {
        if (data.rocketT === undefined) data.rocketT = 0
        data.rocketT += dt
        if (data.rocketT >= s.rocketPeriod) {
          const blimp = blimpInRange(sim, tower)
          if (blimp) {
            data.rocketT -= s.rocketPeriod
            for (let i = 0; i < s.rocketCount; i++) {
              fireRocket(sim, tower, blimp, s.rocketDamage + s.blimpBonus, s.rocketBlast)
            }
          } else {
            data.rocketT = s.rocketPeriod   // held ready for the next blimp
          }
        }
      }
    },

    /* Fires along its heading. The acquired target only decides *whether* it
       shoots, never where — which is why this tower ignores priority. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const head = tower.data.heading || 0
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'mil-tracer',
          damage: shotDamage(s, target), dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, maxRange: s.range * 1.4,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: shotEffects(s, tower.id)
        }, head + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ============================================================ 5. ROTOR KESTREL
     Also mobile, but it chases: every tick it moves toward whatever is closest
     to leaking, anywhere on the map, and returns to its pad when the board is
     clear. Its middle branch pushes balloons back down the track. */

  OP.defineTower({
    key: 'rotor-kestrel',
    name: 'Rotor Kestrel',
    family: 'military',
    blurb: 'Lifts off and chases whatever is closest to leaking, wherever it is. Its downwash shoves balloons backwards.',

    cost: 1050,
    footprint: 13,
    placement: 'any',
    unlockRound: 0,

    base: {
      range: 125,
      cooldown: 0.50,
      damage: 2,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 500,
      projLife: 0.8,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: true,       // it is in the air
      shots: 1,
      spread: 0.06,
      blimpBonus: 0,
      chaseSpeed: 150,        // units per second
      shove: 0,               // units a hit pushes a balloon back
      pushRadius: 0, pushDist: 0, pushPeriod: 1.0,
      rocketPeriod: 0, rocketCount: 0, rocketDamage: 0, rocketBlast: 0,
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first', 'close', 'strong']
    },

    paths: [
      {
        name: 'Rotors',
        tiers: [
          { name: 'Trimmed Blades', cost: 475, desc: '30% faster in the air, so it reaches leaks sooner.',
            apply: function (s) { s.chaseSpeed *= 1.30 } },
          { name: 'Autocannon', cost: 1050, desc: '+2 damage and +1 pierce.',
            apply: function (s) { s.damage += 2; s.pierce += 1 } },
          { name: 'Turbine', cost: 2525, desc: '40% faster in the air, 25% faster attack, +25 range.',
            apply: function (s) { s.chaseSpeed *= 1.40; s.cooldown *= 0.75; s.range += 25 } },
          { name: 'Gunpods', cost: 10500, desc: '2 rounds per burst, +9 damage, +3 pierce.',
            apply: function (s) { s.shots = 2; s.damage += 9; s.pierce += 3 } },
          { name: 'Assault Rotor', cost: 81900, desc: '4 rounds per burst, +40 damage, +6 pierce, 45% faster attack.',
            apply: function (s) {
              s.shots = 4
              s.spread = 0.14
              s.damage += 40
              s.pierce += 6
              s.cooldown *= 0.55
            } }
        ]
      },
      {
        name: 'Downwash',
        tiers: [
          { name: 'Rotor Wash', cost: 525, desc: 'Every round it lands shoves that balloon 8 units back down the track. Blimps are too heavy to move.',
            apply: function (s) { s.behaviour = 'mil-downwash'; s.shove += 8 } },
          { name: 'Storm Wash', cost: 1150, desc: 'Shoves 18 units per hit, and +2 damage.',
            apply: function (s) { s.behaviour = 'mil-downwash'; s.shove += 10; s.damage += 2 } },
          { name: 'Cyclone', cost: 2725, desc: 'Once a second, every balloon within 95 units is shoved 22 units back whether or not it was shot.',
            apply: function (s) { s.pushRadius = 95; s.pushDist = 22; s.pushPeriod = 1.0 } },
          { name: 'Hurricane', cost: 11600, desc: 'The downdraft reaches 130 units, shoves 38, comes twice a second, and leaves balloons 40% slower for 2s. +12 damage.',
            apply: function (s) {
              s.pushRadius = 130
              s.pushDist = 38
              s.pushPeriod = 0.5
              s.glueMag = Math.max(s.glueMag, 0.40)
              s.glueTime = Math.max(s.glueTime, 2)
              s.damage += 12
            } },
          { name: 'Maelstrom', cost: 88200, desc: 'Downdraft of 90 units twice a second within 190, +45 damage. Ability: Downdraft — shoves every balloon on the map 150 units back. 60s cooldown.',
            apply: function (s) {
              s.pushRadius = 190
              s.pushDist = 90
              s.shove += 30
              s.damage += 45
              s.ability = { name: 'Downdraft', cooldown: 60, duration: 0, key: 'mil-downdraft' }
            } }
        ]
      },
      {
        name: 'Gunship',
        tiers: [
          { name: 'Searchlight', cost: 440, desc: '+30 range, so it can open fire before it has finished closing in.',
            apply: function (s) { s.range += 30 } },
          { name: 'Night Vision', cost: 1000, desc: 'Sees Veiled balloons, and will chase them — including the WRAITH blimp, which is Veiled from the moment it arrives.',
            apply: function (s) { s.camoDetect = true } },
          { name: 'Missile Rack', cost: 2375, desc: 'Adds a homing missile every 2s: 22 damage in a 30-unit explosive blast.',
            apply: function (s) { s.rocketPeriod = 2.0; s.rocketCount = 1; s.rocketDamage = 22; s.rocketBlast = 30 } },
          { name: 'Cluster Missiles', cost: 9975, desc: '2 missiles every 1.5s for 70 explosive damage each, in a 38-unit blast. It has no anti-blimp bonus — bring the Otter or the Magpie for those.',
            apply: function (s) {
              s.rocketPeriod = 1.5
              s.rocketCount = 2
              s.rocketDamage += 48
              s.rocketBlast += 8
            } },
          { name: 'Escort Flight', cost: 77700, desc: '4 missiles every 1.1s for 260 explosive damage each, a 52-unit blast, and +30 damage on the guns.',
            apply: function (s) {
              s.rocketPeriod = 1.1
              s.rocketCount = 4
              s.rocketDamage += 190
              s.rocketBlast += 14
              s.damage += 30
            } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      tower.data.hx = tower.x
      tower.data.hy = tower.y
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const data = tower.data
      if (data.hx === undefined) { data.hx = tower.x; data.hy = tower.y }

      // Chase the leak, or go home. Home is the pad it was placed on, so selling
      // and rebuying is never a way to reposition it permanently.
      const lead = Military.leakLeader(sim, tower)
      const tx = lead ? lead.x : data.hx
      const ty = lead ? lead.y : data.hy
      const dist = M.dist(tower.x, tower.y, tx, ty)
      if (dist > 0.5) {
        const step = Math.min(s.chaseSpeed * dt, dist)
        const a = M.angleTo(tower.x, tower.y, tx, ty)
        tower.x = M.clamp(tower.x + Math.cos(a) * step, 6, OP.FIELD_W - 6)
        tower.y = M.clamp(tower.y + Math.sin(a) * step, 6, OP.FIELD_H - 6)
      }

      if (s.pushRadius > 0 && s.pushDist > 0) {
        if (data.pushT === undefined) data.pushT = 0
        data.pushT += dt
        if (data.pushT >= s.pushPeriod) {
          data.pushT -= s.pushPeriod
          OP.Grid.queryCircle(sim.grid, tower.x, tower.y, s.pushRadius, SCAN)
          for (let i = 0; i < SCAN.length; i++) {
            const b = SCAN[i]
            if (!b.alive) continue
            if ((b.props & OP.PROP.VEILED) && !s.camoDetect) continue
            if (Military.shove(sim, b, s.pushDist) > 0 && s.glueMag > 0) {
              OP.Effects.apply(b, OP.Effects.make('glue', s.glueTime, s.glueMag, tower.id, D.NORMAL))
            }
          }
          // The downdraft is not a projectile — it deals no damage at all. Tell
          // the renderer about it through the blast FX queue rather than
          // spawning a damage-zero shot that would pollute the shot counters.
          sim.blastEvents.push({ x: tower.x, y: tower.y, radius: s.pushRadius, kind: 'mil-wash', hits: 0 })
        }
      }

      if (s.rocketPeriod > 0) {
        if (data.rocketT === undefined) data.rocketT = 0
        data.rocketT += dt
        if (data.rocketT >= s.rocketPeriod) {
          const held = tower.targetId >= 0 ? sim.byId.get(tower.targetId) : null
          if (held && held.alive) {
            data.rocketT -= s.rocketPeriod
            for (let i = 0; i < s.rocketCount; i++) {
              fireRocket(sim, tower, held, s.rocketDamage + (isBlimp(held) ? s.blimpBonus : 0), s.rocketBlast)
            }
          } else {
            data.rocketT = s.rocketPeriod
          }
        }
      }
    },

    fire: function (sim, tower, target) {
      const s = tower.s
      OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, AIM.x, AIM.y)
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'mil-round',
          damage: shotDamage(s, target), dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, maxRange: s.range * 1.3,
          ownerId: tower.id, camoDetect: s.camoDetect,
          behaviour: s.shove > 0 ? 'mil-downwash' : '',
          data: s.shove > 0 ? { shove: s.shove } : null,
          effects: shotEffects(s, tower.id)
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ============================================================= 6. HOWITZER MOLE
     Shells a point the player picks, not a balloon. It needs *something* in
     range to open fire, but where the shell lands is entirely the aim point —
     which is what makes it the answer to a corner of track nothing else covers. */

  OP.defineTower({
    key: 'howitzer-mole',
    name: 'Howitzer Mole',
    family: 'military',
    blurb: 'Dug in with a fixed gun. Shells the spot you point it at, over walls, forever, whether balloons are there or not.',

    cost: 750,
    footprint: 14,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 470,
      cooldown: 1.90,
      damage: 6,
      pierce: 8,
      dmgType: D.EXPLOSIVE,
      projSpeed: 340,
      projLife: 3,
      projRadius: 4,
      camoDetect: false,
      ignoresLOS: true,       // it lobs
      shots: 1,
      spread: 0,
      blastRadius: 42,
      blastFalloff: 0.2,
      aimSpread: 0,
      blimpBonus: 0,
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first']  // it fires at a point; priority cannot apply
    },

    paths: [
      {
        name: 'Ordnance',
        tiers: [
          { name: 'Bigger Charge', cost: 375, desc: '+3 damage per shell.',
            apply: function (s) { s.damage += 3 } },
          { name: 'Wide Frag', cost: 825, desc: '54-unit blast and +4 pierce, so one shell covers more of the track.',
            apply: function (s) { s.blastRadius += 12; s.pierce += 4 } },
          { name: 'Shaped Charge', cost: 1950, desc: '+10 damage and a 64-unit blast, which covers most of a track corner.',
            apply: function (s) { s.damage += 10; s.blastRadius += 10 } },
          { name: 'Bunker Buster', cost: 8250, desc: '+34 damage, +8 pierce. Ability: Saturation Fire — eight shells scattered across the aim point at once. 35s cooldown.',
            apply: function (s) {
              s.damage += 34
              s.pierce += 8
              s.ability = { name: 'Saturation Fire', cooldown: 35, duration: 0, key: 'mil-saturation' }
            } },
          { name: 'Siege Battery', cost: 63000, desc: '2 shells per shot with a slight scatter, +180 damage, 96-unit blast, +12 pierce.',
            apply: function (s) {
              s.shots = 2
              s.aimSpread = 30
              s.damage += 180
              s.blastRadius += 32
              s.pierce += 12
            } }
        ]
      },
      {
        name: 'Incendiary',
        tiers: [
          { name: 'Hot Rounds', cost: 340, desc: '+2 damage and 20% faster reload.',
            apply: function (s) { s.damage += 2; s.cooldown *= 0.80 } },
          { name: 'Incendiary Shells', cost: 750, desc: 'Shells set balloons burning for 6 damage a second over 3s. Burning is fire damage, so it reaches Black and Zebra that shrug off the blast itself — but Purple ignores it.',
            apply: function (s) { s.burnDps += 6; s.burnTime = Math.max(s.burnTime, 3) } },
          { name: 'White Phosphorus', cost: 1800, desc: 'Burns for 16 a second over 4s, and +6 shell damage.',
            apply: function (s) { s.burnDps += 10; s.burnTime = Math.max(s.burnTime, 4); s.damage += 6 } },
          { name: 'Napalm', cost: 7500, desc: 'Burns for 40 a second over 5s, +20 shell damage, 60-unit blast.',
            apply: function (s) {
              s.burnDps += 24
              s.burnTime = Math.max(s.burnTime, 5)
              s.damage += 20
              s.blastRadius += 18
            } },
          { name: 'Firestorm', cost: 58500, desc: 'Burns for 110 a second over 6s and +120 shell damage. Ability: Firestorm — ignites everything within 220 of the aim point for 8s. 45s cooldown.',
            apply: function (s) {
              s.burnDps += 70
              s.burnTime = Math.max(s.burnTime, 6)
              s.damage += 120
              s.ability = { name: 'Firestorm', cooldown: 45, duration: 0, key: 'mil-firestorm' }
            } }
        ]
      },
      {
        name: 'Armour Breaker',
        tiers: [
          { name: 'Steel Nose', cost: 315, desc: '+2 damage and 30% faster shells.',
            apply: function (s) { s.damage += 2; s.projSpeed *= 1.30 } },
          { name: 'Plate Cutters', cost: 715, desc: 'Shells leave balloons brittle: they take 40% more damage from everything for 4s. Plated balloons carry double layer HP, so this is where that armour goes.',
            apply: function (s) { s.brittleMag = Math.max(s.brittleMag, 0.40); s.brittleTime = Math.max(s.brittleTime, 4) } },
          { name: 'Corrosive Filler', cost: 1700, desc: 'Adds acid: 14 damage a second for 5s. No balloon and no blimp resists acid, and it chews through hull that armour does not protect. Brittle rises to 60%.',
            apply: function (s) {
              s.acidDps += 14
              s.acidTime = Math.max(s.acidTime, 5)
              s.brittleMag = Math.max(s.brittleMag, 0.60)
            } },
          { name: 'Hull Breaker', cost: 7125, desc: 'Acid for 55 a second over 6s, brittle 90%, +30 shell damage and +120 against blimps.',
            apply: function (s) {
              s.acidDps += 41
              s.acidTime = Math.max(s.acidTime, 6)
              s.brittleMag = Math.max(s.brittleMag, 0.90)
              s.damage += 30
              s.blimpBonus += 120
            } },
          { name: 'Siege Breaker', cost: 55500, desc: 'Acid for 200 a second over 8s, brittle 150%, +150 shell damage, +900 against blimps. Ability: Armour Strip — brittle and heavy acid on everything within 200 of the aim point. 45s cooldown.',
            apply: function (s) {
              s.acidDps += 145
              s.acidTime = Math.max(s.acidTime, 8)
              s.brittleMag = Math.max(s.brittleMag, 1.50)
              s.damage += 150
              s.blimpBonus += 900
              s.ability = { name: 'Armour Strip', cooldown: 45, duration: 0, key: 'mil-armour-strip' }
            } }
        ]
      }
    ],

    onPlace: function (sim, tower) { Military.defaultAimPoint(sim, tower) },

    update: function (sim, tower, dt) { ensureAim(sim, tower) },

    /* `target` is deliberately unused: it only proved something was in range. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const data = ensureAim(sim, tower)
      const blimp = target && isBlimp(target)
      for (let i = 0; i < s.shots; i++) {
        const jx = s.aimSpread > 0 ? sim.rng.range(-s.aimSpread, s.aimSpread) : 0
        const jy = s.aimSpread > 0 ? sim.rng.range(-s.aimSpread, s.aimSpread) : 0
        lobShell(sim, tower, data.aimX + jx, data.aimY + jy,
          s.damage + (blimp ? s.blimpBonus : 0), s.blastRadius, 'mil-shell')
      }
    }
  })

  /* ========================================================== 7. GATLING RACCOON
     Spins up. The longer it stays on one balloon the faster it fires and the
     more it pierces; switch target and the barrels wind down to nothing. */

  OP.defineTower({
    key: 'gatling-raccoon',
    name: 'Gatling Raccoon',
    family: 'military',
    blurb: 'Winds up while it holds a target: the longer it stays on one balloon, the faster and deeper it fires.',

    cost: 550,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 140,
      cooldown: 0.24,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 720,
      projLife: 0.7,
      projRadius: 3,
      camoDetect: false,
      ignoresLOS: false,
      shots: 1,
      spread: 0.05,
      blimpBonus: 0,
      spinTime: 3.5,          // seconds on one target to reach full spin
      spinRate: 0.55,         // fraction of the reload refunded at full spin
      spinPierce: 2,          // extra pierce at full spin
      spinFloor: 0,           // spin it never drops below
      burnDps: 0, burnTime: 0, acidDps: 0, acidTime: 0,
      brittleMag: 0, brittleTime: 0, glueMag: 0, glueTime: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Barrels',
        tiers: [
          { name: 'More Barrels', cost: 275, desc: '+1 pierce and reaches full spin in 2.5s instead of 3.5s.',
            apply: function (s) { s.pierce += 1; s.spinTime = 2.5 } },
          { name: 'Heavy Rounds', cost: 605, desc: '+1 damage per round.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Ten Barrels', cost: 1425, desc: 'At full spin it fires roughly three times as fast, with +4 pierce.',
            apply: function (s) { s.spinRate = 0.68; s.spinPierce += 2; s.pierce += 2 } },
          { name: 'Depleted Rounds', cost: 6050, desc: '+7 damage and +3 pierce on every round, spun up or not.',
            apply: function (s) { s.damage += 7; s.pierce += 3 } },
          { name: 'Vulcan', cost: 46200, desc: '+26 damage, +8 pierce, full spin in 1s. Ability: Overdrive — instant full spin held for 6s. 30s cooldown.',
            apply: function (s) {
              s.damage += 26
              s.pierce += 8
              s.spinTime = 1
              s.spinRate = 0.75
              s.ability = { name: 'Overdrive', cooldown: 30, duration: 6, key: 'mil-overdrive' }
            } }
        ]
      },
      {
        name: 'Cooling',
        tiers: [
          { name: 'Vented Barrels', cost: 230, desc: '18% faster attack.',
            apply: function (s) { s.cooldown *= 0.82 } },
          { name: 'Water Jacket', cost: 525, desc: 'Another 18% faster attack.',
            apply: function (s) { s.cooldown *= 0.82 } },
          { name: 'Cryo Coolant', cost: 1250, desc: '25% faster attack, and the spin never falls below 40% even after switching target.',
            apply: function (s) { s.cooldown *= 0.75; s.spinFloor = 0.40 } },
          { name: 'Twin Feed', cost: 5225, desc: '2 rounds per shot and +4 damage, doubling the barrel output.',
            apply: function (s) { s.shots = 2; s.spread = 0.09; s.damage += 4 } },
          { name: 'Gatling Storm', cost: 40700, desc: '3 rounds per shot, +18 damage, 35% faster attack, spin never falls below 70%.',
            apply: function (s) {
              s.shots = 3
              s.spread = 0.14
              s.damage += 18
              s.cooldown *= 0.65
              s.spinFloor = 0.70
            } }
        ]
      },
      {
        name: 'Energy Core',
        tiers: [
          { name: 'Charged Rounds', cost: 250, desc: '+1 damage and 30% faster rounds.',
            apply: function (s) { s.damage += 1; s.projSpeed *= 1.30 } },
          { name: 'Ionised Barrels', cost: 550, desc: 'Rounds become plasma: Lead no longer shrugs them off, but Purple ignores plasma completely. +2 damage.',
            apply: function (s) { s.dmgType = D.PLASMA; s.damage += 2 } },
          { name: 'Arc Coils', cost: 1325, desc: '+5 damage and +3 pierce on plasma rounds.',
            apply: function (s) { s.dmgType = D.PLASMA; s.damage += 5; s.pierce += 3 } },
          { name: 'Fusion Core', cost: 5500, desc: 'Rounds become energy: +22 damage, +4 pierce, 40% faster rounds. Purple ignores energy too, so keep something else for it.',
            apply: function (s) {
              s.dmgType = D.ENERGY
              s.damage += 22
              s.pierce += 4
              s.projSpeed *= 1.40
            } },
          { name: 'Particle Lance', cost: 42900, desc: '+90 damage and +14 pierce. Ability: Particle Lance — one beam across the whole map at eight times damage, through everything. 40s cooldown.',
            apply: function (s) {
              s.dmgType = D.ENERGY
              s.damage += 90
              s.pierce += 14
              s.ability = { name: 'Particle Lance', cooldown: 40, duration: 0, key: 'mil-particle-lance' }
            } }
        ]
      }
    ],

    /* Spin-up. `tower.targetId` here is last tick's target — targeting runs
       after update() — which is exactly what makes "did the target change?"
       answerable at all. */
    update: function (sim, tower, dt) {
      const s = tower.s
      const data = tower.data
      if (data.spin === undefined) { data.spin = 0; data.lastTarget = -1 }

      if (tower.abilityT > 0) {
        data.spin = 1
      } else if (tower.targetId >= 0 && tower.targetId === data.lastTarget) {
        data.spin = Math.min(1, data.spin + dt / s.spinTime)
      } else {
        data.spin = s.spinFloor
      }
      data.lastTarget = tower.targetId
    },

    onAbilityEnd: function (sim, tower) { tower.data.spin = tower.s.spinFloor },

    fire: function (sim, tower, target) {
      const s = tower.s
      const spin = tower.data.spin || 0

      // Refund part of the reload the engine is about to add. Capped well short
      // of the whole reload so the shot rate can never become unbounded.
      tower.cooldown -= s.cooldown * Math.min(0.85, s.spinRate * spin)

      OP.Targeting.leadPoint(sim, tower, target, s.projSpeed, AIM)
      const centre = M.angleTo(tower.x, tower.y, AIM.x, AIM.y)
      const pierce = s.pierce + Math.round(s.spinPierce * spin)
      const kind = s.dmgType === D.SHARP ? 'mil-round' : 'mil-plasma'
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: kind,
          damage: shotDamage(s, target), dmgType: s.dmgType, pierce: pierce,
          radius: s.projRadius, life: s.projLife, maxRange: s.range * 1.25,
          ownerId: tower.id, camoDetect: s.camoDetect,
          effects: shotEffects(s, tower.id)
        }, centre + fanOffset(i, s.shots, s.spread), s.projSpeed)
      }
    }
  })

  /* ---------- Brood Mother Moth: egg hatch behaviour ---------- */

  OP.PROJ_BEHAVIOURS['moth-egg-hatch'] = {
    onHit: function (sim, p, balloon, res) {
      const d = p.data
      if (!d || !d.hatched) return
      d.hatched = true
      // Despawn the egg
      p.life = 0
      // Spawn a hatchling that homes toward the balloon
      OP.Projectiles.spawn(sim, {
        x: p.x, y: p.y,
        vx: 0, vy: 0,
        kind: d.hatchlingKind || 'moth-hatchling',
        damage: d.hatchDamage,
        dmgType: d.hatchDmgType || D.SHARP,
        pierce: d.hatchPierce || 1,
        radius: 3,
        life: d.hatchLife || 3,
        ownerId: p.ownerId,
        camoDetect: d.hatchCamo || false,
        homing: 10, turnRate: 10, targetId: balloon.id
      })
      const hatch = sim.projectiles[sim.projectiles.length - 1]
      if (hatch) {
        const a = M.angleTo(p.x, p.y, balloon.x, balloon.y)
        hatch.vx = Math.cos(a) * 300
        hatch.vy = Math.sin(a) * 300
      }
    }
  }

  /* ============================================================================
     7. BROOD MOTHER MOTH — seeds the track with eggs that hatch on contact.

     Eggs are stationary projectiles (like Caltrop Beetle thorns) sitting on the
     track. When a balloon passes over, the egg hatches into a temporary homing
     projectile that chases and damages. Same serialisation story as thorn-patches.
     ========================================================================== */

  OP.defineTower({
    key: 'brood-mother-moth',
    name: 'Brood Mother Moth',
    family: 'military',
    blurb: 'Quietly lays eggs along the track. They do not stay quiet for long.',

    cost: 800,
    footprint: 13,
    placement: 'land',
    unlockRound: 0,

    base: {
      range: 100,
      cooldown: 3.0,
      damage: 0,
      pierce: 1,
      dmgType: D.SHARP,
      projSpeed: 0,
      projLife: 30,
      projRadius: 4,
      camoDetect: false,
      targetModes: ['first', 'last', 'close', 'strong'],

      maxEggs: 8,
      hatchDamage: 2,
      hatchPierce: 1,
      hatchLife: 3,
      hatchCamo: true,
      hatchDmgType: D.SHARP,
      trapSpread: 60
    },

    paths: [
      {
        name: 'Clutch',
        tiers: [
          { name: 'More Eggs', cost: 420,
            desc: '+3 max eggs.',
            apply: function (s) { s.maxEggs += 3 } },
          { name: 'Quick Hatch', cost: 810,
            desc: 'Eggs hatch 30% faster and hatchlings deal +1 damage.',
            apply: function (s) { s.cooldown *= 0.7; s.hatchDamage += 1 } },
          { name: 'Sharp Shell', cost: 1800,
            desc: 'Hatchlings deal +2 damage (for 5) and have +1 pierce.',
            apply: function (s) { s.hatchDamage += 2; s.hatchPierce += 1 } },
          { name: 'Shatter Shell', cost: 7200,
            desc: 'Hatchlings deal shatter damage — Lead and armour crack open. +3 damage.',
            apply: function (s) { s.hatchDmgType = D.SHATTER; s.hatchDamage += 3 } },
          { name: 'Brood Queen', cost: 58000,
            desc: '+8 hatch damage, +2 pierce, +5 max eggs. Adds Queen Emergence: every 25 seconds, all eggs on the track hatch simultaneously and each spawns 3 hatchlings instead of 1.',
            apply: function (s) {
              s.hatchDamage += 8
              s.hatchPierce += 2
              s.maxEggs += 5
              s.ability = { name: 'Queen Emergence', cooldown: 25, duration: 0, key: 'moth-queen-emerge' }
            } }
        ]
      },
      {
        name: 'Brood Mother',
        tiers: [
          { name: 'Keen Eyes', cost: 400,
            desc: 'Hatchlings see Veiled balloons and the tower gains camo detection.',
            apply: function (s) { s.hatchCamo = true; s.camoDetect = true } },
          { name: 'Toxic Spit', cost: 780,
            desc: 'Hatchlings apply a 30% slow for 2 seconds on hit.',
            apply: function (s) { s.hatchSlow = 0.3; s.hatchSlowT = 2 } },
          { name: 'Fire Eggs', cost: 1700,
            desc: 'Hatchlings deal fire damage and apply burn: 4 DPS for 3 seconds.',
            apply: function (s) { s.hatchDmgType = D.FIRE; s.hatchBurnDps = 4; s.hatchBurnT = 3 } },
          { name: 'Split Brood', cost: 6800,
            desc: 'When a hatchling expires, it spawns 1 smaller hatchling (50% damage).',
            apply: function (s) { s.hatchSplit = 1 } },
          { name: 'Infinite Swarm', cost: 54000,
            desc: '+10 hatch damage, +3 pierce. Hatchlings chain to 2 nearby balloons on hit. Eggs last 50% longer and hatchlings live 4 seconds.',
            apply: function (s) {
              s.hatchDamage += 10
              s.hatchPierce += 3
              s.hatchChain = 2
              s.projLife *= 1.5
              s.hatchLife = 4
            } }
        ]
      },
      {
        name: 'Nest Architecture',
        tiers: [
          { name: 'Woven Nest', cost: 440,
            desc: 'Eggs last 50% longer before expiring.',
            apply: function (s) { s.projLife *= 1.5 } },
          { name: 'Deep Roots', cost: 860,
            desc: '+3 max eggs.',
            apply: function (s) { s.maxEggs += 3 } },
          { name: 'Armored Shell', cost: 1900,
            desc: 'Eggs gain 2 pierce — each can hatch 2 balloons.',
            apply: function (s) { s.pierce += 2 } },
          { name: 'Autonomous Nest', cost: 7600,
            desc: 'Eggs that have not hatched after 10 seconds launch a single homing hatchling at the nearest balloon.',
            apply: function (s) { s.autoHatch = true; s.autoHatchTime = 10 } },
          { name: 'Colony Fortress', cost: 60000,
            desc: '+8 max eggs, eggs last twice as long, and autonomous nests launch every 5 seconds. Adds Swarm Burst: every 30 seconds, 15 homing hatchlings emerge from the tower and seek the nearest balloons.',
            apply: function (s) {
              s.maxEggs += 8
              s.projLife *= 2
              s.autoHatchTime = 5
              s.ability = { name: 'Swarm Burst', cooldown: 30, duration: 0, key: 'moth-swarm-burst' }
            } }
        ]
      }
    ],

    onPlace: function (sim, tower) {
      const d = tower.data
      d.eggCd = 0
      d.k = 0
    },

    update: function (sim, tower, dt) {
      const s = tower.s
      const d = tower.data
      d.eggCd = Math.max(0, (d.eggCd || 0) - dt)

      // Autonomous hatch for old eggs
      if (s.autoHatch) {
        const list = sim.projectiles
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          if (!p.alive || p.ownerId !== tower.id || p.kind !== 'moth-egg') continue
          const eggData = p.data
          if (!eggData || eggData.autoFired) continue
          if (p.age < (s.autoHatchTime || 10)) continue
          eggData.autoFired = true
          // Find nearest balloon and spawn a hatchling
          let best = null; let bestDist = s.range
          for (let j = 0; j < sim.balloons.length; j++) {
            const b = sim.balloons[j]
            if (!b.alive) continue
            const dx = b.x - p.x; const dy = b.y - p.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < bestDist) { bestDist = dist; best = b }
          }
          if (best) {
            OP.Projectiles.spawn(sim, {
              x: p.x, y: p.y, vx: 0, vy: 0,
              kind: 'moth-hatchling',
              damage: s.hatchDamage,
              dmgType: s.hatchDmgType,
              pierce: s.hatchPierce,
              radius: 3,
              life: s.hatchLife,
              ownerId: tower.id,
              camoDetect: s.hatchCamo,
              homing: 10, turnRate: 10, targetId: best.id
            })
            const h = sim.projectiles[sim.projectiles.length - 1]
            if (h) { const a = M.angleTo(p.x, p.y, best.x, best.y); h.vx = Math.cos(a) * 300; h.vy = Math.sin(a) * 300 }
          }
        }
      }

      if (d.eggCd > 0) return

      // Count live eggs
      let eggCount = 0
      const projs = sim.projectiles
      for (let i = 0; i < projs.length; i++) {
        if (projs[i].alive && projs[i].ownerId === tower.id && projs[i].kind === 'moth-egg') eggCount++
      }
      if (eggCount >= s.maxEggs) return

      // Find nearest track and lay an egg
      const found = nearestPath(sim, tower.x, tower.y)
      if (!found) return
      const track = found.track
      const offset = s.trapSpread * (d.k / Math.max(1, s.maxEggs - 1) - 0.5)
      d.k = (d.k + 1) % Math.max(1, s.maxEggs)
      const tPos = M.clamp(found.near.t + offset, 0, track.length)
      const spot = track.posAt(tPos)

      OP.Projectiles.spawn(sim, {
        x: spot.x, y: spot.y, vx: 0, vy: 0,
        kind: 'moth-egg',
        damage: 0,
        dmgType: s.hatchDmgType,
        pierce: s.pierce || 0,
        radius: s.projRadius,
        life: s.projLife,
        ownerId: tower.id,
        camoDetect: false,
        behaviour: 'moth-egg-hatch',
        data: {
          hatchDamage: s.hatchDamage,
          hatchPierce: s.hatchPierce,
          hatchLife: s.hatchLife,
          hatchCamo: s.hatchCamo,
          hatchDmgType: s.hatchDmgType,
          hatchSlow: s.hatchSlow || 0,
          hatchSlowT: s.hatchSlowT || 0,
          hatchBurnDps: s.hatchBurnDps || 0,
          hatchBurnT: s.hatchBurnT || 0,
          hatchChain: s.hatchChain || 0,
          hatchSplit: s.hatchSplit || 0,
          hatchlingKind: 'moth-hatchling',
          hatched: false
        }
      })

      d.eggCd = s.cooldown
    }
  })

  OP.ABILITIES['moth-queen-emerge'] = function (sim, tower) {
    const s = tower.s
    const list = sim.projectiles
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!p.alive || p.ownerId !== tower.id || p.kind !== 'moth-egg') continue
      if (p.data && p.data.hatched) continue
      // Hatch this egg with triple hatchlings
      for (let j = 0; j < 3; j++) {
        OP.Projectiles.spawn(sim, {
          x: p.x, y: p.y, vx: 0, vy: 0,
          kind: 'moth-hatchling',
          damage: s.hatchDamage,
          dmgType: s.hatchDmgType,
          pierce: s.hatchPierce,
          radius: 3,
          life: s.hatchLife,
          ownerId: tower.id,
          camoDetect: s.hatchCamo,
          homing: 10, turnRate: 10, targetId: -1
        })
        const h = sim.projectiles[sim.projectiles.length - 1]
        if (h) {
          const angle = (j / 3) * Math.PI * 2 + sim.rng.range(0, 1)
          h.vx = Math.cos(angle) * 250
          h.vy = Math.sin(angle) * 250
        }
      }
      p.life = 0
    }
  }

  OP.ABILITIES['moth-swarm-burst'] = function (sim, tower) {
    const s = tower.s
    for (let i = 0; i < 15; i++) {
      OP.Projectiles.spawn(sim, {
        x: tower.x, y: tower.y, vx: 0, vy: 0,
        kind: 'moth-swarm',
        damage: Math.max(1, Math.round(s.hatchDamage * 0.5)),
        dmgType: s.hatchDmgType,
        pierce: 1,
        radius: 3,
        life: 4,
        ownerId: tower.id,
        camoDetect: s.hatchCamo,
        homing: 8, turnRate: 8, targetId: -1
      })
      const h = sim.projectiles[sim.projectiles.length - 1]
      if (h) {
        const angle = sim.rng.range(0, Math.PI * 2)
        h.vx = Math.cos(angle) * 200
        h.vy = Math.sin(angle) * 200
      }
    }
  }

})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

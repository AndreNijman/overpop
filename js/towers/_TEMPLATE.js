/* TEMPLATE — not loaded by index.html. Copy this shape, do not import it.
 *
 * This is the reference tower. It exercises every part of the contract in
 * ARCHITECTURE.md §6: three branches, five tiers each, crosspath-aware stat
 * changes, a damage-type conversion, an activated ability, a projectile
 * behaviour hook, and a support-style buff registration.
 *
 * Read the rules below before authoring a family file. They are the things that
 * are easy to get wrong and expensive to find later.
 *
 * ─── RULES ────────────────────────────────────────────────────────────────────
 *
 * 1. NO CLOSURES IN ENTITY STATE. Abilities and projectile behaviours are string
 *    keys into OP.ABILITIES / OP.PROJ_BEHAVIOURS. If you stash a function on a
 *    tower or a projectile, mid-round save breaks and the harness will tell you.
 *
 * 2. `apply(s, tower, sim)` MUTATES the stat object. It must be idempotent given
 *    the same starting stats — it is re-run from scratch on every restat, so
 *    `s.damage += 1` is right and `tower.someCounter++` is wrong.
 *
 * 3. Upgrade costs must not decrease down a branch. defineTower throws otherwise.
 *
 * 4. Never mutate another tower. Register a buff (see `buffs` below) so
 *    resolution stays order-independent. Inside `buffs`, `tower.s` is swapped to
 *    the UNBUFFED stat block for you, so aura geometry is order-free by default.
 *
 * 5. Damage type is how you answer immunities. Lead ignores sharp; the fix is an
 *    upgrade that sets `s.dmgType = OP.DMG.SHATTER`, not a special case.
 *
 * 6. Use `sim.rng` for anything random. Never Math.random() — it desyncs replays.
 *
 * 7. Every `desc` string is shown verbatim in the upgrade panel. Write them for a
 *    player, and say the actual numbers.
 *
 * 8. Declare every projectile `kind` with OP.declareProjKind(). Undeclared kinds
 *    render as nothing, and the family suite fails on them.
 *
 * 9. Upgrade costs must sit inside OP.Upgrades.COST_LADDER for their tier, as a
 *    multiple of the tower's own base cost. The family suite audits this.
 */

;(function (OP) {
  'use strict'

  const M = OP.M
  const D = OP.DMG

  /* ---------- projectile art kinds, declared once ----------
     Every `kind` a tower emits must be declared, or the renderer has nothing to
     draw and the harness fails the family. */

  OP.declareProjKind('template-dart', { shape: 'dart', tint: '#c9a227', size: 4, trail: true })
  OP.declareProjKind('template-spike', { shape: 'spike', tint: '#9fe8c6', size: 5, spin: true })

  /* ---------- projectile behaviour, registered once by key ---------- */

  OP.PROJ_BEHAVIOURS['template-ricochet'] = {
    // Called on every contact. `res` is the damage result, or null for a bomb.
    onHit: function (sim, p, balloon, res) {
      if (!p.data || p.data.bounces <= 0) return
      p.data.bounces--
      // Re-aim at the next thing nearby, using the sim's RNG for the scatter.
      const angle = Math.atan2(p.vy, p.vx) + sim.rng.range(-0.6, 0.6)
      const speed = Math.hypot(p.vx, p.vy)
      p.vx = Math.cos(angle) * speed
      p.vy = Math.sin(angle) * speed
      p.pierce++          // a bounce refunds the pierce it just spent
    },
    onExpire: function (sim, p) { /* optional */ },
    onStep: function (sim, p, dt) { /* optional, runs every tick */ }
  }

  /* ---------- ability, registered once by key ---------- */

  OP.ABILITIES['template-volley'] = function (sim, tower) {
    const s = tower.s
    const ids = []
    OP.Targeting.acquireMany(sim, tower, tower.targetMode, 12, ids)
    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b) continue
      OP.Projectiles.spawn(sim, {
        x: tower.x, y: tower.y,
        vx: 0, vy: 0,
        kind: 'template-spike',
        damage: s.damage * 3,
        dmgType: s.dmgType,
        pierce: 2,
        radius: s.projRadius,
        life: 2,
        ownerId: tower.id,
        camoDetect: s.camoDetect,
        homing: 14, turnRate: 14, targetId: b.id
      })
      // Give it a real initial velocity so homing has something to steer.
      const p = sim.projectiles[sim.projectiles.length - 1]
      if (p) {
        const a = M.angleTo(tower.x, tower.y, b.x, b.y)
        p.vx = Math.cos(a) * s.projSpeed
        p.vy = Math.sin(a) * s.projSpeed
      }
    }
  }

  /* ---------- declare the roster ----------
     One line per family file, listing every tower key it registers. The family
     floor suite audits exactly this list. */

  OP.FAMILY_ROSTERS.primary = ['template-critter']

  /* ---------- the tower ---------- */

  OP.defineTower({
    key: 'template-critter',
    name: 'Template Critter',
    family: 'primary',
    blurb: 'Reference implementation. Not registered in index.html.',

    cost: 200,
    footprint: 14,
    placement: 'land',      // 'land' | 'water' | 'any'
    unlockRound: 0,
    income: false,          // true marks it an income tower, which PURIST bans

    base: {
      range: 110,
      cooldown: 0.95,
      damage: 1,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 380,
      projLife: 1.2,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    paths: [
      {
        name: 'Sharpened',
        tiers: [
          { name: 'Whittled Points', cost: 140, desc: '+1 pierce.',
            apply: function (s) { s.pierce += 1 } },
          { name: 'Hardened Tips', cost: 220, desc: '+1 damage.',
            apply: function (s) { s.damage += 1 } },
          { name: 'Split Shot', cost: 500, desc: 'Throws 3 at once in a narrow arc.',
            apply: function (s) { s.shots = 3; s.spread = 0.30 } },
          { name: 'Flint Edge', cost: 2400, desc: 'Damage becomes shatter — cracks Lead open. +2 damage.',
            apply: function (s) { s.dmgType = D.SHATTER; s.damage += 2 } },
          { name: 'Stormfall', cost: 22000, desc: '+8 damage, +6 pierce, and an activated volley of homing spikes.',
            apply: function (s) {
              s.damage += 8
              s.pierce += 6
              s.ability = { name: 'Stormfall', cooldown: 40, duration: 0, key: 'template-volley' }
            } }
        ]
      },
      {
        name: 'Quick Paws',
        tiers: [
          { name: 'Loose Grip', cost: 110, desc: '15% faster attack.',
            apply: function (s) { s.cooldown *= 0.85 } },
          { name: 'Practised Throw', cost: 180, desc: 'Another 18% faster.',
            apply: function (s) { s.cooldown *= 0.82 } },
          { name: 'Keen Eyes', cost: 480, desc: 'Sees through Veiled balloons.',
            apply: function (s) { s.camoDetect = true } },
          { name: 'Blur', cost: 2100, desc: '40% faster attack and +30 range.',
            apply: function (s) { s.cooldown *= 0.60; s.range += 30 } },
          { name: 'Ten Paws', cost: 19500, desc: 'Attacks three times as fast and throws 2 extra.',
            apply: function (s) { s.cooldown *= 0.34; s.shots += 2; s.spread = Math.max(s.spread, 0.22) } }
        ]
      },
      {
        name: 'Long Throw',
        tiers: [
          { name: 'Wind Read', cost: 90, desc: '+18 range.',
            apply: function (s) { s.range += 18 } },
          { name: 'Overarm', cost: 160, desc: '+22 range and faster projectiles.',
            apply: function (s) { s.range += 22; s.projSpeed *= 1.25 } },
          { name: 'Ricochet', cost: 560, desc: 'Projectiles bounce to 2 more balloons.',
            apply: function (s) { s.behaviour = 'template-ricochet'; s.bounces = 2 } },
          { name: 'Far Sight', cost: 1900, desc: '+45 range and +2 pierce.',
            apply: function (s) { s.range += 45; s.pierce += 2 } },
          { name: 'Across The Valley', cost: 16000, desc: 'Doubles range and lobs over obstacles.',
            apply: function (s) { s.range *= 2; s.ignoresLOS = true; s.bounces = (s.bounces || 0) + 2 } }
        ]
      }
    ],

    /* Required unless the tower is purely `update`-driven. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)

      for (let i = 0; i < s.shots; i++) {
        // Spread the shots symmetrically around the aim line.
        const offset = s.shots === 1 ? 0 : s.spread * (i / (s.shots - 1) - 0.5)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'template-dart',
          damage: s.damage,
          dmgType: s.dmgType,
          pierce: s.pierce,
          radius: s.projRadius,
          life: s.projLife,
          maxRange: s.range * 1.35,
          ownerId: tower.id,
          camoDetect: s.camoDetect,
          behaviour: s.behaviour || '',
          data: s.bounces ? { bounces: s.bounces } : null
        }, centre + offset, s.projSpeed)
      }
    },

    /* Optional: called every tick, before firing. Use for non-projectile work. */
    update: function (sim, tower, dt) { /* nothing to do here */ },

    /* Optional: register buffs. Called on place and after every upgrade.
       Never mutate another tower directly. */
    buffs: function (sim, tower) {
      if (OP.Upgrades.topTier(tower) < 3) return
      OP.Buffs.register(sim, {
        id: 'template-morale:' + tower.id,
        sourceId: tower.id,
        x: tower.x, y: tower.y,
        // Inside `buffs()`, `tower.s` is deliberately the UNBUFFED stat block
        // (base + upgrades), so aura geometry cannot depend on placement order.
        radius: tower.s.range,
        priority: 0,
        excludeSelf: true,
        families: ['primary'],
        mods: { rangeMul: 1.05 }
      })
    },

    onPlace: function (sim, tower) { /* optional */ },
    onSell: function (sim, tower) { /* optional; buffs are unregistered for you */ },
    onAbilityEnd: function (sim, tower) { /* optional; fires when duration expires */ }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

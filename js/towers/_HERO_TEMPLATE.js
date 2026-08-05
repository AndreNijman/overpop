/* TEMPLATE — not loaded by index.html. Copy this shape, do not import it.
 *
 * The reference hero. Everything in js/towers/heroes.js follows this shape.
 *
 * A hero is a tower that levels instead of upgrading. All the tower rules in
 * _TEMPLATE.js still apply (no closures in entity state, string keys for
 * abilities and projectile behaviours, sim.rng only, declare projectile kinds).
 * On top of those:
 *
 * 1. EVERY level from 2 to 20 must grant something. defineHero throws on a gap,
 *    because a level that visibly does nothing reads as a bug to the player.
 *
 * 2. `apply(s, hero, sim)` for a level must be idempotent, exactly like an
 *    upgrade's apply — levels are re-applied from scratch on every restat.
 *
 * 3. A hero should have a mechanical identity, not a stat curve. If the only
 *    thing distinguishing it from a Primary tower is bigger numbers, it is not a
 *    hero yet. Give it something no tower can do.
 *
 * 4. One ability is conventional at level 3-10; a second at 10-20 via
 *    `s.ability2`. Both are string keys into OP.ABILITIES.
 */

;(function (OP) {
  'use strict'

  const M = OP.M
  const D = OP.DMG

  OP.declareProjKind('template-hero-bolt', { shape: 'bolt', tint: '#ffd97a', size: 5, trail: true })

  /* ---------- abilities ---------- */

  // Level 4: a short window where the hero's shots pass through everything.
  OP.ABILITIES['template-hero-focus'] = function (sim, hero) {
    hero.data.focusT = 6
  }

  // Level 12: a one-off shockwave centred on the hero.
  OP.ABILITIES['template-hero-shock'] = function (sim, hero) {
    OP.Damage.blast(sim, hero.x, hero.y, hero.s.range * 1.15, {
      damage: 6 + hero.level,
      dmgType: D.SHATTER,
      sourceId: hero.id,
      effects: [OP.Effects.make('stun', 1.2, 1, hero.id, D.NORMAL)]
    }, { camoDetect: true, maxTargets: 60 })
    sim.blastEvents.push({ x: hero.x, y: hero.y, radius: hero.s.range * 1.15, kind: 'template-hero-shock', hits: 0 })
  }

  /* ---------- the hero ---------- */

  OP.defineHero({
    key: 'template-hero',
    name: 'Template Hero',
    title: 'the Reference',
    blurb: 'Reference implementation of the hero contract. Not registered in index.html.',

    cost: 900,
    footprint: 14,
    placement: 'land',

    base: {
      range: 130,
      cooldown: 0.80,
      damage: 2,
      pierce: 2,
      dmgType: D.SHARP,
      projSpeed: 460,
      projLife: 1.4,
      projRadius: 4,
      camoDetect: false,
      shots: 1,
      spread: 0,
      targetModes: ['first', 'last', 'close', 'strong']
    },

    /* Every level 2..20. Ascending, no gaps, each with player-facing text. */
    levels: [
      { level: 2, desc: '+1 pierce.', apply: function (s) { s.pierce += 1 } },
      { level: 3, desc: '+12 range.', apply: function (s) { s.range += 12 } },
      {
        level: 4,
        desc: 'Unlocks Focus: 6 seconds of shots that pass through everything.',
        apply: function (s) {
          s.ability = { name: 'Focus', cooldown: 32, duration: 6, key: 'template-hero-focus' }
        }
      },
      { level: 5, desc: '+1 damage.', apply: function (s) { s.damage += 1 } },
      { level: 6, desc: '12% faster attack.', apply: function (s) { s.cooldown *= 0.88 } },
      { level: 7, desc: 'Sees through Veiled balloons.', apply: function (s) { s.camoDetect = true } },
      { level: 8, desc: '+2 pierce.', apply: function (s) { s.pierce += 2 } },
      { level: 9, desc: '+16 range and faster shots.', apply: function (s) { s.range += 16; s.projSpeed *= 1.2 } },
      { level: 10, desc: '+2 damage.', apply: function (s) { s.damage += 2 } },
      { level: 11, desc: 'Fires two bolts in a narrow arc.', apply: function (s) { s.shots = 2; s.spread = 0.16 } },
      {
        level: 12,
        desc: 'Unlocks Shockwave: stuns and shatters everything nearby.',
        apply: function (s) {
          s.ability2 = { name: 'Shockwave', cooldown: 55, duration: 0, key: 'template-hero-shock' }
        }
      },
      { level: 13, desc: '15% faster attack.', apply: function (s) { s.cooldown *= 0.85 } },
      { level: 14, desc: 'Damage becomes shatter — cracks Lead open.', apply: function (s) { s.dmgType = D.SHATTER } },
      { level: 15, desc: '+3 damage.', apply: function (s) { s.damage += 3 } },
      { level: 16, desc: '+3 pierce and +20 range.', apply: function (s) { s.pierce += 3; s.range += 20 } },
      { level: 17, desc: '20% faster attack.', apply: function (s) { s.cooldown *= 0.80 } },
      { level: 18, desc: 'Fires a third bolt.', apply: function (s) { s.shots += 1; s.spread = 0.22 } },
      { level: 19, desc: '+5 damage.', apply: function (s) { s.damage += 5 } },
      {
        level: 20,
        desc: '+10 damage, +6 pierce, and Focus recharges twice as fast.',
        apply: function (s) {
          s.damage += 10
          s.pierce += 6
          if (s.ability) s.ability = { name: s.ability.name, cooldown: s.ability.cooldown * 0.5, duration: s.ability.duration, key: s.ability.key }
        }
      }
    ],

    fire: function (sim, hero, target) {
      const s = hero.s
      const focused = (hero.data.focusT || 0) > 0
      const aim = OP.Targeting.leadPoint(sim, hero, target, s.projSpeed)
      const centre = M.angleTo(hero.x, hero.y, aim.x, aim.y)

      for (let i = 0; i < s.shots; i++) {
        const offset = s.shots === 1 ? 0 : s.spread * (i / (s.shots - 1) - 0.5)
        OP.Projectiles.fireAt(sim, {
          x: hero.x, y: hero.y,
          kind: 'template-hero-bolt',
          damage: s.damage,
          dmgType: s.dmgType,
          // Focus is the hero's identity: pierce becomes effectively unlimited.
          pierce: focused ? 60 : s.pierce,
          radius: s.projRadius,
          life: s.projLife,
          maxRange: s.range * 1.4,
          ownerId: hero.id,
          camoDetect: s.camoDetect || focused
        }, centre + offset, s.projSpeed)
      }
    },

    update: function (sim, hero, dt) {
      if (hero.data.focusT > 0) hero.data.focusT = Math.max(0, hero.data.focusT - dt)
    },

    onPlace: function (sim, hero) { hero.data.focusT = 0 },
    onLevel: function (sim, hero) { /* optional: fires each time a level is gained */ }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

/* TEMPLATE — not loaded by index.html. Copy this shape, do not import it.
 *
 * The reference paragon. Everything in js/towers/paragons.js follows this shape.
 *
 * A paragon is declared AGAINST an existing tower key. Promotion consumes every
 * other tower of that type on the board and derives a `degree` (1..100) from the
 * cash, upgrade tiers and pops sacrificed. See js/core/paragon.js.
 *
 * Rules:
 *
 * 1. `apply(s, tower, sim, degree)` runs AFTER the shared paragon baseline, which
 *    has already scaled damage, pierce, cooldown and range and forced camo
 *    detection on. Your job is identity, not raw multipliers — otherwise every
 *    paragon is the same tower with a different colour.
 *
 * 2. Scale by `degree / OP.Paragon.MAX_DEGREE`, so a degree-1 paragon is a real
 *    but modest thing and a degree-100 one is a centrepiece. Never ignore degree:
 *    it is the whole point of the mechanic.
 *
 * 3. `fire` is optional. Provide it only if the paragon attacks differently from
 *    the tower it came from. If omitted, the base tower's fire() is used with the
 *    paragon's stats.
 *
 * 4. VOID damage exists for paragons and ignores every immunity. Use it
 *    sparingly — it is the reason a paragon never feels blanked by a type chart.
 *
 * 5. Not every tower gets a paragon, and README.md says which do. Do not add one
 *    to a tower that is not on that list without updating it.
 */

;(function (OP) {
  'use strict'

  const M = OP.M
  const D = OP.DMG

  OP.declareProjKind('template-paragon-shard', {
    shape: 'shard', tint: '#f2e6c8', size: 7, trail: true, spin: true
  })

  /* ---------- ability ---------- */

  OP.ABILITIES['template-paragon-storm'] = function (sim, tower) {
    const s = tower.s
    const degree = tower.paragonDegree
    const ids = []
    OP.Targeting.acquireMany(sim, tower, 'strong', 8 + Math.floor(degree / 12), ids)

    for (let i = 0; i < ids.length; i++) {
      const b = sim.byId.get(ids[i])
      if (!b) continue
      OP.Damage.blast(sim, b.x, b.y, 70 + degree * 0.6, {
        damage: Math.round(s.damage * 2),
        dmgType: D.VOID,
        sourceId: tower.id
      }, { camoDetect: true, maxTargets: 40 })
      sim.blastEvents.push({ x: b.x, y: b.y, radius: 70 + degree * 0.6, kind: 'template-paragon-storm', hits: 0 })
    }
  }

  /* ---------- the paragon ---------- */

  OP.defineParagon({
    // Must name a registered tower. defineParagon throws otherwise, so a renamed
    // tower fails at load instead of shipping an unreachable upgrade.
    towerKey: 'template-critter',

    name: 'Template Paragon',
    blurb: 'Reference implementation of the paragon contract. Not registered in index.html.',
    cost: 250000,
    minTier: 5,

    ability: {
      name: 'Shardstorm',
      cooldown: 45,
      duration: 0,
      key: 'template-paragon-storm'
    },

    /**
     * Identity, on top of the shared baseline.
     * @param {object} s      resolved stats, already boosted by the baseline
     * @param {object} tower
     * @param {object} sim
     * @param {number} degree 1..100
     */
    apply: function (s, tower, sim, degree) {
      const d = degree / OP.Paragon.MAX_DEGREE

      // The identity: shots ignore every immunity, and the volley widens with degree.
      s.dmgType = D.VOID
      s.shots = 3 + Math.floor(d * 5)
      s.spread = 0.5 + d * 0.35
      s.ignoresLOS = true

      // Degree-scaled extras beyond the baseline.
      s.damage += Math.round(6 + d * 40)
      s.pierce += Math.round(4 + d * 20)
      s.projSpeed *= 1.3 + d * 0.5
    },

    /** Optional. Omit to inherit the base tower's attack. */
    fire: function (sim, tower, target) {
      const s = tower.s
      const aim = OP.Targeting.leadPoint(sim, tower, target, s.projSpeed)
      const centre = M.angleTo(tower.x, tower.y, aim.x, aim.y)

      for (let i = 0; i < s.shots; i++) {
        const offset = s.shots === 1 ? 0 : s.spread * (i / (s.shots - 1) - 0.5)
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y,
          kind: 'template-paragon-shard',
          damage: s.damage,
          dmgType: s.dmgType,
          pierce: s.pierce,
          radius: s.projRadius + 2,
          life: s.projLife * 1.3,
          maxRange: s.range * 1.5,
          ownerId: tower.id,
          camoDetect: true
        }, centre + offset, s.projSpeed)
      }
    }
  })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

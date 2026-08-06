;(function (OP) {
  'use strict'

  OP.VERSION = '1.0.0'

  /* ---------- time ---------- */

  // Fixed simulation step. Never varies — game speed multiplies how many steps
  // run per frame, not how long a step is.
  OP.DT = 1 / 60
  OP.MAX_STEPS_PER_FRAME = 8   // catch-up ceiling, so a stalled tab can't spiral

  /* ---------- space ---------- */

  OP.FIELD_W = 1280
  OP.FIELD_H = 720

  /* The part of the field the BOARD is allowed to occupy.
     Maps are authored across the full 1280x720, but the shop sidebar sits over
     x >= 960 — which hid between 14% and 38% of every map's track, depending on
     the map. Balloons crossed a third of the route out of sight and you could not
     aim at them.

     So the board is scaled to fit inside this rect as a pure VIEW transform (see
     Camera.board). The simulation still runs in full field coordinates and never
     learns about this, which is the point: rescaling the map DATA instead would
     shrink the track while leaving tower ranges alone, and every measured balance
     number would move with no way to say by how much.

     The gutter keeps the board off the panel edge: fitted flush, the map's last
     pixel column and the sidebar's first are the same column, which reads as the
     board running underneath. It also makes the "nothing is hidden" invariant
     strict rather than boundary-exact.

     HUD.LAYOUT.sidebar.x must be >= PLAY_W or the panel eats the board again;
     tools/suites/ui-game.mjs asserts that, so the two numbers cannot drift. */
  OP.PLAY_GUTTER = 12
  OP.PLAY_W = 960 - OP.PLAY_GUTTER
  OP.PLAY_H = OP.FIELD_H

  // A red balloon travels this many units per second. Every other speed in the
  // game is a multiplier on it.
  OP.BASE_SPEED = 46

  // Children of a popped balloon are nudged apart along the track by this much,
  // so a cluster doesn't render as a single sprite or collide identically.
  OP.CHILD_SPREAD = 7

  /* ---------- balloon properties (bitmask) ---------- */

  OP.PROP = {
    VEILED: 1,   // untargetable without camoDetect
    REGEN: 2,    // climbs back a layer periodically
    PLATED: 4    // double layer HP
  }

  OP.PROP_NAMES = { 1: 'Veiled', 2: 'Regen', 4: 'Plated' }

  OP.REGEN_PERIOD = 3.0   // seconds per layer regained

  /* ---------- targeting ---------- */

  OP.TARGET_MODES = ['first', 'last', 'close', 'strong']

  /* ---------- economy ---------- */

  OP.SELL_RATE = 0.7          // fraction of total invested returned on sell
  OP.ROUND_END_BONUS = 100    // base cash for surviving a round, before scaling

  /* ---------- limits ---------- */

  OP.MAX_BALLOONS = 4000
  OP.MAX_PROJECTILES = 2000
  OP.MAX_TOWERS = 200
  OP.MAX_CASCADE_DEPTH = 24   // guard against a malformed child cycle

  /* ---------- families ---------- */

  OP.FAMILIES = ['primary', 'military', 'magic', 'support']

  OP.FAMILY_LABELS = {
    primary: 'Primary',
    military: 'Military',
    magic: 'Magic',
    support: 'Support'
  }

  /* ---------- registries ----------
     Declared here so load order never depends on which file happens to touch a
     registry first. Every later file appends; nothing re-assigns. */

  OP.TOWERS = {}            // key -> tower definition
  OP.TOWER_ORDER = []       // stable display order
  /* Each family file declares its own roster here. Explicit, because
     Towers.byFamily() would also return towers defined by test fixtures, and the
     family floor suite must audit exactly the shipped roster and nothing else. */
  OP.FAMILY_ROSTERS = {}
  OP.HEROES = {}            // key -> hero definition
  OP.HERO_ORDER = []
  OP.PARAGONS = {}          // towerKey -> paragon definition
  OP.MAPS = {}              // key -> map definition
  OP.MAP_ORDER = []
  OP.ROUND_SETS = {}        // key -> round table, so a save can name its set
  OP.ABILITIES = {}         // key -> (sim, tower) => void
  OP.PROJ_BEHAVIOURS = {}   // key -> { onHit?, onExpire?, onStep? }

  /* Projectile art keys. Tower authors emit `kind` strings; the renderer draws
     them. Nothing else connects the two, so every kind must be declared here via
     OP.declareProjKind() and the harness asserts that no kind is ever emitted
     that was not declared. Otherwise a fraction of shots render as nothing and it
     is not noticed until the smoke test — or later. */
  OP.PROJ_KINDS = {}

  OP.declareProjKind = function (key, spec) {
    if (!key || typeof key !== 'string') throw new Error('a projectile kind needs a string key')
    if (OP.PROJ_KINDS[key]) throw new Error('projectile kind already declared: ' + key)
    OP.PROJ_KINDS[key] = {
      key: key,
      shape: (spec && spec.shape) || 'dart',   // render hint
      tint: (spec && spec.tint) || '#e8e2d4',
      size: (spec && spec.size) || 4,
      trail: !!(spec && spec.trail),
      spin: !!(spec && spec.spin)
    }
    return key
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

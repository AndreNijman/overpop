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
  OP.HEROES = {}            // key -> hero definition
  OP.HERO_ORDER = []
  OP.PARAGONS = {}          // towerKey -> paragon definition
  OP.MAPS = {}              // key -> map definition
  OP.MAP_ORDER = []
  OP.ABILITIES = {}         // key -> (sim, tower) => void
  OP.PROJ_BEHAVIOURS = {}   // key -> { onHit?, onExpire?, onStep? }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

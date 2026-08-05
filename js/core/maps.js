;(function (OP) {
  'use strict'

  const M = OP.M

  /* ============================================================================
     MAPS — the authored format, the loader, and the placement masks.

     A map is plain serialisable data. `Maps.define` validates it hard and
     registers it; `Maps.build` turns one definition into the runtime object
     `Sim.create` wants, with real `OP.Track` instances. Nothing in the sim ever
     reads the authored definition directly — it reads the built map — so a
     retuned map reaches existing saves (a save stores `map.key`, never geometry).

     ---------------------------------------------------------------------------
     THE AUTHORED DEFINITION — write one of these per map, pass it to
     OP.Maps.define(). Every field marked REQUIRED throws if missing or malformed,
     with the map key in the message.

     {
       key: 'willow-bend',        // REQUIRED. Stable id. Lowercase kebab-case by
                                  //   convention; it is what a save records, so
                                  //   never rename a shipped key. Must be unique.
       name: 'Willow Bend',       // REQUIRED. Shown in the map picker.
       tier: 'beginner',          // REQUIRED. beginner | intermediate | advanced | expert
       blurb: 'One lazy path…',   // REQUIRED. One sentence for the picker card.

       paths: [                   // REQUIRED. 1 to 3 paths. Balloons never change
         {                        //   path, so each is an independent lane.
           points: [              // REQUIRED. 2+ control points, ENTRY FIRST,
             { x: 0,    y: 300 }, //   EXIT LAST. Every point must satisfy
             { x: 420,  y: 300 }, //   0 <= x <= 1280 and 0 <= y <= 720.
             { x: 420,  y: 560 }, //   Start on a field edge so balloons walk in
             { x: 1280, y: 560 }  //   from off-screen, and end on one so they
           ],                     //   walk out.
           smooth: 3              // optional, default 0. Catmull-Rom SUBDIVISIONS
         }                        //   PER CONTROL SEGMENT (track.js turns n into
       ],                         //   n+1 samples per segment). 0 = hard corners,
                                  //   2-4 reads hand-drawn, cap is 24.
                                  //   Smoothing OVERSHOOTS the control polygon —
                                  //   a tight corner near an edge can push the
                                  //   built curve off the field, and define()
                                  //   rejects that. Fix by moving the control
                                  //   point inward or lowering `smooth`.

       trackWidth: 34,            // REQUIRED, > 0. Unbuildable margin measured
                                  //   from the path CENTRELINE. Author it wide
                                  //   enough to cover the painted road plus a
                                  //   typical tower radius (~14): tower footprint
                                  //   is deliberately NOT added at check time, so
                                  //   the buildable area is exactly what you see
                                  //   here and does not shift per tower.

       water:    [ … ],           // optional. Regions where ONLY `placement:
                                  //   'water'` towers may go — and where land
                                  //   towers may not. Omit for a dry map.
       blocked:  [ … ],           // optional. Nothing may ever be built here.
                                  //   Does NOT block line of sight.
       blockers: [ {x,y,w,h}, … ],// optional. Line-of-sight blockers, read by
                                  //   Targeting.hasLineOfSight. RECTANGLES ONLY —
                                  //   targeting.js indexes x/y/w/h with no shape
                                  //   dispatch, so a circle here would silently
                                  //   disable LOS. A rock that blocks both sight
                                  //   and building goes in `blocked` AND here.
       removable: [               // optional. Obstacles the player can pay to
         { x: 300, y: 200,        //   clear. Circles only.
           r: 26, cost: 220,
           name: 'Fallen Log',
           blocksLOS: false }     //   optional; true also adds an LOS blocker
       ],                         //   that disappears when the obstacle is cleared.

       palette: {                 // optional. Hints for the terrain painter; any
         grass, grassAlt,         //   key you omit falls back to
         path, pathEdge,          //   Maps.DEFAULT_PALETTE, so the renderer can
         water, rock,             //   always read every key. Extra keys are
         accent, fog              //   passed through untouched.
       }
     }

     REGION SHAPES — `water` and `blocked` entries are either
         { x, y, w, h }     axis-aligned rect, w > 0 and h > 0
         { cx, cy, r }      circle, r > 0
     and are normalised to carry `kind: 'rect' | 'circle'`. Anything else throws.

     ---------------------------------------------------------------------------
     THE BUILT MAP — what `Maps.build(def)` returns and `Sim.create({map})` takes:

       { key, name, tier, blurb,
         paths: [OP.Track],       // smoothing already applied
         water, blocked, blockers, removable,   // normalised copies
         blockersAll,             // blockers incl. obstacle-derived ones
         trackWidth, palette,
         cleared: []              // indices of removable[] already paid for
       }

     `cleared` lives on the BUILT map because `Maps.canPlace(map, def, x, y)` has
     no `sim` to read — it is an array of integers so it serialises, and
     `Maps.clearedState` / `Maps.restoreCleared` move it in and out of a save.
     Build a fresh map per game: the registered definition is never mutated, and
     two sims must not share one `cleared` array.

     ---------------------------------------------------------------------------
     PLACEMENT MASK GUARDS — `canPlace` is called for EVERY placement, including
     against the bare `{ key, paths }` maps the harness fixtures use. So each rule
     is enforced only when the map actually declares the field it needs:

       path margin   only when `trackWidth` is a number > 0
       land/water    only when `water` is an Array (`[]` counts — a dry built map
                     still forbids water towers everywhere)
       blocked       only when `blocked` is an Array
       obstacles     only when `removable` is an Array

     `build()` always emits all four, so a real map is strict while a fixture map
     stays permissive. This is load-bearing, not politeness.

     Rule ORDER is also load-bearing, because the first refusal is the string the
     UI shows: field bounds, then `blocked`, then the path margin, then removable
     obstacles, then land/water. The margin comes before obstacles so that a rock
     straddling the road never invites the player to pay for a clear that leaves
     the spot unbuildable anyway.

     ---------------------------------------------------------------------------
     THE API

       Maps.define(def)                -> registered def   (throws on anything bad)
       Maps.get(key) / exists(key) / all() / byTier(tier)
       Maps.build(defOrKey)            -> runtime map      (validates first)
       Maps.canPlace(map, towerDef, x, y)  -> { ok, reason }
       Maps.clearObstacle(sim, i)      -> { ok, reason }   (charges the cost)
       Maps.clearedState(sim) / restoreCleared(sim, arr)   (save round-trip)
       Maps.reversePaths(map)          -> a copy running exit-to-entry
       Maps.buildableFraction(map[, opts]) -> 0..1 by grid sampling
       Maps.isWater / isBlocked / onPath / distanceToPath / obstacleAt / isCleared
       Maps.totalPathLength(map)
     ============================================================================ */

  const Maps = {}

  Maps.TIERS = ['beginner', 'intermediate', 'advanced', 'expert']
  Maps.MAX_PATHS = 3
  Maps.MAX_SMOOTH = 24

  // Every key the terrain painter may read. A definition's palette is merged over
  // this, so the renderer never has to guard for a missing colour.
  Maps.DEFAULT_PALETTE = {
    grass: '#3d5a37',
    grassAlt: '#47673f',
    path: '#6d5a41',
    pathEdge: '#51422d',
    water: '#2c4f63',
    rock: '#55554e',
    accent: '#c9a227',
    fog: '#0e1410'
  }

  // Built geometry is allowed to touch a field edge exactly; floating-point dust
  // at an entry authored at x = 0 is not a map bug.
  const EDGE_EPS = 1e-6

  /* ---------- validation helpers ---------- */

  function bad (def, msg) {
    throw new Error('map "' + ((def && def.key) || '?') + '": ' + msg)
  }

  function fin (v) { return typeof v === 'number' && isFinite(v) }

  // OP.MAPS is a plain object, so a bare `OP.MAPS[key]` treats every inherited
  // Object.prototype name as a registered map: exists('constructor') was true and
  // get('toString') handed back a Function. Every registry read goes through this.
  function own (obj, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)
  }

  function keysOf (o) {
    try { return Object.keys(o).join(',') } catch (e) { return String(o) }
  }

  /**
   * Normalise one water/blocked region, or throw. Rects keep x/y/w/h, circles
   * keep cx/cy/r, and both gain `kind` so nothing downstream has to sniff shapes.
   */
  function normRegion (def, region, where, rectOnly) {
    if (!region || typeof region !== 'object') {
      bad(def, where + ' must be an object, got ' + region)
    }
    const looksCircle = region.r !== undefined || region.cx !== undefined || region.cy !== undefined
    if (looksCircle) {
      if (rectOnly) {
        bad(def, where + ' must be a rect {x,y,w,h} — line-of-sight blockers are ' +
          'rectangles only, because Targeting.hasLineOfSight reads x/y/w/h with no shape dispatch')
      }
      if (!fin(region.cx) || !fin(region.cy) || !fin(region.r)) {
        bad(def, where + ' looks like a circle but cx/cy/r are not all finite numbers {' + keysOf(region) + '}')
      }
      if (!(region.r > 0)) bad(def, where + ' needs a positive radius, got ' + region.r)
      return { kind: 'circle', cx: region.cx, cy: region.cy, r: region.r }
    }
    if (!fin(region.x) || !fin(region.y) || !fin(region.w) || !fin(region.h)) {
      bad(def, where + ' must be a rect {x,y,w,h} or a circle {cx,cy,r}, got {' + keysOf(region) + '}')
    }
    if (!(region.w > 0) || !(region.h > 0)) {
      bad(def, where + ' needs a positive width and height, got ' + region.w + 'x' + region.h)
    }
    return { kind: 'rect', x: region.x, y: region.y, w: region.w, h: region.h }
  }

  function normRegionList (def, list, label, rectOnly) {
    if (list === undefined || list === null) return []
    if (!Array.isArray(list)) bad(def, label + ' must be an array, got ' + typeof list)
    return list.map(function (r, i) {
      return normRegion(def, r, label + '[' + i + ']', rectOnly)
    })
  }

  function normRemovable (def, list) {
    if (list === undefined || list === null) return []
    if (!Array.isArray(list)) bad(def, 'removable must be an array, got ' + typeof list)
    return list.map(function (o, i) {
      const where = 'removable[' + i + ']'
      if (!o || typeof o !== 'object') bad(def, where + ' must be an object, got ' + o)
      if (!fin(o.x) || !fin(o.y) || !fin(o.r)) {
        bad(def, where + ' needs finite x, y and r {' + keysOf(o) + '}')
      }
      if (!(o.r > 0)) bad(def, where + ' needs a positive radius, got ' + o.r)
      if (!fin(o.cost) || o.cost < 0) bad(def, where + ' needs a cost >= 0, got ' + o.cost)
      if (!o.name || typeof o.name !== 'string') bad(def, where + ' needs a name, so the UI can say what it is')
      return {
        x: o.x, y: o.y, r: o.r,
        cost: Math.ceil(o.cost),
        name: o.name,
        blocksLOS: !!o.blocksLOS
      }
    })
  }

  /**
   * Validate + deep-copy a definition, and build its tracks so the geometry can
   * be checked. Returns { def, tracks }. Throws on anything malformed, always
   * naming the map — a map that only fails in a playtest three phases later is
   * exactly what this is here to prevent.
   */
  function prepare (raw, opts) {
    opts = opts || {}
    if (!raw || typeof raw !== 'object') throw new Error('map: definition must be an object, got ' + raw)
    if (!raw.key || typeof raw.key !== 'string') bad(raw, 'needs a string key')
    if (opts.checkDuplicate && own(OP.MAPS, raw.key)) bad(raw, 'key is already registered')
    if (!raw.name || typeof raw.name !== 'string') bad(raw, 'needs a display name')
    if (Maps.TIERS.indexOf(raw.tier) < 0) {
      bad(raw, 'tier must be one of ' + Maps.TIERS.join(', ') + ', got ' + raw.tier)
    }
    if (!raw.blurb || typeof raw.blurb !== 'string') bad(raw, 'needs a blurb for the map picker')

    if (!Array.isArray(raw.paths) || raw.paths.length < 1) {
      bad(raw, 'needs at least one path')
    }
    if (raw.paths.length > Maps.MAX_PATHS) {
      bad(raw, 'has ' + raw.paths.length + ' paths; the maximum is ' + Maps.MAX_PATHS)
    }
    if (!fin(raw.trackWidth) || !(raw.trackWidth > 0)) {
      bad(raw, 'trackWidth must be a positive number, got ' + raw.trackWidth)
    }

    const paths = raw.paths.map(function (p, pi) {
      const where = 'path ' + pi
      if (!p || typeof p !== 'object') bad(raw, where + ' must be an object, got ' + p)
      // A Track also has `.points` — the ALREADY SMOOTHED polyline — so without
      // this guard prepare() happily re-smooths a built map and returns different
      // geometry (a 6-point smooth-3 lane went 21 samples/1729.70 units ->
      // 81 samples/1737.80, and blockersAll grew by one obstacle rect per pass).
      // A silent geometry drift under a save that only stores `key` is exactly
      // the failure ARCHITECTURE.md §1 rebuilds tracks to avoid.
      if (typeof p.posAt === 'function' || (OP.Track && p instanceof OP.Track)) {
        bad(raw, where + ' is already a built Track — Maps.build() takes an authored ' +
          'definition, not a built map. Rebuild from Maps.get(key) (or the def you ' +
          'passed to define()); re-smoothing a smoothed polyline changes the geometry.')
      }
      if (!Array.isArray(p.points)) bad(raw, where + ' needs a points array')
      if (p.points.length < 2) {
        bad(raw, where + ' has ' + p.points.length + ' point(s); a path needs at least two')
      }
      const points = p.points.map(function (pt, i) {
        if (!pt || !fin(pt.x) || !fin(pt.y)) {
          bad(raw, where + ' point ' + i + ' needs finite x and y {' + keysOf(pt || {}) + '}')
        }
        if (pt.x < 0 || pt.x > OP.FIELD_W || pt.y < 0 || pt.y > OP.FIELD_H) {
          bad(raw, where + ' point ' + i + ' (' + pt.x + ',' + pt.y + ') is outside the ' +
            OP.FIELD_W + 'x' + OP.FIELD_H + ' field')
        }
        return { x: pt.x, y: pt.y }
      })
      const smooth = p.smooth === undefined ? 0 : p.smooth
      if (!fin(smooth) || smooth < 0 || Math.floor(smooth) !== smooth) {
        bad(raw, where + ' smooth must be a whole number >= 0, got ' + p.smooth)
      }
      if (smooth > Maps.MAX_SMOOTH) {
        bad(raw, where + ' smooth ' + smooth + ' exceeds the cap of ' + Maps.MAX_SMOOTH +
          ' — that many subdivisions is a typo, not a curve')
      }
      return { points: points, smooth: smooth, name: p.name || '' }
    })

    const def = {
      key: raw.key,
      name: raw.name,
      tier: raw.tier,
      blurb: raw.blurb,
      paths: paths,
      trackWidth: raw.trackWidth,
      water: normRegionList(raw, raw.water, 'water', false),
      blocked: normRegionList(raw, raw.blocked, 'blocked', false),
      blockers: normRegionList(raw, raw.blockers, 'blockers', true),
      removable: normRemovable(raw, raw.removable),
      palette: normPalette(raw)
    }

    // Build now, so a map whose SMOOTHED curve leaves the field fails here rather
    // than sending balloons through the HUD. Catmull-Rom overshoots its control
    // polygon; the per-point check above is necessary and not sufficient.
    const tracks = def.paths.map(function (p, pi) {
      let track
      try {
        track = new OP.Track(p.points, { smooth: p.smooth, name: p.name })
      } catch (e) {
        bad(raw, 'path ' + pi + ' could not be built: ' + e.message)
      }
      if (!(track.length > 0)) bad(raw, 'path ' + pi + ' has zero length')
      const b = track.bounds()
      if (b.x0 < -EDGE_EPS || b.y0 < -EDGE_EPS ||
          b.x1 > OP.FIELD_W + EDGE_EPS || b.y1 > OP.FIELD_H + EDGE_EPS) {
        bad(raw, 'path ' + pi + ' leaves the field once smoothed: bounds ' +
          '(' + b.x0.toFixed(2) + ',' + b.y0.toFixed(2) + ')-(' + b.x1.toFixed(2) + ',' + b.y1.toFixed(2) + ')' +
          ' — Catmull-Rom overshoots corners, so move the control point inward or lower smooth')
      }
      return track
    })

    return { def: def, tracks: tracks }
  }

  function normPalette (raw) {
    const out = {}
    for (const k in Maps.DEFAULT_PALETTE) out[k] = Maps.DEFAULT_PALETTE[k]
    const p = raw.palette
    if (p === undefined || p === null) return out
    if (typeof p !== 'object' || Array.isArray(p)) bad(raw, 'palette must be an object of colour hints')
    for (const k in p) {
      if (typeof p[k] !== 'string') bad(raw, 'palette.' + k + ' must be a string, got ' + typeof p[k])
      out[k] = p[k]
    }
    return out
  }

  /* ---------- registry ---------- */

  Maps.define = function (def) {
    const prepared = prepare(def, { checkDuplicate: true })
    OP.MAPS[prepared.def.key] = prepared.def
    OP.MAP_ORDER.push(prepared.def.key)
    return prepared.def
  }

  Maps.exists = function (key) { return own(OP.MAPS, key) }

  Maps.get = function (key) {
    if (!own(OP.MAPS, key)) throw new Error('unknown map: ' + key)
    return OP.MAPS[key]
  }

  Maps.all = function () {
    const out = []
    for (let i = 0; i < OP.MAP_ORDER.length; i++) {
      if (own(OP.MAPS, OP.MAP_ORDER[i])) out.push(OP.MAPS[OP.MAP_ORDER[i]])
    }
    return out
  }

  Maps.byTier = function (tier) {
    if (Maps.TIERS.indexOf(tier) < 0) {
      throw new Error('unknown map tier: ' + tier + ' (expected one of ' + Maps.TIERS.join(', ') + ')')
    }
    return Maps.all().filter(function (d) { return d.tier === tier })
  }

  /* ---------- build ---------- */

  /**
   * Turn a definition (or a registered key) into the runtime map `Sim.create`
   * takes. Validates first, so a hand-written def can never produce a half-built
   * map. Idempotent: building the same def twice yields equivalent geometry and
   * two independent `cleared` arrays.
   */
  Maps.build = function (defOrKey) {
    const raw = typeof defOrKey === 'string' ? Maps.get(defOrKey) : defOrKey
    const prepared = prepare(raw, { checkDuplicate: false })
    const def = prepared.def

    const map = {
      key: def.key,
      name: def.name,
      tier: def.tier,
      blurb: def.blurb,
      paths: prepared.tracks,
      water: def.water,
      blocked: def.blocked,
      blockers: null,          // filled by syncBlockers
      blockersAll: null,
      removable: def.removable,
      trackWidth: def.trackWidth,
      palette: def.palette,
      cleared: [],
      reversed: false
    }

    // Obstacle-derived LOS blockers are kept in one list and filtered by the
    // cleared set, so clearing an obstacle restores sight lines without anyone
    // having to reconstruct the original blocker array.
    const all = def.blockers.slice()
    for (let i = 0; i < def.removable.length; i++) {
      const o = def.removable[i]
      if (!o.blocksLOS) continue
      all.push({ kind: 'rect', x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2, obstacle: i })
    }
    map.blockersAll = all
    syncBlockers(map)
    return map
  }

  /** Recompute the live LOS blocker list from `cleared`. */
  function syncBlockers (map) {
    const all = map.blockersAll || map.blockers || []
    map.blockers = all.filter(function (b) {
      return b.obstacle === undefined || !Maps.isCleared(map, b.obstacle)
    })
    return map.blockers
  }

  /* ---------- geometry queries ---------- */

  function pointInRegion (r, x, y) {
    if (r.kind === 'circle' || (r.r !== undefined && r.cx !== undefined)) {
      return M.dist2(x, y, r.cx, r.cy) <= r.r * r.r
    }
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  }

  function inAny (list, x, y) {
    if (!Array.isArray(list)) return false
    for (let i = 0; i < list.length; i++) if (pointInRegion(list[i], x, y)) return true
    return false
  }

  Maps.isWater = function (map, x, y) { return inAny(map && map.water, x, y) }
  Maps.isBlocked = function (map, x, y) { return inAny(map && map.blocked, x, y) }

  /** Distance to the nearest path centreline, or Infinity if the map has none. */
  Maps.distanceToPath = function (map, x, y) {
    let best = Infinity
    const paths = (map && map.paths) || []
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]
      if (!p || typeof p.distanceTo !== 'function') continue
      const d = p.distanceTo(x, y)
      if (d < best) best = d
    }
    return best
  }

  /** Is this spot on the road, or inside its unbuildable margin? */
  Maps.onPath = function (map, x, y) {
    if (!map || !fin(map.trackWidth) || !(map.trackWidth > 0)) return false
    return Maps.distanceToPath(map, x, y) <= map.trackWidth
  }

  Maps.isCleared = function (map, index) {
    return !!(map && Array.isArray(map.cleared) && map.cleared.indexOf(index) >= 0)
  }

  /** Index of the UNCLEARED removable obstacle covering (x,y), or -1. */
  Maps.obstacleAt = function (map, x, y) {
    const list = (map && map.removable) || []
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      if (Maps.isCleared(map, i)) continue
      if (M.dist2(x, y, o.x, o.y) <= o.r * o.r) return i
    }
    return -1
  }

  /* ---------- the placement mask ---------- */

  /**
   * Can `towerDef` stand at (x,y) on this map? Returns { ok, reason } with a
   * distinct human-readable reason per rule, because the UI shows it verbatim.
   *
   * Called from Towers.canPlaceShape for every placement, so each rule is gated
   * on the map declaring the field it needs — see the guard table at the top of
   * this file. The margin test is inclusive (`distance <= trackWidth` refuses)
   * and does NOT add the tower's footprint: `trackWidth` is authored to include a
   * typical tower radius, which keeps a map's buildable area the same for every
   * tower and knowable at authoring time.
   */
  Maps.canPlace = function (map, towerDef, x, y) {
    if (!map) return { ok: false, reason: 'No map loaded.' }
    if (!fin(x) || !fin(y)) return { ok: false, reason: 'Outside the play field.' }
    if (x < 0 || y < 0 || x > OP.FIELD_W || y > OP.FIELD_H) {
      return { ok: false, reason: 'Outside the play field.' }
    }

    if (Array.isArray(map.blocked) && inAny(map.blocked, x, y)) {
      return { ok: false, reason: 'Blocked terrain — nothing can be built here.' }
    }

    // The path margin is tested BEFORE the obstacle prompt, deliberately. A rock
    // wide enough to straddle the road otherwise answers "Clear the Boulder first
    // ($200)" for a spot dead-centre of the track — the player pays and still
    // cannot build there. Ordering it this way means every "Clear the X first"
    // names a spot that really does become buildable once X is gone.
    if (fin(map.trackWidth) && map.trackWidth > 0 && Maps.distanceToPath(map, x, y) <= map.trackWidth) {
      return { ok: false, reason: 'Too close to the path.' }
    }

    if (Array.isArray(map.removable)) {
      const oi = Maps.obstacleAt(map, x, y)
      if (oi >= 0) {
        const o = map.removable[oi]
        return { ok: false, reason: 'Clear the ' + o.name + ' first ($' + o.cost + ').' }
      }
    }

    const placement = (towerDef && towerDef.placement) || 'land'
    if (placement !== 'any' && Array.isArray(map.water)) {
      const wet = Maps.isWater(map, x, y)
      if (placement === 'water' && !wet) {
        return { ok: false, reason: 'This tower can only be placed on water.' }
      }
      if (placement !== 'water' && wet) {
        return { ok: false, reason: 'This tower cannot be placed on water.' }
      }
    }

    return { ok: true, reason: '' }
  }

  /* ---------- removable obstacles ---------- */

  /**
   * Buy the removal of `removable[index]`. The cleared set lives on the built map
   * as an array of integers, so it serialises — see Maps.clearedState.
   */
  Maps.clearObstacle = function (sim, index) {
    const map = sim && sim.map
    if (!map || !Array.isArray(map.removable) || !map.removable.length) {
      return { ok: false, reason: 'This map has no removable obstacles.' }
    }
    // A whole number only. Truncating instead would let a caller that passed 1.7
    // charge the player for — and clear — obstacle 1, which is not what it asked
    // for and is impossible to notice from the outside.
    const i = Number(index)
    if (!isFinite(i) || Math.floor(i) !== i || i < 0 || i >= map.removable.length) {
      return { ok: false, reason: 'No such obstacle.' }
    }
    if (Maps.isCleared(map, i)) return { ok: false, reason: 'That obstacle is already cleared.' }

    const o = map.removable[i]
    // Clearing is a purchase, so it scales with the difficulty cost multiplier
    // exactly like a tower does.
    const econ = OP.Economy
    const cost = econ ? econ.price(sim, o.cost) : o.cost
    if (cost > 0 && econ) {
      if (!econ.canAfford(sim, cost)) {
        return { ok: false, reason: 'Not enough cash — clearing the ' + o.name + ' costs $' + cost + '.' }
      }
      econ.spend(sim, cost)
    }

    if (!Array.isArray(map.cleared)) map.cleared = []
    map.cleared.push(i)
    map.cleared.sort(function (a, b) { return a - b })
    syncBlockers(map)

    if (sim.events) sim.events.push({ kind: 'clearobstacle', index: i, cost: cost, name: o.name })
    return { ok: true, reason: '' }
  }

  /** Plain-data cleared set, for the save file. */
  Maps.clearedState = function (sim) {
    const map = sim && sim.map
    return map && Array.isArray(map.cleared) ? map.cleared.slice() : []
  }

  /** Restore a cleared set onto a freshly built map. Ignores junk indices. */
  Maps.restoreCleared = function (sim, arr) {
    const map = sim && sim.map
    if (!map) return []
    const n = Array.isArray(map.removable) ? map.removable.length : 0
    const seen = {}
    const out = []
    const list = Array.isArray(arr) ? arr : []
    for (let k = 0; k < list.length; k++) {
      const i = Math.trunc(Number(list[k]))
      if (!isFinite(i) || i < 0 || i >= n || seen[i]) continue
      seen[i] = true
      out.push(i)
    }
    out.sort(function (a, b) { return a - b })
    map.cleared = out
    syncBlockers(map)
    return out
  }

  /* ---------- reverse mode ---------- */

  /**
   * A copy of `map` whose paths run exit-to-entry, for the Reverse mode. Never
   * mutates its argument, and never re-smooths: the already-smoothed polyline is
   * reversed point-for-point, so the reversed track has the same length and the
   * same shape with its endpoints swapped.
   */
  Maps.reversePaths = function (map) {
    if (!map) throw new Error('Maps.reversePaths needs a map')
    const out = Object.assign({}, map)

    out.paths = (map.paths || []).map(function (p) {
      if (p && Array.isArray(p.points) && typeof p.posAt === 'function') {
        return new OP.Track(p.points.slice().reverse(), { smooth: 0, name: p.name || '' })
      }
      if (p && Array.isArray(p.points)) {
        return { points: p.points.slice().reverse(), smooth: p.smooth || 0, name: p.name || '' }
      }
      throw new Error('Maps.reversePaths: path is neither a Track nor a points list')
    })

    out.water = copyList(map.water)
    out.blocked = copyList(map.blocked)
    out.blockersAll = copyList(map.blockersAll || map.blockers)
    out.removable = copyList(map.removable)
    out.palette = Object.assign({}, map.palette)
    out.cleared = Array.isArray(map.cleared) ? map.cleared.slice() : []
    out.reversed = !map.reversed
    syncBlockers(out)
    return out
  }

  // undefined / null pass straight through: a fixture map that declares no water
  // must stay permissive after reversal, and an empty array is NOT the same thing
  // (see the guard table at the top of this file).
  function copyList (list) {
    if (!Array.isArray(list)) return list
    return list.map(function (o) { return Object.assign({}, o) })
  }

  /* ---------- roster sanity ---------- */

  /**
   * Fraction of the field a land tower could stand on, by sampling a grid. The
   * roster suite uses it to catch a map that is beautiful and unplayable — a
   * trackWidth typo or an over-enthusiastic blocked region.
   *
   * @param {object} map   a BUILT map
   * @param {{step?:number, placement?:string, footprint?:number}} [opts]
   */
  Maps.buildableFraction = function (map, opts) {
    opts = opts || {}
    const step = fin(opts.step) && opts.step > 0 ? opts.step : 16
    const footprint = fin(opts.footprint) ? opts.footprint : 14
    const probe = { placement: opts.placement || 'land', footprint: footprint, name: 'Probe' }
    let total = 0, ok = 0
    for (let y = footprint; y <= OP.FIELD_H - footprint; y += step) {
      for (let x = footprint; x <= OP.FIELD_W - footprint; x += step) {
        total++
        if (Maps.canPlace(map, probe, x, y).ok) ok++
      }
    }
    return total ? ok / total : 0
  }

  /** Total path length across every lane — a rough "how long is this map". */
  Maps.totalPathLength = function (map) {
    let sum = 0
    const paths = (map && map.paths) || []
    for (let i = 0; i < paths.length; i++) sum += paths[i].length || 0
    return sum
  }

  OP.Maps = Maps
  OP.defineMap = Maps.define
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))

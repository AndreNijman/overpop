// The shipped beginner and intermediate map tiers.
//
// tools/suites/maps.mjs tests the LOADER against throwaway definitions written
// inside that file. This suite tests the CONTENT: the eight maps in
// js/data/maps-beginner.js and js/data/maps-intermediate.js. Every claim those
// two files make in their comment headers is asserted here, and every number the
// assertion turns on is printed in its message — a map that drifts should say
// what it drifted to, not just that it failed.
//
// Two things this suite deliberately does not do:
//
//   · It never derives its subject list from Maps.byTier(). Other suites register
//     throwaway maps into the same shared OP.MAPS — several of them tiered
//     'beginner' or 'intermediate' — so byTier() would audit fixtures alongside
//     the roster. The subject list is OP.MAP_ROSTERS[tier], which each data file
//     builds from its own array of definitions, so a fifth map cannot be added
//     without this suite seeing it (and tripping the count).
//   · It never places a tower with { free: true }. Towers.place skips canPlace
//     entirely when free, which would prove nothing about whether the map's
//     placement mask lets a real build happen. Every tower here is paid for out
//     of a fat starting purse.

export const name = 'map-roster-early'
export const needs = ['js/data/maps-beginner.js', 'js/data/maps-intermediate.js']

/* ---------- the design contract, per tier ---------- */

const TIERS = [
  {
    tier: 'beginner',
    expect: 4,
    lenLo: 2200, lenHi: 3200,
    minPaths: 1, maxPaths: 1,
    buildFloor: 0.66,          // generous open ground
    losBlockers: false,        // none at all, derived ones included
    removables: false          // and therefore no obstacle-derived blockers either
  },
  {
    tier: 'intermediate',
    expect: 4,
    lenLo: 2600, lenHi: 4000,
    minPaths: 1, maxPaths: 2,
    buildFloor: 0.54,          // less open ground than beginner
    losBlockers: true,         // a couple per map
    removables: true           // one or two per map
  }
]

// Mechanics are not protectable; names are. Same two lists the tower-family floor
// uses: the acronyms collide with ordinary English so they are matched
// case-sensitively, the rest are unambiguous in any casing.
const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/

/* ---------- a recording 2d context, for the paint-does-not-mutate check ---------- */

function recorder () {
  const calls = []
  const noop = n => function () { calls.push(n) }
  const ctx = { calls }
  for (const m of ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform',
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fill',
    'stroke', 'clip', 'drawImage', 'fillText', 'strokeText', 'setLineDash']) ctx[m] = noop(m)
  ctx.getLineDash = () => []
  ctx.measureText = () => ({ width: 10 })
  ctx.getImageData = (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) })
  ctx.isPointInPath = () => false
  ctx.createLinearGradient = () => ({ addColorStop () {} })
  ctx.createRadialGradient = () => ({ addColorStop () {} })
  ctx.createPattern = () => ({ setTransform () {} })
  return ctx
}

export function run (t, OP) {
  const Maps = OP.Maps
  const W = OP.FIELD_W
  const H = OP.FIELD_H

  const LAND = { placement: 'land', footprint: 14, name: 'Land Probe' }
  const WATER = { placement: 'water', footprint: 12, name: 'Water Probe' }

  /* ---------- local helpers ---------- */

  function mkSim (map) {
    return OP.Sim.create({
      map: map,
      seed: 'map-roster-early',
      rules: { startCash: 500000, startLives: 400 }
    })
  }

  /** Does a footprint of this size fit inside the field at (x,y)? */
  function inFieldFor (def, x, y) {
    return x - def.footprint >= 0 && x + def.footprint <= W &&
           y - def.footprint >= 0 && y + def.footprint <= H
  }

  /** A legal spot for `def` near track position `t`, spiralling outward. */
  function spotNearTrack (sim, map, def, pathIndex, at, maxDist) {
    const p = map.paths[pathIndex].posAt(at)
    for (let r = map.trackWidth + def.footprint + 4; r <= maxDist; r += 6) {
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2
        const x = Math.round(p.x + Math.cos(ang) * r)
        const y = Math.round(p.y + Math.sin(ang) * r)
        if (!inFieldFor(def, x, y)) continue
        if (OP.Towers.canPlaceShape(sim, def, x, y).ok) return { x: x, y: y }
      }
    }
    return null
  }

  /** Any legal land spot on the map, by coarse grid scan. */
  function anyLandSpot (map) {
    for (let y = 24; y <= H - 24; y += 8) {
      for (let x = 24; x <= W - 24; x += 8) {
        if (Maps.canPlace(map, LAND, x, y).ok) return { x: x, y: y }
      }
    }
    return null
  }

  /** Points inside one normalised water region, on a 6-unit lattice. */
  function regionSpots (w) {
    const out = []
    if (w.kind === 'circle') {
      for (let dy = -w.r; dy <= w.r; dy += 6) {
        for (let dx = -w.r; dx <= w.r; dx += 6) {
          if (dx * dx + dy * dy <= w.r * w.r) out.push({ x: w.cx + dx, y: w.cy + dy })
        }
      }
    } else {
      for (let y = w.y; y <= w.y + w.h; y += 6) {
        for (let x = w.x; x <= w.x + w.w; x += 6) out.push({ x: x, y: y })
      }
    }
    return out
  }

  /** The legal spot inside `w` that sits closest to the road. */
  function bestWaterSpot (map, def, w) {
    let best = null, bestD = Infinity, legal = 0
    const pts = regionSpots(w)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (!inFieldFor(def, p.x, p.y)) continue
      if (!Maps.canPlace(map, def, p.x, p.y).ok) continue
      legal++
      const d = Maps.distanceToPath(map, p.x, p.y)
      if (d < bestD) { bestD = d; best = p }
    }
    return { spot: best, dist: bestD, legal: legal }
  }

  // The two weakest tiers, whatever the roster calls them — never the literals.
  const WEAK = OP.BALLOON_TIERS[0].key
  const NEXT = OP.BALLOON_TIERS[1].key

  function liveBalloons (sim) {
    let n = 0
    for (let i = 0; i < sim.balloons.length; i++) if (sim.balloons[i].alive) n++
    return n
  }

  /**
   * Release `a` of the weakest tier then `b` of the next, one every 12 ticks, and
   * run until the board is clear. Returns the sim so the caller can assert on it.
   */
  function playStream (sim, pathIndex, a, b) {
    let sent = 0
    const total = a + b
    for (let tick = 0; tick < 60 * 240; tick++) {
      if (sent < total && tick % 12 === 0) {
        OP.Balloons.spawn(sim, { tier: sent < a ? WEAK : NEXT, path: pathIndex, t: 0 })
        sent++
      }
      OP.Sim.step(sim)
      if (sent >= total && liveBalloons(sim) === 0) break
    }
    return sim
  }

  /** Self-intersections of the smoothed polyline, ignoring neighbours. */
  function crossings (track) {
    const p = track.points
    let n = 0
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = i + 3; j < p.length - 1; j++) {
        if (OP.M.segSegHit(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y,
          p[j].x, p[j].y, p[j + 1].x, p[j + 1].y)) n++
      }
    }
    return n
  }

  /** Direction reversals along one axis, sampled coarsely with a deadband so a
      spline wobble is not mistaken for a turn. */
  function reversals (track, axis) {
    const step = 70, dead = 22
    let last = 0, n = 0, prev = track.posAt(0)
    for (let at = step; at <= track.length; at += step) {
      const cur = track.posAt(at)
      const d = axis === 'x' ? cur.x - prev.x : cur.y - prev.y
      if (Math.abs(d) > dead) {
        const s = d > 0 ? 1 : -1
        if (last !== 0 && s !== last) n++
        last = s
      }
      prev = cur
    }
    return n
  }

  /**
   * Legal land spots from which a tower of range R covers two stretches of the
   * first lane more than `dt` apart along it. This is the measurable form of
   * "the path doubles back so one tower covers it twice".
   */
  function doubleCoverSpots (map, R, dt) {
    const track = map.paths[0]
    const samples = []
    for (let at = 0; at <= track.length; at += 20) samples.push({ at: at, p: track.posAt(at) })
    let n = 0
    for (let y = 24; y <= H - 24; y += 16) {
      for (let x = 24; x <= W - 24; x += 16) {
        if (!Maps.canPlace(map, LAND, x, y).ok) continue
        let lo = Infinity, hi = -Infinity
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i]
          if (Math.hypot(s.p.x - x, s.p.y - y) <= R) {
            if (s.at < lo) lo = s.at
            if (s.at > hi) hi = s.at
          }
        }
        if (hi - lo >= dt) n++
      }
    }
    return n
  }

  /* ================================================================
     0. the towers this suite tests maps with
     ================================================================ */

  t.section('the towers these maps are tested with are discovered, not named')
  // Read off OP.TOWER_ORDER by predicate: a later roster change must reach this
  // suite rather than sail past it, and hardcoded keys would rot on the first
  // rename.
  const attackers = OP.TOWER_ORDER
    .filter(k => {
      const d = OP.TOWERS[k]
      return d.fire && d.placement === 'land' && d.base.range >= 90 && d.base.range <= 260
    })
    .slice(0, 4)
  t.gte(attackers.length, 3, `found ${attackers.length} land attackers to build with: ${attackers.join(', ')}`)
  if (attackers.length < 3) return

  /* ================================================================
     1. the rosters the two data files declare
     ================================================================ */

  t.section('each data file declares its own roster on OP.MAP_ROSTERS')
  t.ok(OP.MAP_ROSTERS && typeof OP.MAP_ROSTERS === 'object',
    'OP.MAP_ROSTERS exists — the map-tier equivalent of OP.FAMILY_ROSTERS')

  const rosters = {}
  let rosterOk = true
  for (const spec of TIERS) {
    const keys = OP.MAP_ROSTERS && OP.MAP_ROSTERS[spec.tier]
    if (!t.ok(Array.isArray(keys) && keys.length > 0,
      `the ${spec.tier} file declared OP.MAP_ROSTERS.${spec.tier}`)) { rosterOk = false; continue }
    rosters[spec.tier] = keys
    t.eq(keys.length, spec.expect, `exactly ${spec.expect} ${spec.tier} maps, got ${keys.length}: ${keys.join(', ')}`)
    t.eq(new Set(keys).size, keys.length, `${spec.tier} keys are unique`)
  }
  if (!rosterOk) return

  const ALL = rosters.beginner.concat(rosters.intermediate)
  t.eq(ALL.length, 8, `eight maps across the two early tiers, got ${ALL.length}`)
  t.eq(new Set(ALL).size, ALL.length, 'no key is shared between the two tiers')

  t.section('every declared key is a registered map of the right tier')
  const defs = {}
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      if (!t.ok(Maps.exists(key), `${key} is registered in OP.MAPS`)) continue
      const def = Maps.get(key)
      defs[key] = def
      t.eq(def.tier, spec.tier, `${key} claims tier "${def.tier}"`)
      t.ok(OP.MAP_ORDER.indexOf(key) >= 0, `${key} is in OP.MAP_ORDER, so the picker lists it`)
      t.ok(Maps.byTier(spec.tier).some(d => d.key === key), `${key} comes back from byTier('${spec.tier}')`)
    }
  }
  if (Object.keys(defs).length !== 8) return

  t.section('names and blurbs are original, distinct and shippable')
  const names = ALL.map(k => defs[k].name)
  t.eq(new Set(names).size, names.length, `all eight names are distinct: ${names.join(' · ')}`)
  for (const key of ALL) {
    const def = defs[key]
    t.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key), `${key} is lowercase kebab-case — it is what a save records`)
    t.ok(def.name.length >= 4 && def.name === def.name.trim(), `${key} has a display name: "${def.name}"`)
    t.ok(def.blurb.length > 30 && /[.!]$/.test(def.blurb),
      `${key} has a real picker blurb (${def.blurb.length} chars)`)
    // Everything an author types, in one blob: names, blurb, obstacle names, lane names.
    const blob = JSON.stringify({
      key: def.key, name: def.name, blurb: def.blurb,
      lanes: def.paths.map(p => p.name || ''),
      rocks: def.removable.map(o => o.name)
    })
    const hit = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${key} uses no borrowed proper nouns` + (hit ? ` — found "${hit}"` : ''))
  }

  /* ================================================================
     2. every map builds, and building never touches the definition
     ================================================================ */

  t.section('every map builds via Maps.build, from its key and from its definition')
  const built = {}
  for (const key of ALL) {
    const snapshot = JSON.stringify(defs[key])
    let map = null
    try { map = Maps.build(key) } catch (e) { t.fail(`${key} builds from its key`, e.message); continue }
    t.ok(map && map.paths && map.paths.length, `${key} builds from its key`)
    t.noThrow(() => Maps.build(defs[key]), `${key} builds from its definition object too`)
    t.eq(JSON.stringify(defs[key]), snapshot,
      `${key}: building did not mutate the registered definition`)
    built[key] = map
  }
  if (Object.keys(built).length !== 8) return

  t.section('two builds of one map share no mutable state')
  for (const key of ALL) {
    const a = Maps.build(key)
    const b = Maps.build(key)
    a.cleared.push(0)
    t.eq(b.cleared.length, 0, `${key}: two sims do not share one cleared array`)
    t.neq(a.paths[0], b.paths[0], `${key}: each build gets its own Track instances`)
    t.close(a.paths[0].length, b.paths[0].length, 1e-9, `${key}: and identical geometry both times`)
  }

  t.section('every palette key the terrain painter reads resolves to a colour')
  const palettes = []
  for (const key of ALL) {
    const map = built[key]
    const missing = Object.keys(Maps.DEFAULT_PALETTE).filter(k => typeof map.palette[k] !== 'string')
    t.eq(missing.length, 0, `${key} palette covers every default key` + (missing.length ? `: missing ${missing.join(', ')}` : ''))
    const authored = Object.keys(defs[key].palette).filter(k => defs[key].palette[k] !== Maps.DEFAULT_PALETTE[k])
    t.gte(authored.length, 3, `${key} authored a real palette hint, not the default (${authored.length} keys differ)`)
    palettes.push(JSON.stringify(map.palette))
    if (OP.Terrain && OP.Terrain.palette) {
      const resolved = OP.Terrain.palette(map)
      const bad = Object.keys(OP.Terrain.DEFAULT_PALETTE).filter(k => typeof resolved[k] !== 'string' || !resolved[k])
      t.eq(bad.length, 0, `${key}: the painter resolves every colour it reads` + (bad.length ? `: ${bad.join(', ')}` : ''))
    }
  }
  t.eq(new Set(palettes).size, palettes.length, 'no two maps ship the same palette — eight places, not one repainted eight times')

  /* ================================================================
     3. geometry: inside the field, on the edges, and in the length band
     ================================================================ */

  t.section('every built track stays inside the ' + W + 'x' + H + ' field')
  for (const key of ALL) {
    built[key].paths.forEach((p, i) => {
      const b = p.bounds()
      const ok = b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H
      t.ok(ok, `${key} lane ${i} bounds (${b.x0.toFixed(1)},${b.y0.toFixed(1)})-(${b.x1.toFixed(1)},${b.y1.toFixed(1)})` +
        ' are inside the field once smoothed')
    })
  }

  t.section('balloons walk in from off-screen and walk out again')
  for (const key of ALL) {
    built[key].paths.forEach((p, i) => {
      const first = p.points[0]
      const last = p.points[p.points.length - 1]
      const onEdge = q => Math.min(q.x, q.y, W - q.x, H - q.y) <= 1e-6
      t.ok(onEdge(first), `${key} lane ${i} enters on a field edge at (${first.x.toFixed(0)},${first.y.toFixed(0)})`)
      t.ok(onEdge(last), `${key} lane ${i} exits on a field edge at (${last.x.toFixed(0)},${last.y.toFixed(0)})`)
    })
  }

  t.section('track lengths sit inside the tier band')
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const map = built[key]
      t.between(map.paths.length, spec.minPaths, spec.maxPaths,
        `${key} has ${map.paths.length} lane(s); ${spec.tier} allows ${spec.minPaths}-${spec.maxPaths}`)
      map.paths.forEach((p, i) => {
        t.between(p.length, spec.lenLo, spec.lenHi,
          `${key} lane ${i} is ${p.length.toFixed(0)} units long (${spec.tier} band ${spec.lenLo}-${spec.lenHi})`)
      })
      // The margin is measured from the centreline and the tower footprint is NOT
      // added at check time, so trackWidth alone has to cover the painted road
      // plus a typical tower radius (~14).
      t.between(map.trackWidth, 24, 40,
        `${key} trackWidth is ${map.trackWidth} — wide enough to cover road plus a tower radius, narrow enough to leave ground`)
    }
  }

  t.section('a wider road on the easier tier')
  const meanWidth = tier => rosters[tier].reduce((s, k) => s + built[k].trackWidth, 0) / rosters[tier].length
  const wB = meanWidth('beginner'), wI = meanWidth('intermediate')
  t.gt(wB, wI, `beginner roads are wider on average (${wB.toFixed(1)} vs ${wI.toFixed(1)})`)

  /* ================================================================
     4. how much of each map can actually be built on
     ================================================================ */

  t.section('buildable ground, measured rather than asserted by eye')
  const frac = {}
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const f = Maps.buildableFraction(built[key], { placement: 'land', step: 8, footprint: 14 })
      frac[key] = f
      t.gte(f, spec.buildFloor,
        `${key} is ${(f * 100).toFixed(1)}% buildable for a land tower (${spec.tier} floor ${(spec.buildFloor * 100).toFixed(0)}%)`)
      t.lt(f, 0.95, `${key} is not a blank field — ${(f * 100).toFixed(1)}% buildable`)
    }
  }
  const meanFrac = tier => rosters[tier].reduce((s, k) => s + frac[k], 0) / rosters[tier].length
  const fB = meanFrac('beginner'), fI = meanFrac('intermediate')
  t.gt(fB, fI, `the intermediate tier really is tighter: ${(fB * 100).toFixed(1)}% vs ${(fI * 100).toFixed(1)}% mean buildable`)

  /* ================================================================
     5. eight shapes, not one shape eight times
     ================================================================ */

  t.section('each map is a distinct shape')
  const sigs = []
  for (const key of ALL) {
    const map = built[key]
    const track = map.paths[0]
    const sig = [reversals(track, 'x'), reversals(track, 'y'), crossings(track),
      Math.round(track.length / 250), map.paths.length].join('/')
    sigs.push({ key: key, sig: sig })
  }
  const bySig = {}
  for (const s of sigs) bySig[s.sig] = (bySig[s.sig] || []).concat(s.key)
  const dupes = Object.keys(bySig).filter(k => bySig[k].length > 1)
  t.eq(dupes.length, 0, 'no two maps share a shape signature (revX/revY/crossings/lengthBucket/lanes)' +
    (dupes.length ? ': ' + dupes.map(k => bySig[k].join('=') + ' both ' + k).join('; ')
      : ': ' + sigs.map(s => s.key + ' ' + s.sig).join(' · ')))

  t.section('the beginner tier spans both placement lessons')
  // One map must reward "put it between two legs"; another must offer nothing of
  // the kind, so the answer there is raw damage. Both are in the tier by design —
  // see the headers of js/data/maps-beginner.js. The radius is the first land
  // attacker's real base range, not a number picked to make this pass.
  const R = OP.TOWERS[attackers[0]].base.range
  const cover = {}
  for (const key of rosters.beginner) cover[key] = doubleCoverSpots(built[key], R, 600)
  const covers = rosters.beginner.map(k => cover[k])
  const report = `at range ${R} (${OP.TOWERS[attackers[0]].name}): ` +
    rosters.beginner.map(k => `${k}=${cover[k]}`).join(' ')
  t.gte(Math.max.apply(null, covers), 40,
    `at least one beginner map lets one tower cover two stretches 600+ units apart — ${report}`)
  t.lte(Math.min.apply(null, covers), 5,
    `and at least one offers essentially none of that, so damage has to do the work — ${report}`)

  /* ================================================================
     6. every map is playable — all eight, every lane
     ================================================================ */

  t.section('a real build on every lane of every map clears a stream of balloons')
  const NWEAK = 30, NNEXT = 10
  const TOTAL = NWEAK + NNEXT
  for (const key of ALL) {
    const laneCount = built[key].paths.length
    for (let pi = 0; pi < laneCount; pi++) {
      const map = Maps.build(key)
      const sim = mkSim(map)
      const placed = []
      for (let i = 0; i < attackers.length; i++) {
        const def = OP.TOWERS[attackers[i]]
        const at = map.paths[pi].length * (i + 0.5) / attackers.length
        const spot = spotNearTrack(sim, map, def, pi, at, def.base.range * 0.7)
        if (!spot) continue
        if (!OP.Towers.canPlace(sim, attackers[i], spot.x, spot.y).ok) continue
        const tower = OP.Towers.place(sim, attackers[i], spot.x, spot.y)
        if (tower) placed.push(attackers[i])
      }
      t.gte(placed.length, 3,
        `${key} lane ${pi}: ${placed.length} real towers found legal ground beside the road (${placed.join(', ')})`)

      playStream(sim, pi, NWEAK, NNEXT)
      // Nothing alive plus nothing leaked is the airtight form of "they all got
      // popped", and it does not depend on how many layers a tier happens to have.
      t.eq(sim.stats.spawned, TOTAL, `${key} lane ${pi}: the whole stream was released (${sim.stats.spawned}/${TOTAL})`)
      t.gt(sim.stats.shotsFired, 0, `${key} lane ${pi}: the towers actually fired (${sim.stats.shotsFired} shots)`)
      t.eq(sim.stats.leaked, 0, `${key} lane ${pi}: nothing reached the exit (${sim.stats.leaked} leaked)`)
      t.eq(liveBalloons(sim), 0, `${key} lane ${pi}: the board came back empty`)
      t.gte(sim.stats.layersPopped, TOTAL,
        `${key} lane ${pi}: ${sim.stats.layersPopped} layers popped for ${TOTAL} ${WEAK}/${NEXT} balloons`)
      t.eq(sim.lives, sim.rules.startLives, `${key} lane ${pi}: lives untouched (${sim.lives})`)
    }
  }

  /* ================================================================
     7. water and land are mutually exclusive, both ways
     ================================================================ */

  t.section('water regions are placeable, in range of the road, and lethal from it')
  const waterKey = OP.TOWER_ORDER.find(k => OP.TOWERS[k].placement === 'water' && OP.TOWERS[k].fire)
  const waterDef = waterKey ? OP.TOWERS[waterKey] : null
  t.ok(waterDef, `the roster has a water-only attacker to test with: ${waterKey}`)

  let wetMaps = 0
  for (const key of ALL) {
    const map = built[key]
    t.ok(Array.isArray(map.water), `${key} exposes a normalised water list (${map.water.length} region(s))`)
    if (!map.water.length || !waterDef) continue
    wetMaps++
    map.water.forEach((w, i) => {
      const found = bestWaterSpot(map, waterDef, w)
      if (!t.ok(found.spot, `${key} water ${i} has somewhere a ${waterDef.name} may legally stand (${found.legal} spots)`)) return
      t.lte(found.dist, waterDef.base.range,
        `${key} water ${i} reaches the road: ${found.dist.toFixed(0)} units from the centreline, ` +
        `inside the ${waterDef.base.range} range of a ${waterDef.name}`)

      // A land tower is refused there, with the reason the UI shows verbatim.
      const landHere = Maps.canPlace(map, LAND, found.spot.x, found.spot.y)
      t.notOk(landHere.ok, `${key} water ${i} refuses a land tower`)
      t.eq(landHere.reason, 'This tower cannot be placed on water.',
        `${key} water ${i} says why: "${landHere.reason}"`)

      // And it really shoots: a stream on lane 0, one water tower, some pops.
      const fresh = Maps.build(key)
      const sim = mkSim(fresh)
      const tower = OP.Towers.place(sim, waterKey, found.spot.x, found.spot.y)
      t.ok(tower, `${key} water ${i}: a paid-for ${waterDef.name} places at (${found.spot.x},${found.spot.y})`)
      if (tower) {
        playStream(sim, 0, 16, 0)
        t.gt(sim.stats.popped, 0,
          `${key} water ${i}: the ${waterDef.name} popped ${sim.stats.popped} balloons from the water`)
      }
    })

    // The mirror rule: a water tower may not stand on dry land.
    const dry = anyLandSpot(map)
    if (t.ok(dry, `${key} has open land to test the mirror rule on`)) {
      const wetHere = Maps.canPlace(map, WATER, dry.x, dry.y)
      t.notOk(wetHere.ok, `${key} refuses a water tower on dry ground at (${dry.x},${dry.y})`)
      t.eq(wetHere.reason, 'This tower can only be placed on water.',
        `${key} says why: "${wetHere.reason}"`)
    }
  }
  t.gte(wetMaps, 5, `${wetMaps} of the eight maps carry water, so the water towers are not dead weight in either tier`)

  t.section('a dry map forbids water towers everywhere — the documented consequence of water: []')
  let dryMaps = 0
  for (const key of ALL) {
    const map = built[key]
    if (map.water.length) continue
    dryMaps++
    let anyWet = 0
    for (let y = 40; y <= H - 40; y += 40) {
      for (let x = 40; x <= W - 40; x += 40) if (Maps.canPlace(map, WATER, x, y).ok) anyWet++
    }
    t.eq(anyWet, 0, `${key} is dry, so a water tower is refused at every one of the sampled spots`)
  }
  t.gte(dryMaps, 1, `${dryMaps} map(s) are deliberately dry`)

  /* ================================================================
     8. line-of-sight blockers
     ================================================================ */

  t.section('beginner maps have no line-of-sight blockers at all')
  for (const key of rosters.beginner) {
    const map = built[key]
    t.eq(map.blockersAll.length, 0,
      `${key} declares no LOS blocker, derived ones included (blockersAll is ${map.blockersAll.length})`)
    t.eq(map.blockers.length, 0, `${key} has no live blocker either`)
    t.eq(map.removable.length, 0,
      `${key} has no removable obstacle, so none can grow a blocker later (${map.removable.length})`)
    t.eq(map.blocked.length, 0, `${key} has no blocked terrain — beginner ground is readable`)
  }

  t.section('intermediate maps block sight, and every rock that blocks sight also blocks building')
  for (const key of rosters.intermediate) {
    const map = built[key]
    const authored = map.blockersAll.filter(b => b.obstacle === undefined)
    t.gte(authored.length, 1, `${key} declares ${authored.length} line-of-sight blocker(s)`)
    for (let i = 0; i < authored.length; i++) {
      const b = authored[i]
      t.eq(b.kind, 'rect', `${key} blocker ${i} is a rect — Targeting reads x/y/w/h with no shape dispatch`)
      const alsoBlocked = map.blocked.some(r => r.kind === 'rect' && r.x === b.x && r.y === b.y &&
        r.w === b.w && r.h === b.h)
      t.ok(alsoBlocked, `${key} blocker ${i} (${b.x},${b.y} ${b.w}x${b.h}) is listed in blocked too, ` +
        'so it is not an invisible wall standing on buildable grass')
      const blockedHere = Maps.canPlace(map, LAND, b.x + b.w / 2, b.y + b.h / 2)
      t.eq(blockedHere.reason, 'Blocked terrain — nothing can be built here.',
        `${key} blocker ${i} refuses a build: "${blockedHere.reason}"`)
    }

    // And the sight line really is cut. Probe across the blocker and beside it.
    const b = authored[0]
    const sim = mkSim(Maps.build(key))
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    t.notOk(OP.Targeting.hasLineOfSight(sim, cx - b.w - 20, cy, cx + b.w + 20, cy),
      `${key}: a shot straight through blocker 0 is cut`)
    t.ok(OP.Targeting.hasLineOfSight(sim, cx - b.w - 20, cy - b.h - 30, cx + b.w + 20, cy - b.h - 30),
      `${key}: a shot passing clear of it is not`)
  }

  /* ================================================================
     9. removable obstacles
     ================================================================ */

  t.section('beginner maps ask the player to pay for nothing')
  for (const key of rosters.beginner) {
    t.eq(built[key].removable.length, 0, `${key} has no removable obstacle`)
  }

  t.section('intermediate obstacles sit on ground that clearing really frees')
  let losObstacles = 0
  for (const key of rosters.intermediate) {
    const map = built[key]
    t.between(map.removable.length, 1, 2,
      `${key} declares ${map.removable.length} removable obstacle(s) — the tier asks for one or two`)

    for (let i = 0; i < map.removable.length; i++) {
      const o = map.removable[i]
      t.ok(o.name && o.name.length > 3, `${key} obstacle ${i} is named "${o.name}", so the UI can say what it is`)
      t.gt(o.cost, 0, `${key} "${o.name}" costs $${o.cost}`)

      // Rule order matters: the path margin is tested BEFORE the obstacle prompt,
      // so an obstacle straddling the road would answer "Too close to the path"
      // and the player would never get the chance to pay.
      const fresh = Maps.build(key)
      const sim = mkSim(fresh)
      const before = Maps.canPlace(fresh, LAND, o.x, o.y)
      t.notOk(before.ok, `${key} "${o.name}" blocks its own ground`)
      t.eq(before.reason, `Clear the ${o.name} first ($${o.cost}).`,
        `${key} "${o.name}" offers the clear: "${before.reason}"`)

      const cashBefore = sim.cash
      const res = OP.Maps.clearObstacle(sim, i)
      t.ok(res.ok, `${key} "${o.name}" clears when paid for` + (res.ok ? '' : ` — ${res.reason}`))
      t.eq(sim.cash, cashBefore - OP.Economy.price(sim, o.cost),
        `${key} "${o.name}" charged $${OP.Economy.price(sim, o.cost)} at this difficulty`)

      const after = Maps.canPlace(fresh, LAND, o.x, o.y)
      t.ok(after.ok, `${key} "${o.name}": clearing it makes the spot buildable` + (after.ok ? '' : ` — ${after.reason}`))

      // A real tower goes there, paid for, which is the claim that matters. No
      // conditional around it: an obstacle parked so close to the edge that
      // nothing fits where it stood is a map bug, so that is asserted rather
      // than skipped.
      const towerDef = OP.TOWERS[attackers[0]]
      t.ok(inFieldFor(towerDef, o.x, o.y),
        `${key} "${o.name}" sits far enough inside the field for a tower to replace it`)
      t.ok(OP.Towers.place(sim, attackers[0], o.x, o.y),
        `${key} "${o.name}": a paid-for ${towerDef.name} now stands where it was`)

      // The other build of the same map is untouched — `cleared` is per-map state.
      t.notOk(Maps.isCleared(built[key], i),
        `${key} "${o.name}": clearing it in one sim left the other build's cleared set alone`)

      if (o.blocksLOS) {
        losObstacles++
        const derivedFresh = Maps.build(key)
        const derived = derivedFresh.blockersAll.filter(bb => bb.obstacle === i)
        t.eq(derived.length, 1, `${key} "${o.name}" grows exactly one derived LOS blocker`)
        const d = derived[0]
        const dsim = mkSim(derivedFresh)
        const px = d.x + d.w / 2, py = d.y + d.h / 2
        t.notOk(OP.Targeting.hasLineOfSight(dsim, px - d.w - 20, py, px + d.w + 20, py),
          `${key} "${o.name}" blocks sight while it stands`)
        t.ok(OP.Maps.clearObstacle(dsim, i).ok, `${key} "${o.name}" clears`)
        t.ok(OP.Targeting.hasLineOfSight(dsim, px - d.w - 20, py, px + d.w + 20, py),
          `${key} "${o.name}": paying for it buys the sight line back too`)
        t.eq(derivedFresh.blockers.filter(bb => bb.obstacle === i).length, 0,
          `${key} "${o.name}": and the derived blocker left the live list`)
      }
    }
  }
  t.gte(losObstacles, 1, `${losObstacles} obstacle(s) in the tier also block sight, so the blocksLOS path is exercised`)

  /* ================================================================
     10. Reverse mode
     ================================================================ */

  t.section('every map survives Reverse mode')
  for (const key of ALL) {
    const map = built[key]
    const rev = Maps.reversePaths(map)
    t.eq(rev.paths.length, map.paths.length, `${key} reverses to the same number of lanes`)
    rev.paths.forEach((p, i) => {
      const o = map.paths[i]
      t.close(p.length, o.length, 1e-6, `${key} lane ${i} keeps its length reversed (${p.length.toFixed(0)})`)
      const a = p.posAt(0), b = o.posAt(o.length)
      t.close(Math.hypot(a.x - b.x, a.y - b.y), 0, 1e-6, `${key} lane ${i} now enters where it used to exit`)
      const bb = p.bounds()
      t.ok(bb.x0 >= 0 && bb.y0 >= 0 && bb.x1 <= W && bb.y1 <= H, `${key} lane ${i} reversed stays in the field`)
    })
    t.neq(rev.cleared, map.cleared, `${key} reversed gets its own cleared array`)
  }

  /* ================================================================
     11. nothing in a draw path may touch sim state
     ================================================================ */

  t.section('painting a map never mutates the simulation')
  if (OP.Terrain && typeof OP.Terrain.paint === 'function') {
    for (const key of ALL) {
      const map = Maps.build(key)
      const sim = mkSim(map)
      // Give the sim something to checksum: towers, balloons and a few ticks.
      const def = OP.TOWERS[attackers[0]]
      const spot = spotNearTrack(sim, map, def, 0, map.paths[0].length * 0.5, def.base.range * 0.7)
      t.ok(spot && OP.Towers.place(sim, attackers[0], spot.x, spot.y),
        `${key}: a tower and a live round are on the board, so the checksum has something to protect`)
      for (let i = 0; i < 6; i++) OP.Balloons.spawn(sim, { tier: NEXT, path: 0, t: i * 60 })
      OP.Sim.run(sim, 90)

      const mapSnap = JSON.stringify({ cleared: map.cleared, palette: map.palette, water: map.water,
        blocked: map.blocked, blockers: map.blockers, trackWidth: map.trackWidth })

      // Prove the instrument works before trusting it: one real tick must move the
      // checksum. Without this, "unchanged after painting" would also pass for a
      // sim whose state the checksum cannot see at all.
      const probe = OP.Sim.checksum(sim)
      OP.Sim.step(sim)
      t.neq(OP.Sim.checksum(sim), probe, `${key}: one sim tick does move the checksum, so it is watching something`)

      const before = OP.Sim.checksum(sim)
      let calls = 0
      for (let i = 0; i < 8; i++) {
        const ctx = recorder()
        OP.Terrain.paint(ctx, map, sim)
        calls += ctx.calls.length
      }
      t.gt(calls, 200, `${key}: the painter really drew (${calls} recorded calls over 8 frames)`)
      t.eq(OP.Sim.checksum(sim), before, `${key}: eight paints left OP.Sim.checksum unchanged (${before})`)
      t.eq(JSON.stringify({ cleared: map.cleared, palette: map.palette, water: map.water,
        blocked: map.blocked, blockers: map.blockers, trackWidth: map.trackWidth }), mapSnap,
      `${key}: and did not write to the map either`)
    }
  } else {
    t.fail('OP.Terrain.paint is unavailable', 'the no-mutation claim cannot be checked without the painter')
  }
}

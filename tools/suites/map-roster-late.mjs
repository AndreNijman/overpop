// The shipped advanced and expert map tiers.
//
// tools/suites/maps.mjs tests the LOADER against throwaway definitions written
// inside that file. This suite tests the CONTENT: the eight maps in
// js/data/maps-advanced.js and js/data/maps-expert.js. It is the late-tier twin
// of tools/suites/map-roster-early.mjs and asserts the same shape of claim —
// counts, unique keys and names, everything builds, everything stays inside the
// field, lengths inside the tier band, a measured buildable-ground floor with the
// number in the message, and every map provably playable with real towers.
//
// Four things this suite deliberately does not do:
//
//   · It never derives its subject list from Maps.byTier(). Other suites register
//     throwaway maps into the same shared OP.MAPS, so byTier() would audit
//     fixtures alongside the roster. The subject list is OP.MAP_ROSTERS[tier],
//     which each data file builds from its own array of definitions, so a fifth
//     map cannot be added without this suite seeing it (and tripping the count).
//   · It never calls Maps.define. The gentle reference map used by the
//     hardness comparison is built with Maps.build from a raw definition, so this
//     suite cannot perturb the roster that map-roster-early.mjs is counting.
//   · It never names a tower. Every tower it builds with is discovered from
//     OP.TOWER_ORDER by predicate — including WHICH upgrade branch teaches a
//     tower to see VEILED balloons, which is found by dry-running the real
//     upgrade tree. A roster or tree change has to reach this suite rather than
//     sail past it and reappear as a mystery leak on round 24.
//   · It never places a tower with { free: true }. Towers.place skips canPlace
//     entirely when free, which would prove nothing about whether the map's
//     placement mask lets a real build happen. Every tower is paid for.

export const name = 'map-roster-late'
export const needs = ['js/data/maps-advanced.js', 'js/data/maps-expert.js']

/* ---------- the design contract, per tier ----------
   Every number here is a band the shipped maps sit comfortably inside, not a
   band fitted to them: the floors are set below the tightest shipped map and the
   caps above the loosest, so a retune has room to move before it fails — and
   when it does fail the message prints what it moved to. */

const TIERS = [
  {
    tier: 'advanced',
    expect: 12,
    minPaths: 2, maxPaths: 3,          // "two or three paths"
    laneFloor: 700, laneCap: 4500,     // so "three lanes" is never one lane and two stubs
    totalLo: 3000, totalHi: 4500,      // Maps.totalPathLength — the SUM across lanes
    buildFloor: 0.38, buildCap: 0.60,
    minWater: 2, waterFloor: 0.07,     // "significant water" — the floor is on AREA,
                                       //   not count: one big pond beats four puddles
    minBlockers: 3,                    // "several line-of-sight blockers"
    minRemovable: 3                    // "multiple removable obstacles"
  },
  {
    tier: 'expert',
    expect: 12,
    minPaths: 1, maxPaths: 3,
    laneFloor: 700, laneCap: 4500,
    totalLo: 1800, totalHi: 4500,      // short IS the difficulty for one of them
    buildFloor: 0.15, buildCap: 0.40,
    minWater: 1, waterFloor: 0.07,
    minBlockers: 3,
    minRemovable: 2
  }
]

// Mechanics are not protectable; names are. Same two lists the tower-family floor
// and the early map roster use: the acronyms collide with ordinary English so
// they are matched case-sensitively, the rest are unambiguous in any casing.
const BANNED_ANY = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|dart monkey|super monkey|monkeys?)\b/i
const BANNED_CAPS = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/

// The measurement grid for every buildable-ground number in this suite. One
// constant, used by the floor assertion and by the hardness comparison, so the
// fraction that is asserted and the cell count that is compared are literally the
// same measurement.
const GRID = { placement: 'land', step: 8, footprint: 14 }

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

  function mkSim (map, over) {
    return OP.Sim.create(Object.assign({
      map: map,
      seed: 'map-roster-late',
      difficulty: 'easy',
      mode: 'standard',
      rules: { startCash: 400000, startLives: 200 }
    }, over || {}))
  }

  function inFieldFor (def, x, y) {
    return x - def.footprint >= 0 && x + def.footprint <= W &&
           y - def.footprint >= 0 && y + def.footprint <= H
  }

  /* ---------- buildable ground, one measurement ---------- */

  let CELLS = 0
  for (let y = GRID.footprint; y <= H - GRID.footprint; y += GRID.step) {
    for (let x = GRID.footprint; x <= W - GRID.footprint; x += GRID.step) CELLS++
  }
  const fracOf = map => Maps.buildableFraction(map, GRID)
  const cellsOf = map => Math.round(fracOf(map) * CELLS)

  /* ---------- discovered tower helpers ---------- */

  /** How many balloon tiers a damage type can touch at all. */
  function coverage (dmgType) {
    let n = 0
    for (let i = 0; i < OP.BALLOON_TIERS.length; i++) {
      if (OP.canDamage(OP.BALLOON_TIERS[i].key, dmgType)) n++
    }
    return n
  }

  /**
   * Which upgrade branch teaches each tower to see VEILED balloons, discovered by
   * dry-running the real tree on a scratch sim. `{path:-1}` means it can already.
   */
  function deriveCamoBranches () {
    const probeMap = { key: 'late-camo-probe', paths: [new OP.Track([{ x: 0, y: 360 }, { x: W, y: 360 }])] }
    const out = {}
    for (const key of OP.TOWER_ORDER) {
      const def = OP.TOWERS[key]
      if (!def || !def.base) continue
      if (def.base.camoDetect) { out[key] = { path: -1, tier: 0 }; continue }
      let best = null
      for (let p = 0; p < 3; p++) {
        const sim = OP.Sim.create({ map: probeMap, seed: 'late-camo', rules: { startCash: 1e9, startLives: 100 } })
        const tw = OP.Towers.place(sim, key, 300, 200, { free: true })
        if (!tw) continue
        for (let tier = 1; tier <= 5; tier++) {
          if (!OP.Upgrades.buy(sim, tw, p).ok) break
          if (tw.s.camoDetect) { if (!best || tier < best.tier) best = { path: p, tier: tier }; break }
        }
      }
      out[key] = best
    }
    return out
  }

  /** Spots beside the road that a tower could both stand on and shoot from. */
  function candidateSpots (sim) {
    const map = sim.map
    const tw = map.trackWidth
    const offsets = [tw + 16, tw + 34, tw + 54, tw + 76]
    const lanes = []
    for (let pi = 0; pi < map.paths.length; pi++) {
      const p = map.paths[pi]
      const row = []
      for (let at = 0; at <= p.length; at += 44) {
        const pos = p.posAt(at)
        const a = p.angleAt(at)
        const nx = -Math.sin(a), ny = Math.cos(a)
        for (let s = -1; s <= 1; s += 2) {
          for (let oi = 0; oi < offsets.length; oi++) {
            const x = pos.x + nx * offsets[oi] * s
            const y = pos.y + ny * offsets[oi] * s
            if (x < 16 || y < 16 || x > W - 16 || y > H - 16) continue
            // Geometry alone is not enough: a tower can be legally placed and have
            // no sight line to the road, which is exactly what the blockers on
            // these maps are for.
            if (!OP.Targeting.hasLineOfSight(sim, x, y, pos.x, pos.y)) continue
            row.push({ x: x, y: y })
          }
        }
      }
      lanes.push(row)
    }
    const out = []
    for (let i = 0, more = true; more; i++) {
      more = false
      for (const row of lanes) if (i < row.length) { out.push(row[i]); more = true }
    }
    return out
  }

  /**
   * Place and upgrade a reference defence. Deterministic, pays for everything,
   * and leads each tower's upgrades with whichever branch grants camo detection.
   */
  function referenceBuild (sim, rotation, camo, maxTowers) {
    const cleared = []
    for (let i = 0; i < (sim.map.removable || []).length; i++) {
      if (Maps.clearObstacle(sim, i).ok) cleared.push(i)
    }

    const spots = candidateSpots(sim)
    const used = {}
    let placed = 0, rotIdx = 0
    for (let si = 0; si < spots.length && placed < maxTowers; si++) {
      for (let k = 0; k < rotation.length; k++) {
        const key = rotation[(rotIdx + k) % rotation.length]
        if (!OP.Towers.canPlace(sim, key, spots[si].x, spots[si].y).ok) continue
        if (OP.Towers.place(sim, key, spots[si].x, spots[si].y)) {
          placed++
          used[key] = (used[key] || 0) + 1
          rotIdx = (rotIdx + k + 1) % rotation.length
          break
        }
      }
    }

    const mainOf = {}
    for (const tw of sim.towers) {
      const c = camo[tw.key]
      mainOf[tw.id] = c && c.path >= 0 ? c.path : 0
    }
    let upgrades = 0
    for (let tier = 1; tier <= 5; tier++) {
      for (const tw of sim.towers) {
        const p = mainOf[tw.id]
        if (tw.tiers[p] >= tier) continue
        if (OP.Upgrades.buy(sim, tw, p).ok) upgrades++
      }
    }
    for (let tier = 1; tier <= 2; tier++) {
      for (const tw of sim.towers) {
        const p = mainOf[tw.id] === 0 ? 1 : 0
        if (tw.tiers[p] >= tier) continue
        if (OP.Upgrades.buy(sim, tw, p).ok) upgrades++
      }
    }
    let camoTowers = 0
    for (const tw of sim.towers) if (tw.s.camoDetect) camoTowers++
    return { placed: placed, upgrades: upgrades, camoTowers: camoTowers, cleared: cleared, used: used }
  }

  /** Play the difficulty's whole round range. Returns a plain report. */
  function playThrough (sim) {
    const first = sim.rules.firstRound
    const last = sim.rules.lastRound
    const livesBefore = sim.lives
    let failedAt = 0, reached = 0
    for (let r = first; r <= last; r++) {
      OP.Sim.startRound(sim, r)
      const res = OP.Sim.runRound(sim, 60 * 600)
      reached = r
      if (!res.completed || res.leaked > 0) { failedAt = r; break }
      // Round `last` ends the game, so runRound stops finding a live round.
      if (sim.over) break
    }
    return {
      failedAt: failedAt, reached: reached, first: first, last: last,
      livesLost: livesBefore - sim.lives, leaked: sim.stats.leaked,
      popped: sim.stats.popped, outcome: sim.outcome, over: sim.over
    }
  }

  /* ---------- shape fingerprinting ---------- */

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

  /* ---------- water helpers ---------- */

  function regionSpots (w, step) {
    const out = []
    if (w.kind === 'circle') {
      for (let dy = -w.r; dy <= w.r; dy += step) {
        for (let dx = -w.r; dx <= w.r; dx += step) {
          if (dx * dx + dy * dy <= w.r * w.r) out.push({ x: w.cx + dx, y: w.cy + dy })
        }
      }
    } else {
      for (let y = w.y; y <= w.y + w.h; y += step) {
        for (let x = w.x; x <= w.x + w.w; x += step) out.push({ x: x, y: y })
      }
    }
    return out
  }

  function bestWaterSpot (map, def, w) {
    let best = null, bestD = Infinity, legal = 0
    const pts = regionSpots(w, 10)
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

  /**
   * A probe segment that crosses `rect` and NO other rect in `others`. These maps
   * carry several walls, so a naive probe slid across one rock can walk straight
   * into a neighbour and make "clearing restored the sight line" fail for a reason
   * that has nothing to do with the rock under test.
   */
  function probeAcross (rect, others) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
    const reach = Math.max(rect.w, rect.h) + 40
    const tries = []
    for (const along of [0, -0.3, 0.3]) {
      tries.push({
        a: { x: cx + rect.w * along, y: cy - rect.h / 2 - reach },
        b: { x: cx + rect.w * along, y: cy + rect.h / 2 + reach }
      })
      tries.push({
        a: { x: cx - rect.w / 2 - reach, y: cy + rect.h * along },
        b: { x: cx + rect.w / 2 + reach, y: cy + rect.h * along }
      })
    }
    for (const p of tries) {
      if (!OP.M.segRectHit(p.a.x, p.a.y, p.b.x, p.b.y, rect.x, rect.y, rect.w, rect.h)) continue
      let clean = true
      for (const o of others) {
        if (o === rect) continue
        if (OP.M.segRectHit(p.a.x, p.a.y, p.b.x, p.b.y, o.x, o.y, o.w, o.h)) { clean = false; break }
      }
      if (clean) return p
    }
    return null
  }

  function anyLandSpot (map) {
    for (let y = 24; y <= H - 24; y += 8) {
      for (let x = 24; x <= W - 24; x += 8) {
        if (Maps.canPlace(map, LAND, x, y).ok) return { x: x, y: y }
      }
    }
    return null
  }

  /* ================================================================
     0. the towers this suite builds with are discovered, not named
     ================================================================ */

  t.section('the reference build is assembled from the live registries')

  const defsByKey = {}
  const allTowers = []
  for (const key of OP.TOWER_ORDER) {
    const d = OP.TOWERS[key]
    if (d && d.base && d.fire) { defsByKey[key] = d; allTowers.push(d) }
  }
  t.gte(allTowers.length, 8, `${allTowers.length} firing towers in OP.TOWER_ORDER to build with`)

  const camoBase = allTowers.filter(d => d.base.camoDetect === true)
  t.gte(camoBase.length, 1,
    `at least one tower sees VEILED balloons out of the box: ${camoBase.map(d => d.key).join(', ') || 'NONE'}`)

  const camoBranches = deriveCamoBranches()
  const canLearnCamo = Object.keys(camoBranches).filter(k => camoBranches[k])
  t.gte(canLearnCamo.length, 6,
    `${canLearnCamo.length} towers can reach camo detection through their own upgrade tree ` +
    '— round 24 sends VEILED, so a build with none of them would leak on every map for a reason ' +
    'that has nothing to do with the maps')

  const universal = allTowers.filter(d => coverage(d.base.dmgType) === OP.BALLOON_TIERS.length)
  t.gte(universal.length, 1,
    `at least one tower deals damage no tier resists: ${universal.map(d => d.key + '/' + d.base.dmgType).join(', ') || 'NONE'}`)

  const wetTowers = allTowers.filter(d => (d.placement || 'land') !== 'land')
  t.gte(wetTowers.length, 1,
    `at least one tower can stand on water: ${wetTowers.map(d => d.key).join(', ') || 'NONE'}`)

  // Interleave the three specialists with the rest so the rotation always leads
  // with detection and universal damage, then falls back to raw output.
  const ROTATION = []
  {
    const seen = {}
    const push = d => { if (d && !seen[d.key]) { seen[d.key] = true; ROTATION.push(d.key) } }
    const lists = [camoBase, universal, wetTowers, allTowers]
    for (let i = 0; ROTATION.length < 14; i++) {
      let more = false
      for (const list of lists) if (i < list.length) { push(list[i]); more = true }
      if (!more) break
    }
  }
  t.gte(ROTATION.length, 6, `the rotation is ${ROTATION.length} towers deep: ${ROTATION.join(', ')}`)

  const waterKey = OP.TOWER_ORDER.find(k => OP.TOWERS[k].placement === 'water' && OP.TOWERS[k].fire)
  const waterDef = waterKey ? OP.TOWERS[waterKey] : null
  t.ok(waterDef, `the roster has a water-only attacker to test water regions with: ${waterKey}`)

  const landAttacker = OP.TOWER_ORDER.find(k => {
    const d = OP.TOWERS[k]
    return d.fire && d.placement === 'land' && d.base.range >= 90 && d.base.range <= 260
  })
  t.ok(landAttacker, `and a land attacker to test cleared ground with: ${landAttacker}`)
  if (!waterDef || !landAttacker) return

  /* ================================================================
     1. the rosters the two data files declare
     ================================================================ */

  t.section('each data file declares its own roster on OP.MAP_ROSTERS')
  t.ok(OP.MAP_ROSTERS && typeof OP.MAP_ROSTERS === 'object', 'OP.MAP_ROSTERS exists')

  const rosters = {}
  for (const spec of TIERS) {
    const keys = OP.MAP_ROSTERS && OP.MAP_ROSTERS[spec.tier]
    if (!t.ok(Array.isArray(keys) && keys.length > 0,
      `the ${spec.tier} file declared OP.MAP_ROSTERS.${spec.tier}`)) return
    rosters[spec.tier] = keys
    t.eq(keys.length, spec.expect,
      `exactly ${spec.expect} ${spec.tier} maps, got ${keys.length}: ${keys.join(', ')}`)
    t.eq(new Set(keys).size, keys.length, `${spec.tier} keys are unique`)
  }

  const ALL = rosters.advanced.concat(rosters.expert)
  t.eq(ALL.length, 24, `twenty-four maps across the two late tiers, got ${ALL.length}`)
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
      t.eq(OP.MAP_ORDER.filter(k => k === key).length, 1, `${key} appears in MAP_ORDER exactly once`)
      t.ok(Maps.byTier(spec.tier).some(d => d.key === key), `${key} comes back from byTier('${spec.tier}')`)
    }
  }
  if (Object.keys(defs).length !== 10) return

  t.section('names and blurbs are original, distinct and shippable')
  const names = ALL.map(k => defs[k].name)
  t.eq(new Set(names).size, names.length, `all sixteen names are distinct: ${names.join(' · ')}`)
  for (const key of ALL) {
    const def = defs[key]
    // Unique across the WHOLE registry, not just these eight — the map picker
    // shows one flat list, and two maps called the same thing is a shipped bug.
    // Counted rather than compared so a fixture map from another suite cannot
    // make this pass by coincidence.
    const sameName = Maps.all().filter(d => d.name === def.name).length
    t.eq(sameName, 1, `"${def.name}" is the only registered map with that name`)
    t.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key), `${key} is lowercase kebab-case — it is what a save records`)
    t.ok(def.name.length >= 4 && def.name === def.name.trim(), `${key} has a display name: "${def.name}"`)
    t.ok(def.blurb.length > 30 && /[.!]$/.test(def.blurb),
      `${key} has a real picker blurb (${def.blurb.length} chars)`)
    // Everything an author typed, in one blob: name, blurb, lane names, rock names.
    const blob = JSON.stringify({
      key: def.key, name: def.name, blurb: def.blurb,
      lanes: def.paths.map(p => p.name || ''),
      rocks: def.removable.map(o => o.name)
    })
    const hit = (blob.match(BANNED_ANY) || blob.match(BANNED_CAPS) || [])[0]
    t.notOk(hit, `${key} uses no borrowed proper nouns` + (hit ? ` — found "${hit}"` : ''))
    t.ok(def.paths.every(p => p.name && p.name.length > 2),
      `${key} names every lane (${def.paths.map(p => p.name).join(', ')})`)
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
    t.eq(JSON.stringify(defs[key]), snapshot, `${key}: building did not mutate the registered definition`)
    t.noThrow(() => mkSim(map), `${key}: Sim.create accepts the built map`)
    built[key] = map
  }
  if (Object.keys(built).length !== 12) return

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
    t.eq(missing.length, 0,
      `${key} palette covers every default key` + (missing.length ? `: missing ${missing.join(', ')}` : ''))
    const authored = Object.keys(defs[key].palette).filter(k => defs[key].palette[k] !== Maps.DEFAULT_PALETTE[k])
    t.gte(authored.length, 3, `${key} authored a real palette, not the default (${authored.length} keys differ)`)
    palettes.push(JSON.stringify(map.palette))
    if (OP.Terrain && OP.Terrain.palette) {
      const resolved = OP.Terrain.palette(map)
      const bad = Object.keys(OP.Terrain.DEFAULT_PALETTE).filter(k => typeof resolved[k] !== 'string' || !resolved[k])
      t.eq(bad.length, 0, `${key}: the painter resolves every colour it reads` + (bad.length ? `: ${bad.join(', ')}` : ''))
    }
  }
  t.eq(new Set(palettes).size, palettes.length,
    'no two maps ship the same palette — eight places, not one repainted eight times')

  /* ================================================================
     3. geometry: inside the field, on the edges, and in the length band
     ================================================================ */

  t.section(`every built track stays inside the ${W}x${H} field once smoothed`)
  for (const key of ALL) {
    built[key].paths.forEach((p, i) => {
      const b = p.bounds()
      const ok = b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H
      t.ok(ok, `${key} lane ${i} bounds (${b.x0.toFixed(1)},${b.y0.toFixed(1)})-(${b.x1.toFixed(1)},${b.y1.toFixed(1)})` +
        ' are inside the field — Catmull-Rom overshoots corners, so this is the check that matters')
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

  t.section('lane counts, lane lengths and total track length sit inside the tier band')
  const totals = {}
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const map = built[key]
      const lens = map.paths.map(p => p.length)
      const total = Maps.totalPathLength(map)
      totals[key] = total
      t.between(map.paths.length, spec.minPaths, spec.maxPaths,
        `${key} has ${map.paths.length} lane(s); ${spec.tier} allows ${spec.minPaths}-${spec.maxPaths}`)
      // The band is on the TOTAL across lanes, which is what the data files
      // document: three lanes of 3000 each would put two thirds of the field
      // under road margin, so a per-lane reading of the same band cannot coexist
      // with the tier's constrained-ground requirement.
      t.between(total, spec.totalLo, spec.totalHi,
        `${key} total track length is ${total.toFixed(0)} across ${lens.length} lane(s) ` +
        `(${lens.map(l => l.toFixed(0)).join(' + ')}); ${spec.tier} band ${spec.totalLo}-${spec.totalHi}`)
      lens.forEach((l, i) => {
        t.between(l, spec.laneFloor, spec.laneCap,
          `${key} lane ${i} is ${l.toFixed(0)} units long (floor ${spec.laneFloor}, so no lane is a stub)`)
      })
      t.between(map.trackWidth, 24, 40,
        `${key} trackWidth is ${map.trackWidth} — wide enough to cover road plus a tower radius, ` +
        'narrow enough to leave ground')
      t.close(total, lens.reduce((a, b) => a + b, 0), 1e-9,
        `${key}: totalPathLength really is the sum of the lanes`)
    }
  }

  t.section('each map is a distinct shape')
  const sigs = ALL.map(key => {
    const map = built[key]
    const track = map.paths[0]
    return {
      key: key,
      sig: [reversals(track, 'x'), reversals(track, 'y'), crossings(track),
        Math.round(track.length / 250), map.paths.length].join('/')
    }
  })
  const bySig = {}
  for (const s of sigs) bySig[s.sig] = (bySig[s.sig] || []).concat(s.key)
  const dupes = Object.keys(bySig).filter(k => bySig[k].length > 1)
  t.eq(dupes.length, 0, 'no two maps share a shape signature (revX/revY/crossings/lengthBucket/lanes)' +
    (dupes.length ? ': ' + dupes.map(k => bySig[k].join('=') + ' both ' + k).join('; ')
      : ': ' + sigs.map(s => s.key + ' ' + s.sig).join(' · ')))

  t.section('the expert tier is not one idea five times')
  const laneCounts = rosters.expert.map(k => built[k].paths.length)
  t.ok(laneCounts.indexOf(1) >= 0, `at least one expert map is a single lane (lane counts ${laneCounts.join(',')})`)
  t.ok(Math.max.apply(null, laneCounts) >= 3, 'and at least one splits the defence three ways')
  const expertTotals = rosters.expert.map(k => totals[k])
  t.lt(Math.min.apply(null, expertTotals), 2200,
    'one expert map is deliberately short — ' +
    rosters.expert.map(k => `${k}=${totals[k].toFixed(0)}`).join(' '))

  /* ================================================================
     4. how much of each map can actually be built on
     ================================================================ */

  t.section('buildable ground, measured rather than asserted by eye')
  const frac = {}
  const cells = {}
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const f = fracOf(built[key])
      frac[key] = f
      cells[key] = cellsOf(built[key])
      t.gte(f, spec.buildFloor,
        `${key} is ${(f * 100).toFixed(1)}% buildable for a land tower — ${cells[key]} of ${CELLS} cells ` +
        `(${spec.tier} floor ${(spec.buildFloor * 100).toFixed(0)}%)`)
      t.lte(f, spec.buildCap,
        `${key} is not open ground either: ${(f * 100).toFixed(1)}% buildable (${spec.tier} cap ` +
        `${(spec.buildCap * 100).toFixed(0)}%)`)
    }
  }

  t.section('every stretch of every road has somewhere legal to shoot it from')
  // The floor above says how much ground exists; this says the ground is in the
  // right PLACE. A map can be 40% buildable and still have a leg of road that no
  // legal, sighted spot covers — which is unwinnable and invisible to a fraction.
  for (const key of ALL) {
    const map = built[key]
    const sim = mkSim(map)
    let samples = 0, covered = 0
    for (const p of map.paths) {
      for (let at = 0; at < p.length; at += 40) {
        samples++
        const pos = p.posAt(at)
        let ok = false
        for (let a = 0; a < 16 && !ok; a++) {
          const ang = (a / 16) * Math.PI * 2
          for (let d = map.trackWidth + 12; d <= map.trackWidth + 90; d += 10) {
            const x = pos.x + Math.cos(ang) * d
            const y = pos.y + Math.sin(ang) * d
            if (x < 14 || y < 14 || x > W - 14 || y > H - 14) continue
            if (!(Maps.canPlace(map, LAND, x, y).ok || Maps.canPlace(map, WATER, x, y).ok)) continue
            if (!OP.Targeting.hasLineOfSight(sim, x, y, pos.x, pos.y)) continue
            ok = true
            break
          }
        }
        if (ok) covered++
      }
    }
    t.eq(covered, samples,
      `${key}: all ${samples} road samples have a legal, sighted spot within ${map.trackWidth + 90} units ` +
      `(${covered} covered)`)
  }

  /* ================================================================
     5. the two late tiers really are harder — the chosen proxy
     ================================================================ */

  t.section('the hardness proxy: buildable cells, and why it is the one to use')
  // PROXY: buildable cells (Maps.buildableFraction on a fixed 8-unit grid).
  //
  // Chosen over "more paths" and "shorter track" because neither is monotone in
  // difficulty across these eight maps and this one is: an expert map here may
  // have one lane (Bramble Gap) or three (Thricefall Combes), and its track may
  // be the shortest in the game or half again the length of an advanced map, so
  // both of those proxies would have to be argued per map. Buildable cells is a
  // single number that goes down as a map gets harder for the reason all four
  // late-tier design levers share — water, blocked terrain, extra lanes and a
  // wider road all take away ground you could have put a tower on — and it is
  // measured by an engine function the placement mask itself uses, so it cannot
  // drift away from what the player experiences.
  //
  // The baseline is built here rather than read from the beginner tier: that file
  // is written by another author, and a suite whose pass criteria depend on a
  // sibling's content is a suite that goes red for someone else's edit.
  const gentle = Maps.build({
    key: 'late-gentle-baseline',
    name: 'Gentle Baseline',
    tier: 'beginner',
    blurb: 'Not registered, not shipped: the open-field reference the late tiers are measured against.',
    trackWidth: 34,
    paths: [{ name: 'Baseline', smooth: 3, points: [
      { x: 0, y: 150 }, { x: 250, y: 140 }, { x: 520, y: 200 }, { x: 760, y: 150 },
      { x: 980, y: 260 }, { x: 1150, y: 420 }, { x: 980, y: 540 }, { x: 700, y: 580 },
      { x: 430, y: 540 }, { x: 200, y: 600 }, { x: 120, y: 720 }
    ] }]
  })
  t.notOk(Maps.exists('late-gentle-baseline'),
    'the baseline was built, never defined, so it cannot pollute OP.MAPS or another suite\'s counts')
  const gentleCells = cellsOf(gentle)
  const gentleFrac = fracOf(gentle)
  t.gte(gentleFrac, 0.72,
    `the baseline is open ground: ${gentleCells} of ${CELLS} cells buildable (${(gentleFrac * 100).toFixed(1)}%)`)
  t.between(Maps.totalPathLength(gentle), 2200, 3200,
    'and carries a road of comparable length to the maps it is compared with ' +
    `(${Maps.totalPathLength(gentle).toFixed(0)} units), so the difference measured below is ground, not road`)

  for (const key of ALL) {
    t.lt(cells[key], gentleCells * 0.8,
      `${key} gives up at least a fifth of the open-field baseline: ${cells[key]} cells vs ${gentleCells}`)
  }

  const advCells = rosters.advanced.map(k => cells[k])
  const expCells = rosters.expert.map(k => cells[k])
  const advMin = Math.min.apply(null, advCells)
  const expMax = Math.max.apply(null, expCells)
  const advMinKey = rosters.advanced[advCells.indexOf(advMin)]
  const expMaxKey = rosters.expert[expCells.indexOf(expMax)]
  const table = ALL.map(k => `${k}=${cells[k]}`).join(' ')
  t.lt(expMax, advMin,
    `every expert map has fewer buildable cells than every advanced map: the loosest expert map ` +
    `(${expMaxKey}, ${expMax}) is still tighter than the tightest advanced one (${advMinKey}, ${advMin}) — ${table}`)

  const mean = list => list.reduce((a, b) => a + b, 0) / list.length
  const advMean = mean(advCells), expMean = mean(expCells)
  t.gt(advMean - expMean, 0.1 * gentleCells,
    `and the tier gap is a real step, not rounding: mean ${advMean.toFixed(0)} advanced vs ` +
    `${expMean.toFixed(0)} expert cells, a gap of ${(advMean - expMean).toFixed(0)} ` +
    `(${((advMean - expMean) / gentleCells * 100).toFixed(1)}% of the baseline)`)

  const tightest = ALL.slice().sort((a, b) => cells[a] - cells[b])[0]
  t.ok(rosters.expert.indexOf(tightest) >= 0,
    `the tightest map across both tiers is an expert one: ${tightest} at ${cells[tightest]} cells`)

  // The same proxy against the shipped earlier tiers, when they are loaded.
  // GUARDED: js/data/maps-beginner.js and js/data/maps-intermediate.js are not in
  // this suite's `needs`, because this suite must be able to go green on its own
  // two files. When they are present the comparison is the direct form of the
  // claim, so it is worth making — map-roster-early.mjs measures on exactly this
  // grid, which is what lets the two suites' numbers be compared at all.
  for (const earlier of ['beginner', 'intermediate']) {
    const keys = OP.MAP_ROSTERS && OP.MAP_ROSTERS[earlier]
    if (!Array.isArray(keys) || !keys.length) continue
    const earlierCells = keys.map(k => cellsOf(Maps.build(k)))
    const earlierMin = Math.min.apply(null, earlierCells)
    const advMax = Math.max.apply(null, advCells)
    t.lt(advMax, earlierMin,
      `every advanced map is tighter than every ${earlier} map: the loosest advanced ` +
      `(${advMax} cells) against the tightest ${earlier} (${earlierMin} cells) — ` +
      keys.map((k, i) => k + '=' + earlierCells[i]).join(' '))
    t.lt(expMax, earlierMin,
      `and so is every expert map: loosest expert ${expMax} cells vs tightest ${earlier} ${earlierMin}`)
  }

  /* ================================================================
     6. water and land are mutually exclusive, both ways
     ================================================================ */

  t.section('every water body is placeable, in range of the road, and lethal from it')
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const map = built[key]
      t.ok(Array.isArray(map.water), `${key} exposes a normalised water list (${map.water.length} region(s))`)
      t.gte(map.water.length, spec.minWater,
        `${key} carries ${map.water.length} water region(s); ${spec.tier} asks for ${spec.minWater}+`)
      const wetFrac = Maps.buildableFraction(map, { placement: 'water', step: 8, footprint: 14 })
      t.gte(wetFrac, spec.waterFloor,
        `${key} gives a water tower ${(wetFrac * 100).toFixed(1)}% of the field ` +
        `(floor ${(spec.waterFloor * 100).toFixed(0)}%) — water here is terrain, not decoration`)

      map.water.forEach((w, i) => {
        const found = bestWaterSpot(map, waterDef, w)
        if (!t.ok(found.spot, `${key} water ${i} has somewhere a ${waterDef.name} may legally stand (${found.legal} spots)`)) return
        t.lte(found.dist, waterDef.base.range,
          `${key} water ${i} reaches the road: ${found.dist.toFixed(0)} units from the centreline, ` +
          `inside the ${waterDef.base.range} range of a ${waterDef.name}`)
        const landHere = Maps.canPlace(map, LAND, found.spot.x, found.spot.y)
        t.notOk(landHere.ok, `${key} water ${i} refuses a land tower`)
        t.eq(landHere.reason, 'This tower cannot be placed on water.', `${key} water ${i} says why: "${landHere.reason}"`)
      })

      // One paid-for water tower per map really shoots. The berth is chosen for
      // effectiveness, not just legality: closest to the road, in range, AND with
      // a sight line to it — a spot behind one of these maps' walls is legal and
      // useless, and picking it would test the wall rather than the water.
      const fresh = Maps.build(key)
      const sim = mkSim(fresh)
      let berth = null, berthD = Infinity, berthLane = 0
      fresh.water.forEach(w => {
        for (const p of regionSpots(w, 10)) {
          if (!inFieldFor(waterDef, p.x, p.y)) continue
          if (!Maps.canPlace(fresh, waterDef, p.x, p.y).ok) continue
          for (let li = 0; li < fresh.paths.length; li++) {
            const n = fresh.paths[li].nearest(p.x, p.y)
            if (n.dist >= berthD || n.dist > waterDef.base.range) continue
            if (!OP.Targeting.hasLineOfSight(sim, p.x, p.y, n.x, n.y)) continue
            berthD = n.dist; berth = p; berthLane = li
          }
        }
      })
      if (t.ok(berth, `${key}: a ${waterDef.name} has a berth in range of, and in sight of, the road`)) {
        const tower = OP.Towers.place(sim, waterKey, berth.x, berth.y)
        t.ok(tower, `${key}: a paid-for ${waterDef.name} places at (${berth.x},${berth.y}), ` +
          `${berthD.toFixed(0)} units off lane ${berthLane}`)
        if (tower) {
          const weak = OP.BALLOON_TIERS[1].key
          for (let i = 0; i < 10; i++) OP.Balloons.spawn(sim, { tier: weak, path: berthLane, t: i * 30 })
          OP.Sim.run(sim, 60 * 90)
          t.gt(sim.stats.popped, 0, `${key}: the ${waterDef.name} popped ${sim.stats.popped} balloons from the water`)
        }
      }

      // The mirror rule: a water tower may not stand on dry land.
      const dry = anyLandSpot(map)
      if (t.ok(dry, `${key} has open land to test the mirror rule on`)) {
        const wetHere = Maps.canPlace(map, WATER, dry.x, dry.y)
        t.notOk(wetHere.ok, `${key} refuses a water tower on dry ground at (${dry.x},${dry.y})`)
        t.eq(wetHere.reason, 'This tower can only be placed on water.', `${key} says why: "${wetHere.reason}"`)
      }
    }
  }

  /* ================================================================
     7. line-of-sight blockers
     ================================================================ */

  t.section('every authored blocker is a rect, blocks building too, and really cuts sight')
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const map = built[key]
      const authored = map.blockersAll.filter(b => b.obstacle === undefined)
      t.gte(authored.length, spec.minBlockers,
        `${key} declares ${authored.length} line-of-sight blocker(s); ${spec.tier} asks for ${spec.minBlockers}+`)
      for (let i = 0; i < authored.length; i++) {
        const b = authored[i]
        t.eq(b.kind, 'rect', `${key} blocker ${i} is a rect — Targeting reads x/y/w/h with no shape dispatch`)
        const alsoBlocked = map.blocked.some(r => r.kind === 'rect' && r.x === b.x && r.y === b.y &&
          r.w === b.w && r.h === b.h)
        t.ok(alsoBlocked, `${key} blocker ${i} (${b.x},${b.y} ${b.w}x${b.h}) is listed in blocked too, ` +
          'so it is not an invisible pane standing on buildable grass')
        const here = Maps.canPlace(map, LAND, b.x + b.w / 2, b.y + b.h / 2)
        t.eq(here.reason, 'Blocked terrain — nothing can be built here.',
          `${key} blocker ${i} refuses a build: "${here.reason}"`)
      }
      const b = authored[0]
      const sim = mkSim(Maps.build(key))
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2
      // Probe across the SHORT axis, so the segment really crosses the rect.
      const wide = b.w >= b.h
      const a1 = wide ? { x: cx, y: cy - b.h - 30 } : { x: cx - b.w - 30, y: cy }
      const a2 = wide ? { x: cx, y: cy + b.h + 30 } : { x: cx + b.w + 30, y: cy }
      t.ok(OP.M.segRectHit(a1.x, a1.y, a2.x, a2.y, b.x, b.y, b.w, b.h),
        `${key}: the probe shot really does cross blocker 0`)
      t.notOk(OP.Targeting.hasLineOfSight(sim, a1.x, a1.y, a2.x, a2.y),
        `${key}: and Targeting cuts it`)
      // The "misses it" half is asserted against THIS rect alone. These maps carry
      // several blockers, so a probe slid sideways can walk into a different one,
      // and hasLineOfSight cannot tell you which — segRectHit can.
      const off = wide ? { dx: b.w + 60, dy: 0 } : { dx: 0, dy: b.h + 60 }
      t.notOk(OP.M.segRectHit(a1.x + off.dx, a1.y + off.dy, a2.x + off.dx, a2.y + off.dy, b.x, b.y, b.w, b.h),
        `${key}: the same shot slid ${off.dx || off.dy} units aside misses blocker 0, ` +
        'so the cut above was the blocker and not the geometry of the probe')
    }
  }

  /* ================================================================
     8. removable obstacles
     ================================================================ */

  t.section('obstacles sit on ground that paying for them really frees')
  let losObstacles = 0
  for (const spec of TIERS) {
    for (const key of rosters[spec.tier]) {
      const map = built[key]
      t.gte(map.removable.length, spec.minRemovable,
        `${key} declares ${map.removable.length} removable obstacle(s); ${spec.tier} asks for ${spec.minRemovable}+`)

      for (let i = 0; i < map.removable.length; i++) {
        const o = map.removable[i]
        t.ok(o.name && o.name.length > 3, `${key} obstacle ${i} is named "${o.name}", so the UI can say what it is`)
        t.gt(o.cost, 0, `${key} "${o.name}" costs $${o.cost}`)

        // Rule order matters: the path margin is tested BEFORE the obstacle
        // prompt, so an obstacle straddling the road would answer "Too close to
        // the path" and the player would never get the chance to pay.
        const fresh = Maps.build(key)
        const sim = mkSim(fresh)
        const before = Maps.canPlace(fresh, LAND, o.x, o.y)
        t.notOk(before.ok, `${key} "${o.name}" blocks its own ground`)
        t.eq(before.reason, `Clear the ${o.name} first ($${o.cost}).`,
          `${key} "${o.name}" offers the clear: "${before.reason}"`)

        const cashBefore = sim.cash
        const res = Maps.clearObstacle(sim, i)
        t.ok(res.ok, `${key} "${o.name}" clears when paid for` + (res.ok ? '' : ` — ${res.reason}`))
        t.eq(sim.cash, cashBefore - OP.Economy.price(sim, o.cost),
          `${key} "${o.name}" charged $${OP.Economy.price(sim, o.cost)} at this difficulty`)

        // Some of these rocks stand in water, so the tower that replaces one is
        // whichever kind the ground under it allows — but SOMETHING must fit, or
        // the obstacle was a purchase with nothing behind it.
        const landOk = Maps.canPlace(fresh, LAND, o.x, o.y).ok
        const wetOk = Maps.canPlace(fresh, WATER, o.x, o.y).ok
        t.ok(landOk || wetOk,
          `${key} "${o.name}": clearing it makes the spot buildable (land ${landOk}, water ${wetOk})`)
        const useKey = landOk ? landAttacker : waterKey
        const useDef = OP.TOWERS[useKey]
        t.ok(inFieldFor(useDef, o.x, o.y),
          `${key} "${o.name}" sits far enough inside the field for a tower to replace it`)
        t.ok(OP.Towers.place(sim, useKey, o.x, o.y),
          `${key} "${o.name}": a paid-for ${useDef.name} now stands where it was`)

        t.notOk(Maps.isCleared(built[key], i),
          `${key} "${o.name}": clearing it in one sim left the other build's cleared set alone`)

        if (o.blocksLOS) {
          losObstacles++
          const derivedFresh = Maps.build(key)
          const derived = derivedFresh.blockersAll.filter(bb => bb.obstacle === i)
          t.eq(derived.length, 1, `${key} "${o.name}" grows exactly one derived LOS blocker`)
          const d = derived[0]
          const dsim = mkSim(derivedFresh)
          const probe = probeAcross(d, derivedFresh.blockersAll)
          if (t.ok(probe, `${key} "${o.name}": there is a sight line that only this rock cuts, ` +
            'so it is not buried inside a permanent wall')) {
            t.notOk(OP.Targeting.hasLineOfSight(dsim, probe.a.x, probe.a.y, probe.b.x, probe.b.y),
              `${key} "${o.name}" blocks that sight line while it stands`)
            t.ok(Maps.clearObstacle(dsim, i).ok, `${key} "${o.name}" clears`)
            t.ok(OP.Targeting.hasLineOfSight(dsim, probe.a.x, probe.a.y, probe.b.x, probe.b.y),
              `${key} "${o.name}": paying for it buys the sight line back too`)
          }
          t.eq(derivedFresh.blockers.filter(bb => bb.obstacle === i).length, 0,
            `${key} "${o.name}": and the derived blocker left the live list`)
        }
      }
    }
  }
  t.gte(losObstacles, 4, `${losObstacles} obstacles across the two tiers also block sight`)

  /* ================================================================
     9. every map is COMPLETABLE — the claim this suite exists for
     ================================================================ */

  t.section('a reference build wins the whole of Easy on every map')
  // The bar: place up to MAX_TOWERS real, paid-for towers on spots the map's own
  // mask allows and that have a sight line to the road, upgrade each to a legal
  // 5-2-0 leading with its camo branch, then play every round the difficulty
  // declares. Easy is rounds 1-40, so the run ends on the lone GOLIATH and the
  // engine's own win condition fires — `outcome === 'won'` is the completability
  // claim, not a proxy for it.
  //
  // The build is deliberately strong and the purse deliberately fat: what is
  // under test is the MAP, not the economy. A map fails here when its geometry
  // will not carry a defence — no legal ground beside a leg of road, sight lines
  // walled off, or a lane so short that even this build cannot keep up.
  const MAX_TOWERS = 18
  const camoBranchTable = camoBranches
  for (const key of ALL) {
    const map = Maps.build(key)
    const sim = mkSim(map)
    const build = referenceBuild(sim, ROTATION, camoBranchTable, MAX_TOWERS)

    t.eq(build.cleared.length, map.removable.length,
      `${key}: every removable obstacle was payable (${build.cleared.length}/${map.removable.length} cleared)`)
    t.gte(build.placed, 10,
      `${key}: ${build.placed} real towers found legal, sighted ground beside the road ` +
      `(${Object.keys(build.used).map(k => k + '×' + build.used[k]).join(' ')})`)
    t.gte(build.upgrades, 20, `${key}: and bought ${build.upgrades} real upgrades`)
    t.gte(build.camoTowers, 1, `${key}: ${build.camoTowers} of them can see VEILED balloons`)

    const report = playThrough(sim)
    t.eq(report.failedAt, 0,
      `${key}: every round from ${report.first} to ${report.last} was cleared without a leak` +
      (report.failedAt ? ` — round ${report.failedAt} leaked` : ''))
    t.eq(report.leaked, 0, `${key}: nothing reached the exit in ${report.last} rounds (${report.leaked} leaked)`)
    t.eq(report.livesLost, 0, `${key}: not one life lost (${sim.lives} of ${sim.rules.startLives} left)`)
    t.gt(report.popped, 500, `${key}: ${report.popped} balloons popped, so the board was really under load`)
    t.eq(report.outcome, 'won',
      `${key} is COMPLETABLE: the run ended "${report.outcome}" after round ${report.reached}`)
    t.ok(sim.over, `${key}: and the engine's own win condition is what ended it`)
  }

  t.section('the same maps are lost with no towers — the build is doing the work')
  // Without this, a broken build loop that placed nothing would still report
  // "no leaks" on a map whose rounds never got released, and read as a pass.
  for (const key of ALL) {
    const sim = mkSim(Maps.build(key))
    OP.Sim.startRound(sim, sim.rules.firstRound)
    OP.Sim.runRound(sim, 60 * 600)
    t.eq(sim.towers.length, 0, `${key}: the control run really has no towers`)
    t.gt(sim.stats.leaked, 0, `${key}: round ${sim.rules.firstRound} leaks when nothing is defending it`)
    t.lt(sim.lives, sim.rules.startLives, `${key}: and lives are lost (${sim.lives} of ${sim.rules.startLives})`)
  }

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
    t.close(fracOf(rev), frac[key], 1e-9, `${key}: reversing changes nothing about where you may build`)
  }

  /* ================================================================
     11. nothing in a draw path may touch sim state
     ================================================================ */

  t.section('painting a map never mutates the simulation')
  if (OP.Terrain && typeof OP.Terrain.paint === 'function') {
    for (const key of ALL) {
      const map = Maps.build(key)
      const sim = mkSim(map)
      // Give the checksum something to protect: a real tower, live balloons, and
      // a few ticks of movement.
      const spots = candidateSpots(sim)
      let towerPlaced = null
      for (let i = 0; i < spots.length && !towerPlaced; i++) {
        for (const k of ROTATION) {
          if (OP.Towers.canPlace(sim, k, spots[i].x, spots[i].y).ok) {
            towerPlaced = OP.Towers.place(sim, k, spots[i].x, spots[i].y)
            if (towerPlaced) break
          }
        }
      }
      t.ok(towerPlaced, `${key}: a tower and a live round are on the board before the paint test`)
      for (let i = 0; i < 6; i++) OP.Balloons.spawn(sim, { tier: OP.BALLOON_TIERS[1].key, path: 0, t: i * 60 })
      OP.Sim.run(sim, 90)

      const mapSnap = JSON.stringify({
        cleared: map.cleared, palette: map.palette, water: map.water,
        blocked: map.blocked, blockers: map.blockers, trackWidth: map.trackWidth
      })
      const before = OP.Sim.checksum(sim)
      let calls = 0
      for (let i = 0; i < 8; i++) {
        const ctx = recorder()
        OP.Terrain.paint(ctx, map, sim)
        calls += ctx.calls.length
      }
      t.gt(calls, 200, `${key}: the painter really drew (${calls} recorded calls over 8 frames)`)
      t.eq(OP.Sim.checksum(sim), before, `${key}: eight paints left OP.Sim.checksum unchanged (${before})`)
      t.eq(JSON.stringify({
        cleared: map.cleared, palette: map.palette, water: map.water,
        blocked: map.blocked, blockers: map.blockers, trackWidth: map.trackWidth
      }), mapSnap, `${key}: and did not write to the map either`)
    }
  } else {
    t.fail('OP.Terrain.paint is unavailable', 'the no-mutation claim cannot be checked without the painter')
  }
}

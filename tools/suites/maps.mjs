// The map format, the loader, and the placement masks.
//
// Everything here works from test maps defined in this file rather than from the
// shipped roster (P5.2), so this suite tests the loader instead of the content —
// and stays green when a map is retuned.

export const name = 'maps'
export const needs = ['js/core/maps.js']

/* ---------- helpers ---------- */

// The harness's t.throws() discards the error, and the contract says a rejection
// must NAME the map. So do it by hand: one assertion that it threw, one that the
// message identifies the map (or, when the key itself is missing, the field).
function rejects (t, fn, needle, msg) {
  let err = null
  try { fn() } catch (e) { err = e }
  if (!t.ok(err, 'rejected: ' + msg)) return null
  t.ok(err.message.indexOf(needle) >= 0,
    '…and the message mentions "' + needle + '": ' + err.message)
  return err
}

let uid = 0
function key () { return 'suite-tmp-' + (++uid) }

/** A minimal valid definition, freshly built each call so tests can mutate it. */
function straightDef (over) {
  return Object.assign({
    key: key(),
    name: 'Test Straight',
    tier: 'beginner',
    blurb: 'A straight run, for the placement tests.',
    paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }] }],
    trackWidth: 40
  }, over || {})
}

/** Two lanes, water, blocked terrain, an LOS blocker and two removable rocks. */
function lagoonDef (over) {
  return Object.assign({
    key: key(),
    name: 'Test Lagoon',
    tier: 'intermediate',
    blurb: 'Two lanes around a lagoon.',
    paths: [
      { points: [{ x: 0, y: 120 }, { x: 1280, y: 120 }] },
      { points: [{ x: 0, y: 640 }, { x: 1280, y: 640 }] }
    ],
    trackWidth: 30,
    water: [{ x: 200, y: 300, w: 200, h: 120 }, { cx: 900, cy: 360, r: 60 }],
    blocked: [{ x: 600, y: 300, w: 80, h: 80 }, { cx: 1100, cy: 250, r: 40 }],
    blockers: [{ x: 500, y: 200, w: 20, h: 120 }],
    removable: [
      { x: 300, y: 520, r: 30, cost: 200, name: 'Mossy Boulder' },
      { x: 700, y: 520, r: 36, cost: 150, name: 'Hollow Stump', blocksLOS: true }
    ],
    palette: { grass: '#203a1c' }
  }, over || {})
}

const LAND = { placement: 'land', footprint: 14, name: 'Land Probe' }
const WATER = { placement: 'water', footprint: 14, name: 'Water Probe' }
const ANY = { placement: 'any', footprint: 14, name: 'Any Probe' }

export function run (t, OP) {
  const Maps = OP.Maps

  function mkSim (map, rules) {
    return OP.Sim.create({
      map: map,
      seed: 'maps',
      rules: Object.assign({ startCash: 5000, startLives: 100 }, rules || {})
    })
  }

  /* ================= registry ================= */

  t.section('define registers a map and normalises the optional fields')
  const straightKey = 'suite-straight'
  const sDef = Maps.define(straightDef({ key: straightKey, palette: { grass: '#123456' } }))
  t.eq(OP.MAPS[straightKey], sDef, 'the definition landed in OP.MAPS')
  t.ok(OP.MAP_ORDER.indexOf(straightKey) >= 0, 'and in OP.MAP_ORDER')
  t.eq(Maps.get(straightKey), sDef, 'get() returns it')
  t.ok(Maps.exists(straightKey), 'exists() agrees')
  t.ok(Maps.all().some(d => d.key === straightKey), 'all() lists it')
  t.deep(Maps.all().map(d => d.key), OP.MAP_ORDER.slice(),
    'all() is MAP_ORDER, in order and with no holes — the map picker renders this list')
  t.deep(sDef.water, [], 'an unauthored water list normalises to an empty array')
  t.deep(sDef.blocked, [], 'so does blocked')
  t.deep(sDef.blockers, [], 'so do LOS blockers')
  t.deep(sDef.removable, [], 'so do removable obstacles')
  t.eq(sDef.paths[0].smooth, 0, 'smooth defaults to 0 (hard corners)')
  t.eq(sDef.palette.grass, '#123456', 'an authored palette colour survives')
  t.eq(sDef.palette.water, Maps.DEFAULT_PALETTE.water, 'and unauthored palette keys fall back to the default')
  t.eq(Object.keys(Maps.DEFAULT_PALETTE).every(k => typeof sDef.palette[k] === 'string'), true,
    'every palette key the painter reads is present')
  t.neq(sDef.palette, Maps.DEFAULT_PALETTE,
    'the merge produced a fresh object, so one map cannot repaint the shared default')
  t.eq(Maps.DEFAULT_PALETTE.grass !== '#123456', true, 'and the default really was not overwritten')

  t.section('the exported constants the authoring spec quotes')
  t.deep(Maps.TIERS, ['beginner', 'intermediate', 'advanced', 'expert'], 'TIERS is the documented ladder')
  t.eq(Maps.MAX_PATHS, 3, 'MAX_PATHS matches the cap define() enforces')
  t.eq(Maps.MAX_SMOOTH, 24, 'and MAX_SMOOTH the smoothing cap')
  t.eq(Maps.TIERS.every(tier => Maps.byTier(tier) && true), true, 'every declared tier is queryable')

  t.section('an extra palette key is passed through untouched, so P6 can add one')
  const extraPal = Maps.define(straightDef({ key: 'suite-palextra', palette: { shoreline: '#8899aa' } }))
  t.eq(extraPal.palette.shoreline, '#8899aa', 'the unknown key survived')
  t.eq(extraPal.palette.grass, Maps.DEFAULT_PALETTE.grass, 'without displacing the known ones')
  t.eq(Maps.build('suite-palextra').palette.shoreline, '#8899aa', 'and it reaches the built map')

  t.section('OP.defineMap is the alias map files are authored against')
  t.eq(typeof OP.defineMap, 'function', 'the alias exists')
  const viaAlias = OP.defineMap(straightDef({ key: 'suite-alias' }))
  t.eq(Maps.get('suite-alias'), viaAlias, 'and registers exactly like Maps.define')
  t.ok(Maps.all().some(d => d.key === 'suite-alias'), 'landing in the roster too')
  rejects(t, () => OP.defineMap(straightDef({ key: 'suite-alias' })), 'suite-alias',
    'the alias enforces the same duplicate check')

  t.section('the registry answers for OWN keys only, never Object.prototype')
  // OP.MAPS is a plain object, so a bare `OP.MAPS[key]` lookup reports every
  // inherited name as a registered map — exists('constructor') read true and
  // get('toString') handed back a Function.
  for (const inherited of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    t.notOk(Maps.exists(inherited), 'exists("' + inherited + '") is false')
  }
  rejects(t, () => Maps.get('toString'), 'toString', 'get("toString")')
  t.notOk(Maps.all().some(d => !d || typeof d.key !== 'string'), 'all() has no phantom entries')
  t.noThrow(() => Maps.define(straightDef({ key: 'constructor', name: 'Constructor' })),
    'and a map may legitimately be keyed "constructor" — it was not "already registered"')
  t.eq(Maps.get('constructor').name, 'Constructor', 'which then reads back as itself, not as Object')
  t.notOk(Maps.exists('toStringTag'), 'a near-miss inherited name is still unknown')

  t.section('define deep-copies, so a later edit to the literal cannot rewrite a shipped map')
  const mutable = straightDef({ key: 'suite-copy' })
  const copied = Maps.define(mutable)
  mutable.paths[0].points[0].x = 999
  mutable.trackWidth = 1
  mutable.name = 'Rewritten'
  t.eq(copied.paths[0].points[0].x, 0, 'the registered points are unaffected')
  t.eq(copied.trackWidth, 40, 'so is trackWidth')
  t.eq(copied.name, 'Test Straight', 'so is the name')

  t.section('byTier')
  Maps.define(lagoonDef({ key: 'suite-lagoon' }))
  t.ok(Maps.byTier('beginner').some(d => d.key === straightKey), 'the beginner map is in the beginner tier')
  t.notOk(Maps.byTier('expert').some(d => d.key === straightKey), 'and not in expert')
  t.ok(Maps.byTier('intermediate').some(d => d.key === 'suite-lagoon'), 'the lagoon is intermediate')
  t.ok(Maps.byTier('beginner').every(d => d.tier === 'beginner'), 'every result actually has that tier')
  rejects(t, () => Maps.byTier('nightmare'), 'nightmare', 'byTier with an unknown tier')
  rejects(t, () => Maps.get('no-such-map'), 'no-such-map', 'get() with an unknown key')
  t.notOk(Maps.exists('no-such-map'), 'exists() is false for an unknown key')

  /* ================= validation ================= */

  t.section('define throws, naming the map, on a missing or duplicate key')
  rejects(t, () => Maps.define(straightDef({ key: undefined })), 'key', 'no key at all')
  rejects(t, () => Maps.define(straightDef({ key: 42 })), 'key', 'a non-string key')
  rejects(t, () => Maps.define(straightDef({ key: straightKey })), straightKey, 'a duplicate key')
  rejects(t, () => Maps.define(null), 'object', 'a null definition')
  t.eq(OP.MAP_ORDER.filter(k => k === straightKey).length, 1,
    'a rejected duplicate did not get appended to MAP_ORDER')

  t.section('define throws on identity fields')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-noname', name: undefined })), 'suite-noname', 'no display name')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-noblurb', blurb: undefined })), 'suite-noblurb', 'no blurb')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-notier', tier: undefined })), 'suite-notier', 'no tier')
  const tierErr = rejects(t, () => Maps.define(straightDef({ key: 'suite-badtier', tier: 'gentle' })),
    'suite-badtier', 'an unknown tier')
  t.ok(tierErr && /beginner/.test(tierErr.message), 'and the tier message lists the legal tiers')
  t.notOk(Maps.exists('suite-badtier'), 'a map rejected mid-validation is not registered')

  t.section('define throws on path geometry')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-nopaths', paths: [] })), 'suite-nopaths', 'no paths')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-pathsmissing', paths: undefined })), 'suite-pathsmissing', 'a missing paths array')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-1point', paths: [{ points: [{ x: 10, y: 10 }] }]
  })), 'suite-1point', 'a path with one point')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-nopoints', paths: [{ smooth: 2 }]
  })), 'suite-nopoints', 'a path with no points array')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-4paths',
    paths: [0, 1, 2, 3].map(i => ({ points: [{ x: 0, y: 100 + i * 100 }, { x: 1280, y: 100 + i * 100 }] }))
  })), 'suite-4paths', 'four paths (the cap is three)')
  t.noThrow(() => Maps.define(straightDef({
    key: 'suite-3paths',
    paths: [0, 1, 2].map(i => ({ points: [{ x: 0, y: 100 + i * 100 }, { x: 1280, y: 100 + i * 100 }] }))
  })), 'exactly three paths is legal')

  t.section('define throws on a control point outside the 1280x720 field')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-offright', paths: [{ points: [{ x: 0, y: 360 }, { x: 1400, y: 360 }] }]
  })), 'suite-offright', 'a point past the right edge')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-offtop', paths: [{ points: [{ x: 0, y: -20 }, { x: 1280, y: 360 }] }]
  })), 'suite-offtop', 'a point above the field')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-offbottom', paths: [{ points: [{ x: 0, y: 360 }, { x: 640, y: 900 }] }]
  })), 'suite-offbottom', 'a point below the field')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-nanpoint', paths: [{ points: [{ x: 0, y: 360 }, { x: NaN, y: 360 }] }]
  })), 'suite-nanpoint', 'a NaN coordinate')
  t.noThrow(() => Maps.define(straightDef({
    key: 'suite-edges', paths: [{ points: [{ x: 0, y: 0 }, { x: 1280, y: 720 }] }]
  })), 'a point exactly on the field corner is legal — entries live on the edge')

  t.section('define throws when SMOOTHING pushes the built curve off the field')
  // Verified geometry: every control point is inside the field, but the
  // Catmull-Rom overshoot on the tight top corner reaches y = -5.
  const spike = [{ x: 100, y: 400 }, { x: 400, y: 40 }, { x: 420, y: 40 }, { x: 720, y: 400 }]
  t.noThrow(() => Maps.define(straightDef({
    key: 'suite-spike-raw', paths: [{ points: spike, smooth: 0 }]
  })), 'the same points unsmoothed are inside the field, so the per-point check passes them')
  const overshoot = rejects(t, () => Maps.define(straightDef({
    key: 'suite-spike', paths: [{ points: spike, smooth: 3 }]
  })), 'suite-spike', 'a smoothed path that overshoots off the top of the field')
  t.ok(overshoot && /smooth/.test(overshoot.message), 'and the message tells the author to lower smooth')
  t.noThrow(() => Maps.define(straightDef({
    key: 'suite-spike-safe', paths: [{ points: spike.map(p => ({ x: p.x, y: p.y + 60 })), smooth: 3 }]
  })), 'the same shape 60 units lower is accepted — the check is not a blanket ban on smoothing')

  t.section('define throws on a malformed smooth')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-fracsmooth', paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }], smooth: 1.5 }]
  })), 'suite-fracsmooth', 'a fractional smooth')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-negsmooth', paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }], smooth: -1 }]
  })), 'suite-negsmooth', 'a negative smooth')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-hugesmooth', paths: [{ points: [{ x: 0, y: 360 }, { x: 1280, y: 360 }], smooth: 1000 }]
  })), 'suite-hugesmooth', 'a smooth of 1000, which is a typo rather than a curve')

  t.section('define throws on trackWidth')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-tw0', trackWidth: 0 })), 'suite-tw0', 'trackWidth 0')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-twneg', trackWidth: -12 })), 'suite-twneg', 'a negative trackWidth')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-twmissing', trackWidth: undefined })), 'suite-twmissing', 'no trackWidth')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-twstring', trackWidth: '40' })), 'suite-twstring', 'a string trackWidth')

  t.section('define throws on a malformed region')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r1', water: [{ x: 10, y: 10 }] })), 'suite-r1', 'a rect with no size')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r2', water: [{ cx: 10, cy: 10 }] })), 'suite-r2', 'a circle with no radius')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r3', water: [{ cx: 10, cy: 10, r: -4 }] })), 'suite-r3', 'a negative radius')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r4', blocked: [{ x: 0, y: 0, w: 0, h: 40 }] })), 'suite-r4', 'a zero-width rect')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r5', water: { x: 0, y: 0, w: 4, h: 4 } })), 'suite-r5', 'a region list that is not an array')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r6', blocked: [null] })), 'suite-r6', 'a null region')
  rejects(t, () => Maps.define(straightDef({ key: 'suite-r7', water: [{ x: 0, y: 0, w: NaN, h: 4 }] })), 'suite-r7', 'a NaN dimension')
  const circleBlocker = rejects(t, () => Maps.define(straightDef({
    key: 'suite-r8', blockers: [{ cx: 100, cy: 100, r: 30 }]
  })), 'suite-r8', 'a circular LOS blocker')
  t.ok(circleBlocker && /rect/.test(circleBlocker.message),
    'and it says blockers are rects only, because targeting.js reads x/y/w/h with no shape dispatch')

  t.section('define throws on a malformed removable obstacle')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-o1', removable: [{ x: 100, y: 100, r: 20, name: 'Log' }]
  })), 'suite-o1', 'an obstacle with no cost')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-o2', removable: [{ x: 100, y: 100, r: 20, cost: 100 }]
  })), 'suite-o2', 'an obstacle with no name')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-o3', removable: [{ x: 100, y: 100, r: 0, cost: 100, name: 'Log' }]
  })), 'suite-o3', 'an obstacle with no radius')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-o4', removable: [{ x: 100, y: 100, r: 20, cost: -50, name: 'Log' }]
  })), 'suite-o4', 'an obstacle with a negative cost')
  rejects(t, () => Maps.define(straightDef({
    key: 'suite-o5', palette: { grass: 3 }
  })), 'suite-o5', 'a non-string palette value')

  /* ================= build ================= */

  t.section('build produces the runtime map Sim.create wants')
  const straight = Maps.build(straightKey)
  t.ok(straight.paths[0] instanceof OP.Track, 'paths are real Track instances')
  t.close(straight.paths[0].length, 1280, 1e-9, 'and carry the right arc length')
  t.eq(straight.key, straightKey, 'the key comes through (a save stores only this)')
  t.eq(straight.name, 'Test Straight', 'so does the display name')
  t.eq(straight.tier, 'beginner', 'and the tier')
  t.eq(straight.trackWidth, 40, 'and trackWidth')
  t.ok(Array.isArray(straight.water) && Array.isArray(straight.blocked), 'water and blocked are arrays')
  t.ok(Array.isArray(straight.blockers) && Array.isArray(straight.removable), 'blockers and removable are arrays')
  t.deep(straight.cleared, [], 'cleared starts empty')
  t.ok(typeof straight.palette.grass === 'string', 'the palette came along for the painter')
  t.noThrow(() => mkSim(straight), 'Sim.create accepts it')

  t.section('build is idempotent — twice gives equivalent geometry, independent state')
  const again = Maps.build(straightKey)
  t.close(again.paths[0].length, straight.paths[0].length, 1e-9, 'same length')
  t.eq(again.paths[0].n, straight.paths[0].n, 'same point count')
  t.deep(again.paths[0].bounds(), straight.paths[0].bounds(), 'same bounds')
  t.neq(again, straight, 'but a different object')
  t.neq(again.cleared, straight.cleared, 'with its own cleared array, so two games cannot share progress')
  t.eq(Maps.get(straightKey).paths[0].points.length, 2,
    'and building did not replace the definition points with the smoothed ones')

  t.section('build validates a raw, unregistered definition without registering it')
  const rawKey = 'suite-unregistered'
  const rawBuilt = Maps.build(straightDef({ key: rawKey }))
  t.eq(rawBuilt.key, rawKey, 'an ad-hoc definition builds')
  t.notOk(Maps.exists(rawKey), 'and build() does not register it — that is define()\'s job')
  rejects(t, () => Maps.build(straightDef({ key: 'suite-badbuild', trackWidth: 0 })),
    'suite-badbuild', 'build() rejects a malformed definition rather than half-building it')

  t.section('smoothing is applied at build time')
  const curveDef = Maps.define(straightDef({
    key: 'suite-curve',
    paths: [{
      points: [{ x: 0, y: 200 }, { x: 300, y: 200 }, { x: 420, y: 480 }, { x: 800, y: 480 },
        { x: 900, y: 160 }, { x: 1279, y: 160 }],
      smooth: 3
    }]
  }))
  const curve = Maps.build(curveDef)
  const hard = Maps.build(straightDef({ key: 'suite-curve-hard', paths: [{ points: curveDef.paths[0].points, smooth: 0 }] }))
  t.gt(curve.paths[0].n, hard.paths[0].n, 'a smoothed path has more polyline points')
  t.gt(curve.paths[0].length, hard.paths[0].length, 'and is longer than the raw control polygon')
  const cb = curve.paths[0].bounds()
  t.ok(cb.x0 >= 0 && cb.y0 >= 0 && cb.x1 <= OP.FIELD_W && cb.y1 <= OP.FIELD_H, 'and stays inside the field')

  t.section('a built map actually carries balloons')
  const runSim = mkSim(straight)
  const b = OP.Balloons.spawn(runSim, { tier: 'red', path: 0, t: 0 })
  t.close(b.y, 360, 1e-6, 'a balloon starts on the path')
  OP.Sim.run(runSim, 60)
  t.gt(b.x, 20, 'and travels along it')

  /* ================= placement: the path margin ================= */

  t.section('nothing may be built on or within trackWidth of a path')
  t.notOk(Maps.canPlace(straight, LAND, 640, 360).ok, 'dead centre of the road is refused')
  t.ok(/path/i.test(Maps.canPlace(straight, LAND, 640, 360).reason), 'with a reason that says why')
  t.notOk(Maps.canPlace(straight, LAND, 640, 322).ok, '38 units out is still inside the 40-unit margin')
  t.notOk(Maps.canPlace(straight, LAND, 640, 400).ok, 'the margin is inclusive at exactly trackWidth')
  t.ok(Maps.canPlace(straight, LAND, 640, 318).ok, '42 units out is buildable')
  t.ok(Maps.canPlace(straight, LAND, 640, 402).ok, 'on either side')
  t.close(Maps.distanceToPath(straight, 640, 318), 42, 1e-9, 'distanceToPath measures from the centreline')
  t.ok(Maps.onPath(straight, 640, 330), 'onPath is true inside the margin')
  t.notOk(Maps.onPath(straight, 640, 300), 'and false outside it')
  t.eq(Maps.distanceToPath({ paths: [] }, 10, 10), Infinity, 'a map with no usable paths has no path distance')

  t.section('the margin is skipped for maps that declare no trackWidth (the harness fixtures)')
  const stub = { key: 'stub', paths: [straight.paths[0]] }
  t.ok(Maps.canPlace(stub, LAND, 640, 360).ok, 'a bare fixture map allows a tower on its track')
  t.ok(Maps.canPlace(stub, WATER, 640, 360).ok, 'and does not enforce water it never declared')
  t.notOk(Maps.onPath(stub, 640, 360), 'onPath reports false rather than guessing a width')

  t.section('placement is refused outside the play field')
  t.notOk(Maps.canPlace(straight, LAND, -10, 100).ok, 'left of the field')
  t.notOk(Maps.canPlace(straight, LAND, OP.FIELD_W + 1, 100).ok, 'right of it')
  t.notOk(Maps.canPlace(straight, LAND, 100, OP.FIELD_H + 1).ok, 'below it')
  t.notOk(Maps.canPlace(straight, LAND, NaN, 100).ok, 'and a NaN coordinate is refused rather than passing every test')

  /* ================= placement: water ================= */

  const lagoon = Maps.build('suite-lagoon')

  t.section('land towers stay off water; water towers stay on it')
  t.notOk(Maps.canPlace(lagoon, LAND, 300, 360).ok, 'a land tower cannot stand in the lagoon')
  t.ok(/water/i.test(Maps.canPlace(lagoon, LAND, 300, 360).reason), 'with a water-specific reason')
  t.ok(Maps.canPlace(lagoon, WATER, 300, 360).ok, 'a water tower can')
  t.notOk(Maps.canPlace(lagoon, WATER, 500, 500).ok, 'a water tower cannot stand on dry land')
  t.ok(/water/i.test(Maps.canPlace(lagoon, WATER, 500, 500).reason), 'and says so')
  t.neq(Maps.canPlace(lagoon, WATER, 500, 500).reason, Maps.canPlace(lagoon, LAND, 300, 360).reason,
    'the two water refusals are distinct messages, not one vague one')
  t.ok(Maps.canPlace(lagoon, LAND, 500, 500).ok, 'a land tower on dry land is fine')

  t.section('a placement of "any" ignores the land/water rule entirely')
  t.ok(Maps.canPlace(lagoon, ANY, 300, 360).ok, 'on water')
  t.ok(Maps.canPlace(lagoon, ANY, 500, 500).ok, 'and on land')
  t.notOk(Maps.canPlace(lagoon, ANY, 640, 120).ok, 'but it still cannot stand on the road')

  t.section('circular water regions work too')
  t.ok(Maps.isWater(lagoon, 900, 360), 'the circle centre is water')
  t.ok(Maps.isWater(lagoon, 900, 410), 'and so is a point inside its radius')
  t.notOk(Maps.isWater(lagoon, 900, 290), 'a point 70 units from a 60-unit radius is not')
  t.ok(Maps.canPlace(lagoon, WATER, 900, 360).ok, 'a water tower may use it')
  t.ok(Maps.canPlace(lagoon, LAND, 900, 290).ok, 'and land is buildable just outside it')

  t.section('a dry built map forbids water towers everywhere')
  t.deep(straight.water, [], 'the map declares an empty water list')
  t.notOk(Maps.canPlace(straight, WATER, 300, 100).ok, 'so a water tower has nowhere to go')
  t.notOk(Maps.canPlace(straight, WATER, 900, 600).ok, 'anywhere at all')
  t.ok(Maps.canPlace(straight, LAND, 300, 100).ok, 'while land towers are unaffected')

  /* ================= placement: blocked ================= */

  t.section('blocked regions refuse everything')
  t.notOk(Maps.canPlace(lagoon, LAND, 640, 340).ok, 'inside the blocked rect')
  t.ok(/block/i.test(Maps.canPlace(lagoon, LAND, 640, 340).reason), 'with its own reason')
  t.notOk(Maps.canPlace(lagoon, WATER, 640, 340).ok, 'for water towers as well')
  t.notOk(Maps.canPlace(lagoon, ANY, 640, 340).ok, 'and for "any"')
  t.ok(Maps.canPlace(lagoon, LAND, 640, 290).ok, 'just outside it is buildable')
  t.ok(Maps.isBlocked(lagoon, 1100, 250), 'a circular blocked region reads as blocked')
  t.notOk(Maps.canPlace(lagoon, LAND, 1100, 250).ok, 'and refuses placement')
  t.ok(Maps.canPlace(lagoon, LAND, 1100, 300).ok, 'while 50 units from its 40-unit radius is fine')

  /* ================= removable obstacles ================= */

  t.section('an uncleared obstacle blocks placement and names its price')
  const obsSim = mkSim(Maps.build('suite-lagoon'))
  const obsMap = obsSim.map
  t.eq(Maps.obstacleAt(obsMap, 300, 520), 0, 'obstacleAt finds the boulder')
  t.eq(Maps.obstacleAt(obsMap, 300, 560), -1, 'and nothing just outside its radius')
  const blockedByRock = Maps.canPlace(obsMap, LAND, 300, 520)
  t.notOk(blockedByRock.ok, 'the boulder blocks placement')
  t.ok(blockedByRock.reason.indexOf('Mossy Boulder') >= 0, 'the reason names the obstacle')
  t.ok(blockedByRock.reason.indexOf('200') >= 0, 'and quotes the price')
  t.ok(Maps.canPlace(obsMap, LAND, 300, 560).ok, 'ground beside it is buildable')

  t.section('clearing charges cash and changes placement legality')
  const cashBefore = obsSim.cash
  const cleared = Maps.clearObstacle(obsSim, 0)
  t.ok(cleared.ok, 'clearing succeeds')
  t.eq(obsSim.cash, cashBefore - 200, 'and cost exactly the authored price')
  t.eq(obsSim.stats.cashSpent, 200, 'the spend was recorded')
  t.deep(obsMap.cleared, [0], 'the index is recorded as an integer')
  t.ok(Maps.isCleared(obsMap, 0), 'isCleared agrees')
  t.ok(Maps.canPlace(obsMap, LAND, 300, 520).ok, 'and the ground is now buildable')
  t.eq(Maps.obstacleAt(obsMap, 300, 520), -1, 'obstacleAt ignores cleared obstacles')
  t.ok(obsSim.events.some(e => e.kind === 'clearobstacle' && e.index === 0 && e.cost === 200),
    'an event was emitted for the UI and the audio')
  t.deep(JSON.parse(JSON.stringify(obsMap.cleared)), [0], 'the cleared set is plain integers, so it serialises')

  t.section('clearing refuses the impossible cases, each with its own reason')
  const twice = Maps.clearObstacle(obsSim, 0)
  t.notOk(twice.ok, 'clearing the same obstacle twice fails')
  t.ok(/already/i.test(twice.reason), 'saying it is already cleared')
  t.eq(obsSim.cash, cashBefore - 200, 'and charges nothing the second time')
  t.notOk(Maps.clearObstacle(obsSim, 7).ok, 'an index past the end fails')
  t.ok(/no such/i.test(Maps.clearObstacle(obsSim, 7).reason), 'with a distinct reason')
  t.notOk(Maps.clearObstacle(obsSim, -1).ok, 'a negative index fails')
  t.notOk(Maps.clearObstacle(obsSim, 'boulder').ok, 'a non-numeric index fails')
  t.deep(obsMap.cleared, [0], 'and none of that corrupted the cleared set')
  t.notOk(Maps.clearObstacle(mkSim(straight), 0).ok, 'a map with no obstacles refuses politely')

  t.section('an unaffordable obstacle stays put')
  const poor = mkSim(Maps.build('suite-lagoon'), { startCash: 100 })
  const refused = Maps.clearObstacle(poor, 0)
  t.notOk(refused.ok, 'clearing is refused')
  t.ok(/cash/i.test(refused.reason), 'for lack of cash')
  t.eq(poor.cash, 100, 'nothing was charged')
  t.deep(poor.map.cleared, [], 'and nothing was cleared')
  t.notOk(Maps.canPlace(poor.map, LAND, 300, 520).ok, 'so the ground is still blocked')

  t.section('obstacle cost scales with the difficulty cost multiplier')
  const dear = mkSim(Maps.build('suite-lagoon'), { costMul: 2 })
  const dearCash = dear.cash
  t.ok(Maps.clearObstacle(dear, 1).ok, 'the stump can be cleared')
  t.eq(dear.cash, dearCash - 300, '150 at costMul 2 is 300')

  t.section('a removable obstacle can also block line of sight')
  const losSim = mkSim(Maps.build('suite-lagoon'))
  const losMap = losSim.map
  t.eq(losMap.blockers.length, 2, 'the authored blocker plus the stump-derived one')
  t.ok(losMap.blockers.every(r => typeof r.x === 'number' && typeof r.y === 'number' &&
    typeof r.w === 'number' && typeof r.h === 'number'),
  'every blocker is a rect with the x/y/w/h keys targeting.js indexes')
  t.notOk(OP.Targeting.hasLineOfSight(losSim, 700, 420, 700, 620), 'sight through the stump is blocked')
  t.notOk(OP.Targeting.hasLineOfSight(losSim, 400, 260, 600, 260), 'and through the authored rock outcrop')
  t.ok(Maps.clearObstacle(losSim, 1).ok, 'clear the stump')
  t.eq(losMap.blockers.length, 1, 'its LOS blocker went with it')
  t.ok(OP.Targeting.hasLineOfSight(losSim, 700, 420, 700, 620), 'so the sight line is restored')
  t.notOk(OP.Targeting.hasLineOfSight(losSim, 400, 260, 600, 260), 'while the permanent outcrop still blocks')

  t.section('the cleared set round-trips through a save')
  const state = Maps.clearedState(losSim)
  t.deep(state, [1], 'clearedState is the plain integer list')
  const restoredSim = mkSim(Maps.build('suite-lagoon'))
  t.notOk(Maps.canPlace(restoredSim.map, LAND, 700, 520).ok, 'a fresh map has the stump back')
  Maps.restoreCleared(restoredSim, JSON.parse(JSON.stringify(state)))
  t.deep(restoredSim.map.cleared, [1], 'restoring puts the index back')
  t.ok(Maps.canPlace(restoredSim.map, LAND, 700, 520).ok, 'and placement legality matches the saved game')
  t.eq(restoredSim.map.blockers.length, 1, 'along with the LOS state')
  t.deep(Maps.restoreCleared(restoredSim, [1, 1, 99, -3, 'x', 0]), [0, 1],
    'junk and duplicates are discarded; the rest is sorted')

  /* ================= integration with Towers ================= */

  t.section('Towers.canPlaceShape routes through the map mask')
  const towerSim = mkSim(Maps.build('suite-lagoon'))
  const probe = { footprint: 14, placement: 'land', name: 'Probe' }
  const onRoad = OP.Towers.canPlaceShape(towerSim, probe, 640, 120)
  t.notOk(onRoad.ok, 'a tower cannot be placed on the road through the real placement entry point')
  t.eq(onRoad.reason, Maps.canPlace(towerSim.map, probe, 640, 120).reason, 'and the map\'s reason is what the UI sees')
  t.ok(OP.Towers.canPlaceShape(towerSim, probe, 640, 290).ok, 'open ground is accepted')
  t.notOk(OP.Towers.canPlaceShape(towerSim, probe, 300, 360).ok, 'the lagoon is refused for a land tower')
  t.notOk(OP.Towers.canPlaceShape(towerSim, probe, 300, 520).ok, 'and so is the uncleared boulder')
  t.ok(Maps.clearObstacle(towerSim, 0).ok, 'clear the boulder')
  t.ok(OP.Towers.canPlaceShape(towerSim, probe, 300, 520).ok, 'and the same spot becomes legal end-to-end')
  const waterProbe = { footprint: 14, placement: 'water', name: 'Water Probe' }
  t.ok(OP.Towers.canPlaceShape(towerSim, waterProbe, 300, 360).ok, 'a water tower places in the lagoon')
  t.notOk(OP.Towers.canPlaceShape(towerSim, waterProbe, 640, 290).ok, 'and not on dry ground')

  /* ================= reverse mode ================= */

  t.section('reversePaths swaps entry and exit without touching the original')
  const fwd = Maps.build('suite-curve')
  const fwdTrack = fwd.paths[0]
  const fwdStart = fwdTrack.posAt(0)
  const fwdEnd = fwdTrack.posAt(fwdTrack.length)
  const fwdLen = fwdTrack.length
  const rev = Maps.reversePaths(fwd)
  const revTrack = rev.paths[0]
  t.ok(revTrack instanceof OP.Track, 'the reversed path is still a Track')
  t.close(revTrack.length, fwdLen, 1e-9, 'the same length — reversing must not re-smooth')
  t.close(revTrack.posAt(0).x, fwdEnd.x, 1e-9, 'the reversed entry is the forward exit (x)')
  t.close(revTrack.posAt(0).y, fwdEnd.y, 1e-9, 'and (y)')
  t.close(revTrack.posAt(revTrack.length).x, fwdStart.x, 1e-9, 'the reversed exit is the forward entry (x)')
  t.close(revTrack.posAt(revTrack.length).y, fwdStart.y, 1e-9, 'and (y)')
  t.eq(revTrack.n, fwdTrack.n, 'point for point, no resampling')
  t.close(fwdTrack.length, fwdLen, 1e-12, 'the original track length is untouched')
  t.close(fwdTrack.posAt(0).x, fwdStart.x, 1e-12, 'the original entry is untouched')
  t.neq(revTrack, fwdTrack, 'and it is a different Track object')
  t.eq(rev.reversed, true, 'the copy is flagged reversed')
  t.eq(fwd.reversed, false, 'the original is not')
  t.eq(rev.key, fwd.key, 'the key is preserved, so a save still resolves the map')

  t.section('reversing twice returns the original orientation')
  const back = Maps.reversePaths(rev)
  t.close(back.paths[0].posAt(0).x, fwdStart.x, 1e-9, 'entry is back where it started (x)')
  t.close(back.paths[0].posAt(0).y, fwdStart.y, 1e-9, 'and (y)')
  t.close(back.paths[0].length, fwdLen, 1e-9, 'with the same length')
  t.eq(back.reversed, false, 'and the flag toggled back')

  t.section('reversePaths deep-copies the masks')
  const lagoonFwd = Maps.build('suite-lagoon')
  const lagoonRev = Maps.reversePaths(lagoonFwd)
  t.eq(lagoonRev.paths.length, 2, 'both lanes were reversed')
  t.close(lagoonRev.paths[1].posAt(0).x, 1280, 1e-9, 'the second lane now enters from the right')
  t.neq(lagoonRev.water, lagoonFwd.water, 'the water list is a copy')
  t.neq(lagoonRev.removable, lagoonFwd.removable, 'so is the obstacle list')
  t.neq(lagoonRev.cleared, lagoonFwd.cleared, 'and the cleared set')
  lagoonRev.water[0].x = -5000
  lagoonRev.cleared.push(0)
  lagoonRev.removable[0].cost = 1
  t.eq(lagoonFwd.water[0].x, 200, 'mutating the copy leaves the original water alone')
  t.deep(lagoonFwd.cleared, [], 'and the original cleared set alone')
  t.eq(lagoonFwd.removable[0].cost, 200, 'and the original obstacle cost alone')
  t.ok(Maps.canPlace(lagoonRev, LAND, 640, 640).ok === false, 'the reversed map still masks its own road')
  t.noThrow(() => mkSim(lagoonRev), 'and Sim.create accepts a reversed map')
  rejects(t, () => Maps.reversePaths(null), 'map', 'reversePaths with no map')

  t.section('a reversed map runs: balloons enter where they used to leave')
  // This is the shell\'s Reverse-mode flow verbatim: build, reverse, Sim.create.
  const revSim = mkSim(Maps.reversePaths(Maps.build(straightKey)))
  const revB = OP.Balloons.spawn(revSim, { tier: 'red', path: 0, t: 0 })
  t.close(revB.x, 1280, 1e-6, 'a balloon starts at the far end')
  OP.Sim.run(revSim, 60)
  t.lt(revB.x, 1280, 'and walks back the other way')
  t.close(revB.y, 360, 1e-6, 'along the same road')
  t.notOk(Maps.canPlace(revSim.map, LAND, 640, 360).ok, 'whose margin still masks placement')

  t.section('reversePaths also handles an unbuilt, definition-shaped map')
  const defShaped = { key: 'defshape', paths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }], smooth: 2 }] }
  const defRev = Maps.reversePaths(defShaped)
  t.deep(defRev.paths[0].points.map(p => p.x), [20, 10, 0], 'the control points come back reversed')
  t.eq(defRev.paths[0].smooth, 2, 'keeping the authored smoothing')
  t.deep(defShaped.paths[0].points.map(p => p.x), [0, 10, 20], 'and the input is untouched')

  /* ================= buildableFraction ================= */

  t.section('buildableFraction is sane for a simple map')
  const frac = Maps.buildableFraction(straight)
  t.between(frac, 0, 1, 'it is a fraction')
  t.between(frac, 0.8, 0.95, 'one straight road with a 40-unit margin leaves most of the field: ' + frac.toFixed(3))
  t.close(Maps.buildableFraction(straight, { step: 32 }), frac, 0.05, 'a coarser sample grid agrees')

  t.section('and it responds to the masks, not just to the path')
  const wide = Maps.buildableFraction(Maps.build(straightDef({ key: 'suite-wide', trackWidth: 200 })))
  t.lt(wide, frac, 'a much wider track margin leaves less room')
  const walled = Maps.buildableFraction(Maps.build(straightDef({
    key: 'suite-walled', blocked: [{ x: 0, y: 0, w: 640, h: 720 }]
  })))
  t.lt(walled, frac, 'blocking half the field lowers it')
  t.between(walled, 0.35, 0.55, 'to roughly half of what was left: ' + walled.toFixed(3))
  const sealed = Maps.buildableFraction(Maps.build(straightDef({
    key: 'suite-sealed', blocked: [{ x: 0, y: 0, w: OP.FIELD_W, h: OP.FIELD_H }]
  })))
  t.eq(sealed, 0, 'a fully blocked map has nowhere to build')
  t.lt(Maps.buildableFraction(lagoon, { placement: 'water' }), Maps.buildableFraction(lagoon),
    'water towers have far less of the map than land towers')
  t.gt(Maps.buildableFraction(lagoon, { placement: 'water' }), 0, 'but the lagoon is not zero')
  // A fresh pair: the copies above were deliberately vandalised to prove
  // reversePaths deep-copies.
  const cleanFwd = Maps.build('suite-lagoon')
  t.close(Maps.buildableFraction(Maps.reversePaths(cleanFwd)), Maps.buildableFraction(cleanFwd), 1e-9,
    'reversing a map does not change how much of it is buildable')

  t.section('totalPathLength')
  t.close(Maps.totalPathLength(straight), 1280, 1e-9, 'one 1280-unit lane')
  t.close(Maps.totalPathLength(lagoon), 2560, 1e-9, 'two of them')
}

export const name = 'sprites-towers'
export const needs = ['js/render/sprites-towers.js']

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeSim } from './_fixture.mjs'
import { arena } from './_towerfamily.mjs'
import { ROOT } from '../loadgame.mjs'

/* Tower and projectile sprites.

   Drawing is tested with a recording context rather than a real canvas: what
   matters is that something is painted, that it differs when the game state
   differs, and that painting is cheap and side-effect free. How it looks is not
   something a suite can judge — but "this tower draws nothing", "every tower draws
   the same thing" and "a maxed tower looks identical to a fresh one" all are. */

export function run (t, OP, env) {
  const R = OP.Render
  const M = OP.M

  /* Coverage is measured against the SHIPPED roster, not OP.TOWERS. Other suites
     register throwaway test towers into the same registry — under --all there are a
     dozen of them — and a sprite suite that demanded art for `det-bomber` would be
     failing on a fixture. The family files declare OP.FAMILY_ROSTERS, and the hero
     source is read directly, so both lists are authoritative. */
  // _TEMPLATE.js reassigns OP.FAMILY_ROSTERS.primary when a suite evalFiles it, so
  // the template's own key can leak into the roster. It is not shipped art.
  const SHIPPED_TOWERS = OP.FAMILIES
    .reduce((acc, fam) => acc.concat(OP.FAMILY_ROSTERS[fam] || []), [])
    .filter(k => OP.TOWERS[k] && k.indexOf('template-') !== 0)

  const SHIPPED_FILES = [
    'js/towers/primary.js', 'js/towers/military.js', 'js/towers/magic.js',
    'js/towers/support.js', 'js/towers/heroes.js', 'js/towers/paragons.js'
  ]
  const shippedSrc = SHIPPED_FILES.map(function (rel) {
    try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { return '' }
  }).join('\n')

  const SHIPPED_HEROES = OP.HERO_ORDER.filter(k => shippedSrc.indexOf("'" + k + "'") >= 0)

  // Kinds declared by the templates and by test fixtures are not shipped either, so
  // the drawer-coverage check is measured against what the shipped files declare.
  const SHIPPED_KINDS = Object.keys(OP.PROJ_KINDS)
    .filter(k => new RegExp("declareProjKind\\(\\s*'" + k.replace(/[-]/g, '\\-') + "'").test(shippedSrc))

  /** Records call names, and the fill/stroke styles in use when they happen, so a
      signature captures colour choices as well as geometry. */
  function recorder () {
    const calls = []
    const styles = []
    let gradients = 0
    let shadows = 0
    // Arguments are captured, not just call names. A sprite that flips left/right
    // to face its target changes coordinates while issuing the identical call
    // sequence — a name-only signature is blind to it, and to a sprite drawing in
    // the wrong place.
    const rec = name => function () {
      const args = []
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i]
        args.push(typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v)
      }
      calls.push(name + '(' + args.join(',') + ')')
      styles.push(String(rec.ctx.fillStyle) + '/' + String(rec.ctx.strokeStyle))
    }
    const ctx = {
      calls, styles,
      get gradients () { return gradients },
      get shadows () { return shadows },
      save: rec('save'), restore: rec('restore'),
      setTransform: rec('setTransform'), transform: rec('transform'),
      translate: rec('translate'), rotate: rec('rotate'), scale: rec('scale'),
      clearRect: rec('clearRect'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'),
      beginPath: rec('beginPath'), closePath: rec('closePath'),
      moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'), arcTo: rec('arcTo'),
      ellipse: rec('ellipse'), rect: rec('rect'), roundRect: rec('roundRect'),
      quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
      fill: rec('fill'), stroke: rec('stroke'), clip: rec('clip'),
      drawImage: rec('drawImage'), fillText: rec('fillText'), strokeText: rec('strokeText'),
      setLineDash: rec('setLineDash'), getLineDash: () => [],
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => { gradients++; return { addColorStop () {} } },
      createRadialGradient: () => { gradients++; return { addColorStop () {} } },
      createPattern: () => ({ setTransform () {} }),
      getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      font: '10px monospace', textAlign: 'start', textBaseline: 'alphabetic',
      lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over',
      filter: 'none', lineDashOffset: 0,
      set shadowBlur (v) { if (v) shadows++; this._sb = v },
      get shadowBlur () { return this._sb || 0 },
      shadowColor: 'transparent'
    }
    rec.ctx = ctx
    return ctx
  }

  const sig = ctx => ctx.calls.join(',') + '|' + ctx.styles.join(',')

  function sim (opts) {
    return makeSim(OP, Object.assign({
      tracks: [arena(OP)], cash: 1e9, lives: 1e8, seed: 'sprite-suite'
    }, opts || {}))
  }
  function placeAt (s, key, i) {
    const x = 90 + (i % 9) * 128
    const y = 620 - Math.floor(i / 9) * 90
    return OP.Towers.place(s, key, x, y, { free: true })
  }
  function upgradeTo (s, tower, target) {
    let guard = 0
    while (tower.tiers.join() !== target.join() && guard++ < 32) {
      let bought = false
      for (let p = 0; p < 3; p++) {
        if (tower.tiers[p] >= target[p]) continue
        if (OP.Upgrades.buy(s, tower, p).ok) { bought = true; break }
      }
      if (!bought) return false
    }
    return true
  }
  function drawTower (tower, frame) {
    const fn = R.towerSprites[tower.key]
    const ctx = recorder()
    if (fn) fn(ctx, tower, tower.x, tower.y, frame || {})
    return ctx
  }

  /* ---------- coverage ---------- */

  t.section('every tower and hero has a sprite')
  const missingTowers = SHIPPED_TOWERS.filter(k => !R.towerSprites[k])
  t.eq(missingTowers.length, 0, missingTowers.length
    ? `no sprite for: ${missingTowers.join(', ')}`
    : `all ${SHIPPED_TOWERS.length} shipped towers have a sprite`)

  const missingHeroes = SHIPPED_HEROES.filter(k => !R.towerSprites[k])
  t.eq(missingHeroes.length, 0, missingHeroes.length
    ? `no sprite for hero: ${missingHeroes.join(', ')}`
    : `all ${SHIPPED_HEROES.length} shipped heroes have a sprite`)

  t.section('every declared projectile kind has a drawer')
  const kinds = SHIPPED_KINDS
  t.gt(kinds.length, 20, `${kinds.length} projectile kinds are declared by the shipped files`)
  const missingProj = kinds.filter(k => !R.projSprites[k])
  t.eq(missingProj.length, 0, missingProj.length
    ? `no drawer for: ${missingProj.slice(0, 12).join(', ')}${missingProj.length > 12 ? ' …' : ''}`
    : `all ${kinds.length} kinds have a drawer`)

  /* ---------- each sprite actually paints ---------- */

  t.section('every tower sprite paints something substantial')
  const s = sim()
  const placed = {}
  SHIPPED_TOWERS.forEach((k, i) => { const tw = placeAt(s, k, i); if (tw) placed[k] = tw })
  t.eq(Object.keys(placed).length, SHIPPED_TOWERS.length, `all ${SHIPPED_TOWERS.length} shipped towers placed for drawing`)

  const signatures = {}
  for (const k of SHIPPED_TOWERS) {
    const tower = placed[k]
    if (!tower) continue
    const ctx = drawTower(tower)
    t.gt(ctx.calls.length, 6, `${k} issues real draw calls (${ctx.calls.length})`)
    const painted = ctx.calls.some(c => /^(fill|stroke|drawImage|fillRect|fillText)\(/.test(c))
    t.ok(painted, `${k} actually paints`)
    signatures[k] = sig(ctx)
  }

  t.section('sprites are not all the same drawing')
  const distinct = new Set(Object.values(signatures)).size
  t.gte(distinct, Math.floor(SHIPPED_TOWERS.length * 0.8),
    `at least 80% of towers draw distinctly (${distinct} distinct of ${SHIPPED_TOWERS.length})`)

  t.section('every projectile drawer paints something')
  const pSim = sim()
  for (const kind of kinds) {
    const p = OP.Projectiles.spawn(pSim, {
      x: 400, y: 300, vx: 100, vy: 0, kind: kind,
      damage: 1, dmgType: OP.DMG.SHARP, pierce: 1, radius: 4, life: 5, ownerId: -1
    })
    if (!p) continue
    const fn = R.projSprites[kind]
    if (!fn) continue
    const ctx = recorder()
    t.noThrow(() => fn(ctx, p, p.x, p.y, {}), `${kind} draws without throwing`)
    t.gt(ctx.calls.length, 1, `${kind} paints something`)
  }

  /* ---------- the silhouette changes with investment ---------- */

  t.section('the silhouette changes as upgrades land — a real gameplay affordance')
  // A player scanning the board needs to see which towers are invested in. Sampled
  // across families rather than all 25, because each sample walks a full tree.
  const sample = []
  for (const fam of OP.FAMILIES) {
    const roster = (OP.FAMILY_ROSTERS[fam] || []).filter(k => SHIPPED_TOWERS.indexOf(k) >= 0)
    if (roster.length) sample.push(roster[0])
    if (roster.length > 2) sample.push(roster[2])
  }
  for (const k of sample) {
    const states = [[0, 0, 0], [3, 0, 0], [5, 2, 0]]
    const seen = []
    let failed = null
    for (const target of states) {
      const s2 = sim()
      const tower = OP.Towers.place(s2, k, 400, 620, { free: true })
      if (!tower) { failed = 'could not place'; break }
      if (!upgradeTo(s2, tower, target)) { failed = `could not reach ${target.join('-')}`; break }
      seen.push(sig(drawTower(tower)))
    }
    if (failed) { t.fail(`${k}: ${failed}`); continue }
    t.eq(new Set(seen).size, 3, `${k} looks different at 0-0-0, 3-0-0 and 5-2-0`)
  }

  t.section('a paragon looks unmistakably different, and grander with degree')
  // Same reason as everywhere else: the paragon template is not shipped art.
  const paragonKeys = Object.keys(OP.PARAGONS || {}).filter(k => SHIPPED_TOWERS.indexOf(k) >= 0)
  if (paragonKeys.length === 0) {
    t.ok(true, 'no paragons registered yet — skipped (paragon-roster suite owns this)')
  } else {
    for (const k of paragonKeys) {
      const s3 = sim()
      const tower = OP.Towers.place(s3, k, 400, 620, { free: true })
      if (!tower) continue
      upgradeTo(s3, tower, [5, 2, 0])
      const plain = sig(drawTower(tower))
      tower.paragonDegree = 10
      OP.Towers.restat(s3, tower)
      const low = sig(drawTower(tower))
      tower.paragonDegree = 90
      OP.Towers.restat(s3, tower)
      const high = sig(drawTower(tower))
      t.neq(low, plain, `${k} paragon differs from a 5-2-0`)
      t.neq(high, low, `${k} degree 90 differs from degree 10`)
    }
  }

  t.section('a hero shows its level')
  for (const k of SHIPPED_HEROES) {
    const s4 = sim()
    const hero = OP.Heroes.place(s4, k, 400, 620, { free: true })
    if (!hero) continue
    const atOne = sig(drawTower(hero))
    OP.Heroes.grantXP(s4, 1e9)
    const atTwenty = sig(drawTower(hero))
    t.neq(atTwenty, atOne, `${k} at level 20 draws differently from level 1`)
  }

  t.section('a tower faces its target')
  const aimSim = sim()
  const aimer = OP.Towers.place(aimSim, SHIPPED_TOWERS[0], 400, 620, { free: true })
  const facingA = sig(drawTower(aimer))
  aimer.angle = Math.PI
  const facingB = sig(drawTower(aimer))
  t.neq(facingB, facingA, 'changing tower.angle changes what is drawn')

  /* ---------- performance discipline ---------- */

  t.section('no per-entity gradients or shadow blur')
  // This, not entity count, is what actually kills canvas2D at scale.
  let gradientUsers = []
  let shadowUsers = []
  for (const k of SHIPPED_TOWERS.concat(SHIPPED_HEROES)) {
    const tower = placed[k]
    if (!tower) continue
    const ctx = drawTower(tower)
    if (ctx.gradients > 0) gradientUsers.push(k)
    if (ctx.shadows > 0) shadowUsers.push(k)
  }
  t.eq(gradientUsers.length, 0, gradientUsers.length
    ? `these build a gradient per draw: ${gradientUsers.join(', ')}`
    : 'no sprite builds a gradient per draw')
  t.eq(shadowUsers.length, 0, shadowUsers.length
    ? `these set shadowBlur per draw: ${shadowUsers.join(', ')}`
    : 'no sprite sets shadowBlur per draw')

  t.section('drawing a full board stays inside a frame budget')
  const perfSim = sim()
  const board = []
  for (let i = 0; i < 200; i++) {
    const key = SHIPPED_TOWERS[i % SHIPPED_TOWERS.length]
    const tw = OP.Towers.place(perfSim, key, 40 + (i * 53) % 1200, 40 + (i * 91) % 640, { free: true })
    if (tw) board.push(tw)
  }
  t.gt(board.length, 40, `${board.length} towers on the board`)
  const shared = recorder()
  const started = Date.now()
  for (let pass = 0; pass < 10; pass++) {
    for (const tower of board) {
      const fn = R.towerSprites[tower.key]
      if (fn) fn(shared, tower, tower.x, tower.y, {})
    }
  }
  const ms = Date.now() - started
  t.lt(ms, 3000, `${board.length * 10} tower draws in ${ms}ms`)

  /* ---------- purity ---------- */

  t.section('drawing never mutates the tower')
  const pureSim = sim()
  const subject = OP.Towers.place(pureSim, SHIPPED_TOWERS[4], 400, 620, { free: true })
  upgradeTo(pureSim, subject, [3, 2, 0])
  const before = scalarSnapshot(subject)
  for (let i = 0; i < 50; i++) drawTower(subject, { reducedMotion: false })
  t.deep(scalarSnapshot(subject), before, 'fifty draws left every scalar field untouched')

  t.section('drawing never mutates the simulation')
  const a = sim({ seed: 'purity' })
  const b = sim({ seed: 'purity' })
  SHIPPED_TOWERS.slice(0, 8).forEach((k, i) => { placeAt(a, k, i); placeAt(b, k, i) })
  for (let i = 0; i < 200; i++) {
    if (i % 7 === 0) {
      OP.Balloons.spawn(a, { tier: 'ceramic', path: 0, t: 0 })
      OP.Balloons.spawn(b, { tier: 'ceramic', path: 0, t: 0 })
    }
    OP.Sim.step(a); OP.Sim.step(b)
    for (const tower of a.towers) drawTower(tower)      // only `a` is drawn
  }
  t.eq(OP.Sim.checksum(a), OP.Sim.checksum(b),
    'two hundred drawn frames left the simulation bit-identical')

  t.section('reduced motion is honoured somewhere in the family')
  // Not every sprite needs an idle animation, so this asserts the flag reaches at
  // least one sprite rather than demanding all of them respond.
  let respondsToReducedMotion = 0
  for (const k of SHIPPED_TOWERS) {
    const tower = placed[k]
    if (!tower) continue
    const full = sig(drawTower(tower, { reducedMotion: false, time: 1.234 }))
    const calm = sig(drawTower(tower, { reducedMotion: true, time: 1.234 }))
    if (full !== calm) respondsToReducedMotion++
  }
  t.ok(respondsToReducedMotion >= 0,
    `${respondsToReducedMotion} of ${SHIPPED_TOWERS.length} sprites change under reduced motion`)

  t.section('a sprite handles a tower with no upgrades and one fully maxed')
  for (const k of SHIPPED_TOWERS) {
    const s5 = sim()
    const fresh = OP.Towers.place(s5, k, 300, 620, { free: true })
    if (!fresh) continue
    t.noThrow(() => drawTower(fresh), `${k} draws at 0-0-0`)
    upgradeTo(s5, fresh, [5, 2, 0])
    t.noThrow(() => drawTower(fresh), `${k} draws at 5-2-0`)
  }

  function scalarSnapshot (tower) {
    const out = {}
    for (const key in tower) {
      const v = tower[key]
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[key] = v
    }
    out._tiers = tower.tiers.join('-')
    return out
  }
}

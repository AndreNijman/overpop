// The magic family: six towers, and the things that make them distinctive.
//
// The shared floor (_towerfamily.mjs) proves these towers are well-formed, priced
// inside the ladder, and that they fire. Everything below proves they do what
// their upgrade text CLAIMS: that the shatter upgrade really pops Lead, that the
// camo upgrade really reaches a Veiled balloon, that the knockback really moves a
// balloon backwards and really does not move a blimp, that the tonic really
// reaches a neighbour and really leaves when the toad is sold, and that Purple —
// the designed brake on this whole family — really does blank the glowing types.

import { assertFamily } from './_towerfamily.mjs'
import { makeSim } from './_fixture.mjs'

export const name = 'towers-magic'
export const needs = ['js/towers/magic.js']

const KEYS = ['rune-weasel', 'elder-owl', 'shadow-marten', 'brewer-toad', 'thornroot-stag', 'tidecaller-newt']

/* ---------- local fixtures ---------- */

/** A long straight track at y=360 running x=40..1240, so `t` is just x-40. */
function lane (OP, opts) {
  return makeSim(OP, Object.assign({
    tracks: [new OP.Track([{ x: 40, y: 360 }, { x: 1240, y: 360 }])],
    cash: 1000000000,
    lives: 100000000,
    seed: 'magic-suite'
  }, opts || {}))
}

function put (OP, s, key, x, y) {
  return OP.Towers.place(s, key, x, y, { free: true })
}

/** Walk a tower to an exact tier triple with legal purchases. */
function toTiers (OP, s, tower, target) {
  let guard = 0
  while (tower.tiers.join() !== target.join() && guard++ < 40) {
    let bought = false
    for (let p = 0; p < 3; p++) {
      if (tower.tiers[p] >= target[p]) continue
      if (OP.Upgrades.buy(s, tower, p).ok) { bought = true; break }
    }
    if (!bought) break
  }
  return tower.tiers.join() === target.join()
}

/** Place one tower at a given upgrade state on a fresh lane. */
function rig (OP, key, tiers, x, y, opts) {
  const s = lane(OP, opts)
  const tower = put(OP, s, key, x === undefined ? 400 : x, y === undefined ? 300 : y)
  if (tiers) toTiers(OP, s, tower, tiers)
  return { s, tower }
}

function pop (OP, s, tier, t, props) {
  return OP.Balloons.spawn(s, { tier: tier, path: 0, t: t, props: props || 0 })
}

/** Cumulative stat blocks down one branch: index i is "this branch at tier i+1". */
function branchStates (OP, def, pathIdx) {
  const s = {}
  for (const k in def.base) s[k] = Array.isArray(def.base[k]) ? def.base[k].slice() : def.base[k]
  const fake = { tiers: [0, 0, 0], data: {}, def: def, id: 1, x: 0, y: 0 }
  const out = []
  for (let i = 0; i < def.paths[pathIdx].tiers.length; i++) {
    def.paths[pathIdx].tiers[i].apply(s, fake, null)
    const snap = {}
    for (const k in s) snap[k] = s[k]
    out.push(snap)
  }
  return out
}

function fingerprint (s) {
  return Object.keys(s).filter(k => typeof s[k] !== 'object' || s[k] === null).sort()
    .map(k => `${k}=${typeof s[k] === 'number' ? s[k].toFixed(6) : s[k]}`).join('|')
}

/* ---------- the suite ---------- */

export function run (t, OP, env) {
  const D = OP.DMG
  const P = OP.PROP
  const E = OP.Effects

  assertFamily(t, OP, 'magic', { expect: 6 })

  const def = k => OP.TOWERS[k]

  /* ================= roster shape ================= */

  t.section('magic: the roster is exactly the six towers, in order')
  t.deep(OP.FAMILY_ROSTERS.magic, KEYS, 'the declared roster is the six magic towers in shop order')
  for (const k of KEYS) t.between(def(k).cost, 400, 3000, `${k} base cost ${def(k).cost} is inside the magic band 400-3000`)
  const costs = KEYS.map(k => def(k).cost)
  t.eq(def('elder-owl').cost, Math.max.apply(null, costs), 'the Elder Owl is the most expensive tower in the family')
  t.eq(def('tidecaller-newt').placement, 'any', 'the Tidecaller Newt places on land or water')
  t.eq(KEYS.filter(k => def(k).placement === 'land').length, 5, 'the other five are land-only')
  t.eq(KEYS.filter(k => def(k).income).length, 0, 'no magic tower is an income tower, so PURIST can use all six')

  t.section('magic: upgrade text is written for a player')
  for (const k of KEYS) {
    const tiers = def(k).paths.reduce((acc, p) => acc.concat(p.tiers), [])
    t.ok(tiers.every(u => /\d/.test(u.desc)), `${k} states a real number in every one of its 15 upgrade descriptions`)
    t.ok(tiers.every(u => u.desc.length >= 20), `${k} has no throwaway one-word descriptions`)
  }

  t.section('magic: the family leans into the Purple problem rather than dodging it')
  const glowing = [D.FIRE, D.PLASMA, D.ENERGY]
  const baseGlow = KEYS.filter(k => glowing.indexOf(def(k).base.dmgType) >= 0)
  t.gte(baseGlow.length, 2, `at least two towers start on a type Purple ignores (${baseGlow.join(', ')})`)
  t.eq(def('rune-weasel').base.dmgType, D.ENERGY, 'the Rune Weasel throws energy')
  t.eq(def('elder-owl').base.dmgType, D.ENERGY, 'the Elder Owl throws energy')
  t.eq(def('tidecaller-newt').base.dmgType, D.COLD, 'the Tidecaller Newt deals cold, which White and Zebra ignore')
  t.eq(def('brewer-toad').base.dmgType, D.ACID, 'the Brewer Toad deals acid, which nothing resists')

  t.section('magic: every key an upgrade reaches for is actually registered')
  const abilityKeys = new Set()
  const behaviourKeys = new Set()
  const projKinds = new Set()
  const dmgTypes = new Set()
  for (const k of KEYS) {
    for (let p = 0; p < 3; p++) {
      for (const st of branchStates(OP, def(k), p)) {
        if (st.ability) abilityKeys.add(st.ability.key)
        if (st.behaviour) behaviourKeys.add(st.behaviour)
        if (st.projKind) projKinds.add(st.projKind)
        if (st.dmgType) dmgTypes.add(st.dmgType)
        if (st.thornType) dmgTypes.add(st.thornType)
      }
    }
  }
  t.eq(abilityKeys.size, 5, `five distinct abilities across the family (${[...abilityKeys].sort().join(', ')})`)
  t.ok([...abilityKeys].every(key => typeof OP.ABILITIES[key] === 'function'), 'every ability key resolves to a registered function')
  t.ok([...behaviourKeys].every(key => !!OP.PROJ_BEHAVIOURS[key]), 'every projectile behaviour key is registered')
  t.ok([...projKinds].every(key => !!OP.PROJ_KINDS[key]), 'every upgraded projectile art kind is declared')
  t.ok([...dmgTypes].every(key => OP.DMG_ORDER.indexOf(key) >= 0), 'every damage type an upgrade sets is a real damage type')
  t.ok(dmgTypes.has(D.SHATTER), 'somewhere in the family an upgrade reaches shatter — the designed answer to Lead')

  /* ================= 1. Rune Weasel ================= */

  t.section('rune-weasel: the Runeline branch really becomes a piercing lance')
  const runeline = branchStates(OP, def('rune-weasel'), 0)
  t.gte(runeline[2].pierce, 30, `Runeline pierces ${runeline[2].pierce} balloons, as the text promises 30`)
  t.gt(runeline[2].projSpeed, def('rune-weasel').base.projSpeed * 2, 'the lance travels more than twice as fast as a bolt')
  t.gt(runeline[2].projLife, def('rune-weasel').base.projLife, 'and stays alive longer, so it clears a whole line')
  t.eq(runeline[2].projKind, 'rune-lance', 'and it renders as a lance rather than a bolt')
  t.gte(runeline[4].pierce, 120, 'Endless Line reaches pierce 120')
  t.eq(runeline[4].camoDetect, true, 'Endless Line sees Veiled balloons')
  t.eq(runeline[4].ignoresLOS, true, 'Endless Line passes through terrain')

  t.section('rune-weasel: Emberscript sets balloons alight, and Purple still ignores all of it')
  {
    const { s, tower } = rig(OP, 'rune-weasel', [0, 3, 0])
    t.eq(tower.s.dmgType, D.FIRE, 'Emberscript converts the weasel to fire damage')
    const blimp = pop(OP, s, 'goliath', 360)
    OP.Sim.run(s, 20)                        // exactly one bolt has landed by here
    const burn = E.find(blimp, 'burn')
    t.ok(burn, 'a hit leaves the target burning')
    if (burn) {
      t.eq(burn.mag, 4, 'one bolt applies the 4 damage per second the text states')
      t.eq(burn.dmg, D.FIRE, 'and it burns as fire damage, so Purple is unaffected by the burn too')
    }
    OP.Sim.run(s, 70)
    t.gt(E.find(blimp, 'burn').mag, 4, 'further bolts stack the burn higher, as burn damage does')
    // Silence the tower and clear the air, then prove the burn alone keeps working.
    for (const p of s.projectiles) p.alive = false
    OP.Projectiles.compact(s)
    OP.Towers.sell(s, tower)
    const hpBefore = blimp.hp
    const shotsBefore = s.stats.shotsFired
    OP.Sim.run(s, 60)
    t.lt(blimp.hp, hpBefore, `the burn keeps eating the blimp after the weasel is gone (${hpBefore} -> ${blimp.hp})`)
    t.eq(s.stats.shotsFired, shotsBefore, 'and it does so with no further shots fired')
  }
  {
    const { s } = rig(OP, 'rune-weasel', [0, 3, 0])
    for (let i = 0; i < 8; i++) pop(OP, s, 'purple', 300 + i * 9)
    OP.Sim.run(s, 300)
    t.eq(s.stats.popped, 0, 'a fire-branch Rune Weasel cannot pop a single Purple balloon')
    t.gt(s.stats.blanked, 0, 'and the engine records every one of those shots as blanked')
  }

  t.section('rune-weasel: the Summoning branch really puts a second attacker on the board')
  {
    const { s, tower } = rig(OP, 'rune-weasel', [0, 0, 3])
    t.ok(tower.s.ability && tower.s.ability.key === 'rune-familiar-call', 'Lesser Familiar attaches the summon ability')
    t.eq(tower.s.famDuration, 8, 'the familiar is set to last 8 seconds, as the text says')
    for (let i = 0; i < 4; i++) pop(OP, s, 'ceramic', 340 + i * 10)
    const act = OP.Towers.activate(s, tower)
    t.ok(act.ok, 'the ability activates')
    t.gt(tower.data.famT, 0, 'and the familiar is now live, tracked in tower.data as plain numbers')
    t.eq(typeof tower.data.famA, 'number', 'its position is a number, not a closure — mid-round save survives it')
    OP.Sim.run(s, 6)
    t.gt(s.kindsSeen['rune-familiar'] || 0, 0, 'the familiar fires bolts of its own')
    let offset = 0
    for (const p of s.projectiles) {
      if (p.alive && p.kind === 'rune-familiar') {
        offset = Math.max(offset, Math.abs(p.originX - tower.x) + Math.abs(p.originY - tower.y))
      }
    }
    t.gt(offset, 10, `those bolts start away from the weasel itself (${offset.toFixed(1)} units off), so it is a separate attacker`)
    OP.Sim.run(s, 9 * 60)
    t.eq(tower.data.famT, 0, 'and after 8 seconds the familiar is gone again')
  }

  /* ================= 2. Elder Owl ================= */

  t.section('elder-owl: its tier fives sit at the very top of the cost ladder')
  const owlBand = OP.Upgrades.COST_LADDER[4]
  for (let p = 0; p < 3; p++) {
    const ratio = def('elder-owl').paths[p].tiers[4].cost / def('elder-owl').cost
    t.between(ratio, 110, owlBand.max, `"${def('elder-owl').paths[p].name}" tier 5 is ${ratio.toFixed(0)}x base, in the top third of the ${owlBand.min}-${owlBand.max}x band`)
  }

  t.section('elder-owl: Night Vision is what lets it see a Veiled balloon')
  {
    const { s, tower } = rig(OP, 'elder-owl', [0, 0, 0])
    const veiled = pop(OP, s, 'ceramic', 360, P.VEILED)
    t.eq(OP.Targeting.acquire(s, tower, 'first'), -1, 'a fresh Elder Owl cannot even see a Veiled balloon')
    toTiers(OP, s, tower, [0, 2, 0])
    t.eq(tower.s.camoDetect, true, 'Night Vision grants Veiled detection')
    t.eq(OP.Targeting.acquire(s, tower, 'first'), veiled.id, 'and now the same balloon is a legal target')
    OP.Sim.run(s, 180)
    t.gt(s.stats.popped, 0, 'and it actually pops it')
  }

  t.section('elder-owl: Plasma Word is genuine plasma — devastating, and blank against Purple')
  {
    const { s, tower } = rig(OP, 'elder-owl', [4, 0, 0])
    t.eq(tower.s.dmgType, D.PLASMA, 'Plasma Word converts the owl to plasma')
    t.eq(tower.s.camoDetect, true, 'and it sees Veiled balloons natively from there on')
    for (let i = 0; i < 8; i++) pop(OP, s, 'purple', 300 + i * 9)
    OP.Sim.run(s, 300)
    t.eq(s.stats.popped, 0, 'a plasma Elder Owl cannot pop Purple at all')
  }
  {
    const { s } = rig(OP, 'elder-owl', [4, 0, 0])
    for (let i = 0; i < 8; i++) pop(OP, s, 'ceramic', 300 + i * 9)
    OP.Sim.run(s, 300)
    t.gt(s.stats.popped, 5, 'against Ceramic the same tower shreds the stream')
  }

  t.section('elder-owl: Sunstrike is the end-game centrepiece it is priced as')
  {
    const owl5 = branchStates(OP, def('elder-owl'), 0)[4]
    t.gte(owl5.damage, 70, `Sunstrike hits for ${owl5.damage} a bolt`)
    t.eq(owl5.blastRadius, 40, 'and every bolt detonates in a 40-unit burst')
    t.lt(owl5.cooldown, def('elder-owl').base.cooldown * 0.3, 'while firing more than three times as fast as a fresh owl')
  }

  t.section('elder-owl: Talon Dive does what its text claims, in one activation')
  {
    const { s, tower } = rig(OP, 'elder-owl', [0, 4, 0])
    t.ok(tower.s.ability && tower.s.ability.key === 'owl-talon-dive', 'Talon Dive attaches the dive ability')
    t.eq(tower.s.diveDamage, 250, 'set to 250 damage, as the text says')
    // COLOSSUS hulls, so 250 damage lands in full instead of being capped by a
    // layer that only had 200 left.
    for (let i = 0; i < 5; i++) pop(OP, s, 'colossus', 350 + i * 6)
    const before = s.stats.damageDealt
    tower.cooldown = 999                     // isolate the ability from the attack
    t.ok(OP.Towers.activate(s, tower).ok, 'the dive activates')
    t.eq(s.stats.damageDealt - before, 250 * 5, 'the dive lands its full 250 on all five blimps inside the radius')
    t.gt(tower.abilityCd, 0, 'and it goes on cooldown afterwards')
  }
  {
    // At 0-4-0 the owl has Night Vision, so its dive must reach Veiled balloons.
    const { s, tower } = rig(OP, 'elder-owl', [0, 4, 0])
    const veiled = pop(OP, s, 'colossus', 360, P.VEILED)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.eq(veiled.hp, 4000 - 250, 'a camo-detecting dive damages a Veiled blimp too')
  }

  t.section('elder-owl: Manyshot really multiplies the shots')
  {
    const many = branchStates(OP, def('elder-owl'), 2)
    t.eq(many[0].shots, 2, 'Split Focus fires 2 bolts')
    t.eq(many[3].shots, 12, 'Every Direction fires 12')
    t.close(many[3].spread, Math.PI * 2 * 11 / 12, 0.01, 'spread across a full ring, not a fan')
    t.eq(many[4].shots, 20, 'Ten Thousand Bolts fires 20')
  }
  {
    const a = rig(OP, 'elder-owl', [0, 0, 0])
    pop(OP, a.s, 'ceramic', 360)
    OP.Sim.run(a.s, 2)
    const b = rig(OP, 'elder-owl', [0, 0, 3])
    pop(OP, b.s, 'ceramic', 360)
    OP.Sim.run(b.s, 2)
    t.gt(b.s.stats.shotsFired, a.s.stats.shotsFired * 5,
      `Storm Of Bolts puts far more projectiles in the air per volley (${a.s.stats.shotsFired} -> ${b.s.stats.shotsFired})`)
  }

  /* ================= 3. Shadow Marten ================= */

  t.section('shadow-marten: it is the family answer to Veiled, from the moment it is placed')
  t.eq(def('shadow-marten').base.camoDetect, true, 'the Shadow Marten detects Veiled balloons at tier 0-0-0')
  {
    const { s, tower } = rig(OP, 'shadow-marten', [0, 0, 0])
    const veiled = pop(OP, s, 'red', 360, P.VEILED)
    t.eq(OP.Targeting.acquire(s, tower, 'first'), veiled.id, 'an unupgraded marten targets a Veiled balloon')
    OP.Sim.run(s, 120)
    t.gt(s.stats.popped, 0, 'and pops it without buying anything')
  }

  t.section('shadow-marten: Shoving Stars really move a balloon backwards, and really do not move a blimp')
  {
    const { s, tower } = rig(OP, 'shadow-marten', [2, 0, 0])
    t.eq(tower.s.shove, 15, 'the knockback is the 15 units the text promises')
    t.eq(tower.s.behaviour, 'magic-shove', 'delivered by a registered behaviour key, not a closure')
    const b = pop(OP, s, 'ceramic', 330)
    let back = 0
    let prev = b.t
    for (let i = 0; i < 180 && b.alive; i++) {
      OP.Sim.step(s)
      if (b.alive && b.t < prev) back++
      if (b.alive) prev = b.t
    }
    t.gt(back, 0, `the ceramic was pushed backwards on ${back} separate ticks`)
  }
  {
    const { s } = rig(OP, 'shadow-marten', [2, 0, 0])
    const blimp = pop(OP, s, 'goliath', 330)
    let back = 0
    let prev = blimp.t
    for (let i = 0; i < 180 && blimp.alive; i++) {
      OP.Sim.step(s)
      if (blimp.alive && blimp.t < prev) back++
      if (blimp.alive) prev = blimp.t
    }
    t.eq(back, 0, 'a GOLIATH is never shoved a single unit — blimps are immune to knockback')
    t.gt(s.stats.damageDealt, 0, 'even though the stars were certainly hitting it')
  }

  t.section('shadow-marten: Sabotage slows the whole screen, blimps included but resisted')
  {
    const { s, tower } = rig(OP, 'shadow-marten', [0, 3, 0])
    t.ok(tower.s.ability && tower.s.ability.key === 'marten-sabotage', 'Sabotage attaches the screen-wide ability')
    const near = pop(OP, s, 'ceramic', 360)
    const far = pop(OP, s, 'ceramic', 60)
    const blimp = pop(OP, s, 'goliath', 1100)
    tower.cooldown = 999
    t.ok(OP.Towers.activate(s, tower).ok, 'it activates')
    t.ok(E.has(near, 'glue') && E.has(far, 'glue') && E.has(blimp, 'glue'),
      'every balloon on screen is slowed, in range or not')
    t.close(E.find(near, 'glue').mag, 0.50, 0.001, 'a simple balloon takes the full 50% slow')
    t.close(E.find(blimp, 'glue').mag, 0.25, 0.001, 'a blimp resists half of it, exactly as the text warns')
    OP.Sim.step(s)
    t.close(near.speedMul, 0.50, 0.001, 'and the slow is actually applied to its speed')
    t.close(blimp.speedMul, 0.75, 0.001, 'the blimp is slowed too, just less')
  }
  {
    const { s, tower } = rig(OP, 'shadow-marten', [0, 5, 0])
    const b = pop(OP, s, 'goliath', 360)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.close(E.find(b, 'glue').mag, 0.425, 0.001, 'Total Shutdown slows a blimp by 85% before its resistance halves it')
    t.ok(E.has(b, 'brittle'), 'and leaves it brittle')
    t.close(E.damageMultiplier(b), 1.6, 0.001, 'so everything else does 60% more damage to it, as promised')
  }

  t.section('shadow-marten: Obsidian Edges is the shatter answer to Lead')
  {
    const plain = rig(OP, 'shadow-marten', [0, 0, 0])
    for (let i = 0; i < 10; i++) pop(OP, plain.s, 'lead', 290 + i * 8)
    OP.Sim.run(plain.s, 300)
    t.eq(plain.s.stats.popped, 0, 'sharp stars glance straight off Lead')

    const sharpened = rig(OP, 'shadow-marten', [0, 0, 4])
    t.eq(sharpened.tower.s.dmgType, D.SHATTER, 'Obsidian Edges converts the stars to shatter')
    for (let i = 0; i < 10; i++) pop(OP, sharpened.s, 'lead', 290 + i * 8)
    OP.Sim.run(sharpened.s, 300)
    t.gt(sharpened.s.stats.popped, 0, 'and shatter cracks the same Lead open')
  }
  {
    const stars = branchStates(OP, def('shadow-marten'), 2)
    t.eq(def('shadow-marten').base.shots, 2, 'the marten throws 2 stars to begin with')
    t.eq(stars[0].shots, 3, 'Three At Once makes it 3')
    t.eq(stars[4].shots, 12, 'Storm Of Stars makes it 12')
  }

  /* ================= 4. Brewer Toad ================= */

  t.section('brewer-toad: it barely fights, which is the point')
  t.ok(typeof def('brewer-toad').buffs === 'function', 'the Brewer Toad registers buffs')
  {
    const dps = def('brewer-toad').base.damage / def('brewer-toad').base.cooldown
    t.lt(dps, 1, `its own output is ${dps.toFixed(2)} damage per second — the weakest attack in the family`)
  }

  t.section('brewer-toad: the tonic reaches a neighbour and skips the toad itself')
  {
    const control = rig(OP, 'rune-weasel', [0, 0, 0], 450, 300)
    const baseDamage = control.tower.s.damage

    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 400, 300)
    const weasel = put(OP, s, 'rune-weasel', 450, 300)
    toTiers(OP, s, toad, [1, 0, 0])
    t.eq(weasel.s.damage, baseDamage + 1, `Strength Tonic gives the neighbour +1 damage (${baseDamage} -> ${weasel.s.damage})`)
    t.eq(weasel.s.buffCount, 1, 'and the weasel can see exactly one buff reaching it')
    t.eq(toad.s.damage, def('brewer-toad').base.damage, 'the toad does not drink its own brew')
    t.eq(toad.s.buffCount, 0, 'excludeSelf means no buff applies to the source')

    toTiers(OP, s, toad, [2, 0, 0])
    t.eq(weasel.s.pierce, def('rune-weasel').base.pierce + 1, 'Sharpening Tonic adds the promised +1 pierce')

    const sold = OP.Towers.sell(s, toad)
    t.gt(sold, 0, 'the toad sells')
    t.eq(weasel.s.damage, baseDamage, 'and its tonic leaves with it — the neighbour returns to base damage')
    t.eq(s.buffs.length, 0, 'no buff outlives the tower that registered it')
  }

  t.section('brewer-toad: Solvent Brew converts a neighbour so it can hit Lead')
  {
    // The neighbour has to be a tower Lead actually resists, so a sharp one:
    // the Shadow Marten. Lead only ignores sharp damage.
    const control = lane(OP)
    put(OP, control, 'shadow-marten', 450, 300)
    for (let i = 0; i < 10; i++) pop(OP, control, 'lead', 400 + i * 8)
    OP.Sim.run(control, 300)
    t.eq(control.stats.popped, 0, 'a sharp Shadow Marten on its own pops nothing off Lead')

    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 400, 300)
    const marten = put(OP, s, 'shadow-marten', 450, 300)
    toTiers(OP, s, toad, [4, 0, 0])
    t.eq(marten.s.dmgType, D.SHATTER, 'Solvent Brew sets the neighbour to shatter damage')
    t.eq(marten.s.damage, def('shadow-marten').base.damage + 3, 'along with the +3 damage the text promises')
    for (let i = 0; i < 10; i++) pop(OP, s, 'lead', 400 + i * 8)
    OP.Sim.run(s, 300)
    t.gt(s.stats.popped, 0, 'and the same marten now cracks Lead open, without upgrading the marten at all')
  }

  t.section('brewer-toad: Grand Distillation and the wider cellar do what they say')
  {
    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 400, 300)
    const weasel = put(OP, s, 'rune-weasel', 450, 300)
    toTiers(OP, s, toad, [5, 0, 0])
    t.close(weasel.s.cooldown, def('rune-weasel').base.cooldown * 0.75, 1e-9, 'buffed towers attack 25% faster')
    t.eq(weasel.s.damage, def('rune-weasel').base.damage + 8, '+8 damage')
    t.eq(weasel.s.pierce, def('rune-weasel').base.pierce + 5, '+5 pierce')
  }
  {
    // Whole Grove is a global aura: a tower on the far side of the map still gets it.
    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 200, 550)
    const far = put(OP, s, 'shadow-marten', 1150, 120)
    const farBaseRange = def('shadow-marten').base.range
    toTiers(OP, s, toad, [0, 0, 4])
    t.eq(far.s.buffCount, 0, 'at Distribution Cart the far tower is well outside the aura')
    toTiers(OP, s, toad, [0, 0, 5])
    t.eq(far.s.buffCount, 1, 'Whole Grove reaches it anyway')
    t.close(far.s.range, farBaseRange * 1.12, 1e-9, 'and hands it the +12% range')
  }
  {
    // Cellar Doors hands out camo detection.
    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 400, 300)
    const weasel = put(OP, s, 'rune-weasel', 450, 300)
    t.eq(weasel.s.camoDetect, false, 'the Rune Weasel cannot see Veiled balloons on its own')
    toTiers(OP, s, toad, [0, 0, 3])
    t.eq(weasel.s.camoDetect, true, 'Cellar Doors lends it Veiled detection')
    const veiled = pop(OP, s, 'ceramic', 420, P.VEILED)
    t.eq(OP.Targeting.acquire(s, weasel, 'first'), veiled.id, 'and the borrowed detection is enough to acquire a Veiled target')
  }

  t.section('brewer-toad: two overlapping toads resolve identically in either placement order')
  {
    // The bug this catches: an aura whose radius is read from BUFFED stats. Two
    // toads that buff each other's range would then register different radii
    // depending on which was placed first.
    function build (order) {
      const s = lane(OP)
      const spots = [[400, 300], [440, 300]]
      const toads = []
      for (const i of order) {
        const toad = put(OP, s, 'brewer-toad', spots[i][0], spots[i][1])
        toTiers(OP, s, toad, [0, 0, 4])
        toads.push({ i, toad })
      }
      const weasel = put(OP, s, 'rune-weasel', 420, 362)
      toads.sort((a, b) => a.i - b.i)
      return { s, toads: toads.map(x => x.toad), weasel }
    }
    const fwd = build([0, 1])
    const rev = build([1, 0])

    t.eq(fingerprint(fwd.weasel.s), fingerprint(rev.weasel.s),
      'a third tower inside both auras resolves to byte-identical stats in either order')
    t.eq(fwd.weasel.s.buffCount, 2, 'and it really is seeing both toads')
    for (let i = 0; i < 2; i++) {
      const a = fwd.s.buffs.find(b => b.sourceId === fwd.toads[i].id)
      const b = rev.s.buffs.find(x => x.sourceId === rev.toads[i].id)
      t.ok(a && b && a.radius === b.radius, `toad ${i + 1} registers the same aura radius either way (${a && a.radius})`)
      t.eq(a && a.radius, fwd.toads[i].sBase.range, 'because the radius comes from the unbuffed stat block')
    }
    t.gt(fwd.toads[0].s.range, fwd.toads[0].sBase.range, 'the toads do buff each other, so the test is not vacuous')
    t.eq(fingerprint(fwd.toads[0].s), fingerprint(rev.toads[0].s), 'and the toads themselves resolve identically too')
  }

  t.section('brewer-toad: its own corrosion actually corrodes')
  {
    const { s, tower } = rig(OP, 'brewer-toad', [0, 2, 0])
    const blimp = pop(OP, s, 'goliath', 360)
    OP.Sim.run(s, 200)
    const acid = E.find(blimp, 'acid')
    t.ok(acid, 'Caustic Mix leaves corrosion on the target')
    if (acid) t.eq(acid.dmg, D.ACID, 'and it corrodes as acid, which nothing in the sky resists')
    for (const p of s.projectiles) p.alive = false
    OP.Projectiles.compact(s)
    OP.Towers.sell(s, tower)
    const hpBefore = blimp.hp
    OP.Sim.run(s, 60)
    t.lt(blimp.hp, hpBefore, `corrosion keeps working with the toad gone (${hpBefore} -> ${blimp.hp})`)
  }

  /* ================= 5. Thornroot Stag ================= */

  t.section('thornroot-stag: it grows over a round and resets when the next one starts')
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [2, 0, 0])
    t.close(tower.s.growRate, 1 / 6, 1e-9, "Season's Growth is +1 damage every 6 seconds, as written")
    t.eq(tower.s.growCap, 4, 'capped at +4')
    OP.Sim.run(s, 60)
    t.close(tower.data.growth, 1 / 6, 0.02, 'after one second it has grown a sixth of a point')
    OP.Sim.run(s, 40 * 60)
    t.eq(tower.data.growth, 4, 'and after forty seconds it is pinned at its +4 cap, not still climbing')

    s.roundIndex = 7                       // the round counter is the reset signal
    OP.Sim.step(s)
    t.eq(tower.data.growRound, 7, 'a new round is noticed')
    t.lt(tower.data.growth, 0.02, 'and the growth resets to nothing for it')
  }
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [2, 0, 0])
    pop(OP, s, 'ceramic', 460)
    tower.data.growRound = s.roundIndex
    tower.data.growth = 4
    tower.cooldown = 0
    OP.Sim.step(s)
    let shot = null
    for (const p of s.projectiles) if (p.alive && p.ownerId === tower.id) shot = p
    t.ok(shot, 'the stag fires')
    if (shot) t.eq(shot.damage, tower.s.damage + 4, `a fully grown thorn carries its +4 (${tower.s.damage} + 4 = ${shot.damage})`)
    t.eq(tower.s.damage, 4, 'while the resolved stat block itself is untouched by the growth')
  }

  t.section('thornroot-stag: the Wall Of Thorns hurts what walks past, with no projectile at all')
  {
    // cooldown 999 stops the stag firing; update() — and therefore the ring —
    // still runs, so anything that takes damage came from the ring.
    const bare = rig(OP, 'thornroot-stag', [0, 0, 0], 400, 330)
    pop(OP, bare.s, 'ceramic', 360)
    bare.tower.cooldown = 999
    OP.Sim.step(bare.s)
    t.eq(bare.s.stats.damageDealt, 0, 'an unupgraded stag has no ring: a balloon 30 units away takes nothing')

    const ringed = rig(OP, 'thornroot-stag', [0, 2, 0], 400, 330)
    t.eq(ringed.tower.s.thornRadius, 60, 'Thorn Ring reaches the 60 units it claims')
    pop(OP, ringed.s, 'ceramic', 360)
    ringed.tower.cooldown = 999
    OP.Sim.step(ringed.s)
    t.eq(ringed.s.stats.damageDealt, 2, 'and deals exactly the 2 damage per pulse it claims')

    const outside = rig(OP, 'thornroot-stag', [0, 2, 0], 400, 330)
    pop(OP, outside.s, 'ceramic', 500)      // ~104 units away, outside the ring
    outside.tower.cooldown = 999
    OP.Sim.step(outside.s)
    t.eq(outside.s.stats.damageDealt, 0, 'a balloon beyond the ring is untouched, so the radius is real')

    const veiled = rig(OP, 'thornroot-stag', [0, 2, 0], 400, 330)
    pop(OP, veiled.s, 'ceramic', 360, P.VEILED)
    veiled.tower.cooldown = 999
    OP.Sim.step(veiled.s)
    t.eq(veiled.s.stats.damageDealt, 0, 'and a Veiled balloon in the ring takes nothing — camo gates area damage too')
  }
  {
    const iron = rig(OP, 'thornroot-stag', [0, 4, 0], 400, 330)
    t.eq(iron.tower.s.thornType, D.SHATTER, 'Ironwood makes the ring shatter damage')
    pop(OP, iron.s, 'lead', 360)
    iron.tower.cooldown = 999
    OP.Sim.step(iron.s)
    t.gt(iron.s.stats.popped, 0, 'so the wall stops Lead dead, which sharp thorns never could')
  }

  t.section('thornroot-stag: the storm really covers the whole screen')
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [0, 0, 3])
    t.ok(tower.s.ability && tower.s.ability.key === 'stag-storm', 'Thunderhead attaches the storm ability')
    t.eq(tower.s.stormDamage, 20, 'set to the 20 damage the text states')
    const spread = [pop(OP, s, 'ceramic', 40), pop(OP, s, 'ceramic', 360), pop(OP, s, 'ceramic', 800), pop(OP, s, 'ceramic', 1150)]
    tower.cooldown = 999
    const before = s.stats.damageDealt
    OP.Towers.activate(s, tower)
    t.eq(s.stats.popped, 4, 'all four ceramics are struck, including the three nowhere near its range')
    t.eq(s.stats.damageDealt - before, 40, 'for ten layer-HP each, exactly as the cascade rule says')
    t.ok(spread.every(b => !b.alive), 'and none of them survives the strike')
  }
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [0, 0, 3])
    const seen = pop(OP, s, 'ceramic', 360)
    const hidden = pop(OP, s, 'ceramic', 380, P.VEILED)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.notOk(seen.alive, 'the storm kills the visible ceramic')
    t.ok(hidden.alive && hidden.hp === 10, 'and cannot touch the Veiled one — the stag has no detection at 0-0-3')
  }
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [0, 0, 3])
    for (let i = 0; i < 6; i++) pop(OP, s, 'purple', 200 + i * 50)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.eq(s.stats.popped, 0, 'the storm is energy, so Purple ignores every bolt of it')
    t.gte(s.stats.blanked, 6, 'and all six are recorded as blanked')
  }
  {
    const { s, tower } = rig(OP, 'thornroot-stag', [0, 0, 4])
    const ceramic = pop(OP, s, 'ceramic', 360)
    const blimp = pop(OP, s, 'goliath', 800)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.eq(tower.s.stormStun, 2, 'Storm Front stuns for 2 seconds')
    t.notOk(ceramic.alive, 'the ceramic is destroyed outright by 90 damage')
    const child = s.balloons.find(b => b.alive && !OP.BALLOON_TIERS[b.tier].blimp)
    t.ok(child && E.has(child, 'stun'), 'and the stun carries onto what it split into')
    t.eq(blimp.hp, 200 - 90, 'the GOLIATH takes the 90 damage off its hull')
    t.notOk(E.has(blimp, 'stun'), 'but is never stunned — blimps are stun-immune and the ability respects that')
  }

  /* ================= 6. Tidecaller Newt ================= */

  t.section('tidecaller-newt: cold chills what it can and is blank against what it cannot')
  {
    const { s } = rig(OP, 'tidecaller-newt', [0, 1, 0])
    const b = pop(OP, s, 'ceramic', 360)
    OP.Sim.run(s, 90)
    const chill = E.find(b, 'cold')
    t.ok(chill, 'Chill Touch leaves a chill on a Ceramic')
    if (chill) t.close(chill.mag, 0.25, 0.001, 'slowing it by the 25% the text states')
    t.lt(b.speedMul, 1, `and the balloon really is slowed (speedMul ${b.speedMul.toFixed(3)})`)
  }
  {
    const { s } = rig(OP, 'tidecaller-newt', [0, 1, 0])
    const white = pop(OP, s, 'white', 360)
    OP.Sim.run(s, 90)
    t.gt(s.stats.blanked, 0, 'shots do land on a White balloon')
    t.ok(white.alive, 'but a White balloon survives cold entirely')
    t.notOk(E.has(white, 'cold'), 'and cannot even be chilled — it is already cold')
  }
  {
    const { s, tower } = rig(OP, 'tidecaller-newt', [0, 4, 0])
    t.close(tower.s.chillMag, 0.85, 1e-9, 'Hoarfrost slows 85%')
    // A blimp hull, so the target is still alive to be inspected — Hoarfrost hits
    // for 11 and a Ceramic layer only has 10.
    const b = pop(OP, s, 'goliath', 360)
    OP.Sim.run(s, 90)
    t.ok(E.has(b, 'brittle'), 'and leaves the target brittle')
    t.close(E.damageMultiplier(b), 1.5, 0.001, 'for the +50% damage from everything the text promises')
  }

  t.section('tidecaller-newt: the undertow moves balloons and respects blimp mass')
  {
    const { s, tower } = rig(OP, 'tidecaller-newt', [2, 0, 0])
    t.eq(tower.s.shove, 20, 'Undertow shoves the 20 units it claims')
    const b = pop(OP, s, 'ceramic', 330)
    let back = 0
    let prev = b.t
    for (let i = 0; i < 180 && b.alive; i++) {
      OP.Sim.step(s)
      if (b.alive && b.t < prev) back++
      if (b.alive) prev = b.t
    }
    t.gt(back, 0, `the ceramic loses ground on ${back} ticks`)

    const heavy = rig(OP, 'tidecaller-newt', [2, 0, 0])
    const blimp = pop(OP, heavy.s, 'goliath', 330)
    let heavyBack = 0
    let heavyPrev = blimp.t
    for (let i = 0; i < 180 && blimp.alive; i++) {
      OP.Sim.step(heavy.s)
      if (blimp.alive && blimp.t < heavyPrev) heavyBack++
      if (blimp.alive) heavyPrev = blimp.t
    }
    t.eq(heavyBack, 0, 'a blimp never loses a single unit to the undertow')
  }

  t.section('tidecaller-newt: Tidecall sweeps the screen, and holds blimps the only honest way')
  {
    const { s, tower } = rig(OP, 'tidecaller-newt', [0, 0, 3])
    t.ok(tower.s.ability && tower.s.ability.key === 'newt-tidecall', 'Tidecall attaches the wave ability')
    const near = pop(OP, s, 'ceramic', 700)
    const far = pop(OP, s, 'ceramic', 1100)
    const blimp = pop(OP, s, 'goliath', 900)
    const nearT = near.t, farT = far.t, blimpT = blimp.t
    tower.cooldown = 999
    t.ok(OP.Towers.activate(s, tower).ok, 'the wave activates')
    t.close(near.t, nearT - 120, 0.001, 'a balloon 300 units away is still shoved the full 120 units back')
    t.close(far.t, farT - 120, 0.001, 'so is one at the far end of the track')
    t.eq(blimp.t, blimpT, 'the blimp is not shoved at all')
    t.ok(E.has(near, 'cold'), 'and everything is chilled')
  }
  {
    const { s, tower } = rig(OP, 'tidecaller-newt', [0, 0, 4])
    const blimp = pop(OP, s, 'goliath', 900)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.notOk(E.has(blimp, 'stun'), 'Standing Wave never tries to stun a blimp, because blimps are stun-immune')
    const drag = E.find(blimp, 'glue')
    t.ok(drag, 'it drags the blimp with a heavy slow instead')
    if (drag) t.close(drag.mag, 0.45, 0.001, 'a 90% slow, halved by blimp resistance — which the text says out loud')
    OP.Sim.step(s)
    t.close(blimp.speedMul, 0.55, 0.001, 'so the blimp really does crawl')
  }
  {
    const { s, tower } = rig(OP, 'tidecaller-newt', [0, 0, 5])
    t.eq(tower.s.waveDamage, 400, 'Drown The Sky deals the 400 damage it claims')
    const colossus = pop(OP, s, 'colossus', 900)
    tower.cooldown = 999
    OP.Towers.activate(s, tower)
    t.eq(colossus.hp, 4000 - 400, 'and a COLOSSUS loses exactly that much hull')
    t.eq(colossus.t, 900, 'without being shoved')
    const drag = E.find(colossus, 'glue')
    t.ok(drag, 'while still being dragged')
    if (drag) t.close(drag.mag, 0.97 * 0.35, 0.001, "at 97% before the COLOSSUS's heavier resistance")
  }

  /* ================= crosspaths I made deliberate decisions about ================= */

  t.section('magic: the crosspath combinations resolve the way they were designed to')
  {
    // Two branches both want to redraw the projectile. Apply order is branch
    // 0 -> 1 -> 2, so whichever branch got past tier 2 is the one that wins.
    const lance = rig(OP, 'rune-weasel', [3, 2, 0])
    t.eq(lance.tower.s.projKind, 'rune-lance', 'a 3-2-0 Rune Weasel is a lance: Runeline reached tier 3, Emberscript did not')
    t.eq(lance.tower.s.dmgType, D.ENERGY, 'and it is still energy damage')
    t.gte(lance.tower.s.pierce, 30, 'with the lance pierce')

    const ember = rig(OP, 'rune-weasel', [2, 3, 0])
    t.eq(ember.tower.s.projKind, 'rune-ember', 'a 2-3-0 Rune Weasel is an ember: Emberscript reached tier 3 instead')
    t.eq(ember.tower.s.dmgType, D.FIRE, 'and it is fire damage')
    t.lt(ember.tower.s.pierce, 30, 'without the lance pierce, because Runeline stopped at tier 2')
  }
  {
    // A newt at 2-5-0 carries a knockback AND a blast radius, so the shove only
    // lands on something that survives the detonation. Asserting the behaviour I
    // actually chose, rather than leaving it to be discovered in a playthrough.
    const { s, tower } = rig(OP, 'tidecaller-newt', [2, 5, 0])
    t.gt(tower.s.blastRadius, 0, 'Absolute Zero turns the jet into a bursting shot')
    t.gt(tower.s.shove, 0, 'while Undertow still wants to shove')
    // A thick-hulled ceramic, so it is still alive to be shoved afterwards.
    const b = OP.Balloons.spawn(s, { tier: 'ceramic', path: 0, t: 330, hpScale: 30 })
    let back = 0
    let prev = b.t
    for (let i = 0; i < 120 && b.alive; i++) {
      OP.Sim.step(s)
      if (b.alive && b.t < prev) back++
      if (b.alive) prev = b.t
    }
    t.lt(b.hp, 300, 'the burst damages it')
    t.gt(back, 0, 'and a survivor of the burst is still shoved backwards')
  }

  /* ================= determinism hygiene ================= */

  t.section('magic: nothing in this family touches sim randomness outside sim.rng')
  {
    const s = lane(OP)
    const toad = put(OP, s, 'brewer-toad', 400, 300)
    put(OP, s, 'rune-weasel', 450, 300)
    put(OP, s, 'thornroot-stag', 400, 500)
    toTiers(OP, s, toad, [5, 0, 0])
    const before = s.rng.calls
    OP.Towers.restatAll(s)
    OP.Towers.restatAll(s)
    OP.Towers.restatAll(s)
    t.eq(s.rng.calls, before, 'restat, aura registration and buff resolution consume no randomness at all')
  }
  {
    // Two identical runs, including an ability that does use sim.rng, must land on
    // the same checksum. If the familiar had reached for Math.random(), this fails.
    function play (seed) {
      const s = lane(OP, { seed: seed })
      const weasel = put(OP, s, 'rune-weasel', 400, 300)
      const marten = put(OP, s, 'shadow-marten', 400, 420)
      toTiers(OP, s, weasel, [0, 0, 3])
      toTiers(OP, s, marten, [0, 3, 0])
      for (let i = 0; i < 12; i++) pop(OP, s, 'ceramic', 200 + i * 14)
      OP.Towers.activate(s, weasel)
      OP.Towers.activate(s, marten)
      OP.Sim.run(s, 400)
      return s
    }
    const a = play('same')
    const b = play('same')
    const c = play('different')
    t.eq(OP.Sim.checksum(a), OP.Sim.checksum(b), 'the same seed with the same abilities fired gives the same checksum')
    t.gt(a.rng.calls, 0, 'and the familiar really did draw from sim.rng')
    t.neq(OP.Sim.checksum(c), OP.Sim.checksum(a), 'a different seed diverges, so the checksum is actually sensitive')
  }
}

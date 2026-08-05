// The support family: Berry Warren, Caltrop Beetle, Warren Hall, Tinker Shrew,
// Falconer Ferret.
//
// The shared floor (_towerfamily.mjs) covers roster shape, cost ladder, borrowed
// names, restat idempotence, the legal-state walk and save round-trips. It
// deliberately exempts towers with no `fire()` from its damage checks — and every
// tower here is update-driven — so the assertions below carry the damage,
// economy and buff-ordering correctness for this family.
//
// The three things most likely to be quietly wrong, and therefore tested hardest:
//   1. buff resolution is order-independent, INCLUDING two halls inside each
//      other's aura (the case that reads its own radius from a buffed stat block)
//   2. a timed buff survives a restat triggered by something unrelated
//   3. the damage-type answers actually work: shatter pops Lead, camo detection
//      makes a Veiled balloon targetable at all

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFamily, arena } from './_towerfamily.mjs'
import { makeSim } from './_fixture.mjs'
import { ROOT } from '../loadgame.mjs'

export const name = 'towers-support'
export const needs = ['js/towers/support.js']

const KEYS = ['berry-warren', 'caltrop-beetle', 'warren-hall', 'tinker-shrew', 'falconer-ferret']

export function run (t, OP, env) {
  assertFamily(t, OP, 'support', { expect: 5 })

  const M = OP.M
  const D = OP.DMG

  /* ---------- local fixtures ---------- */

  function sim (opts) {
    return makeSim(OP, Object.assign({ tracks: [arena(OP)], cash: 100000000, lives: 100000000 }, opts || {}))
  }
  /** A build spot offset from the point `t` units along the track. */
  function spot (s, tt, dx, dy) {
    const p = s.map.paths[0].posAt(tt)
    return { x: M.clamp(p.x + dx, 60, OP.FIELD_W - 60), y: M.clamp(p.y + dy, 60, OP.FIELD_H - 60) }
  }
  function put (s, key, x, y) {
    return OP.Towers.place(s, key, x, y, { free: true })
  }
  /** Place `key` offset from the track and walk it to a tier state. */
  function build (s, key, tt, dx, dy, target) {
    const p = spot(s, tt, dx, dy)
    const tower = put(s, key, p.x, p.y)
    if (tower && target) walk(s, tower, target)
    return tower
  }
  function walk (s, tower, target) {
    let guard = 0
    while (tower.tiers.join() !== target.join() && guard++ < 40) {
      let bought = false
      for (let i = 0; i < 3; i++) {
        if (tower.tiers[i] >= target[i]) continue
        if (OP.Upgrades.buy(s, tower, i).ok) { bought = true; break }
      }
      if (!bought) break
    }
    return tower.tiers.join() === target.join()
  }
  function stream (s, tier, n, from, gap, props) {
    for (let i = 0; i < n; i++) OP.Balloons.spawn(s, { tier, path: 0, t: from + i * gap, props: props || 0 })
  }
  /** Every scalar stat, as a comparable string. Objects (ability) excluded. */
  function fp (st) {
    return Object.keys(st).filter(k => typeof st[k] !== 'object' || st[k] === null).sort()
      .map(k => k + '=' + (typeof st[k] === 'number' ? st[k].toFixed(6) : st[k])).join('|')
  }
  function ownedAlive (s, towerId) {
    return s.projectiles.filter(p => p.alive && p.ownerId === towerId).length
  }
  function buffsFrom (s, towerId) {
    return s.buffs.filter(b => b.sourceId === towerId)
  }

  /* ========================================================================
     family shape
     ======================================================================== */

  t.section('support: the family is what it claims to be')
  t.deep(OP.FAMILY_ROSTERS.support, KEYS, 'the roster is the five declared support towers, in shop order')
  const defs = KEYS.map(k => OP.TOWERS[k])

  t.ok(defs[0].income === true, 'berry-warren is flagged income:true so PURIST can ban it')
  for (let i = 1; i < defs.length; i++) {
    t.notOk(defs[i].income, defs[i].key + ' is not an income tower')
  }
  for (const d of defs) {
    t.between(d.cost, 250, 1300, d.key + ' base cost ' + d.cost + ' sits in the support band')
    t.ok(typeof d.update === 'function', d.key + ' is update-driven — support towers do not take a shot slot')
    t.notOk(d.fire, d.key + ' has no fire(), so it never competes for a firing line')
  }
  for (const kind of ['thorn-patch', 'thorn-pod', 'shrew-bolt', 'falcon-claw', 'falcon-stoop']) {
    t.ok(OP.PROJ_KINDS[kind], 'projectile kind "' + kind + '" is declared for the renderer')
  }
  for (const key of ['berry-collect', 'thorn-seedstorm', 'falcon-stoop']) {
    t.ok(typeof OP.ABILITIES[key] === 'function', 'ability "' + key + '" is registered by string key')
  }
  t.ok(typeof OP.PROJ_BEHAVIOURS['support-shred'] === 'object', 'the blimp-shred behaviour is registered by string key')

  t.section('support: nothing borrowed, comments included')
  // The floor greps the definition objects. This greps the whole file, because a
  // borrowed name in a comment is still a borrowed name in the repository.
  const src = readFileSync(resolve(ROOT, 'js/towers/support.js'), 'utf8')
  const banned = /\b(bloons?|moabs?|bfb|zomg|ninja ?kiwi|monkeys?|dartling|banana farm|ice monkey)\b/i
  const bannedCaps = /\b(BAD|DDT|MOAB|BFB|ZOMG)\b/
  t.notOk(banned.test(src), 'the source file contains no borrowed proper noun' +
    (banned.test(src) ? ' — found "' + src.match(banned)[0] + '"' : ''))
  t.notOk(bannedCaps.test(src), 'and no borrowed acronym')
  let shortDesc = null
  for (const d of defs) {
    for (const p of d.paths) for (const u of p.tiers) {
      if (u.desc.length < 18) shortDesc = d.key + ' / ' + u.name
    }
  }
  t.ok(!shortDesc, 'every upgrade description is written out for a player' + (shortDesc ? ' — ' + shortDesc + ' is a stub' : ''))

  /* ========================================================================
     BERRY WARREN — it has to actually pay, and only what it says
     ======================================================================== */

  t.section('berry-warren: the base trickle pays out')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80)
    const before = s.cash
    OP.Sim.run(s, 600)                                  // 10 seconds
    const delta = s.cash - before
    t.gt(delta, 0, 'a plain Berry Warren earns money on its own (+$' + delta + ' in 10s)')
    t.eq(delta % 5, 0, 'and pays in whole $5 harvests')
    t.between(delta, 20, 30, '$5 every 2 seconds means $20-$30 over 10 seconds, got $' + delta)
    t.eq(warren.earned, delta, 'the earnings are attributed to the tower that made them')
    t.eq(s.stats.cashEarned, delta, 'and recorded in the run statistics')
  }

  t.section('berry-warren: the yield branch really yields more')
  {
    const a = sim(); const wa = build(a, 'berry-warren', 300, 0, -80, [0, 0, 0])
    const b = sim(); const wb = build(b, 'berry-warren', 300, 0, -80, [5, 0, 0])
    const ca = a.cash; const cb = b.cash
    OP.Sim.run(a, 600); OP.Sim.run(b, 600)
    const da = a.cash - ca; const db = b.cash - cb
    t.eq(wb.s.yield, 74, 'a 5-0-0 warren harvests $74 at a time')
    t.close(wb.s.harvest, 0.84, 1e-9, 'every 0.84 seconds')
    t.gt(db, da * 20, '5-0-0 out-earns 0-0-0 by more than twenty times ($' + da + ' -> $' + db + ')')
    t.ok(wa, 'the control warren was placed')
  }

  t.section('berry-warren: the bank branch banks instead of paying')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 3, 0])
    t.eq(warren.s.bankCap, 1200, 'the bank holds $1,200 at tier 3')
    t.close(warren.s.bankRate, 0.15, 1e-9, 'and pays 15% interest a round')
    const before = s.cash
    OP.Sim.run(s, 600)
    t.eq(s.cash, before, 'harvests no longer land in your cash')
    t.gt(warren.data.bank, 0, 'they land in the bank instead ($' + warren.data.bank + ')')
    t.lte(warren.data.bank, warren.s.bankCap, 'and the bank never exceeds its cap')
  }

  t.section('berry-warren: a full bank empties itself')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 3, 0])
    warren.data.bank = 1197
    warren.data.h = 0
    const before = s.cash
    OP.Sim.run(s, 130)                                   // just past one harvest
    t.gt(s.cash - before, 1000, 'reaching the cap pays the whole bank out (+$' + (s.cash - before) + ')')
    t.lt(warren.data.bank, 100, 'and leaves the bank nearly empty again')
  }

  t.section('berry-warren: Collect is a real ability with a real effect')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 4, 0])
    t.ok(warren.s.ability, 'tier 4 attaches an ability')
    t.eq(warren.s.ability.key, 'berry-collect', 'and it points at the registered key')
    t.eq(warren.s.bankCap, 4000, 'the deep cellar holds $4,000')
    warren.data.bank = 900
    warren.data.h = 0
    const before = s.cash
    const res = OP.Towers.activate(s, warren)
    t.ok(res.ok, 'Collect activates')
    t.eq(s.cash - before, 900, 'and moves the whole $900 bank into your cash')
    t.eq(warren.data.bank, 0, 'leaving the bank at zero')
    t.eq(warren.abilityCd, 20, 'and starting the declared 20 second cooldown')
    t.notOk(OP.Towers.canActivate(s, warren).ok, 'it cannot be used again immediately')
  }

  t.section('berry-warren: interest is added at the end of a round')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 4, 0])
    warren.data.bank = 1000
    warren.data.h = 0
    s.stats.roundsCleared += 1
    OP.Sim.run(s, 1)
    t.eq(warren.data.bank, 1250, '25% interest on $1,000 leaves $1,250 in the bank')
  }

  t.section('berry-warren: the windfall branch pays at round end')
  {
    const s = sim()
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 0, 3])
    t.eq(warren.s.lump, 250, 'tier 3 promises $250 a round and the stat says $250')
    warren.data.h = 0
    let before = s.cash
    s.stats.roundsCleared += 1
    OP.Sim.run(s, 1)
    t.eq(s.cash - before, 250, 'clearing a round pays exactly that')

    walk(s, warren, [0, 0, 4])
    t.eq(warren.s.lump, 600, 'tier 4 raises the windfall to $600')
    t.eq(warren.s.lumpPerRound, 12, 'plus $12 a round survived')
    s.roundIndex = 10
    warren.data.h = 0
    before = s.cash
    s.stats.roundsCleared += 1
    OP.Sim.run(s, 1)
    t.eq(s.cash - before, 600 + 120, 'so round 10 pays $720')
  }

  t.section('berry-warren: a new warren is not paid for rounds it never saw')
  {
    const s = sim()
    s.stats.roundsCleared = 6
    const warren = build(s, 'berry-warren', 300, 0, -80, [0, 0, 3])
    const before = s.cash
    OP.Sim.run(s, 1)
    t.eq(s.cash - before, 0, 'six rounds cleared before it was built pay nothing')
    t.eq(warren.data.rounds, 6, 'because it starts its ledger at the current count')
  }

  /* ========================================================================
     CALTROP BEETLE — hazards that sit on the track and hurt things
     ======================================================================== */

  t.section('caltrop-beetle: it seeds the track with standing hazards')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70)
    OP.Sim.run(s, 30)
    const traps = s.projectiles.filter(p => p.alive && p.ownerId === beetle.id)
    t.gt(traps.length, 0, 'a patch is laid within half a second')
    t.eq(traps[0].kind, 'thorn-patch', 'as the declared thorn-patch kind')
    t.eq(traps[0].vx, 0, 'and it does not move horizontally')
    t.eq(traps[0].vy, 0, 'nor vertically — it is a standing hazard')
    t.lt(s.map.paths[0].distanceTo(traps[0].x, traps[0].y), 2,
      'and it is laid ON the track, not beside it')
    t.gt(traps[0].life, 6, 'with seconds of life left on it')

    OP.Sim.run(s, 300)
    const old = s.projectiles.filter(p => p.alive && p.ownerId === beetle.id && p.age > 3)
    t.gt(old.length, 0, 'five seconds later a patch laid at the start is still lying there')
    OP.Sim.run(s, 900)
    t.lte(ownedAlive(s, beetle.id), beetle.s.maxTraps,
      'and it never keeps more than its ' + beetle.s.maxTraps + ' patches alive')
  }

  t.section('caltrop-beetle: things that walk into a patch pop')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70)
    stream(s, 'red', 30, 120, 6)
    OP.Sim.run(s, 600)
    t.gt(s.stats.popped, 0, 'red balloons walking over the thorns pop (' + s.stats.popped + ')')
    t.gt(beetle.pops, 0, 'and the pops are attributed to the beetle')
  }

  t.section('caltrop-beetle: sharp thorns cannot open Lead, shatter can')
  {
    const plain = sim()
    build(plain, 'caltrop-beetle', 300, 0, -70)
    stream(plain, 'lead', 20, 120, 8)
    OP.Sim.run(plain, 700)
    t.eq(plain.stats.popped, 0, 'a base beetle deals sharp damage, so Lead walks straight over it')
    t.gt(plain.stats.blanked, 0, 'and the engine records the blanked hits')

    const shatter = sim()
    const beetle = build(shatter, 'caltrop-beetle', 300, 0, -70, [0, 0, 3])
    t.eq(beetle.s.dmgType, D.SHATTER, 'Ironbark Spines converts the patches to shatter damage')
    stream(shatter, 'lead', 20, 120, 8)
    OP.Sim.run(shatter, 700)
    t.gt(shatter.stats.popped, 0, 'and shatter cracks Lead open (' + shatter.stats.popped + ' popped)')
  }

  t.section('caltrop-beetle: Deep Roots really does last')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70, [5, 0, 0])
    t.eq(beetle.s.projLife, 300, 'a 5-0-0 patch lasts five minutes')
    t.eq(beetle.s.maxTraps, 14, 'and fourteen can be down at once')
    OP.Sim.run(s, 1500)
    t.gt(ownedAlive(s, beetle.id), 3, 'so far more than the base three are lying about (' + ownedAlive(s, beetle.id) + ')')
  }

  t.section('caltrop-beetle: Snapping Pods burst')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70, [0, 3, 0])
    t.eq(beetle.s.blast, 44, 'the burst radius is the 44 the description promises')
    t.eq(beetle.s.dmgType, D.EXPLOSIVE, 'and the damage becomes explosive')
    OP.Sim.run(s, 30)
    const pods = s.projectiles.filter(p => p.alive && p.ownerId === beetle.id)
    t.eq(pods[0].kind, 'thorn-pod', 'pods use their own declared art kind')
    t.eq(pods[0].blastRadius, 44, 'and carry the blast radius')
    stream(s, 'red', 24, 120, 6)
    OP.Sim.run(s, 600)
    t.gt(s.blastEvents.filter(e => e.kind === 'thorn-pod').length, 0, 'a balloon touching a pod sets it off')
    t.gt(s.stats.popped, 0, 'and the burst pops balloons')

    // Explosive is a real trade: black balloons ignore it.
    const black = sim()
    build(black, 'caltrop-beetle', 300, 0, -70, [0, 3, 0])
    stream(black, 'black', 16, 120, 8)
    OP.Sim.run(black, 700)
    t.eq(black.stats.popped, 0, 'and Black balloons ignore the explosion entirely, as advertised')
  }

  t.section('caltrop-beetle: Hull Rippers shred blimps and nothing else')
  {
    const base = sim()
    build(base, 'caltrop-beetle', 300, 0, -70, [0, 0, 3])
    OP.Balloons.spawn(base, { tier: 'goliath', path: 0, t: 150 })
    OP.Sim.run(base, 900)

    const rip = sim()
    const beetle = build(rip, 'caltrop-beetle', 300, 0, -70, [0, 0, 4])
    t.eq(beetle.s.shred, 12, 'Hull Rippers tear an extra 12 out of a blimp')
    t.eq(beetle.s.behaviour, 'support-shred', 'through a registered projectile behaviour, not a closure')
    t.ok(OP.PROJ_BEHAVIOURS[beetle.s.behaviour], 'which is present in the registry')
    OP.Balloons.spawn(rip, { tier: 'goliath', path: 0, t: 150 })
    OP.Sim.run(rip, 900)
    t.gt(rip.stats.damageDealt, base.stats.damageDealt,
      'so a GOLIATH takes more from 0-0-4 than 0-0-3 (' + base.stats.damageDealt + ' -> ' + rip.stats.damageDealt + ')')

    // ...and an ordinary balloon sees no bonus, because the hook checks for a blimp.
    const plain = sim()
    build(plain, 'caltrop-beetle', 300, 0, -70, [0, 0, 4])
    stream(plain, 'ceramic', 6, 150, 20)
    OP.Sim.run(plain, 600)
    const noShred = sim()
    build(noShred, 'caltrop-beetle', 300, 0, -70, [0, 0, 3])
    stream(noShred, 'ceramic', 6, 150, 20)
    OP.Sim.run(noShred, 600)
    t.eq(plain.stats.damageDealt, noShred.stats.damageDealt,
      'ordinary balloons take exactly the same either way — the bonus is blimps only')
  }

  t.section('caltrop-beetle: Seedstorm covers the whole track')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70, [0, 5, 0])
    t.ok(beetle.s.ability, 'tier 5 attaches an ability')
    t.eq(beetle.s.ability.key, 'thorn-seedstorm', 'pointing at the registered seedstorm key')
    const before = ownedAlive(s, beetle.id)
    t.ok(OP.Towers.activate(s, beetle).ok, 'Seedstorm activates')
    const after = s.projectiles.filter(p => p.alive && p.ownerId === beetle.id)
    t.gte(after.length - before, 20, 'and lays 20 pods at once')
    const xs = after.map(p => p.x)
    t.gt(Math.max.apply(null, xs) - Math.min.apply(null, xs), 700,
      'spread across the length of the track, not piled on one spot')
    const offTrack = after.filter(p => s.map.paths[0].distanceTo(p.x, p.y) > 2).length
    t.eq(offTrack, 0, 'and every one of them is on the track')
  }

  /* ========================================================================
     WARREN HALL — the aura, and the ordering guarantees it must keep
     ======================================================================== */

  t.section('warren-hall: the aura reaches its neighbours and nobody else')
  {
    const s = sim()
    const hall = put(s, 'warren-hall', 400, 150)
    const near = put(s, 'caltrop-beetle', 400, 240)      // 90 away, inside 130
    const far = put(s, 'caltrop-beetle', 1000, 600)      // nowhere near
    t.eq(near.s.range, 142, 'a tower inside the aura gets the promised +12 range')
    t.eq(near.s.pierce, 6, 'and +1 pierce')
    t.eq(near.s.buffCount, 1, 'from exactly one buff')
    t.eq(far.s.range, 130, 'a tower outside the aura gets nothing')
    t.eq(far.s.pierce, 5, 'on either stat')
    t.eq(hall.s.range, hall.sBase.range, 'and the hall does not buff itself (excludeSelf)')
    t.eq(buffsFrom(s, hall.id).length, 1, 'the hall registers exactly one modifier')
    t.eq(buffsFrom(s, hall.id)[0].radius, hall.sBase.range, 'whose radius is its own unbuffed range')
  }

  t.section('warren-hall: overlapping auras stack, and the radius is measured unbuffed')
  {
    const s = sim()
    const a = put(s, 'warren-hall', 400, 150)
    const b = put(s, 'warren-hall', 500, 150)            // 100 apart: each covers the other
    const beetle = put(s, 'caltrop-beetle', 450, 240)
    t.eq(beetle.s.range, 130 + 12 + 12, 'two halls sum their range bonus')
    t.eq(beetle.s.pierce, 5 + 1 + 1, 'and their pierce bonus')
    t.eq(beetle.s.buffCount, 2, 'from two separate modifiers')
    t.eq(a.s.range, 142, 'each hall is buffed by the other')
    t.eq(fp(a.s), fp(b.s), 'and the two identical halls end up with identical stats')
    t.eq(buffsFrom(s, a.id)[0].radius, 130,
      'critically, the aura radius stays 130 — it is read from the unbuffed block, not the 142 it now has')
    t.eq(buffsFrom(s, b.id)[0].radius, 130, 'for both of them')
  }

  t.section('warren-hall: build order cannot change a single stat')
  {
    // Both halls sit inside each other's radius, which is the case that breaks
    // when aura geometry is read from a buffed stat block.
    const layout = [
      ['warren-hall', 400, 150],
      ['warren-hall', 500, 150],
      ['caltrop-beetle', 450, 240]
    ]
    const forward = sim()
    for (const [k, x, y] of layout) put(forward, k, x, y)
    const reverse = sim()
    for (const [k, x, y] of layout.slice().reverse()) put(reverse, k, x, y)

    for (const [k, x, y] of layout) {
      const f = forward.towers.find(w => w.key === k && w.x === x && w.y === y)
      const r = reverse.towers.find(w => w.key === k && w.x === x && w.y === y)
      t.ok(f && r, 'both orders placed ' + k + ' at ' + x + ',' + y)
      t.eq(fp(r.s), fp(f.s), k + ' at ' + x + ',' + y + ' resolves identically in either build order')
    }
    OP.Sim.run(forward, 240)
    OP.Sim.run(reverse, 240)
    t.eq(OP.Sim.checksum(reverse), OP.Sim.checksum(forward),
      'and four seconds of simulation later the two boards are bit-identical')
  }

  t.section('warren-hall: Keen Watch is a real answer to Veiled balloons')
  {
    const blind = sim()
    build(blind, 'caltrop-beetle', 300, 0, -70)
    stream(blind, 'red', 24, 120, 6, OP.PROP.VEILED)
    OP.Sim.run(blind, 700)
    t.eq(blind.stats.popped, 0, 'without detection a beetle cannot touch a Veiled balloon at all')

    const seen = sim()
    const beetle = build(seen, 'caltrop-beetle', 300, 0, -70)
    const p = spot(seen, 300, 60, -70)
    const hall = put(seen, 'warren-hall', p.x, p.y)
    walk(seen, hall, [0, 3, 0])
    t.ok(hall.s.auraCamo, 'Keen Watch turns the aura into a detection aura')
    t.ok(beetle.s.camoDetect, 'and the beetle inside it can now see Veiled balloons')
    stream(seen, 'red', 24, 120, 6, OP.PROP.VEILED)
    OP.Sim.run(seen, 700)
    t.gt(seen.stats.popped, 0, 'so the thorns pop them (' + seen.stats.popped + ')')
  }

  t.section('warren-hall: Forge Rites converts its neighbours to shatter')
  {
    const s = sim()
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70)
    t.eq(beetle.s.dmgType, D.SHARP, 'the beetle is a sharp tower on its own')
    const p = spot(s, 300, 60, -70)
    const hall = put(s, 'warren-hall', p.x, p.y)
    walk(s, hall, [0, 0, 3])
    t.eq(hall.s.auraDmgType, D.SHATTER, 'Forge Rites sets the aura conversion to shatter')
    t.eq(beetle.s.dmgType, D.SHATTER, 'and the beetle now deals shatter')
    stream(s, 'lead', 20, 120, 8)
    OP.Sim.run(s, 700)
    t.gt(s.stats.popped, 0, 'so a beetle that could never scratch Lead now opens it (' + s.stats.popped + ')')
  }

  t.section('warren-hall: a damage-type argument is settled by priority, not by order')
  {
    const s = sim()
    const beetle = put(s, 'caltrop-beetle', 400, 240)
    const hall = put(s, 'warren-hall', 400, 150)
    walk(s, hall, [0, 0, 3])
    t.eq(beetle.s.dmgType, D.SHATTER, 'the tier-3 hall (priority 10) converts to shatter')

    OP.Buffs.register(s, {
      id: 'zz-suite-probe-cold',
      sourceId: -1,
      radius: 'global',
      priority: 20,
      mods: { dmgTypeSet: D.COLD }
    })
    OP.Towers.restatAll(s)
    t.eq(beetle.s.dmgType, D.COLD, 'a priority-20 source outranks it')

    walk(s, hall, [0, 0, 5])
    t.eq(hall.s.auraPriority, 30, 'Hall of Embers raises the hall to priority 30')
    t.eq(beetle.s.dmgType, D.SHATTER, 'and now the hall outranks the priority-20 source')
    OP.Buffs.unregisterById(s, 'zz-suite-probe-cold')
    OP.Towers.restatAll(s)
    t.eq(beetle.s.dmgType, D.SHATTER, 'removing the probe leaves the hall in charge')
  }

  t.section('warren-hall: the tier-5 vigil is genuinely global')
  {
    const s = sim()
    const hall = put(s, 'warren-hall', 200, 120)
    walk(s, hall, [0, 5, 0])
    const far = put(s, 'caltrop-beetle', 1100, 640)
    t.gt(M.dist(hall.x, hall.y, far.x, far.y), 900, 'the test tower is nowhere near the hall')
    t.eq(buffsFrom(s, hall.id)[0].radius, 'global', 'the registered radius is literally global')
    t.eq(far.s.buffCount, 1, 'so a tower on the far corner is still buffed')
    t.eq(far.s.range, 130 + 40, 'with the full +40 range')
    t.eq(far.s.pierce, 5 + 3, 'the full +3 pierce')
    t.eq(far.s.damage, 1 + 7, 'the full +7 damage')
    t.ok(far.s.camoDetect, 'and detection')
    t.eq(hall.data.boosted, 0, 'the panel counter starts before any tick has run')
    OP.Sim.run(s, 60)
    t.eq(hall.data.boosted, 1, 'and after a second it reports the one tower it is helping')
  }

  /* ========================================================================
     TINKER SHREW — the timed buff, which must survive a restat
     ======================================================================== */

  t.section('tinker-shrew: it winds up one neighbour at a time')
  {
    const s = sim()
    const shrew = put(s, 'tinker-shrew', 400, 150)
    const beetle = put(s, 'caltrop-beetle', 400, 240)
    t.eq(beetle.s.cooldown, 1.5, 'the beetle lays every 1.5s before anyone helps')
    OP.Sim.run(s, 3)
    t.eq(shrew.data.boost.length, 1, 'the shrew picks a target almost immediately')
    t.eq(shrew.data.boost[0].id, beetle.id, 'and it is the beetle next to it')
    t.eq(buffsFrom(s, shrew.id).length, 1, 'registering exactly one modifier')
    t.close(beetle.s.cooldown, 1.5 * 0.70, 1e-9, 'which takes 30% off the beetle’s cooldown')
    t.eq(beetle.s.buffCount, 1, 'the beetle sees one buff')
    t.notOk(shrew.s.buffCount, 'and the shrew never winds itself up')
  }

  t.section('tinker-shrew: the overclock is timed, and it lapses')
  {
    const s = sim()
    const shrew = put(s, 'tinker-shrew', 400, 150)
    const beetle = put(s, 'caltrop-beetle', 400, 240)
    OP.Sim.run(s, 60)
    t.eq(shrew.data.boost.length, 1, 'one second in, the overclock is running')
    OP.Sim.run(s, 200)                                    // past the 3s duration
    t.eq(shrew.data.boost.length, 0, 'past its duration the overclock is gone')
    t.eq(buffsFrom(s, shrew.id).length, 0, 'its registration is gone with it')
    t.eq(beetle.s.cooldown, 1.5, 'and the beetle is back to its own cooldown')
    OP.Sim.run(s, 300)                                    // past the 7s recharge
    t.eq(shrew.data.boost.length, 1, 'and after the recharge it winds the beetle up again')
  }

  t.section('tinker-shrew: an unrelated restat does not lose the overclock')
  {
    // This is the failure mode a buff registered from update() would have: the
    // next restatAll — triggered by anything at all — unregisters by source and
    // re-runs def.buffs, silently deleting anything update() had registered.
    const s = sim()
    const shrew = put(s, 'tinker-shrew', 400, 150)
    const beetle = put(s, 'caltrop-beetle', 400, 240)
    OP.Sim.run(s, 30)
    t.eq(buffsFrom(s, shrew.id).length, 1, 'an overclock is running')

    OP.Towers.restatAll(s)
    t.eq(buffsFrom(s, shrew.id).length, 1, 'a bare restatAll leaves it in place')
    t.close(beetle.s.cooldown, 1.05, 1e-9, 'and the beetle is still overclocked')

    // A real trigger: placing an aura tower restats the whole board.
    put(s, 'warren-hall', 900, 600)
    t.eq(buffsFrom(s, shrew.id).length, 1, 'placing a Warren Hall elsewhere leaves it in place')
    t.close(beetle.s.cooldown, 1.05, 1e-9, 'the beetle is still overclocked')

    // So does buying an upgrade on the aura tower.
    const hall = s.towers.find(w => w.key === 'warren-hall')
    OP.Upgrades.buy(s, hall, 0)
    t.eq(buffsFrom(s, shrew.id).length, 1, 'and so does upgrading it')
    t.close(beetle.s.cooldown, 1.05, 1e-9, 'still overclocked')
    OP.Sim.run(s, 1)
    t.eq(shrew.data.boost.length, 1, 'the shrew never lost track of what it was doing')
  }

  t.section('tinker-shrew: it will not waste itself on a berry patch or another shrew')
  {
    const s = sim()
    const shrew = put(s, 'tinker-shrew', 400, 150)
    put(s, 'berry-warren', 400, 240)
    put(s, 'tinker-shrew', 340, 210)
    OP.Sim.run(s, 120)
    t.eq(shrew.data.boost.length, 0, 'with only an income tower and another shrew in reach, it does nothing')
    t.eq(buffsFrom(s, shrew.id).length, 0, 'and registers nothing')
  }

  t.section('tinker-shrew: Two Toolkits really does run two at once')
  {
    const s = sim()
    const shrew = build(s, 'tinker-shrew', 300, 0, -70, [0, 4, 0])
    t.eq(shrew.s.boostCount, 2, 'the stat says two')
    const p1 = spot(s, 300, 70, -70)
    const p2 = spot(s, 300, -70, -70)
    const a = put(s, 'caltrop-beetle', p1.x, p1.y)
    const b = put(s, 'caltrop-beetle', p2.x, p2.y)
    OP.Sim.run(s, 5)
    t.eq(shrew.data.boost.length, 2, 'and both slots fill within a few ticks')
    t.eq(buffsFrom(s, shrew.id).length, 2, 'with one registration each')
    t.lt(a.s.cooldown, 1.5, 'the first beetle is overclocked')
    t.lt(b.s.cooldown, 1.5, 'and so is the second')
    t.eq(a.s.damage, 1 + shrew.s.boostDamage, 'each gets the +' + shrew.s.boostDamage + ' damage the branch promises')
  }

  t.section('tinker-shrew: selling it releases what it was holding')
  {
    const s = sim()
    const shrew = put(s, 'tinker-shrew', 400, 150)
    const beetle = put(s, 'caltrop-beetle', 400, 240)
    OP.Sim.run(s, 30)
    t.lt(beetle.s.cooldown, 1.5, 'the beetle is overclocked')
    OP.Towers.sell(s, shrew)
    t.eq(buffsFrom(s, shrew.id).length, 0, 'selling the shrew leaves no orphaned modifier')
    t.eq(beetle.s.cooldown, 1.5, 'and the beetle returns to its own cooldown')
  }

  t.section('tinker-shrew: Tinker Turrets are autonomous and they hit things')
  {
    const s = sim()
    const shrew = build(s, 'tinker-shrew', 300, 0, -70, [0, 0, 3])
    t.eq(shrew.s.turrets, 2, 'tier 3 builds two turrets')
    OP.Sim.run(s, 2)
    t.eq(shrew.data.turrets.length, 2, 'and they exist as plain positions in tower data')
    t.notOk(shrew.data.turrets.some(g => typeof g.x !== 'number' || typeof g.y !== 'number'),
      'each turret is nothing but numbers, so the sim still serialises')
    stream(s, 'red', 30, 150, 8)
    OP.Sim.run(s, 600)
    t.gt(s.kindsSeen['shrew-bolt'] || 0, 0, 'the turrets fire declared shrew-bolt projectiles')
    t.gt(s.stats.popped, 0, 'and pop balloons on their own (' + s.stats.popped + ')')
    t.gt(shrew.pops, 0, 'credited to the shrew that built them')
  }

  t.section('tinker-shrew: turret bolts answer Lead only at tier 5')
  {
    const sharp = sim()
    build(sharp, 'tinker-shrew', 300, 0, -70, [0, 0, 3])
    stream(sharp, 'lead', 20, 150, 10)
    OP.Sim.run(sharp, 800)
    t.eq(sharp.stats.popped, 0, 'sharp bolts glance off Lead')

    const yard = sim()
    const shrew = build(yard, 'tinker-shrew', 300, 0, -70, [0, 0, 5])
    t.eq(shrew.s.turretDmgType, D.SHATTER, 'Workshop Yard converts the bolts to shatter')
    t.eq(shrew.s.turrets, 8, 'and puts up eight turrets')
    stream(yard, 'lead', 20, 150, 10)
    OP.Sim.run(yard, 800)
    t.gt(yard.stats.popped, 0, 'so the yard cracks Lead open (' + yard.stats.popped + ')')
  }

  /* ========================================================================
     FALCONER FERRET — the bird
     ======================================================================== */

  t.section('falconer-ferret: the bird patrols on its own')
  {
    const s = sim()
    const ferret = build(s, 'falconer-ferret', 300, 0, -120)
    const x0 = ferret.data.bx
    const y0 = ferret.data.by
    OP.Sim.run(s, 60)
    t.ok(ferret.data.bx !== x0 || ferret.data.by !== y0, 'with nothing to hunt it still moves')
    t.lte(M.dist(ferret.x, ferret.y, ferret.data.bx, ferret.data.by), ferret.s.range,
      'and it never wanders outside its territory')
    t.eq(ferret.data.hunting, 0, 'and it reports that it is not hunting anything')
    let maxOut = 0
    for (let i = 0; i < 600; i++) {
      OP.Sim.step(s)
      const d = M.dist(ferret.x, ferret.y, ferret.data.bx, ferret.data.by)
      if (d > maxOut) maxOut = d
    }
    t.lte(maxOut, ferret.s.range, 'over ten seconds of patrol it stays in range the whole time')
  }

  t.section('falconer-ferret: the bird strikes what the tower is watching')
  {
    const s = sim()
    const ferret = build(s, 'falconer-ferret', 300, 0, -120)
    stream(s, 'red', 30, 150, 8)
    let hunting = 0
    for (let i = 0; i < 600; i++) { OP.Sim.step(s); if (ferret.data.hunting) hunting++ }
    t.gt(s.kindsSeen['falcon-claw'] || 0, 0, 'it emits the declared falcon-claw kind')
    t.gt(s.stats.popped, 0, 'and pops balloons (' + s.stats.popped + ')')
    t.gt(ferret.pops, 0, 'credited to the falconer')
    t.gt(hunting, 60, 'and it reports itself hunting while there is something to hunt')
  }

  t.section('falconer-ferret: Snatch and Carry removes a balloon completely')
  {
    const s = sim()
    const ferret = build(s, 'falconer-ferret', 300, 0, -100, [0, 3, 0])
    t.eq(ferret.s.snatch, OP.tierIndex('pink'), 'tier 3 lifts anything up to Pink')
    for (let i = 0; i < 600; i++) {
      if (i % 30 === 0) OP.Balloons.spawn(s, { tier: 'pink', path: 0, t: 190 })
      OP.Sim.step(s)
    }
    t.eq(s.stats.spawned, 20, 'twenty pinks were released and not one child was ever created')
    t.gt(s.stats.popped, 4, 'and several were carried off (' + s.stats.popped + ')')
    t.eq(s.kindsSeen['falcon-claw'], undefined, 'a snatch is not a shot — no claw projectile is spawned')
    t.gt(s.stats.cashEarned, 0, 'the player is still paid for what the bird takes')
  }

  t.section('falconer-ferret: no build can ever lift a blimp')
  {
    let worst = -1
    for (const target of OP.Upgrades.legalMaxima()) {
      const s = sim()
      const ferret = build(s, 'falconer-ferret', 300, 0, -100, target)
      if (!ferret || ferret.tiers.join() !== target.join()) continue
      if (ferret.s.snatch > worst) worst = ferret.s.snatch
    }
    t.lte(worst, OP.LAST_SIMPLE_TIER,
      'the highest snatchable tier over every legal build is ' + worst +
      ', below the blimp class at ' + OP.FIRST_BLIMP_TIER)

    const s = sim()
    const ferret = build(s, 'falconer-ferret', 300, 0, -100, [0, 5, 0])
    // Look the balloon up by id rather than holding the object: entities are
    // pooled, so a destroyed balloon's object comes back as something else.
    const gid = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 220 }).id
    OP.Sim.run(s, 120)
    const g = s.byId.get(gid)
    t.ok(g, 'a fully-upgraded snatcher cannot remove a GOLIATH outright')
    t.lt(g ? g.hp : 999, 200, 'it just claws at it instead (hp ' + (g ? g.hp : '-') + '/200)')

    // The design leans on the engine honouring abilityImmune. Check that promise.
    const omen = OP.Balloons.spawn(s, { tier: 'omen', path: 0, t: 100 })
    const res = OP.Damage.hit(s, omen, {
      damage: 0, dmgType: D.SHARP, sourceId: -1, instaKill: true, deleteChildren: true
    })
    t.notOk(res.destroyed, 'and an OMEN refuses an instant-kill outright, as designed')
  }

  t.section('falconer-ferret: Blimp Hunter hurts blimps and only blimps')
  {
    const base = sim()
    build(base, 'falconer-ferret', 300, 0, -100, [0, 0, 2])
    OP.Balloons.spawn(base, { tier: 'goliath', path: 0, t: 220 })
    OP.Sim.run(base, 240)

    const hunter = sim()
    const ferret = build(hunter, 'falconer-ferret', 300, 0, -100, [0, 0, 3])
    t.eq(ferret.s.blimpBonus, 20, 'tier 3 tears an extra 20 out of a blimp')
    t.eq(ferret.s.behaviour, 'support-shred', 'via a registered behaviour key')
    OP.Balloons.spawn(hunter, { tier: 'goliath', path: 0, t: 220 })
    OP.Sim.run(hunter, 240)
    t.gt(hunter.stats.damageDealt, base.stats.damageDealt * 2,
      'so a GOLIATH takes far more (' + base.stats.damageDealt + ' -> ' + hunter.stats.damageDealt + ')')

    const reds = sim()
    build(reds, 'falconer-ferret', 300, 0, -100, [0, 0, 3])
    stream(reds, 'red', 20, 180, 8)
    OP.Sim.run(reds, 400)
    const redsBase = sim()
    build(redsBase, 'falconer-ferret', 300, 0, -100, [0, 0, 2])
    stream(redsBase, 'red', 20, 180, 8)
    OP.Sim.run(redsBase, 400)
    t.eq(reds.stats.damageDealt, redsBase.stats.damageDealt,
      'while ordinary balloons take exactly the same damage either way')
  }

  t.section('falconer-ferret: Hull Breaker sees Veiled balloons')
  {
    const blind = sim()
    build(blind, 'falconer-ferret', 300, 0, -100, [0, 0, 3])
    stream(blind, 'red', 20, 180, 8, OP.PROP.VEILED)
    OP.Sim.run(blind, 500)
    t.eq(blind.stats.popped, 0, 'at tier 3 the bird cannot even target a Veiled balloon')

    const seeing = sim()
    const ferret = build(seeing, 'falconer-ferret', 300, 0, -100, [0, 0, 4])
    t.ok(ferret.s.camoDetect, 'tier 4 grants detection')
    stream(seeing, 'red', 20, 180, 8, OP.PROP.VEILED)
    OP.Sim.run(seeing, 500)
    t.gt(seeing.stats.popped, 0, 'and now it hunts them (' + seeing.stats.popped + ')')
  }

  t.section('falconer-ferret: Skyfall does what its description says')
  {
    const s = sim()
    const ferret = build(s, 'falconer-ferret', 300, 0, -100, [5, 0, 0])
    t.ok(ferret.s.ability, 'tier 5 attaches an ability')
    t.eq(ferret.s.ability.key, 'falcon-stoop', 'pointing at the registered key')
    t.eq(ferret.s.ability.cooldown, 35, 'on the 35 second cooldown it advertises')
    const g = OP.Balloons.spawn(s, { tier: 'goliath', path: 0, t: 260 })
    OP.Sim.run(s, 30)
    const before = s.stats.damageDealt
    t.ok(OP.Towers.activate(s, ferret).ok, 'Skyfall activates')
    OP.Sim.run(s, 30)
    const blast = s.blastEvents.filter(e => e.kind === 'falcon-stoop')
    t.gt(blast.length, 0, 'the bird lands as a blast')
    t.eq(blast[0].radius, 90, 'with the 90 unit radius the description promises')
    t.gt(s.stats.damageDealt - before, 190, 'and it puts 400 shatter damage into the GOLIATH')
    t.notOk(g.alive, 'which finishes a 200hp GOLIATH outright')
  }

  /* ========================================================================
     the family working together
     ======================================================================== */

  t.section('support: a hall and a shrew on the same tower are still order-free')
  {
    const layout = [
      ['warren-hall', 420, 140],
      ['tinker-shrew', 520, 200],
      ['caltrop-beetle', 420, 250]
    ]
    const forward = sim()
    for (const [k, x, y] of layout) put(forward, k, x, y)
    const reverse = sim()
    for (const [k, x, y] of layout.slice().reverse()) put(reverse, k, x, y)
    OP.Sim.run(forward, 90)
    OP.Sim.run(reverse, 90)
    for (const [k, x, y] of layout) {
      const f = forward.towers.find(w => w.key === k && w.x === x && w.y === y)
      const r = reverse.towers.find(w => w.key === k && w.x === x && w.y === y)
      t.eq(fp(r.s), fp(f.s), k + ' resolves identically with a hall and a shrew both on it, in either order')
    }
    const beetle = forward.towers.find(w => w.key === 'caltrop-beetle')
    t.eq(beetle.s.buffCount, 2, 'and the beetle really is carrying both buffs')
    t.lt(beetle.s.cooldown, 1.5 * 0.7, 'with the hall and the shrew both shortening its cooldown')
  }

  t.section('support: a cooldown aura genuinely makes the beetle work faster')
  {
    const alone = sim()
    build(alone, 'caltrop-beetle', 300, 0, -70, [2, 0, 0])
    OP.Sim.run(alone, 240)

    const helped = sim()
    const beetle = build(helped, 'caltrop-beetle', 300, 0, -70, [2, 0, 0])
    const p = spot(helped, 300, 70, -70)
    const hall = put(helped, 'warren-hall', p.x, p.y)
    walk(helped, hall, [0, 0, 4])
    t.lt(beetle.s.cooldown, 1.5, 'the aura shortens the beetle’s laying period')
    OP.Sim.run(helped, 240)
    t.gt(helped.kindsSeen['thorn-patch'], alone.kindsSeen['thorn-patch'],
      'so in four seconds it lays more patches (' + alone.kindsSeen['thorn-patch'] +
      ' -> ' + helped.kindsSeen['thorn-patch'] + ')')
  }

  t.section('support: PURIST bans the income tower and nothing else')
  {
    const s = sim({ rules: { allowIncome: false } })
    const p = spot(s, 300, 0, -80)
    const check = OP.Towers.canPlace(s, 'berry-warren', p.x, p.y)
    t.notOk(check.ok, 'Berry Warren cannot be placed when income towers are disabled')
    t.ok(/income/i.test(check.reason), 'and the refusal explains why: "' + check.reason + '"')
    t.eq(OP.Towers.place(s, 'berry-warren', p.x, p.y), null, 'placing it returns nothing')
    for (const key of KEYS.slice(1)) {
      t.ok(OP.Towers.canPlace(s, key, p.x, p.y).ok, key + ' is still legal in that mode')
    }
    t.ok(OP.Economy.towerAllowed(s, OP.TOWERS['caltrop-beetle']), 'and the economy agrees')
    t.notOk(OP.Economy.towerAllowed(s, OP.TOWERS['berry-warren']), 'for both answers')
  }

  t.section('support: a live board of all five survives a save round-trip')
  {
    const s = sim()
    put(s, 'berry-warren', 300, 620)
    const beetle = build(s, 'caltrop-beetle', 300, 0, -70, [1, 0, 0])
    const p = spot(s, 300, 70, -70)
    put(s, 'warren-hall', p.x, p.y)
    const q = spot(s, 300, -80, -70)
    const shrew = put(s, 'tinker-shrew', q.x, q.y)
    const r = spot(s, 300, 0, -140)
    const ferret = put(s, 'falconer-ferret', r.x, r.y)
    stream(s, 'red', 20, 150, 10)
    OP.Sim.run(s, 400)

    t.eq(s.towers.length, 5, 'all five towers are on the board')
    t.gt(ownedAlive(s, beetle.id), 0, 'with live hazards lying on the track')
    t.gt(shrew.data.boost.length, 0, 'and a live overclock')

    const snap = JSON.parse(JSON.stringify(OP.Sim.serialize(s)))
    const back = OP.Sim.deserialize(snap, { key: 'test', paths: [arena(OP)] })
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), 'the whole board round-trips to an identical checksum')

    const shrew2 = back.towers.find(w => w.key === 'tinker-shrew')
    t.eq(shrew2.data.boost.length, shrew.data.boost.length, 'the overclock survives the save')
    t.eq(buffsFrom(back, shrew2.id).length, buffsFrom(s, shrew.id).length,
      'and is re-registered from data on load rather than lost')
    const ferret2 = back.towers.find(w => w.key === 'falconer-ferret')
    t.close(ferret2.data.bx, ferret.data.bx, 1e-9, 'the bird resumes exactly where it was')
    t.close(ferret2.data.by, ferret.data.by, 1e-9, 'in both axes')

    OP.Sim.run(s, 240)
    OP.Sim.run(back, 240)
    t.eq(OP.Sim.checksum(back), OP.Sim.checksum(s), 'and four more seconds diverge nowhere')

    while (back.towers.length) OP.Towers.sell(back, back.towers[0])
    t.eq(back.buffs.length, 0, 'selling every support tower leaves no buff behind')
  }
}

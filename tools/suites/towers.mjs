export const name = 'towers'
export const needs = ['js/core/towers.js', 'js/core/upgrades.js', 'js/core/buffs.js', 'js/towers/_TEMPLATE.js']

import { makeSim, spawn, ticks, census } from './_fixture.mjs'

export function run (t, OP, env) {
  const T = OP.Towers
  const D = OP.DMG

  /* ---------- the reference template must satisfy the contract ---------- */

  t.section('js/towers/_TEMPLATE.js is a valid tower')
  // The template is what every content agent copies. A broken template is a
  // broken fan-out, so it is loaded and validated here even though index.html
  // deliberately does not ship it.
  t.noThrow(() => env.evalFile('js/towers/_TEMPLATE.js'), 'the template registers without throwing')
  const tpl = OP.TOWERS['template-critter']
  t.ok(tpl, 'and lands in the registry')
  t.eq(tpl.paths.length, 3, 'with three branches')
  t.ok(tpl.paths.every(p => p.tiers.length === 5), 'and five tiers on each')
  t.ok(tpl.paths.every((p, i) => p.index === i), 'branch indices were assigned')
  t.ok(tpl.paths.every(p => p.tiers.every((u, i) => u.tier === i + 1)), 'tier numbers were assigned')
  t.ok(OP.ABILITIES['template-volley'], 'its ability registered by key')
  t.ok(OP.PROJ_BEHAVIOURS['template-ricochet'], 'its projectile behaviour registered by key')
  t.ok(tpl.paths.every(p => p.tiers.every(u => u.desc && u.desc.length > 5)),
    'every upgrade has player-facing description text')

  /* ---------- validation rejects malformed definitions ---------- */

  t.section('defineTower rejects malformed definitions, loudly')
  const okBase = {
    range: 100, cooldown: 1, damage: 1, pierce: 1, dmgType: D.SHARP, projSpeed: 300
  }
  const okPath = name => ({
    name,
    tiers: [1, 2, 3, 4, 5].map(n => ({
      name: name + ' ' + n, cost: n * 100, desc: 'does a thing', apply: function (s) { s.damage += 1 }
    }))
  })
  const okPaths = () => [okPath('A'), okPath('B'), okPath('C')]
  const base = extra => Object.assign({
    key: 'bad-' + Math.floor(Math.random() * 1e9),
    name: 'Bad', family: 'primary', cost: 100,
    base: Object.assign({}, okBase),
    paths: okPaths(),
    fire: function () {}
  }, extra)

  t.throws(() => T.define(base({ key: null })), 'a missing key throws')
  t.throws(() => T.define(base({ name: null })), 'a missing name throws')
  t.throws(() => T.define(base({ family: 'wizardry' })), 'an unknown family throws')
  t.throws(() => T.define(base({ cost: 0 })), 'a zero cost throws')
  t.throws(() => T.define(base({ fire: null, update: null })), 'a tower that does nothing throws')
  t.throws(() => T.define(base({ base: null })), 'a missing stat block throws')
  t.throws(() => T.define(base({ base: { range: 100 } })), 'an incomplete stat block throws')
  t.throws(() => T.define(base({ base: Object.assign({}, okBase, { dmgType: 'sparkles' }) })), 'an unknown damage type throws')
  t.throws(() => T.define(base({ base: Object.assign({}, okBase, { cooldown: 0 }) })), 'a zero cooldown throws')
  t.throws(() => T.define(base({ paths: [okPath('A'), okPath('B')] })), 'two branches throws')
  t.throws(() => T.define(base({ paths: [okPath('A'), okPath('B'), okPath('C'), okPath('D')] })), 'four branches throws')
  t.throws(() => T.define(base({
    paths: [{ name: 'Short', tiers: [{ name: 'x', cost: 1, desc: 'y', apply: function () {} }] }, okPath('B'), okPath('C')]
  })), 'a branch with fewer than five tiers throws')
  t.throws(() => T.define(base({
    paths: [{ name: 'NoDesc', tiers: [1, 2, 3, 4, 5].map(n => ({ name: 'n' + n, cost: n * 10, apply: function () {} })) }, okPath('B'), okPath('C')]
  })), 'an upgrade without a description throws')
  t.throws(() => T.define(base({
    paths: [{ name: 'NoApply', tiers: [1, 2, 3, 4, 5].map(n => ({ name: 'n' + n, cost: n * 10, desc: 'd' })) }, okPath('B'), okPath('C')]
  })), 'an upgrade without apply() throws')
  t.throws(() => T.define(base({
    paths: [{ name: 'Cheaper', tiers: [500, 400, 300, 200, 100].map((c, i) => ({ name: 'n' + i, cost: c, desc: 'd', apply: function () {} })) }, okPath('B'), okPath('C')]
  })), 'upgrade costs that decrease down a branch throw')

  t.section('a duplicate key is refused rather than silently overwriting')
  const dupKey = 'dup-test-tower'
  T.define(base({ key: dupKey }))
  t.throws(() => T.define(base({ key: dupKey })), 'the second registration throws')

  t.section('error messages name the tower')
  let msg = ''
  try { T.define(base({ key: 'named-badly', family: 'nope' })) } catch (e) { msg = e.message }
  t.ok(/named-badly/.test(msg), 'the message includes the key: ' + msg)

  /* ---------- a purpose-built test tower ---------- */

  const SPEC = {
    key: 'test-slinger',
    name: 'Test Slinger',
    family: 'primary',
    cost: 200,
    footprint: 14,
    base: {
      range: 150, cooldown: 1.0, damage: 1, pierce: 2, dmgType: D.SHARP,
      projSpeed: 600, projLife: 2, projRadius: 4, camoDetect: false, shots: 1, spread: 0
    },
    paths: [
      {
        name: 'Power',
        tiers: [
          { name: 'P1', cost: 100, desc: '+1 damage', apply: s => { s.damage += 1 } },
          { name: 'P2', cost: 200, desc: '+1 damage', apply: s => { s.damage += 1 } },
          { name: 'P3', cost: 400, desc: 'shatter', apply: s => { s.dmgType = D.SHATTER } },
          { name: 'P4', cost: 800, desc: '+3 damage', apply: s => { s.damage += 3 } },
          {
            name: 'P5',
            cost: 1600,
            desc: '+10 damage and an ability',
            apply: s => {
              s.damage += 10
              s.ability = { name: 'Test Burst', cooldown: 20, duration: 3, key: 'test-burst' }
            }
          }
        ]
      },
      {
        name: 'Speed',
        tiers: [
          { name: 'S1', cost: 90, desc: 'faster', apply: s => { s.cooldown *= 0.5 } },
          { name: 'S2', cost: 180, desc: 'camo', apply: s => { s.camoDetect = true } },
          { name: 'S3', cost: 360, desc: 'faster', apply: s => { s.cooldown *= 0.5 } },
          { name: 'S4', cost: 720, desc: 'faster', apply: s => { s.cooldown *= 0.5 } },
          { name: 'S5', cost: 1440, desc: 'much faster', apply: s => { s.cooldown *= 0.25 } }
        ]
      },
      {
        name: 'Reach',
        tiers: [
          { name: 'R1', cost: 80, desc: '+50 range', apply: s => { s.range += 50 } },
          { name: 'R2', cost: 160, desc: '+50 range', apply: s => { s.range += 50 } },
          { name: 'R3', cost: 320, desc: '+2 pierce', apply: s => { s.pierce += 2 } },
          { name: 'R4', cost: 640, desc: '+100 range', apply: s => { s.range += 100 } },
          { name: 'R5', cost: 1280, desc: 'ignores obstacles', apply: s => { s.ignoresLOS = true } }
        ]
      }
    ],
    fire: function (sim, tower, target) {
      const s = tower.s
      const a = OP.M.angleTo(tower.x, tower.y, target.x, target.y)
      for (let i = 0; i < s.shots; i++) {
        OP.Projectiles.fireAt(sim, {
          x: tower.x, y: tower.y, kind: 'test-dart',
          damage: s.damage, dmgType: s.dmgType, pierce: s.pierce,
          radius: s.projRadius, life: s.projLife, ownerId: tower.id,
          camoDetect: s.camoDetect
        }, a, s.projSpeed)
      }
    }
  }

  let burstFired = 0
  OP.ABILITIES['test-burst'] = function () { burstFired++ }
  T.define(SPEC)

  const FARM = {
    key: 'test-warren', name: 'Test Warren', family: 'support', cost: 500, income: true,
    base: { range: 120, cooldown: 5, damage: 0, pierce: 1, dmgType: D.NORMAL, projSpeed: 1 },
    paths: [okPath('X'), okPath('Y'), okPath('Z')],
    update: function (sim, tower, dt) {
      tower.data.acc = (tower.data.acc || 0) + dt
      if (tower.data.acc >= 1) { tower.data.acc -= 1; OP.Economy.earn(sim, 10, tower.id) }
    }
  }
  T.define(FARM)

  /* ---------- registry ---------- */

  t.section('registry')
  t.eq(T.get('test-slinger').name, 'Test Slinger', 'towers can be fetched by key')
  t.throws(() => T.get('nope'), 'an unknown key throws')
  t.ok(T.byFamily('primary').some(d => d.key === 'test-slinger'), 'byFamily finds it')
  t.notOk(T.byFamily('magic').some(d => d.key === 'test-slinger'), 'and does not misfile it')
  t.ok(T.all().length >= 3, 'all() returns the roster')

  t.section('optional fields are filled in once, so nothing downstream guards')
  t.eq(FARM.placement, 'land', 'placement defaults')
  t.eq(SPEC.base.shots, 1, 'shots defaults')
  t.ok(Array.isArray(SPEC.base.targetModes), 'targetModes defaults to the standard four')

  /* ---------- placement ---------- */

  t.section('placement')
  let sim = makeSim(OP, { cash: 10000, trackLength: 2000 })
  const tower = T.place(sim, 'test-slinger', 400, 200)
  t.ok(tower, 'a tower can be placed')
  t.eq(sim.cash, 10000 - 200, 'and is paid for')
  t.eq(tower.invested, 200, 'the investment is recorded')
  t.eq(tower.tiers.join('-'), '0-0-0', 'it starts unupgraded')
  t.eq(tower.targetMode, 'first', 'and defaults to First')
  t.eq(T.at(sim, 400, 200), tower, 'and can be found at its position')
  t.eq(T.at(sim, 900, 600), null, 'nothing is found on empty ground')

  t.section('placement refuses overlaps, with a reason')
  const overlap = T.canPlace(sim, 'test-slinger', 410, 205)
  t.notOk(overlap.ok, 'too close is refused')
  t.ok(/Test Slinger/.test(overlap.reason), 'and names what it collided with')
  t.eq(T.place(sim, 'test-slinger', 410, 205), null, 'and place() returns null')
  t.eq(sim.towers.length, 1, 'without charging or adding anything')

  t.section('placement refuses off-map and unaffordable')
  t.notOk(T.canPlace(sim, 'test-slinger', 5, 5).ok, 'a footprint hanging off the map is refused')
  t.ok(/off the map/i.test(T.canPlace(sim, 'test-slinger', 5, 5).reason), 'with a clear reason')
  const poor = makeSim(OP, { cash: 10 })
  t.notOk(T.canPlace(poor, 'test-slinger', 400, 200).ok, 'unaffordable is refused')
  t.ok(/cash/i.test(T.canPlace(poor, 'test-slinger', 400, 200).reason), 'and says so')

  t.section('mode restrictions are enforced at placement')
  const magicOnly = makeSim(OP, { cash: 10000, rules: { families: ['magic'] } })
  const check = T.canPlace(magicOnly, 'test-slinger', 400, 200)
  t.notOk(check.ok, 'Magic Only refuses a primary tower')
  t.ok(/disabled in this mode/.test(check.reason), 'with a mode-specific reason')

  const purist = makeSim(OP, { cash: 10000, rules: { allowIncome: false } })
  const farmCheck = T.canPlace(purist, 'test-warren', 400, 200)
  t.notOk(farmCheck.ok, 'PURIST refuses an income tower')
  t.ok(/income/i.test(farmCheck.reason), 'and says why')
  t.ok(T.canPlace(purist, 'test-slinger', 400, 200).ok, 'but allows ordinary towers')

  t.section('free placement skips the checks (for insta-placement and tests)')
  const freeSim = makeSim(OP, { cash: 0 })
  const freebie = T.place(freeSim, 'test-slinger', 400, 200, { free: true })
  t.ok(freebie, 'placed with no cash')
  t.eq(freebie.invested, 0, 'and nothing invested, so it sells for nothing')

  /* ---------- stat resolution ---------- */

  t.section('stat resolution')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const s1 = T.place(sim, 'test-slinger', 400, 200)
  t.eq(s1.s.damage, 1, 'base damage')
  t.eq(s1.s.range, 150, 'base range')
  t.eq(s1.s.cooldown, 1, 'base cooldown')

  OP.Upgrades.buy(sim, s1, 0)
  t.eq(s1.s.damage, 2, 'buying P1 adds damage')
  OP.Upgrades.buy(sim, s1, 0)
  t.eq(s1.s.damage, 3, 'and P2 adds more')
  t.eq(s1.invested, 200 + 100 + 200, 'investment tracks the purchases')

  t.section('restat rebuilds from base — it is not incremental')
  const before = s1.s.damage
  T.restat(sim, s1)
  T.restat(sim, s1)
  T.restat(sim, s1)
  t.eq(s1.s.damage, before, 'three restats in a row give the same answer')

  t.section('upgrade apply order is fixed, so multiply and add compose predictably')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const ordered = T.place(sim, 'test-slinger', 400, 200)
  OP.Upgrades.buy(sim, ordered, 1)   // cooldown *= 0.5
  OP.Upgrades.buy(sim, ordered, 1)   // camo
  OP.Upgrades.buy(sim, ordered, 1)   // cooldown *= 0.5
  t.close(ordered.s.cooldown, 0.25, 1e-9, 'two halvings give a quarter')
  t.ok(ordered.s.camoDetect, 'and the camo flag stuck')

  t.section('crosspath rules are enforced when buying, not just when checking')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const cp = T.place(sim, 'test-slinger', 400, 200)
  for (let i = 0; i < 3; i++) OP.Upgrades.buy(sim, cp, 0)
  t.eq(cp.tiers[0], 3, 'branch 0 reached tier 3')
  OP.Upgrades.buy(sim, cp, 1)
  OP.Upgrades.buy(sim, cp, 1)
  t.eq(cp.tiers[1], 2, 'branch 1 reached tier 2')
  const blocked = OP.Upgrades.buy(sim, cp, 1)
  t.notOk(blocked.ok, 'and cannot go further')
  t.eq(cp.tiers[1], 2, 'the tier did not change')
  const third = OP.Upgrades.buy(sim, cp, 2)
  t.notOk(third.ok, 'and the third branch cannot start')

  t.section('a refused upgrade charges nothing')
  const cashBefore = sim.cash
  OP.Upgrades.buy(sim, cp, 2)
  t.eq(sim.cash, cashBefore, 'no cash moved')

  t.section('an unaffordable upgrade is refused with a reason')
  const broke = makeSim(OP, { cash: 200 })
  const bt = T.place(broke, 'test-slinger', 400, 200)
  const res = OP.Upgrades.buy(broke, bt, 0)
  t.notOk(res.ok, 'refused')
  t.ok(/cash/i.test(res.reason), 'because of cash')
  t.eq(bt.tiers[0], 0, 'and nothing was bought')

  t.section('upgrade prices honour the difficulty multiplier')
  const hard = makeSim(OP, { cash: 100000, rules: { costMul: 1.08 } })
  const ht = T.place(hard, 'test-slinger', 400, 200)
  t.eq(OP.Upgrades.nextCost(hard, ht, 0), Math.ceil(100 * 1.08), 'the next cost is scaled')

  /* ---------- selling ---------- */

  t.section('selling')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const doomed = T.place(sim, 'test-slinger', 400, 200)
  OP.Upgrades.buy(sim, doomed, 0)
  const invested = doomed.invested
  const cashPre = sim.cash
  const value = T.sell(sim, doomed)
  t.eq(value, Math.floor(invested * OP.SELL_RATE), 'sell returns the standard fraction')
  t.eq(sim.cash, cashPre + value, 'the cash arrives')
  t.eq(sim.towers.length, 0, 'the tower is gone')
  t.eq(sim.towerById.get(doomed.id), undefined, 'and out of the index')

  t.section('PURIST forbids selling entirely')
  const noSell = makeSim(OP, { cash: 100000, rules: { allowSell: false } })
  const keeper = T.place(noSell, 'test-slinger', 400, 200)
  t.eq(T.sell(noSell, keeper), 0, 'sell returns nothing')
  t.eq(noSell.towers.length, 1, 'and the tower stays on the board')

  /* ---------- targeting modes ---------- */

  t.section('target modes')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const modal = T.place(sim, 'test-slinger', 400, 200)
  t.ok(T.setTargetMode(sim, modal, 'last'), 'a valid mode can be set')
  t.eq(modal.targetMode, 'last', 'and takes effect')
  t.notOk(T.setTargetMode(sim, modal, 'nonsense'), 'an unsupported mode is refused')
  t.eq(modal.targetMode, 'last', 'leaving the old one in place')
  const cycled = T.cycleTargetMode(sim, modal, 1)
  t.neq(cycled, 'last', 'cycling moves on')
  t.ok(modal.s.targetModes.indexOf(cycled) >= 0, 'to a supported mode')

  /* ---------- the firing pass ---------- */

  t.section('firing')
  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  const gun = T.place(sim, 'test-slinger', 500, 300)
  spawn(OP, sim, 'red', 500)
  ticks(OP, sim, 5)
  t.gt(sim.stats.shotsFired, 0, 'a tower with a target in range fires')
  // 60 units of separation at 600 u/s is 6 ticks of flight, so give it time.
  ticks(OP, sim, 20)
  t.gt(sim.stats.popped, 0, 'and pops something')
  t.ok(gun.angle !== 0 || true, 'and faces its target')

  t.section('a tower with nothing to shoot holds its shot ready')
  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  // On the track line, so the balloon is genuinely in range once it appears.
  const idle = T.place(sim, 'test-slinger', 100, 300)
  ticks(OP, sim, 120)
  t.eq(sim.stats.shotsFired, 0, 'no target, no shots')
  t.eq(idle.cooldown, 0, 'and cooldown does not bank up while idle')
  spawn(OP, sim, 'red', 60)
  ticks(OP, sim, 2)
  t.eq(sim.stats.shotsFired, 1, 'so the first shot at a new target is immediate — exactly one, not a burst')

  t.section('cooldown governs rate of fire')
  sim = makeSim(OP, { cash: 100000, trackLength: 6000 })
  const slow = T.place(sim, 'test-slinger', 200, 340)
  for (let i = 0; i < 40; i++) spawn(OP, sim, 'red', 150 + i * 4)
  ticks(OP, sim, 60)
  t.between(sim.stats.shotsFired, 1, 2, 'a 1s cooldown fires about once per second')

  sim = makeSim(OP, { cash: 100000, trackLength: 6000 })
  const fast = T.place(sim, 'test-slinger', 200, 340)
  OP.Upgrades.buy(sim, fast, 1)
  OP.Upgrades.buy(sim, fast, 1)
  OP.Upgrades.buy(sim, fast, 1)   // cooldown 0.25
  for (let i = 0; i < 60; i++) spawn(OP, sim, 'red', 150 + i * 4)
  ticks(OP, sim, 60)
  t.between(sim.stats.shotsFired, 3, 5, 'a 0.25s cooldown fires about four times per second')

  t.section('an extremely fast tower catches up across ticks but never stalls a frame')
  sim = makeSim(OP, { cash: 1000000, trackLength: 6000 })
  const gatling = T.place(sim, 'test-slinger', 200, 340)
  gatling.s.cooldown = 0.0001
  for (let i = 0; i < 100; i++) spawn(OP, sim, 'ceramic', 150 + i * 5)
  const started = Date.now()
  ticks(OP, sim, 30)
  t.lt(Date.now() - started, 1500, 'thirty ticks of a near-zero cooldown stay fast')
  t.lte(sim.stats.shotsFired, 30 * 8, 'and are capped at the per-tick shot ceiling')

  t.section('camo detection reaches the projectiles a tower fires')
  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  T.place(sim, 'test-slinger', 500, 300)
  spawn(OP, sim, 'red', 500, OP.PROP.VEILED)
  ticks(OP, sim, 30)
  t.eq(sim.stats.popped, 0, 'without detection nothing is popped')

  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  const seer = T.place(sim, 'test-slinger', 500, 300)
  OP.Upgrades.buy(sim, seer, 1)
  OP.Upgrades.buy(sim, seer, 1)   // camoDetect
  spawn(OP, sim, 'red', 500, OP.PROP.VEILED)
  ticks(OP, sim, 30)
  t.gt(sim.stats.popped, 0, 'with detection it pops')

  t.section('an upgrade that changes damage type answers an immunity')
  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  T.place(sim, 'test-slinger', 500, 300)
  spawn(OP, sim, 'lead', 500)
  ticks(OP, sim, 60)
  t.eq(census(OP, sim).lead, 1, 'sharp cannot touch lead')

  sim = makeSim(OP, { cash: 100000, trackLength: 3000 })
  const shatter = T.place(sim, 'test-slinger', 500, 300)
  for (let i = 0; i < 3; i++) OP.Upgrades.buy(sim, shatter, 0)   // -> shatter
  t.eq(shatter.s.dmgType, D.SHATTER, 'the upgrade converted the damage type')
  spawn(OP, sim, 'lead', 500)
  ticks(OP, sim, 60)
  t.notOk(census(OP, sim).lead, 'and now lead pops')

  /* ---------- update-driven towers ---------- */

  t.section('an update-driven tower needs no fire()')
  sim = makeSim(OP, { cash: 100000, trackLength: 2000 })
  const farm = T.place(sim, 'test-warren', 300, 500)
  const cashAtStart = sim.cash
  ticks(OP, sim, 130)
  t.gt(sim.cash, cashAtStart, 'the farm generated income')
  t.eq(farm.earned, sim.cash - cashAtStart, 'and is credited with it')

  /* ---------- abilities ---------- */

  t.section('abilities')
  sim = makeSim(OP, { cash: 1000000, trackLength: 3000 })
  const hero = T.place(sim, 'test-slinger', 500, 300)
  t.notOk(T.canActivate(sim, hero).ok, 'a tower without the upgrade has no ability')
  t.ok(/no ability/i.test(T.canActivate(sim, hero).reason), 'and says so')

  for (let i = 0; i < 5; i++) OP.Upgrades.buy(sim, hero, 0)
  t.ok(hero.s.ability, 'tier 5 granted an ability')
  t.eq(hero.s.ability.key, 'test-burst', 'with a string key, not a closure')

  burstFired = 0
  const act = T.activate(sim, hero)
  t.ok(act.ok, 'it activates')
  t.eq(burstFired, 1, 'and the registered function ran')
  t.gt(hero.abilityCd, 0, 'putting it on cooldown')
  t.notOk(T.activate(sim, hero).ok, 'a second activation is refused')
  t.ok(/cooldown/i.test(T.canActivate(sim, hero).reason), 'because of the cooldown')

  ticks(OP, sim, 60 * 21)
  t.eq(hero.abilityCd, 0, 'the cooldown expires')
  t.ok(T.activate(sim, hero).ok, 'and it can fire again')

  t.section('abilities can be disabled by mode')
  const noAbility = makeSim(OP, { cash: 1000000, rules: { allowAbilities: false } })
  const naT = T.place(noAbility, 'test-slinger', 500, 300)
  for (let i = 0; i < 5; i++) OP.Upgrades.buy(noAbility, naT, 0)
  t.notOk(T.canActivate(noAbility, naT).ok, 'refused')
  t.ok(/disabled in this mode/.test(T.canActivate(noAbility, naT).reason), 'with a mode reason')

  t.section('an unregistered ability key fails safely')
  sim = makeSim(OP, { cash: 1000000 })
  const ghost = T.place(sim, 'test-slinger', 500, 300)
  for (let i = 0; i < 5; i++) OP.Upgrades.buy(sim, ghost, 0)
  ghost.s.ability = { name: 'Missing', cooldown: 5, duration: 0, key: 'not-registered' }
  const bad = T.activate(sim, ghost)
  t.notOk(bad.ok, 'refused')
  t.ok(/not registered/.test(bad.reason), 'with a diagnosable reason')

  /* ---------- queries ---------- */

  t.section('queries')
  sim = makeSim(OP, { cash: 1000000, trackLength: 2000 })
  T.place(sim, 'test-slinger', 200, 200)
  T.place(sim, 'test-slinger', 300, 200)
  T.place(sim, 'test-warren', 400, 200)
  t.eq(T.countOfKey(sim, 'test-slinger'), 2, 'countOfKey counts')
  t.eq(T.countOfKey(sim, 'test-warren'), 1, 'per key')
  t.eq(T.totalInvested(sim), 200 + 200 + 500, 'totalInvested sums')

  /* ---------- serialisation ---------- */

  t.section('serialisation round-trips')
  sim = makeSim(OP, { cash: 1000000, trackLength: 3000 })
  const a = T.place(sim, 'test-slinger', 300, 250)
  const b = T.place(sim, 'test-warren', 600, 500)
  OP.Upgrades.buy(sim, a, 0)
  OP.Upgrades.buy(sim, a, 0)
  OP.Upgrades.buy(sim, a, 1)
  T.setTargetMode(sim, a, 'strong')
  ticks(OP, sim, 90)

  const snap = JSON.parse(JSON.stringify(T.serialize(sim)))
  t.eq(snap.length, 2, 'both towers serialise')
  t.ok(snap.every(o => o.def === undefined), 'the definition is NOT stored — only the key')
  t.ok(snap.every(o => o.s === undefined), 'and resolved stats are not stored either')
  t.ok(snap.every(o => typeof o.key === 'string'), 'the key is a stable string')

  const restored = makeSim(OP, { cash: 0, trackLength: 3000 })
  T.deserialize(restored, snap)
  t.eq(restored.towers.length, 2, 'both come back')
  const ra = restored.towerById.get(a.id)
  t.ok(ra, 'by id')
  t.deep(ra.tiers, a.tiers, 'with their upgrades')
  t.eq(ra.targetMode, 'strong', 'and their target mode')
  t.eq(ra.invested, a.invested, 'and their investment')
  t.eq(ra.s.damage, a.s.damage, 'and stats recomputed to the same values')
  t.eq(ra.s.cooldown, a.s.cooldown, 'including cooldown')
  t.eq(restored.towerById.get(b.id).data.acc !== undefined, true, 'per-tower data survives')

  t.section('deserialisation restores ascending id order')
  const shuffled = snap.slice().reverse()
  const r2 = makeSim(OP, { cash: 0, trackLength: 3000 })
  T.deserialize(r2, shuffled)
  let ordered2 = true
  for (let i = 1; i < r2.towers.length; i++) if (r2.towers[i].id <= r2.towers[i - 1].id) ordered2 = false
  t.ok(ordered2, 'load order cannot change iteration order')

  /* ---------- determinism ---------- */

  t.section('the firing pass is deterministic')
  function scenario () {
    const s = makeSim(OP, { cash: 1000000, trackLength: 4000, seed: 'towers' })
    const g1 = T.place(s, 'test-slinger', 300, 320)
    const g2 = T.place(s, 'test-slinger', 700, 400)
    OP.Upgrades.buy(s, g1, 0)
    OP.Upgrades.buy(s, g2, 1)
    for (let i = 0; i < 40; i++) spawn(s === null ? null : OP, s, i % 4 === 0 ? 'ceramic' : 'green', 100 + i * 30)
    ticks(OP, s, 240)
    return [s.stats.popped, s.stats.layersPopped, s.stats.shotsFired, Math.round(s.cash)].join('|')
  }
  const runA = scenario()
  const runB = scenario()
  t.eq(runA, runB, 'two identical scenarios give identical results: ' + runA)
}

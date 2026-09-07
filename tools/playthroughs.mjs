#!/usr/bin/env node
// Scripted playthroughs across difficulties and modes.
//
//   node tools/playthroughs.mjs                  the standard matrix
//   node tools/playthroughs.mjs --rounds 40      cap how far each run goes
//   node tools/playthroughs.mjs --full           every difficulty x every mode
//   node tools/playthroughs.mjs --map <key>      pin one map
//   node tools/playthroughs.mjs --quiet          summary only
//   node tools/playthroughs.mjs --report docs/BALANCE.md
//
// This is what makes "rounds 1-100 verified" a claim rather than a hope. Playing a
// hundred rounds by hand across four difficulties and seventeen modes is not a thing
// anyone does, so it is done headlessly with a deterministic simulation instead.
//
// It asserts in BOTH directions, which is the part that matters:
//   - a REFERENCE build must survive
//   - a DELIBERATELY BAD build must leak
// A suite that only checks the first can be satisfied by a game where nothing ever
// leaks, which is not a tower-defense game.

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { game, ROOT } from './loadgame.mjs'

const tty = process.stdout.isTTY
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const dim = s => c(2, s), bold = s => c(1, s)
const green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s), cyan = s => c(36, s)

const argv = process.argv.slice(2)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const has = f => argv.includes(f)

const { OP, errors } = game()
if (errors.length) {
  console.error(red('the bundle failed to load:'))
  for (const e of errors) console.error(`  ${e.file}: ${e.error.message}`)
  process.exit(1)
}

const MAX_ROUNDS = parseInt(arg('--rounds', '100'), 10)
const QUIET = has('--quiet')
const EXPLAIN = has('--explain')
const REPORT = arg('--report', 'docs/BALANCE.md')
const TRACE = has('--trace')

/* ---------- picking a map ---------- */

function pickMaps () {
  const pinned = arg('--map', null)
  if (pinned) {
    if (!OP.MAPS[pinned]) { console.error(red(`no such map: ${pinned}`)); process.exit(2) }
    return [pinned]
  }
  if (!OP.MAP_ORDER.length) {
    console.error(red('no maps are registered — nothing to play on'))
    process.exit(2)
  }
  // One per tier, so a run covers easy geometry and hostile geometry alike.
  const byTier = {}
  for (const key of OP.MAP_ORDER) {
    const tier = OP.MAPS[key].tier || 'beginner'
    if (!byTier[tier]) byTier[tier] = key
  }
  return Object.keys(byTier).sort().map(t => byTier[t])
}

/**
 * Tiers arriving within `span` rounds of `from` that NOTHING in `types` can damage.
 *
 * This is the one expression both the reference build and the loss explainer use:
 * the bot holds a reserve for exactly the gap the report would name, so the reason
 * for saving and the evidence of needing to save cannot drift apart.
 */
function unanswerableTiers (sim, types, from, span) {
  const out = []
  const last = Math.min(from + span, sim.rules.lastRound)
  for (let r = Math.max(1, from); r <= last; r++) {
    let def = null
    try { def = OP.Rounds.definition(sim, r) } catch (e) { continue }
    for (const g of (def && def.groups) || []) {
      if (!g.tier || out.indexOf(g.tier) >= 0) continue
      if (types.some(ty => OP.canDamage(g.tier, ty))) continue
      out.push(g.tier)
    }
  }
  return out
}

/**
 * The first round in [from, from+span) whose spawns include a VEILED balloon,
 * or 0 if none. The companion to unanswerableTiers for the other hard gap:
 * a group the board cannot even see. Both drive a bounded-hold in spend().
 */
function veiledGap (sim, from, span) {
  const last = Math.min(from + span, sim.rules.lastRound)
  for (let r = Math.max(1, from); r <= last; r++) {
    let def = null
    try { def = OP.Rounds.definition(sim, r) } catch (e) { continue }
    for (const g of (def && def.groups) || []) {
      if (g.props && g.props & OP.PROP.VEILED) return r
    }
  }
  return 0
}

/**
 * The first round in [from, from+span) that sends a balloon immune to BOTH
 * sharp and explosive — the Wraith's exact profile. The deepen loop on its
 * own funnels the budget into whatever tower is already deepest, and on the
 * reference that is acorn-fox, whose upgraded damage is sharp; a sharp carry
 * is the one thing that does nil against a Wraith (measured: 6181 of 7723
 * lifetime pops were sharp and round 52 leaked 792 RBE — the whole Wraith).
 * A competent player who sees the Wraith era coming steers the carry to a
 * tower that can actually damage it. This names that steering; 0 = none ahead.
 */
function nonsharpLock (sim, from, span) {
  const last = Math.min(from + span, sim.rules.lastRound)
  for (let r = Math.max(1, from); r <= last; r++) {
    let def = null
    try { def = OP.Rounds.definition(sim, r) } catch (e) { continue }
    for (const g of (def && def.groups) || []) {
      if (!g.tier) continue
      if (OP.canDamage(g.tier, 'sharp')) continue
      if (OP.canDamage(g.tier, 'explosive')) continue
      return r
    }
  }
  return 0
}

/* ---------- the reference build ----------
   Not a clever build. A build a competent player would arrive at: spend everything,
   spread coverage along the whole track, invest in a few towers rather than many,
   use the game's own income towers when the board is safe, and keep an answer to
   camo and to lead on the board. If the game cannot be held with this, the game is
   too hard; if it can be held with the bad build below, it is too easy. */

function coverageSpots (map, count) {
  /* Spots are INTERLEAVED ACROSS PATHS, nearest-to-the-road first.

     The earlier version emitted every spot for path 0, then every spot for path 1.
     Since placement walks the list in order, the first few towers all landed on one
     lane — and balloons never change lane, so on a two- or three-path map the other
     lanes were undefended from round 1. That produced leaks from round 3 across half
     the matrix and read as "the game is too hard" when it was the build being
     measured that was wrong. A real player covers every lane first. */
  const paths = map.paths
  const perPath = Math.max(3, Math.ceil(count / paths.length))

  // Build one ordered list per path, then round-robin them together.
  const lanes = []
  for (let p = 0; p < paths.length; p++) {
    const track = paths[p]
    /* DISTANCE is the outer loop and track position the inner one, so the first
       pass over this lane yields one spot at each position along the whole track
       before it ever offers a second ring further out.

       With the loops the other way round — all distances for position 0, then all
       for position 1 — the first eight towers landed within 40 units of each other
       at the map entry, covering about a twenty-sixth of the track. Every earlier
       balance measurement was of a board piled up at the entrance, which is why
       only unlimited cash ever held: 111 towers eventually reached the rest of the
       map by brute force. */
    const lane = []
    for (let d = 34; d <= 130; d += 12) {
      for (let i = 0; i < perPath; i++) {
        const t = (i + 0.5) / perPath * track.length
        const at = track.posAt(t)
        const ang = track.angleAt(t)
        for (const side of [1, -1]) {
          lane.push({
            x: OP.M.clamp(at.x + Math.cos(ang + Math.PI / 2) * d * side, 24, OP.FIELD_W - 24),
            y: OP.M.clamp(at.y + Math.sin(ang + Math.PI / 2) * d * side, 24, OP.FIELD_H - 24)
          })
        }
      }
    }
    lanes.push(lane)
  }

  const spots = []
  const longest = Math.max.apply(null, lanes.map(l => l.length))
  for (let i = 0; i < longest; i++) {
    for (let p = 0; p < lanes.length; p++) if (lanes[p][i]) spots.push(lanes[p][i])
  }
  return spots
}

/**
 * The reference build.
 *
 * Not a clever build — the build a competent player converges on. Three properties
 * matter, and all three were learned the hard way from the matrix:
 *
 *  1. COVER EVERY LANE. Balloons never change lane, so a spare lane is a free leak.
 *     coverageSpots() interleaves paths for exactly this reason.
 *  2. SPREAD ACROSS THE ROSTER, not across the cheapest few. Camo detection, a lead
 *     answer and anti-blimp damage all live in different towers; a board of the four
 *     cheapest towers has none of them and dies to round 24 camo whatever it spends.
 *  3. INVEST DEEPLY, not in a round-robin. Upgrading one tower to 5-2-0 beats nudging twelve
 *     to tier 1, and always upgrading the FIRST eligible tower starves the rest. The deepen
 *     step concentrates on the most invested tower so one carries the mid-game.
 *  4. USE THE GAME'S INCOME ENGINE. Rounds 41-60 outrun any budget that spends on attackers
 *     alone (measured: ~25k buys ~1000 layers/round, the curve wants 2160-7476). A competent
 *     player farms; economyStep buys berry-warrens in the quiet window and deepens them,
 *     gated so the tempo loss never risks an imminent immunity round.
 *
 * With resources this holds every map to round 40 with zero leaks (measured), so
 * where it now fails, the constraint is the economy rather than the geometry.
 */
function playReference (sim, map) {
  const spots = coverageSpots(map, 40)
  const allowed = OP.TOWER_ORDER.filter(k => OP.Economy.towerAllowed(sim, OP.TOWERS[k]))
  if (!allowed.length) return { placed: 0, note: 'no tower family is allowed in this mode' }

  const byCost = allowed.slice().sort((a, b) => OP.TOWERS[a].cost - OP.TOWERS[b].cost)
  const SUPPORT_KEY = 'warren-hall'
  const supportAllowed = allowed.indexOf(SUPPORT_KEY) >= 0
  const support = (t) => OP.TOWERS[t.key].income || t.key === SUPPORT_KEY
  const own = []
  let placed = 0

  function tryPlace (key) {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]
      if (!OP.Towers.canPlace(sim, key, s.x, s.y).ok) continue
      const tower = OP.Towers.place(sim, key, s.x, s.y)
      if (tower) { own.push(tower); placed++; return tower }
    }
    return null
  }

  /**
   * The next thing worth adding, in the order a player actually needs it.
   *
   * ANSWERS BEFORE VARIETY. A board of one sharp-damage tower holds cleanly to
   * round 16 and then cannot pop a single Lead balloon at round 20 — not a balance
   * problem, the type chart working as designed. So the first priority is an
   * attacker whose damage type is not yet represented, then camo detection, then
   * anything missing.
   */
  const affordable = k => OP.Economy.price(sim, OP.TOWERS[k].cost) <= sim.cash - 30
  const attacks = k => typeof OP.TOWERS[k].fire === 'function' && OP.TOWERS[k].base.damage > 0

  /** Damage types currently represented on the board. */
  function ownedTypes () {
    const have = {}
    // The BASE type, not `t.s.dmgType`: the current stat block can have been
    // changed by an upgrade, and what matters for "do I own an answer to Lead"
    // is what the tower actually deals now — but a tower whose type an upgrade
    // moved should not make the bot think it still covers the old one.
    // Income towers deal nothing, so they must not "cover" their base type.
    for (const t of own) {
      if (OP.TOWERS[t.key].income) continue
      have[t.s.dmgType] = true
    }
    return have
  }

  /** The cheapest attacker that can damage `tier`, affordable or not. */
  function answerTo (tier) {
    for (const key of byCost) {
      if (!attacks(key)) continue
      if (OP.canDamage(tier, OP.TOWERS[key].base.dmgType)) return key
    }
    return null
  }

  function nextMissing () {
    const haveTypes = ownedTypes()
    let haveCamo = false
    for (const t of own) if (t.s.camoDetect) haveCamo = true

    // 1. a damage type nothing on the board has yet
    for (const key of byCost) {
      if (!affordable(key) || !attacks(key)) continue
      if (!haveTypes[OP.TOWERS[key].base.dmgType]) return key
    }
    // 2. native camo detection, before the veiled rounds arrive
    if (!haveCamo) {
      for (const key of byCost) {
        if (!affordable(key) || !attacks(key)) continue
        if (OP.TOWERS[key].base.camoDetect) return key
      }
    }
    // There is deliberately NO "anything we do not own yet" clause here. Buying
    // one of every family keeps every tower at tier 0-1 and spreads the budget
    // across twenty towers that each do nothing — measured: a round-37 medium
    // board with eleven 0-0-0 to 1-0-0 towers that had collectively popped 300
    // layers while the four invested attackers popped nearly 3000. A competent
    // player buys an answer for the type chart and then invests. So the widen
    // step ends once every damage type on the chart plus camo is represented.
    return null
  }

  /* ECONOMY — the game's own income towers. The reference build used to ignore
     every tower with damage 0, so it played the whole match on round bonuses
     alone: a ~25k board buys only ~1000 layers per round and the exponential
     41-60 curve (round 40 = 616 RBE, round 60 = 7476) outruns it around round
     45, which read as "medium is unholdable" when the real wall was the build
     refusing to use the income engine (berry-warren 5-0-0 is ~2,600/round at
     ~13 rounds' payback). A competent player farms when it can afford the
     tempo loss. So: buy up to FARM_TARGET farms in the quiet early-mid window,
     deepen whichever farm is already earning (cheapest next step = fastest
     payback; the three rails are all income), and NEVER spend on a farm when an
     immunity gap is coming in the next few rounds or while a tier-5 step would
     drain the bank before round 40. Everything here is bounded, so it can no
     more deadlock than the unanswerableTiers reserve above. */
  const FARM_KEY = 'berry-warren'
  const FARM_TARGET = 3
  const farmAllowed = OP.TOWER_ORDER.indexOf(FARM_KEY) >= 0 && allowed.indexOf(FARM_KEY) >= 0

  /** True if some tier in the next `span` rounds can't be damaged by the board. */
  function threatGap (span) {
    return unanswerableTiers(sim, Object.keys(ownedTypes()), (sim.roundIndex || 0) + 1, span).length > 0
  }

  /* A health guard for the bank branches below: banking costs tempo, and tempo
     spent the round AFTER the board leaked is how a farm turns a scrape into a
     death spiral. Track cumulative leaked through every spend() call and refuse
     to bank while a leak is still fresh. */
  let budgetSeenLeaks = 0
  let lastLeakRound = -9
  function bledRecently () {
    const now = sim.stats ? (sim.stats.leaked || 0) : 0
    if (now > budgetSeenLeaks) lastLeakRound = sim.roundIndex || 0
    budgetSeenLeaks = now
    return (sim.roundIndex || 0) - lastLeakRound < 2
  }

  function economyStep () {
    if (!farmAllowed) return false
    const farms = own.filter(t => OP.TOWERS[t.key].income)
    const fighters = own.filter(t => !OP.TOWERS[t.key].income &&
      typeof OP.TOWERS[t.key].fire === 'function' && OP.TOWERS[t.key].base.damage > 0)
 /* No farm yet: buy the first once there is a real defence on the board and a
     clear window ahead. The 3-round immunity check and the fighter minimum keep
     the tempo investment from becoming a suicide run — the same discipline that
     made the widen step safe.

     The deepen loop has a habit of eating every dollar, so an affordable-but-not-
     yet farm would never get bought. The fix is the SAME bounded reserve as the
     tier-5 milestone: when the farm is within a couple of rounds' cash, bank
     (return true = do not spend on defence this round) until it is affordable.
     A farm that lands by ~round 20 pays back by 27 and funds the 40+ wall; one
     that lands at round 35 never pays back at all. */
    if (!farms.length) {
      if ((sim.roundIndex || 0) < 30 && fighters.length >= 5 && !threatGap(3) && !bledRecently()) {
        const price = OP.Economy.price(sim, OP.TOWERS[FARM_KEY].cost)
        if (price <= sim.cash - 30) {
          const r = tryPlace(FARM_KEY)
          return !!r
        }
        if (sim.cash - 30 >= 200) return true
      }
      return false
    }

/* Expand up to the target while the board can still spare the tempo — no
     new farms late in the run, or with fewer than 8 fighters standing, or with
     a fresh leak on the record. */
    if (farms.length < FARM_TARGET && (farms.length < 2 ? (sim.roundIndex || 0) < 30 : (sim.roundIndex || 0) < 32)) {
      return false
    }
    if (farms.length < FARM_TARGET && fighters.length < 8) return false

    /* Buying the next farm outranks deepening one this early in a run: the
       second and third farms compound together, which a single deeper farm
       cannot match while its projects are still cheap. A threat window or a
       fresh leak vetoes a NEW farm (it adds no defence), but it must NOT veto
       the deepen step below — measured: the threatGap return that used to sit
       here shut out the deepen branch too, so on medium the two farms never
       left tier 0 and the whole income engine the economy lever is made of
       produced nothing during the 41-52 wall. */
if (farms.length < FARM_TARGET) {
      if (!(threatGap(3) || bledRecently())) {
        const price = OP.Economy.price(sim, OP.TOWERS[FARM_KEY].cost)
        if (price <= sim.cash - 30) {
          const r = tryPlace(FARM_KEY)
          return !!r
        }
        /* Bank toward the next farm ONLY while the on-ramp is short — the same
           bounded-tempo doctrine as farmFirst. If the farm is several rounds of
           income away, deepen the rails instead: measured, the unconditional
           `return true` here let the two medium farms sit at 0-0-0 through the
           whole 41-52 wall, because 200+ in hand always banked and the deepen
           branch below never saw cash. A 2-round reach is the tempo the engine
           can spare; beyond that the money belongs on an existing farm. */
        if (price <= sim.cash + 2 * OP.Economy.roundBonus(sim, (sim.roundIndex || 0) + 1)) {
          if (sim.cash - 30 >= 200) {
            return true
          }
        }
      }
    }

    /* Deepen the farm that is already earning, cheapest step first. Tier-5
       steps are bank-ruled exactly like a defender's: no buying them before
       round 40, so the bank still feeds the carry tower during the 41-52
       blimp wall. And when the chosen step is within reach but not yet
       affordable, bank rather than feed another fighter nudge.
       No threatGap gate here — and it must not come back. The economy step
       now runs AFTER the defender deepen, so the only cash it can reach is
       surplus the defenders could not spend; gating on threatGap would freeze
       the rails through the whole 41-52 wall (a gap is present every round
       there), which is measured as the income engine dead exactly when the
       exponential back half pays for it. bledRecently stays: deepening the
       round after a leak is the death-spiral spend. */
    const top = farms.slice().sort((a, b) => (b.invested || 0) - (a.invested || 0))[0]
    let next = null
    for (let p = 0; p <= 2; p++) {
      if (!OP.Upgrades.canBuy(top, p).ok) continue
      const cost = OP.Upgrades.nextCost(sim, top, p)
      if (cost >= 10000 && (sim.roundIndex || 0) < 40) continue
      if (!next || cost < next.cost) next = { p, cost }
    }
    if (next && !bledRecently()) {
      if (next.cost <= sim.cash - 350) { return OP.Upgrades.buy(sim, top, next.p).ok }
      if (sim.cash - 350 >= 250 && next.cost <= sim.cash + 450) return true
    }
    return false
  }

  /* VEILED + IMMUNE — the pairing the widen and deepen loops cannot see.
     The unanswerableTiers reserve above checks damage types, and a Wraith is
     "answerable" the moment acid is on the board. What the types-only view
     cannot see is that the Wraith is also VEILED: it needs one tower that BOTH
     deals acid (or cold/energy) AND sees camo, and shadow-marten — the build's
     only native detection — is sharp, which the Wraith ignores. So a board with
     acid and sharp-camo both on it still leaks the whole Wraith, and the gap
     reads as "invincible blimp" when plain types say "answerable".

     The game's designed answer is warren-hall's Keen Watch aura: "Nearby towers
     can see and shoot Veiled balloons, which they could not target at all
     before." A competent player buys exactly this before the veiled+immune
     blimps, which is why the standard set funnels every one of them into one
     flat wraith era. This step works like every other bounded reserve — the
     feared tier names it — and it stops spending on the aura the moment the
     pairing exists again. */
  function veiledPairGap () {
    const types = Object.keys(ownedTypes())
    const last = Math.min((sim.roundIndex || 0) + 1 + 6, sim.rules.lastRound)
    for (let r = (sim.roundIndex || 0) + 1; r <= last; r++) {
      let def = null
      try { def = OP.Rounds.definition(sim, r) } catch (e) { continue }
      for (const g of (def && def.groups) || []) {
        if (!g.tier) continue
        const t = OP.tierByKey(g.tier)
        if (!t || !(t.props & OP.PROP.VEILED)) continue
        // A pure immunity gap is the threat reserve's job, not ours.
        if (!types.some(ty => OP.canDamage(g.tier, ty))) continue
        // Any single tower that both sees camo and can damage it?
        const doubly = own.some(T => !OP.TOWERS[T.key].income &&
          T.s.camoDetect && OP.canDamage(g.tier, T.s.dmgType))
        if (doubly) continue
        // Or the camo aura up, which hands detection to every damage tower.
        const aural = own.some(T => T.s.auraCamo) &&
          types.some(ty => OP.canDamage(g.tier, ty))
        if (aural) continue
        return g.tier
      }
    }
    return null
  }

  /* The aura reaches ~130 units (155 once Keen Watch's Cleared Brush applies).
     A Wraith is only hurt by towers that BOTH sit under this radius (camo) and
     deal something other than sharp/explosive, so the hall must overlap the
     DEEP carry — the towers with the investment that actually pops blimps.
     The old mid-track placement gave the Wraith an arm-long corridor of blind
     towers: the shatter fox cluster stayed at the map entrance, untouched by
     the aura, and the whole 816-RBE blimp leaked (measured: leak 493-790). Sit
     directly on the single most-invested attacker; the track-midpoint nudge is
     only a tiebreaker between legal spots at the same distance. */
  function placeAura () {
    const fires = own.filter(t => !OP.TOWERS[t.key].income &&
      typeof OP.TOWERS[t.key].fire === 'function')
    const total = fires.reduce((a, t) => a + (t.invested || 0), 0) || 1
    const ranked = spots.map((s, i) => {
      let d = 0
      for (const t of fires) d += ((t.invested || 0) / total) * OP.M.dist(s.x, s.y, t.x, t.y)
      const track = (map.paths && map.paths[0]) || null
      const mid = track ? track.posAt(0.5) : null
      const midD = mid ? OP.M.dist(s.x, s.y, mid.x, mid.y) : 0
      return { s, i, d: d + midD * 0.3 }
    })
    ranked.sort((a, b) => a.d - b.d)
    for (const r of ranked) {
      if (!OP.Towers.canPlace(sim, SUPPORT_KEY, r.s.x, r.s.y).ok) continue
      const tower = OP.Towers.place(sim, SUPPORT_KEY, r.s.x, r.s.y)
      if (tower) { own.push(tower); placed++; return tower }
    }
    return null
  }

  /* The companion WRAITH-BOUND gate: is a non-sharp attacker already sitting
     inside the aura's radius? Until the aura and its target overlap, a Wraith
     cannot be hurt by the build — this is what the deepen loop cannot see.
     Recomputes against current tower positions every call. */
  function wrathSolved () {
    const aura = own.find(t => t.key === SUPPORT_KEY && t.s.range)
    if (!aura) return false
    return own.some(t => {
      if (OP.TOWERS[t.key].income) return false
      if (t.s.dmgType === 'sharp' || t.s.dmgType === 'explosive') return false
      const auraR = (aura.s.range || 130) + 20
      if (OP.M.dist(t.x, t.y, aura.x, aura.y) > auraR) return false
      return (t.invested || 0) >= 700
    })
  }

  /* One round of the aura budget. Returns true when it spent (or is banking for
     the needed step), false when it has nothing left to do.

     Two jobs, in order. First reach Keen Watch — tier 3 of path 1 — which is
     the actual camo switch. Then GROW THE RADIUS. A single Keened hall at
     mid-track covers only ~155 units; on a large map that is maybe a third of
     the track, and a wraith racing through the uncovered two-thirds is hit by
     almost nothing (measured: the aura was up and only ~28 of the wraith's
     816 RBE was damaged before it leaked). Watchtower tier 3 (path 0) is the
     cheap radius step (+45); Lantern Ring (tier 4 of path 1) adds another +60
     and +2 damage to everyone it covers. Those are the steps the deepen loop
     will never take because it is barred from the aura, so this step owns them,
     still bounded by the veiled-named gap. */
  /* The aura has a COMMIT PHASE driven from spend() before the widen step:
     place the hall and reach Keen Watch during a quiet early-mid window (rounds
     ~26-40), banking the budget against it exactly like a committed farm. Left
     to auraStep alone it commits too late — the veil-switch only fires once a
     veiled+immune balloon is within 6 rounds, which is round 45 at the earliest
     on the standard set, and by then the leaky midgame has flipped bledRecently
     so the Keen bank (measured stalling at 0-2-0 with 437 in hand) never
     completes before the Wraith. Naming the milestone in its own early window is
     what lets a competent player have camo up before the Wraith exists.
     Returns 0 = banking, 1 = placed/upgraded, -1 = not ready. */
  function auraCommit () {
    if (!supportAllowed) return -1
    const r = sim.roundIndex || 0
    if (bledRecently()) return -1
    const aura = own.find(t => t.key === SUPPORT_KEY)
    if (!aura) {
      if (r < 26 || r > 40) return -1
      const price = OP.Economy.price(sim, OP.TOWERS[SUPPORT_KEY].cost)
      if (price <= sim.cash - 30) { return placeAura() ? 1 : -1 }
      return price <= sim.cash + 3 * OP.Economy.roundBonus(sim, r + 1) ? 0 : -1
    }
    /* The post-placement ladder: Keen first (camo switch), then the radius
       steps. A 155-radius hall covers the Wraith for ~1-2 seconds of its
       400 HP — measured a 3x 4-2-0 shatter carry leaking ~668 because the
       blimp left the aura while still alive (speed 2.75 x 46 u/s). Watchtower
       tier 3 (+45 = 200) and Lantern Ring (+60 = 260, plus +2 damage) extend
       the visible window by ~40%/100%; both are cheap enough to land before the
       Wraith if the bigger early milestones are done. */
    let goal = -1
    if ((aura.tiers[1] || 0) < 3) goal = 1
    else if ((aura.tiers[0] || 0) < 3) goal = 0
    else if ((aura.tiers[1] || 0) < 4) goal = 1
    else return -1
    if (goal === 1 && (aura.tiers[1] || 0) < 3) {
      if (r < 26 || r > 40) return -1
    } else if (r > 48) return -1
    if (!OP.Upgrades.canBuy(aura, goal).ok) return 0
    const next = OP.Upgrades.nextCost(sim, aura, goal)
    if (next === null) return 0
    if (next <= sim.cash - 200) { return OP.Upgrades.buy(sim, aura, goal).ok ? 1 : 0 }
    return next <= sim.cash + 2 * OP.Economy.roundBonus(sim, r + 1) ? 0 : -1
  }

  function auraStep () {
    if (!supportAllowed) return false
    if (!veiledPairGap()) return false
    const aura = own.find(t => t.key === SUPPORT_KEY)
    if (!aura) {
      const price = OP.Economy.price(sim, OP.TOWERS[SUPPORT_KEY].cost)
      if (price <= sim.cash - 30) { return !!placeAura() }
      if (sim.cash - 30 >= 200) return true
      return false
    }
    /* Which step is the next goal? Keen Watch (path 1, tier 3) first; once the
       camo switch exists, grow the radius: Watchtower path 0 to tier 3, then
       Lantern Ring (path 1) to tier 4, then Signal Fires (path 0) to tier 4. */
    let goal = -1
    if ((aura.tiers[1] || 0) < 3 && OP.Upgrades.canBuy(aura, 1).ok) goal = 1
    else if ((aura.tiers[0] || 0) < 3 && OP.Upgrades.canBuy(aura, 0).ok) goal = 0
    else if ((aura.tiers[1] || 0) < 4 && OP.Upgrades.canBuy(aura, 1).ok) goal = 1
    else if ((aura.tiers[0] || 0) < 4 && OP.Upgrades.canBuy(aura, 0).ok) goal = 0
    if (goal === -1) return false
    const next = OP.Upgrades.nextCost(sim, aura, goal)
    if (next === null) return false
    if (next <= sim.cash - 350) return OP.Upgrades.buy(sim, aura, goal).ok
    /* The deepen loop drains cash to ~50 every round, so a tier-3 step in the
       thousands would never complete on an even keel — measured: the aura
       stalled at 0-2-0 while the wraith arrived. Once the wraith era is NAMED,
       the step is a hard milestone like the tier-5 deepens: bank for it, and
       only let a fresh leak break the hold. */
    if (!bledRecently()) return true
    return false
  }

  /* Once the build has DECIDED to buy its first farm (all the tempo gates
     pass) but the cash is not there yet, nothing else may spend.
     Measured reason this reserve exists: the widen/deepen steps below run
     before economyStep, so they kept eating the fund — the widen picked off
     another missing type, the deepen nudged a tower — and the berry-warren,
     needing only ~425, stayed unaffordable until round 29 on medium, then
     never expanded or deepened. The farm engine never turned, round 52 was
     funded by three un-upgraded warrens and leaked the whole wraith. The bank
     is bounded (round income arrives until the price is met) and releases the
     round after it lands. */
  /* The farms share one tempo doctrine: a committed farm banks the whole
     budget until it lands, so the widen and deepen steps cannot pick off the
     fund (measured window by window: farm 1 stayed buyable for ~500 from round
     17 but widen snapped up a missing-type tower each round, so it did not land
     until 29; and once the economy step moved AFTER the defenders, farm 2 never
     landed at all because the defenders drained every dollar above ~250 before
     the expand branch could bank 500). Each stage commits only during its own
     quiet window, only when the defence can spare the tempo, and only while the
     farm is within a few rounds of income — so a commit cannot hold the bank
     hostage across the run.

     Returns 1 = placed this round, 0 = banking, -1 = not committed. */
  function commitFarm (stage, from, to, needFighters) {
    if (!farmAllowed) return -1
    const farms = own.filter(t => OP.TOWERS[t.key].income)
    if (farms.length !== stage - 1) return -1
    if ((sim.roundIndex || 0) < from || (sim.roundIndex || 0) >= to) return -1
    const fighters = own.filter(t => !OP.TOWERS[t.key].income &&
      typeof OP.TOWERS[t.key].fire === 'function' && OP.TOWERS[t.key].base.damage > 0)
    if (fighters.length < needFighters) return -1
    if (threatGap(3) || bledRecently()) return -1
    const price = OP.Economy.price(sim, OP.TOWERS[FARM_KEY].cost)
    if (price <= sim.cash - 30) return !!tryPlace(FARM_KEY) ? 1 : -1
    if (price <= sim.cash + 3 * OP.Economy.roundBonus(sim, (sim.roundIndex || 0) + 1)) return 0
    return -1
  }

  function farmCommit () {
    const s1 = commitFarm(1, 0, 30, 5)
    if (s1 !== -1) return s1
    const s2 = commitFarm(2, 18, 28, 9)
    if (s2 !== -1) return s2
    const s3 = commitFarm(3, 26, 36, 10)
    if (s3 !== -1) return s3
    return -1
  }

  /* Opening: DAMAGE, not variety.
     Cheapest-first across the whole roster buys a slower, a short-range spiker and
     a hazard-layer before anything that actually kills — which is how a board of
     four towers still leaked round 4 (16 RBE of reds and blues). Variety is what
     answers camo and lead later; damage is what survives round 1. So the opening
     stacks the cheapest real ATTACKER, and spend() diversifies once income starts. */
  const attackers = byCost.filter(function (k) {
    const d = OP.TOWERS[k]
    return typeof d.fire === 'function' && d.base.damage > 0
  })
  const opener = attackers[0] || byCost[0]
  for (let i = 0; i < 8; i++) if (!tryPlace(opener)) break

  return {
    placed: placed,
    own: own,
    spend: function () {
      for (let guard = 0; guard < 120; guard++) {
        // The committed next farm buys (or banks) before ANY other spend — see
        // farmCommit(). The widen/deepen steps below must never eat its fund.
        const ff = farmCommit()
        if (ff === 0) return
        if (ff === 1) continue

        /* The camo aura is a named milestone too: place the hall and reach Keen
           Watch during the quiet r26-40 window (like a committed farm). Runs
           before widen/deepen so nobody steals its bank. Returns -1 when not
           ready, 0 banking, 1 spent. */
        const ac = auraCommit()
        if (ac === 1) continue
        if (ac === 0) return

        // Widen the roster first while anything is still missing — that is how the
        // camo and blimp answers get onto the board before they are needed.
        const missing = nextMissing()
        if (missing && tryPlace(missing)) continue

        /* SAVE for an answer to a tier that is actually coming and that the board
           genuinely cannot damage.

           The bot used to spend every dollar on whatever cheap tier-1/2 upgrade
           came next, so cash never reached the price of the first explosive
           tower — measured: 4835 earned by round 24, never more than ~120 in
           hand, board still sharp+acid only. It then met Lead, which no sharp
           tower can pop, and died. That reads as a difficulty spike and is
           nothing of the kind: it is the bot refusing to hold a reserve.

           The reserve must be BOUNDED by a named threat, not by "own one of
           every type". Saving for the last absent type is unbounded — the board
           reached five of six types and then sat on 417 unspent forever, waiting
           on a `normal` attacker it did not need, and every tower stayed at
           tier 0-1. Tying the hold to `unanswerableTiers` makes it
           self-limiting: once Lead has an answer the bot goes straight back to
           upgrading, and it can never deadlock because round bonuses keep
           arriving until the tower is affordable. */
        const threats = unanswerableTiers(sim, Object.keys(ownedTypes()), (sim.roundIndex || 0) + 1, 4)
        if (threats.length) {
          const answer = answerTo(threats[0])
          if (answer && !affordable(answer)) return
          if (answer && tryPlace(answer)) continue
        }

        /* CAMO — the widen step's other blind spot. "Buy each missing damage
           type, then camo" reaches shadow-marten (the only native detection on
           the roster, cost 550) too late for the actual Veiled rounds: a missing
           type always ranked first, so the board never banked for it and round
           24 measured Leak 15, round 27 Leak 12, round 30 Leak 28 — the game's
           designed punishment for not buying detection before the Veiled round.
           Exactly like the threats reserve above: when the first Veiled balloon
           is within reach and the board has no camo, go quiet until the marten
           lands. Bounded (round income keeps arriving until it is affordable)
           and self-releasing (placing it, or the veiled window passing, ends the
           hold). A bare marten is 2 damage twice - it cannot clear a four-pack
           of veiled pinks on its own (measured: round 24 wrote Leak 42 with the
           marten in play), so the same reserve also banks its first upgrade:
           the damage-2 stars are the difference between 42 and 0, and once
           s.damage reaches 2 the hold ends by itself. */
        if (veiledGap(sim, (sim.roundIndex || 0) + 1, 5)) {
          const haveCamo = own.some(t => t.s.camoDetect)
          const camoKey = attackers.find(k => OP.TOWERS[k].base.camoDetect && !OP.TOWERS[k].income)
          if (!haveCamo && camoKey) {
            if (!affordable(camoKey)) return
            if (tryPlace(camoKey)) continue
          }
          const marten = own.find(t => OP.TOWERS[t.key].base.camoDetect)
          if (marten && marten.s.damage < 2) {
            let bestCost = Infinity
            for (let p = 0; p <= 2; p++) {
              if (OP.Upgrades.canBuy(marten, p).ok) {
                const c = OP.Upgrades.nextCost(sim, marten, p)
                if (c < bestCost) bestCost = c
              }
            }
            if (bestCost !== Infinity) {
              if (bestCost <= sim.cash - 30) {
                for (let p = 0; p <= 2; p++) {
                  if (OP.Upgrades.canBuy(marten, p).ok && OP.Upgrades.nextCost(sim, marten, p) === bestCost) {
                    OP.Upgrades.buy(sim, marten, p)
                    break
                  }
                }
                continue
              }
              if (bestCost <= sim.cash + OP.Economy.roundBonus(sim, (sim.roundIndex || 0) + 1)) return
            }
          }
        }

        // The veiled+immune pairing: get the camo aura on the board and to Keen
        // Watch before the first Wraith arrives. Runs after the pure-immunity
        // reserve and before the farms so the ~4k milestone is neither starved
        // by farming nor trumped by a deepen nudge.
        if (auraStep()) continue

        /* WRAITH-BOUND: get a veiled-tolerant DPS tower inside the aura's radius
           before the era arrives. The build's native camo (marten) is sharp and
           the entry cluster sits far outside Keen's range, so a Wraith is only
           hurt by a non-sharp tower that overlaps the aura — and until one
           does, the veil-switch finds nobody to hand camo to (measured: shatter
           fox cluster at the entrance, aura mid-track, Wraith untouched, leak
           ~790 of 816). Runs only while the aura is already on the ground, and
           stops the moment any non-sharp attacker sits in its radius, so it
           places at most a couple of towers rather than spraying fresh ones. */
        if (supportAllowed && own.some(t => t.key === SUPPORT_KEY) && !wrathSolved()) {
          const wrathKey = attackers.find(k => {
            const d = OP.TOWERS[k]
            if (d.base.dmgType === 'sharp' || d.base.dmgType === 'explosive') return false
            return true
          })
          if (wrathKey && affordable(wrathKey)) { if (tryPlace(wrathKey)) continue }
        }

        // THEN deepen — CONCENTRATED, not round-robin. The mid-game towers cost too
        // much to dribble into: a 2-4-0 is ~3k, a round of RBE 1000+ needs real
        // towers, and a board whose deepen loop handed every dollar to whichever
        // tower came next in a round-robin measured straight until round 48 with
        // eleven 2-4-0/3-2-0 foxes and then stopped — every fox was at the same
        // plateau, none could buy the next step. So spend on the MOST invested
        // tower first, climbing whichever branch is already deepest.
        let bought = false
        // Income towers and the camo aura are managed by their own steps; the
        // deepen loop concentrates the carry budget on the ATTACKERS, so a big
        // farm never starves the tower that is actually popping the blimps.
        let byInvested = own.filter(t => !support(t))
          .slice().sort((a, b) => (b.invested || 0) - (a.invested || 0))

        // ...but concentrate the carry on a tower that can actually touch the
        // Wraith era. Left alone, "deepest first" builds acorn-fox, and a sharp
        // carry is exactly nothing against a sharp+explosive-immune blimp
        // (measured: 6181 of 7723 sharp lifetime pops; round 52 leaked the whole
        // 816-RBE Wraith). Once a non-sharp, non-explosive, veiled-tolerant
        // tower exists, the last six rounds before a Wraith go to IT instead.
        if (nonsharpLock(sim, (sim.roundIndex || 0) + 1, 6)) {
          let usable = byInvested.filter(t => t.s.dmgType !== 'sharp' && t.s.dmgType !== 'explosive')
          if (usable.length) byInvested = usable
          // Within the Wraith window the towers that MATTER are the ones the
          // aura can hand camo to — a veiled Wraith is only hurt by a non-sharp
          // tower sitting under the Keen aura, and the deep foxes parked at the
          // far end of the track stay blind. eepest-first still pours into
          // those (they are in the blimp's range), starving the camo-sink and
          // leaving the Wraith untouched (measured: shatter foxes under the
          // aura sat at 3-2-0 while one far fox was 4-2-0, leak ~689 of 816).
          // Feed the deepen EXCLUSIVELY to non-sharp towers already inside the
          // aura radius for the whole window; everything else stands down.
          const aura = own.find(t => t.key === SUPPORT_KEY && t.s.range)
          if (aura) {
            const auraR = (aura.s.range || 130) + 20
            const inAura = byInvested.filter(t =>
              OP.M.dist(t.x, t.y, aura.x, aura.y) <= auraR)
            if (inAura.length) byInvested = inAura
            // Within the in-aura set, shatter is the designed anti-Wraith tool
            // (the Wraith is immune to sharp AND explosive; shatter is the
            // conversion that the acorn-fox carry reaches). "Deepest first"
            // would pour the entire window into a high-invested acid/energy
            // tower and leave the shatter foxes at 3-2-0 (measured: sap-snail
            // climbed to 2-4-0 while every fox stayed 3-2-0, leak ~674). Climb
            // the shatter towers first, then the rest by investment.
            byInvested.sort((a, b) => {
              const sa = a.s.dmgType === OP.DMG.SHATTER ? 1 : 0
              const sb = b.s.dmgType === OP.DMG.SHATTER ? 1 : 0
              if (sa !== sb) return sb - sa
              return (b.invested || 0) - (a.invested || 0)
            })
          }
        }

        /* ...but FIRST hold a reserve for the next named milestone. The
           "spend every dollar" rule is what flatlines the board at round 48:
           every round's income went into a tier-1/2/3 nudge somewhere, so cash
           never sat still long enough to reach the 12,000 tier-5 that the
           exponential late curve actually pays for (round 40 = 616 RBE, round 50
           = 2160, round 60 = 7476). The fix is the SAME bounded-reserve
           doctrine as the unanswerableTiers check above: when the board's best
           tower has a tier-4/5 step in reach, go quiet and bank. Once banked it
           is spent by the deepen loop below as a lump. The hold is bounded —
           goalCost — so it cannot deadlock: round bonuses keep arriving until
           the step is affordable. */
        let goalCost = Infinity
        for (const tower of byInvested) {
          const order = [0, 1, 2].sort((a, b) => (tower.tiers[b] || 0) - (tower.tiers[a] || 0))
          for (let pi = 0; pi < order.length; pi++) {
            const path = order[pi]
            const tier = tower.tiers[path] || 0
            if (tier < 3) continue
            if (!OP.Upgrades.canBuy(tower, path).ok) continue
            goalCost = Math.min(goalCost, OP.Upgrades.nextCost(sim, tower, path))
            break
          }
          if (goalCost < 10000) break
        }
        if (goalCost !== Infinity && goalCost >= 10000 && (sim.roundIndex || 0) >= 40 && sim.cash - 30 < goalCost) return

        for (let n = 0; n < byInvested.length && !bought; n++) {
          const tower = byInvested[n]
          const order = [0, 1, 2].sort((a, b) => (tower.tiers[b] || 0) - (tower.tiers[a] || 0))
          for (let pi = 0; pi < order.length && !bought; pi++) {
            const path = order[pi]
            if (!OP.Upgrades.canBuy(tower, path).ok) continue
            if (OP.Upgrades.nextCost(sim, tower, path) > sim.cash - 30) continue
            if (OP.Upgrades.buy(sim, tower, path).ok) bought = true
          }
        }
        if (bought) continue

        /* FARM, taking only what the defenders left. The economy step runs
           LAST so the widen/deepen/aura milestones get first call on every
           dollar: it can no more starve the defence than the extra-copy
           fallback below, and it deepens the rails during exactly the windows
           the defenders pause (banking for a tier-5, or mid-gap) without
           racing them. A fresh leak still vetoes spending (the death-spiral
           guard from farmFirst), but a *gap* does not — an income step on a
           farm that already exists is 225-600 of surplus, and the bullet that
           would have popped the leak went to the defence first. */
        if (economyStep()) continue

        // During the Wraith window the deepen is concentrated on the in-aura
        // shatter towers; a fresh 0-0-0 copy is the OPPOSITE of that — it is a
        // sharp fox chassis that would need another 3-4k to be worth anything
        // against the blimp, and the copy-fallback was measured turning r47-52
        // surplus into 20+ 0-0-0 foxes while the shatter carry sat frozen at
        // 3-2-0 (leak ~689). Stand down and bank instead: the next shatter tier
        // is what actually clears the Wraith.
        if (nonsharpLock(sim, (sim.roundIndex || 0) + 1, 6)) return

        // Finally, another copy of a tower already earning its keep — cheapest
        // first, so the stack deepens on the workhorses rather than a fresh
        // family. The previous code bought the most expensive affordable NEW
        // tower here, which sprinkled one 0-0-0 of every family onto the board
        // and starved the towers that were actually popping (see the widen step).
        let added = false
        const ownedByCost = own.filter(t => !support(t))
          .slice().sort((a, b) => OP.TOWERS[a.key].cost - OP.TOWERS[b.key].cost)
        for (const t of ownedByCost) {
          if (OP.Economy.price(sim, OP.TOWERS[t.key].cost) > sim.cash - 30) continue
          if (tryPlace(t.key)) { added = true; break }
        }
        if (!added) return
      }
    }
  }
}

/** Deliberately inadequate: one cheap tower, never upgraded. */
function playBad (sim, map) {
  const spots = coverageSpots(map, 4)
  const allowed = OP.TOWER_ORDER.filter(k => OP.Economy.towerAllowed(sim, OP.TOWERS[k]))
  if (!allowed.length) return { placed: 0 }
  const cheapest = allowed.slice().sort((a, b) => OP.TOWERS[a].cost - OP.TOWERS[b].cost)[0]
  for (const s of spots) {
    if (!OP.Towers.canPlace(sim, cheapest, s.x, s.y).ok) continue
    if (OP.Towers.place(sim, cheapest, s.x, s.y)) return { placed: 1, spend: function () {} }
  }
  return { placed: 0, spend: function () {} }
}

/* ---------- running one game ---------- */

function runGame (mapKey, difficulty, mode, strategy, maxRounds) {
  const def = OP.MAPS[mapKey]
  let map = OP.Maps.build(def)
  const modeDef = OP.MODES[mode]
  if (modeDef && modeDef.rules && modeDef.rules.reversePaths && OP.Maps.reversePaths) {
    map = OP.Maps.reversePaths(map)
  }

  const sim = OP.Sim.create({
    map: map,
    seed: `${mapKey}|${difficulty}|${mode}`,
    difficulty: difficulty,
    mode: mode,
    roundSetKey: (modeDef && modeDef.roundSetKey) || 'standard'
  })

  const plan = strategy(sim, map)
  const last = Math.min(maxRounds, sim.rules.lastRound)

  let round = sim.rules.firstRound
  let stalled = 0
  const leaksByRound = {}

  while (round <= last && !sim.over) {
    OP.Rounds.begin(sim, round)
    const before = sim.stats.leaked
    const beforeLayers = sim.stats.layersPopped
    const beforeCash = sim.stats.cashEarned
    const res = OP.Sim.runRound(sim, 60 * 400)
    const leaked = sim.stats.leaked - before
    if (TRACE) {
      const def = OP.Rounds.definition(sim, round)
      const rbe = def ? OP.Rounds.roundRBE(def) : 0
      const invested = sim.towers.reduce((a, t) => a + (t.invested || 0), 0)
      console.log(`${round}\t${String(rbe).padStart(6)}\tlayers ${String(sim.stats.layersPopped - beforeLayers).padStart(6)}\tcash +${String(Math.round(sim.stats.cashEarned - beforeCash)).padStart(6)}\tinv ${String(Math.round(invested)).padStart(7)}\ttowers ${sim.towers.length}\tleaked ${leaked}`)
    }
    if (leaked > 0) leaksByRound[round] = leaked

    // A round that ends because the player DIED did not stall — runRound simply
    // stops when sim.over. Conflating the two reported every ordinary loss as a
    // hang, which buried the real signal.
    if (sim.over) break
    if (!res.completed) { stalled = round; break }
    if (plan.spend) plan.spend()
    round++
  }

  /* What the board actually looked like when it ended.
     The matrix can only say "leaked at round 24"; that number is equally
     consistent with a damage shortfall and with an immunity the board has no
     answer to, and those want opposite fixes. So record the roster, its damage
     types, its upgrade depth, and — decisively — whether any owned tower could
     damage each tier the round was sending. */
  const board = sim.towers.map(t => ({
    key: t.key,
    dmg: t.s.dmgType,
    paths: (t.tiers || []).join('-'),
    dealt: Math.round(t.pops || 0)
  }))
  const boardTypes = [...new Set(board.map(b => b.dmg))]
  const unanswerable = unanswerableTiers(sim, boardTypes, Math.min(round, last), 0)

  return {
    mapKey, difficulty, mode,
    placed: plan.placed,
    board, boardTypes, unanswerable,
    towers: sim.towers.length,
    reached: Math.min(round, last),
    target: last,
    survived: !sim.over || sim.outcome === 'won',
    outcome: sim.over ? sim.outcome : 'in-progress',
    lives: sim.lives,
    startLives: sim.rules.startLives,
    leaked: sim.stats.leaked,
    leaksByRound,
    popped: sim.stats.popped,
    cash: Math.round(sim.cash),
    earned: Math.round(sim.stats.cashEarned),
    ticks: sim.tick,
    stalled,
    checksum: OP.Sim.checksum(sim),
    note: plan.note || ''
  }
}

/* ---------- the matrix ---------- */

if (TRACE) {
  const maps = pickMaps()
  console.log(`trace: ${maps[0]} medium standard (rbe per round, board layers popped, cash earned, invested, towers)`)
  console.log('round\trbe\tboard\t\tcash\t\tinvest\t\ttowers\tleaked')
  runGame(maps[0], 'medium', 'standard', playReference, Math.min(60, MAX_ROUNDS))
  process.exit(0)
}

const maps = pickMaps()
const difficulties = OP.DIFFICULTY_ORDER || Object.keys(OP.DIFFICULTIES)
const KEY_MODES = ['standard', 'alternate-waves', 'half-cash', 'double-hp-blimps', 'purist']
const modes = has('--full') ? (OP.MODE_ORDER || Object.keys(OP.MODES)) : KEY_MODES

const results = []
const failures = []

function log (s) { if (!QUIET) console.log(s) }

/* Why did this board lose?
   "Leaked at round 24" does not distinguish a damage shortfall from an immunity
   the board cannot answer, and the two want opposite fixes — one is a tuning
   question, the other is a bug in whatever chose the towers. Print enough to
   tell them apart. */
function explain (r) {
  const byKey = {}
  for (const b of r.board) {
    const e = byKey[b.key] || (byKey[b.key] = { n: 0, dmg: b.dmg, dealt: 0, paths: [] })
    e.n++; e.dealt += b.dealt; e.paths.push(b.paths || '0-0-0')
  }
  const rows = Object.keys(byKey).map(k => ({ k, ...byKey[k] })).sort((a, b) => b.dealt - a.dealt)
  console.log(`        ${dim('types on board:')} ${r.boardTypes.join(', ')}`)
  console.log(`        ${dim('cash unspent:  ')} ${r.cash} ${dim(`(earned ${r.earned})`)}`)
  if (r.unanswerable.length) {
    console.log(`        ${red('NO ANSWER TO:  ')} ${r.unanswerable.join(', ')} ${dim('— immunity gap, not a tuning problem')}`)
  }
  for (const row of rows) {
    console.log(`        ${dim('·')} ${row.k.padEnd(22)} x${String(row.n).padEnd(3)} ${row.dmg.padEnd(9)} ${dim('pops')} ${String(row.dealt).padEnd(8)} ${dim(row.paths.join(' '))}`)
  }
}

log(`\n${bold('OVERPOP playthroughs')}`)
log(`${dim('maps       ')} ${maps.join(', ')}`)
log(`${dim('difficulty ')} ${difficulties.join(', ')}`)
log(`${dim('modes      ')} ${modes.join(', ')}`)
log(`${dim('rounds     ')} up to ${MAX_ROUNDS}\n`)

/* 1. A reference build must survive. */
log(bold('reference build must survive'))
for (const mapKey of maps) {
  for (const difficulty of difficulties) {
    for (const mode of modes) {
      if (OP.modeAllowedOn && !OP.modeAllowedOn(mode, difficulty)) continue
      const r = runGame(mapKey, difficulty, mode, playReference, MAX_ROUNDS)
      results.push(Object.assign({ kind: 'reference' }, r))
      const label = `${mapKey} · ${difficulty} · ${mode}`
      if (r.stalled) {
        failures.push(`${label}: round ${r.stalled} never completed — a round that cannot finish is a hang, not a difficulty`)
        log(`  ${red('STALL')} ${label} ${dim(`round ${r.stalled}`)}`)
      } else if (!r.survived) {
        failures.push(`${label}: leaked out at round ${r.reached} of ${r.target} (${r.leaked} RBE leaked)`)
        log(`  ${red('LOSS ')} ${label} ${dim(`round ${r.reached}/${r.target}, ${r.towers} towers`)}`)
        if (EXPLAIN) explain(r)
      } else {
        log(`  ${green('held ')} ${label} ${dim(`round ${r.reached}/${r.target}, ${r.towers} towers, ${r.lives}/${r.startLives} lives`)}`)
      }
    }
  }
}

/* 2. A bad build must NOT survive. Without this the matrix above could be
      satisfied by a game where nothing ever leaks. */
log(`\n${bold('inadequate build must leak')}`)
for (const mapKey of maps) {
  for (const difficulty of difficulties) {
    const r = runGame(mapKey, difficulty, 'standard', playBad, Math.min(MAX_ROUNDS, 40))
    results.push(Object.assign({ kind: 'inadequate' }, r))
    const label = `${mapKey} · ${difficulty} · one cheap tower`
    if (r.survived && r.leaked === 0) {
      failures.push(`${label}: held ${r.target} rounds with ONE unupgraded tower and leaked nothing — the game is too easy`)
      log(`  ${red('TOO EASY')} ${label}`)
    } else {
      log(`  ${green('leaked  ')} ${label} ${dim(`out at round ${r.reached}, ${r.leaked} RBE through`)}`)
    }
  }
}

/* 3. Determinism, spot-checked on the matrix itself. */
log(`\n${bold('determinism')}`)
let detOk = true
for (const mapKey of maps.slice(0, 2)) {
  const a = runGame(mapKey, 'medium', 'standard', playReference, Math.min(MAX_ROUNDS, 30))
  const b = runGame(mapKey, 'medium', 'standard', playReference, Math.min(MAX_ROUNDS, 30))
  if (a.checksum !== b.checksum) {
    detOk = false
    failures.push(`${mapKey}: two identical playthroughs produced different checksums (${a.checksum} vs ${b.checksum})`)
    log(`  ${red('DIVERGED')} ${mapKey}`)
  } else {
    log(`  ${green('stable  ')} ${mapKey} ${dim(`checksum ${a.checksum}`)}`)
  }
}

/* ---------- the report ---------- */

const refRuns = results.filter(r => r.kind === 'reference')
const held = refRuns.filter(r => r.survived && !r.stalled).length
const badRuns = results.filter(r => r.kind === 'inadequate')
const badLeaked = badRuns.filter(r => !(r.survived && r.leaked === 0)).length

const lines = []
lines.push('# Balance report')
lines.push('')
lines.push('Generated by `node tools/playthroughs.mjs`. Every number here comes from a real')
lines.push('headless playthrough of the shipped bundle, not from an estimate.')
lines.push('')
lines.push('## Method')
lines.push('')
lines.push('Two builds are played on one map per difficulty tier, across the difficulty and')
lines.push('mode matrix:')
lines.push('')
lines.push('- **Reference build** — spend everything, spread coverage along the whole track,')
lines.push('  upgrade what is already covering it before widening, keep a small cash reserve.')
lines.push('  Not a clever build; the build a competent player converges on.')
lines.push('- **Inadequate build** — one cheap tower, never upgraded.')
lines.push('')
lines.push('The reference build must hold. The inadequate build must leak. Asserting only the')
lines.push('first would be satisfied by a game where nothing can ever leak.')
lines.push('')
lines.push('## Results')
lines.push('')
lines.push(`- reference builds that held: **${held} of ${refRuns.length}**`)
lines.push(`- inadequate builds that leaked (as they must): **${badLeaked} of ${badRuns.length}**`)
lines.push(`- determinism: **${detOk ? 'stable' : 'DIVERGED'}**`)
lines.push('')
lines.push('| map | difficulty | mode | reached | towers | lives | leaked | popped | earned |')
lines.push('|---|---|---|---|---:|---:|---:|---:|---:|')
for (const r of refRuns) {
  lines.push(`| ${r.mapKey} | ${r.difficulty} | ${r.mode} | ${r.reached}/${r.target} | ${r.towers} | ${r.lives}/${r.startLives} | ${r.leaked} | ${r.popped} | ${r.earned} |`)
}
lines.push('')
lines.push('## Where the reference build bled')
lines.push('')
lines.push('Rounds that got something through, per configuration. A round appearing across')
lines.push('many configurations is a spike worth retuning; one appearing in a single hard')
lines.push('mode is working as intended.')
lines.push('')
const spikeCount = {}
for (const r of refRuns) {
  for (const round of Object.keys(r.leaksByRound)) {
    spikeCount[round] = (spikeCount[round] || 0) + 1
  }
}
const spikes = Object.keys(spikeCount).map(Number).sort((a, b) => spikeCount[b] - spikeCount[a])
if (!spikes.length) {
  lines.push('No configuration leaked at all with the reference build.')
} else {
  lines.push('| round | configurations that leaked here |')
  lines.push('|---:|---:|')
  for (const round of spikes.slice(0, 20)) lines.push(`| ${round} | ${spikeCount[round]} |`)
}
lines.push('')
lines.push('## Inadequate build')
lines.push('')
lines.push('| map | difficulty | out at round | RBE through |')
lines.push('|---|---|---:|---:|')
for (const r of badRuns) {
  lines.push(`| ${r.mapKey} | ${r.difficulty} | ${r.reached} | ${r.leaked} |`)
}
lines.push('')
if (failures.length) {
  lines.push('## Open balance problems')
  lines.push('')
  for (const f of failures) lines.push(`- ${f}`)
  lines.push('')
}

const reportPath = resolve(ROOT, REPORT)
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, lines.join('\n') + '\n')

log(`\n${dim('report')} ${REPORT}`)
log(failures.length
  ? `${red(`${failures.length} balance problem(s)`)}\n  ${failures.slice(0, 10).map(f => '- ' + f).join('\n  ')}`
  : green(`all ${refRuns.length} reference runs held, all ${badRuns.length} inadequate runs leaked, determinism stable`))

process.exit(failures.length ? 1 : 0)

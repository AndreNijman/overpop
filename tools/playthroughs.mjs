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
// hundred rounds by hand across four difficulties and eleven modes is not a thing
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

/* ---------- the reference build ----------
   Not a clever build. A build a competent player would arrive at: spend everything,
   spread coverage along the whole track, invest in a few towers rather than many,
   and keep an answer to camo and to lead on the board. If the game cannot be held
   with this, the game is too hard; if it can be held with the bad build below, it
   is too easy. */

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
 *  3. INVEST DEEPLY, round-robin. Upgrading one tower to 5-2-0 beats nudging twelve
 *     to tier 1, and always upgrading the FIRST eligible tower starves the rest.
 *
 * With resources this holds every map to round 40 with zero leaks (measured), so
 * where it now fails, the constraint is the economy rather than the geometry.
 */
function playReference (sim, map) {
  const spots = coverageSpots(map, 40)
  const allowed = OP.TOWER_ORDER.filter(k => OP.Economy.towerAllowed(sim, OP.TOWERS[k]))
  if (!allowed.length) return { placed: 0, note: 'no tower family is allowed in this mode' }

  const byCost = allowed.slice().sort((a, b) => OP.TOWERS[a].cost - OP.TOWERS[b].cost)
  const own = []
  let placed = 0
  let upgradeCursor = 0

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
    for (const t of own) have[t.s.dmgType] = true
    return have
  }

  /**
   * The cheapest attacker whose damage type is absent from the board, whether or
   * not it can be afforded right now. Returns null when every type is covered.
   */
  function missingTypeTower () {
    const have = ownedTypes()
    for (const key of byCost) {
      if (!attacks(key)) continue
      if (!have[OP.TOWERS[key].base.dmgType]) return key
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
    // 3. anything not yet on the board
    for (const key of byCost) {
      if (!affordable(key)) continue
      if (!own.some(t => t.key === key)) return key
    }
    return null
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
        // Widen the roster first while anything is still missing — that is how the
        // camo and blimp answers get onto the board before they are needed.
        const missing = nextMissing()
        if (missing && tryPlace(missing)) continue

        /* SAVE for a damage type the board does not have.
           Without this the bot spent every dollar on whatever cheap tier-1/2
           upgrade came next, so cash never reached the price of the first
           explosive tower — measured: 4835 earned by round 24 with never more
           than ~120 in hand, and a board still carrying only sharp and acid.
           It then met Lead, which no sharp tower can pop, and died. That reads
           as a difficulty spike and is nothing of the kind: it is the bot
           refusing to hold a reserve.

           A competent player saves for the answer they know is coming, so the
           bot must too — otherwise the matrix measures the bot's impatience
           rather than the game. Only hold when the gap is a real one and the
           reserve is actually reachable, so this can never deadlock: round
           bonuses keep arriving, and once the tower is affordable the branch
           above buys it. */
        const gap = missingTypeTower()
        if (gap && !affordable(gap)) return

        // Then deepen, round-robin so investment spreads across the board rather
        // than piling onto whichever tower happens to be first in the list.
        let bought = false
        for (let n = 0; n < own.length && !bought; n++) {
          const tower = own[(upgradeCursor + n) % own.length]
          for (let path = 0; path < 3; path++) {
            if (!OP.Upgrades.canBuy(tower, path).ok) continue
            if (OP.Upgrades.nextCost(sim, tower, path) > sim.cash - 30) continue
            if (OP.Upgrades.buy(sim, tower, path).ok) {
              bought = true
              upgradeCursor = (upgradeCursor + n + 1) % own.length
              break
            }
          }
        }
        if (bought) continue

        // Finally, more of whatever is affordable.
        let added = false
        for (let i = byCost.length - 1; i >= 0; i--) {
          if (OP.Economy.price(sim, OP.TOWERS[byCost[i]].cost) > sim.cash - 30) continue
          if (tryPlace(byCost[i])) { added = true; break }
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
    const res = OP.Sim.runRound(sim, 60 * 400)
    const leaked = sim.stats.leaked - before
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
  const lastRoundDef = OP.Rounds.definition(sim, Math.min(round, last))
  const unanswerable = [...new Set((lastRoundDef.groups || []).map(g => g.tier))]
    .filter(tier => tier && !boardTypes.some(ty => OP.canDamage(tier, ty)))

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

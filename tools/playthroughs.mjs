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
  // Sample points along every path, then step off the track to find legal ground.
  const spots = []
  const paths = map.paths
  const perPath = Math.max(2, Math.ceil(count / paths.length))
  for (let p = 0; p < paths.length; p++) {
    const track = paths[p]
    for (let i = 0; i < perPath; i++) {
      const t = (i + 0.5) / perPath * track.length
      const at = track.posAt(t)
      const ang = track.angleAt(t)
      // Try both sides, increasing distance, until something is placeable.
      for (const side of [1, -1]) {
        for (let d = 34; d <= 130; d += 12) {
          spots.push({
            x: OP.M.clamp(at.x + Math.cos(ang + Math.PI / 2) * d * side, 24, OP.FIELD_W - 24),
            y: OP.M.clamp(at.y + Math.sin(ang + Math.PI / 2) * d * side, 24, OP.FIELD_H - 24)
          })
        }
      }
    }
  }
  return spots
}

/** Buy whatever fits, cheapest-useful-first, upgrading as cash allows. */
function playReference (sim, map) {
  const spots = coverageSpots(map, 26)
  const allowed = OP.TOWER_ORDER.filter(k => OP.Economy.towerAllowed(sim, OP.TOWERS[k]))
  if (!allowed.length) return { placed: 0, note: 'no tower family is allowed in this mode' }

  // Cheapest first so the early rounds get covered at all, then the strongest the
  // player can afford as cash accumulates.
  const byCost = allowed.slice().sort((a, b) => OP.TOWERS[a].cost - OP.TOWERS[b].cost)

  let placed = 0
  let spotIndex = 0
  const own = []

  function tryPlace (key) {
    while (spotIndex < spots.length) {
      const s = spots[spotIndex++]
      if (!OP.Towers.canPlace(sim, key, s.x, s.y).ok) continue
      const tower = OP.Towers.place(sim, key, s.x, s.y)
      if (tower) { own.push(tower); placed++; return tower }
    }
    return null
  }

  // Opening: a handful of cheap towers so round 1 is covered.
  for (let i = 0; i < 4; i++) tryPlace(byCost[i % Math.min(3, byCost.length)])

  return {
    placed: placed,
    own: own,
    // Called between rounds: reinvest.
    spend: function () {
      let guard = 0
      for (;;) {
        if (++guard > 40) return
        // Prefer upgrading what is already covering the track.
        let bought = false
        for (const tower of own) {
          for (let path = 0; path < 3; path++) {
            const legal = OP.Upgrades.canBuy(tower, path)
            if (!legal.ok) continue
            const cost = OP.Upgrades.nextCost(sim, tower, path)
            // Keep a reserve so a sudden blimp round is not met with an empty bank.
            if (cost > sim.cash - 150) continue
            if (OP.Upgrades.buy(sim, tower, path).ok) { bought = true; break }
          }
          if (bought) break
        }
        if (bought) continue

        // Otherwise widen coverage with the best tower affordable.
        let addedOne = false
        for (let i = byCost.length - 1; i >= 0; i--) {
          const key = byCost[i]
          if (OP.Economy.price(sim, OP.TOWERS[key].cost) > sim.cash - 150) continue
          if (tryPlace(key)) { addedOne = true; break }
        }
        if (!addedOne) return
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

    if (!res.completed) { stalled = round; break }
    if (sim.over) break
    if (plan.spend) plan.spend()
    round++
  }

  return {
    mapKey, difficulty, mode,
    placed: plan.placed,
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

import { loadGame } from './loadgame.mjs'
import { playReference } from './playthroughs.mjs'

const { OP } = loadGame({})

for (const mapKey of ['fernway-hollow', 'twinbrook-fork', 'bramble-gap']) {
  const def = OP.MAPS[mapKey]
  const map = OP.Maps.build(def)
  const sim = OP.Sim.create({ map, seed: `${mapKey}|medium|standard`, difficulty: 'medium', mode: 'standard', roundSetKey: 'standard' })
  const plan = playReference(sim, map)
  const last = Math.min(60, sim.rules.lastRound)
  let round = sim.rules.firstRound
  while (round <= last && !sim.over) {
    OP.Rounds.begin(sim, round)
    const res = OP.Sim.runRound(sim, 60 * 400)
    if (sim.over) break
    if (!res.completed) break
    if (plan.spend) plan.spend()
    round++
  }
  const aura = sim.towers.find(t => t.key === 'warren-hall')
  console.log(`\n== ${mapKey} reached ${round} lives ${sim.lives}`)
  if (aura) {
    console.log(`AURA ${aura.tiers.join('-')} xy ${Math.round(aura.x)},${Math.round(aura.y)} range=${aura.s.range}`)
  } else {
    console.log('AURA none')
  }
  const paths = map.paths.map(p => p.length)
  console.log('path lengths', paths.map(p => Math.round(p)).join(', '))
  for (const t of sim.towers) {
    const inAura = aura ? OP.M.dist(t.x, t.y, aura.x, aura.y) <= (aura.s.range || 130) + 20 : false
    console.log(`  ${t.key.padEnd(14)} ${t.tiers.join('-')} inv ${(t.invested || 0).toFixed(0).padStart(7)} dmg ${t.s.dmgType.padEnd(9)} xy ${Math.round(t.x)},${Math.round(t.y)}${inAura ? ' IN-AURA' : ''}`)
  }
}
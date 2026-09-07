import { loadGame } from './loadgame.mjs'

const { OP } = loadGame({})

function coverageAt (map, x, y, radius) {
  let hit = 0
  let total = 0
  for (const p of map.paths) {
    const n = 12
    for (let i = 0; i < n; i++) {
      const a = p.posAt(i / n * p.length)
      const b = p.posAt((i + 1) / n * p.length)
      const seg = OP.M.dist(a.x, a.y, b.x, b.y)
      total += seg
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      if (OP.M.dist(mx, my, x, y) <= radius) hit += seg
    }
  }
  return total ? hit / total : 0
}

for (const mk of ['fernway-hollow', 'twinbrook-fork', 'bramble-gap']) {
  const map = OP.Maps.build(OP.MAPS[mk])
  const len = map.paths.map(p => Math.round(p.length))
  console.log(`\n== ${mk} len=${len.join('/')}`)
  for (const [x, y] of [[91, 49], [374, 169], [107, 273], [600, 340]]) {
    const r175 = coverageAt(map, x, y, 175)
    const r220 = coverageAt(map, x, y, 220)
    const r260 = coverageAt(map, x, y, 260)
    console.log(`  @(${x},${y})  r175=${(r175*100).toFixed(0)}%  r220=${(r220*100).toFixed(0)}%  r260=${(r260*100).toFixed(0)}%`)
  }
}
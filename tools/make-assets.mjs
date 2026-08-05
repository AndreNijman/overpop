#!/usr/bin/env node
// Generates every binary asset the site ships, from code.
//
//   node tools/make-assets.mjs            everything
//   node tools/make-assets.mjs --icons    just the PWA icons
//   node tools/make-assets.mjs --og       just the share image
//   node tools/make-assets.mjs --shot     just the games-hub screenshot
//
// No image files are committed by hand and no design tool is involved: the icons
// and the share image are drawn on a canvas in a throwaway HTML page, and the hub
// screenshot is a capture of the real game actually playing. Everything is
// reproducible by re-running this script, which is the point — a hand-made PNG in
// a repo with no source is a dead end the next person cannot edit.
//
// The hub screenshot MUST be 1000x525: games.andrenijman.com styles its cards with
// `aspect-ratio: 1000 / 525`, and topout.png and defenders.png are both that size.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tty = process.stdout.isTTY
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const dim = s => c(2, s), bold = s => c(1, s)
const green = s => c(32, s), red = s => c(31, s)

const argv = process.argv.slice(2)
const only = f => argv.includes(f)
const doAll = !only('--icons') && !only('--og') && !only('--shot')

function findChrome () {
  const pinned = resolve(ROOT, 'tools/.chrome-path')
  if (existsSync(pinned)) {
    const p = readFileSync(pinned, 'utf8').trim()
    if (p && existsSync(p)) return p
  }
  for (const p of [
    process.env.CHROME_PATH,
    `${process.env.HOME}/.local/bin/chrome-headless-shell`,
    '/usr/bin/chromium', '/usr/bin/google-chrome'
  ]) if (p && existsSync(p)) return p
  return null
}

const CHROME = findChrome()
if (!CHROME) {
  console.error(red('no browser found. Set CHROME_PATH or write a path into tools/.chrome-path'))
  process.exit(2)
}

/* ---------- shared visual language ---------- */

const PALETTE = {
  bg: '#0e1410',
  deep: '#070a08',
  moss: '#6fae7f',
  ink: '#e8efe6',
  warm: '#c9a227',
  red: '#c9342f',
  blue: '#3a7fd5'
}

/**
 * The OVERPOP mark: a cluster of balloons with a bite taken out of one, over the
 * game's dark ground. Drawn from the same palette as the game so the icon and the
 * running game read as one thing.
 */
const MARK_JS = `
function drawMark (ctx, size, withWordmark) {
  const P = ${JSON.stringify(PALETTE)}
  const s = size / 512

  ctx.fillStyle = P.deep
  ctx.fillRect(0, 0, size, size)

  // A soft ground glow, so the mark is not a flat square at small sizes.
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.66)
  g.addColorStop(0, '#1a2620')
  g.addColorStop(1, P.deep)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  function balloon (cx, cy, r, fill, shade, popped) {
    ctx.save()
    ctx.translate(cx, cy)
    // Body
    ctx.beginPath()
    if (popped) {
      // A torn balloon: an arc with a jagged bite out of the upper right.
      ctx.moveTo(0, r)
      ctx.arc(0, 0, r, Math.PI * 0.5, Math.PI * 1.85, false)
      const tear = [[0.72, -0.62], [0.34, -0.36], [0.78, -0.16], [0.42, 0.1], [0.86, 0.3]]
      for (const [tx, ty] of tear) ctx.lineTo(tx * r, ty * r)
      ctx.closePath()
    } else {
      ctx.ellipse(0, 0, r * 0.92, r, 0, 0, Math.PI * 2)
    }
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = shade
    ctx.lineWidth = Math.max(1.5, r * 0.10)
    ctx.stroke()

    // Highlight
    ctx.beginPath()
    ctx.ellipse(-r * 0.28, -r * 0.34, r * 0.24, r * 0.32, -0.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fill()

    // Knot
    ctx.beginPath()
    ctx.moveTo(-r * 0.14, r * 0.98)
    ctx.lineTo(r * 0.14, r * 0.98)
    ctx.lineTo(0, r * 1.2)
    ctx.closePath()
    ctx.fillStyle = shade
    ctx.fill()
    ctx.restore()
  }

  const cx = size * 0.5
  const cy = size * (withWordmark ? 0.40 : 0.44)
  balloon(cx - 108 * s, cy + 40 * s, 84 * s, P.blue, '#25548f', false)
  balloon(cx + 104 * s, cy + 52 * s, 76 * s, P.moss, '#3f7a55', false)
  balloon(cx, cy - 34 * s, 112 * s, P.red, '#8e211d', true)

  // Pop shards from the torn one.
  ctx.fillStyle = P.warm
  for (let i = 0; i < 7; i++) {
    const a = -0.55 + i * 0.16
    const d = (150 + (i % 3) * 34) * s
    const r = (7 + (i % 3) * 3) * s
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * d, cy - 34 * s + Math.sin(a) * d, r, 0, Math.PI * 2)
    ctx.fill()
  }

  if (withWordmark) {
    ctx.fillStyle = P.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 ' + Math.round(size * 0.115) + 'px ui-monospace, monospace'
    ctx.letterSpacing = Math.round(size * 0.022) + 'px'
    ctx.fillText('OVERPOP', cx + size * 0.011, size * 0.775)
    ctx.fillStyle = P.moss
    ctx.font = '400 ' + Math.round(size * 0.042) + 'px ui-monospace, monospace'
    ctx.letterSpacing = Math.round(size * 0.008) + 'px'
    ctx.fillText('tower defense', cx, size * 0.875)
  }
}
`

/** Render an HTML page at an exact size and write the PNG. */
function shoot (html, width, height, outPath) {
  const dir = mkdtempSync(resolve(tmpdir(), 'overpop-asset-'))
  const page = resolve(dir, 'page.html')
  writeFileSync(page, html)
  mkdirSync(dirname(outPath), { recursive: true })

  return new Promise((res, rej) => {
    const proc = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars',
      `--user-data-dir=${dir}/profile`,
      `--window-size=${width},${height}`,
      `--screenshot=${outPath}`,
      '--default-background-color=00000000',
      `--virtual-time-budget=2500`,
      'file://' + page
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('exit', code => {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
      if (existsSync(outPath)) res(outPath)
      else rej(new Error(`chrome exited ${code}: ${err.slice(-400)}`))
    })
  })
}

/** Read a PNG's dimensions from its IHDR chunk — no image library needed. */
function pngSize (path) {
  const buf = readFileSync(path)
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length }
}

function canvasPage (width, height, body) {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${PALETTE.deep};overflow:hidden}
canvas{display:block}</style>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
${MARK_JS}
const ctx = document.getElementById('c').getContext('2d')
${body}
</script>`
}

/* ---------- icons ---------- */

async function makeIcons () {
  const out = []
  for (const size of [192, 512]) {
    const path = resolve(ROOT, `icons/icon-${size}.png`)
    await shoot(canvasPage(size, size, `drawMark(ctx, ${size}, false)`), size, size, path)
    const dim2 = pngSize(path)
    if (!dim2 || dim2.w !== size || dim2.h !== size) {
      throw new Error(`icon-${size}.png is ${dim2 ? dim2.w + 'x' + dim2.h : 'unreadable'}, expected ${size}x${size}`)
    }
    console.log(`  ${green('ok')} icons/icon-${size}.png ${dim(`${dim2.w}x${dim2.h}, ${(dim2.bytes / 1024).toFixed(1)}kB`)}`)
    out.push(path)
  }
  return out
}

/* ---------- share image ---------- */

async function makeOg () {
  const W = 1200, H = 630
  const path = resolve(ROOT, 'og-image.png')
  const body = `
    const P = ${JSON.stringify(PALETTE)}
    ctx.fillStyle = P.deep
    ctx.fillRect(0, 0, ${W}, ${H})
    const g = ctx.createLinearGradient(0, 0, ${W}, ${H})
    g.addColorStop(0, '#16211a')
    g.addColorStop(1, P.deep)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, ${W}, ${H})

    // The mark, drawn into the left third at icon proportions.
    ctx.save()
    ctx.translate(40, ${H / 2} - 210)
    ctx.beginPath(); ctx.rect(0, 0, 420, 420); ctx.clip()
    drawMark(ctx, 420, false)
    ctx.restore()

    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = P.ink
    ctx.font = '600 88px ui-monospace, monospace'
    ctx.letterSpacing = '10px'
    ctx.fillText('OVERPOP', 500, 250)

    ctx.fillStyle = P.moss
    ctx.font = '400 30px ui-monospace, monospace'
    ctx.letterSpacing = '1px'
    ctx.fillText('A free browser tower defense game', 500, 306)

    ctx.fillStyle = '#9c9282'
    ctx.font = '400 24px ui-monospace, monospace'
    ctx.letterSpacing = '0px'
    const lines = [
      '25 critter towers · 3-branch upgrade trees',
      '100 rounds · 16 maps · heroes · paragons',
      'eleven modes, including PURIST'
    ]
    lines.forEach(function (t, i) { ctx.fillText(t, 500, 366 + i * 38) })

    ctx.strokeStyle = 'rgba(111,174,127,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(500, 500); ctx.lineTo(760, 500); ctx.stroke()

    ctx.fillStyle = P.moss
    ctx.font = '400 26px ui-monospace, monospace'
    ctx.fillText('overpop.andrenijman.com', 500, 552)
  `
  await shoot(canvasPage(W, H, body), W, H, path)
  const d = pngSize(path)
  if (!d || d.w !== W || d.h !== H) throw new Error(`og-image.png is ${d ? d.w + 'x' + d.h : 'unreadable'}, expected ${W}x${H}`)
  console.log(`  ${green('ok')} og-image.png ${dim(`${d.w}x${d.h}, ${(d.bytes / 1024).toFixed(1)}kB`)}`)
  return path
}

/* ---------- the games-hub screenshot ----------
   A capture of the game actually playing, not a mockup. Exactly 1000x525 to match
   topout.png and defenders.png, which the hub's card CSS depends on. */

async function makeShot () {
  const W = 1000, H = 525
  const path = resolve(ROOT, 'docs/overpop-hub-shot.png')
  mkdirSync(dirname(path), { recursive: true })

  const dir = mkdtempSync(resolve(tmpdir(), 'overpop-shot-'))
  const page = resolve(dir, 'shot.html')
  // A wrapper that boots the real game in an iframe sized to the capture, plays a
  // few rounds so the board has towers and balloons on it, then holds still.
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${PALETTE.deep};overflow:hidden;width:${W}px;height:${H}px}
iframe{border:0;width:${W}px;height:${H}px;display:block}</style>
<iframe id="f" src="${'file://' + resolve(ROOT, 'index.html')}"></iframe>
<script>
  const f = document.getElementById('f')
  f.addEventListener('load', function () {
    const w = f.contentWindow
    let tries = 0
    const t = setInterval(function () {
      if (++tries > 60) return clearInterval(t)
      if (!w.OP || !w.OP.Test || !w.OP.Test.autoplay) return
      clearInterval(t)
      try { w.OP.Test.autoplay(6) } catch (e) {}
    }, 100)
  })
</script>`)

  await new Promise((res, rej) => {
    const proc = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
      '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files',
      `--user-data-dir=${dir}/profile`,
      `--window-size=${W},${H}`,
      `--screenshot=${path}`,
      '--virtual-time-budget=9000',
      'file://' + page
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('exit', code => {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
      if (existsSync(path)) res(path)
      else rej(new Error(`chrome exited ${code}: ${err.slice(-400)}`))
    })
  })

  const d = pngSize(path)
  if (!d || d.w !== W || d.h !== H) {
    throw new Error(`hub shot is ${d ? d.w + 'x' + d.h : 'unreadable'}, expected exactly ${W}x${H} — ` +
      'the hub card CSS uses aspect-ratio: 1000 / 525')
  }
  // A screenshot of a blank canvas is the failure this catches: a 1000x525 PNG of
  // flat background compresses to almost nothing.
  if (d.bytes < 12000) {
    throw new Error(`hub shot is only ${d.bytes} bytes — that is a blank or nearly blank frame, not a game`)
  }
  console.log(`  ${green('ok')} docs/overpop-hub-shot.png ${dim(`${d.w}x${d.h}, ${(d.bytes / 1024).toFixed(1)}kB`)}`)
  return path
}

/* ---------- run ---------- */

async function main () {
  console.log(`\n${bold('OVERPOP assets')} ${dim(CHROME)}\n`)
  const made = []
  try {
    if (doAll || only('--icons')) made.push(...await makeIcons())
    if (doAll || only('--og')) made.push(await makeOg())
    if (doAll || only('--shot')) made.push(await makeShot())
  } catch (e) {
    console.error(`\n${red('failed:')} ${e.message}`)
    process.exit(1)
  }
  console.log(`\n${green(`${made.length} asset(s) generated`)}\n`)
}

main()

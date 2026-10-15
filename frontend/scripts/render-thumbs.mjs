/**
 * Renders the catalog thumbnails (protocol §15 "Thumbnails") with the real engine in headless Chromium and writes
 * them to backend/internal/catalog/assets/thumbs/<id>.png, which the server embeds and serves at
 * /catalog/thumbs/<id>.png; a metal plate also gets <id>-metal.png, the plate itself (dev/plate-harness.html).
 * (§16) A procedural layer with `animThumb` also gets <id>-anim.jpg, a looping strip of `animFrames` frames
 * (dev/anim-harness.html) that the phone's live gallery animates.
 * Run after changing a gobo, a plate or a procedural layer: `npm run thumbs` (or `npm run thumbs -- plate-` for the
 * ids that contain `plate-`, `npm run thumbs -- -anim` for the strips only, `=<id>` for exactly one id).
 * Never opens a window (headless only).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = resolve(root, 'backend/internal/catalog/assets/thumbs')
const catalog = JSON.parse(readFileSync(resolve(root, 'contract/catalog.json'), 'utf8'))
const port = Number(process.env.THUMBS_PORT ?? 5497)
const W = 384, H = 216

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: resolve(here, '..'), stdio: 'ignore' })
const stop = () => vite.kill('SIGTERM')
process.on('exit', stop)
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/dev/render-harness.html`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('page error:', e.message))
  const jobs = [
    ...catalog.gobos.map((g) => ({ id: g.id, q: `gobo=${g.id}` })),
    // (plates) the metal plate itself: a grey disc with its cut-outs, on a transparent ground
    ...catalog.gobos.filter((g) => g.metalThumb).map((g) => ({ id: g.metalThumb.replace(/^thumbs\/|\.png$/g, ''), q: `plate=${g.id}`, page: 'plate-harness' })),
    // lightning flashes at 6.55 s; everything else is mid-motion at 7.5 s
    ...catalog.procedural.map((p) => ({ id: p.id, q: `proc=${p.id}&clock=${p.id === 'lightning' ? 6.55 : 7.5}` })),
    // (§16) the animated strips: a 3 s loop around the still's moment (lightning: a window with a flash in it)
    ...catalog.procedural
      .filter((p) => p.animThumb)
      .map((p) => ({ id: `${p.id}-anim`, file: p.animThumb.replace(/^thumbs\//, ''), q: `proc=${p.id}&frames=${p.animFrames ?? 36}&fps=${p.animFps ?? 12}&w=192&h=108&clock=${p.id === 'lightning' ? 5.2 : 7.5}`, page: 'anim-harness', strip: true })),
  ]
  const only = process.argv.slice(2)
  for (const j of jobs.filter((j) => !only.length || only.some((o) => (o.startsWith('=') ? j.id === o.slice(1) : j.id.includes(o))))) {
    await page.goto(`http://localhost:${port}/dev/${j.page ?? 'render-harness'}.html?${j.strip ? '' : `w=${W}&h=${H}&`}${j.q}`)
    await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 })
    if (j.strip) {
      const url = await page.evaluate(() => window.__strip)
      writeFileSync(resolve(out, j.file), Buffer.from(url.split(',')[1], 'base64'))
    } else writeFileSync(resolve(out, `${j.id}.png`), await page.locator('#c').screenshot({ omitBackground: !!j.page }))
    console.log('thumb', j.id)
  }
  await browser.close()
} finally {
  stop()
}

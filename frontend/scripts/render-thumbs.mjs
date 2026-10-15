/**
 * Renders the catalog thumbnails (protocol §15 "Thumbnails") with the real engine in headless Chromium and writes
 * them to backend/internal/catalog/assets/thumbs/<id>.png, which the server embeds and serves at
 * /catalog/thumbs/<id>.png. Run after changing a gobo or a procedural layer: `npm run thumbs`.
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
    // lightning flashes at 6.55 s; everything else is mid-motion at 7.5 s
    ...catalog.procedural.map((p) => ({ id: p.id, q: `proc=${p.id}&clock=${p.id === 'lightning' ? 6.55 : 7.5}` })),
  ]
  for (const j of jobs) {
    await page.goto(`http://localhost:${port}/dev/render-harness.html?w=${W}&h=${H}&${j.q}`)
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 })
    writeFileSync(resolve(out, `${j.id}.png`), await page.locator('#c').screenshot())
    console.log('thumb', j.id)
  }
  await browser.close()
} finally {
  stop()
}

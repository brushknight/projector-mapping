/**
 * Render perf checks in headless Chromium (dev/perf-harness.html), one browser, never a window: `npm run perf`.
 * Prints plate switch times and frame times at the phone's preview size and at 1080p. `-- --json` prints JSON.
 * Swiftshader (software GL) is slow in absolute terms; the numbers compare before and after on one machine.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PERF_PORT ?? 5498)
const apiPort = Number(process.env.PERF_API_PORT ?? 7497)
// the mock server serves the catalog files (plate masks) the engine fetches; never the real server on :7400
const mock = spawn('node', ['dev/mock-server.mjs'], { cwd: resolve(here, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(apiPort) } })
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: resolve(here, '..'), stdio: 'ignore', env: { ...process.env, PROJMAP_API: `http://localhost:${apiPort}` } })
const stop = () => {
  vite.kill('SIGTERM')
  mock.kill('SIGTERM')
}
process.on('exit', stop)
const runs = [
  { name: 'switch plate, /out 1080p', q: 'w=1920&h=1080&test=switch&n=6' },
  { name: 'switch plate, /out 1080p, small masks prefetched', q: 'w=1920&h=1080&test=switch&n=6&warm=1' },
  { name: 'switch plate, phone hero (preview)', q: 'w=720&h=405&preview=1&test=switch&n=6' },
  { name: 'frame, /out 1080p, sharp', q: 'w=1920&h=1080&test=frame&scenario=sharp&n=20' },
  { name: 'frame, /out 1080p, soft focus', q: 'w=1920&h=1080&test=frame&scenario=soft&n=20' },
  { name: 'frame, /out 1080p, live soft', q: 'w=1920&h=1080&test=frame&scenario=live-soft&n=20' },
  { name: 'frame, phone hero 1110 (old /preview), live soft', q: 'w=1110&h=624&test=frame&scenario=live-soft&n=30' },
  { name: 'frame, phone hero 720 (preview), live soft', q: 'w=720&h=405&preview=1&test=frame&scenario=live-soft&n=30' },
  { name: 'frame, phone hero 720 (preview), soft', q: 'w=720&h=405&preview=1&test=frame&scenario=soft&n=30' },
]
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const out = []
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/dev/perf-harness.html`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const run of runs.filter((r) => !only.length || only.some((o) => r.name.includes(o)))) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(`http://localhost:${port}/dev/perf-harness.html?${run.q}`)
    await page.waitForFunction(() => window.__done === true, null, { timeout: 300000 })
    const res = await page.evaluate(() => window.__result)
    out.push({ name: run.name, ...res })
    console.log(run.name.padEnd(52), res.error ?? (res.frameMs !== undefined ? `${res.frameMs.toFixed(1)} ms/frame` : `${res.shown !== undefined ? `new plate on screen ${res.shown.toFixed(0)} ms, ` : ''}full mask median ${res.median.toFixed(0)} ms, max ${res.max.toFixed(0)} ms  ${JSON.stringify(res.times)}`))
    await page.close()
  }
  await browser.close()
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2))
} finally {
  stop()
}

/**
 * Pre-renders every plate's mask (protocol §16 "Plate masks") with the web engine's vector path in headless Chromium
 * and writes one-channel PNGs to backend/internal/catalog/assets/masks/<id>-<size>.png at 4096 (projector outputs),
 * 2048 (the editor) and 1024 (previews and tiles), each rasterized at its size. The server embeds
 * them and serves them at /catalog/masks/<id>-<size>.png with immutable cache headers; renderers decode them off the
 * main thread and fall back to the vector path when one is missing (a reshaped window always draws its own).
 * Run after changing a plate: `npm run masks` (or `npm run masks -- plate-stars` for ids that contain it).
 * Writes frontend/src/render/plates/maskIndex.ts, the list the renderers check before fetching. Never opens a window (headless only).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = resolve(root, 'backend/internal/catalog/assets/masks')
const catalog = JSON.parse(readFileSync(resolve(root, 'contract/catalog.json'), 'utf8'))
const port = Number(process.env.MASKS_PORT ?? 5495)
const TIERS = [4096, 2048, 1024]

/** CRC-32 for PNG chunks. */
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/**
 * An 8-bit greyscale PNG of `px` (size × size). Every row uses filter None: masks are long runs of 0 and 255 that
 * deflate packs as well unfiltered (smaller, in fact), and the renderers then decode with a plain copy per row.
 */
function grayPng(px, size) {
  const raw = Buffer.alloc((size + 1) * size)
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, px.byteOffset + y * size, size).copy(raw, y * (size + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: resolve(here, '..'), stdio: 'ignore' })
const stop = () => vite.kill('SIGTERM')
process.on('exit', stop)
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/dev/mask-harness.html`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  mkdirSync(out, { recursive: true })
  // the same software GL as the thumbnails and the tests, so a mask matches what the vector path draws there
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  const only = process.argv.slice(2)
  const ids = catalog.gobos.map((g) => g.id).filter((id) => !only.length || only.some((o) => id.includes(o)))
  for (const id of ids) {
    // every size is rasterized at that size by the vector path itself, so a mask is exactly what the renderer drew
    // before (a box-filtered copy differs by a texel at some tight corners)
    const sizes = []
    for (const size of TIERS) {
      await page.goto(`http://localhost:${port}/dev/mask-harness.html?plate=${id}&size=${size}`)
      await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 })
      const b64 = await page.evaluate(() => window.__mask)
      if (!b64) {
        console.error('no plate', id)
        break
      }
      const png = grayPng(new Uint8Array(Buffer.from(b64, 'base64')), size)
      writeFileSync(resolve(out, `${id}-${size}.png`), png)
      sizes.push(`${size}: ${(png.length / 1024).toFixed(0)} KB`)
    }
    console.log('mask', id, sizes.join(', '))
  }
  await browser.close()
  // the index: which plates have which tiers, and a hash of their files for the URLs' cache busting (renderers fetch
  // only listed files: frontend/src/render/plates/maskIndex.ts)
  const index = {}
  for (const f of readdirSync(out).sort()) {
    const m = /^(.+)-(\d+)\.png$/.exec(f)
    if (!m) continue
    const e = (index[m[1]] ??= { v: createHash('sha1'), sizes: [] })
    e.v.update(readFileSync(resolve(out, f)))
    e.sizes.push(Number(m[2]))
  }
  const lines = Object.keys(index)
    .sort()
    .map((k) => `  '${k}': { v: '${index[k].v.digest('hex').slice(0, 10)}', sizes: [${index[k].sizes.sort((a, b) => a - b).join(', ')}] },`)
  writeFileSync(
    resolve(here, '../src/render/plates/maskIndex.ts'),
    `/** Generated by \`npm run masks\`: the pre-rendered plate masks (backend/internal/catalog/assets/masks), their tiers and a hash of their files. */\nexport const MASK_INDEX: Record<string, { v: string; sizes: number[] }> = {\n${lines.join('\n')}\n}\n`,
  )
} finally {
  stop()
}

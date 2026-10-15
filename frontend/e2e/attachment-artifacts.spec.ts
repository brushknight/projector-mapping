import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { countSpecks } from './artifacts'

/**
 * Every attachment at sharp focus (focus 1) through the real engine: no isolated dark specks inside lit areas (they
 * read as dust or dead pixels on a projector), and the light actually passes somewhere.
 */
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../contract/catalog.json', import.meta.url)), 'utf8')) as { gobos: Array<{ id: string }> }
const W = 960, H = 540

for (const g of catalog.gobos) {
  test(`${g.id} at sharp focus has no dark specks`, async ({ page }) => {
    const light = encodeURIComponent(JSON.stringify({ focus: 1, fringe: 0, vignette: 0 }))
    const att = encodeURIComponent(JSON.stringify({ scale: 1.4 }))
    await page.goto(`/dev/render-harness.html?w=${W}&h=${H}&gobo=${g.id}&light=${light}&att=${att}`)
    await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, { timeout: 60_000 })
    const r = await page.evaluate(
      ([src, w, h]) => {
        const c = document.getElementById('c') as HTMLCanvasElement
        const cv = document.createElement('canvas')
        cv.width = w as number
        cv.height = h as number
        const ctx = cv.getContext('2d')!
        ctx.drawImage(c, 0, 0, w as number, h as number)
        const data = ctx.getImageData(0, 0, w as number, h as number).data
        const fn = new Function(`return ${src}`)() as typeof countSpecks
        return fn(data, w as number, h as number)
      },
      [countSpecks.toString(), W, H] as const,
    )
    expect(r.lit, `${g.id} lets light through`).toBeGreaterThan(200)
    expect(r.specks, `${g.id} specks at ${JSON.stringify(r.at)}`).toBe(0)
  })
}

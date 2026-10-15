import { expect, test, type Page } from '@playwright/test'
import { API, resetMock, waitForOutput } from './lib'

/**
 * Every preview draws exactly what /out draws: the Show space's wall preview and /preview (the phone hero) against
 * /out, downscaled to 64 × 36, for several attachments at sharp focus. A preview that missed a plate's mask would show
 * the whole frame lit where /out shows the plate.
 */
const PLATES = ['plate-grid-window', 'plate-stars', 'plate-blinds', 'plate-moon-and-stars', 'plate-window-grid-iii']
const SW = 64, SH = 36

/**
 * The canvas as it shows on screen, downscaled to SW × SH luminance (0..255). It goes through a screenshot because
 * the preview canvases do not keep their drawing buffer (reading them back directly gives an empty frame).
 */
async function thumb(page: Page, selector: string): Promise<number[]> {
  const png = (await page.locator(selector).first().screenshot()).toString('base64')
  return page.evaluate(
    async ({ png, SW, SH }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = SW
      c.height = SH
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, SW, SH)
      const d = ctx.getImageData(0, 0, SW, SH).data
      const out: number[] = []
      for (let i = 0; i < SW * SH; i++) out.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2])
      return out
    },
    { png, SW, SH },
  )
}

/** Mean absolute difference, relative to the brighter frame's peak (0 same … 1 opposite). */
function diff(a: number[], b: number[]): number {
  const peak = Math.max(1, ...a, ...b)
  return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length / peak
}

test('the Show preview and /preview draw what /out draws', async ({ page, context, request }) => {
  test.setTimeout(180_000)
  await resetMock(request)
  const out = await context.newPage()
  await out.setViewportSize({ width: 960, height: 540 })
  await out.goto('/out?headless=1')
  await waitForOutput(request)
  await page.goto('/editor/show')
  const hero = await context.newPage()
  await hero.setViewportSize({ width: 640, height: 360 })
  await hero.goto('/preview?w=640')
  await out.waitForSelector('canvas')
  await hero.waitForSelector('canvas')
  await page.waitForSelector('[data-testid="show-live-preview"] canvas', { timeout: 30_000 })
  for (const gobo of PLATES) {
    const sc = (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()) as { version: number }
    const att = { id: 'att_cmp', gobo, name: gobo, visible: true, opacity: 1, rotation: 0, offsetX: 0, offsetY: 0, scale: 1.2, params: {}, motion: null }
    const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
      data: { base: sc.version, ops: [{ op: 'replace', path: '/backdrop/static/attachments', value: [att] }, { op: 'replace', path: '/backdrop/static/light/focus', value: 1 }, { op: 'replace', path: '/mode', value: 'static' }] },
    })
    expect(r.ok(), await r.text()).toBe(true)
    // all three follow the scene: wait until they agree (or give up and report the difference)
    let dShow = 1, dHero = 1
    for (let i = 0; i < 40 && (dShow > 0.06 || dHero > 0.06); i++) {
      await page.waitForTimeout(250)
      const o = await thumb(out, 'canvas')
      dShow = diff(o, await thumb(page, '[data-testid="show-live-preview"] canvas'))
      dHero = diff(o, await thumb(hero, 'canvas'))
    }
    expect(dShow, `${gobo}: Show preview vs /out`).toBeLessThan(0.06)
    expect(dHero, `${gobo}: /preview vs /out`).toBeLessThan(0.06)
  }
})

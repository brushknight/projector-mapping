import { expect, test } from '@playwright/test'
import { API, resetMock, waitForOutput } from './lib'

/**
 * (§16 masks) Plate picks are fast: renderers take the pre-rendered mask PNG of the size they draw (decoded off the main
 * thread) instead of rasterizing the vector plate, and /preview is a light renderer (at most 720 px wide, the small
 * masks). Headless Chromium draws with a software GPU, so the time bound is loose; the real check is which files load.
 */
test('a plate pick reaches /out quickly, from the pre-rendered mask', async ({ page, request }) => {
  test.setTimeout(120_000)
  await resetMock(request)
  await page.setViewportSize({ width: 960, height: 540 })
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await page.waitForSelector('canvas')
  const lum = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const t = document.createElement('canvas')
      t.width = 48
      t.height = 27
      const x = t.getContext('2d')!
      x.drawImage(c, 0, 0, 48, 27)
      const d = x.getImageData(0, 0, 48, 27).data
      let s = 0
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]
      return s / (48 * 27 * 3)
    })
  const pick = async (gobo: string) => {
    const sc = (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()) as { version: number }
    const att = { id: 'att_speed', gobo, name: gobo, visible: true, opacity: 1, rotation: 0, offsetX: 0, offsetY: 0, scale: 1, params: { field: 'fill' }, motion: null }
    const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
      data: { base: sc.version, ops: [{ op: 'replace', path: '/backdrop/static/attachments', value: [att] }, { op: 'replace', path: '/backdrop/static/light/focus', value: 1 }, { op: 'replace', path: '/mode', value: 'static' }] },
    })
    expect(r.ok(), await r.text()).toBe(true)
  }
  const decoded = (id: string, size: number) => page.evaluate(([id, size]) => !!(window as unknown as { __projmapMasks: { get(i: string, s: number): unknown } }).__projmapMasks.get(id as string, size as number), [id, size] as const)
  // a plate that lets much light through, then a thin slit: the picture darkens once the slit's mask is on
  await pick('plate-sunburst')
  await expect.poll(() => decoded('plate-sunburst', 2048), { timeout: 20_000 }).toBe(true)
  await page.waitForTimeout(300)
  const before = await lum()
  expect(before).toBeGreaterThan(15)
  const t0 = Date.now()
  await pick('plate-slit')
  await expect.poll(lum, { timeout: 20_000, intervals: [16] }).toBeLessThan(before * 0.6)
  const ms = Date.now() - t0
  console.log(`plate switch on /out (software GL, includes the patch round trip): ${ms} ms`)
  expect(ms).toBeLessThan(1500)
  // the mask came as the PNG file of the output's size (decoded in the page's mask store), not from the vector paths
  expect(await decoded('plate-slit', 2048)).toBe(true)
})

test('/preview renders at most 720 px wide with the small masks', async ({ page, request }) => {
  test.setTimeout(120_000)
  await resetMock(request)
  await page.setViewportSize({ width: 1110, height: 624 })
  await page.goto('/preview?w=1110')
  const canvas = page.getByTestId('preview-canvas')
  await expect.poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 20_000 }).toBe(720)
  const sc = (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()) as { version: number }
  const att = { id: 'att_p', gobo: 'plate-stars', name: 'stars', visible: true, opacity: 1, rotation: 0, offsetX: 0, offsetY: 0, scale: 1, params: {}, motion: null }
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
    data: { base: sc.version, ops: [{ op: 'replace', path: '/backdrop/static/attachments', value: [att] }, { op: 'replace', path: '/mode', value: 'static' }] },
  })
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { __projmapMasks: { get(i: string, s: number): unknown } }).__projmapMasks.get('plate-stars', 1024)), { timeout: 20_000 })
    .toBe(true)
})

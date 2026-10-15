import { readFileSync } from 'node:fs'
import { expect as base, test, type APIRequestContext } from '@playwright/test'
import { API, canvasPixels, resetMock } from './lib'

// (§16) the live gallery: animated tiles drawn by the engine, try in the hero, add to live
const expect = base.configure({ timeout: 45_000 })
test.setTimeout(180_000)
test.beforeEach(async ({ request }) => resetMock(request))

const catalog = JSON.parse(readFileSync(new URL('../../contract/catalog.json', import.meta.url), 'utf8')) as { procedural: Array<{ id: string }> }
const SHOTS = process.env.PROJMAP_SHOTS

async function liveLayers(request: APIRequestContext): Promise<Array<{ ref: string; blend: string }>> {
  return (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()).backdrop.live.layers
}

/** The brightest channel of a tile's canvas, sampled over its middle. */
async function tileLight(page: import('@playwright/test').Page, id: string): Promise<number> {
  const px = await canvasPixels(page, `[data-testid="live-tile-${id}"] canvas`, 64, 36, 128, 72)
  let max = 0
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2])
  return max
}

test('the live gallery animates every live layer, tries one in the hero and adds it to live', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-live').click()
  const gallery = page.getByTestId('live-gallery')
  await expect(gallery).toBeVisible()
  for (const p of catalog.procedural) await expect(page.getByTestId(`live-tile-${p.id}`)).toBeVisible()
  // the tiles are drawn by the engine (a clouds tile lets warm light through between the clouds)
  await expect.poll(() => tileLight(page, 'clouds'), { timeout: 60_000 }).toBeGreaterThan(40)
  const before = (await liveLayers(request)).length
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-gallery-web.png`, fullPage: false })

  // try: the hero shows it, the wall does not change
  await page.getByTestId('live-tile-clouds').click()
  await expect(page.getByTestId('try-bar')).toContainText('trying clouds passing')
  await expect(page.getByTestId('live-tile-clouds')).toHaveAttribute('aria-pressed', 'true')
  expect((await liveLayers(request)).length).toBe(before)
  await page.waitForTimeout(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-gallery-web-try.png`, fullPage: false })

  // cancel leaves nothing behind
  await page.getByTestId('try-cancel').click()
  await expect(page.getByTestId('try-bar')).toHaveCount(0)

  // try again, then add to live: on air as a mask over the light
  await page.getByTestId('live-tile-rain-glass').click()
  await page.getByTestId('try-add').click()
  await expect(page.getByTestId('try-bar')).toHaveCount(0)
  await expect.poll(async () => (await liveLayers(request)).map((l) => `${l.ref}:${l.blend}`)).toContain('rain-glass:multiply')
  expect((await liveLayers(request)).length).toBe(before + 1)
})

test('/preview?try draws the scene with a trial layer, without changing it', async ({ page, request }) => {
  const before = JSON.stringify(await liveLayers(request))
  await page.goto('/preview?scene=scn_desk&try=clouds&w=640')
  const canvas = page.getByTestId('preview-canvas')
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () => {
      const px = await canvasPixels(page, '[data-testid="preview-canvas"]', 200, 120, 240, 120)
      let max = 0
      for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i])
      return max
    }, { timeout: 60_000 })
    .toBeGreaterThan(30)
  expect(JSON.stringify(await liveLayers(request))).toBe(before)
})

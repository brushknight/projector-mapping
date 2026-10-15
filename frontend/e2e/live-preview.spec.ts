import { expect as base, test, type Locator, type Page } from '@playwright/test'
import { API, resetMock } from './lib'

// live layers must animate in every web preview, like /out (item 2): compare two frames 500 ms apart
const expect = base.configure({ timeout: 45_000 })
test.setTimeout(150_000)
test.beforeEach(async ({ request }) => {
  await resetMock(request)
  // the seeded desk scene: put its live stack (a window light with a swaying tree) on the wall
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: sc.version, ops: [{ op: 'replace', path: '/mode', value: 'live' }] } })
})

/** How many pixels differ (any channel by more than 6 levels) between two screenshots of an element, decoded in the page. */
async function framesDiffer(page: Page, el: Locator, gapMs = 500): Promise<{ changed: number; total: number; lit: number }> {
  const a = (await el.screenshot()).toString('base64')
  await page.waitForTimeout(gapMs)
  const b = (await el.screenshot()).toString('base64')
  return page.evaluate(async ([a, b]) => {
    const px = async (s: string) => {
      const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
      const c = new OffscreenCanvas(bm.width, bm.height)
      const x = c.getContext('2d')!
      x.drawImage(bm, 0, 0)
      return x.getImageData(0, 0, bm.width, bm.height).data
    }
    const pa = await px(a), pb = await px(b)
    let changed = 0, lit = 0
    const n = Math.min(pa.length, pb.length)
    for (let i = 0; i < n; i += 4) {
      if (Math.abs(pa[i] - pb[i]) > 6 || Math.abs(pa[i + 1] - pb[i + 1]) > 6 || Math.abs(pa[i + 2] - pb[i + 2]) > 6) changed++
      if (pa[i] + pa[i + 1] + pa[i + 2] > 60) lit++
    }
    return { changed, total: n / 4, lit }
  }, [a, b] as const)
}

test('the Show preview animates a live scene', async ({ page }) => {
  await page.goto('/editor/show')
  await expect(page.getByTestId('mode-tab-live')).toHaveAttribute('data-on-air', 'true')
  const canvas = page.locator('[data-testid="show-live-preview"] canvas')
  await expect(canvas).toBeVisible()
  // let the first frames land (shader compile on SwiftShader)
  await expect.poll(async () => (await framesDiffer(page, canvas, 100)).lit, { timeout: 60_000 }).toBeGreaterThan(500)
  const d = await framesDiffer(page, canvas, 500)
  expect(d.changed, `changed ${d.changed} of ${d.total} pixels`).toBeGreaterThan(d.total * 0.002)
})

test('the viewer shows the wall and animates it, read only', async ({ page, request }) => {
  await page.goto('/view')
  await expect(page.getByTestId('viewer')).toBeVisible()
  await expect(page.getByTestId('viewer-scene')).toHaveText('Desk')
  await expect(page.getByTestId('viewer-mode')).toHaveText('live')
  const canvas = page.locator('[data-testid="viewer-preview"] canvas')
  await expect.poll(async () => (await framesDiffer(page, canvas, 100)).lit, { timeout: 60_000 }).toBeGreaterThan(500)
  const d = await framesDiffer(page, canvas, 500)
  expect(d.changed, `changed ${d.changed} of ${d.total} pixels`).toBeGreaterThan(d.total * 0.002)
  // it connects as a read-only remote without caps: never the output, never an audio client
  const st = await (await request.get(`${API}/__mock/state`)).json()
  const viewer = st.clients.find((c: { role: string; subs: string[] }) => c.role === 'remote' && c.subs.includes('show'))
  expect(viewer?.caps ?? []).toEqual([])
  expect(st.clients.some((c: { role: string }) => c.role === 'output')).toBe(false)
  // the hover bar: fullscreen and close are there
  await page.mouse.move(200, 200)
  await expect(page.getByTestId('viewer-bar')).toHaveAttribute('data-visible', 'true')
  await expect(page.getByRole('button', { name: 'fullscreen' })).toBeVisible()
})

test('scene thumbnails animate and the quick preview leaves the wall alone', async ({ page, request }) => {
  const made = await (await request.post(`${API}/api/v1/scenes`, { data: { name: 'rainy', kind: 'live' } })).json()
  await page.goto('/editor/show')
  await expect(page.getByTestId('scene-group-live')).toBeVisible()
  await expect(page.getByTestId('scene-group-mapping')).toBeVisible()
  // the thumbnail is a 2D canvas: read its pixels straight from the page
  const sel = `[data-testid="scene-thumb-${made.id}"]`
  const grab = () =>
    page.evaluate((sel) => {
      const c = document.querySelector(sel) as HTMLCanvasElement
      return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
    }, sel)
  const lit = (px: number[]) => px.reduce((n, _, i) => (i % 4 === 0 && px[i] + px[i + 1] + px[i + 2] > 60 ? n + 1 : n), 0)
  await expect.poll(async () => lit(await grab()), { timeout: 90_000 }).toBeGreaterThan(50)
  const a = await grab()
  await page.waitForTimeout(800)
  const b = await grab()
  let changed = 0
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) changed++
  expect(changed, 'the thumbnail moved').toBeGreaterThan(0)
  // the quick preview: animated, not on air
  await page.getByTestId(`scene-peek-${made.id}`).hover()
  await expect(page.getByTestId('scene-preview')).toBeVisible()
  const show = await (await request.get(`${API}/api/v1/show`)).json()
  expect(show.activeSceneId).toBe('scn_desk')
  await page.getByTestId('scene-preview-activate').click()
  await expect.poll(async () => (await (await request.get(`${API}/api/v1/show`)).json()).activeSceneId).toBe(made.id)
  // its kind's mode is on air and the show space opens the live tab
  await expect(page.getByTestId('mode-tab-live')).toHaveAttribute('data-on-air', 'true')
})

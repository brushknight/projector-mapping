import { expect, test } from '@playwright/test'
import { API, canvasPixels, litSamples, resetMock, rpc, waitForOutput } from './lib'

// the projector framebuffer is the viewport at 1 device pixel per CSS pixel
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

test.beforeEach(async ({ request }) => resetMock(request))

const W = 1920
const H = 1080

test('the output renders a non-black frame for the fixture scene', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  const canvas = page.getByTestId('out-canvas')
  await expect(canvas).toHaveJSProperty('width', W)
  // the window light covers a good part of the wall; more than 5 % of the samples must be lit
  await expect.poll(async () => (await litSamples(page, '[data-testid="out-canvas"]')).lit, { timeout: 20_000 }).toBeGreaterThan(1000)
  // blackout fades it to black
  await request.post(`${API}/api/v1/show/blackout`, { data: { on: true } })
  await expect.poll(async () => (await litSamples(page, '[data-testid="out-canvas"]')).lit, { timeout: 20_000 }).toBe(0)
})

test('the pairing screen shows the code while idle', async ({ page }) => {
  await page.goto('/out')
  await expect(page.getByTestId('pairing')).toBeVisible()
  await expect(page.getByLabel('pairing code')).toHaveText('K7Q2')
  await expect(page.getByRole('img', { name: 'pairing QR code' })).toBeVisible()
})

const gray = (c: number) => c ^ (c >> 1)

for (const { axis, bit, inverse } of [
  { axis: 'x' as const, bit: 0, inverse: false },
  { axis: 'x' as const, bit: 3, inverse: false },
  { axis: 'x' as const, bit: 10, inverse: true },
  { axis: 'y' as const, bit: 2, inverse: false },
  { axis: 'y' as const, bit: 5, inverse: true },
]) {
  test(`output.pattern gray ${axis} bit ${bit}${inverse ? ' inverse' : ''} draws exact Gray code pixels`, async ({ page, request }) => {
    await page.goto('/out?headless=1')
    await waitForOutput(request)
    const r = await rpc(request, 'output.pattern', { kind: 'gray', axis, bit, inverse })
    expect(r.ok).toBe(true)
    expect(r.d).toMatchObject({ presented: true, width: W, height: H })
    const n = axis === 'x' ? W : H
    const px = axis === 'x' ? await canvasPixels(page, '[data-testid="out-canvas"]', 0, 500, W, 1) : await canvasPixels(page, '[data-testid="out-canvas"]', 700, 0, 1, H)
    const bad: number[] = []
    for (let c = 0; c < n; c++) {
      const want = (((gray(c) >> bit) & 1) === 1) !== inverse ? 255 : 0
      const i = c * 4
      if (px[i] !== want || px[i + 1] !== want || px[i + 2] !== want) bad.push(c)
    }
    expect(bad.slice(0, 10), `${bad.length} wrong ${axis === 'x' ? 'columns' : 'rows'}`).toEqual([])
    const off = await rpc(request, 'output.pattern', { kind: 'off' })
    expect(off.ok).toBe(true)
  })
}

test('output.pattern white and black fill the frame', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await rpc(request, 'output.pattern', { kind: 'white' })
  let px = await canvasPixels(page, '[data-testid="out-canvas"]', 0, 0, W, 1)
  expect(px.every((v) => v === 255)).toBe(true)
  await rpc(request, 'output.pattern', { kind: 'black' })
  px = await canvasPixels(page, '[data-testid="out-canvas"]', 0, 0, W, 1)
  expect(px.filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true)
})

test('the preview renders the active scene', async ({ page }) => {
  await page.goto('/preview?w=480')
  const canvas = page.getByTestId('preview-canvas')
  await expect(canvas).toHaveJSProperty('width', 480)
})

test('render.frame renders offscreen and uploads a PNG snapshot', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  const r = await rpc(request, 'render.frame', { sceneId: 'scn_desk', t: 5, width: 320 })
  expect(r.ok, JSON.stringify(r.d)).toBe(true)
  const sha = String(r.d.sha)
  expect(sha).toMatch(/^[0-9a-f]{64}$/)
  const res = await request.get(`${API}/a/${sha}`)
  expect(res.headers()['content-type']).toBe('image/png')
  const png = await res.body()
  expect(png.readUInt32BE(16)).toBe(320) // IHDR width
  expect(png.readUInt32BE(20)).toBe(180)
})

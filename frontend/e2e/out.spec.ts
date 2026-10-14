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

/** Lit pixels (r+g+b > 60) of an uploaded PNG, decoded in the page. */
async function litFraction(page: import('@playwright/test').Page, sha: string): Promise<number> {
  return page.evaluate(async ({ url }) => {
    const bmp = await createImageBitmap(await (await fetch(url)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++
    return lit / (d.length / 4)
  }, { url: `/a/${sha}` })
}

test('render.face renders a face flat at the asked size and uploads a PNG', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  // the left face carries a drawing (rect border, pen line, text, polygon, circle)
  const r = await rpc(request, 'render.face', { sceneId: 'scn_desk', surfaceId: 'srf_left', t: 0, width: 309, height: 300 })
  expect(r.ok, JSON.stringify(r.d)).toBe(true)
  expect(r.d.width).toBe(309)
  expect(r.d.height).toBe(300)
  const sha = String(r.d.sha)
  expect(sha).toMatch(/^[0-9a-f]{64}$/)
  const png = await (await request.get(`${API}/a/${sha}`)).body()
  expect(png.readUInt32BE(16)).toBe(309)
  expect(png.readUInt32BE(20)).toBe(300)
  expect(await litFraction(page, sha)).toBeGreaterThan(0.005)

  const bad = await rpc(request, 'render.face', { sceneId: 'scn_desk', surfaceId: 'srf_nope', t: 0, width: 100, height: 100 })
  expect(bad.ok).toBe(false)
  expect(JSON.stringify(bad.d)).toContain('srf_nope')
})

test('render.unfold renders the whole object atlas', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  const r = await rpc(request, 'render.unfold', { sceneId: 'scn_desk', objectId: 'obj_cube', t: 0, width: 618, height: 609 })
  expect(r.ok, JSON.stringify(r.d)).toBe(true)
  const png = await (await request.get(`${API}/a/${String(r.d.sha)}`)).body()
  expect(png.readUInt32BE(16)).toBe(618)
  expect(png.readUInt32BE(20)).toBe(609)
})

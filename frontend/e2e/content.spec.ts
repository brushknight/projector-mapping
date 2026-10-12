import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { API, canvasPixels, litSamples, mockLog, mockState, resetMock, waitForOutput } from './lib'

test.beforeEach(async ({ request }) => resetMock(request))

type ShowDoc = { transport: { state: string; offset: number }; solo?: { surfaceIds: string[]; fill: string; until: number } | null }
const showOf = async (request: Parameters<typeof mockState>[0]) => (await (await request.get(`${API}/__mock/state`)).json()).show as ShowDoc

test('space plays the editor preview without touching the wall transport', async ({ page, request }) => {
  await page.goto('/editor/map')
  await expect(page.getByTestId('stage-overlay')).toBeVisible()
  await expect(page.getByTestId('preview-time')).toHaveText('00:00.00')
  await page.keyboard.press(' ')
  await expect.poll(async () => (await page.getByTestId('preview-time').textContent()) ?? '').not.toBe('00:00.00')
  await page.waitForTimeout(600)
  const t1 = await page.getByTestId('timecode').textContent()
  expect(t1).not.toBe('00:00.00')
  // the wall's transport never moved and no show command went out
  expect((await showOf(request)).transport.state).toBe('stopped')
  expect(await page.getByTestId('wall-time').textContent()).toBe('00:00.00')
  expect((await mockLog(request, 'cmd')).filter((m) => String((m.d as { name: string }).name).startsWith('show.'))).toHaveLength(0)
  // space pauses, home rewinds, K steps a frame, L loops
  await page.keyboard.press(' ')
  await page.keyboard.press('Home')
  await expect(page.getByTestId('timecode')).toHaveText('00:00.00')
  await page.keyboard.press('k')
  await expect(page.getByTestId('timecode')).toHaveText('00:00.03')
  await page.keyboard.press('l')
  await expect(page.getByTestId('loop')).toHaveAttribute('aria-pressed', 'true')

  // with "wall follows" on, the editor drives the wall
  await page.getByTestId('wall-follows').click()
  await page.keyboard.press(' ')
  await expect.poll(async () => (await showOf(request)).transport.state).toBe('playing')
  await page.keyboard.press(' ')
  await expect.poll(async () => (await showOf(request)).transport.state).toBe('paused')
})

test('S solos the selection on the stage, shift+S on the wall, esc ends both', async ({ page, request }) => {
  await page.goto('/editor/map')
  const sel = '[data-testid="stage-canvas"]'
  await page.waitForTimeout(1500)
  const all = await litSamples(page, sel, 7)
  await page.getByTestId('tree-surface-srf_right').click()
  await page.keyboard.press('s')
  await expect(page.getByTestId('solo-chip')).toContainText('solo · 1 surface')
  // everything but the right face dims to 15 %
  await expect.poll(async () => (await litSamples(page, sel, 7)).lit).toBeLessThan(all.lit)
  expect((await showOf(request)).solo ?? null).toBeNull()

  await page.keyboard.press('Shift+S')
  await expect.poll(async () => (await showOf(request)).solo?.surfaceIds).toEqual(['srf_right'])
  const solo = (await showOf(request)).solo!
  expect(solo.fill).toBe('grid')
  expect(solo.until / 1e6).toBeGreaterThan(Date.now() + 50_000)
  await expect(page.getByTestId('wall-solo-chip')).toContainText('solo · grid')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('solo-chip')).toHaveCount(0)
  await expect.poll(async () => (await showOf(request)).solo ?? null).toBeNull()
})

test('the wall solo draws a numbered grid through the face warp on /out', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  // the scene is in static mode; a solo still shows only the face, over black
  const ws = await request.post(`${API}/api/v1/show/solo`, { data: { surfaceIds: ['srf_shelf'], fill: 'white', seconds: 60 } })
  expect(ws.ok()).toBe(true)
  // the shelf front spans (120,160)…(480,450): its middle is white, outside is black
  await expect.poll(async () => (await canvasPixels(page, '[data-testid="out-canvas"]', 300, 290, 1, 1))[0]).toBeGreaterThan(240)
  expect((await canvasPixels(page, '[data-testid="out-canvas"]', 1000, 100, 1, 1))[0]).toBeLessThan(10)
})

/** A solid red PNG made in the page, dropped on the stage at a scene point. */
async function dropPicture(page: Page, sceneX: number, sceneY: number) {
  const box = (await page.getByTestId('stage-overlay').boundingBox())!
  const clientX = box.x + (sceneX / 1920) * box.width
  const clientY = box.y + (sceneY / 1080) * box.height
  const dt = await page.evaluateHandle(async () => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 48
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgb(255,0,0)'
    ctx.fillRect(0, 0, 64, 48)
    const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b!), 'image/png'))
    const d = new DataTransfer()
    d.items.add(new File([blob], 'red.png', { type: 'image/png' }))
    return d
  })
  await page.dispatchEvent('[data-testid="stage-overlay"]', 'drop', { dataTransfer: dt, clientX, clientY })
}

test('dropping a picture on a face adds a media layer that /out draws through the warp', async ({ page, request }) => {
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: 0, ops: [{ op: 'replace', path: '/mode', value: 'objects' }] } })
  await page.goto('/editor/map')
  await expect(page.getByTestId('stage-overlay')).toBeVisible()
  await expect(page.locator('[data-point="p_r"]')).toBeVisible()
  const out = await page.context().newPage()
  await out.setViewportSize({ width: 1920, height: 1080 })
  await out.goto('/out?headless=1')
  await waitForOutput(request)
  const OUT = '[data-testid="out-canvas"]'
  // the shelf front has no content yet: dark
  await out.waitForTimeout(1000)
  expect((await canvasPixels(out, OUT, 300, 290, 1, 1))[0]).toBeLessThan(30)

  await dropPicture(page, 300, 290)
  await expect
    .poll(async () => (await mockLog(request, 'patch')).some((m) => JSON.stringify(m.d).includes('"kind":"media"') && JSON.stringify(m.d).includes('asset:')))
    .toBe(true)
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  const shelf = sc.objects.find((o: { id: string }) => o.id === 'obj_shelf').surfaces[0]
  expect(shelf.layers).toHaveLength(1)
  expect(shelf.layers[0]).toMatchObject({ kind: 'media', media: 'image', fit: 'fill' })

  // the wall draws it red inside the warped quad, and nothing outside it
  await expect.poll(async () => {
    const [r, g, b] = await canvasPixels(out, OUT, 300, 290, 1, 1)
    return r > 200 && g < 40 && b < 40
  }).toBe(true)
  // near the slanted top edge: (130, 170) is inside, (300, 135) is above the edge
  const [ri] = await canvasPixels(out, OUT, 140, 180, 1, 1)
  expect(ri).toBeGreaterThan(150)
  const [ro] = await canvasPixels(out, OUT, 300, 128, 1, 1)
  expect(ro).toBeLessThan(40)
  await out.close()
})

test('the template exports as a PNG at the atlas size', async ({ page }) => {
  await page.goto('/editor/content')
  await expect(page.getByTestId('atlas-size')).toContainText('618×609')
  await page.getByTestId('template-menu').click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'save the template as PNG' }).click()])
  expect(dl.suggestedFilename()).toBe('zimacube-template-618x609.png')
  const png = readFileSync((await dl.path())!)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(618)
  expect(png.readUInt32BE(20)).toBe(609)

  // the per-face zip holds the atlas and one PNG per face
  await page.getByTestId('template-menu').click()
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'save each face as a PNG (zip)' }).click()])
  const z = readFileSync((await zip.path())!)
  expect(z.readUInt32LE(0)).toBe(0x04034b50)
  const names = z.toString('latin1').match(/[a-z0-9-]+-\d+x\d+\.png/g) ?? []
  expect(new Set(names)).toEqual(new Set(['zimacube-atlas-618x609.png', 'top-309x309.png', 'left-309x300.png', 'right-309x300.png']))
})

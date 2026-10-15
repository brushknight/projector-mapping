import { mkdirSync } from 'node:fs'
import { expect as base, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, canvasPixels, mockState, resetMock } from './lib'

// (protocol §21) the morph on the projector page: the cube turns into a circle, holds it while its colour changes,
// and turns back into the cube
const expect = base.configure({ timeout: 45_000 })
test.setTimeout(180_000)
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
test.beforeEach(async ({ request }) => resetMock(request))

const OUT = '[data-testid="out-canvas"]'

async function waitForOutput(request: APIRequestContext) {
  await expect
    .poll(async () => (await mockState(request)).clients.some((c) => c.role === 'output' && c.subs.some((x) => x.startsWith('scene:'))), { timeout: 90_000, intervals: [250] })
    .toBe(true)
}

/**
 * The fixture scene stripped to three morph steps on the cube (cues at 0, 2, 4): object → circle (0–2 s, white), the
 * circle held while it turns red (2–4 s), circle → object (4–6 s). The faces draw nothing of their own; no underlay.
 */
async function morphScene(request: APIRequestContext) {
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  const cube = sc.objects.findIndex((o: { id: string }) => o.id === 'obj_cube')
  const base = { trackId: 'trk_converge', fadeIn: 0, fadeOut: 0 }
  const clips = [
    { ...base, id: 'm1', effect: 'morph', start: 0, end: 2, params: { from: 'object', to: 'circle', toR: 200, color: '#ffffff', ease: 'inOut', edge: 2 } },
    { ...base, id: 'm2', effect: 'morph', start: 2, end: 4, params: { from: 'circle', to: 'circle', fromR: 200, toR: 200, color: '#ffffff', colorTo: '#ff3b30', ease: 'linear', edge: 2 } },
    { ...base, id: 'm3', effect: 'morph', start: 4, end: 6, params: { from: 'circle', to: 'object', fromR: 200, color: '#ff3b30', ease: 'inOut', edge: 2 } },
  ]
  const ops: unknown[] = [
    { op: 'replace', path: `/objects/${cube}/layers`, value: [] },
    ...sc.objects[cube].surfaces.flatMap((_: unknown, i: number) => [
      { op: 'replace', path: `/objects/${cube}/surfaces/${i}/effects`, value: [] },
      { op: 'add', path: `/objects/${cube}/surfaces/${i}/layers`, value: [] },
    ]),
    { op: 'replace', path: '/timeline/clips', value: clips },
    {
      op: 'replace',
      path: '/timeline/cues',
      value: [
        { id: 'q1', at: 0, label: 'circle', autoFollow: false },
        { id: 'q2', at: 2, label: 'colour', autoFollow: false },
        { id: 'q3', at: 4, label: 'cube', autoFollow: false },
      ],
    },
    { op: 'replace', path: '/underlay/on', value: false },
    { op: 'remove', path: '/intro' },
    { op: 'replace', path: '/mode', value: 'objects' },
  ].filter((o) => (o as { path: string }).path !== '/intro' || sc.intro)
  const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: sc.version, ops } })
  expect(r.ok(), await r.text()).toBe(true)
}

async function seek(request: APIRequestContext, t: number) {
  await request.post(`${API}/api/v1/show/seek`, { data: { t } })
}

async function rgb(page: Page, x: number, y: number, s = 6): Promise<[number, number, number]> {
  const px = await canvasPixels(page, OUT, x - s / 2, y - s / 2, s, s)
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) out[k] += px[i + k]
  return out.map((v) => v / (px.length / 4)) as [number, number, number]
}
const lum = async (page: Page, x: number, y: number) => (await rgb(page, x, y)).reduce((a, b) => a + b, 0)

// the cube silhouette spans x 690…1230, y 300…900 (centre 960, 600); its top corner region at (960, 330) is inside
// the cube but outside a 200 px circle at the centre
const CENTRE: [number, number] = [960, 600]
const CUBE_ONLY: [number, number] = [960, 330]
const WALL: [number, number] = [300, 540]

test('object → circle → colour → object on /out', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await morphScene(request)
  // p = 0: the whole cube is white
  await seek(request, 0)
  await expect.poll(() => lum(page, ...CUBE_ONLY)).toBeGreaterThan(600)
  await expect.poll(() => lum(page, ...CENTRE)).toBeGreaterThan(600)
  await expect.poll(() => lum(page, ...WALL)).toBeLessThan(6)
  // p = 1: only the circle is lit
  await seek(request, 1.99)
  await expect.poll(() => lum(page, ...CUBE_ONLY)).toBeLessThan(6)
  await expect.poll(() => lum(page, ...CENTRE)).toBeGreaterThan(600)
  // the held circle turns red
  await seek(request, 3.9)
  await expect.poll(async () => (await rgb(page, ...CENTRE))[1]).toBeLessThan(110)
  await expect.poll(async () => (await rgb(page, ...CENTRE))[0]).toBeGreaterThan(220)
  // back to the cube, red
  await seek(request, 6)
  await expect.poll(() => lum(page, ...CUBE_ONLY)).toBeGreaterThan(200)
})

// The cube → circle → cube sequence for review: MORPH_FRAMES=<dir> saves five frames of /out.
test('cube to circle to cube frames', async ({ page, request }) => {
  const dir = process.env.MORPH_FRAMES
  test.skip(!dir, 'set MORPH_FRAMES to save the frames')
  mkdirSync(dir!, { recursive: true })
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await morphScene(request)
  const at = [0, 1, 1.99, 3, 5]
  for (let i = 0; i < at.length; i++) {
    await seek(request, at[i])
    await page.waitForTimeout(1500)
    await page.locator(OUT).screenshot({ path: `${dir}/morph-${i + 1}-t${at[i].toFixed(2)}.png` })
  }
})

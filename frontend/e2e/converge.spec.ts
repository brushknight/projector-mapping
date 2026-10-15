import { mkdirSync } from 'node:fs'
import { expect as base, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, canvasPixels, mockState, resetMock } from './lib'

// (protocol §20) the converge on the projector page: the light of a backdrop mode closing onto the cube's silhouette
const expect = base.configure({ timeout: 45_000 })
test.setTimeout(180_000)
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
test.beforeEach(async ({ request }) => resetMock(request))

const OUT = '[data-testid="out-canvas"]'

async function sceneDoc(request: APIRequestContext) {
  return (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
}

async function waitForOutput(request: APIRequestContext) {
  await expect
    .poll(async () => (await mockState(request)).clients.some((c) => c.role === 'output' && c.subs.some((x) => x.startsWith('scene:'))), { timeout: 90_000, intervals: [250] })
    .toBe(true)
}

/**
 * The fixture scene stripped to the converge: the cube's faces draw nothing of their own, the timeline holds only the
 * converge clip (0 to 2 s, from the light's own shape), objects on air.
 */
async function convergeScene(request: APIRequestContext, attachments: unknown[]) {
  const sc = await sceneDoc(request)
  const cube = sc.objects.findIndex((o: { id: string }) => o.id === 'obj_cube')
  const clip = sc.timeline.clips.find((c: { effect: string }) => c.effect === 'converge')
  const ops: unknown[] = [
    { op: 'replace', path: '/backdrop/static/attachments', value: attachments },
    { op: 'replace', path: '/backdrop/static/light/motion', value: null },
    { op: 'replace', path: '/backdrop/static/light/focus', value: 1 },
    { op: 'replace', path: `/objects/${cube}/layers`, value: [] },
    ...sc.objects[cube].surfaces.flatMap((_: unknown, i: number) => [
      { op: 'replace', path: `/objects/${cube}/surfaces/${i}/effects`, value: [] },
      { op: 'add', path: `/objects/${cube}/surfaces/${i}/layers`, value: [] },
    ]),
    { op: 'replace', path: '/timeline/clips', value: [{ ...clip, params: { ...clip.params, from: 'current', outline: false, edge: 4 } }] },
    { op: 'replace', path: '/mode', value: 'objects' },
  ]
  const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: sc.version, ops } })
  expect(r.ok(), await r.text()).toBe(true)
}

async function seek(request: APIRequestContext, t: number) {
  await request.post(`${API}/api/v1/show/seek`, { data: { t } })
}

/** The average brightness (r + g + b) of a small patch of the output. */
async function lum(page: Page, x: number, y: number, s = 6): Promise<number> {
  const px = await canvasPixels(page, OUT, x - s / 2, y - s / 2, s, s)
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2]
  return sum / (px.length / 4)
}

// outside the cube (left of it, on the wall) and inside it (the top face)
const OUTSIDE: [number, number] = [300, 540]
const INSIDE: [number, number] = [960, 450]

test('the light closes onto the cube: outside lit at the start and dark at the end, inside lit throughout', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  // no attachment: the static light fills the frame, so "current" starts from the whole frame
  await convergeScene(request, [])
  await seek(request, 0)
  await expect.poll(() => lum(page, ...OUTSIDE)).toBeGreaterThan(120)
  await expect.poll(() => lum(page, ...INSIDE)).toBeGreaterThan(120)
  // half way the wall left of the cube is already closing in; the cube stays lit
  await seek(request, 1)
  await expect.poll(() => lum(page, ...INSIDE)).toBeGreaterThan(120)
  // at the end the light sits on the silhouette alone, and holds there after the clip to the end of its step (the cue
  // at 4, §21)
  for (const t of [2, 3.5]) {
    await seek(request, t)
    await expect.poll(() => lum(page, ...OUTSIDE)).toBeLessThan(6)
    await expect.poll(() => lum(page, ...INSIDE)).toBeGreaterThan(120)
  }
  // seeking back recomputes the state from t: lit again outside
  await seek(request, 0)
  await expect.poll(() => lum(page, ...OUTSIDE)).toBeGreaterThan(120)
})

test('start with converge in Show puts the opening on the wall', async ({ page, request }) => {
  await page.goto('/editor/show')
  await expect(page.getByTestId('mode-tab-static')).toHaveAttribute('data-on-air', 'true')
  // the objects tab puts objects on air; the button remembers that static was on air before
  await page.getByTestId('mode-tab-objects').click()
  await expect(page.getByTestId('converge-hint')).toContainText('the static light closes onto zimacube')
  await page.getByTestId('start-converge').click()
  await expect.poll(async () => (await (await request.get(`${API}/api/v1/show`)).json()).transport.state).toBe('playing')
  const sc = await sceneDoc(request)
  expect(sc.mode).toBe('objects')
  expect(sc.timeline.clips.find((c: { effect: string }) => c.effect === 'converge').params.source).toBe('static')
})

// The spot to cube sequence for review: CONVERGE_FRAMES=<dir> saves four frames of /out.
test('spot to cube frames', async ({ page, request }) => {
  const dir = process.env.CONVERGE_FRAMES
  test.skip(!dir, 'set CONVERGE_FRAMES to save the frames')
  mkdirSync(dir!, { recursive: true })
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  const sc = await sceneDoc(request)
  const spot = { ...sc.backdrop.static.attachments[0], gobo: 'plate-circle', name: 'circle', params: {}, scale: 2.6, rotation: 0, offsetX: 0, offsetY: 0, motion: null }
  await convergeScene(request, [spot])
  const at = [0, 0.7, 1.3, 2]
  for (let i = 0; i < at.length; i++) {
    await seek(request, at[i])
    await page.waitForTimeout(1500)
    await page.locator(OUT).screenshot({ path: `${dir}/converge-${i + 1}-t${at[i].toFixed(1)}.png` })
  }
})

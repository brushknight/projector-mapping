import { expect as base, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, canvasPixels, mockState, resetMock } from './lib'

// two pages rendering with SwiftShader on a busy machine: give every check room
const expect = base.configure({ timeout: 45_000 })
test.setTimeout(180_000)

// the projector page plays sound without a click, like `projmap open --out` (§14)
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] } })
test.beforeEach(async ({ request }) => resetMock(request))

const OUT = '[data-testid="out-canvas"]'

/** Waits for /out to follow the scene (longer than lib's waitForOutput: two WebGL pages share one machine here). */
async function waitForOutput(request: APIRequestContext) {
  await expect
    .poll(async () => (await mockState(request)).clients.some((c) => c.role === 'output' && c.subs.some((x) => x.startsWith('scene:'))), { timeout: 90_000, intervals: [250] })
    .toBe(true)
}

async function scene(request: APIRequestContext, id = 'scn_desk') {
  return (await request.get(`${API}/api/v1/scenes/${id}`)).json()
}
async function scenes(request: APIRequestContext): Promise<Array<{ id: string; name: string }>> {
  return (await request.get(`${API}/api/v1/scenes`)).json()
}
async function show(request: APIRequestContext) {
  return (await request.get(`${API}/api/v1/show`)).json()
}

/** The average colour of a patch of a canvas. */
async function patch(page: Page, x: number, y: number, s = 24): Promise<number[]> {
  const px = await canvasPixels(page, OUT, x, y, s, s)
  const sum = [0, 0, 0]
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
  return sum.map((v) => v / (px.length / 4))
}

test('the editor lands on Show, which follows the scene on the wall', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/editor\/show/)
  await expect(page.getByTestId('show-space')).toBeVisible()
  await expect(page.getByRole('button', { name: 'show', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // the fixture scene is in static mode: the static tab is open and on air
  await expect(page.getByTestId('mode-tab-static')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('mode-tab-static')).toHaveAttribute('data-on-air', 'true')
  await expect(page.getByTestId('on-air-label')).toContainText('on air · 6-pane grid window')
  await expect(page.getByTestId('pad-pad_thunder')).toContainText('thunder')
  // /editor redirects to show too, and map still opens
  await page.goto('/editor')
  await expect(page).toHaveURL(/\/editor\/show/)
  await page.getByRole('button', { name: 'map', exact: true }).click()
  await expect(page).toHaveURL(/\/editor\/map/)
  await expect(page.getByTestId('tree-object-obj_cube')).toBeVisible()
})

test('switching modes in Show changes what /out draws', async ({ page, context, request }) => {
  // the editor first (it compiles its shaders while the GPU is idle), then the projector page
  await page.goto('/editor/show')
  await expect(page.getByTestId('mode-tab-static')).toHaveAttribute('data-on-air', 'true')
  const out = await context.newPage()
  await out.goto('/out?headless=1')
  await waitForOutput(request)
  await out.waitForTimeout(1200)
  const corner = () => patch(out, 30, 880)
  const before = await corner()
  // color: the ember gradient fills the frame to the corners
  await page.getByTestId('mode-tab-color').click()
  await expect.poll(async () => (await scene(request)).mode).toBe('color')
  await expect.poll(async () => (await corner())[0], { timeout: 45_000 }).toBeGreaterThan(Math.max(60, before[0] + 30))
  await expect(page.getByTestId('mode-tab-color')).toHaveAttribute('data-on-air', 'true')
  // objects: no backdrop, the corner goes black
  await page.getByTestId('mode-tab-objects').click()
  await expect.poll(async () => (await corner())[0], { timeout: 45_000 }).toBeLessThan(3)
  await expect(page.getByTestId('cue-card')).toContainText('grid build')
  // a gradient pick keeps the stack to one layer with the same id and puts color back on air
  await page.getByTestId('mode-tab-color').click()
  const ids = (await scene(request)).backdrop.color.layers.map((l: { id: string }) => l.id)
  await page.locator('[data-testid^="gradient-"]').nth(1).click()
  await expect.poll(async () => (await scene(request)).backdrop.color.layers.map((l: { id: string }) => l.id)).toEqual(ids.slice(0, 1))
  await expect.poll(async () => (await corner())[0], { timeout: 45_000 }).toBeGreaterThan(20)
})

test('a pad pressed in Show plays on /out', async ({ page, context, request }) => {
  await page.goto('/editor/show')
  await expect(page.getByTestId('pad-pad_thunder')).toBeVisible()
  const out = await context.newPage()
  await out.goto('/out?headless=1')
  await waitForOutput(request)
  await out.mouse.click(10, 10)
  await expect.poll(() => out.evaluate(() => window.__pmAudio?.unlocked ?? false), { timeout: 45_000 }).toBe(true)
  // click the pad, then its key
  await page.getByTestId('pad-pad_thunder').getByRole('button').first().click()
  await expect
    .poll(() => out.evaluate(() => (window.__pmAudio?.started ?? []).filter((x) => x.padId === 'pad_thunder' && x.sound === 'a77c31').length), { timeout: 30_000 })
    .toBe(1)
  await page.locator('body').click({ position: { x: 700, y: 5 } })
  await page.keyboard.press('t')
  await expect
    .poll(() => out.evaluate(() => (window.__pmAudio?.started ?? []).filter((x) => x.padId === 'pad_thunder').length), { timeout: 30_000 })
    .toBe(2)
  // the looping rain pad toggles and shows playing while the server lists it
  await page.getByTestId('pad-pad_rain').getByRole('button').first().click()
  await expect(page.getByTestId('pad-pad_rain')).toHaveAttribute('data-playing', 'true')
  await expect.poll(async () => (await show(request)).audio?.loops ?? []).toEqual(['pad_rain'])
  await page.getByTestId('stop-all').click()
  await expect.poll(async () => (await show(request)).audio?.loops ?? []).toEqual([])
  await expect(page.getByTestId('pad-pad_rain')).not.toHaveAttribute('data-playing', 'true')
})

test('without an audio output a pad says how to get sound', async ({ page }) => {
  await page.goto('/editor/show')
  await page.getByTestId('pad-pad_thunder').getByRole('button').first().click()
  await expect(page.getByRole('alert').filter({ hasText: 'Open /out on the projector computer' })).toBeVisible()
})

test('pads are added, edited and deleted as patches on /sounds/pads', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('pad-add').click()
  await page.getByRole('menuitem', { name: /rain on glass/ }).click()
  await expect(page.getByTestId('pad-editor')).toBeVisible()
  await expect.poll(async () => (await scene(request)).sounds.pads.length).toBe(3)
  await page.getByTestId('pad-name').fill('storm')
  await page.getByTestId('pad-name').press('Enter')
  await page.getByRole('radio', { name: 'violet' }).click()
  await page.getByRole('radio', { name: 'bell' }).click()
  await page.getByTestId('pad-key').fill('s')
  await expect.poll(async () => (await scene(request)).sounds.pads[2]).toMatchObject({ name: 'storm', color: 'violet', icon: 'bell', key: 's', sound: '5d1e0a' })
  await page.getByTestId('pad-delete').click()
  await expect.poll(async () => (await scene(request)).sounds.pads.length).toBe(2)
})

test('the scene browser creates from templates, renames, duplicates, activates and deletes scenes', async ({ page, request }) => {
  await page.goto('/editor/show')
  const list = page.getByTestId('show-space').getByTestId('scene-browser')
  // the seeded desk scene has objects: it is a mapping scene
  await expect(list.getByTestId('scene-group-mapping')).toContainText('Desk')
  // a new static scene from its template goes on the wall at once
  await list.getByTestId('scene-new').click()
  await page.getByTestId('scene-new-static').click()
  await expect.poll(async () => (await scenes(request)).filter((x) => x.name.startsWith('static')).length).toBe(1)
  const created = (await scenes(request)).find((x) => x.name.startsWith('static'))!
  await expect.poll(async () => (await show(request)).activeSceneId).toBe(created.id)
  const sc = await scene(request, created.id)
  expect(sc.kind).toBe('static')
  expect(sc.backdrop.static.attachments[0].gobo).toBe('plate-grid-window')
  expect(sc.backdrop.static.attachments[0].motion).toMatchObject({ preset: 'sun-lr', on: false })
  await expect(list.getByTestId('scene-group-static')).toContainText(created.name)
  await expect(page.getByTestId('mode-tab-static')).toHaveAttribute('data-on-air', 'true')

  // rename it
  await list.getByTestId(`scene-row-${created.id}`).hover()
  await list.getByTestId(`scene-rename-${created.id}`).click()
  const input = list.getByTestId('scene-rename-input')
  await input.fill('rehearsal')
  await input.press('Enter')
  await expect.poll(async () => (await scenes(request)).map((x) => x.name)).toContain('rehearsal')

  // duplicate the desk scene
  await list.getByTestId('scene-row-scn_desk').hover()
  await list.getByTestId('scene-duplicate-scn_desk').click()
  await expect.poll(async () => (await scenes(request)).map((x) => x.name)).toContain('Desk copy')
  const copy = (await scenes(request)).find((x) => x.name === 'Desk copy')!
  expect((await scene(request, copy.id)).objects.length).toBe((await scene(request)).objects.length)

  // the scene on the wall can't be deleted
  await expect(list.getByTestId(`scene-delete-${created.id}`)).toBeDisabled()

  // clicking a row puts it on the wall: the desk is a mapping scene, so objects go on air
  await list.getByTestId('scene-open-scn_desk').click()
  await expect.poll(async () => (await show(request)).activeSceneId).toBe('scn_desk')
  await expect.poll(async () => (await scene(request)).mode).toBe('objects')
  await expect(page.getByTestId('mode-tab-objects')).toHaveAttribute('data-on-air', 'true')
  await expect(list.getByTestId('scene-row-scn_desk')).toHaveAttribute('data-active', 'true')

  // the top bar's switcher lists them too
  await page.getByTestId('scene-picker').click()
  await expect(page.getByRole('menu').getByTestId(`scene-row-${created.id}`)).toContainText('rehearsal')
  await page.keyboard.press('Escape')

  // delete the copy (asks first)
  await list.getByTestId(`scene-row-${copy.id}`).hover()
  await list.getByTestId(`scene-delete-${copy.id}`).click()
  await list.getByTestId('scene-delete-yes').click()
  await expect.poll(async () => (await scenes(request)).map((x) => x.id)).not.toContain(copy.id)

  // a new mapping scene opens in the map space, not on the wall
  await list.getByTestId('scene-new').click()
  await page.getByTestId('scene-new-mapping').click()
  await expect(page).toHaveURL(/\/editor\/map\?scene=/)
  expect((await show(request)).activeSceneId).toBe('scn_desk')
})

test('add from YouTube checks the link, falls back to an embed and puts it on air', async ({ page, request }) => {
  await page.goto('/editor/show')
  await page.getByTestId('mode-tab-scenery').click()
  await page.getByTestId('scenery-cat-videos').click()
  await page.getByTestId('add-youtube').click()
  const url = page.getByTestId('youtube-url')
  await url.fill('https://vimeo.com/12345')
  await expect(page.getByTestId('youtube-url-error')).toContainText('Paste a YouTube link')
  await expect(page.getByTestId('youtube-import')).toBeDisabled()
  await url.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')
  await expect(page.getByTestId('youtube-url-error')).toHaveCount(0)
  await expect(page.getByTestId('ytdlp-hint')).toContainText('brew install yt-dlp')
  await page.getByTestId('youtube-start').fill('0:05')
  await page.getByTestId('youtube-end').fill('3')
  await expect(page.getByTestId('youtube-import')).toBeDisabled()
  await page.getByTestId('youtube-end').fill('0:20')
  await page.getByTestId('youtube-import').click()
  await expect(page.getByTestId('youtube-dialog')).toHaveCount(0)
  const videos = await (await request.get(`${API}/api/v1/videos`)).json()
  const v = videos.find((x: { ref: string }) => x.ref === 'youtube:dQw4w9WgXcQ')
  expect(v).toBeTruthy()
  await page.getByTestId(`video-${v.id}`).click()
  await expect
    .poll(async () => {
      const sc = await scene(request)
      return { mode: sc.mode, layers: sc.backdrop.scenery.layers.map((l: { kind: string; ref: string }) => `${l.kind}:${l.ref}`) }
    })
    .toEqual({ mode: 'scenery', layers: ['video:youtube:dQw4w9WgXcQ'] })
  // the photo controls were kept and the video ones are there
  await expect(page.getByTestId('scenery-controls')).toContainText('sound')
  await expect(page.getByTestId('show-live-preview').getByTestId('youtube-backdrop')).toHaveCount(1)
})

test('the sound library uploads a decoded sound with its peaks', async ({ page, request }) => {
  await page.goto('/editor/show')
  // a 0.5 s 440 Hz mono WAV
  const rate = 8000
  const n = rate / 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 16000), 44 + i * 2)
  await page.getByTestId('show-space').getByTestId('sound-file-input').last().setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: buf })
  await expect.poll(async () => ((await (await request.get(`${API}/api/v1/sounds`)).json()) as Array<{ name: string }>).map((x) => x.name), { timeout: 30_000 }).toContain('beep')
  const beep = ((await (await request.get(`${API}/api/v1/sounds`)).json()) as Array<{ name: string; duration: number; peaks: number[] }>).find((x) => x.name === 'beep')!
  expect(beep.duration).toBeCloseTo(0.5, 1)
  expect(beep.peaks).toHaveLength(128)
  expect(Math.max(...beep.peaks)).toBeGreaterThan(0.4)
})

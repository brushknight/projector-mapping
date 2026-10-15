import { expect, test, type Page } from '@playwright/test'
import { API, canvasPixels, resetMock, waitForOutput } from './lib'

// §14 sound and video. Playwright's Chromium keeps the browser's autoplay rule (a page needs a click or a key press
// before it may play sound), so /out shows "click to enable sound"; sound-autoplay.spec.ts runs the projector with the
// rule off, as `projmap open --out` does.

test.beforeEach(async ({ request, page }) => {
  await resetMock(request)
  // never reach the internet from a test: the YouTube player gets an empty page
  await page.route(/youtube-nocookie\.com|ytimg\.com|youtube\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }))
})

type Started = { kind: string; clipId?: string; padId?: string; cueId?: string; sound: string; when: number; offset: number; ctxTime: number }
const started = (page: Page) => page.evaluate(() => (window.__pmAudio?.started ?? []) as Started[])

test('the editor preview schedules a sound clip at its time and file offset', async ({ page }) => {
  await page.goto('/editor/map')
  await page.getByTestId('timeline-toggle').click()
  // the fixture's rain clip: 2 s to 9 s on the sound track, from 0.5 s into the file, with its waveform
  const clip = page.getByTestId('clip-clp_rain')
  await expect(clip).toContainText('rain on glass')
  await expect(clip.locator('svg rect').first()).toBeAttached()
  await expect(page.getByTestId('preview-sound')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Space')
  await expect.poll(async () => (await started(page)).filter((s) => s.clipId === 'clp_rain').length, { timeout: 10_000 }).toBeGreaterThan(0)
  const s = (await started(page)).find((x) => x.clipId === 'clp_rain')!
  expect(s.kind).toBe('clip')
  expect(s.sound).toBe('5d1e0a')
  expect(s.offset).toBeCloseTo(0.5, 2)
  // it starts 2 s after the preview started (plus the 50 ms scheduling lead), on the audio clock
  expect(s.when - s.ctxTime).toBeGreaterThan(1.7)
  expect(s.when - s.ctxTime).toBeLessThan(2.2)

  // seeking into the clip starts it at once, further into the file
  await page.keyboard.press('Space')
  await page.getByTestId('clip-clp_rain').click()
  await expect(page.getByTestId('sound-clip-inspector')).toBeVisible()
  await expect(page.getByTestId('sound-picker')).toContainText('rain on glass')

  // the mute toggle is remembered
  await page.getByTestId('preview-sound').click()
  await expect(page.getByTestId('preview-sound')).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('projmap.previewSoundMuted'))).toBe('1')
})

test('a cue edits its sound on GO', async ({ page, request }) => {
  await page.goto('/editor/map')
  await page.getByTestId('timeline-toggle').click()
  await page.getByTestId('cue-cue_2').click()
  await page.getByRole('menuitem', { name: /edit cue/ }).click()
  await expect(page.getByTestId('cue-inspector')).toBeVisible()
  await page.getByTestId('sound-picker').click()
  await page.getByRole('menuitem', { name: /thunder/ }).click()
  await expect
    .poll(async () => {
      const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
      return sc.timeline.cues.find((c: { id: string }) => c.id === 'cue_2')?.sound
    })
    .toEqual({ sound: 'a77c31', volume: 1 })
})

test('a YouTube video layer plays in a player behind a see-through /out canvas', async ({ page, request }) => {
  // the fixture's scenery stack: lay_waves (youtube, hidden) under lay_flowers (photo)
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
    data: { base: 0, ops: [{ op: 'replace', path: '/backdrop/scenery/layers/0/visible', value: true }, { op: 'replace', path: '/backdrop/scenery/layers/1/visible', value: false }, { op: 'replace', path: '/mode', value: 'scenery' }] },
  })
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  const bd = page.getByTestId('youtube-backdrop')
  await expect(bd).toHaveAttribute('data-video-id', 'aqz-KE-bpKQ')
  const src = await bd.locator('iframe').getAttribute('src')
  expect(src).toContain('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?')
  expect(src).toContain('mute=1')
  expect(src).toContain('loop=1')
  expect(src).toContain('start=12')
  // nothing else is drawn, so the canvas is clear where the player shows
  await expect.poll(async () => (await canvasPixels(page, '[data-testid="out-canvas"]', 960, 540, 1, 1))[3]).toBe(0)
  // blackout covers the player with black through the canvas
  await request.post(`${API}/api/v1/show/blackout`, { data: { on: true } })
  await expect.poll(async () => (await canvasPixels(page, '[data-testid="out-canvas"]', 960, 540, 1, 1))[3], { timeout: 10_000 }).toBe(255)
  // another mode: no player
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: 0, ops: [{ op: 'replace', path: '/mode', value: 'static' }] } })
  await expect(bd).toHaveCount(0)
})

test('the preview shows the YouTube player too', async ({ page, request }) => {
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
    data: { base: 0, ops: [{ op: 'replace', path: '/backdrop/scenery/layers/0/visible', value: true }, { op: 'replace', path: '/mode', value: 'scenery' }] },
  })
  await page.goto('/preview?w=480')
  await expect(page.getByTestId('youtube-backdrop')).toHaveAttribute('data-video-id', 'aqz-KE-bpKQ')
})

test('/out asks for a click to enable sound, and one click does it', async ({ page, request }) => {
  await page.goto('/out')
  await waitForOutput(request)
  const btn = page.getByTestId('enable-sound')
  await expect(btn).toBeVisible()
  await expect(btn).toHaveText(/click to enable sound/)
  expect(await page.evaluate(() => window.__pmAudio?.unlocked)).toBe(false)
  await btn.click()
  await expect(btn).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__pmAudio?.unlocked)).toBe(true)
})

test('the overlay stays away with ?headless=1 and when another client plays sound', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('enable-sound')).toHaveCount(0)
  await page.goto('/out')
  await waitForOutput(request)
  await expect(page.getByTestId('enable-sound')).toBeVisible()
  await request.post(`${API}/api/v1/show/audio`, { data: { output: 'editor' } })
  await expect(page.getByTestId('enable-sound')).toHaveCount(0)
})

test('a video file layer draws its frames like a photo on /out', async ({ page, context, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  // make a 1 s red WebM (MediaRecorder) in a quiet page of the same origin, so the busy output can't starve the
  // recording, and upload it as a library video
  const quiet = await context.newPage()
  await quiet.goto('/catalog/thumbs/window-4.png')
  await quiet.bringToFront()
  const video = await quiet.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 90
    const ctx = c.getContext('2d')!
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' })
    // keep the canvas painting so the stream has frames to record
    document.body.appendChild(c)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    const done = new Promise((r) => (rec.onstop = r))
    rec.start()
    for (let i = 0; i < 15; i++) {
      ctx.fillStyle = 'rgb(255, 0, 0)'
      ctx.fillRect(0, 0, 160, 90)
      await new Promise((r) => setTimeout(r, 66))
    }
    rec.stop()
    await done
    const fd = new FormData()
    fd.append('file', new Blob(chunks, { type: 'video/webm' }), 'red.webm')
    return (await fetch('/api/v1/videos', { method: 'POST', body: fd })).json()
  })
  expect(video.ref).toMatch(/^asset:/)
  await quiet.close()
  await page.bringToFront()
  const layer = { id: 'lay_vid', kind: 'video', ref: video.ref, name: 'red', visible: true, opacity: 1, blend: 'normal', light: null, params: { blur: 0, brightness: 0.72, warmth: 0, drift: 0, start: 0, end: 0, audio: false, volume: 1 } }
  const base = (await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()).version
  const res = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base, ops: [{ op: 'replace', path: '/backdrop/scenery/layers', value: [layer] }, { op: 'replace', path: '/mode', value: 'scenery' }] } })
  expect(res.ok()).toBe(true)
  await expect
    .poll(async () => {
      const [r, g, b] = await canvasPixels(page, '[data-testid="out-canvas"]', 960, 540, 1, 1)
      return r > 150 && g < 60 && b < 60
    }, { timeout: 15_000 })
    .toBe(true)
  await expect(page.getByTestId('youtube-backdrop')).toHaveCount(0)
})

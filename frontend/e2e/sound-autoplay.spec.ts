import { expect, test, type Page } from '@playwright/test'
import { API, resetMock, waitForOutput } from './lib'

// §14: the projector as `projmap open --out` starts it (Chrome may play sound without a click), so /out is the audio
// output from the start and the server routes sound.play to it.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] } })

test.beforeEach(async ({ request }) => resetMock(request))

type Started = { kind: string; playId?: string; clipId?: string; padId?: string; cueId?: string; sound: string; when: number; offset: number; ctxTime: number }
const started = (page: Page) => page.evaluate(() => (window.__pmAudio?.started ?? []) as Started[])
const stopped = (page: Page) => page.evaluate(() => (window.__pmAudio?.stopped ?? []) as Array<{ playId?: string; padId?: string; clipId?: string }>)

async function waitForAudioOutput(page: Page, request: import('@playwright/test').APIRequestContext) {
  await waitForOutput(request)
  await expect.poll(() => page.evaluate(() => window.__pmAudio?.unlocked)).toBe(true)
  for (let i = 0; i < 50; i++) {
    const st = await (await request.get(`${API}/__mock/state`)).json()
    if (st.clients.some((c: { role: string; caps: string[] }) => c.role === 'output' && c.caps.includes('audio'))) return
    await page.waitForTimeout(100)
  }
  throw new Error('no audio output')
}

test('a pad pressed over REST plays on /out, and a looping pad toggles', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForAudioOutput(page, request)
  await expect(page.getByTestId('enable-sound')).toHaveCount(0)

  const r = await request.post(`${API}/api/v1/sounds/play`, { data: { padId: 'pad_thunder' } })
  expect(r.ok()).toBe(true)
  const ack = await r.json()
  expect(ack.outputs).toBe(1)
  await expect.poll(async () => (await started(page)).find((s) => s.playId === ack.playId)).toMatchObject({ kind: 'oneshot', padId: 'pad_thunder', sound: 'a77c31', offset: 0 })

  // the rain pad loops: a second press stops it
  const rain = await (await request.post(`${API}/api/v1/sounds/play`, { data: { padId: 'pad_rain' } })).json()
  await expect.poll(async () => (await started(page)).some((s) => s.playId === rain.playId)).toBe(true)
  const again = await (await request.post(`${API}/api/v1/sounds/play`, { data: { padId: 'pad_rain' } })).json()
  expect(again.stopped).toBe(true)
  await expect.poll(async () => (await stopped(page)).some((s) => s.padId === 'pad_rain')).toBe(true)

  // a library sound by sha, then stop everything
  const lib = await (await request.post(`${API}/api/v1/sounds/play`, { data: { soundId: '5d1e0a', volume: 0.5 } })).json()
  await expect.poll(async () => (await started(page)).some((s) => s.playId === lib.playId)).toBe(true)
  await request.post(`${API}/api/v1/sounds/stop`, { data: {} })
  await expect.poll(async () => (await stopped(page)).some((s) => s.playId === lib.playId)).toBe(true)
})

test('nothing plays when the editor is the output and no editor is open', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForAudioOutput(page, request)
  await request.post(`${API}/api/v1/show/audio`, { data: { output: 'editor' } })
  const r = await request.post(`${API}/api/v1/sounds/play`, { data: { padId: 'pad_thunder' } })
  expect(r.status()).toBe(409)
  expect((await r.json()).code).toBe('no_audio')
})

test('GO plays the cue sound and schedules the timeline sound on the wall clock', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForAudioOutput(page, request)
  await request.post(`${API}/api/v1/show/go`, { data: {} })
  // cue_1 plays thunder
  await expect.poll(async () => (await started(page)).find((s) => s.cueId === 'cue_1')).toMatchObject({ kind: 'oneshot', sound: 'a77c31' })
  // the rain clip starts 2 s into the timeline, 0.5 s into its file
  await expect.poll(async () => (await started(page)).find((s) => s.clipId === 'clp_rain'), { timeout: 10_000 }).toBeTruthy()
  const clip = (await started(page)).find((s) => s.clipId === 'clp_rain')!
  expect(clip.offset).toBeCloseTo(0.5, 1)
  expect(clip.when - clip.ctxTime).toBeGreaterThan(1.6)
  expect(clip.when - clip.ctxTime).toBeLessThan(2.2)
  // stop: the timeline goes quiet
  await request.post(`${API}/api/v1/show/stop`, { data: {} })
  await expect.poll(async () => (await stopped(page)).some((s) => s.clipId === 'clp_rain')).toBe(true)
})

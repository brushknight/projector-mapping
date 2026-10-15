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

// §16: a fake YouTube player that answers the IFrame Player API and records the commands it gets
const FAKE_PLAYER = `<html><body><script>
window.cmds = [];
addEventListener('message', (e) => {
  let m; try { m = JSON.parse(e.data) } catch { return }
  if (m.event === 'listening') parent.postMessage(JSON.stringify({ event: 'onReady', id: 1 }), '*')
  if (m.event === 'command') {
    window.cmds.push(m.func + (m.args && m.args.length ? ':' + m.args.join(',') : ''))
    const muted = m.func === 'mute' ? true : m.func === 'unMute' ? false : undefined
    if (muted !== undefined) parent.postMessage(JSON.stringify({ event: 'infoDelivery', info: { muted, playerState: 1 } }), '*')
  }
})
</script></body></html>`

test('/out unmutes a YouTube layer with sound at volume × master, and mutes it again', async ({ page, request }) => {
  await page.route(/youtube-nocookie\.com|ytimg\.com|youtube\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: FAKE_PLAYER }))
  await request.post(`${API}/api/v1/show/audio`, { data: { output: 'projector', volume: 0.8, muted: false } })
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, {
    data: {
      base: 0,
      ops: [
        { op: 'replace', path: '/backdrop/scenery/layers/0/visible', value: true },
        { op: 'replace', path: '/backdrop/scenery/layers/1/visible', value: false },
        { op: 'replace', path: '/backdrop/scenery/layers/0/params/audio', value: true },
        { op: 'replace', path: '/backdrop/scenery/layers/0/params/volume', value: 0.5 },
        { op: 'replace', path: '/mode', value: 'scenery' },
      ],
    },
  })
  await page.goto('/out?headless=1')
  await waitForAudioOutput(page, request)
  const bd = page.getByTestId('youtube-backdrop')
  const src = (await bd.locator('iframe').getAttribute('src'))!
  expect(src).toContain('mute=1')
  expect(src).toContain('enablejsapi=1')
  const cmds = async () => {
    const f = page.frames().find((x) => x.url().includes('youtube-nocookie.com'))
    return f ? ((await f.evaluate(() => (window as unknown as { cmds: string[] }).cmds)) ?? []) : []
  }
  await expect.poll(cmds, { timeout: 10_000 }).toEqual(expect.arrayContaining(['unMute', 'setVolume:40', 'playVideo']))
  await expect(bd.locator('iframe')).toHaveAttribute('data-volume', '40')
  // master mute silences it
  await request.post(`${API}/api/v1/show/audio`, { data: { muted: true } })
  await expect(bd.locator('iframe')).toHaveAttribute('data-volume', '0')
  await expect.poll(async () => (await cmds()).at(-1), { timeout: 10_000 }).toBe('mute')
  await expect(page.getByTestId('enable-sound')).toHaveCount(0)
})

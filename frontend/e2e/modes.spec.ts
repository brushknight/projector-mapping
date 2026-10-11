import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import WebSocket from 'ws'
import { API, canvasPixels, litSamples, resetMock, waitForOutput } from './lib'

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
test.beforeEach(async ({ request }) => resetMock(request))

const OUT = '[data-testid="out-canvas"]'

async function setMode(request: APIRequestContext, mode: string) {
  const r = await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: 0, ops: [{ op: 'replace', path: '/mode', value: mode }] } })
  expect(r.ok()).toBe(true)
}

/** Sends one command over a short-lived WebSocket, as the phone does. */
async function cmd(name: string, args: Record<string, unknown>) {
  const ws = new WebSocket(API.replace('http', 'ws') + '/ws')
  await new Promise<void>((done, fail) => {
    ws.on('error', fail)
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', d: { role: 'remote', name: 'e2e phone', caps: [], build: 'e2e' } })))
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw))
      if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'cmd', id: 'c1', d: { name, args } }))
      if ((m.t === 'ack' || m.t === 'error') && m.re === 'c1') {
        ws.close()
        if (m.t === 'ack') done()
        else fail(new Error(JSON.stringify(m.d)))
      }
    })
  })
}

/** The average colour of a patch of the canvas. */
async function patch(page: Page, sel: string, x: number, y: number, s = 24): Promise<[number, number, number]> {
  const px = await canvasPixels(page, sel, x, y, s, s)
  const sum = [0, 0, 0]
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
  const n = px.length / 4
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

test('switching mode replaces what is on the wall', async ({ page, request }) => {
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  // color: the ember gradient fills the frame, corner to corner
  await setMode(request, 'color')
  await expect.poll(async () => (await patch(page, OUT, 40, 1000))[0], { timeout: 20_000 }).toBeGreaterThan(60)
  const color = await litSamples(page, OUT)
  expect(color.lit / color.samples).toBeGreaterThan(0.9)
  // objects: no backdrop, only the mapped faces (the drawing on the left face, the trace on the top)
  await setMode(request, 'objects')
  await expect.poll(async () => (await patch(page, OUT, 40, 1000))[0], { timeout: 20_000 }).toBeLessThan(3)
  const objects = await litSamples(page, OUT)
  expect(objects.lit).toBeGreaterThan(0)
  expect(objects.lit / objects.samples).toBeLessThan(0.15)
  // the drawing's red pen stroke shows on the left face through the warp (left face spans x 690..960)
  const red = await canvasPixels(page, OUT, 690, 450, 270, 450)
  let reddish = 0
  for (let i = 0; i < red.length; i += 4) if (red[i] > 150 && red[i + 1] < 90 && red[i + 2] < 90) reddish++
  expect(reddish).toBeGreaterThan(50)
  // static: the window light is back and the cube's drawing is gone
  await setMode(request, 'static')
  await expect.poll(async () => (await litSamples(page, OUT)).lit, { timeout: 20_000 }).toBeGreaterThan(1000)
  const red2 = await canvasPixels(page, OUT, 690, 450, 270, 450)
  let reddish2 = 0
  for (let i = 0; i < red2.length; i += 4) if (red2[i] > 150 && red2[i + 1] < 90 && red2[i + 2] < 90) reddish2++
  expect(reddish2).toBe(0)
})

test('the phone preview draws the active test pattern like /out', async ({ page, request }) => {
  await setMode(request, 'objects')
  await page.goto('/preview?w=960')
  const sel = '[data-testid="preview-canvas"]'
  await expect(page.getByTestId('preview-canvas')).toHaveJSProperty('width', 960)
  await page.waitForTimeout(1500)
  const before = await litSamples(page, sel, 7)
  await cmd('setup.testPattern', { setupId: 'set_desk', pattern: 'grid', seconds: 60 })
  await expect.poll(async () => (await litSamples(page, sel, 7)).lit, { timeout: 10_000 }).toBeGreaterThan(before.lit + 200)
  await cmd('setup.testPattern', { setupId: 'set_desk', pattern: 'white', seconds: 60 })
  await expect.poll(async () => (await litSamples(page, sel, 7)).lit / before.samples, { timeout: 10_000 }).toBeGreaterThan(0.95)
})

test('a test pattern turns itself off when its time runs out', async ({ page, request }) => {
  await setMode(request, 'objects')
  await page.goto('/out?headless=1')
  await waitForOutput(request)
  await cmd('setup.testPattern', { setupId: 'set_desk', pattern: 'white', seconds: 2 })
  await expect.poll(async () => (await litSamples(page, OUT)).lit, { timeout: 10_000 }).toBeGreaterThan(5000)
  const setup = await (await request.get(`${API}/api/v1/setups/set_desk`)).json()
  expect(setup.testPattern).toBe('white')
  expect(setup.testPatternUntil).toBeGreaterThan(Date.now() * 1e6)
  await expect.poll(async () => (await litSamples(page, OUT)).lit, { timeout: 10_000 }).toBeLessThan(2000)
  expect((await (await request.get(`${API}/api/v1/setups/set_desk`)).json()).testPattern).toBe('off')
})

test('applying a preset switches to its mode', async ({ request }) => {
  const r = await request.post(`${API}/api/v1/presets/pre_golden/apply`, { data: { sceneId: 'scn_desk' } })
  expect(r.ok()).toBe(true)
  await setMode(request, 'objects')
  await request.post(`${API}/api/v1/presets/pre_golden/apply`, { data: { sceneId: 'scn_desk' } })
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  expect(sc.mode).toBe('static')
  expect(sc.backdrop.static.layers.map((l: { id: string }) => l.id)).toEqual(['lay_window'])
  expect(sc.backdrop.live.layers).toHaveLength(2)
})

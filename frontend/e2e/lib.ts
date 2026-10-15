import type { APIRequestContext, Page } from '@playwright/test'

export const API = `http://localhost:${process.env.PROJMAP_E2E_API_PORT ?? 7499}`

export async function resetMock(request: APIRequestContext) {
  await request.post(`${API}/__mock/reset`)
}

export async function mockLog(request: APIRequestContext, t: string): Promise<Array<Record<string, unknown>>> {
  return (await request.get(`${API}/__mock/log?t=${t}`)).json()
}

export async function mockState(request: APIRequestContext): Promise<{ scenes: Array<{ id: string; version: number }>; clients: Array<{ role: string; subs: string[] }> }> {
  return (await request.get(`${API}/__mock/state`)).json()
}

/** Sends an RPC from the "server" to the first connected output and returns its answer. */
export async function rpc(request: APIRequestContext, method: string, args: Record<string, unknown>) {
  return (await request.post(`${API}/__mock/rpc`, { data: { method, args, role: 'output' } })).json() as Promise<{ ok: boolean; d: Record<string, unknown> }>
}

/** RGBA bytes of a rectangle of the page's WebGL canvas (it keeps its drawing buffer), top-left origin. */
export async function canvasPixels(page: Page, selector: string, x: number, y: number, w: number, h: number): Promise<number[]> {
  return page.evaluate(
    ({ selector, x, y, w, h }) => {
      const src = document.querySelector(selector) as HTMLCanvasElement
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { colorSpace: 'srgb' })!
      ctx.drawImage(src, x, y, w, h, 0, 0, w, h)
      return Array.from(ctx.getImageData(0, 0, w, h).data)
    },
    { selector, x, y, w, h },
  )
}

export async function waitForOutput(request: APIRequestContext) {
  // up to 60 s: with an editor rendering in the same browser, a busy machine can take a while to start /out
  for (let i = 0; i < 600; i++) {
    const st = await mockState(request)
    if (st.clients.some((c) => c.role === 'output' && c.subs.some((s) => s.startsWith('scene:')))) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the output never connected')
}

/** How many sampled pixels of the canvas are lit (r+g+b > 30), counted in the page. */
export async function litSamples(page: Page, selector: string, step = 97): Promise<{ lit: number; samples: number }> {
  return page.evaluate(
    ({ selector, step }) => {
      const src = document.querySelector(selector) as HTMLCanvasElement
      const c = document.createElement('canvas')
      c.width = src.width
      c.height = src.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      let samples = 0
      for (let i = 0; i < d.length; i += 4 * step) {
        samples++
        if (d[i] + d[i + 1] + d[i + 2] > 30) lit++
      }
      return { lit, samples }
    },
    { selector, step },
  )
}

/**
 * (§20) Takes the fixture's opening converge off the timeline, for checks of objects mode over a dark wall (with it,
 * objects mode at t = 0 shows the static light at the start of the converge).
 */
export async function withoutConverge(request: APIRequestContext) {
  const sc = await (await request.get(`${API}/api/v1/scenes/scn_desk`)).json()
  // (§21) the fixture's morph (14.5 s) goes too: these checks look at the faces alone
  const clips = sc.timeline.clips.filter((c: { effect: string }) => c.effect !== 'converge' && c.effect !== 'morph')
  await request.post(`${API}/api/v1/scenes/scn_desk/patch`, { data: { base: sc.version, ops: [{ op: 'replace', path: '/timeline/clips', value: clips }] } })
}

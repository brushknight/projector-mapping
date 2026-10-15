import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsEffects, type JsFrameRequest } from './jsRuntime'

/** A stand-in module worker: records what the runtime posts; the test answers when and in what order it likes. */
class FakeWorker {
  static last: FakeWorker | null = null
  posted: Array<Record<string, unknown>> = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  terminated = false
  constructor() {
    FakeWorker.last = this
  }
  postMessage(m: Record<string, unknown>) {
    this.posted.push(m)
  }
  terminate() {
    this.terminated = true
  }
  frames() {
    return this.posted.filter((m) => m.type === 'frame')
  }
  reply(m: Record<string, unknown>) {
    this.onmessage?.({ data: m })
  }
}

class FakeBitmap {
  closed = false
  constructor(readonly tag: string) {}
  close() {
    this.closed = true
  }
}

const bmp = (tag: string) => new FakeBitmap(tag) as unknown as ImageBitmap
const tagOf = (b: ImageBitmap | null) => (b as unknown as FakeBitmap | null)?.tag ?? null

function req(inst: string, t: number, key = 'eff|1', params: Record<string, unknown> = {}): JsFrameRequest {
  return { key, source: 'export default () => {}', inst, t, progress: t / 1.5, width: 64, height: 64, aspect: 1, seed: 0, params }
}

describe('JsEffects', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps three instances of one effect apart, each with its own params', () => {
    const js = new JsEffects()
    js.beginFrame()
    for (const face of ['front', 'top', 'right']) js.request(req(`srf_${face}/clp`, 1.1, 'eff|1', { face }))
    const w = FakeWorker.last!
    const frames = w.frames()
    expect(frames.map((f) => (f.params as { face: string }).face)).toEqual(['front', 'top', 'right'])
    // answers out of order
    for (const f of [frames[2], frames[0], frames[1]]) w.reply({ type: 'frame', key: 'eff|1', inst: f.inst, req: f.req, bitmap: bmp(String(f.inst)) })
    js.beginFrame()
    for (const face of ['front', 'top', 'right']) expect(tagOf(js.request(req(`srf_${face}/clp`, 1.1, 'eff|1', { face })))).toBe(`srf_${face}/clp`)
  })

  it('never shows a reply to a request from before a seek back', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 1.4))
    const w = FakeWorker.last!
    const first = w.frames()[0]
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: first.req, bitmap: bmp('filled') })
    // seek back to 0.2: the next request goes out, the filled picture (1.4) must not be shown at 0.2
    js.beginFrame()
    expect(tagOf(js.request(req('a', 0.2)))).toBeNull()
    const second = w.frames()[1]
    expect(second.t).toBe(0.2)
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: second.req, bitmap: bmp('ribs') })
    js.beginFrame()
    expect(tagOf(js.request(req('a', 0.2)))).toBe('ribs')
  })

  it('drops a late reply that answers an older request', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 0.5))
    const w = FakeWorker.last!
    const old = w.frames()[0]
    // the clip ends (not asked for a frame), comes back: a fresh instance with a new request
    js.beginFrame()
    js.beginFrame()
    js.request(req('a', 0.5))
    const fresh = w.frames()[1]
    const late = bmp('late')
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: old.req, bitmap: late })
    expect((late as unknown as FakeBitmap).closed).toBe(true)
    js.beginFrame()
    expect(tagOf(js.request(req('a', 0.5)))).toBeNull()
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: fresh.req, bitmap: bmp('fresh') })
    js.beginFrame()
    expect(tagOf(js.request(req('a', 0.5)))).toBe('fresh')
  })

  it('forgets an instance whose clip ended, so it never comes back with its old picture', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 1.0))
    const w = FakeWorker.last!
    const f = w.frames()[0]
    const b = bmp('end')
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: f.req, bitmap: b })
    js.beginFrame() // frame 2: a not asked
    js.beginFrame() // frame 3: a is forgotten
    expect((b as unknown as FakeBitmap).closed).toBe(true)
    expect(js.has('a')).toBe(false)
  })

  it('keeps the last picture within a playing clip while the next one is pending', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 0.8))
    const w = FakeWorker.last!
    w.reply({ type: 'frame', key: 'eff|1', inst: 'a', req: w.frames()[0].req, bitmap: bmp('0.8') })
    js.beginFrame()
    expect(tagOf(js.request(req('a', 0.816)))).toBe('0.8')
    js.beginFrame()
    // a stall: still the newest picture of this clip, not a blank face
    expect(tagOf(js.request(req('a', 1.2)))).toBe('0.8')
  })

  it('drops the picture of an old source and ignores its pending reply', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 1.1, 'eff|old'))
    const w = FakeWorker.last!
    w.reply({ type: 'frame', key: 'eff|old', inst: 'a', req: w.frames()[0].req, bitmap: bmp('old') })
    js.beginFrame()
    js.request(req('a', 1.1, 'eff|old'))
    const pending = w.frames()[1]
    js.beginFrame()
    // the source changes while a request of the old one is in flight
    expect(tagOf(js.request(req('a', 1.1, 'eff|new')))).toBeNull()
    expect(w.posted.some((m) => m.type === 'load' && m.key === 'eff|new')).toBe(true)
    w.reply({ type: 'frame', key: 'eff|old', inst: 'a', req: pending.req, bitmap: bmp('old2') })
    js.beginFrame()
    expect(tagOf(js.request(req('a', 1.1, 'eff|new')))).toBeNull()
    const next = w.frames().at(-1)!
    expect(next.key).toBe('eff|new')
    w.reply({ type: 'frame', key: 'eff|new', inst: 'a', req: next.req, bitmap: bmp('new') })
    js.beginFrame()
    expect(tagOf(js.request(req('a', 1.1, 'eff|new')))).toBe('new')
  })

  it('a failed frame does not leave the instance waiting for ever', () => {
    const js = new JsEffects()
    js.beginFrame()
    js.request(req('a', 0.3, 'eff|bad'))
    const w = FakeWorker.last!
    w.reply({ type: 'error', key: 'eff|bad', inst: 'a', req: w.frames()[0].req, message: 'boom' })
    expect(js.isFailed('eff|bad')).toBe(true)
    // the fixed source gets a request at once
    js.beginFrame()
    js.request(req('a', 0.3, 'eff|good'))
    expect(w.frames().at(-1)!.key).toBe('eff|good')
  })

  it('keeps one request in flight per instance', () => {
    const js = new JsEffects()
    for (let i = 0; i < 10; i++) {
      js.beginFrame()
      js.request(req('a', i / 60))
    }
    expect(FakeWorker.last!.frames().length).toBe(1)
    expect(js.inflight()).toBe(1)
  })
})

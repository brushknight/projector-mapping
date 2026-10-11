import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hub, median, type Envelope, type SocketLike } from './ws'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: Envelope[] = []
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  send(d: string) {
    this.sent.push(JSON.parse(d))
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  recv(env: Envelope) {
    this.onmessage?.({ data: JSON.stringify(env) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
  last(t: string) {
    return [...this.sent].reverse().find((e) => e.t === t)
  }
  all(t: string) {
    return this.sent.filter((e) => e.t === t)
  }
}

const show = { activeSetupId: 's', activeSceneId: 'x', onAir: true, transport: { state: 'stopped', startedAt: 0, offset: 0, cue: 0 }, version: 1 }

function setup(now = () => 1000) {
  const socks: FakeSocket[] = []
  const hub = new Hub({ role: 'editor', name: 'test', url: 'ws://x/ws', now, socketFactory: () => {
    const s = new FakeSocket()
    socks.push(s)
    return s
  } })
  hub.connect()
  const s = () => socks[socks.length - 1]
  const welcome = () => {
    s().open()
    s().recv({ t: 'welcome', d: { device: { id: 'dev_1', name: 'test', role: 'editor' }, serverTime: 5e12, show, catalogVersion: 1 } })
  }
  return { hub, socks, s, welcome }
}

describe('Hub', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says hello and becomes open on welcome', () => {
    const { hub, s, welcome } = setup()
    s().open()
    expect(s().sent[0]).toMatchObject({ t: 'hello', d: { role: 'editor', name: 'test' } })
    expect(hub.status).toBe('connecting')
    welcome()
    expect(hub.status).toBe('open')
    expect(hub.device?.id).toBe('dev_1')
  })

  it('takes the median of 8 pings as the clock offset', () => {
    let t = 1000
    const { hub, s, welcome } = setup(() => t)
    welcome()
    const offsets = [50, 52, 48, 51, 49, 300, 50, 50]
    for (const off of offsets) {
      const ping = s().last('ping')!
      const t0 = (ping.d as { t0: number }).t0
      t += 10 // rtt 10 ms
      s().recv({ t: 'pong', d: { t0, ts: (t0 + 5 + off) * 1e6 } })
    }
    expect(s().all('ping')).toHaveLength(8)
    expect(hub.clockOffset).toBeCloseTo(50, 5)
    expect(hub.serverNow()).toBeCloseTo(t + 50, 5)
    // resync burst after 30 s
    vi.advanceTimersByTime(30_000)
    expect(s().all('ping')).toHaveLength(9)
  })

  it('applies snapshot, patched and param into the channel view', () => {
    const { hub, s, welcome } = setup()
    welcome()
    const seen: unknown[] = []
    hub.subscribe<{ a: number; b: number[] }>('scene:x', (snap) => seen.push(snap.doc))
    expect(s().last('sub')).toMatchObject({ t: 'sub', ch: 'scene:x' })
    s().recv({ t: 'snapshot', ch: 'scene:x', v: 4, d: { a: 1, b: [] } })
    s().recv({ t: 'patched', ch: 'scene:x', v: 5, d: { ops: [{ op: 'add', path: '/b/-', value: 7 }], by: 'other' } })
    s().recv({ t: 'param', ch: 'scene:x', d: { path: '/a', value: 0.5, by: 'other' } })
    expect(hub.get('scene:x')).toMatchObject({ version: 5, doc: { a: 0.5, b: [7] } })
    expect(seen).toHaveLength(3)
  })

  it('resyncs on a version gap', () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.subscribe('scene:x', () => {})
    s().recv({ t: 'snapshot', ch: 'scene:x', v: 4, d: { a: 1 } })
    const subs = s().all('sub').length
    s().recv({ t: 'patched', ch: 'scene:x', v: 7, d: { ops: [{ op: 'replace', path: '/a', value: 2 }], by: 'o' } })
    expect(s().all('sub').length).toBe(subs + 1)
    expect(hub.get('scene:x').version).toBe(4)
  })

  it('sends params and applies them locally at once', () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.subscribe('scene:x', () => {})
    s().recv({ t: 'snapshot', ch: 'scene:x', v: 1, d: { p: [{ x: 1 }] } })
    expect(hub.param('scene:x', '/p/0/x', 42)).toBe(true)
    expect(s().last('param')).toMatchObject({ ch: 'scene:x', d: { path: '/p/0/x', value: 42 } })
    expect(hub.get<{ p: Array<{ x: number }> }>('scene:x').doc!.p[0].x).toBe(42)
  })

  it('applies a patch optimistically and resolves on patched with its id', async () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.subscribe('scene:x', () => {})
    s().recv({ t: 'snapshot', ch: 'scene:x', v: 10, d: { list: [] } })
    const done = hub.patch('scene:x', [{ op: 'add', path: '/list/-', value: 'a' }])
    const sent = s().last('patch')!
    expect(sent).toMatchObject({ ch: 'scene:x', base: 10, d: [{ op: 'add', path: '/list/-', value: 'a' }] })
    expect(hub.get('scene:x')).toMatchObject({ doc: { list: ['a'] }, pending: true, version: 10 })
    s().recv({ t: 'patched', ch: 'scene:x', v: 11, re: sent.id, d: { ops: [{ op: 'add', path: '/list/-', value: 'a' }], by: 'dev_1' } })
    await expect(done).resolves.toBe(11)
    expect(hub.get('scene:x')).toMatchObject({ doc: { list: ['a'] }, pending: false, version: 11 })
  })

  it('rebases a stale patch with its intent on the newer document', async () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.subscribe('scene:x', () => {})
    s().recv({ t: 'snapshot', ch: 'scene:x', v: 1, d: { list: ['a', 'b'] } })
    // intent: remove "b" wherever it is now
    const intent = (doc: unknown) => {
      const i = (doc as { list: string[] }).list.indexOf('b')
      return i < 0 ? null : [{ op: 'remove' as const, path: `/list/${i}` }]
    }
    const done = hub.patch('scene:x', intent({ list: ['a', 'b'] })!, intent)
    const first = s().last('patch')!
    // someone else inserted at the front first
    s().recv({ t: 'patched', ch: 'scene:x', v: 2, d: { ops: [{ op: 'add', path: '/list/0', value: 'z' }], by: 'o' } })
    s().recv({ t: 'reject', re: first.id, v: 2, d: { code: 'stale', message: 'rebase' } })
    const second = s().last('patch')!
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ base: 2, d: [{ op: 'remove', path: '/list/2' }] })
    s().recv({ t: 'patched', ch: 'scene:x', v: 3, re: second.id, d: { ops: second.d as never, by: 'dev_1' } })
    await expect(done).resolves.toBe(3)
    expect(hub.get('scene:x').doc).toEqual({ list: ['z', 'a'] })
  })

  it('settles a draft patch on ack and takes the draft from the next snapshot', async () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.subscribe('draft:d1', () => {})
    s().recv({ t: 'snapshot', ch: 'draft:d1', v: 0, d: { id: 'd1', ops: [] } })
    const done = hub.patch('draft:d1', [{ op: 'replace', path: '/points/0/x', value: 3 }])
    const sent = s().last('patch')!
    s().recv({ t: 'ack', re: sent.id })
    await expect(done).resolves.toBe(0)
    s().recv({ t: 'snapshot', ch: 'draft:d1', v: 1, d: { id: 'd1', ops: [{ op: 'replace', path: '/points/0/x', value: 3 }] } })
    expect(hub.get('draft:d1')).toMatchObject({ version: 1, pending: false })
  })

  it('resolves commands on ack and rejects on error', async () => {
    const { hub, s, welcome } = setup()
    welcome()
    const go = hub.cmd('show.go')
    s().recv({ t: 'ack', re: s().last('cmd')!.id })
    await expect(go).resolves.toBeUndefined()
    const bad = hub.cmd('show.go')
    s().recv({ t: 'error', re: s().last('cmd')!.id, d: { code: 'no_scene', message: 'No active scene.' } })
    await expect(bad).rejects.toMatchObject({ code: 'no_scene' })
  })

  it('answers rpc through the handler registry', async () => {
    const { hub, s, welcome } = setup()
    welcome()
    hub.handleRpc('output.pattern', async (args) => ({ presented: true, bit: args.bit }))
    s().recv({ t: 'rpc', id: 'r-1', d: { method: 'output.pattern', args: { kind: 'gray', axis: 'x', bit: 3, inverse: false } } })
    await vi.advanceTimersByTimeAsync(0)
    expect(s().last('rpc.result')).toMatchObject({ re: 'r-1', d: { presented: true, bit: 3 } })
    s().recv({ t: 'rpc', id: 'r-2', d: { method: 'nope', args: {} } })
    await vi.advanceTimersByTimeAsync(0)
    expect(s().last('rpc.error')).toMatchObject({ re: 'r-2', d: { code: 'unknown_method' } })
  })

  it('reconnects with backoff and resubscribes', () => {
    const { hub, socks, s, welcome } = setup()
    welcome()
    hub.subscribe('scene:x', () => {})
    s().drop()
    expect(hub.status).toBe('closed')
    vi.advanceTimersByTime(499)
    expect(socks).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(socks).toHaveLength(2)
    s().drop()
    vi.advanceTimersByTime(999)
    expect(socks).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(socks).toHaveLength(3)
    welcome()
    expect(s().last('sub')).toMatchObject({ ch: 'scene:x' })
  })

  it('sends telemetry and drops params while offline', () => {
    const { hub, s, welcome } = setup()
    expect(hub.param('scene:x', '/a', 1)).toBe(false)
    welcome()
    hub.telemetry({ fps: 60, dropped: 0, width: 1920, height: 1080, refresh: 60 })
    expect(s().last('telemetry')).toMatchObject({ d: { fps: 60 } })
  })

  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

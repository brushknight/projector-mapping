import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardPointOps, pointIdAt } from '../../entities/scene/editing'
import type { Scene } from '../../entities/scene/types'
import { applyPatch } from './jsonPatch'
import { Hub, pointAt, type Envelope, type SocketLike } from './ws'

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
  recv(env: Envelope) {
    this.onmessage?.({ data: JSON.stringify(env) })
  }
}

const show = { activeSetupId: 's', activeSceneId: 'scn_a', onAir: true, transport: { state: 'stopped', startedAt: 0, offset: 0, cue: 0 }, version: 1 }

function open() {
  let sock!: FakeSocket
  const hub = new Hub({ role: 'editor', name: 't', url: 'ws://x/ws', socketFactory: () => (sock = new FakeSocket()) })
  hub.connect()
  sock.readyState = 1
  sock.onopen?.({})
  sock.recv({ t: 'welcome', d: { device: { id: 'dev_1', name: 't', role: 'editor' }, serverTime: 5e12, show, catalogVersion: 1 } })
  return { hub, sock }
}

/** a cube face (fa..fd) with a bay detail (ba..bd); a duplicate scene has the same ids */
const cube = (id: string): Scene =>
  ({
    id,
    points: [
      { id: 'fa', x: 0, y: 0 },
      { id: 'fb', x: 100, y: 0 },
      { id: 'fc', x: 100, y: 100 },
      { id: 'fd', x: 0, y: 100 },
      { id: 'ba', x: 20, y: 20 },
      { id: 'bb', x: 40, y: 20 },
    ],
    objects: [
      {
        id: 'obj',
        surfaces: [
          { id: 'face', kind: 'quad', role: 'face', pointIds: ['fa', 'fb', 'fc', 'fd'], parentId: null },
          { id: 'bay', kind: 'quad', role: 'detail', pointIds: ['ba', 'bb'], parentId: 'face' },
        ],
      },
    ],
  }) as unknown as Scene

describe('point edits address the point they mean (bug: editing one scene moved corners in another)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drags in scene A, then in scene B, change only the dragged point of each scene', () => {
    const { hub, sock } = open()
    const a = cube('scn_a')
    const b = { ...cube('scn_b'), points: [{ id: 'fz', x: 500, y: 500 }, ...cube('scn_b').points] } as Scene
    hub.subscribe('scene:scn_a', () => {})
    hub.subscribe('scene:scn_b', () => {})
    sock.recv({ t: 'snapshot', ch: 'scene:scn_a', v: 1, d: a })
    sock.recv({ t: 'snapshot', ch: 'scene:scn_b', v: 1, d: b })
    // A: fb is index 1
    expect(hub.param('scene:scn_a', '/points/1/x', 110, { pointId: pointIdAt(a, '/points/1/x') })).toBe(true)
    // B: fb is index 2 there; an index computed on A's document (1 = fa in B) is refused, not applied to fa
    expect(hub.param('scene:scn_b', '/points/1/x', 120, { pointId: 'fb' })).toBe(false)
    expect(hub.param('scene:scn_b', '/points/2/x', 120, { pointId: pointIdAt(b, '/points/2/x') })).toBe(true)
    const da = hub.get<Scene>('scene:scn_a').doc!
    const db = hub.get<Scene>('scene:scn_b').doc!
    expect(da.points.map((p) => p.x)).toEqual([0, 110, 100, 0, 20, 40])
    expect(db.points.map((p) => p.x)).toEqual([500, 0, 120, 100, 0, 20, 40])
    const sent = sock.sent.filter((e) => e.t === 'param')
    expect(sent).toEqual([
      { t: 'param', ch: 'scene:scn_a', d: { path: '/points/1/x', value: 110, pointId: 'fb' } },
      { t: 'param', ch: 'scene:scn_b', d: { path: '/points/2/x', value: 120, pointId: 'fb' } },
    ])
  })

  it('takes a fresh snapshot instead of applying a point param for another point', () => {
    const { hub, sock } = open()
    hub.subscribe('scene:scn_a', () => {})
    sock.recv({ t: 'snapshot', ch: 'scene:scn_a', v: 1, d: cube('scn_a') })
    sock.sent = []
    sock.recv({ t: 'param', ch: 'scene:scn_a', d: { path: '/points/0/x', value: 999, pointId: 'fb', by: 'dev_2' } })
    expect(hub.get<Scene>('scene:scn_a').doc!.points[0].x).toBe(0)
    expect(sock.sent).toContainEqual({ t: 'sub', ch: 'scene:scn_a' })
  })

  it('guards patch ops on points with a test of the point id', () => {
    const a = cube('scn_a')
    const ops = guardPointOps(a, [
      { op: 'replace', path: '/points/1/x', value: 5 },
      { op: 'replace', path: '/points/1/y', value: 6 },
      { op: 'remove', path: '/points/0' },
      { op: 'replace', path: '/points/0/x', value: 7 },
    ])!
    expect(ops).toEqual([
      { op: 'test', path: '/points/1/id', value: 'fb' },
      { op: 'replace', path: '/points/1/x', value: 5 },
      { op: 'replace', path: '/points/1/y', value: 6 },
      { op: 'remove', path: '/points/0' },
      { op: 'replace', path: '/points/0/x', value: 7 },
    ])
    // the same ops on a duplicate whose point list differs fail instead of moving fa
    const b = { ...a, points: [a.points[1], a.points[0], ...a.points.slice(2)] }
    expect(() => applyPatch(b, ops.slice(0, 2))).toThrow()
    expect(pointAt(a, '/points/1/x', 'fb')).toBe(true)
    expect(pointAt(a, '/name', 'whatever')).toBe(true)
  })
})

describe('detail surfaces follow their face (server-derived params)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('moves the bay on the dragging client when the server sends its live positions', () => {
    const { hub, sock } = open()
    let seen: Scene | null = null
    hub.subscribe<Scene>('scene:scn_a', (s) => (seen = s.doc))
    sock.recv({ t: 'snapshot', ch: 'scene:scn_a', v: 1, d: cube('scn_a') })
    // the editor drags the face's top-right corner
    hub.param('scene:scn_a', '/points/1/x', 200, { pointId: 'fb' })
    // the server answers with where the bay is now, on every client (the sender too)
    sock.recv({ t: 'param', ch: 'scene:scn_a', d: { path: '/points/4/x', value: 30, pointId: 'ba', by: 'dev_1' } })
    sock.recv({ t: 'param', ch: 'scene:scn_a', d: { path: '/points/5/x', value: 70, pointId: 'bb', by: 'dev_1' } })
    expect(seen!.points.map((p) => [p.id, p.x])).toEqual([
      ['fa', 0],
      ['fb', 200],
      ['fc', 100],
      ['fd', 0],
      ['ba', 30],
      ['bb', 70],
    ])
  })
})

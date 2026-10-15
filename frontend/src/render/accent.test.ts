import { describe, expect, it } from 'vitest'
import type { Scene, SceneObject } from '../entities/scene/types'
import { accentObjects, objectAccentOf, silhouette, silhouetteFaces } from './accent'

const P = (id: string, x: number, y: number) => ({ id, x, y })
// a cube seen corner-on: top (t1 t2 c t4), left (t4 c b1 b4), right (c t2 b2 b1), with a bay detail on the right
const points = [P('t1', 0, 0), P('t2', 100, 0), P('c', 60, 40), P('t4', -40, 40), P('b4', -40, 140), P('b1', 60, 140), P('b2', 100, 100), P('d1', 70, 60), P('d2', 90, 55), P('d3', 90, 90)]
const face = (id: string, ids: string[], extra: object = {}) => ({ id, name: id, kind: 'quad', role: 'face', pointIds: ids, parentId: null, visible: true, mesh: null, effects: [], opacity: 1, softEdge: 0, ...extra })
const cube = {
  id: 'obj',
  name: 'cube',
  tags: [],
  visible: true,
  surfaces: [
    face('top', ['t1', 't2', 'c', 't4']),
    face('left', ['t4', 'c', 'b1', 'b4']),
    face('right', ['c', 't2', 'b2', 'b1']),
    face('bay', ['d1', 'd2', 'd3'], { kind: 'tri', role: 'detail', parentId: 'right' }),
    face('rim', ['t1', 't2'], { kind: 'line', role: 'edge' }),
  ],
} as unknown as SceneObject

describe('object accent silhouette (§19)', () => {
  it('keeps only the outer edges of the faces, as one closed loop, without details or edges', () => {
    expect(silhouetteFaces(cube).map((s) => s.id)).toEqual(['top', 'left', 'right'])
    const loops = silhouette(cube, points)
    expect(loops).toHaveLength(1)
    const loop = loops[0]
    // closed: the hexagon t1 t2 b2 b1 b4 t4 and back to t1 (7 points)
    expect(loop).toHaveLength(7)
    expect(loop[0]).toEqual(loop[6])
    const seen = new Set(loop.map(([x, y]) => `${x},${y}`))
    expect(seen.has('60,40')).toBe(false) // the inner corner c is on no outer edge
    expect(seen.has('70,60')).toBe(false) // no detail
    for (const xy of ['0,0', '100,0', '100,100', '60,140', '-40,140', '-40,40']) expect(seen.has(xy), xy).toBe(true)
  })

  it('draws two separate faces as two loops', () => {
    const apart = { ...cube, surfaces: [face('a', ['t1', 't2', 'c', 't4']), face('b', ['d1', 'd2', 'd3'], { kind: 'tri' })] } as unknown as SceneObject
    const loops = silhouette(apart, points)
    expect(loops.map((l) => l.length).sort()).toEqual([4, 5])
  })

  it('is off by default and picks all or the listed objects', () => {
    const scene = { objects: [cube, { ...cube, id: 'other', visible: true }] } as unknown as Scene
    expect(objectAccentOf(scene).on).toBe(false)
    const on = objectAccentOf({ ...scene, objectAccent: { on: true, objects: ['other'], outline: { on: true, width: 2, color: '#fff', glow: 0 }, fill: { on: false, opacity: 1, mode: 'cut' } } })
    expect(accentObjects(scene, on).map((o) => o.id)).toEqual(['other'])
    expect(accentObjects(scene, { ...on, objects: 'all' })).toHaveLength(2)
  })
})

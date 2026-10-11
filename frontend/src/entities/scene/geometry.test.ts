import { describe, expect, it } from 'vitest'
import { bilinear, clockwise, meshPoints, orderQuad, pointInPolygon, resampleMesh, segDist, signedArea } from './geometry'
import { flatMesh } from './ops'

describe('stage geometry', () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  it('measures orientation', () => {
    expect(signedArea(sq)).toBe(100)
    expect(clockwise([...sq].reverse())).toEqual(sq.slice().reverse().reverse())
  })
  it('orders quad corners clockwise from the top left', () => {
    const shuffled = [sq[2], sq[0], sq[3], sq[1]]
    expect(orderQuad(shuffled)).toEqual(sq)
  })
  it('hit tests polygons and segments', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false)
    expect(segDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
  })
  it('places mesh points bilinearly with offsets', () => {
    expect(bilinear(sq, 0.5, 0.5)).toEqual({ x: 5, y: 5 })
    const m = flatMesh(2, 2)
    m.offsets[4] = [1, -1]
    const pts = meshPoints(sq, m)
    expect(pts).toHaveLength(9)
    expect(pts[4]).toEqual({ x: 6, y: 4 })
    const fine = resampleMesh(m, 4, 4)
    expect(fine.offsets).toHaveLength(25)
    expect(fine.offsets[12]).toEqual([1, -1])
  })
})

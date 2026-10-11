import { describe, expect, it } from 'vitest'
import { applyH, homography, invert3, squareToQuad, type Vec2 } from './homography'
import { applyTint, hsiToRgb, kelvinToRgb, lightRgb } from './color'
import { grayBits, grayCode, grayPixel } from './gray'
import { physicalToScene, sceneSizeOf, sceneToPhysical } from './orientation'
import { signedArea, triangulate } from './triangulate'
import { meshControlPoints, meshEval, surfaceGeometry } from './geometry'
import type { Surface } from '../../entities/scene/types'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('homography', () => {
  const quad: Vec2[] = [[690, 450], [960, 300], [1230, 450], [960, 600]]
  it('maps the unit square corners onto the quad', () => {
    const h = squareToQuad(quad)
    const sq: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    sq.forEach(([x, y], i) => {
      const [u, v] = applyH(h, x, y)
      close(u, quad[i][0], 1e-6)
      close(v, quad[i][1], 1e-6)
    })
  })
  it('round-trips through the inverse', () => {
    const h = squareToQuad([[100, 120], [900, 80], [1000, 700], [60, 640]])
    const inv = invert3(h)
    for (const [x, y] of [[0.1, 0.2], [0.5, 0.5], [0.93, 0.01]] as Vec2[]) {
      const [px, py] = applyH(h, x, y)
      const [u, v] = applyH(inv, px, py)
      close(u, x, 1e-9)
      close(v, y, 1e-9)
    }
  })
  it('is perspective: maps the square centre to where the diagonals cross', () => {
    const h = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [100, 0], [80, 50], [20, 50]])
    const [, y] = applyH(h, 0.5, 0.5)
    expect(y).toBeCloseTo(31.25) // diagonals cross at t = 0.625, not the bilinear 25
  })
  it('rejects a degenerate quad', () => {
    expect(() => squareToQuad([[0, 0], [0, 0], [0, 0], [0, 0]])).toThrow()
  })
})

describe('colour', () => {
  it('goes from warm to cool as kelvin rises', () => {
    let prevRatio = Infinity
    for (const k of [2000, 2700, 3200, 4000, 5600, 6500, 8000, 10000]) {
      const [r, , b] = kelvinToRgb(k)
      const ratio = r / Math.max(b, 1e-3)
      expect(ratio).toBeLessThanOrEqual(prevRatio)
      prevRatio = ratio
    }
  })
  it('is about white at 6500 K', () => {
    const c = kelvinToRgb(6500)
    for (const v of c) expect(v).toBeGreaterThan(0.94)
  })
  it('tints magenta for positive values and green for negative', () => {
    const base = kelvinToRgb(5600)
    const mag = applyTint(base, 1)
    const grn = applyTint(base, -1)
    expect(mag[1] / mag[0]).toBeLessThan(base[1] / base[0])
    expect(grn[1] / grn[0]).toBeGreaterThan(base[1] / base[0])
    expect(applyTint(base, 0)).toEqual(base)
  })
  it('does HSI hue and saturation', () => {
    expect(hsiToRgb(0, 1)).toEqual([1, 0, 0])
    expect(hsiToRgb(120, 1)).toEqual([0, 1, 0])
    expect(hsiToRgb(200, 0)).toEqual([1, 1, 1])
    expect(lightRgb({ mode: 'hsi', kelvin: 3200, tint: 0, hue: 240, sat: 1 })).toEqual([0, 0, 1])
  })
})

describe('gray code (protocol §7)', () => {
  it('is c ^ (c >> 1)', () => {
    for (let c = 0; c < 4096; c++) expect(grayCode(c)).toBe(c ^ (c >> 1))
  })
  it('changes one bit between neighbours', () => {
    for (let c = 0; c < 2047; c++) {
      let x = grayCode(c) ^ grayCode(c + 1)
      let bits = 0
      while (x) {
        bits += x & 1
        x >>= 1
      }
      expect(bits).toBe(1)
    }
  })
  it('needs ceil(log2(W)) bits', () => {
    expect(grayBits(1920)).toBe(11)
    expect(grayBits(1080)).toBe(11)
    expect(grayBits(1024)).toBe(10)
    expect(grayBits(3840)).toBe(12)
  })
  it('lights a pixel when bit is set, XOR inverse', () => {
    // column 5: g = 5 ^ 2 = 7 (0b111); column 4: g = 6 (0b110)
    expect(grayPixel(5, 0, false)).toBe(true)
    expect(grayPixel(4, 0, false)).toBe(false)
    expect(grayPixel(4, 0, true)).toBe(true)
    expect(grayPixel(4, 2, false)).toBe(true)
    // decoding every bit recovers every column of a 1920 px frame
    for (let c = 0; c < 1920; c++) {
      let g = 0
      for (let b = 0; b < 11; b++) if (grayPixel(c, b, false)) g |= 1 << b
      let n = g
      for (let s = g >> 1; s; s >>= 1) n ^= s
      expect(n).toBe(c)
    }
  })
})

describe('orientation', () => {
  it('authors portrait at height × width', () => {
    expect(sceneSizeOf({ output: { width: 1920, height: 1080, orientation: 'portrait-cw', flipH: false, flipV: false } })).toEqual({ width: 1080, height: 1920 })
    expect(sceneSizeOf({ output: { width: 1920, height: 1080, orientation: 'landscape', flipH: false, flipV: false } })).toEqual({ width: 1920, height: 1080 })
  })
  it('maps physical to scene for every orientation', () => {
    expect(physicalToScene(0.25, 0.75, 'landscape')).toEqual([0.25, 0.75])
    // cw: the scene's top edge lands on the physical right edge
    expect(physicalToScene(1, 0, 'portrait-cw')).toEqual([0, 0])
    expect(physicalToScene(1, 1, 'portrait-cw')).toEqual([1, 0])
    expect(physicalToScene(0, 0, 'portrait-cw')).toEqual([0, 1])
    // ccw: the scene's top edge lands on the physical left edge
    expect(physicalToScene(0, 1, 'portrait-ccw')).toEqual([0, 0])
    expect(physicalToScene(0, 0, 'portrait-ccw')).toEqual([1, 0])
  })
  it('applies flips in physical space before rotating', () => {
    expect(physicalToScene(0.2, 0.3, 'landscape', true, false)).toEqual([0.8, 0.3])
    expect(physicalToScene(0.2, 0.3, 'landscape', false, true)).toEqual([0.2, 0.7])
    const [a, b] = physicalToScene(0.2, 0.3, 'portrait-cw', true, false)
    close(a, 0.3)
    close(b, 0.2)
  })
  it('inverts with sceneToPhysical', () => {
    for (const o of ['landscape', 'portrait-cw', 'portrait-ccw'] as const)
      for (const fh of [false, true]) for (const fv of [false, true]) {
        const [sx, sy] = physicalToScene(0.1, 0.7, o, fh, fv)
        const [u, v] = sceneToPhysical(sx, sy, o, fh, fv)
        close(u, 0.1)
        close(v, 0.7)
      }
  })
})

describe('triangulation', () => {
  const area = (pts: Vec2[], tris: number[]) => {
    let a = 0
    for (let i = 0; i < tris.length; i += 3) a += Math.abs(signedArea([pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]]))
    return a
  }
  it('covers a convex polygon exactly', () => {
    const pts: Vec2[] = [[0, 0], [10, 0], [12, 5], [10, 10], [0, 10]]
    const tris = triangulate(pts)
    expect(tris.length).toBe((pts.length - 2) * 3)
    close(area(pts, tris), Math.abs(signedArea(pts)))
  })
  it('handles a concave polygon (the desk lamp) in either winding', () => {
    const lamp: Vec2[] = [[1600, 860], [1600, 700], [1560, 700], [1590, 560], [1700, 560], [1730, 700], [1690, 700], [1690, 860]]
    for (const pts of [lamp, [...lamp].reverse()]) {
      const tris = triangulate(pts)
      expect(tris.length).toBe((pts.length - 2) * 3)
      close(area(pts, tris), Math.abs(signedArea(pts)), 1e-6)
    }
  })
})

describe('surface geometry', () => {
  const pts = [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }, { id: 'c', x: 200, y: 100 }, { id: 'd', x: 0, y: 100 },
  ]
  const s = (kind: Surface['kind'], ids: string[], mesh: Surface['mesh'] = null): Surface => ({
    id: 's', name: 's', kind, role: 'face', pointIds: ids, parentId: null, visible: true, mesh, effects: [], opacity: 1, softEdge: 0,
  })
  it('sizes a quad and gives it an inverse homography', () => {
    const g = surfaceGeometry(s('quad', ['a', 'b', 'c', 'd']), pts)!
    expect(g.size).toEqual([200, 100])
    close(g.aspect, 2)
    const [u, v] = applyH(g.hInv!, 100, 50)
    close(u, 0.5)
    close(v, 0.5)
  })
  it('builds a mesh from bilinear positions plus offsets', () => {
    const mesh = { cols: 2, rows: 1, bezier: false, offsets: [[0, 0], [0, -10], [0, 0], [0, 0], [0, 0], [0, 0]] as Array<[number, number]> }
    const ctrl = meshControlPoints([[0, 0], [200, 0], [200, 100], [0, 100]], mesh)
    expect(ctrl[1]).toEqual([100, -10])
    expect(meshEval(ctrl, mesh, 0.5, 0)).toEqual([100, -10])
    const g = surfaceGeometry(s('quad', ['a', 'b', 'c', 'd'], mesh), pts)!
    expect(g.hInv).toBeNull()
    expect(g.indices.length).toBeGreaterThan(6)
  })
  it('makes a circle from centre and rim, and a stroked line', () => {
    const c = surfaceGeometry(s('circle', ['a', 'b']), pts)!
    expect(c.size).toEqual([400, 400])
    const l = surfaceGeometry(s('line', ['a', 'b', 'c']), pts)!
    expect(l.size[0]).toBe(300)
    expect(l.closed).toBe(false)
  })
  it('returns null with too few points', () => {
    expect(surfaceGeometry(s('quad', ['a']), pts)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { cutPath, parseStrokes, pathLength, strokeLengths, strokePath, strokesKey } from './drawing'
import type { Stroke } from '../../entities/scene/types'

const ink = '#ffffff'

describe('drawing effect math', () => {
  it('maps UV points to canvas px', () => {
    const s: Stroke = { tool: 'line', points: [[0, 0], [1, 0.5]], color: ink, width: 2 }
    expect(strokePath(s, 200, 100)).toEqual([[0, 0], [200, 50]])
  })

  it('closes a rect and makes an ellipse polygon', () => {
    const r = strokePath({ tool: 'rect', points: [[0, 0], [1, 1]], color: ink, width: 1 }, 10, 20)
    expect(r).toHaveLength(5)
    expect(r[0]).toEqual(r[4])
    expect(pathLength(r)).toBeCloseTo(60)
    const e = strokePath({ tool: 'ellipse', points: [[0, 0], [1, 1]], color: ink, width: 1 }, 100, 100)
    expect(pathLength(e)).toBeCloseTo(Math.PI * 100, 0)
  })

  it('closes a polygon and draws a circle with its radius in surface px', () => {
    const pg = strokePath({ tool: 'polygon', points: [[0, 0], [1, 0], [0, 1]], color: ink, width: 1 }, 10, 10)
    expect(pg).toHaveLength(4)
    expect(pg[3]).toEqual(pg[0])
    expect(pathLength(pg)).toBeCloseTo(20 + Math.SQRT2 * 10)
    // centre (0.5, 0.5), rim 0.1 to the right on a 200 x 100 face: radius 20 px, a true circle
    const c = strokePath({ tool: 'circle', points: [[0.5, 0.5], [0.6, 0.5]], color: ink, width: 1 }, 200, 100)
    expect(pathLength(c)).toBeCloseTo(2 * Math.PI * 20, 0)
    const ys = c.map((q) => q[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40, 0)
    expect(parseStrokes([{ tool: 'polygon', points: [[0, 0], [1, 0], [1, 1]], color: '#ff0000', width: 2, fill: true }, { tool: 'circle', points: [[0.5, 0.5], [0.6, 0.5]], color: '#00ff00', width: 0, fill: true }]).map((x) => x.tool)).toEqual(['polygon', 'circle'])
  })

  it('cuts a path at a length', () => {
    const p: Array<[number, number]> = [[0, 0], [10, 0], [10, 10]]
    expect(cutPath(p, 5)).toEqual([[0, 0], [5, 0]])
    expect(cutPath(p, 15)).toEqual([[0, 0], [10, 0], [10, 5]])
    expect(cutPath(p, 99)).toEqual(p)
  })

  it('measures strokes for the reveal (text by its width, dots by their width)', () => {
    const strokes: Stroke[] = [
      { tool: 'line', points: [[0, 0], [1, 0]], color: ink, width: 2 },
      { tool: 'pen', points: [[0.5, 0.5], [0.5, 0.5]], color: ink, width: 4 },
      { tool: 'text', points: [[0, 0]], color: ink, width: 0, text: 'abcd', size: 10 },
    ]
    const l = strokeLengths(null, strokes, 100, 50, 1)
    expect(l[0]).toBeCloseTo(100)
    expect(l[1]).toBe(4)
    expect(l[2]).toBeCloseTo(24)
  })

  it('drops malformed strokes and keys arrays stably', () => {
    const raw = [{ tool: 'pen', points: [[0, 0], [1, 1]], color: ink, width: 3 }, { tool: 'blob', points: [] }, null, { tool: 'line', points: [['x', 1]] }]
    expect(parseStrokes(raw)).toHaveLength(1)
    expect(strokesKey(raw)).toBe(strokesKey(raw))
    expect(strokesKey([...raw])).toBe(strokesKey(raw))
    expect(strokesKey([])).not.toBe(strokesKey(raw))
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyPatch } from '../../../../shared/lib/jsonPatch'
import type { Scene, Stroke } from '../../types'
import { appendStroke, buildStroke, clearStrokes, drawOnClip, hitStroke, removeStroke, simplify, strokesOf, drawingEffect, toUv } from './strokes'

const scene: Scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8'))
const srf = (sc: Scene, id: string) => sc.objects.flatMap((o) => o.surfaces).find((x) => x.id === id)!
const style = { color: '#ffffff', width: 4, fill: false, size: 30 }
const size = { width: 400, height: 200 }

describe('flat view strokes', () => {
  it('converts surface px to UV', () => {
    expect(toUv([100, 50], size)).toEqual([0.25, 0.25])
    expect(toUv([1000, -1000], size)).toEqual([1.25, -0.25])
  })

  it('builds strokes and drops tiny ones', () => {
    expect(buildStroke('rect', [[0, 0], [200, 100]], size, { ...style, fill: true })).toEqual({ tool: 'rect', points: [[0, 0], [0.5, 0.5]], color: '#ffffff', width: 4, fill: true })
    expect(buildStroke('line', [[10, 10], [11, 10]], size, style)).toBeNull()
    expect(buildStroke('pen', [[10, 10]], size, style)?.points).toEqual([[0.025, 0.05], [0.025, 0.05]])
    expect(buildStroke('text', [[0, 0]], size, style, '  ')).toBeNull()
    expect(buildStroke('text', [[40, 20]], size, style, 'hi')).toMatchObject({ tool: 'text', text: 'hi', size: 30, points: [[0.1, 0.1]] })
  })

  it('simplifies pen points', () => {
    expect(simplify([[0, 0], [0.1, 0], [0.2, 0], [5, 0], [5.1, 0]], 1)).toEqual([[0, 0], [5, 0], [5.1, 0]])
  })

  it('hits the topmost stroke near a point', () => {
    const strokes: Stroke[] = [
      { tool: 'line', points: [[0, 0.5], [1, 0.5]], color: '#ffffff', width: 2 },
      { tool: 'rect', points: [[0.1, 0.1], [0.3, 0.3]], color: '#ffffff', width: 2, fill: true },
    ]
    expect(hitStroke(strokes, [200, 101], size, 3)).toBe(0)
    expect(hitStroke(strokes, [80, 40], size, 3)).toBe(1)
    expect(hitStroke(strokes, [380, 10], size, 3)).toBe(-1)
  })

  it('appends to an existing drawing effect with an add to /strokes/-', () => {
    const stroke = buildStroke('line', [[0, 0], [100, 100]], size, style)!
    const ops = appendStroke(scene, 'srf_left', stroke, 'fx_new')!
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'add' })
    expect((ops[0] as { path: string }).path).toMatch(/\/effects\/0\/params\/strokes\/-$/)
    const after = applyPatch(scene, ops)
    expect(strokesOf(drawingEffect(srf(after, 'srf_left'))).at(-1)).toEqual(stroke)
  })

  it('adds a drawing effect on the first stroke, then removes and clears', () => {
    const stroke = buildStroke('ellipse', [[0, 0], [100, 100]], size, style)!
    let sc = applyPatch(scene, appendStroke(scene, 'srf_right', stroke, 'fx_new')!)
    expect(drawingEffect(srf(sc, 'srf_right'))).toMatchObject({ id: 'fx_new', effect: 'drawing', params: { reveal: 1, strokes: [stroke] } })
    sc = applyPatch(sc, removeStroke(sc, 'srf_right', stroke)!)
    expect(strokesOf(drawingEffect(srf(sc, 'srf_right')))).toEqual([])
    sc = applyPatch(scene, clearStrokes(scene, 'srf_left')!)
    expect(strokesOf(drawingEffect(srf(sc, 'srf_left')))).toEqual([])
  })

  it('draws strokes on with a clip and switches the always-on drawing off', () => {
    const sc = applyPatch(scene, drawOnClip(scene, 'srf_left', 2, 3, { track: 'trk_x', clip: 'clp_x' })!)
    const clip = sc.timeline.clips.find((c) => c.id === 'clp_x')!
    expect(clip).toMatchObject({ trackId: 'trk_x', effect: 'drawing', start: 2, end: 5 })
    expect((clip.params.strokes as Stroke[]).length).toBe(3)
    expect(sc.timeline.tracks.find((t) => t.id === 'trk_x')!.target).toEqual({ kind: 'surface', id: 'srf_left' })
    expect(drawingEffect(srf(sc, 'srf_left'))!.enabled).toBe(false)
    expect(drawOnClip(scene, 'srf_right', 0, 3, { track: 'a', clip: 'b' })).toBeNull()
  })
})

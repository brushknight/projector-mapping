import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Clip, Scene, Track } from '../entities/scene/types'
import { sdLoops } from './converge'
import type { Vec2 } from './math/homography'
import { evaluateMorph, maskToSdf, morphColor, morphParams, morphSdf, morphShapes, objectGeometry, sdShape, type MorphShape, type PlateSdf } from './morph'
import { evaluateTimeline } from './timeline'

const root = fileURLToPath(new URL('../../../contract/', import.meta.url))
const fixture = JSON.parse(readFileSync(root + 'fixtures/scene.json', 'utf8')) as Scene
const frame = { width: 1920, height: 1080 }
const cube = fixture.timeline.tracks.find((t) => t.id === 'trk_converge') as Track

function grid(step = 40): Vec2[] {
  const out: Vec2[] = []
  for (let y = step / 2; y < frame.height; y += step) for (let x = step / 2; x < frame.width; x += step) out.push([x, y])
  return out
}

/** A disc mask of radius rr (plate units) on a size² grid: a plate whose opening is a circle. */
function discSdf(rr: number, size = 512): PlateSdf {
  const m = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1, py = ((y + 0.5) / size) * 2 - 1
      if (Math.hypot(px, py) <= rr) m[y * size + x] = 255
    }
  return maskToSdf(m, size, 1)
}

const clip = (params: Record<string, unknown>, extra: Partial<Clip> = {}): Clip => ({ id: 'clp_m', trackId: cube.id, effect: 'morph', start: 2, end: 4, fadeIn: 0, fadeOut: 0, params, ...extra })
const inside = (d: number) => d < 0

describe('morph shapes', () => {
  const loops = morphShapes(fixture, cube, morphParams(fixture, clip({})), frame).loops
  const g = objectGeometry(loops)!

  it('defaults to object → circle: the circle at the cube centre, 0.6 × its bounding radius', () => {
    const p = morphParams(fixture, clip({}))
    expect(p.from.kind).toBe('object')
    expect(p.to.kind).toBe('circle')
    const { b } = morphShapes(fixture, cube, p, frame)
    expect(b).toMatchObject({ kind: 'circle', cx: g.cx, cy: g.cy })
    expect((b as Extract<MorphShape, { kind: 'circle' }>).r).toBeCloseTo(0.6 * g.R, 6)
  })

  it('object → circle: p = 0 is the silhouette, p = 1 the circle', () => {
    const { a, b } = morphShapes(fixture, cube, morphParams(fixture, clip({ from: 'object', to: 'circle', toR: 200 })), frame)
    for (const pt of grid()) {
      expect(inside(morphSdf(pt, a, b, 0, frame))).toBe(inside(sdLoops(pt, loops)))
      expect(inside(morphSdf(pt, a, b, 1, frame))).toBe(Math.hypot(pt[0] - g.cx, pt[1] - g.cy) < 200)
    }
    // half way the shape is between the two: the cube's far corner has left, the centre stays lit
    expect(inside(morphSdf([g.cx, g.cy], a, b, 0.5, frame))).toBe(true)
  })

  it('circle → object: p = 0 is the circle, p = 1 the silhouette', () => {
    const { a, b } = morphShapes(fixture, cube, morphParams(fixture, clip({ from: 'circle', to: 'object', fromCx: 300, fromCy: 300, fromR: 150 })), frame)
    for (const pt of grid()) {
      expect(inside(morphSdf(pt, a, b, 0, frame))).toBe(Math.hypot(pt[0] - 300, pt[1] - 300) < 150)
      expect(inside(morphSdf(pt, a, b, 1, frame))).toBe(inside(sdLoops(pt, loops)))
    }
  })

  it('circle → plate: a plate field from its mask, centred on the object', () => {
    const sdf = discSdf(0.5)
    const p = morphParams(fixture, clip({ from: 'circle', to: 'plate:test-disc', toSize: 800 }))
    const { a, b } = morphShapes(fixture, cube, p, frame, () => sdf)
    expect(b).toMatchObject({ kind: 'plate', cx: g.cx, cy: g.cy, half: 400 })
    // the disc of radius 0.5 plate units on an 800 px plate is a 200 px circle; its field is a true distance
    for (const pt of grid()) {
      const want = Math.hypot(pt[0] - g.cx, pt[1] - g.cy) - 200
      if (Math.abs(want) > 6) expect(inside(morphSdf(pt, a, b, 1, frame))).toBe(want < 0)
      expect(inside(morphSdf(pt, a, b, 0, frame))).toBe(inside(sdShape(pt, a, frame)))
    }
    expect(sdShape([g.cx + 300, g.cy], b, frame)).toBeCloseTo(100, -1)
    expect(sdShape([g.cx, g.cy], b, frame)).toBeCloseTo(-200, -1)
  })

  it('animates the fill colour in linear light; from == to holds the shape', () => {
    const p = morphParams(fixture, clip({ from: 'circle', to: 'circle', color: '#000000', colorTo: '#ffffff' }))
    expect(morphColor(p, 0)).toEqual([0, 0, 0])
    expect(morphColor(p, 1)[0]).toBeCloseTo(1, 6)
    // half way in linear light is brighter than half the sRGB code value
    expect(morphColor(p, 0.5)[0]).toBeGreaterThan(0.7)
    const s = morphParams(fixture, { effect: 'shape', params: { shape: 'rect', w: 100, h: 50 } })
    expect(s.from).toEqual(s.to)
  })
})

describe('step-scoped hold (§21)', () => {
  const scene: Scene = {
    ...fixture,
    timeline: {
      ...fixture.timeline,
      tracks: [cube],
      cues: [
        { id: 'c1', at: 0, label: 'lines', autoFollow: false },
        { id: 'c2', at: 2, label: 'fill', autoFollow: false },
        { id: 'c3', at: 4, label: 'circle', autoFollow: false },
      ],
      clips: [
        { id: 'fill', trackId: cube.id, effect: 'fill', start: 2, end: 3, fadeIn: 0, fadeOut: 0, params: {}, hold: 'step' as const },
        { id: 'keep', trackId: cube.id, effect: 'highlight', start: 2, end: 3, fadeIn: 0, fadeOut: 0, params: {}, hold: 'forever' as const },
        { id: 'm', trackId: cube.id, effect: 'morph', start: 4, end: 6, fadeIn: 0, fadeOut: 0, params: { from: 'object', to: 'circle' } },
      ],
    },
  }
  const effects = (t: number) => new Set([...evaluateTimeline(scene, t).values()].flat().map((a) => a.clip.id))

  it('a fill held in step 2 is gone in step 3, a forever hold stays', () => {
    expect(effects(3.5).has('fill')).toBe(true)
    // the transport waits on the cue at 4: the step's end state still shows there
    expect(effects(4).has('fill')).toBe(true)
    expect(effects(4.01).has('fill')).toBe(false)
    expect(effects(4.01).has('keep')).toBe(true)
  })

  it('a morph holds its end to the end of its step (none after the last cue)', () => {
    expect(evaluateMorph(scene, 5)[0].progress).toBeCloseTo(0.5)
    expect(evaluateMorph(scene, 9)[0].held).toBe(true)
  })

  it('true reads as step', () => {
    const s2: Scene = { ...scene, timeline: { ...scene.timeline, clips: scene.timeline.clips.map((c) => (c.id === 'fill' ? { ...c, hold: true } : c)) } }
    expect([...evaluateTimeline(s2, 4.5).values()].flat().some((a) => a.clip.id === 'fill')).toBe(false)
  })
})

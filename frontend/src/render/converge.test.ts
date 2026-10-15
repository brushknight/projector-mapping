import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../entities/catalog/types'
import type { Clip, Scene, Track } from '../entities/scene/types'
import {
  convergeCoverage,
  convergeEase,
  convergeLoops,
  convergeParams,
  convergeSdf,
  convergeStart,
  evaluateConverge,
  plateOpening,
  sdLoops,
  sdStart,
  type StartShape,
} from './converge'
import type { Vec2 } from './math/homography'
import { plateDef } from './plates'

const root = fileURLToPath(new URL('../../../contract/', import.meta.url))
const fixture = JSON.parse(readFileSync(root + 'fixtures/scene.json', 'utf8')) as Scene
const catalog = JSON.parse(readFileSync(root + 'catalog.json', 'utf8')) as Catalog
const frame = { width: 1920, height: 1080 }
const cubeTrack = fixture.timeline.tracks.find((t) => t.id === 'trk_converge') as Track

/** A grid of sample points over the frame. */
function grid(step = 24): Vec2[] {
  const out: Vec2[] = []
  for (let y = step / 2; y < frame.height; y += step) for (let x = step / 2; x < frame.width; x += step) out.push([x, y])
  return out
}

const inside = (d: number) => d < 0

describe('converge shapes', () => {
  const loops = convergeLoops(fixture, cubeTrack)

  it('lands on the cube silhouette: the outer hexagon of its three faces, no details', () => {
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(6)
    const xs = loops[0].map((p) => p[0]), ys = loops[0].map((p) => p[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([690, 1230, 300, 900])
    // the centre point (where the faces meet) is inside, a fan or bay point too; the corners of the frame are not
    expect(sdLoops([960, 600], loops)).toBeLessThan(0)
    expect(sdLoops([825, 525], loops)).toBeLessThan(0)
    expect(sdLoops([100, 100], loops)).toBeGreaterThan(0)
  })

  it('starts from the light: the plate field circle for current and circle, the frame for frame', () => {
    const params = convergeParams(fixture, { params: { from: 'current', source: 'static' } })
    const cur = convergeStart(fixture, params, frame, catalog)
    expect(cur.kind).toBe('circle')
    const c = cur as Extract<StartShape, { kind: 'circle' }>
    // the window sits at the frame centre, lifted by its sun motion parked half way (via y −0.04)
    expect(c.cx).toBeCloseTo(960, 0)
    expect(c.cy).toBeCloseTo(540 - 0.04 * 1080, 0)
    // the window's reach (its corners) × 0.54 × scale 1.1 of the frame height, grown by the throw, skew and focus blur
    const win = plateOpening(plateDef('plate-grid-window')!, fixture.backdrop.static.attachments![0].params as Record<string, unknown>)
    expect(win).toBeGreaterThan(0.6)
    expect(win).toBeLessThan(0.84)
    expect(c.r).toBeGreaterThan(win * 0.54 * 1.1 * 1080)
    expect(convergeStart(fixture, { ...params, from: 'frame' }, frame, catalog)).toEqual({ kind: 'frame' })
    // no attachments: current is the frame, circle the frame's inscribed circle
    const bare = { ...fixture, backdrop: { ...fixture.backdrop, static: { ...fixture.backdrop.static, attachments: [] } } } as Scene
    expect(convergeStart(bare, params, frame, catalog)).toEqual({ kind: 'frame' })
    expect(convergeStart(bare, { ...params, from: 'circle' }, frame, catalog)).toEqual({ kind: 'circle', cx: 960, cy: 540, r: 540 })
    // colour and scenery have no light: the frame
    expect(convergeStart(fixture, { from: 'current', source: 'color' }, frame, catalog)).toEqual({ kind: 'frame' })
  })

  it('starts a round spot from the spot itself, not its whole field', () => {
    expect(plateOpening(plateDef('plate-circle')!)).toBeCloseTo(0.25, 3)
    const att = { ...fixture.backdrop.static.attachments![0], gobo: 'plate-circle', params: {}, scale: 2, motion: null }
    const spot = { ...fixture, backdrop: { ...fixture.backdrop, static: { ...fixture.backdrop.static, light: { ...fixture.backdrop.static.light!, focus: 1, slide: { x: 0, y: 0 }, motion: null }, attachments: [att] } }, timeline: { ...fixture.timeline, clips: [] } } as Scene
    const st = convergeStart(spot, { from: 'current', source: 'static' }, frame, catalog) as Extract<StartShape, { kind: 'circle' }>
    expect(st).toMatchObject({ kind: 'circle', cx: 960, cy: 540 })
    expect(st.r).toBeCloseTo(0.25 * 0.54 * 2 * 1080, 0)
  })

  for (const start of [{ kind: 'frame' } as StartShape, { kind: 'circle', cx: 960, cy: 540, r: 540 } as StartShape, { kind: 'circle', cx: 900, cy: 560, r: 700 } as StartShape]) {
    it(`morphs from the start shape to the silhouette (${start.kind}${start.kind === 'circle' ? ` r ${start.r}` : ''})`, () => {
      const pts = grid()
      // p = 0 is exactly the start shape, p = 1 exactly the silhouette
      for (const p of pts) {
        expect(inside(convergeSdf(p, start, loops, 0, frame))).toBe(inside(sdStart(p, start, frame)))
        expect(inside(convergeSdf(p, start, loops, 1, frame))).toBe(inside(sdLoops(p, loops)))
      }
      // the lit area shrinks monotonically: nothing outside at one step is inside at a later one
      let prev = pts.map((p) => inside(convergeSdf(p, start, loops, 0, frame)))
      let prevCount = prev.filter(Boolean).length
      for (let e = 0.05; e <= 1.0001; e += 0.05) {
        const cur = pts.map((p) => inside(convergeSdf(p, start, loops, e, frame)))
        cur.forEach((v, i) => {
          if (v) expect(prev[i], `point ${pts[i]} lit again at ${e.toFixed(2)}`).toBe(true)
        })
        const count = cur.filter(Boolean).length
        expect(count).toBeLessThanOrEqual(prevCount)
        prev = cur
        prevCount = count
      }
      // the silhouette itself stays lit the whole way
      for (const e of [0, 0.25, 0.5, 0.75, 1]) expect(inside(convergeSdf([960, 600], start, loops, e, frame))).toBe(true)
      expect(prevCount).toBe(pts.filter((p) => inside(sdLoops(p, loops))).length)
    })
  }

  it('softens the edge and keeps the frame border lit at the start', () => {
    expect(convergeCoverage(-10, 6)).toBe(1)
    expect(convergeCoverage(10, 6)).toBe(0)
    expect(convergeCoverage(0, 6)).toBeCloseTo(0.5)
    // with a soft edge the frame start is padded, so the corner pixel is fully lit at p = 0
    expect(convergeCoverage(convergeSdf([0.5, 0.5], { kind: 'frame' }, loops, 0, frame, 6), 6)).toBe(1)
  })

  it('eases', () => {
    for (const k of ['inOut', 'in', 'out', 'linear'] as const) {
      expect(convergeEase(k, 0)).toBe(0)
      expect(convergeEase(k, 1)).toBe(1)
      let last = 0
      for (let u = 0.1; u <= 1; u += 0.1) {
        const v = convergeEase(k, u)
        expect(v).toBeGreaterThanOrEqual(last)
        last = v
      }
    }
    expect(convergeEase('inOut', 0.5)).toBeCloseTo(0.5)
    expect(convergeEase('in', 0.5)).toBeCloseTo(0.25)
  })

  it('an object with no faces converges to nothing', () => {
    const empty = { ...fixture, objects: fixture.objects.map((o) => (o.id === 'obj_cube' ? { ...o, visible: false } : o)) } as Scene
    expect(convergeLoops(empty, cubeTrack)).toEqual([])
    expect(inside(convergeSdf([960, 600], { kind: 'frame' }, [], 1, frame))).toBe(false)
  })
})

describe('converge clips', () => {
  it('play, then hold at the silhouette until the next converge on the track', () => {
    const at = (t: number) => evaluateConverge(fixture, t)
    expect(at(0)).toHaveLength(1)
    expect(at(0)[0].progress).toBe(0)
    expect(at(1)[0].e).toBeCloseTo(0.5)
    const held = at(10)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ progress: 1, e: 1, held: true, alpha: 1 })
    expect(held[0].params).toEqual({ from: 'current', source: 'static', ease: 'inOut', edge: 6, outline: true })
    expect(evaluateConverge(fixture, 10, new Set(['trk_converge']))).toEqual([])
    // a second converge on the track takes over; with hold false it lets go at its end
    const second: Clip = { ...fixture.timeline.clips.find((c) => c.id === 'clp_converge')!, id: 'clp_c2', start: 12, end: 13, hold: false }
    const sc = { ...fixture, timeline: { ...fixture.timeline, clips: [...fixture.timeline.clips, second] } } as Scene
    expect(evaluateConverge(sc, 11).map((s) => s.clip.id)).toEqual(['clp_converge'])
    expect(evaluateConverge(sc, 12.5).map((s) => s.clip.id)).toEqual(['clp_c2'])
    expect(evaluateConverge(sc, 14)).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { forgetTour, rememberTour, stepAfter, tourSeen } from '../../../../shared/components/tour/memory'
import { tourCardPosition } from '../../../../shared/components/tour'
import { tipPosition } from '../../../../shared/components/tooltip'
import type { Scene } from '../../types'
import { CONTENT_TOUR_KEY, contentCrumbs, contentTitle, faceHasContent, miniMap, objectHasContent } from './model'

const fixture = () => JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8')) as Scene

describe('where you are in content', () => {
  it('breadcrumbs go object › face, and object › face › detail for a detail', () => {
    const sc = fixture()
    expect(contentCrumbs(sc, 'obj_cube', null)).toEqual([{ kind: 'object', id: 'obj_cube', label: 'zimacube' }])
    expect(contentCrumbs(sc, 'obj_cube', 'srf_right').map((c) => c.label)).toEqual(['zimacube', 'right'])
    expect(contentCrumbs(sc, 'obj_cube', 'srf_bay0').map((c) => c.id)).toEqual(['obj_cube', 'srf_right', 'srf_bay0'])
    expect(contentCrumbs(sc, 'obj_nope', 'srf_right')).toEqual([])
  })
  it('titles say what you edit', () => {
    const sc = fixture()
    expect(contentTitle(sc, 'obj_cube', 'srf_right')).toBe('zimacube · right face')
    expect(contentTitle(sc, 'obj_cube', null)).toBe('zimacube · all faces')
    expect(contentTitle(sc, 'obj_cube', 'srf_bay0')).toBe('zimacube · bay 1 on right')
    sc.objects[0].surfaces[2].name = 'front face'
    expect(contentTitle(sc, 'obj_cube', 'srf_right')).toBe('zimacube · front face')
  })
})

describe('empty faces and objects', () => {
  it('a face with a picture, an effect, strokes or a clip has content', () => {
    const sc = fixture()
    expect(faceHasContent(sc, 'srf_right')).toBe(true) // a picture
    expect(faceHasContent(sc, 'srf_top')).toBe(true) // trace
    expect(faceHasContent(sc, 'srf_left')).toBe(true) // a drawing with strokes
    expect(faceHasContent(sc, 'srf_bay0')).toBe(true) // a timeline clip
    expect(faceHasContent(sc, 'srf_shelf')).toBe(false)
  })
  it('a drawing without strokes is still empty', () => {
    const sc = fixture()
    sc.objects[0].surfaces[1].effects = [{ id: 'fx_d', effect: 'drawing', enabled: true, params: { strokes: [] } }]
    expect(faceHasContent(sc, 'srf_left')).toBe(false)
  })
  it('an object is empty when nothing spans it and no face has content', () => {
    const sc = fixture()
    expect(objectHasContent(sc, 'obj_cube')).toBe(true)
    sc.timeline.tracks = sc.timeline.tracks.filter((t) => !(t.target.kind === 'object' && t.target.id === 'obj_shelf'))
    expect(objectHasContent(sc, 'obj_shelf')).toBe(false)
  })
})

describe('mini map', () => {
  it('outlines the faces as on the stage with details last and a margin around them', () => {
    const sc = fixture()
    const m = miniMap(sc, sc.objects[0])!
    expect(m.faces.map((f) => f.id)).not.toContain('srf_edges')
    expect(m.faces.findIndex((f) => f.detail)).toBeGreaterThan(m.faces.findIndex((f) => f.id === 'srf_right'))
    const xs = m.faces.flatMap((f) => f.pts.map((p) => p.x))
    expect(m.box.x).toBeLessThan(Math.min(...xs))
    expect(m.box.x + m.box.w).toBeGreaterThan(Math.max(...xs))
    // the fan is a circle: drawn as a polygon
    expect(m.faces.find((f) => f.id === 'srf_fan')!.pts.length).toBe(48)
  })
  it('has nothing to draw for an object without faces', () => {
    const sc = fixture()
    expect(miniMap(sc, { id: 'o', name: 'o', tags: [], visible: true, surfaces: [] })).toBeNull()
  })
})

describe('the tour remembers it was seen', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  }
  it('stores, reads and forgets', () => {
    const st = mem()
    expect(tourSeen(CONTENT_TOUR_KEY, st)).toBe(false)
    expect(rememberTour(CONTENT_TOUR_KEY, st)).toBe(true)
    expect(tourSeen(CONTENT_TOUR_KEY, st)).toBe(true)
    forgetTour(CONTENT_TOUR_KEY, st)
    expect(tourSeen(CONTENT_TOUR_KEY, st)).toBe(false)
  })
  it('survives storage that throws or is missing', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(tourSeen(CONTENT_TOUR_KEY, bad)).toBe(false)
    expect(rememberTour(CONTENT_TOUR_KEY, bad)).toBe(false)
    expect(() => forgetTour(CONTENT_TOUR_KEY, bad)).not.toThrow()
    expect(tourSeen(CONTENT_TOUR_KEY, null)).toBe(false)
    expect(rememberTour(CONTENT_TOUR_KEY, null)).toBe(false)
  })
  it('steps forward, back and ends after the last step', () => {
    expect(stepAfter(0, 4, 1)).toBe(1)
    expect(stepAfter(3, 4, 1)).toBeNull()
    expect(stepAfter(0, 4, -1)).toBe(0)
    expect(stepAfter(2, 4, -1)).toBe(1)
  })
})

describe('tour card and tooltip placement', () => {
  const vp = { width: 1200, height: 800 }
  it('puts the card under the target, above it near the bottom, in the middle without one', () => {
    expect(tourCardPosition({ left: 100, top: 50, width: 200, height: 30 }, vp)).toEqual({ left: 100, top: 94 })
    expect(tourCardPosition({ left: 100, top: 700, width: 200, height: 60 }, vp).top).toBe(700 - 14 - 176)
    expect(tourCardPosition(null, vp)).toEqual({ left: 440, top: 312 })
    // kept inside the viewport on the right
    expect(tourCardPosition({ left: 1150, top: 50, width: 40, height: 30 }, vp).left).toBe(1200 - 320 - 12)
  })
  it('centres a tooltip on its anchor and keeps it on screen', () => {
    expect(tipPosition({ left: 500, top: 100, width: 100, height: 30 }, 'bottom', vp)).toEqual({ x: 550, y: 138 })
    expect(tipPosition({ left: 500, top: 100, width: 100, height: 30 }, 'top', vp).y).toBe(92)
    expect(tipPosition({ left: 0, top: 0, width: 20, height: 20 }, 'bottom', vp).x).toBe(128)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyPatch } from '../../shared/lib/jsonPatch'
import * as ops from './ops'
import { onAirPlan } from './lib'
import type { Scene } from './types'

const scene: Scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8'))
const run = (o: ReturnType<typeof ops.movePoint>) => applyPatch(scene, o!)

describe('scene ops', () => {
  it('moves a point by id', () => {
    const s = run(ops.movePoint(scene, 'p_r', 1300, 455))
    expect(s.points.find((p) => p.id === 'p_r')).toEqual({ id: 'p_r', x: 1300, y: 455 })
  })

  it('welds two points so both faces share one', () => {
    const s = run(ops.mergePoint(scene, 'p_shelf1', 'p_t'))
    expect(s.points.some((p) => p.id === 'p_shelf1')).toBe(false)
    const shelf = s.objects.find((o) => o.id === 'obj_shelf')!.surfaces[0]
    expect(shelf.pointIds).toContain('p_t')
  })

  it('deletes a surface with its details and orphan points', () => {
    const s = run(ops.deleteSurface(scene, 'srf_right'))
    const ids = s.objects.flatMap((o) => o.surfaces.map((x) => x.id))
    expect(ids).not.toContain('srf_right')
    expect(ids).not.toContain('srf_bay0') // detail child
    expect(s.points.some((p) => p.id === 'p_bay0_0')).toBe(false)
    expect(s.points.some((p) => p.id === 'p_br')).toBe(true) // the edges line still uses it
  })

  it('adds a surface to a new object with new points', () => {
    const srf = { id: 'srf_n', name: 'n', kind: 'tri' as const, role: 'face' as const, pointIds: ['a', 'b', 'p_t'], parentId: null, visible: true, mesh: null, effects: [], opacity: 1, softEdge: 0 }
    const s = run(ops.addSurface(scene, null, srf, [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }], { id: 'obj_n', name: 'thing', tags: [], visible: true }))
    expect(s.objects.at(-1)!.surfaces[0].id).toBe('srf_n')
    expect(s.points.slice(-2).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('moves layers and clips and recomputes on a newer doc', () => {
    const s = run(ops.moveLayer(scene, 'lay_live_window', 1))
    expect(s.backdrop.live.layers.map((l) => l.id)).toEqual(['lay_tree', 'lay_live_window'])
    expect(s.backdrop.static.layers.map((l) => l.id)).toEqual(['lay_window'])
    const c = run(ops.setClipTimes(scene, 'clp_trace', 4.5, 6.25))
    expect(c.timeline.clips.find((x) => x.id === 'clp_trace')).toMatchObject({ start: 4.5, end: 6.25 })
    // on a newer document with a clip removed in front, the same intent still finds the clip
    const newer = run(ops.removeClip(scene, 'clp_grid'))
    const again = applyPatch(newer, ops.setClipTimes(newer, 'clp_trace', 1, 2)!)
    expect(again.timeline.clips.find((x) => x.id === 'clp_trace')).toMatchObject({ start: 1, end: 2 })
  })

  it('removes a track with its clips', () => {
    const s = run(ops.removeTrack(scene, 'trk_faces'))
    expect(s.timeline.tracks.some((t) => t.id === 'trk_faces')).toBe(false)
    expect(s.timeline.clips.some((c) => c.trackId === 'trk_faces')).toBe(false)
  })

  it('builds flat meshes', () => {
    expect(ops.flatMesh(4, 4).offsets).toHaveLength(25)
    const s = run(ops.setMesh(scene, 'srf_top', ops.flatMesh(2, 2)))
    const s2 = applyPatch(s, ops.setMeshOffset(s, 'srf_top', 4, 3, -2)!)
    expect(s2.objects[0].surfaces[0].mesh!.offsets[4]).toEqual([3, -2])
  })

  it('returns null for missing targets', () => {
    expect(ops.movePoint(scene, 'nope', 0, 0)).toBeNull()
    expect(ops.deleteSurface(scene, 'nope')).toBeNull()
    expect(ops.sortedCues(scene).map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('switches mode with a leaf replace', () => {
    expect(run(ops.setMode('objects')).mode).toBe('objects')
  })

  it('picks a gobo by replacing the static stack and keeps the light', () => {
    const layer = { ...scene.backdrop.static.layers[0], id: 'lay_new', ref: 'blinds', name: 'blinds', light: null }
    const s = run(ops.pickSingle({ ...scene, mode: 'live' }, 'static', layer, ['light']))
    expect(s.backdrop.static.layers).toHaveLength(1)
    expect(s.backdrop.static.layers[0]).toMatchObject({ id: 'lay_new', ref: 'blinds', light: scene.backdrop.static.layers[0].light })
    expect(s.mode).toBe('static')
    expect(s.backdrop.live.layers).toHaveLength(2)
  })

  it('applies a preset to its own stack and switches to its mode', () => {
    const layer = { ...scene.backdrop.scenery.layers[0], id: 'lay_beach', ref: 'beach' }
    const s = run(ops.applyPresetOps({ mode: 'scenery', backdrop: { layers: [layer] } }))
    expect(s.mode).toBe('scenery')
    expect(s.backdrop.scenery.layers.map((l) => l.id)).toEqual(['lay_beach'])
    expect(s.backdrop.static.layers.map((l) => l.id)).toEqual(['lay_window'])
  })

  it('plans what goes on air per mode', () => {
    expect(onAirPlan(scene, 'static')).toMatchObject({ objects: false, level: 1 })
    expect(onAirPlan(scene, 'static').layers.map((l) => l.id)).toEqual(['lay_window'])
    expect(onAirPlan(scene, 'scenery').layers.map((l) => l.id)).toEqual(['lay_flowers'])
    expect(onAirPlan(scene, 'objects')).toEqual({ layers: [], level: 0.35, objects: true })
    const under = onAirPlan({ ...scene, underlay: { on: true, from: 'color', level: 0.2 } }, 'objects')
    expect(under.layers.map((l) => l.id)).toEqual(['lay_ember'])
    expect(under.level).toBe(0.2)
  })
})

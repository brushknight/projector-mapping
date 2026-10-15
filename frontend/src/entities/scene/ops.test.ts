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
    const s = run(ops.moveLayer(scene, 'lay_ember', 1))
    expect(s.backdrop.color.layers.map((l) => l.id)).toEqual(['lay_hue', 'lay_ember'])
    expect(s.backdrop.live.layers.map((l) => l.id)).toEqual(['lay_tree'])
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

  it('picks a gradient by replacing the color stack and keeps the params asked for', () => {
    const layer = { ...scene.backdrop.color.layers[0], id: 'lay_new', ref: 'dusk', name: 'dusk', params: {} }
    const s = run(ops.pickSingle({ ...scene, mode: 'live' }, 'color', layer, ['params']))
    expect(s.backdrop.color.layers).toHaveLength(1)
    expect(s.backdrop.color.layers[0]).toMatchObject({ id: 'lay_new', ref: 'dusk', params: scene.backdrop.color.layers[0].params })
    expect(s.mode).toBe('color')
    expect(s.backdrop.live.layers).toHaveLength(1)
  })

  it('applies a preset to its own stack and switches to its mode', () => {
    const layer = { ...scene.backdrop.scenery.layers[0], id: 'lay_beach', ref: 'beach' }
    const s = run(ops.applyPresetOps({ mode: 'scenery', backdrop: { layers: [layer] } }))
    expect(s.mode).toBe('scenery')
    expect(s.backdrop.scenery.layers.map((l) => l.id)).toEqual(['lay_beach'])
    expect(s.backdrop.static.attachments?.map((a) => a.id)).toEqual(['att_window'])
    // a static preset brings its light and attachments
    const st = run(ops.applyPresetOps({ mode: 'static', backdrop: { layers: [], light: null, attachments: [] } }))
    expect(st.backdrop.static.attachments).toEqual([])
  })

  it('plans what goes on air per mode', () => {
    expect(onAirPlan(scene, 'static')).toMatchObject({ objects: false, level: 1 })
    expect(onAirPlan(scene, 'static').layers).toEqual([])
    expect(onAirPlan(scene, 'live').layers.map((l) => l.id)).toEqual(['lay_tree'])
    expect(onAirPlan(scene, 'scenery').layers.map((l) => l.id)).toEqual(['lay_waves', 'lay_flowers'])
    expect(onAirPlan(scene, 'objects')).toEqual({ layers: [], level: 0.35, objects: true })
    const under = onAirPlan({ ...scene, underlay: { on: true, from: 'color', level: 0.2 } }, 'objects')
    expect(under.layers.map((l) => l.id)).toEqual(['lay_ember', 'lay_hue'])
    expect(under.level).toBe(0.2)
  })
})

describe('sound ops (§14)', () => {
  const noSound: Scene = { ...scene, timeline: { ...scene.timeline, tracks: scene.timeline.tracks.filter((t) => t.target.kind !== 'sound'), clips: scene.timeline.clips.filter((c) => c.effect !== 'sound') } }

  it('adds a sound clip to the first sound track', () => {
    const clip = ops.soundClip('clp_x', 'trk_faces', 'a77c31', 1, 3.5)
    const s = applyPatch(scene, ops.addSoundClip(scene, clip, 'trk_new'))
    expect(s.timeline.clips.find((c) => c.id === 'clp_x')).toMatchObject({ trackId: 'trk_sound', effect: 'sound', start: 1, end: 3.5, params: { sound: 'a77c31', offset: 0, volume: 1 } })
    expect(s.timeline.tracks.length).toBe(scene.timeline.tracks.length)
  })

  it('makes a sound track when there is none', () => {
    const s = applyPatch(noSound, ops.addSoundClip(noSound, ops.soundClip('clp_x', '', 'a77c31', 0, 2), 'trk_new'))
    expect(s.timeline.tracks.at(-1)).toEqual({ id: 'trk_new', name: 'sound', target: { kind: 'sound', id: null } })
    expect(s.timeline.clips.at(-1)?.trackId).toBe('trk_new')
    expect(ops.firstSoundTrack(noSound)).toBeNull()
  })

  it('changes clip params as leaves', () => {
    const o = ops.setClipParams(scene, 'clp_rain', { volume: 0.5, offset: 0.5, sound: 'a77c31' })!
    expect(o).toEqual([
      { op: 'replace', path: '/timeline/clips/11/params/volume', value: 0.5 },
      { op: 'replace', path: '/timeline/clips/11/params/sound', value: 'a77c31' },
    ])
    expect(ops.setClipParams(scene, 'clp_grid', { volume: 1 })).toEqual([{ op: 'add', path: '/timeline/clips/0/params/volume', value: 1 }])
    expect(ops.setClipParams(scene, 'nope', { volume: 1 })).toBeNull()
  })

  it('sets, replaces and clears a cue sound', () => {
    let s = applyPatch(scene, ops.setCueSound(scene, 'cue_2', { sound: '5d1e0a', volume: 2 })!)
    expect(s.timeline.cues.find((c) => c.id === 'cue_2')?.sound).toEqual({ sound: '5d1e0a', volume: 1 })
    s = applyPatch(s, ops.setCueSound(s, 'cue_1', { sound: '5d1e0a', volume: 0.3 })!)
    expect(s.timeline.cues.find((c) => c.id === 'cue_1')?.sound).toEqual({ sound: '5d1e0a', volume: 0.3 })
    s = applyPatch(s, ops.setCueSound(s, 'cue_1', null)!)
    expect('sound' in s.timeline.cues.find((c) => c.id === 'cue_1')!).toBe(false)
    expect(ops.setCueSound(s, 'cue_1', null)).toBeNull()
  })
})

// ── §15 ──────────────────────────────────────────────────────────────────────
import { addAttachment, attachmentPath, lightPath, pickAttachment, removeAttachment, setMotion, setStackLight } from './ops'
import fixture from '../../../../contract/fixtures/scene.json'
import type { Attachment, Scene as SceneT } from './types'

describe('light and attachment ops (§15)', () => {
  const sc = fixture as unknown as SceneT
  const att: Attachment = { id: 'att_new', gobo: 'blinds', name: 'blinds', visible: true, opacity: 1, rotation: 0, offsetX: 0, offsetY: 0, scale: 1.4, params: {}, motion: null }
  it('paths into the light and attachments', () => {
    expect(lightPath('static', 'slide', 'x')).toBe('/backdrop/static/light/slide/x')
    expect(attachmentPath(sc, 'att_live_window', 'rotation')).toBe('/backdrop/live/attachments/0/rotation')
    expect(attachmentPath(sc, 'nope')).toBeNull()
  })
  it('picks one attachment and puts static on air, in the place of the one it replaces (§16)', () => {
    const ops = pickAttachment({ ...sc, mode: 'live' }, 'static', att)
    const old = sc.backdrop.static.attachments![0]
    expect(ops[0]).toEqual({ op: 'replace', path: '/backdrop/static/attachments', value: [{ ...att, id: old.id, rotation: old.rotation, scale: old.scale, offsetX: old.offsetX, offsetY: old.offsetY, opacity: old.opacity, visible: old.visible, motion: old.motion }] })
    const empty = { ...sc, mode: 'live', backdrop: { ...sc.backdrop, static: { ...sc.backdrop.static, attachments: [] } } } as SceneT
    expect(pickAttachment(empty, 'static', att)[0]).toEqual({ op: 'replace', path: '/backdrop/static/attachments', value: [att] })
    expect(ops.at(-1)).toEqual({ op: 'replace', path: '/mode', value: 'static' })
  })
  it('adds on top and removes', () => {
    expect(addAttachment(sc, 'static', att)).toEqual([{ op: 'add', path: '/backdrop/static/attachments/-', value: att }])
    expect(removeAttachment(sc, 'att_window')).toEqual([{ op: 'remove', path: '/backdrop/static/attachments/0' }])
  })
  it('sets a motion on the light, an attachment or a photo layer', () => {
    expect(setMotion(sc, { kind: 'light', mode: 'static' }, null)?.[0].path).toBe('/backdrop/static/light/motion')
    expect(setMotion(sc, { kind: 'attachment', id: 'att_window' }, null)?.[0]).toEqual({ op: 'replace', path: '/backdrop/static/attachments/0/motion', value: null })
    expect(setMotion(sc, { kind: 'layer', id: 'lay_flowers' }, null)?.[0].op).toBe('replace')
    expect(setMotion(sc, { kind: 'layer', id: 'lay_ember' }, null)?.[0].op).toBe('add')
  })
  it('adds a light to a live stack that has none', () => {
    const noLight = { ...sc, backdrop: { ...sc.backdrop, live: { layers: [] } } } as SceneT
    expect(setStackLight(noLight, 'live', null)[0].op).toBe('add')
  })
})

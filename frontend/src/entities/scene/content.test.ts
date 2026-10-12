import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyPatch } from '../../shared/lib/jsonPatch'
import { addContentLayer, contentLayerPath, deleteSurface, gradientLayer, locateContentLayer, mediaLayer, moveContentLayer, removeContentLayer, setAtlas } from './ops'
import type { Scene } from './types'
import { railSteps } from './ui/rail'

const fixture = () => JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8')) as Scene

describe('content layer ops (protocol §12)', () => {
  it('finds surface and object layers', () => {
    const sc = fixture()
    expect(locateContentLayer(sc, 'cl_sweep')?.owner).toEqual({ kind: 'object', id: 'obj_cube' })
    expect(contentLayerPath(sc, 'cl_flowers', 'fit')).toBe('/objects/0/surfaces/2/layers/0/fit')
  })
  it('creates the list for the first layer and appends after that', () => {
    let sc = fixture()
    const ops = addContentLayer(sc, { kind: 'surface', id: 'srf_top' }, mediaLayer('cl_a', 'flowers', 'a'))!
    expect(ops).toEqual([{ op: 'add', path: '/objects/0/surfaces/0/layers', value: [expect.objectContaining({ id: 'cl_a' })] }])
    sc = applyPatch(sc, ops)
    const more = addContentLayer(sc, { kind: 'surface', id: 'srf_top' }, gradientLayer('cl_b'))!
    expect(more[0].path).toBe('/objects/0/surfaces/0/layers/-')
    sc = applyPatch(sc, more)
    expect(moveContentLayer(sc, 'cl_b', -1)).toEqual([{ op: 'move', from: '/objects/0/surfaces/0/layers/1', path: '/objects/0/surfaces/0/layers/0' }])
  })
  it('removing the last layer removes the list and the tracks that animate it', () => {
    const sc = fixture()
    const ops = removeContentLayer(sc, 'cl_sweep')!
    const after = applyPatch(sc, ops)
    expect(after.objects[0].layers).toBeUndefined()
    expect(after.timeline.tracks.some((t) => t.id === 'trk_sweep')).toBe(false)
    expect(after.timeline.clips.some((c) => c.id === 'clp_sweep')).toBe(false)
  })
  it('deleting a face drops its atlas rect and the tracks of its layers', () => {
    const sc = fixture()
    const after = applyPatch(sc, deleteSurface(sc, 'srf_right')!)
    expect(Object.keys(after.objects[0].atlas!.faces).sort()).toEqual(['srf_left', 'srf_top'])
    expect(after.timeline.tracks.some((t) => t.target.kind === 'surface' && t.target.id === 'srf_bay0')).toBe(false)
  })
  it('stores an atlas', () => {
    const sc = fixture()
    expect(setAtlas(sc, 'obj_lamp', { width: 1, height: 1, faces: {} })).toEqual([{ op: 'add', path: '/objects/1/atlas', value: { width: 1, height: 1, faces: {} } }])
  })
})

describe('the 4-step rail', () => {
  it('lights steps from the scene and the setup', () => {
    const sc = fixture()
    expect(railSteps(sc, { referenceAsset: null, calibrationId: null }, false)).toEqual({ reference: false, faces: true, content: true, play: false })
    expect(railSteps({ ...sc, mode: 'objects' }, { referenceAsset: 'abc', calibrationId: null }, false).play).toBe(true)
    expect(railSteps(null, null, true)).toEqual({ reference: true, faces: false, content: false, play: false })
  })
})

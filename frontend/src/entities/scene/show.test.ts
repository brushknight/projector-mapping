import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyPatch } from '../../shared/lib/jsonPatch'
import * as ops from './ops'
import type { Scene, SoundPad } from './types'

const scene: Scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8'))
const pad: SoundPad = { id: 'pad_door', name: 'door', sound: 'a77c31', volume: 1, color: 'amber', icon: 'door', key: 'd', loop: false }

describe('show ops: picks', () => {
  it('a gobo pick keeps the layer id and the light, and puts static on air', () => {
    const s = applyPatch({ ...scene, mode: 'live' }, ops.pickOne({ ...scene, mode: 'live' }, 'static', { id: 'lay_new', kind: 'gobo', ref: 'blinds', name: 'blinds', visible: true, opacity: 1, blend: 'normal', light: { ...scene.backdrop.static.layers[0].light!, intensity: 0.1 }, params: {} }))
    expect(s.mode).toBe('static')
    expect(s.backdrop.static.layers).toHaveLength(1)
    expect(s.backdrop.static.layers[0].id).toBe('lay_window')
    expect(s.backdrop.static.layers[0].ref).toBe('blinds')
    expect(s.backdrop.static.layers[0].light).toEqual(scene.backdrop.static.layers[0].light)
  })

  it('a video pick replaces the scenery stack and keeps the photo controls of the visible layer', () => {
    const v = ops.videoLayer('lay_v', 'youtube:aqz-KE-bpKQ', 'bunny', { start: 3 })
    const s = applyPatch(scene, ops.pickOne(scene, 'scenery', v))
    expect(s.mode).toBe('scenery')
    const l = s.backdrop.scenery.layers
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ id: 'lay_flowers', kind: 'video', ref: 'youtube:aqz-KE-bpKQ' })
    expect(l[0].params).toMatchObject({ blur: 0.74, brightness: 0.66, warmth: 0, drift: 0.1, start: 3, end: 0, audio: false })
  })

  it('a gradient pick keeps the id only', () => {
    const s = applyPatch(scene, ops.pickOne(scene, 'color', { id: 'x', kind: 'gradient', ref: 'sea', name: 'sea', visible: true, opacity: 1, blend: 'normal', light: null, params: { drift: 0.5 } }))
    expect(s.backdrop.color.layers[0]).toMatchObject({ id: 'lay_ember', ref: 'sea', params: { drift: 0.5 } })
  })
})

describe('show ops: pads', () => {
  it('adds a pad at the end, and creates sounds on an older document', () => {
    expect(applyPatch(scene, ops.addPad(scene, pad)).sounds!.pads.map((p) => p.id)).toEqual(['pad_thunder', 'pad_rain', 'pad_door'])
    const old = { ...scene } as Scene
    delete old.sounds
    expect(applyPatch(old, ops.addPad(old, pad)).sounds).toEqual({ pads: [pad] })
  })

  it('edits pad fields by id with leaf ops and removes the key', () => {
    const o = ops.updatePad(scene, 'pad_rain', { volume: 0.3, color: 'violet', key: null })!
    expect(o.every((x) => x.path.startsWith('/sounds/pads/1/'))).toBe(true)
    const s = applyPatch(scene, o)
    expect(s.sounds!.pads[1]).toMatchObject({ volume: 0.3, color: 'violet' })
    expect('key' in s.sounds!.pads[1]).toBe(false)
    expect(ops.updatePad(scene, 'pad_rain', { volume: 0.6 })).toBeNull()
    expect(ops.updatePad(scene, 'nope', { volume: 0.6 })).toBeNull()
  })

  it('removes and moves pads, and finds a pad by key', () => {
    expect(applyPatch(scene, ops.removePad(scene, 'pad_thunder')!).sounds!.pads.map((p) => p.id)).toEqual(['pad_rain'])
    expect(applyPatch(scene, ops.movePad(scene, 'pad_thunder', 1)!).sounds!.pads.map((p) => p.id)).toEqual(['pad_rain', 'pad_thunder'])
    expect(ops.movePad(scene, 'pad_thunder', -1)).toBeNull()
    expect(ops.padForKey(scene, 'T')?.id).toBe('pad_thunder')
    expect(ops.padForKey(scene, 'x')).toBeNull()
    expect(ops.padForKey(scene, 'Enter')).toBeNull()
  })
})

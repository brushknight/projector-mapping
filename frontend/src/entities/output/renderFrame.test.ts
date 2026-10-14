import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Scene } from '../scene/types'
import { clampSize, handleRenderRpcs, locateForRender } from './renderFrame'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8')) as Scene

describe('render RPC helpers', () => {
  it('clamps sizes to 16..4096 and falls back on junk', () => {
    expect(clampSize(320, 100)).toBe(320)
    expect(clampSize(2, 100)).toBe(16)
    expect(clampSize(99999, 100)).toBe(4096)
    expect(clampSize('abc', 100)).toBe(100)
    expect(clampSize(undefined, 640)).toBe(640)
  })

  it('renders faces with an atlas place through the face view and the rest alone', () => {
    expect(locateForRender(scene, 'srf_right')).toEqual({ objectId: 'obj_cube', inAtlas: true })
    // a detail sits inside its parent face's rect
    expect(locateForRender(scene, 'srf_bay0')).toEqual({ objectId: 'obj_cube', inAtlas: true })
    // the edge line has no place in the atlas
    expect(locateForRender(scene, 'srf_edges')).toEqual({ objectId: 'obj_cube', inAtlas: false })
    expect(locateForRender(scene, 'srf_nope')).toBeNull()
  })

  it('registers render.frame, render.face and render.unfold and removes them again', () => {
    const offs: string[] = []
    const methods: string[] = []
    const hub = { handleRpc: vi.fn((m: string) => (methods.push(m), () => void offs.push(m))) }
    const off = handleRenderRpcs(hub, () => 0)
    expect(methods).toEqual(['render.frame', 'render.face', 'render.unfold'])
    off()
    expect(offs).toEqual(methods)
  })
})

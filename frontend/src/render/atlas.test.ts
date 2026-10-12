import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Scene } from '../entities/scene/types'
import { applyAffine, atlasAffines, autoAtlas, invertAffine, rectAffine } from './atlas'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contract/fixtures/scene.json', import.meta.url)), 'utf8')) as Scene
const cube = scene.objects.find((o) => o.id === 'obj_cube')!

describe('autoAtlas', () => {
  it('unfolds the fixture cube like a dieline: top above, left and right below, sharing edges', () => {
    const a = autoAtlas(scene, { ...cube, atlas: null })
    expect(a).toEqual(cube.atlas)
    // the shared edge p_l → p_c lands on the same atlas pixels for top and left
    const top = rectAffine(a.faces.srf_top)
    const left = rectAffine(a.faces.srf_left)
    expect(applyAffine(top, 0, 0)).toEqual(applyAffine(left, 0, 0)) // p_l
    expect(applyAffine(top, 0, 1)).toEqual(applyAffine(left, 1, 0)) // p_c
    // left's right edge is right's left edge (p_c → p_b)
    const right = rectAffine(a.faces.srf_right)
    expect(applyAffine(left, 1, 1)).toEqual(applyAffine(right, 0, 1))
  })

  it('leaves lines, masks and details out and places details inside their parent', () => {
    const a = autoAtlas(scene, cube)
    expect(Object.keys(a.faces).sort()).toEqual(['srf_left', 'srf_right', 'srf_top'])
    const aff = atlasAffines(scene, cube, a)
    const bay = aff.get('srf_bay0')!
    const r = a.faces.srf_right
    const c = applyAffine(bay, 0.5, 0.5)
    expect(c[0]).toBeGreaterThan(r.x)
    expect(c[0]).toBeLessThan(r.x + r.w)
    expect(c[1]).toBeGreaterThan(r.y)
    expect(c[1]).toBeLessThan(r.y + r.h)
    expect(aff.has('srf_edges')).toBe(false)
  })

  it('inverts an affine', () => {
    const f = rectAffine({ x: 10, y: 20, w: 100, h: 50, rotation: 90 })
    const p = applyAffine(f, 0.25, 0.75)
    const back = invertAffine(f, p[0], p[1])!
    expect(back[0]).toBeCloseTo(0.25)
    expect(back[1]).toBeCloseTo(0.75)
  })

  it('puts a lone poly face at its flat size', () => {
    const lamp = scene.objects.find((o) => o.id === 'obj_lamp')!
    const a = autoAtlas(scene, lamp)
    expect(a.faces.srf_lamp).toMatchObject({ x: 0, y: 0, rotation: 0 })
    expect(a.width).toBe(170)
    expect(a.height).toBe(300)
  })
})

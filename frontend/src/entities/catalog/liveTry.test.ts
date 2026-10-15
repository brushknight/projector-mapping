import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import sceneFx from '../../../../contract/fixtures/scene.json'
import { PROCEDURAL_IDS } from '../../render/shaders/layer'
import type { Scene } from '../scene/types'
import { newLayer, proceduralBlend } from './layers'
import { galleryItems, galleryScene, parseTry, TRY_LAYER_ID, withTrialLayer } from './liveTry'
import type { Catalog } from './types'

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/catalog.json', import.meta.url)), 'utf8')) as Catalog

describe('live layers are masks over the light (§16)', () => {
  it('gives shadows blend multiply and light effects normal', () => {
    for (const id of ['tree-sway', 'palm-sway', 'clouds', 'rain-glass', 'caustics', 'dapple', 'film-grain', 'haze']) expect(newLayer(catalog, 'procedural', id, 'l').blend, id).toBe('multiply')
    for (const id of ['lightning', 'day-cycle', 'sun-drift', 'candle-flicker']) expect(newLayer(catalog, 'procedural', id, 'l').blend, id).toBe('normal')
    // without a catalog blend, the category decides
    expect(proceduralBlend(null, 'clouds')).toBe('multiply')
    expect(proceduralBlend(null, 'lightning')).toBe('normal')
  })
  it('draws every catalog live layer and nothing else', () => {
    expect([...PROCEDURAL_IDS].sort()).toEqual(catalog.procedural.map((p) => p.id).sort())
  })
  it('lists every procedural item with an animated strip', () => {
    for (const p of catalog.procedural) {
      expect(p.animThumb, p.id).toBe(`thumbs/${p.id}-anim.jpg`)
      expect(p.animFrames).toBeGreaterThan(1)
      expect(p.animFps).toBeGreaterThan(0)
    }
  })
})

describe('trying a live layer (§16)', () => {
  it('reads only a well formed try param', () => {
    expect(parseTry('tree-sway')).toBe('tree-sway')
    expect(parseTry('')).toBeNull()
    expect(parseTry('../x')).toBeNull()
    expect(parseTry(3)).toBeNull()
    expect(parseTry(undefined)).toBeNull()
  })
  it('adds the layer on top of the live stack, in live mode, without touching the scene', () => {
    const scene = JSON.parse(JSON.stringify(sceneFx)) as Scene
    scene.mode = 'static'
    scene.backdrop.live = { ...scene.backdrop.live, light: null }
    const before = JSON.stringify(scene)
    const t = withTrialLayer(scene, catalog, 'clouds')
    expect(JSON.stringify(scene)).toBe(before)
    expect(t.mode).toBe('live')
    const top = t.backdrop.live.layers[t.backdrop.live.layers.length - 1]
    expect(top.id).toBe(TRY_LAYER_ID)
    expect(top.ref).toBe('clouds')
    expect(top.blend).toBe('multiply')
    // a mask needs light to block: the default stack light comes in
    expect(t.backdrop.live.light?.intensity).toBeGreaterThan(0)
    // trying again replaces the trial layer
    expect(withTrialLayer(t, catalog, 'rain-glass').backdrop.live.layers.filter((l) => l.id === TRY_LAYER_ID)).toHaveLength(1)
    // an unknown id leaves the scene as is
    expect(withTrialLayer(scene, catalog, 'nope')).toBe(scene)
  })
  it('keeps the live stack light when it has one', () => {
    const scene = JSON.parse(JSON.stringify(sceneFx)) as Scene
    const light = scene.backdrop.live.light
    expect(withTrialLayer(scene, catalog, 'tree-sway').backdrop.live.light).toEqual(light)
  })
  it('draws gallery tiles under a warm light, shadows first', () => {
    const g = galleryScene(catalog, 'tree-sway')
    expect(g.backdrop.live.light?.color.kelvin).toBe(3200)
    expect(g.backdrop.live.layers.map((l) => l.ref)).toEqual(['tree-sway'])
    // a light effect draws its own light over black
    expect(galleryScene(catalog, 'sun-drift').backdrop.live.light).toBeNull()
    const ids = galleryItems(catalog).map((p) => p.id)
    expect(ids).toHaveLength(catalog.procedural.length)
    expect(ids.indexOf('clouds')).toBeLessThan(ids.indexOf('day-cycle'))
  })
})

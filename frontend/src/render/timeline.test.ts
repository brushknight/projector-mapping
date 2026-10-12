import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Scene } from '../entities/scene/types'
import type { Catalog } from '../entities/catalog/types'
import { resolveParams, schemaDefaults } from '../entities/effect/params'
import { clipAlpha, evaluateLayerClips, evaluateTimeline } from './timeline'
import { lightFx } from './fx'
import { BUILTINS } from './effects/builtins'
import { BUILTIN_SCHEMAS } from './effects/builtinSchemas'
import { paramUniforms, paramValue, wrapEffect } from './effects/wrap'

const root = fileURLToPath(new URL('../../../contract/', import.meta.url))
const scene = JSON.parse(readFileSync(root + 'fixtures/scene.json', 'utf8')) as Scene
const catalog = JSON.parse(readFileSync(root + 'catalog.json', 'utf8')) as Catalog
const names = (m: Map<string, { effect: string }[]>, id: string) => (m.get(id) ?? []).map((a) => a.effect)

describe('timeline evaluation', () => {
  it('applies an object clip to every surface of the object', () => {
    const m = evaluateTimeline(scene, 5)
    for (const id of ['srf_top', 'srf_left', 'srf_right', 'srf_bay0', 'srf_fan']) expect(names(m, id)).toContain('trace')
    expect(m.get('srf_edges')?.map((a) => a.params.mode)).toContain('boomerang')
    expect(m.has('srf_lamp')).toBe(false)
  })
  it('starts clips inclusive and ends them exclusive', () => {
    expect(names(evaluateTimeline(scene, 4), 'srf_top')).toEqual(['trace'])
    expect(names(evaluateTimeline(scene, 3.999), 'srf_top')).toEqual(['grid-build'])
    expect(evaluateTimeline(scene, 20).size).toBe(0)
  })
  it('targets all surfaces with an all track', () => {
    const m = evaluateTimeline(scene, 17)
    const surfaces = scene.objects.flatMap((o) => o.surfaces.map((s) => s.id))
    for (const id of surfaces) expect(names(m, id)).toContain('glitch')
  })
  it('computes progress and fades', () => {
    const a = evaluateTimeline(scene, 1)!.get('srf_top')![0]
    expect(a.progress).toBeCloseTo(0.25)
    expect(a.alpha).toBe(1)
    const c = { start: 0, end: 4, fadeIn: 0.2, fadeOut: 0.2 }
    expect(clipAlpha(c, 0.1)).toBeCloseTo(0.5)
    expect(clipAlpha(c, 3.9)).toBeCloseTo(0.5)
    expect(clipAlpha({ ...c, fadeIn: 0, fadeOut: 0 }, 0)).toBe(1)
  })
  it('skips muted tracks', () => {
    expect(names(evaluateTimeline(scene, 5, new Set(['trk_faces'])), 'srf_top')).toEqual([])
  })
})

describe('effect params', () => {
  it('fills catalog defaults for every built-in', () => {
    for (const e of catalog.effects) {
      expect(BUILTINS[e.id], e.id).toBeTruthy()
      expect(BUILTIN_SCHEMAS[e.id]).toEqual(e.params)
      const p = resolveParams(e.params, {})
      expect(p).toEqual(schemaDefaults(e.params))
    }
    const trace = catalog.effects.find((e) => e.id === 'trace')!
    expect(resolveParams(trace.params, { mode: 'boomerang', line: 99 })).toMatchObject({ mode: 'boomerang', line: 12, speed: 2, glow: 0.62, color: '#e9fbff' })
  })
  it('maps params to uniforms', () => {
    const trace = catalog.effects.find((e) => e.id === 'trace')!
    const us = paramUniforms(trace.params)
    const mode = us.find((u) => u.key === 'mode')!
    expect(mode.glsl).toBe('int')
    expect(paramValue(mode, 'boomerang')).toBe(1)
    expect(paramValue(us.find((u) => u.key === 'color')!, '#ff0000')).toEqual([1, 0, 0])
    // label's `size` would collide with nothing; reserved names are skipped
    expect(paramUniforms({ seed: { type: 'number' }, ok: { type: 'boolean' } }).map((u) => u.name)).toEqual(['u_ok'])
  })
  it('wraps a user effect with the contract prelude', () => {
    const src = wrapEffect('vec4 effect(vec2 uv, float t, float progress) { return vec4(1.0); }', { speed: { type: 'number' } })
    expect(src).toContain('#version 300 es')
    expect(src).toContain('uniform float u_speed;')
    expect(src).toContain('float edgeDist(vec2 uv)')
    expect(src).toContain('float perimeterPos(vec2 uv)')
  })
})

describe('light fx', () => {
  it('is deterministic and bounded', () => {
    for (const k of ['none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police']) {
      for (const t of [0, 1.3, 17.7, 1000.01]) {
        const a = lightFx(k, t, 0.35, 4)
        expect(lightFx(k, t, 0.35, 4)).toEqual(a)
        expect(a.gain).toBeGreaterThanOrEqual(0)
        expect(a.gain).toBeLessThan(1.6)
      }
    }
    expect(lightFx('none', 3, 0.5)).toEqual({ gain: 1, rgb: [1, 1, 1] })
  })
  it('alternates police red and blue', () => {
    const colours = new Set<string>()
    for (let t = 0; t < 3; t += 0.05) colours.add(lightFx('police', t, 0.35).rgb.join(','))
    expect(colours.size).toBe(2)
  })
})

describe('layer clips', () => {
  const base = {
    id: 's', setupId: 'x', name: 'n', version: 1, mode: 'objects', backdrop: { static: { layers: [] }, live: { layers: [] }, color: { layers: [] }, scenery: { layers: [] } }, points: [], objects: [],
    timeline: {
      duration: 20,
      tracks: [{ id: 'tl', name: 'sweep', target: { kind: 'layer', id: 'cl_1' } }],
      clips: [
        { id: 'c1', trackId: 'tl', effect: 'reveal', start: 2, end: 4, fadeIn: 0, fadeOut: 0, params: {} },
        { id: 'c2', trackId: 'tl', effect: 'sweep', start: 0, end: 10, fadeIn: 0, fadeOut: 0, params: { from: 0, to: 2 } },
      ],
      cues: [],
    },
  } as unknown as Scene
  it('holds from before, interpolates during, holds to after', () => {
    expect(evaluateLayerClips(base, 1).get('cl_1')?.reveal).toBe(0)
    expect(evaluateLayerClips(base, 3).get('cl_1')?.reveal).toBeCloseTo(0.5)
    expect(evaluateLayerClips(base, 9).get('cl_1')?.reveal).toBe(1)
    expect(evaluateLayerClips(base, 5).get('cl_1')?.sweep).toBeCloseTo(1)
    expect(evaluateLayerClips(base, 15).get('cl_1')?.sweep).toBe(2)
  })
  it('layer tracks put no clips on surfaces', () => {
    expect(evaluateTimeline(base, 3).size).toBe(0)
  })
})

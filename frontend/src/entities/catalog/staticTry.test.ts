import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Scene } from '../scene/types'
import { applyPresetOps, pickAttachment } from '../scene/ops'
import { applyPatch } from '../../shared/lib/jsonPatch'
import { defaultStackLight, stackLightOf } from './layers'
import { backgroundItems, backgroundLayer, backgroundScene, STATIC_TRY_ID, withStaticTrial } from './staticTry'
import type { Catalog } from './types'

const read = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../contract/${p}`, import.meta.url)), 'utf8'))
const catalog = read('catalog.json') as Catalog
const scene = read('fixtures/scene.json') as Scene

describe('the static stack (§16)', () => {
  it('defaults both focus rings to sharp, no vignette and no haze', () => {
    const l = defaultStackLight(catalog)
    expect([l.focus, l.backgroundFocus, l.vignette]).toEqual([1, 1, 0])
    expect('haze' in stackLightOf({ focus: 0.3, haze: 0.5 } as never, catalog)).toBe(false)
    expect(catalog.stackLight?.params.haze).toBeUndefined()
    expect(catalog.stackLight?.params.backgroundFocus?.default).toBe(1)
  })

  it('offers colours, gradients, animated colours and effects as backgrounds', () => {
    const items = backgroundItems(catalog)
    expect(new Set(items.map((i) => i.group))).toEqual(new Set(['colour', 'gradient', 'animated', 'effect']))
    expect(items.some((i) => i.kind === 'procedural' && i.ref === 'caustics')).toBe(true)
    expect(items.some((i) => i.ref === 'tree-sway')).toBe(false)
    const solid = backgroundLayer(catalog, items[0], 'lay_x')
    expect([solid.kind, solid.blend, solid.params.color]).toEqual(['solid', 'normal', items[0].color])
    expect(backgroundScene(catalog, items[0]).backdrop.static.layers).toHaveLength(1)
  })

  it('tries a plate in place of the first attachment, keeping its place, and a background on top, without touching the scene', () => {
    const before = JSON.stringify(scene)
    const a = withStaticTrial(scene, catalog, { kind: 'attachment', gobo: 'plate-hearts' })
    const old = scene.backdrop.static.attachments![0]
    const att = a.backdrop.static.attachments![0]
    expect([att.id, att.gobo, att.rotation, att.scale, a.mode]).toEqual([STATIC_TRY_ID, 'plate-hearts', old.rotation, old.scale, 'static'])
    expect(a.backdrop.static.light?.focus).toBe(scene.backdrop.static.light?.focus)
    const b = withStaticTrial(scene, catalog, { kind: 'background', item: backgroundItems(catalog).find((i) => i.ref === 'ember')! })
    expect(b.backdrop.static.layers.at(-1)?.ref).toBe('ember')
    expect(JSON.stringify(scene)).toBe(before)
  })

  it('keeps the light and the placement when a pick or a preset changes the attachments', () => {
    const sc: Scene = JSON.parse(JSON.stringify(scene))
    sc.backdrop.static.light = { ...sc.backdrop.static.light!, focus: 0.4, backgroundFocus: 0.2, fringe: 0.7, slide: { x: 0.3, y: 0 } }
    const old = sc.backdrop.static.attachments![0]
    const picked = applyPatch(sc, pickAttachment(sc, 'static', { ...old, id: 'att_new', gobo: 'plate-dots', rotation: 0, scale: 1, params: {} }))
    const p = picked.backdrop.static.attachments![0]
    expect([p.id, p.gobo, p.rotation, p.scale, p.motion?.preset]).toEqual([old.id, 'plate-dots', old.rotation, old.scale, old.motion?.preset])
    expect(picked.backdrop.static.light?.focus).toBe(0.4)
    const preset = { mode: 'static' as const, backdrop: { layers: [], light: defaultStackLight(catalog, { intensity: 0.5, focus: 0.9 }), attachments: [] } }
    const after = applyPatch(sc, applyPresetOps(preset, sc))
    const l = after.backdrop.static.light!
    expect([l.intensity, l.focus, l.backgroundFocus, l.fringe, l.slide.x]).toEqual([0.5, 0.4, 0.2, 0.7, 0.3])
  })
})

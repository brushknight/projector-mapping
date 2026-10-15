import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../entities/catalog/types'
import { newAttachment, stackLightOf } from '../entities/catalog/layers'
import { ATTACHMENT_IDS, attachmentParams, attachmentUniforms } from './attachments'
import { GENERATOR_IDS, generatorsGlsl } from './generators'

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contract/catalog.json', import.meta.url)), 'utf8')) as Catalog

describe('attachments (§15)', () => {
  it('draws every catalog gobo and nothing else', () => {
    expect([...ATTACHMENT_IDS].sort()).toEqual(catalog.gobos.map((g) => g.id).sort())
  })
  it('fills params from goboParams, the item defaults and its own schema', () => {
    const p = attachmentParams(catalog, { gobo: 'window-4', params: { mullion: 0.6 } })
    expect(p.throw).toBe(0.25)
    expect(p.cols).toBe(2)
    expect(p.mullion).toBe(0.6)
    expect(p.skew).toBe(0.3)
  })
  it('maps shutter blades onto the shape slots', () => {
    const u = attachmentUniforms(catalog, { gobo: 'shutter', params: { top: 0.5 } })!
    expect(u.gp0[0]).toBe(0.5)
    expect(u.depth).toBe(0)
    expect(attachmentUniforms(catalog, { gobo: 'nope', params: {} })).toBeNull()
  })
  it('makes a new attachment with the catalog start values', () => {
    const a = newAttachment(catalog, 'blinds', 'att_1')
    expect(a.scale).toBe(1.4)
    expect(a.params.slats).toBe(22)
    expect(a.visible).toBe(true)
  })
  it('defaults the stack light to the whole frame at 5600 K', () => {
    const l = stackLightOf(null, catalog)
    expect(l.color.kelvin).toBe(5600)
    expect(l.slide).toEqual({ x: 0, y: 0 })
    expect(stackLightOf({ focus: 0.2 }, catalog).intensity).toBe(0.85)
  })
})

describe('colour generators (§15)', () => {
  it('implements every catalog generator', () => {
    expect([...GENERATOR_IDS].sort()).toEqual((catalog.colorGenerators ?? []).map((g) => g.id).sort())
    expect(generatorsGlsl()).toContain('vec3 generate(int id')
  })
})

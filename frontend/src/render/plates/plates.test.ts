import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../entities/catalog/types'
import { attachmentUniforms } from '../attachments'
import { SHAPE } from '../shaders/light'
import { rng } from './geom'
import { FIELD_MODES, fieldCode, PLATES, plateField, plateShapes, plateSvg } from './index'

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/catalog.json', import.meta.url)), 'utf8')) as Catalog

describe('metal plates (catalog 5)', () => {
  it('match the catalog plates one to one', () => {
    const items = catalog.gobos.filter((g) => g.category === 'plates')
    expect(PLATES.map((p) => p.id)).toEqual(items.map((g) => g.id))
    for (const p of PLATES) {
      const g = items.find((x) => x.id === p.id)!
      expect([g.name, g.description, g.source]).toEqual([p.name, p.description, p.source])
      expect(g.metalThumb).toBe(`thumbs/${p.id}-metal.png`)
      expect(g.params?.field?.options).toEqual([...FIELD_MODES])
    }
    expect(PLATES.filter((p) => p.source)).toHaveLength(20)
    expect(new Set(PLATES.map((p) => p.id)).size).toBe(PLATES.length)
  })

  it('draws every plate as clean path data, the same every time', () => {
    for (const p of PLATES) {
      const shapes = plateShapes(p)
      expect(shapes.some((s) => s.op === 'cut'), p.id).toBe(true)
      for (const s of shapes) {
        expect(s.d, p.id).toMatch(/^M/)
        expect(s.d, p.id).not.toMatch(/NaN|Infinity/)
      }
      expect(p.draw(rng(p.seed ?? 1)).map((s) => s.d)).toEqual(shapes.map((s) => s.d))
      expect(plateField(p)).toBeGreaterThan(0.5)
      expect(plateField(p)).toBeLessThanOrEqual(0.95)
    }
  })

  it('exports a plate as SVG in the unit circle', () => {
    const svg = plateSvg(PLATES[0], 'metal')
    expect(svg).toContain('viewBox="-1 -1 2 2"')
    expect(svg).toContain('<title>sunburst</title>')
    expect(plateSvg(PLATES[0], 'mask')).toContain(`<circle r="${plateField(PLATES[0])}"/>`)
  })

  it('maps a plate attachment onto the plate shape with its light field', () => {
    const u = attachmentUniforms(catalog, { gobo: 'plate-louvre', params: {} })!
    expect(u.shape).toBe(SHAPE.plate)
    expect(u.gp0[0]).toBe(0)
    expect(u.gp0[1]).toBe(0.74)
    expect(attachmentUniforms(catalog, { gobo: 'plate-louvre', params: { field: 'fill' } })!.gp0[0]).toBe(1)
    expect(fieldCode('tile')).toBe(3)
    expect(fieldCode('nonsense')).toBe(0)
  })
})

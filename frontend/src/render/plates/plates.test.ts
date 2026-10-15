import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../entities/catalog/types'
import { attachmentUniforms } from '../attachments'
import { SHAPE } from '../shaders/light'
import { rng } from './geom'
import { FIELD_MODES, fieldCode, PLATE_CATEGORIES, PLATES, plateDef, plateField, plateKey, plateShapes, plateSvg } from './index'
import { barOf, drawWindow, homography, MIN_BAR, WINDOW_PARAM_GROUPS, WINDOW_PARAMS, windowGeometry, WINDOWS } from './windows'

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/catalog.json', import.meta.url)), 'utf8')) as Catalog
const refs = fileURLToPath(new URL('../../../../design/refs/gobo-plates/', import.meta.url))

describe('the plate library (catalog 6)', () => {
  it('matches the catalog attachments one to one: every attachment is a plate', () => {
    expect(catalog.version).toBe(6)
    expect(PLATES.map((p) => p.id)).toEqual(catalog.gobos.map((g) => g.id))
    expect(catalog.goboCategories?.map((c) => c.id)).toEqual(PLATE_CATEGORIES.map((c) => c.id))
    for (const p of PLATES) {
      const g = catalog.gobos.find((x) => x.id === p.id)!
      expect([g.name, g.description, g.source, g.category]).toEqual([p.name, p.description, p.source, p.category])
      expect(g.metalThumb).toBe(`thumbs/${p.id}-metal.png`)
      expect(g.params?.field?.options).toEqual([...FIELD_MODES])
      expect(g.family).toBe(p.window ? 'window' : undefined)
    }
    expect(new Set(PLATES.map((p) => p.id)).size).toBe(PLATES.length)
  })

  it('follows a reference photo for every plate', () => {
    for (const p of PLATES) {
      const file = p.source.split(',')[0]
      expect(existsSync(refs + file), `${p.id}: ${file}`).toBe(true)
      expect(p.id).toMatch(/^plate-[a-z0-9-]+$/)
      expect(p.description).not.toMatch(/—/)
    }
  })

  it('draws every plate as clean path data, the same every time', () => {
    for (const p of PLATES) {
      const shapes = plateShapes(p)
      expect(shapes.some((s) => s.op === 'cut'), p.id).toBe(true)
      for (const s of shapes) {
        expect(s.d, p.id).toMatch(/^M/)
        expect(s.d, p.id).not.toMatch(/NaN|Infinity/)
      }
      const params = p.window ? windowGeometry(p, {}) : {}
      expect(p.draw(rng(p.seed ?? 1), params).map((s) => s.d)).toEqual(shapes.map((s) => s.d))
      expect(plateField(p)).toBeGreaterThan(0.5)
      expect(plateField(p)).toBeLessThanOrEqual(0.95)
    }
  })

  it('exports a plate as SVG in the unit circle', () => {
    const sun = plateDef('plate-sunburst')!
    const svg = plateSvg(sun, 'metal')
    expect(svg).toContain('viewBox="-1 -1 2 2"')
    expect(svg).toContain('<title>sunburst</title>')
    expect(plateSvg(sun, 'mask')).toContain(`<circle r="${plateField(sun)}"/>`)
  })

  it('maps a plate attachment onto the plate shape with its light field', () => {
    const u = attachmentUniforms(catalog, { gobo: 'plate-louvre', params: {} })!
    expect(u.shape).toBe(SHAPE.plate)
    expect(u.gp0[0]).toBe(0)
    expect(u.gp0[1]).toBe(0.74)
    expect(attachmentUniforms(catalog, { gobo: 'plate-louvre', params: { field: 'fill' } })!.gp0[0]).toBe(1)
    expect(attachmentUniforms(catalog, { gobo: 'window-4', params: {} })).toBeNull()
    expect(fieldCode('tile')).toBe(3)
    expect(fieldCode('nonsense')).toBe(0)
  })
})

describe('parametric windows (§16)', () => {
  it('lists every window param in exactly one group, and every preset in the catalog with its geometry', () => {
    expect(WINDOW_PARAM_GROUPS.flatMap((g) => g.params).sort()).toEqual(Object.keys(WINDOW_PARAMS).sort())
    expect(catalog.windowParamGroups).toEqual(WINDOW_PARAM_GROUPS)
    expect(WINDOWS).toHaveLength(13)
    for (const w of WINDOWS) {
      const g = catalog.gobos.find((x) => x.id === w.id)!
      for (const [k, spec] of Object.entries(WINDOW_PARAMS)) expect(g.params?.[k]?.default, `${w.id}.${k}`).toEqual(w.window?.[k] ?? spec.default)
      for (const k of Object.keys(w.window ?? {})) expect(WINDOW_PARAMS[k], `${w.id}: ${k}`).toBeDefined()
    }
  })

  it('takes the attachment params over the preset, clamped and rounded', () => {
    const arched = plateDef('plate-arched-window')!
    const g = windowGeometry(arched, { rows: 7.4, cols: 99, arch: false, gap: -3, taper: 'x' })
    expect(g.rows).toBe(7)
    expect(g.cols).toBe(12)
    expect(g.arch).toBe(false)
    expect(g.gap).toBe(0)
    expect(g.taper).toBe(0)
    expect(windowGeometry(arched, {}).spokes).toBe(4)
    expect(plateKey(arched, {})).not.toBe(plateKey(arched, { rows: 6 }))
    expect(plateKey(plateDef('plate-sunburst')!, { rows: 6 })).toBe('plate-sunburst')
  })

  it('never cuts a bar thinner than a plate can hold', () => {
    expect(barOf.gap(0)).toBe(MIN_BAR)
    expect(MIN_BAR).toBeGreaterThanOrEqual(0.006)
  })

  it('maps the flat window onto its perspective quad', () => {
    const sq: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const h = homography(sq, sq)
    expect(h.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    const k = homography(sq, [[0, 0], [2, 0], [2, 1], [0, 1]])
    expect(Math.round(k[0] * 1e6) / 1e6).toBe(2)
  })

  it('draws the number of openings the geometry asks for', () => {
    const base = windowGeometry(plateDef('plate-tall-grid-window')!, {})
    expect(drawWindow(base).length).toBe(25)
    expect(drawWindow({ ...base, sashes: 2, cols: 2, rows: 3 }).length).toBe(12)
    expect(drawWindow({ ...base, cols: 1, rows: 1, slats: 10 }).length).toBe(10)
    // an arch with two spokes adds three head openings
    expect(drawWindow({ ...base, cols: 1, rows: 1, arch: true, spokes: 2 }).length).toBe(4)
    // a diamond lattice splits a pane into many cells
    expect(drawWindow({ ...base, cols: 1, rows: 1, diamond: true, diamonds: 4 }).length).toBeGreaterThan(20)
    for (const s of drawWindow({ ...base, taper: 0.8, slant: -0.5, taperY: 0.4, slantY: 0.4, arch: true, spokes: 3, hub: 0.4 })) {
      expect(s.d).not.toMatch(/NaN|Infinity/)
    }
  })
})

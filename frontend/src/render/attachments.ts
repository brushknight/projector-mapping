/**
 * Attachments (protocol §15): which shader shape each catalog gobo uses and how its params land in the shape's
 * uniform slots (u_gp0, u_gp1, u_gp2 in shaders/light.ts). Pure.
 */
import type { Catalog } from '../entities/catalog/types'
import type { Attachment } from '../entities/scene/types'
import { SHAPE } from './shaders/light'

type Vec4 = [number, number, number, number]
type P = (k: string, d: number) => number

interface ShapeOf {
  shape: number
  slots: (p: P) => { gp0: Vec4; gp1?: Vec4; gp2?: Vec4 }
}

/** mullion param 0..1 → bar width in gobo units */
const mull = (m: number) => 0.006 + Math.max(0, Math.min(1, m)) * 0.034

const sash: ShapeOf = { shape: SHAPE.sash, slots: (p) => ({ gp0: [p('cols', 2), p('rows', 2), mull(p('mullion', 0.35)), 0] }) }
const blinds: ShapeOf = { shape: SHAPE.venetian, slots: (p) => ({ gp0: [p('slats', 22), p('tilt', 0.55), 0, 0] }) }
const leaves: ShapeOf = { shape: SHAPE.leaves, slots: (p) => ({ gp0: [p('density', 0.55), p('size', 0.5), p('seed', 7) * 0.137, 0] }) }
const spot: ShapeOf = { shape: SHAPE.spot, slots: (p) => ({ gp0: [p('edge', 0.04), p('aspect', 1), 0, 0] }) }

export const ATTACHMENT_SHAPES: Record<string, ShapeOf> = {
  'window-4': sash,
  window: { shape: SHAPE.sash, slots: (p) => ({ gp0: [p('cols', 2), p('rows', 3), mull(p('mullion', 0.35)), 0] }) },
  arch: { shape: SHAPE.arch, slots: (p) => ({ gp0: [p('cols', 2), p('rows', 3), mull(p('mullion', 0.3)), 0] }) },
  gothic: { shape: SHAPE.gothic, slots: (p) => ({ gp0: [mull(p('mullion', 0.3)), 0, 0, 0] }) },
  porthole: { shape: SHAPE.porthole, slots: (p) => ({ gp0: [mull(p('mullion', 0)), p('bars', 0), 0, 0] }) },
  'french-doors': { shape: SHAPE.frenchDoors, slots: (p) => ({ gp0: [p('cols', 4), p('rows', 5), mull(p('mullion', 0.3)), 0] }) },
  skylight: { shape: SHAPE.skylight, slots: (p) => ({ gp0: [p('cols', 3), p('rows', 3), mull(p('mullion', 0.25)), 0] }) },
  barn: { shape: SHAPE.barn, slots: (p) => ({ gp0: [mull(p('mullion', 0.45)), 0, 0, 0] }) },
  'blinds-fine': blinds,
  blinds,
  'blinds-wide': blinds,
  'vertical-blinds': { shape: SHAPE.vertical, slots: (p) => ({ gp0: [p('slats', 14), p('tilt', 0.5), 0, 0] }) },
  shutters: { shape: SHAPE.shutters, slots: (p) => ({ gp0: [p('slats', 16), p('panels', 2), p('tilt', 0.6), 0] }) },
  'leaves-light': leaves,
  tree: leaves,
  'leaves-dense': leaves,
  palm: { shape: SHAPE.palm, slots: (p) => ({ gp0: [p('fronds', 9), p('seed', 5) * 0.137, 0, 0] }) },
  branch: { shape: SHAPE.branch, slots: (p) => ({ gp0: [p('density', 0.4), p('seed', 9) * 0.137, 0, 0] }) },
  ivy: { shape: SHAPE.ivy, slots: (p) => ({ gp0: [p('density', 0.6), p('seed', 4) * 0.137, 0, 0] }) },
  bamboo: { shape: SHAPE.bamboo, slots: (p) => ({ gp0: [p('density', 0.5), p('seed', 6) * 0.137, 0, 0] }) },
  dots: { shape: SHAPE.dots, slots: (p) => ({ gp0: [p('density', 0.55), p('size', 0.5), p('seed', 2) * 0.137, 0] }) },
  lattice: { shape: SHAPE.lattice, slots: (p) => ({ gp0: [p('cells', 7), mull(p('mullion', 0.3)), 0, 0] }) },
  moroccan: { shape: SHAPE.moroccan, slots: (p) => ({ gp0: [p('cells', 6), p('mullion', 0.35), 0, 0] }) },
  honeycomb: { shape: SHAPE.honeycomb, slots: (p) => ({ gp0: [p('cells', 8), mull(p('mullion', 0.25)), 0, 0] }) },
  stripes: { shape: SHAPE.stripes, slots: (p) => ({ gp0: [p('count', 9), p('width', 0.45), 0, 0] }) },
  grid: { shape: SHAPE.grid, slots: (p) => ({ gp0: [p('cells', 8), mull(p('mullion', 0.25)), 0, 0] }) },
  stars: { shape: SHAPE.stars, slots: (p) => ({ gp0: [p('density', 0.5), p('size', 0.35), p('seed', 8) * 0.137, 0] }) },
  water: { shape: SHAPE.water, slots: (p) => ({ gp0: [p('scale', 0.5), p('sharpness', 0.5), p('seed', 1), 0] }) },
  spot,
  'spot-soft': spot,
  oval: { shape: SHAPE.spot, slots: (p) => ({ gp0: [p('edge', 0.12), p('aspect', 0.55), 0, 0] }) },
  shutter: {
    shape: SHAPE.framing,
    slots: (p) => ({ gp0: [p('top', 0.3), p('bottom', 0.3), p('left', 0.35), p('right', 0.35)], gp1: [p('topAngle', 0), p('bottomAngle', 0), p('leftAngle', 0), p('rightAngle', 0)] }),
  },
  iris: { shape: SHAPE.iris, slots: (p) => ({ gp0: [p('iris', 0.5), p('edge', 0.05), 0, 0] }) },
}

export const ATTACHMENT_IDS = Object.keys(ATTACHMENT_SHAPES)

/** An attachment's params with every default filled: the gobo's own schema, goboParams and the item's defaults. */
export function attachmentParams(catalog: Catalog | null, att: Pick<Attachment, 'gobo' | 'params'>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const item = catalog?.gobos.find((g) => g.id === att.gobo)
  for (const [k, spec] of Object.entries(catalog?.goboParams ?? {})) out[k] = spec.default
  for (const [k, v] of Object.entries(item?.defaults ?? {})) out[k] = v
  for (const [k, spec] of Object.entries(item?.params ?? {})) out[k] = spec.default
  for (const [k, v] of Object.entries(att.params ?? {})) if (v !== undefined && v !== null) out[k] = v
  return out
}

/** The shader shape and uniform slots of an attachment, or null for an unknown gobo. */
export function attachmentUniforms(catalog: Catalog | null, att: Pick<Attachment, 'gobo' | 'params'>) {
  const def = ATTACHMENT_SHAPES[att.gobo]
  if (!def) return null
  const params = attachmentParams(catalog, att)
  const p: P = (k, d) => {
    const v = Number(params[k])
    return Number.isFinite(v) ? v : d
  }
  const s = def.slots(p)
  return {
    shape: def.shape,
    gp0: s.gp0,
    gp1: s.gp1 ?? ([0, 0, 0, 0] as Vec4),
    gp2: s.gp2 ?? ([0, 0, 0, 0] as Vec4),
    throw: Math.max(0, Math.min(1, p('throw', 0))),
    skew: Math.max(-1, Math.min(1, p('skew', 0))),
    depth: Math.max(0, Math.min(1, p('depth', 0))),
  }
}

/**
 * Attachments (protocol §15, §16): which shader shape each catalog gobo uses and how its params land in the shape's
 * uniform slots (u_gp0, u_gp1, u_gp2 in shaders/light.ts). Pure.
 */
import type { Catalog } from '../entities/catalog/types'
import type { Attachment } from '../entities/scene/types'
import { fieldCode, PLATES, plateField } from './plates'
import { SHAPE } from './shaders/light'

type Vec4 = [number, number, number, number]
type P = (k: string, d: number) => number

interface ShapeOf {
  shape: number
  /** `p` reads a number param, `v` any param (enums) */
  slots: (p: P, v: (k: string) => unknown) => { gp0: Vec4; gp1?: Vec4; gp2?: Vec4 }
}

/**
 * (catalog 6) every attachment is a metal plate: the shader samples the plate's mask texture; gp0.z (the frame aspect)
 * is filled in by the engine, and the engine draws a parametric window's texture from the attachment's params.
 */
export const ATTACHMENT_SHAPES: Record<string, ShapeOf> = Object.fromEntries(
  PLATES.map((def): [string, ShapeOf] => [def.id, { shape: SHAPE.plate, slots: (_p, v) => ({ gp0: [fieldCode(v('field') ?? 'round'), plateField(def), 1, 0] }) }]),
)

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
  const s = def.slots(p, (k) => params[k])
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

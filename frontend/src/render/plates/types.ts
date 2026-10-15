import type { Rng, Shape } from './geom'

/** (catalog 6) the attachment browser's groups; every attachment is a plate */
export type PlateCategory = 'windows' | 'nature' | 'sky' | 'patterns' | 'beams'

/**
 * A metal gobo plate (protocol §15 and §16): vector cut-outs in plate space (the unit circle, y down).
 * The catalog carries the same id, name, description, source and category; the renderer rasterizes `draw` into a
 * 2048 px mask (once per plate, or once per geometry for a parametric window).
 */
export interface PlateDef {
  /** the catalog gobo id, `plate-…` */
  id: string
  name: string
  description: string
  /** the reference photo the design follows: `<file in design/refs/gobo-plates>, <label>` */
  source: string
  category: PlateCategory
  /** radius of the round light field in plate units (the plate's image area); default 0.84 */
  field?: number
  /** the seed `draw` gets (default 1) */
  seed?: number
  /** (§16) a parametric window: its preset geometry; `draw` reads the attachment's params over these */
  window?: Record<string, number | boolean>
  /** the plate's shapes, painted in order on metal: `cut` lets light through, `metal` blocks it again */
  draw: (r: Rng, params: Record<string, unknown>) => Shape[]
}

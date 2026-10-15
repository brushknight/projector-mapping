import type { Rng, Shape } from './geom'

/**
 * A metal gobo plate (protocol §15, category `plates`): vector cut-outs in plate space (the unit circle, y down).
 * The catalog carries the same id, name and description; the renderer rasterizes `draw` once into a 2048 px mask.
 */
export interface PlateDef {
  /** the catalog gobo id, `plate-…` */
  id: string
  name: string
  description: string
  /** where the design comes from, when it follows a real plate */
  source?: string
  /** radius of the round light field in plate units (the plate's image area); default 0.84 */
  field?: number
  /** the seed `draw` gets (default 1) */
  seed?: number
  /** the plate's shapes, painted in order on metal: `cut` lets light through, `metal` blocks it again */
  draw: (r: Rng) => Shape[]
}

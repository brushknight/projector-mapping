import type { ParamSchema } from '../effect/types'
import { schemaDefaults } from '../effect/params'
import type { Layer, LayerKind, Light } from '../scene/types'
import type { Catalog } from './types'

export const DEFAULT_LIGHT: Light = {
  intensity: 0.8,
  softness: 0.5,
  angle: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 },
  fx: { kind: 'none', speed: 0.35 },
}

/** The light block with the catalog's defaults for intensity, softness, angle and scale. */
export function defaultLight(catalog: Catalog | null): Light {
  const d = schemaDefaults(catalog?.light.params) as Partial<Light>
  return { ...DEFAULT_LIGHT, ...d, color: { ...DEFAULT_LIGHT.color }, fx: { ...DEFAULT_LIGHT.fx } }
}

/** The param schema a layer's `params` are validated against. */
export function layerParamSchema(catalog: Catalog | null, layer: Pick<Layer, 'kind' | 'ref'>): ParamSchema {
  if (!catalog) return {}
  switch (layer.kind) {
    case 'procedural':
      return catalog.procedural.find((p) => p.id === layer.ref)?.params ?? {}
    case 'gradient':
      return catalog.gradientParams
    case 'photo':
      return catalog.photoParams
    case 'solid':
      return { color: { type: 'color', default: '#000000', label: 'color' } }
    case 'gobo':
      return {}
  }
}

/** A display name for a catalog ref. */
export function catalogName(catalog: Catalog | null, kind: LayerKind, ref: string): string {
  if (!catalog) return ref
  const list = kind === 'gobo' ? catalog.gobos : kind === 'procedural' ? catalog.procedural : kind === 'gradient' ? catalog.gradients : kind === 'photo' ? catalog.scenery : []
  return list.find((x) => x.id === ref)?.name ?? (ref.startsWith('asset:') ? 'my photo' : ref)
}

/** A new layer of a catalog item with every default filled in. The id is an optimistic temporary. */
export function newLayer(catalog: Catalog | null, kind: LayerKind, ref: string, id: string): Layer {
  const lit = kind === 'gobo' || kind === 'procedural'
  let params: Record<string, unknown> = schemaDefaults(layerParamSchema(catalog, { kind, ref }))
  if (kind === 'gradient') {
    const g = catalog?.gradients.find((x) => x.id === ref)
    if (g) params = { ...params, ...g.defaults, stops: g.defaults.stops.map((s) => ({ ...s })) }
  }
  return {
    id,
    kind,
    ref,
    name: catalogName(catalog, kind, ref),
    visible: true,
    opacity: 1,
    blend: kind === 'procedural' && (ref === 'tree-sway' || ref === 'palm-sway' || ref === 'clouds') ? 'multiply' : 'normal',
    light: lit ? defaultLight(catalog) : null,
    params,
  }
}

import type { ParamSchema } from '../effect/types'
import { schemaDefaults } from '../effect/params'
import type { Attachment, Layer, LayerKind, Light, Motion, StackLight } from '../scene/types'
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

/** (§14) the video layer params, for a catalog older than version 3 */
export const VIDEO_PARAMS: ParamSchema = {
  blur: { type: 'number', min: 0, max: 1, default: 0.2, label: 'background blur' },
  brightness: { type: 'number', min: 0, max: 1, default: 0.9, label: 'brightness' },
  warmth: { type: 'number', min: -1, max: 1, default: 0, label: 'warmth' },
  drift: { type: 'number', min: 0, max: 1, default: 0, label: 'drift' },
  start: { type: 'number', min: 0, max: 36000, default: 0, label: 'loop from' },
  end: { type: 'number', min: 0, max: 36000, default: 0, label: 'loop to' },
  audio: { type: 'boolean', default: false, label: 'sound' },
  volume: { type: 'number', min: 0, max: 1, default: 1, label: 'volume' },
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
    case 'video':
      return catalog.videoParams ?? VIDEO_PARAMS
    case 'solid':
      return { color: { type: 'color', default: '#000000', label: 'color' } }
    case 'gobo':
      return {}
    case 'generator':
      return catalog.colorGenerators?.find((g) => g.id === layer.ref)?.params ?? {}
  }
}

/** (§15) the light of a static or live stack with the catalog's defaults: the whole frame lit at 5600 K. */
export function defaultStackLight(catalog: Catalog | null, over: Partial<StackLight> = {}): StackLight {
  const d = schemaDefaults(catalog?.stackLight?.params) as Partial<StackLight>
  return {
    intensity: 0.85,
    focus: 1,
    backgroundFocus: 1,
    fringe: 0.2,
    vignette: 0,
    ...d,
    color: { mode: 'cct', kelvin: catalog?.stackLight?.kelvin ?? 5600, tint: 0, hue: 212, sat: 0.7 },
    fx: { kind: 'none', speed: 0.35 },
    colorLayer: null,
    slide: { x: 0, y: 0 },
    motion: null,
    ...over,
  }
}

/** A stack's light, filling in what an older or partial document leaves out. */
export function stackLightOf(light: Partial<StackLight> | null | undefined, catalog: Catalog | null = null): StackLight {
  const base = defaultStackLight(catalog)
  if (!light) return base
  // (§16) haze is gone: an older document's haze is dropped
  const { haze: _haze, ...rest } = light as Partial<StackLight> & { haze?: number }
  void _haze
  return { ...base, ...rest, color: { ...base.color, ...(light.color ?? {}) }, fx: { ...base.fx, ...(light.fx ?? {}) }, slide: { ...base.slide, ...(light.slide ?? {}) } }
}

/** (§15) a new attachment of a catalog gobo with its defaults (scale, rotation, params). The id is an optimistic temporary. */
export function newAttachment(catalog: Catalog | null, gobo: string, id: string): Attachment {
  const item = catalog?.gobos.find((g) => g.id === gobo)
  const params: Record<string, unknown> = { ...schemaDefaults(catalog?.goboParams), ...(item?.defaults ?? {}), ...schemaDefaults(item?.params) }
  // (§16) a window preset's geometry stays out: missing params take the preset, so "reset to preset" removes them
  if (item?.family === 'window') for (const g of catalog?.windowParamGroups ?? []) for (const k of g.params) delete params[k]
  return {
    id,
    gobo,
    name: item?.name ?? gobo,
    visible: true,
    opacity: 1,
    rotation: item?.attachment?.rotation ?? 0,
    offsetX: 0,
    offsetY: 0,
    scale: item?.attachment?.scale ?? 1,
    params,
    motion: null,
  }
}

/** (§15) a catalog motion preset with `startedAt` = now (server ms); null for an unknown id. */
export function presetMotion(catalog: Catalog | null, id: string, nowMs: number, on = true): Motion | null {
  const p = catalog?.motionPresets?.find((m) => m.id === id)
  if (!p) return null
  return { ...p.motion, via: p.motion.via ? { ...p.motion.via } : null, from: { ...p.motion.from }, to: { ...p.motion.to }, preset: id, on, phase: 0, startedAt: Math.round(nowMs) }
}

/** A display name for a catalog ref. */
export function catalogName(catalog: Catalog | null, kind: LayerKind, ref: string): string {
  if (!catalog) return ref
  const list = kind === 'gobo' ? catalog.gobos : kind === 'procedural' ? catalog.procedural : kind === 'gradient' ? catalog.gradients : kind === 'photo' ? catalog.scenery : kind === 'generator' ? catalog.colorGenerators ?? [] : []
  return list.find((x) => x.id === ref)?.name ?? (ref.startsWith('asset:') ? 'my photo' : ref)
}

/**
 * (§16) The blend a new procedural layer gets: the catalog item's `blend`, else `multiply` for shadows (nature,
 * weather and texture, except lightning, which flashes over the light) and `normal` for the rest. A multiply layer in
 * a live stack with a light is a mask over the light, like an attachment.
 */
export function proceduralBlend(catalog: Catalog | null, ref: string): Layer['blend'] {
  const item = catalog?.procedural.find((p) => p.id === ref)
  if (item?.blend) return item.blend
  const cat = item?.category ?? (ref === 'tree-sway' || ref === 'palm-sway' ? 'nature' : ref === 'clouds' ? 'weather' : '')
  return ref !== 'lightning' && (cat === 'nature' || cat === 'weather' || cat === 'texture') ? 'multiply' : 'normal'
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
    blend: kind === 'procedural' ? proceduralBlend(catalog, ref) : 'normal',
    light: lit ? defaultLight(catalog) : null,
    params,
  }
}

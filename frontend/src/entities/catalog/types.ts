import type { EffectDef, ParamSchema } from '../effect/types'
import type { GradientStop } from '../scene/types'

export interface CatalogItem {
  id: string
  name: string
  description?: string
  category?: string
}

export interface ProceduralItem extends CatalogItem {
  animated: boolean
  params: ParamSchema
}

export interface GradientItem extends CatalogItem {
  defaults: { stops: GradientStop[]; angle: number; drift: number; grain: number; brightness: number }
}

export interface SceneryItem extends CatalogItem {
  /** relative to /catalog/assets/ */
  asset: string
  credit: string
}

export interface Catalog {
  version: number
  paramSchemaNote?: string
  light: {
    params: ParamSchema
    fx: string[]
    cctPresets: Array<{ id: string; kelvin: number }>
  }
  gobos: CatalogItem[]
  procedural: ProceduralItem[]
  gradients: GradientItem[]
  gradientParams: ParamSchema
  scenery: SceneryItem[]
  photoParams: ParamSchema
  /** (§14, catalog version 3) params of a `video` backdrop layer; absent on older servers */
  videoParams?: ParamSchema
  effects: EffectDef[]
}

export const sceneryUrl = (item: SceneryItem) => `/catalog/assets/${item.asset}`

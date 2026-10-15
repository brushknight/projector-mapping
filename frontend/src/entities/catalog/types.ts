import type { EffectDef, ParamSchema } from '../effect/types'
import type { GradientStop, Motion, SceneKind, SceneMode } from '../scene/types'

export interface CatalogItem {
  id: string
  name: string
  description?: string
  category?: string
}

export interface ProceduralItem extends CatalogItem {
  animated: boolean
  params: ParamSchema
  /** (§15) relative to /catalog/assets/ */
  thumb?: string
  /** (§16) the blend a new layer of it gets: `multiply` makes it a mask over the light, like an attachment */
  blend?: 'normal' | 'multiply' | 'screen' | 'add'
  /**
   * (§16) relative to /catalog/assets/: a vertical JPEG strip of `animFrames` frames (192 × 108 each, top to bottom)
   * that loops seamlessly at `animFps`; the phone's live gallery animates it
   */
  animThumb?: string
  animFrames?: number
  animFps?: number
}

/** (catalog 6) every attachment is a plate, in these groups */
export type GoboCategory = 'windows' | 'nature' | 'sky' | 'patterns' | 'beams'

/** (§15) a projection attachment: a gobo that blocks light */
export interface GoboItem extends CatalogItem {
  category?: GoboCategory | string
  /** relative to /catalog/assets/ */
  thumb?: string
  /** (catalog 5, plates) the metal plate itself, relative to /catalog/assets/ */
  metalThumb?: string
  /** (catalog 5, plates) the reference photo a design follows (§16: `<file>, <label>`) */
  source?: string
  /** (§16) `window`: a parametric window preset; its params hold the window geometry with the preset as defaults */
  family?: 'window' | string
  /** the gobo's own params (panes, slats, density, blades…) */
  params?: ParamSchema
  /** where a new attachment of it starts */
  attachment?: { scale: number; rotation: number }
  /** the focus that suits it */
  focus?: number
  /** overrides of goboParams defaults */
  defaults?: Record<string, number>
}

/** (§15) an animated colour for a light's colour layer or a `generator` layer */
export interface ColorGeneratorItem extends CatalogItem {
  animated: boolean
  params: ParamSchema
}

export interface MotionPreset extends CatalogItem {
  motion: Motion
}

export interface SceneKindItem extends CatalogItem {
  id: SceneKind
  mode: SceneMode
}

export interface SceneTemplateItem extends CatalogItem {
  kind: SceneKind
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
  /** (§15, catalog version 4) */
  stackLight?: { params: ParamSchema; kelvin: number; attachmentParams: ParamSchema }
  goboParams?: ParamSchema
  goboCategories?: Array<{ id: GoboCategory; name: string }>
  /** (§16, catalog 6) the window params in groups, in display order */
  windowParamGroups?: Array<{ id: string; name: string; params: string[] }>
  gobos: GoboItem[]
  procedural: ProceduralItem[]
  gradients: GradientItem[]
  gradientParams: ParamSchema
  scenery: SceneryItem[]
  photoParams: ParamSchema
  /** (§14, catalog version 3) params of a `video` backdrop layer; absent on older servers */
  videoParams?: ParamSchema
  colorGenerators?: ColorGeneratorItem[]
  motionPresets?: MotionPreset[]
  motionEasings?: string[]
  motionLoops?: string[]
  sceneKinds?: SceneKindItem[]
  sceneTemplates?: SceneTemplateItem[]
  effects: EffectDef[]
}

export const sceneryUrl = (item: SceneryItem) => `/catalog/assets/${item.asset}`

/** (§15) a gobo or procedural thumbnail, rendered at build time and served by the server */
export const thumbUrl = (id: string) => `/catalog/thumbs/${id}.png`

/** `strokes` is the drawing effect's vector strokes (an array, edited in the flat view, never a slider). */
export type ParamType = 'number' | 'integer' | 'boolean' | 'color' | 'enum' | 'string' | 'strokes'

/** One param of a catalog item's schema (catalog.json paramSchemaNote). */
export interface ParamSpec {
  type: ParamType
  min?: number
  max?: number
  step?: number
  default?: unknown
  label?: string
  unit?: string
  options?: string[]
}

export type ParamSchema = Record<string, ParamSpec>

export type EffectKind = 'builtin' | 'glsl' | 'js'

export interface EffectDef {
  id: string
  name: string
  kind: EffectKind
  origin: string
  params: ParamSchema
  source: string | null
  /** catalog only: fill | outline | transform */
  group?: string
}

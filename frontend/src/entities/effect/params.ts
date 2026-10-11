import type { ParamSchema, ParamSpec } from './types'

/** The default value of one param spec, falling back by type when the schema has none. */
export function specDefault(spec: ParamSpec): unknown {
  if (spec.default !== undefined) return spec.default
  switch (spec.type) {
    case 'number':
    case 'integer':
      return spec.min ?? 0
    case 'boolean':
      return false
    case 'color':
      return '#ffffff'
    case 'enum':
      return spec.options?.[0] ?? ''
    case 'string':
      return ''
    case 'strokes':
      return []
  }
}

/** Every param's default value. */
export function schemaDefaults(schema: ParamSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, spec] of Object.entries(schema ?? {})) out[k] = specDefault(spec)
  return out
}

/** Coerces one value to its spec: clamps numbers, rounds integers, rejects unknown enum options. */
export function coerceParam(spec: ParamSpec, v: unknown): unknown {
  switch (spec.type) {
    case 'number':
    case 'integer': {
      let n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      if (!Number.isFinite(n)) return specDefault(spec)
      if (spec.min !== undefined) n = Math.max(spec.min, n)
      if (spec.max !== undefined) n = Math.min(spec.max, n)
      return spec.type === 'integer' ? Math.round(n) : n
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : !!v
    case 'color':
      return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : specDefault(spec)
    case 'enum':
      return typeof v === 'string' && (spec.options ?? []).includes(v) ? v : specDefault(spec)
    case 'string':
      return typeof v === 'string' ? v : String(v ?? specDefault(spec))
    case 'strokes':
      return Array.isArray(v) ? v : []
  }
}

/** Defaults overlaid with the given values, each coerced to its spec. Unknown keys pass through untouched. */
export function resolveParams(schema: ParamSchema | null | undefined, given: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(given ?? {}) }
  for (const [k, spec] of Object.entries(schema ?? {})) out[k] = k in out ? coerceParam(spec, out[k]) : specDefault(spec)
  return out
}

/** Position 0..1 of a number param within its range, for fill sliders. */
export function paramFraction(spec: ParamSpec, v: number): number {
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  return max === min ? 0 : Math.min(1, Math.max(0, (v - min) / (max - min)))
}

/** A short display for a number param: percent for 0..1 ranges without a unit, else the value and unit. */
export function formatParam(spec: ParamSpec, v: unknown): string {
  if (spec.type === 'number' || spec.type === 'integer') {
    const n = Number(v)
    if (!spec.unit && (spec.min ?? 0) >= -1 && (spec.max ?? 1) <= 1 && spec.type === 'number') return `${Math.round(n * 100)}%`
    const digits = spec.type === 'integer' ? 0 : Math.abs(n) >= 100 ? 0 : 1
    return `${n.toFixed(digits)}${spec.unit ? (spec.unit === '°' || spec.unit === '×' ? spec.unit : ` ${spec.unit}`) : ''}`
  }
  if (spec.type === 'boolean') return v ? 'on' : 'off'
  return String(v ?? '')
}

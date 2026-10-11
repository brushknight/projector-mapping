/**
 * A tiny runtime validator for wire shapes. Each guard returns a list of problems (empty = valid), so a failing
 * fixture test says exactly which field drifted.
 */
export type Guard = (v: unknown, path: string) => string[]

const ok: string[] = []
const fail = (path: string, want: string, v: unknown): string[] => [`${path || '$'}: want ${want}, got ${JSON.stringify(v)?.slice(0, 60)}`]

export const str: Guard = (v, p) => (typeof v === 'string' ? ok : fail(p, 'string', v))
export const num: Guard = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? ok : fail(p, 'number', v))
export const int: Guard = (v, p) => (Number.isInteger(v) ? ok : fail(p, 'integer', v))
export const bool: Guard = (v, p) => (typeof v === 'boolean' ? ok : fail(p, 'boolean', v))
export const any: Guard = () => ok
export const lit = (...values: Array<string | number | boolean | null>): Guard => (v, p) =>
  values.includes(v as string) ? ok : fail(p, values.join('|'), v)
export const nullable = (g: Guard): Guard => (v, p) => (v === null || v === undefined ? ok : g(v, p))
export const optional = nullable
export const arr = (g: Guard): Guard => (v, p) =>
  Array.isArray(v) ? v.flatMap((x, i) => g(x, `${p}[${i}]`)) : fail(p, 'array', v)
export const record = (g: Guard): Guard => (v, p) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => g(x, `${p}.${k}`))
    : fail(p, 'object', v)
export const obj = (shape: Record<string, Guard>): Guard => (v, p) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, 'object', v)
  const o = v as Record<string, unknown>
  return Object.entries(shape).flatMap(([k, g]) => g(o[k], `${p}.${k}`))
}
export const oneOf = (...gs: Guard[]): Guard => (v, p) => {
  const errs = gs.map((g) => g(v, p))
  return errs.some((e) => e.length === 0) ? ok : errs[0]
}
export const tuple = (...gs: Guard[]): Guard => (v, p) =>
  Array.isArray(v) && v.length === gs.length ? gs.flatMap((g, i) => g(v[i], `${p}[${i}]`)) : fail(p, `tuple(${gs.length})`, v)

/** Throws with every problem when v does not match g. */
export function assertShape<T>(g: Guard, v: unknown, what = 'value'): T {
  const errs = g(v, '')
  if (errs.length) throw new Error(`${what} does not match the contract:\n${errs.join('\n')}`)
  return v as T
}

import { arr, lit, nullable, num, obj, record, str, any } from '../../shared/lib/guard'

export const paramSpecShape = obj({
  type: lit('number', 'integer', 'boolean', 'color', 'enum', 'string', 'strokes'), min: nullable(num), max: nullable(num), step: nullable(num),
  default: any, label: nullable(str), unit: nullable(str), options: nullable(arr(str)),
})
export const effectShape = obj({ id: str, name: str, kind: lit('builtin', 'glsl', 'js'), origin: str, params: record(paramSpecShape), source: nullable(str), group: nullable(str) })

import { arr, bool, nullable, num, obj, record, str } from '../../shared/lib/guard'
import { effectShape, paramSpecShape } from '../effect/schema'

const item = { id: str, name: str, description: nullable(str), category: nullable(str) }
const schema = record(paramSpecShape)
export const catalogShape = obj({
  version: num,
  light: obj({ params: schema, fx: arr(str), cctPresets: arr(obj({ id: str, kelvin: num })) }),
  gobos: arr(obj(item)),
  procedural: arr(obj({ ...item, animated: bool, params: schema })),
  gradients: arr(obj({ ...item, defaults: obj({ stops: arr(obj({ color: str, pos: num })), angle: num, drift: num, grain: num, brightness: num }) })),
  gradientParams: schema,
  scenery: arr(obj({ ...item, asset: str, credit: str })),
  photoParams: schema,
  effects: arr(effectShape),
})

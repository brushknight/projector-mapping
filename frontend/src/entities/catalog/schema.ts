import { any, arr, bool, nullable, num, obj, optional, record, str } from '../../shared/lib/guard'
import { motionShape } from '../scene/schema'
import { effectShape, paramSpecShape } from '../effect/schema'

const item = { id: str, name: str, description: nullable(str), category: nullable(str) }
const schema = record(paramSpecShape)
void any
export const catalogShape = obj({
  version: num,
  light: obj({ params: schema, fx: arr(str), cctPresets: arr(obj({ id: str, kelvin: num })) }),
  stackLight: optional(obj({ params: schema, kelvin: num, attachmentParams: schema })),
  goboParams: optional(schema),
  goboCategories: optional(arr(obj({ id: str, name: str }))),
  /** (§16, catalog version 6) */
  windowParamGroups: optional(arr(obj({ id: str, name: str, params: arr(str) }))),
  gobos: arr(obj({ ...item, thumb: optional(str), metalThumb: optional(str), source: optional(str), family: optional(str), params: optional(schema), attachment: optional(obj({ scale: num, rotation: num })), focus: optional(num), defaults: optional(record(num)) })),
  procedural: arr(obj({ ...item, animated: bool, params: schema, thumb: optional(str), blend: optional(str), animThumb: optional(str), animFrames: optional(num), animFps: optional(num) })),
  gradients: arr(obj({ ...item, defaults: obj({ stops: arr(obj({ color: str, pos: num })), angle: num, drift: num, grain: num, brightness: num }) })),
  gradientParams: schema,
  scenery: arr(obj({ ...item, asset: str, credit: str })),
  photoParams: schema,
  /** (§14, catalog version 3) */
  videoParams: nullable(schema),
  colorGenerators: optional(arr(obj({ ...item, animated: bool, params: schema }))),
  motionPresets: optional(arr(obj({ ...item, motion: motionShape }))),
  motionEasings: optional(arr(str)),
  motionLoops: optional(arr(str)),
  sceneKinds: optional(arr(obj({ ...item, mode: str }))),
  sceneTemplates: optional(arr(obj({ ...item, kind: str }))),
  effects: arr(effectShape),
})

import { lit, nullable, obj, str } from '../../shared/lib/guard'
import { stackShape } from '../scene/schema'

export const presetShape = obj({ id: str, name: str, mode: lit('static', 'live', 'color', 'scenery'), backdrop: stackShape, thumbAsset: nullable(str), createdAt: str })

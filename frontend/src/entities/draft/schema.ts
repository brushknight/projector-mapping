import { arr, int, lit, obj, str } from '../../shared/lib/guard'
import { patchOpShape } from '../scene/schema'

export const draftShape = obj({ id: str, sceneId: str, author: str, baseVersion: int, ops: arr(patchOpShape), status: lit('open', 'proposed', 'applied', 'discarded'), summary: str })

import { bool, num, obj, optional, str } from '../../shared/lib/guard'

export const soundPlayShape = obj({ playId: str, sound: str, padId: optional(str), cueId: optional(str), name: optional(str), volume: num, loop: bool })
export const soundStopShape = obj({ playId: optional(str), padId: optional(str) })

import { any, arr, bool, int, lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const transportShape = obj({ state: lit('stopped', 'playing', 'paused'), startedAt: num, offset: num, cue: int })
export const showShape = obj({ activeSetupId: nullable(str), activeSceneId: nullable(str), onAir: bool, transport: transportShape, version: int, preview: nullable(obj({ draftId: str, until: any })), solo: nullable(obj({ surfaceIds: arr(str), fill: lit('content', 'white', 'grid'), until: num })) })

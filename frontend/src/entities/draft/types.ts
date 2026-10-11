import type { PatchOp } from '../scene/types'

export type DraftStatus = 'open' | 'proposed' | 'applied' | 'discarded'

export interface Draft {
  id: string
  sceneId: string
  author: string
  baseVersion: number
  /** JSON Patch against the scene at baseVersion */
  ops: PatchOp[]
  status: DraftStatus
  summary: string
}

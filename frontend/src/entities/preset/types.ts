import type { LayerStack } from '../scene/types'

export type PresetMode = 'static' | 'live' | 'color' | 'scenery'

export interface Preset {
  id: string
  name: string
  mode: PresetMode
  /** the stack for `mode` */
  backdrop: LayerStack
  thumbAsset: string | null
  createdAt: string
}

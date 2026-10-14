import { createContext, useContext } from 'react'
import type { Hub } from '../../../../shared/lib/ws'
import type { Catalog } from '../../../catalog/types'
import type { EffectDef } from '../../../effect/types'
import type { SceneEditing } from '../../../scene/editing'
import type { BackdropMode, Scene, SceneMode, SceneSummary } from '../../../scene/types'
import type { Setup } from '../../../setup/types'
import type { Sound } from '../../../sound/types'
import type { Show } from '../../types'

/**
 * What the Show space works on: always the scene on the wall (`show.activeSceneId`), edited live whatever the editor's
 * backstage switch says, so every control changes what the projector shows.
 */
export interface ShowState {
  hub: Hub
  show: Show | null
  scene: Scene | null
  setup: Setup | null
  catalog: Catalog | null
  effects: EffectDef[]
  editing: SceneEditing
  scenes: SceneSummary[]
  reloadScenes: () => void
  sounds: Sound[]
  reloadSounds: () => void
  /** the open mode tab (opening one puts it on air) */
  tab: SceneMode
  openTab: (m: SceneMode) => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  /** a show command; failures toast and resolve undefined */
  command: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  /** plays a pad or a library sound on the audio output (§14), with the no_audio hint */
  play: (args: { padId?: string; soundId?: string }) => Promise<void>
  /** the selected live layer */
  liveLayer: string | null
  setLiveLayer: (id: string | null) => void
  /** scenery category open in the picker */
  presetMode: BackdropMode
}

export const ShowContext = createContext<ShowState | null>(null)

export function useShow(): ShowState {
  const v = useContext(ShowContext)
  if (!v) throw new Error('useShow needs the Show space provider')
  return v
}

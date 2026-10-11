import { createContext, useContext } from 'react'
import type { Hub } from '../../../shared/lib/ws'
import type { Catalog } from '../../catalog/types'
import type { EffectDef } from '../../effect/types'
import type { Setup } from '../../setup/types'
import type { Show } from '../../show/types'
import type { EditMode, SceneEditing } from '../editing'
import type { Scene, SceneMode, SceneSummary } from '../types'

export type Tool = 'select' | 'quad' | 'tri' | 'poly' | 'circle' | 'mesh' | 'line' | 'mask'
export type Workspace = 'map' | 'animate' | 'automap'
export type StageView = 'input' | 'output' | 'split'
export type Focus = 'surface' | 'object' | 'layer' | 'clip' | null

export interface Selection {
  objectId: string | null
  surfaceId: string | null
  pointId: string | null
  layerId: string | null
  clipId: string | null
  /** index into the selected quad's mesh offsets */
  meshIndex: number | null
  focus: Focus
}

export const EMPTY_SELECTION: Selection = { objectId: null, surfaceId: null, pointId: null, layerId: null, clipId: null, meshIndex: null, focus: null }

export interface EditorState {
  hub: Hub
  workspace: Workspace
  catalog: Catalog | null
  /** every effect the renderer and the library know: catalog built-ins plus user/agent effects */
  effects: EffectDef[]
  userEffects: EffectDef[]
  reloadEffects: () => void
  show: Show | null
  setup: Setup | null
  scenes: SceneSummary[]
  reloadScenes: () => void
  sceneId: string | null
  openScene: (id: string) => void
  editing: SceneEditing
  mode: EditMode
  setMode: (m: EditMode) => void
  scene: Scene | null
  sel: Selection
  select: (patch: Partial<Selection>) => void
  tool: Tool
  setTool: (t: Tool) => void
  view: StageView
  setView: (v: StageView) => void
  reference: boolean
  setReference: (v: boolean) => void
  magnet: boolean
  setMagnet: (v: boolean) => void
  testGrid: boolean
  setTestGrid: (v: boolean) => void
  lockCorners: boolean
  setLockCorners: (v: boolean) => void
  mutedTracks: ReadonlySet<string>
  toggleTrack: (id: string) => void
  previewDraftId: string | null
  setPreviewDraftId: (id: string | null) => void
  loop: boolean
  setLoop: (v: boolean) => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  /** runs a show command and reports failures */
  command: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  /** opens the "new scene from photo" dialog */
  openFromPhoto: () => void
  /** what is on air for the open scene (protocol §1 Scene.mode) */
  sceneMode: SceneMode
  /** puts a mode on air (a `replace /mode` patch through the current edit mode) */
  setSceneMode: (m: SceneMode) => void
  /** the test pattern that is really on (expired patterns count as off) and its seconds left */
  testPattern: { pattern: Setup['testPattern']; secondsLeft: number | null }
  /** turns a test pattern on for 60 s (or renews it), or off */
  setTestPattern: (p: Setup['testPattern']) => void
  /** the flat view over the stage: one surface unwarped to draw on, or an object's faces unfolded side by side */
  flat: FlatView | null
  openFlat: (surfaceId: string) => void
  openUnfold: (objectId: string) => void
  closeFlat: () => void
  /** the "how to make a face" coach on the stage */
  coach: boolean
  setCoach: (v: boolean) => void
}

export type FlatView = { kind: 'surface'; surfaceId: string; objectId: string | null } | { kind: 'unfold'; objectId: string }

export const EditorContext = createContext<EditorState | null>(null)

export function useEditor(): EditorState {
  const e = useContext(EditorContext)
  if (!e) throw new Error('useEditor needs the editor provider')
  return e
}

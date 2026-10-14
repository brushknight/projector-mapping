import { createContext, useContext } from 'react'
import type { Hub } from '../../../shared/lib/ws'
import type { Catalog } from '../../catalog/types'
import type { EffectDef } from '../../effect/types'
import type { Setup } from '../../setup/types'
import type { Show } from '../../show/types'
import type { EditMode, SceneEditing } from '../editing'
import type { Scene, SceneMode, SceneSummary } from '../types'
import type { PreviewClock } from './preview'

export type Tool = 'select' | 'quad' | 'tri' | 'poly' | 'circle' | 'mesh' | 'line' | 'mask'
/** show runs the wall (the default); map and content are the two mapping spaces of one screen; automap is the calibration wizard */
export type Workspace = 'show' | 'map' | 'content' | 'automap'
export type Space = 'show' | 'map' | 'content'
export type StageView = 'input' | 'output' | 'split'
export type Focus = 'surface' | 'object' | 'layer' | 'clip' | 'content' | 'cue' | null
export type SoloFill = 'content' | 'white' | 'grid'

export interface Selection {
  objectId: string | null
  surfaceId: string | null
  pointId: string | null
  layerId: string | null
  clipId: string | null
  /** a content layer (protocol §12) of a surface or an object */
  contentLayerId: string | null
  /** index into the selected quad's mesh offsets */
  meshIndex: number | null
  /** a timeline cue (its inspector: label, follow on, sound on GO) */
  cueId?: string | null
  focus: Focus
}

export const EMPTY_SELECTION: Selection = { objectId: null, surfaceId: null, pointId: null, layerId: null, clipId: null, contentLayerId: null, meshIndex: null, focus: null }

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
  /** Show (run the wall), Map (the warp) or Content (the unfolded faces) */
  space: Space
  setSpace: (s: Space) => void
  /** the editor's own playhead; the wall only follows it when wallFollows is on */
  preview: PreviewClock
  wallFollows: boolean
  setWallFollows: (v: boolean) => void
  /** surfaces soloed on the editor stage (others dim to 15 %), or null */
  solo: string[] | null
  /** solos the selection on the stage (S); `wall` also solos it on the projector (Shift+S) */
  soloSelection: (wall: boolean) => void
  /** clears the editor solo and the wall solo (Esc) */
  clearSolo: () => void
  /** what a wall solo draws */
  wallSoloFill: SoloFill
  setWallSoloFill: (f: SoloFill) => void
  /** the timeline under the stage: collapsed it is only the transport bar */
  timelineOpen: boolean
  setTimelineOpen: (v: boolean) => void
  /** the object the content space shows, and the face zoomed into (null = the whole unfold) */
  contentObjectId: string | null
  faceZoom: string | null
  setFaceZoom: (surfaceId: string | null) => void
  /** opens a face's content editor (F, "edit face") */
  editFace: (surfaceId: string) => void
  /** the set up menu (reference photo, calibration, auto map) */
  setupOpen: boolean
  setSetupOpen: (v: boolean) => void
  /** uploads pictures or videos and adds them as media layers to a surface or an object (protocol §12) */
  addMedia: (files: File[], owner: { kind: 'surface' | 'object'; id: string }, opts?: { fit?: 'fill' | 'fit' | 'stretch'; name?: string }) => Promise<void>
}

export const EditorContext = createContext<EditorState | null>(null)

export function useEditor(): EditorState {
  const e = useContext(EditorContext)
  if (!e) throw new Error('useEditor needs the editor provider')
  return e
}

/** Protocol §1 Scene, Layer, Object, Surface, Timeline. */
export type LayerKind = 'gobo' | 'procedural' | 'gradient' | 'photo' | 'solid'
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add'
export type LightFxKind = 'none' | 'candle' | 'fire' | 'lightning' | 'paparazzi' | 'tv' | 'breathe' | 'strobe' | 'police'

export interface LightColor {
  mode: 'cct' | 'hsi'
  kelvin: number
  tint: number
  hue: number
  sat: number
}

export interface LightFx {
  kind: LightFxKind
  speed: number
}

export interface Light {
  intensity: number
  softness: number
  angle: number
  scale: number
  offsetX: number
  offsetY: number
  color: LightColor
  fx: LightFx
}

export interface GradientStop {
  color: string
  pos: number
}

export type ParamValue = number | string | boolean | GradientStop[] | null
export type Params = Record<string, ParamValue | unknown>

export interface Layer {
  id: string
  kind: LayerKind
  /** catalog id of that kind; for photo a scenery id or `asset:<sha>` */
  ref: string
  name: string
  visible: boolean
  opacity: number
  blend: BlendMode
  light: Light | null
  params: Params
}

/** What is on air: one mode at a time (protocol §1 Scene). */
export type SceneMode = 'static' | 'live' | 'color' | 'scenery' | 'objects'
export type BackdropMode = Exclude<SceneMode, 'objects'>
export const BACKDROP_MODES: BackdropMode[] = ['static', 'live', 'color', 'scenery']
export const SCENE_MODES: SceneMode[] = ['static', 'live', 'color', 'scenery', 'objects']

/** One backdrop stack, bottom → top. */
export interface LayerStack {
  layers: Layer[]
}

/** One stack per backdrop mode. */
export type Backdrop = Record<BackdropMode, LayerStack>

/** The backdrop drawn under the objects in objects mode. */
export interface Underlay {
  on: boolean
  from: BackdropMode
  level: number
}

export const DEFAULT_UNDERLAY: Underlay = { on: false, from: 'static', level: 0.35 }

/** One stroke of the `drawing` effect (protocol §1): points in surface UV, width and size in surface px. */
export type StrokeTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'text'
export interface Stroke {
  tool: StrokeTool
  points: Array<[number, number]>
  color: string
  width: number
  fill?: boolean
  text?: string
  size?: number
}

export interface Point {
  id: string
  x: number
  y: number
}

export type SurfaceKind = 'quad' | 'tri' | 'poly' | 'circle' | 'line' | 'mask'
export type SurfaceRole = 'face' | 'edge' | 'detail'

export interface Mesh {
  cols: number
  rows: number
  bezier: boolean
  /** (cols+1)×(rows+1) offsets in scene pixels from the bilinear position, row-major */
  offsets: Array<[number, number]>
}

export interface EffectInstance {
  id: string
  effect: string
  enabled: boolean
  params: Params
}

export interface Surface {
  id: string
  name: string
  kind: SurfaceKind
  role: SurfaceRole
  pointIds: string[]
  parentId: string | null
  visible: boolean
  mesh: Mesh | null
  effects: EffectInstance[]
  opacity: number
  softEdge: number
}

export interface SceneObject {
  id: string
  name: string
  tags: string[]
  visible: boolean
  surfaces: Surface[]
}

export type TrackTarget = { kind: 'surface' | 'object'; id: string } | { kind: 'all'; id: null }

export interface Track {
  id: string
  name: string
  target: TrackTarget
}

export interface Clip {
  id: string
  trackId: string
  effect: string
  start: number
  end: number
  fadeIn: number
  fadeOut: number
  params: Params
}

export interface Cue {
  id: string
  at: number
  label: string
  autoFollow: boolean
}

export interface Timeline {
  duration: number
  tracks: Track[]
  clips: Clip[]
  cues: Cue[]
}

export interface Scene {
  id: string
  setupId: string
  name: string
  version: number
  mode: SceneMode
  backdrop: Backdrop
  /** optional on the wire; absent = DEFAULT_UNDERLAY */
  underlay?: Underlay
  points: Point[]
  objects: SceneObject[]
  timeline: Timeline
}

/** GET /scenes list row */
export interface SceneSummary {
  id: string
  name: string
  setupId: string
  version: number
}

/** JSON Patch (RFC 6902) */
export type PatchOp =
  | { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string }

export interface HistoryEntry {
  version: number
  author: string
  ts: string
  ops: PatchOp[]
}

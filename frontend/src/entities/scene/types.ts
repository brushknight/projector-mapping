/** Protocol §1 Scene, Layer, Object, Surface, Timeline. */
export type LayerKind = 'gobo' | 'procedural' | 'gradient' | 'photo' | 'solid' | 'video' | 'generator'
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
  /** catalog id of that kind; for photo a scenery id or `asset:<sha>`; for video `asset:<sha>` or `youtube:<id>` (§14) */
  ref: string
  name: string
  visible: boolean
  opacity: number
  blend: BlendMode
  light: Light | null
  params: Params
  /** (§15) photo and video layers: moves the picture inside the frame */
  motion?: Motion | null
}

/** (§15) a point offset in frame fractions */
export interface FramePt {
  x: number
  y: number
}

export type MotionEasing = 'linear' | 'in' | 'out' | 'inOut' | 'sine'
export type MotionLoop = 'once' | 'loop' | 'pingpong'
export const MOTION_EASINGS: MotionEasing[] = ['linear', 'in', 'out', 'inOut', 'sine']
export const MOTION_LOOPS: MotionLoop[] = ['once', 'loop', 'pingpong']

/** (§15) a move across the wall on the server clock; on a stack light, an attachment, or a photo/video layer */
export interface Motion {
  on: boolean
  /** the preset id it came from, or "" (custom) */
  preset: string
  from: FramePt
  via?: FramePt | null
  to: FramePt
  /** seconds */
  duration: number
  easing: MotionEasing
  loop: MotionLoop
  /** degrees over the move */
  rotate: number
  scaleFrom: number
  scaleTo: number
  /** 0, 0 = no CCT drift */
  kelvinFrom: number
  kelvinTo: number
  /** progress where it starts (or holds while off) */
  phase: number
  /** server Unix ms */
  startedAt: number
}

/** (§15) what colours a stack light before the masks: a gradient or an animated colour generator */
export interface ColorLayer {
  kind: 'gradient' | 'generator'
  ref: string
  params: Params
}

/** (§15) the light of the static and live stacks: lights the whole frame, attachments block it */
export interface StackLight {
  intensity: number
  /** (§16) the attachment focus: 1 = sharp (the default), 0 = fully soft */
  focus: number
  /** (§16) the background focus: the static background layers or colour layer, or the live layers; 1 = sharp. Absent = 1 */
  backgroundFocus?: number
  color: LightColor
  fx: LightFx
  /** null = the light's own colour */
  colorLayer?: ColorLayer | null
  fringe: number
  vignette: number
  /** the frame slide: a pan of the whole composed light, frame fractions */
  slide: FramePt
  motion?: Motion | null
}

/** (§15) a gobo in front of the light: a mask that blocks light */
export interface Attachment {
  id: string
  /** catalog gobo id */
  gobo: string
  name: string
  visible: boolean
  /** how much light it blocks: 1 metal, lower glass */
  opacity: number
  /** degrees */
  rotation: number
  offsetX: number
  offsetY: number
  scale: number
  /** the gobo's shape params plus goboParams (throw, skew, depth) */
  params: Params
  motion?: Motion | null
}

/** What is on air: one mode at a time (protocol §1 Scene). */
export type SceneMode = 'static' | 'live' | 'color' | 'scenery' | 'objects'
export type BackdropMode = Exclude<SceneMode, 'objects'>
export const BACKDROP_MODES: BackdropMode[] = ['static', 'live', 'color', 'scenery']
export const SCENE_MODES: SceneMode[] = ['static', 'live', 'color', 'scenery', 'objects']

/** One backdrop stack, bottom → top. Static and live also carry the light and its attachments (§15). */
export interface LayerStack {
  layers: Layer[]
  /** static, live: the light (live: null = no light, layers over black) */
  light?: StackLight | null
  /** static, live: the gobos in front of the light */
  attachments?: Attachment[]
}

/** (§15) what a scene is for; its mode is the kind itself, objects for mapping */
export type SceneKind = 'static' | 'live' | 'color' | 'scenery' | 'mapping'
export const SCENE_KINDS: SceneKind[] = ['static', 'live', 'color', 'scenery', 'mapping']

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
/** polygon: 3+ points, closed; circle: [centre, rim], radius measured in surface px */
export type StrokeTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'text' | 'polygon' | 'circle'
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
  /** optional label (MCP drawing layers such as "bays" or "logo") */
  name?: string
  effect: string
  enabled: boolean
  params: Params
}

/** A picture or gradient in a surface's UV or across an object's atlas (protocol §12). */
export type ContentLayerKind = 'media' | 'gradient'
export type MediaFit = 'fill' | 'fit' | 'stretch'
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}
export interface ContentLayer {
  id: string
  kind: ContentLayerKind
  name: string
  visible: boolean
  opacity: number
  blend: BlendMode
  /** centre offset in canvas fractions */
  x: number
  y: number
  scale: number
  /** degrees, clockwise */
  rotation: number
  /** 0..1 wipe along revealAngle */
  reveal: number
  revealAngle: number
  /** media: scenery id or asset:<sha> */
  src?: string
  media?: 'image' | 'video'
  fit?: MediaFit
  crop?: Crop
  /** gradient */
  stops?: GradientStop[]
  angle?: number
  offset?: number
  repeat?: boolean
}

/** Where a face sits in its object's atlas, in atlas px; rotation turns its UV clockwise (protocol §12). */
export type AtlasRotation = 0 | 90 | 180 | 270
export interface AtlasRect {
  x: number
  y: number
  w: number
  h: number
  rotation: AtlasRotation
}
export interface Atlas {
  width: number
  height: number
  faces: Record<string, AtlasRect>
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
  /** optional on the wire (absent = []), bottom → top, under the effects */
  layers?: ContentLayer[]
}

export interface SceneObject {
  id: string
  name: string
  tags: string[]
  visible: boolean
  surfaces: Surface[]
  /** the unfolded faces (absent or null = auto layout, computed on the fly) */
  atlas?: Atlas | null
  /** object layers drawn on the atlas canvas; each face shows its rect of it */
  layers?: ContentLayer[]
}

export type TrackTarget = { kind: 'surface' | 'object' | 'layer'; id: string } | { kind: 'all' | 'sound'; id: null }

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

/** (§14) a sound fired when the cue starts on the wall */
export interface CueSound {
  sound: string
  volume: number
}

export interface Cue {
  id: string
  at: number
  label: string
  autoFollow: boolean
  /** (§14) optional; null or absent = none */
  sound?: CueSound | null
}

/** (§14) params of a clip on a sound track (`effect: "sound"`) */
export interface SoundClipParams {
  sound: string
  /** seconds into the file at the clip's start */
  offset: number
  volume: number
}

/** (§14) soundboard pads */
export type PadColor = 'ink' | 'red' | 'amber' | 'green' | 'teal' | 'blue' | 'violet' | 'pink'
export const PAD_COLORS: PadColor[] = ['ink', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']
export type PadIcon = 'none' | 'bell' | 'door' | 'thunder' | 'rain' | 'wind' | 'bird' | 'music' | 'voice' | 'knock' | 'spark' | 'heart'
export const PAD_ICONS: PadIcon[] = ['none', 'bell', 'door', 'thunder', 'rain', 'wind', 'bird', 'music', 'voice', 'knock', 'spark', 'heart']
export interface SoundPad {
  id: string
  name: string
  /** sound sha */
  sound: string
  volume: number
  color: PadColor
  icon?: PadIcon
  /** a-z or 0-9; the web Show space plays the pad on that key */
  key?: string | null
  loop?: boolean
}
export interface SceneSounds {
  pads: SoundPad[]
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
  /** (§15) optional on the wire; infer with sceneKind() */
  kind?: SceneKind
  /** (§16) the document format: 6 since the plate library; absent on documents from before it */
  format?: number
  backdrop: Backdrop
  /** optional on the wire; absent = DEFAULT_UNDERLAY */
  underlay?: Underlay
  points: Point[]
  objects: SceneObject[]
  /** (§14) the soundboard; optional on the wire (absent = { pads: [] }) */
  sounds?: SceneSounds
  timeline: Timeline
}

/** GET /scenes list row */
export interface SceneSummary {
  id: string
  name: string
  setupId: string
  version: number
  /** (§15) */
  kind?: SceneKind
  mode?: SceneMode
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

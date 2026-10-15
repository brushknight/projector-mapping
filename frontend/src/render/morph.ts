/**
 * (protocol §21) The morph: a shape that turns into another shape over a clip, filled with a colour (that may change
 * over the clip) or with a backdrop mode's light. The converge (§20) is the special case "the light's spot or the frame
 * → the object's silhouette, filled with the light". The `shape` effect is a morph whose two ends are the same shape.
 *
 *   d(p) = mix(sdFrom(p), sdTo(p), ease(progress)); coverage = 1 − smoothstep(−h, h, d), h = max(edge / 2, aa / 2)
 *
 * Shapes: `object` (the track's silhouette, the accent union), `circle`, `frame`, `rect` and `plate:<id>` (a plate's
 * openings, as a signed distance field built once per plate from its mask with an exact Euclidean distance
 * transform). Every length is in scene px (0,0 top left). The GLSL in shaders/morph.ts mirrors sdShape and the mix.
 */
import type { BackdropMode, Clip, ConvergeEase, Scene, Track } from '../entities/scene/types'
import { BACKDROP_MODES } from '../entities/scene/types'
import { underlayOf } from '../entities/scene/lib'
import { convergeEase, convergeLoops, farDistance, sdCircle, sdFrame, sdLoops } from './converge'
import type { Vec2 } from './math/homography'
import { hexToLinear } from './math/color'
import { plateDef, plateField, plateCanvas } from './plates'
import { hasMask, maskStore } from './plates/masks'
import { clipState, stepBounds } from './timeline'

export const MORPH = 'morph'
export const SHAPE = 'shape'
export const MORPH_EFFECTS: ReadonlySet<string> = new Set([MORPH, SHAPE])

export type MorphKind = 'object' | 'circle' | 'frame' | 'rect' | 'plate'
export type MorphFill = 'light' | 'color'
export const MORPH_KINDS: MorphKind[] = ['object', 'circle', 'frame', 'rect', 'plate']
const EASES: ConvergeEase[] = ['inOut', 'in', 'out', 'linear']

/** One end of a morph as authored: the kind, a plate id, and optional placement (scene px; absent = from the object). */
export interface MorphShapeSpec {
  kind: MorphKind
  plate?: string
  cx?: number
  cy?: number
  /** circle radius */
  r?: number
  /** rect width and height */
  w?: number
  h?: number
  /** plate: the plate square's side */
  size?: number
}

export interface MorphParams {
  from: MorphShapeSpec
  to: MorphShapeSpec
  fill: MorphFill
  /** the backdrop mode whose light fills the shape (fill `light`) */
  source: BackdropMode
  color: string
  colorTo: string
  ease: ConvergeEase
  edge: number
  outline: boolean
}

export const MORPH_DEFAULTS = { from: 'object', to: 'circle', fill: 'color' as MorphFill, color: '#ffffff', ease: 'inOut' as ConvergeEase, edge: 2, outline: false }

const HEX = /^#[0-9a-fA-F]{6}$/

/** Parses `object`, `circle`, `frame`, `rect` or `plate:<id>`; anything else is null. */
export function parseShapeName(v: unknown): Pick<MorphShapeSpec, 'kind' | 'plate'> | null {
  if (typeof v !== 'string') return null
  if (v.startsWith('plate:')) return v.length > 6 ? { kind: 'plate', plate: v.slice(6) } : null
  return (MORPH_KINDS as string[]).includes(v) && v !== 'plate' ? { kind: v as MorphKind } : null
}

/** The name of a spec (what the params store): `plate:<id>` for a plate. */
export const shapeName = (s: Pick<MorphShapeSpec, 'kind' | 'plate'>) => (s.kind === 'plate' ? `plate:${s.plate ?? ''}` : s.kind)

function spec(p: Record<string, unknown>, prefix: string, name: unknown, dflt: string): MorphShapeSpec {
  const out: MorphShapeSpec = { ...(parseShapeName(name) ?? parseShapeName(dflt)!) }
  const key = (k: string) => (prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k)
  const num = (k: string): number | undefined => {
    const raw = p[key(k)]
    const v = Number(raw)
    return raw != null && raw !== '' && Number.isFinite(v) ? v : undefined
  }
  // a centre is set when both are numbers >= 0 (negative or absent = the object's centre)
  const cx = num('cx'), cy = num('cy')
  if (cx !== undefined && cy !== undefined && cx >= 0 && cy >= 0) {
    out.cx = cx
    out.cy = cy
  }
  // sizes of 0 (or absent) are automatic
  for (const k of ['r', 'w', 'h', 'size'] as const) {
    const v = num(k)
    if (v !== undefined && v > 0) out[k] = v
  }
  return out
}

/**
 * The clip's params with defaults. A morph reads `from`/`to` and their placement (`fromCx`, `fromCy`, `fromR`,
 * `fromW`, `fromH`, `fromSize`, the same with `to`); a shape clip reads `shape` and `cx`, `cy`, `r`, `w`, `h`, `size`
 * for both ends. An absent `colorTo` keeps `color`; an absent `source` is the underlay's mode.
 */
export function morphParams(scene: Scene, clip: Pick<Clip, 'params' | 'effect'>): MorphParams {
  const p = (clip.params ?? {}) as Record<string, unknown>
  const pick = <T extends string>(v: unknown, list: T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
  const edge = Number(p.edge)
  const color = typeof p.color === 'string' && HEX.test(p.color) ? p.color : MORPH_DEFAULTS.color
  let from: MorphShapeSpec, to: MorphShapeSpec
  if (clip.effect === SHAPE) {
    from = to = spec(p, '', p.shape, 'circle')
  } else {
    from = spec(p, 'from', p.from, MORPH_DEFAULTS.from)
    to = spec(p, 'to', p.to, MORPH_DEFAULTS.to)
  }
  return {
    from,
    to,
    fill: pick(p.fill, ['light', 'color'], MORPH_DEFAULTS.fill),
    source: pick(p.source, BACKDROP_MODES, underlayOf(scene).from),
    color,
    colorTo: typeof p.colorTo === 'string' && HEX.test(p.colorTo) ? p.colorTo : color,
    ease: pick(p.ease, EASES, MORPH_DEFAULTS.ease),
    edge: Number.isFinite(edge) ? Math.max(0, Math.min(200, edge)) : MORPH_DEFAULTS.edge,
    outline: p.outline === true,
  }
}

export interface MorphState {
  clip: Clip
  track: Track
  params: MorphParams
  progress: number
  e: number
  alpha: number
  held: boolean
}

/** The morph and shape clips in effect at t (playing, or held, §20/§21), in track order. Pure. */
export function evaluateMorph(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): MorphState[] {
  const out: MorphState[] = []
  const bounds = stepBounds(scene)
  for (const track of scene.timeline.tracks) {
    const k = track.target.kind
    if (mutedTracks?.has(track.id) || (k !== 'surface' && k !== 'object' && k !== 'all')) continue
    const clips = scene.timeline.clips.filter((c) => c.trackId === track.id)
    for (const clip of clips) {
      if (!MORPH_EFFECTS.has(clip.effect)) continue
      const st = clipState(clip, clips, t, bounds)
      if (!st) continue
      const params = morphParams(scene, clip)
      out.push({ clip, track, params, progress: st.progress, e: convergeEase(params.ease, st.progress), alpha: st.alpha, held: !!st.held })
    }
  }
  return out
}

// ── resolved shapes ──────────────────────────────────────────────────────────

/** A plate's signed distance field: `size`² values in plate units (the plate square is −1…1), negative inside. */
export interface PlateSdf {
  size: number
  data: Float32Array
  /** where it came from: the decoded mask or the vector drawing (replaced once the mask arrives) */
  from: 'mask' | 'vector' | 'test'
}

export type MorphShape =
  | { kind: 'frame' }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; cx: number; cy: number; hw: number; hh: number }
  | { kind: 'loops'; loops: Vec2[][] }
  | { kind: 'plate'; plate: string; cx: number; cy: number; half: number; sdf: PlateSdf | null }

export interface Frame {
  width: number
  height: number
}

/** The target's silhouette loops, their bounding box centre and bounding radius (null without a silhouette). */
export function objectGeometry(loops: Vec2[][]): { cx: number; cy: number; R: number; hw: number; hh: number } | null {
  const pts = loops.flat()
  if (!pts.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const R = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)))
  return { cx, cy, R, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 }
}

/**
 * Places a spec: `object` is the silhouette; a circle defaults to the object's centre and 0.6 × its bounding radius
 * (the frame's inscribed circle without an object); a rect to the object's bounding box (the frame); a plate is centred
 * on the object with a side of twice its bounding radius (the frame height).
 */
export function resolveShape(s: MorphShapeSpec, loops: Vec2[][], frame: Frame, sdfOf: (plate: string) => PlateSdf | null = plateSdf): MorphShape {
  const g = objectGeometry(loops)
  const cx = s.cx ?? g?.cx ?? frame.width / 2
  const cy = s.cy ?? g?.cy ?? frame.height / 2
  switch (s.kind) {
    case 'object':
      return { kind: 'loops', loops }
    case 'frame':
      return { kind: 'frame' }
    case 'circle':
      return { kind: 'circle', cx, cy, r: s.r ?? (g ? 0.6 * g.R : Math.min(frame.width, frame.height) / 2) }
    case 'rect':
      return { kind: 'rect', cx, cy, hw: s.w ? s.w / 2 : g?.hw ?? frame.width / 2, hh: s.h ? s.h / 2 : g?.hh ?? frame.height / 2 }
    case 'plate':
      return { kind: 'plate', plate: s.plate ?? '', cx, cy, half: s.size ? s.size / 2 : g ? g.R : frame.height / 2, sdf: s.plate ? sdfOf(s.plate) : null }
  }
}

/** Both ends of a morph clip on its track, resolved. */
export function morphShapes(scene: Scene, track: Track, params: MorphParams, frame: Frame, sdfOf?: (plate: string) => PlateSdf | null): { a: MorphShape; b: MorphShape; loops: Vec2[][] } {
  const loops = convergeLoops(scene, track)
  return { a: resolveShape(params.from, loops, frame, sdfOf), b: resolveShape(params.to, loops, frame, sdfOf), loops }
}

export function sdRect(p: Vec2, s: { cx: number; cy: number; hw: number; hh: number }): number {
  const dx = Math.abs(p[0] - s.cx) - s.hw
  const dy = Math.abs(p[1] - s.cy) - s.hh
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/** Bilinear sample of a plate field at plate coordinates (−1…1), clamped to the square. */
export function samplePlateSdf(sdf: PlateSdf, qx: number, qy: number): number {
  const n = sdf.size
  const u = Math.max(0, Math.min(n - 1, ((qx + 1) / 2) * n - 0.5))
  const v = Math.max(0, Math.min(n - 1, ((qy + 1) / 2) * n - 0.5))
  const x0 = Math.floor(u), y0 = Math.floor(v)
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1)
  const fx = u - x0, fy = v - y0
  const d = sdf.data
  const top = d[y0 * n + x0] * (1 - fx) + d[y0 * n + x1] * fx
  const bot = d[y1 * n + x0] * (1 - fx) + d[y1 * n + x1] * fx
  return top * (1 - fy) + bot * fy
}

/** The signed distance (scene px, negative inside) to a resolved shape; the frame grown by `pad`. */
export function sdShape(p: Vec2, s: MorphShape, frame: Frame, pad = 0): number {
  switch (s.kind) {
    case 'frame':
      return sdFrame(p, frame, pad)
    case 'circle':
      return sdCircle(p, s)
    case 'rect':
      return sdRect(p, s)
    case 'loops':
      return sdLoops(p, s.loops, farDistance(frame))
    case 'plate': {
      if (!s.sdf) return farDistance(frame)
      const qx = (p[0] - s.cx) / s.half, qy = (p[1] - s.cy) / s.half
      const cqx = Math.max(-1, Math.min(1, qx)), cqy = Math.max(-1, Math.min(1, qy))
      return samplePlateSdf(s.sdf, cqx, cqy) * s.half + Math.hypot(qx - cqx, qy - cqy) * s.half
    }
  }
}

/** The morphing field at eased progress e: the `from` shape at 0, the `to` shape at 1. */
export function morphSdf(p: Vec2, a: MorphShape, b: MorphShape, e: number, frame: Frame, edge = 0): number {
  const k = Math.max(0, Math.min(1, e))
  if (k <= 0) return sdShape(p, a, frame, edge)
  if (k >= 1) return sdShape(p, b, frame, edge)
  return (1 - k) * sdShape(p, a, frame, edge) + k * sdShape(p, b, frame, edge)
}

const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** The fill colour at eased progress e: `color` → `colorTo`, mixed in linear light, returned as sRGB 0…1. */
export function morphColor(params: Pick<MorphParams, 'color' | 'colorTo'>, e: number): [number, number, number] {
  const a = hexToLinear(params.color), b = hexToLinear(params.colorTo)
  const k = Math.max(0, Math.min(1, e))
  return [0, 1, 2].map((i) => linearToSrgb(a[i] + (b[i] - a[i]) * k)) as [number, number, number]
}

// ── plate distance fields ────────────────────────────────────────────────────

/** The plate field's resolution (texels per side). */
export const PLATE_SDF_SIZE = 256
const INF = 1e20

/** Felzenszwalb's 1D squared distance transform of f (n values) into d. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Squared distance (texels) from every texel to the nearest texel where `set` is true. */
function edt2d(set: Uint8Array, n: number): Float64Array {
  const g = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) g[i] = set[i] ? 0 : INF
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = g[y * n + x]
    edt1d(f, n, d, v, z)
    for (let y = 0; y < n; y++) g[y * n + x] = d[y]
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = g[y * n + x]
    edt1d(f, n, d, v, z)
    for (let x = 0; x < n; x++) g[y * n + x] = d[x]
  }
  return g
}

/**
 * A plate's signed distance field from its mask (one byte per pixel, 255 where light passes, row 0 at the top): box
 * filtered down to `out` texels, clipped to the round `field` (plate units), then an exact Euclidean distance
 * transform on both sides. Values in plate units (the square is 2 wide), negative inside.
 */
export function maskToSdf(mask: Uint8Array, msize: number, field = 1, out = PLATE_SDF_SIZE): PlateSdf {
  const n = Math.min(out, msize)
  const k = msize / n
  const inside = new Uint8Array(n * n)
  const step = Math.max(1, Math.floor(k / 2))
  let any = false
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const px = ((x + 0.5) / n) * 2 - 1, py = ((y + 0.5) / n) * 2 - 1
      if (Math.hypot(px, py) > field) continue
      // average a few source pixels of the texel
      let sum = 0, cnt = 0
      for (let sy = Math.floor(y * k); sy < Math.min(msize, Math.floor((y + 1) * k)); sy += step)
        for (let sx = Math.floor(x * k); sx < Math.min(msize, Math.floor((x + 1) * k)); sx += step) {
          sum += mask[sy * msize + sx]
          cnt++
        }
      if (cnt && sum / cnt >= 128) {
        inside[y * n + x] = 1
        any = true
      }
    }
  const data = new Float32Array(n * n)
  if (!any) {
    data.fill(4)
    return { size: n, data, from: 'mask' }
  }
  const outside = new Uint8Array(n * n)
  for (let i = 0; i < n * n; i++) outside[i] = inside[i] ? 0 : 1
  const toIn = edt2d(inside, n)
  const toOut = edt2d(outside, n)
  const unit = 2 / n
  for (let i = 0; i < n * n; i++) data[i] = (inside[i] ? -(Math.sqrt(toOut[i]) - 0.5) : Math.sqrt(toIn[i]) - 0.5) * unit
  return { size: n, data, from: 'mask' }
}

const sdfCache = new Map<string, PlateSdf>()

/**
 * A plate's distance field, built once and cached: from its 1024 px mask when decoded (it is loaded on first ask),
 * meanwhile from its vector drawing (browsers only). Null for an unknown plate or where neither is available.
 */
export function plateSdf(id: string): PlateSdf | null {
  const have = sdfCache.get(id)
  if (have && have.from !== 'vector') return have
  const def = plateDef(id)
  if (!def) return null
  const field = plateField(def)
  if (hasMask(id, 1024)) {
    const m = maskStore.get(id, 1024)
    if (m) {
      const sdf = maskToSdf(m.data, m.size, field)
      sdfCache.set(id, sdf)
      return sdf
    }
    if (!maskStore.didFail(id, 1024)) void maskStore.load(id, 1024)
  }
  if (have) return have
  try {
    const cv = plateCanvas(def, 512)
    const ctx = (cv as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (!ctx) return null
    const img = ctx.getImageData(0, 0, 512, 512).data
    const g = new Uint8Array(512 * 512)
    for (let i = 0; i < g.length; i++) g[i] = img[i * 4]
    const sdf = { ...maskToSdf(g, 512, field), from: 'vector' as const }
    sdfCache.set(id, sdf)
    return sdf
  } catch {
    return null
  }
}

/** Every plate a scene's morph and shape clips use (to build their fields before they play). */
export function scenePlates(scene: Scene): string[] {
  const out = new Set<string>()
  for (const c of scene.timeline.clips) {
    if (!MORPH_EFFECTS.has(c.effect)) continue
    const p = (c.params ?? {}) as Record<string, unknown>
    for (const v of [p.from, p.to, p.shape]) {
      const s = parseShapeName(v)
      if (s?.kind === 'plate' && s.plate) out.add(s.plate)
    }
  }
  return [...out]
}

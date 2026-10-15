/**
 * (protocol §20) The converge: a backdrop mode's light closing onto a mapped object's silhouette. Pure: which converge
 * clips are in effect at t, where the light starts (the frame, a circle, or the light's own round field), the
 * silhouette it lands on, and the signed distance fields the shader mixes:
 *
 *   mask(p) = mix(sdfStart(p), sdfSilhouette(p), ease(progress)) < 0, softened over `edge` scene px.
 *
 * Every length is in scene px (0,0 top left). The GLSL in shaders/converge.ts mirrors sdLoops, sdFrame and the mix.
 */
import type { Catalog } from '../entities/catalog/types'
import { stackLightOf } from '../entities/catalog/layers'
import { trackSurfaces, underlayOf } from '../entities/scene/lib'
import type { BackdropMode, Clip, ConvergeEase, ConvergeFrom, ConvergeParams, Point, Scene, SceneObject, Track } from '../entities/scene/types'
import { BACKDROP_MODES } from '../entities/scene/types'
import { silhouette, silhouetteFaces } from './accent'
import { attachmentParams } from './attachments'
import { surfaceGeometry } from './math/geometry'
import type { Vec2 } from './math/homography'
import { sampleMotion } from './motion'
import { plateDef, plateField, plateKey, plateShapes, type PlateDef } from './plates'
import { PLATE_SCALE } from './shaders/light'
import { clipState, evaluateLayerClips } from './timeline'

export const CONVERGE = 'converge'
/** the shader's limits: silhouette vertices and loops */
export const CONVERGE_MAX_VERTS = 128
export const CONVERGE_MAX_LOOPS = 16

export const CONVERGE_DEFAULTS: Omit<ConvergeParams, 'source'> = { from: 'current', ease: 'inOut', edge: 6, outline: false }
const FROMS: ConvergeFrom[] = ['current', 'circle', 'frame']
const EASES: ConvergeEase[] = ['inOut', 'in', 'out', 'linear']

/** The clip's params with defaults; an absent source is the scene's underlay mode (static by default). */
export function convergeParams(scene: Scene, clip: Pick<Clip, 'params'>): ConvergeParams {
  const p = (clip.params ?? {}) as Record<string, unknown>
  const pick = <T extends string>(v: unknown, list: T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
  const edge = Number(p.edge)
  return {
    from: pick(p.from, FROMS, CONVERGE_DEFAULTS.from),
    source: pick(p.source, BACKDROP_MODES, underlayOf(scene).from),
    ease: pick(p.ease, EASES, CONVERGE_DEFAULTS.ease),
    edge: Number.isFinite(edge) ? Math.max(0, Math.min(200, edge)) : CONVERGE_DEFAULTS.edge,
    outline: p.outline === true,
  }
}

/** The converge easings (the motion curves of §15): in u², out 1 − (1 − u)², inOut 3u² − 2u³. */
export function convergeEase(kind: ConvergeEase, u: number): number {
  const x = Math.max(0, Math.min(1, u))
  switch (kind) {
    case 'linear':
      return x
    case 'in':
      return x * x
    case 'out':
      return 1 - (1 - x) * (1 - x)
    default:
      return x * x * (3 - 2 * x)
  }
}

export interface ConvergeState {
  clip: Clip
  track: Track
  params: ConvergeParams
  progress: number
  /** eased progress: the mix between the start shape and the silhouette */
  e: number
  alpha: number
  held: boolean
}

/** The converge clips in effect at t (playing, or held after their end, §20), in track order. Pure. */
export function evaluateConverge(scene: Scene, t: number, mutedTracks?: ReadonlySet<string>): ConvergeState[] {
  const out: ConvergeState[] = []
  for (const track of scene.timeline.tracks) {
    if (mutedTracks?.has(track.id) || track.target.kind === 'layer' || track.target.kind === 'sound') continue
    const clips = scene.timeline.clips.filter((c) => c.trackId === track.id)
    for (const clip of clips) {
      if (clip.effect !== CONVERGE) continue
      const st = clipState(clip, clips, t)
      if (!st) continue
      const params = convergeParams(scene, clip)
      out.push({ clip, track, params, progress: st.progress, e: convergeEase(params.ease, st.progress), alpha: st.alpha, held: !!st.held })
    }
  }
  return out
}

// ── shapes ───────────────────────────────────────────────────────────────────

/** Where the light starts: the whole frame, or a circle (scene px). */
export type StartShape = { kind: 'frame' } | { kind: 'circle'; cx: number; cy: number; r: number }

const openings = new Map<string, number>()

/**
 * How far a plate's openings reach from its centre, in plate units (the unit circle), at most its round field: the
 * radius of the light a round-field plate projects (a round spot's hole, a window's corners). Read from the plate's
 * cut paths (every point, bezier control points, arcs by their circles, strokes by half their width), so it never cuts
 * the light; metal shapes only block, so they are left out. The field radius when the path data is not understood.
 */
export function plateOpening(def: PlateDef, params: Record<string, unknown> = {}): number {
  const field = plateField(def)
  const key = plateKey(def, params)
  const have = openings.get(key)
  if (have !== undefined) return have
  let reach = 0
  let ok = true
  for (const sh of plateShapes(def, params)) {
    if (sh.op !== 'cut') continue
    const pad = (sh.stroke ?? 0) / 2
    const tok = sh.d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
    let cmd = ''
    let i = 0
    let cur: [number, number] = [0, 0]
    const num = () => Number(tok[i++])
    const see = (x: number, y: number) => {
      reach = Math.max(reach, Math.hypot(x, y) + pad)
    }
    while (i < tok.length && ok) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++]
      switch (cmd) {
        case 'M':
        case 'L':
        case 'T':
          cur = [num(), num()]
          see(...cur)
          break
        case 'H':
          cur = [num(), cur[1]]
          see(...cur)
          break
        case 'V':
          cur = [cur[0], num()]
          see(...cur)
          break
        case 'C':
          for (let k = 0; k < 3; k++) see(num(), num())
          cur = [Number(tok[i - 2]), Number(tok[i - 1])]
          break
        case 'S':
        case 'Q':
          for (let k = 0; k < 2; k++) see(num(), num())
          cur = [Number(tok[i - 2]), Number(tok[i - 1])]
          break
        case 'A': {
          const rx = num(), ry = num()
          i += 3
          const end: [number, number] = [num(), num()]
          const r = Math.max(rx, ry)
          // an arc stays within its radius of the chord's middle when it is a half circle (the plates' circles);
          // otherwise within r of either end
          const chord = Math.hypot(end[0] - cur[0], end[1] - cur[1])
          const mid: [number, number] = [(cur[0] + end[0]) / 2, (cur[1] + end[1]) / 2]
          if (Math.abs(chord - 2 * r) < 1e-3) see(Math.hypot(...mid) + r, 0)
          else see(Math.max(Math.hypot(...cur), Math.hypot(...end)) + 2 * r, 0)
          cur = end
          break
        }
        case 'Z':
        case 'z':
          break
        default:
          ok = false
      }
      if (Number.isNaN(cur[0]) || Number.isNaN(cur[1])) ok = false
    }
  }
  const out = ok && reach > 0 ? Math.min(field, reach) : field
  openings.set(key, out)
  if (openings.size > 128) openings.delete(openings.keys().next().value as string)
  return out
}

/**
 * The round light of the source (static and live): the smallest circle around what its visible round-field plates let
 * through (each plate's openings, at most its field), since the light passes only where every attachment lets it
 * through. Null when the light has no round field (no attachment, or only fill, stretch or tile fields), or the mode
 * has no light.
 */
export function lightFieldCircle(scene: Scene, source: BackdropMode, frame: { width: number; height: number }, catalog: Catalog | null, nowMs: number, t: number): StartShape | null {
  if (source !== 'static' && source !== 'live') return null
  const stack = scene.backdrop[source]
  if (!stack || (source === 'live' && !stack.light)) return null
  const light = stackLightOf(stack.light)
  const anim = evaluateLayerClips(scene, t)
  const lm = sampleMotion(light.motion, nowMs, anim.get(`light:${source}`)?.motion)
  const W = frame.width, H = frame.height
  const aspect = W / Math.max(1, H)
  let best: { cx: number; cy: number; r: number } | null = null
  for (const att of stack.attachments ?? []) {
    if (att.visible === false || (att.opacity ?? 1) <= 0) continue
    const def = plateDef(att.gobo)
    if (!def) continue
    const params = attachmentParams(catalog, att)
    if ((params.field ?? 'round') !== 'round') continue
    // as the engine places it (drawAttachment): the centre moved by its motion, turned and scaled about the frame centre
    const am = sampleMotion(att.motion, nowMs, anim.get(att.id)?.motion)
    let cx = (att.offsetX ?? 0) + am.x
    let cy = (att.offsetY ?? 0) + am.y
    if (lm.rotate || lm.scale !== 1) {
      const a = (lm.rotate * Math.PI) / 180
      const wx = cx * aspect, wy = cy
      cx = ((wx * Math.cos(a) - wy * Math.sin(a)) * lm.scale) / aspect
      cy = (wx * Math.sin(a) + wy * Math.cos(a)) * lm.scale
    }
    const scale = Math.max(0.01, (att.scale ?? 1) * am.scale * lm.scale)
    // the field in wall units (frame height = 1), grown by the throw's stretch and keystone and the skew, so the
    // circle always holds the whole lit field
    const thr = Math.max(0, Math.min(1, Number(params.throw) || 0))
    const skew = Math.max(-1, Math.min(1, Number(params.skew) || 0))
    const base = plateOpening(def, params) * PLATE_SCALE * scale
    const stretched = base * (1 + 1.1 * thr)
    const r = stretched * (1 + 0.7 * thr * stretched) * (1 + 0.6 * Math.abs(skew))
    // the focus blur spreads the edge by its radius ((1 − focus)^1.5 × 60 px at 1080 p)
    const blur = (1 - Math.max(0, Math.min(1, light.focus ?? 1))) ** 1.5 * 60 * (Math.min(W, H) / 1080)
    const c = { cx: (0.5 + cx + (light.slide?.x ?? 0) + lm.x) * W, cy: (0.5 + cy + (light.slide?.y ?? 0) + lm.y) * H, r: r * H + blur }
    if (!best || c.r < best.r) best = c
  }
  return best ? { kind: 'circle', ...best } : null
}

/**
 * The start shape of a converge (§20): `frame` the whole frame; `circle` the light's round field, else the frame's
 * inscribed circle; `current` the light's round field, else the frame.
 */
export function convergeStart(scene: Scene, params: Pick<ConvergeParams, 'from' | 'source'>, frame: { width: number; height: number }, catalog: Catalog | null, nowMs = 0, t = 0): StartShape {
  if (params.from === 'frame') return { kind: 'frame' }
  const field = lightFieldCircle(scene, params.source, frame, catalog, nowMs, t)
  if (field) return field
  if (params.from === 'circle') return { kind: 'circle', cx: frame.width / 2, cy: frame.height / 2, r: Math.min(frame.width, frame.height) / 2 }
  return { kind: 'frame' }
}

/** The objects a converge track lands on: its object, or every visible object (all). */
function trackObjects(scene: Scene, track: Track): SceneObject[] {
  if (track.target.kind === 'all') return scene.objects.filter((o) => o.visible !== false)
  if (track.target.kind === 'object') return scene.objects.filter((o) => o.id === track.target.id && o.visible !== false)
  return []
}

/**
 * The silhouette a converge lands on, as closed loops (scene px, no repeated closing point): the union outline of the
 * target objects' faces (the accent's silhouette, §19), or a surface target's own outline. At most
 * CONVERGE_MAX_LOOPS loops and CONVERGE_MAX_VERTS vertices in all (longer loops are thinned evenly).
 */
export function convergeLoops(scene: Scene, track: Track): Vec2[][] {
  const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
  let loops: Vec2[][] = []
  if (track.target.kind === 'surface') {
    for (const s of trackSurfaces(scene, track)) {
      if (s.visible === false || s.kind === 'line' || s.kind === 'mask') continue
      const g = surfaceGeometry(s, pts)
      if (g && g.closed && g.outline.length > 2) loops.push(g.outline)
    }
  } else {
    for (const o of trackObjects(scene, track)) {
      if (!silhouetteFaces(o).length) continue
      for (const l of silhouette(o, pts)) loops.push(l)
    }
  }
  loops = loops
    .map((l) => (l.length > 2 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 1e-6 ? l.slice(0, -1) : l))
    .filter((l) => l.length > 2)
    .slice(0, CONVERGE_MAX_LOOPS)
  const total = loops.reduce((n, l) => n + l.length, 0)
  if (total <= CONVERGE_MAX_VERTS) return loops
  const keep = CONVERGE_MAX_VERTS / total
  return loops.map((l) => {
    const n = Math.max(3, Math.floor(l.length * keep))
    return Array.from({ length: n }, (_, i) => l[Math.floor((i * l.length) / n)])
  })
}

// ── signed distance fields (scene px; negative inside) ───────────────────────

export function sdCircle(p: Vec2, c: { cx: number; cy: number; r: number }): number {
  return Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r
}

/** The frame, grown by `pad` px on every side (so its border stays fully lit under a soft edge). */
export function sdFrame(p: Vec2, frame: { width: number; height: number }, pad = 0): number {
  const dx = Math.abs(p[0] - frame.width / 2) - (frame.width / 2 + pad)
  const dy = Math.abs(p[1] - frame.height / 2) - (frame.height / 2 + pad)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/**
 * The union of closed loops: the distance to the nearest edge, negative when inside any loop (even-odd per loop).
 * `far` when there are no loops (a converge onto nothing closes to nothing).
 */
export function sdLoops(p: Vec2, loops: Vec2[][], far = 1e5): number {
  if (!loops.length) return far
  let d = Infinity
  let inside = false
  for (const l of loops) {
    let inL = false
    for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length]
      const bx = b[0] - a[0], by = b[1] - a[1]
      const px = p[0] - a[0], py = p[1] - a[1]
      const h = Math.max(0, Math.min(1, (px * bx + py * by) / Math.max(bx * bx + by * by, 1e-6)))
      d = Math.min(d, Math.hypot(px - bx * h, py - by * h))
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < (bx * (p[1] - a[1])) / by + a[0]) inL = !inL
    }
    inside = inside || inL
  }
  return inside ? -d : d
}

export function sdStart(p: Vec2, start: StartShape, frame: { width: number; height: number }, pad = 0): number {
  return start.kind === 'circle' ? sdCircle(p, start) : sdFrame(p, frame, pad)
}

/** What the shader uses for "no silhouette": a distance past every pixel of the frame. */
export function farDistance(frame: { width: number; height: number }): number {
  return Math.hypot(frame.width, frame.height) * 2
}

/** The morphing field at eased progress e: sdfStart at 0, the silhouette at 1. */
export function convergeSdf(p: Vec2, start: StartShape, loops: Vec2[][], e: number, frame: { width: number; height: number }, edge = 0): number {
  const k = Math.max(0, Math.min(1, e))
  return (1 - k) * sdStart(p, start, frame, edge) + k * sdLoops(p, loops, farDistance(frame))
}

/** How lit a point is (0…1): inside the mask, softened over `edge` px (anti-aliased over `aa` px at least). */
export function convergeCoverage(d: number, edge: number, aa = 1): number {
  const h = Math.max(edge * 0.5, aa * 0.5)
  const x = Math.max(0, Math.min(1, (d + h) / (2 * h)))
  return 1 - x * x * (3 - 2 * x)
}

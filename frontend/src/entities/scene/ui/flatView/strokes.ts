/**
 * Pure helpers for drawing on a surface in the flat view (protocol §1, effect `drawing`): surface px ↔ UV, building
 * strokes, hit testing, and the JSON Patch ops that store them in the surface's drawing effect. Every op builder
 * looks the surface and effect up by id so a stale patch can rebase.
 */
import { strokePath } from '../../../../render/effects/drawing'
import { addClip, addSurfaceEffect, addTrack, locateSurface, surfaceEffectPath } from '../../ops'
import type { EffectInstance, PatchOp, Scene, Stroke, StrokeTool, Surface } from '../../types'

export type Size = { width: number; height: number }
export type Px = [number, number]

export interface StrokeStyle {
  color: string
  /** surface px */
  width: number
  fill: boolean
  /** text height, surface px */
  size: number
}

const r4 = (v: number) => Math.round(v * 10000) / 10000

/** Surface px → normalized UV (rounded to 1/10000, clamped a little past the edges). */
export function toUv(p: Px, size: Size): [number, number] {
  const c = (v: number) => Math.max(-0.25, Math.min(1.25, v))
  return [r4(c(p[0] / Math.max(1e-6, size.width))), r4(c(p[1] / Math.max(1e-6, size.height)))]
}

export function fromUv(uv: [number, number], size: Size): Px {
  return [uv[0] * size.width, uv[1] * size.height]
}

/** Drops pen points closer than `minPx` to the previous kept one (the last point always stays). */
export function simplify(points: Px[], minPx: number): Px[] {
  if (points.length <= 2) return points
  const out: Px[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minPx) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

/** A finished stroke from the points the pointer gave (surface px), or null when it is too small to keep. */
export function buildStroke(tool: StrokeTool, points: Px[], size: Size, style: StrokeStyle, text?: string): Stroke | null {
  if (!points.length) return null
  const base = { color: style.color, width: Math.max(0, style.width) }
  if (tool === 'text') {
    const t = (text ?? '').trim()
    if (!t) return null
    return { tool, points: [toUv(points[0], size)], ...base, width: 0, text: t, size: Math.max(2, style.size) }
  }
  if (tool === 'pen') {
    const pts = simplify(points, Math.max(0.75, style.width / 4))
    const uv = pts.map((p) => toUv(p, size))
    // a click is a dot: keep it as a two-point stroke so it has a length
    if (uv.length === 1) uv.push([...uv[0]] as [number, number])
    return { tool, points: uv, ...base }
  }
  const a = points[0], b = points[points.length - 1]
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return null
  const s: Stroke = { tool, points: [toUv(a, size), toUv(b, size)], ...base }
  if (tool === 'rect' || tool === 'ellipse') s.fill = style.fill
  return s
}

function segDist(p: Px, a: Px, b: Px): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** The index of the topmost stroke within `tolPx` of p (surface px), or -1. */
export function hitStroke(strokes: Stroke[], p: Px, size: Size, tolPx: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    if (s.tool === 'text') {
      const [x, y] = fromUv(s.points[0], size)
      const h = s.size ?? 48
      const w = (s.text ?? '').length * h * 0.6
      if (p[0] >= x - tolPx && p[0] <= x + w + tolPx && p[1] >= y - tolPx && p[1] <= y + h + tolPx) return i
      continue
    }
    const path = strokePath(s, size.width, size.height)
    const tol = tolPx + s.width / 2
    if (path.length === 1 && Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) <= tol) return i
    for (let j = 1; j < path.length; j++) if (segDist(p, path[j - 1], path[j]) <= tol) return i
    if (s.fill && path.length > 2 && (s.tool === 'rect' || s.tool === 'ellipse')) {
      const xs = path.map((q) => q[0]), ys = path.map((q) => q[1])
      if (p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys)) return i
    }
  }
  return -1
}

/** The surface's first drawing effect (where the flat view stores strokes). */
export function drawingEffect(surface: Surface | null | undefined): EffectInstance | null {
  return surface?.effects.find((e) => e.effect === 'drawing') ?? null
}

export function strokesOf(fx: EffectInstance | null): Stroke[] {
  const v = fx?.params.strokes
  return Array.isArray(v) ? (v as Stroke[]) : []
}

function surfaceOf(scene: Scene, surfaceId: string): Surface | null {
  const loc = locateSurface(scene, surfaceId)
  return loc ? scene.objects[loc.o].surfaces[loc.s] : null
}

/**
 * Appends a stroke. The first stroke on a surface adds a drawing effect with id `newFxId` (made once by the caller,
 * so a rebased patch adds the same effect).
 */
export function appendStroke(scene: Scene, surfaceId: string, stroke: Stroke, newFxId: string): PatchOp[] | null {
  const srf = surfaceOf(scene, surfaceId)
  if (!srf) return null
  const fx = drawingEffect(srf)
  if (!fx) return addSurfaceEffect(scene, surfaceId, { id: newFxId, effect: 'drawing', enabled: true, params: { reveal: 1, strokes: [stroke] } })
  if (!Array.isArray(fx.params.strokes)) {
    const p = surfaceEffectPath(scene, surfaceId, fx.id, 'params', 'strokes')
    return p ? [{ op: 'add', path: p, value: [stroke] }] : null
  }
  const p = surfaceEffectPath(scene, surfaceId, fx.id, 'params', 'strokes', '-')
  return p ? [{ op: 'add', path: p, value: stroke }] : null
}

/** Removes one stroke, found by value (so a newer document with more strokes still removes the right one). */
export function removeStroke(scene: Scene, surfaceId: string, stroke: Stroke): PatchOp[] | null {
  const fx = drawingEffect(surfaceOf(scene, surfaceId))
  if (!fx) return null
  const key = JSON.stringify(stroke)
  const list = strokesOf(fx)
  let i = -1
  for (let j = list.length - 1; j >= 0; j--) if (JSON.stringify(list[j]) === key) {
    i = j
    break
  }
  const p = i >= 0 ? surfaceEffectPath(scene, surfaceId, fx.id, 'params', 'strokes', i) : null
  return p ? [{ op: 'remove', path: p }] : null
}

export function clearStrokes(scene: Scene, surfaceId: string): PatchOp[] | null {
  const fx = drawingEffect(surfaceOf(scene, surfaceId))
  const p = fx ? surfaceEffectPath(scene, surfaceId, fx.id, 'params', 'strokes') : null
  return p ? [{ op: 'replace', path: p, value: [] }] : null
}

/**
 * "Draw on": a timeline clip at `start` that reveals the surface's strokes over `duration` s (reveal × progress), on
 * the surface's track (made when missing). The always-on drawing switches off so the clip is what shows it.
 */
export function drawOnClip(scene: Scene, surfaceId: string, start: number, duration: number, ids: { track: string; clip: string }): PatchOp[] | null {
  const srf = surfaceOf(scene, surfaceId)
  const fx = drawingEffect(srf)
  const strokes = strokesOf(fx)
  if (!srf || !fx || !strokes.length) return null
  const ops: PatchOp[] = []
  let track = scene.timeline.tracks.find((t) => t.target.kind === 'surface' && t.target.id === surfaceId)
  if (!track) {
    const obj = scene.objects.find((o) => o.surfaces.some((x) => x.id === surfaceId))
    track = { id: ids.track, name: `${obj ? obj.name + ' · ' : ''}${srf.name}`, target: { kind: 'surface', id: surfaceId } }
    ops.push(...addTrack(track))
  }
  const s = Math.max(0, Math.min(start, scene.timeline.duration - 0.5))
  const end = Math.min(scene.timeline.duration, s + Math.max(0.5, duration))
  ops.push(...addClip({ id: ids.clip, trackId: track.id, effect: 'drawing', start: Math.round(s * 1000) / 1000, end: Math.round(end * 1000) / 1000, fadeIn: 0, fadeOut: 0.2, params: { reveal: 1, strokes } }))
  const en = surfaceEffectPath(scene, surfaceId, fx.id, 'enabled')
  if (en && fx.enabled) ops.push({ op: 'replace', path: en, value: false })
  return ops
}

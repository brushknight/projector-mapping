/**
 * The `drawing` built-in (protocol §1): vector strokes in surface UV, rasterized on a 2D canvas the size of the
 * surface's content texture, then sampled by a tiny shader. `reveal` 0..1 draws the first fraction of the total
 * stroke length (text counts as its width), in stroke order.
 */
import type { Stroke } from '../../entities/scene/types'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Pt = [number, number]

const FONT = "'Share Tech Mono', 'Roboto Mono', ui-monospace, monospace"
const ELLIPSE_STEPS = 72

/** Clean, typed strokes from an unknown param value (bad entries are dropped). */
export function parseStrokes(v: unknown): Stroke[] {
  if (!Array.isArray(v)) return []
  const out: Stroke[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const tool = r.tool
    if (tool !== 'pen' && tool !== 'line' && tool !== 'rect' && tool !== 'ellipse' && tool !== 'text' && tool !== 'polygon' && tool !== 'circle') continue
    const points = Array.isArray(r.points)
      ? (r.points as unknown[]).filter((p): p is Pt => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : []
    if (!points.length) continue
    out.push({
      tool,
      points,
      color: typeof r.color === 'string' ? r.color : '#ffffff',
      width: Number.isFinite(r.width) ? Number(r.width) : 4,
      fill: r.fill === true,
      text: typeof r.text === 'string' ? r.text : undefined,
      size: Number.isFinite(r.size) ? Number(r.size) : undefined,
    })
  }
  return out
}

/** Tools whose path is closed (and can be filled). */
export const CLOSED_TOOLS = new Set<Stroke['tool']>(['rect', 'ellipse', 'polygon', 'circle'])

/** A stroke's path in canvas px (rect, polygon closed, ellipse and circle as polygons); text has no path. */
export function strokePath(s: Stroke, w: number, h: number): Pt[] {
  const p = s.points.map(([u, v]) => [u * w, v * h] as Pt)
  switch (s.tool) {
    case 'pen':
      return p
    case 'line':
      return p.slice(0, 2)
    case 'rect': {
      if (p.length < 2) return []
      const [a, b] = p
      return [a, [b[0], a[1]], b, [a[0], b[1]], a]
    }
    case 'ellipse': {
      if (p.length < 2) return []
      const [a, b] = p
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
      const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2
      const out: Pt[] = []
      for (let i = 0; i <= ELLIPSE_STEPS; i++) {
        const t = (i / ELLIPSE_STEPS) * Math.PI * 2 - Math.PI / 2
        out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
      }
      return out
    }
    case 'polygon': {
      if (p.length < 2) return p
      return [...p, p[0]]
    }
    case 'circle': {
      if (p.length < 2) return []
      const [c, rim] = p
      const r = Math.hypot(rim[0] - c[0], rim[1] - c[1])
      const out: Pt[] = []
      for (let i = 0; i <= ELLIPSE_STEPS; i++) {
        const t = (i / ELLIPSE_STEPS) * Math.PI * 2 - Math.PI / 2
        out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
      }
      return out
    }
    default:
      return []
  }
}

export function pathLength(path: Pt[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  return n
}

function textFont(s: Stroke, k: number): string {
  return `${Math.max(2, (s.size ?? 48) * k)}px ${FONT}`
}

/** Each stroke's length in canvas px, used to split `reveal` across strokes. */
export function strokeLengths(ctx: Ctx2D | null, strokes: Stroke[], w: number, h: number, k: number): number[] {
  return strokes.map((s) => {
    if (s.tool === 'text') {
      const size = (s.size ?? 48) * k
      if (!ctx) return (s.text ?? '').length * size * 0.6
      ctx.font = textFont(s, k)
      return Math.max(1, ctx.measureText(s.text ?? '').width)
    }
    const len = pathLength(strokePath(s, w, h))
    // a dot (a click with the pen) still takes a little time to appear
    return Math.max(len, Math.max(1, s.width * k))
  })
}

/** The path cut at length `upTo`. */
export function cutPath(path: Pt[], upTo: number): Pt[] {
  if (!path.length) return path
  const out: Pt[] = [path[0]]
  let left = upTo
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d <= left) {
      out.push(b)
      left -= d
      continue
    }
    const f = d > 0 ? left / d : 0
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    break
  }
  return out
}

/**
 * Draws the strokes onto a w×h context. `k` converts surface px (stroke width, text size) to canvas px. `reveal`
 * 0..1 limits the drawn length.
 */
export function drawStrokes(ctx: Ctx2D, strokes: Stroke[], w: number, h: number, k: number, reveal = 1) {
  ctx.clearRect(0, 0, w, h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const lens = strokeLengths(ctx, strokes, w, h, k)
  const total = lens.reduce((a, b) => a + b, 0)
  let budget = Math.max(0, Math.min(1, reveal)) * total
  for (let i = 0; i < strokes.length && budget > 0; i++) {
    const s = strokes[i]
    const len = lens[i]
    const frac = Math.min(1, budget / Math.max(len, 1e-6))
    budget -= len
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    if (s.tool === 'text') {
      const text = s.text ?? ''
      if (!text) continue
      ctx.font = textFont(s, k)
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const [u, v] = s.points[0]
      ctx.save()
      if (frac < 1) {
        ctx.beginPath()
        ctx.rect(u * w, 0, len * frac, h)
        ctx.clip()
      }
      ctx.fillText(text, u * w, v * h)
      ctx.restore()
      continue
    }
    const path = strokePath(s, w, h)
    if (!path.length) continue
    if (s.fill && frac >= 1 && CLOSED_TOOLS.has(s.tool)) {
      ctx.beginPath()
      path.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
      ctx.closePath()
      ctx.fill()
    }
    const lw = s.width * k
    if (lw <= 0) continue
    ctx.lineWidth = lw
    const cut = frac >= 1 ? path : cutPath(path, len * frac)
    if (cut.length === 1 || pathLength(cut) < 0.01) {
      ctx.beginPath()
      ctx.arc(cut[0][0], cut[0][1], lw / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    cut.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
    if (frac >= 1 && CLOSED_TOOLS.has(s.tool)) ctx.closePath()
    ctx.stroke()
  }
}

const keys = new WeakMap<object, string>()

/** A stable cache key for a strokes array (memoized per array object, so it costs nothing while the doc is unchanged). */
export function strokesKey(strokes: unknown): string {
  if (!Array.isArray(strokes)) return '0'
  let k = keys.get(strokes)
  if (!k) {
    const s = JSON.stringify(strokes)
    let h = 2166136261
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    k = `${strokes.length}:${s.length}:${(h >>> 0).toString(36)}`
    keys.set(strokes, k)
  }
  return k
}

/** A canvas with the strokes drawn, top row first. */
export function makeDrawingCanvas(strokes: Stroke[], w: number, h: number, k: number, reveal: number): OffscreenCanvas | HTMLCanvasElement {
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = cv.getContext('2d') as Ctx2D | null
  if (ctx) drawStrokes(ctx, strokes, w, h, k, reveal)
  return cv
}

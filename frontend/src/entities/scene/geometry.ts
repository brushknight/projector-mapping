/** 2D helpers for the editor stage (scene pixels, y down). The renderer has its own math in src/render. */
import type { Mesh } from './types'

export interface Vec {
  x: number
  y: number
}

/** Shoelace area; positive = clockwise on screen (y down). */
export function signedArea(pts: Vec[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** The same polygon, clockwise on screen. */
export function clockwise<T extends Vec>(pts: T[]): T[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts
}

/** Four corners ordered clockwise starting at the top left (smallest x + y), as quads require. */
export function orderQuad<T extends Vec>(pts: T[]): T[] {
  if (pts.length !== 4) return pts
  const c = { x: pts.reduce((a, p) => a + p.x, 0) / 4, y: pts.reduce((a, p) => a + p.y, 0) / 4 }
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x))
  // atan2 ascending with y down is clockwise on screen
  let start = 0
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i
  })
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Distance from p to the segment ab. */
export function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Bilinear point in a quad (corners clockwise from top left) at u, v in 0..1. */
export function bilinear(q: Vec[], u: number, v: number): Vec {
  const [a, b, c, d] = q // tl, tr, br, bl
  const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
  const bot = { x: d.x + (c.x - d.x) * u, y: d.y + (c.y - d.y) * u }
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v }
}

/** The mesh's control points in scene pixels: bilinear position + offset, row-major. */
export function meshPoints(quad: Vec[], mesh: Mesh): Vec[] {
  const out: Vec[] = []
  for (let r = 0; r <= mesh.rows; r++)
    for (let c = 0; c <= mesh.cols; c++) {
      const b = bilinear(quad, c / mesh.cols, r / mesh.rows)
      const o = mesh.offsets[r * (mesh.cols + 1) + c] ?? [0, 0]
      out.push({ x: b.x + o[0], y: b.y + o[1] })
    }
  return out
}

/** Resamples a mesh's offsets onto a finer or coarser grid (bilinear), keeping its shape. */
export function resampleMesh(mesh: Mesh, cols: number, rows: number): Mesh {
  const at = (c: number, r: number): [number, number] => mesh.offsets[r * (mesh.cols + 1) + c] ?? [0, 0]
  const offsets: Array<[number, number]> = []
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const fx = (c / cols) * mesh.cols
      const fy = (r / rows) * mesh.rows
      const c0 = Math.min(mesh.cols - 1, Math.floor(fx))
      const r0 = Math.min(mesh.rows - 1, Math.floor(fy))
      const tx = fx - c0
      const ty = fy - r0
      const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const top = lerp(at(c0, r0), at(c0 + 1, r0), tx)
      const bot = lerp(at(c0, r0 + 1), at(c0 + 1, r0 + 1), tx)
      const v = lerp(top, bot, ty)
      offsets.push([Math.round(v[0] * 10) / 10, Math.round(v[1] * 10) / 10])
    }
  return { cols, rows, bezier: mesh.bezier, offsets }
}

/** The polygon of a surface for outlines and hit tests (circles become a 48-gon). */
export function outlineOf(kind: string, pts: Vec[]): Vec[] {
  if (kind === 'circle' && pts.length >= 2) {
    const r = dist(pts[0], pts[1])
    return Array.from({ length: 48 }, (_, i) => ({ x: pts[0].x + r * Math.cos((i / 48) * Math.PI * 2), y: pts[0].y + r * Math.sin((i / 48) * Math.PI * 2) }))
  }
  return pts
}

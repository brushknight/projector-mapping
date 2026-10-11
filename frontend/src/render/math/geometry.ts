/**
 * Surface geometry on the CPU: triangles in scene pixels with UVs, the outline (scene px and UV), size and aspect.
 * Pure, so the editor and tests can use it too.
 */
import type { Mesh, Point, Surface } from '../../entities/scene/types'
import { applyH, invert3, squareToQuad, type Mat3, type Vec2 } from './homography'
import { triangulate } from './triangulate'

export const LINE_WIDTH = 16
export const MAX_OUTLINE = 64
const CIRCLE_SEGMENTS = 48
const MESH_SUBDIV = 8

export interface SurfaceGeometry {
  /** interleaved x, y (scene px), u, v */
  verts: Float32Array
  /** triangle indices */
  indices: Uint16Array | Uint32Array
  /** the outline in scene px (closed unless line) */
  outline: Vec2[]
  /** the outline in UV space (for edgeDist/perimeterPos); for lines unused */
  outlineUv: Vec2[]
  closed: boolean
  /** surface size in scene px */
  size: Vec2
  aspect: number
  /** plain quads: scene px → uv, evaluated per fragment for exact perspective */
  hInv: Mat3 | null
  kind: Surface['kind']
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

function bbox(pts: Vec2[]): { min: Vec2; size: Vec2 } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return { min: [x0, y0], size: [Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0)] }
}

/** Reduces an outline to at most MAX_OUTLINE points (uniform pick) for shader uniforms. */
export function capOutline(pts: Vec2[], max = MAX_OUTLINE): Vec2[] {
  if (pts.length <= max) return pts
  const out: Vec2[] = []
  for (let i = 0; i < max; i++) out.push(pts[Math.floor((i * pts.length) / max)])
  return out
}

function fromTris(pos: Vec2[], uv: Vec2[], tris: number[]): { verts: Float32Array; indices: Uint16Array | Uint32Array } {
  const verts = new Float32Array(pos.length * 4)
  pos.forEach((p, i) => {
    verts[i * 4] = p[0]; verts[i * 4 + 1] = p[1]; verts[i * 4 + 2] = uv[i][0]; verts[i * 4 + 3] = uv[i][1]
  })
  const indices = pos.length > 65535 ? new Uint32Array(tris) : new Uint16Array(tris)
  return { verts, indices }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Mesh control points: bilinear of the corners plus offsets, (cols+1)×(rows+1) row-major. */
export function meshControlPoints(corners: Vec2[], mesh: Mesh): Vec2[] {
  const [a, b, c, d] = corners
  const out: Vec2[] = []
  for (let j = 0; j <= mesh.rows; j++) {
    for (let i = 0; i <= mesh.cols; i++) {
      const s = i / mesh.cols, t = j / mesh.rows
      const x = (1 - s) * (1 - t) * a[0] + s * (1 - t) * b[0] + s * t * c[0] + (1 - s) * t * d[0]
      const y = (1 - s) * (1 - t) * a[1] + s * (1 - t) * b[1] + s * t * c[1] + (1 - s) * t * d[1]
      const o = mesh.offsets[j * (mesh.cols + 1) + i] ?? [0, 0]
      out.push([x + (o[0] ?? 0), y + (o[1] ?? 0)])
    }
  }
  return out
}

/** Evaluates the mesh surface at (s, t) in 0..1. */
export function meshEval(ctrl: Vec2[], mesh: Mesh, s: number, t: number): Vec2 {
  const cols = mesh.cols, rows = mesh.rows
  const fx = Math.min(cols - 1e-9, Math.max(0, s * cols))
  const fy = Math.min(rows - 1e-9, Math.max(0, t * rows))
  const i = Math.floor(fx), j = Math.floor(fy)
  const u = fx - i, v = fy - j
  const P = (ii: number, jj: number): Vec2 => ctrl[Math.min(rows, Math.max(0, jj)) * (cols + 1) + Math.min(cols, Math.max(0, ii))]
  if (!mesh.bezier) {
    const p00 = P(i, j), p10 = P(i + 1, j), p11 = P(i + 1, j + 1), p01 = P(i, j + 1)
    return [
      (1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + u * v * p11[0] + (1 - u) * v * p01[0],
      (1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + u * v * p11[1] + (1 - u) * v * p01[1],
    ]
  }
  const row = (jj: number): Vec2 => {
    const q = [P(i - 1, jj), P(i, jj), P(i + 1, jj), P(i + 2, jj)]
    return [catmull(q[0][0], q[1][0], q[2][0], q[3][0], u), catmull(q[0][1], q[1][1], q[2][1], q[3][1], u)]
  }
  const r = [row(j - 1), row(j), row(j + 1), row(j + 2)]
  return [catmull(r[0][0], r[1][0], r[2][0], r[3][0], v), catmull(r[0][1], r[1][1], r[2][1], r[3][1], v)]
}

function quadGeometry(pts: Vec2[], mesh: Mesh | null): Omit<SurfaceGeometry, 'kind'> {
  const size: Vec2 = [Math.max(1, (dist(pts[0], pts[1]) + dist(pts[3], pts[2])) / 2), Math.max(1, (dist(pts[0], pts[3]) + dist(pts[1], pts[2])) / 2)]
  const outlineUv: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  if (mesh && mesh.cols >= 1 && mesh.rows >= 1) {
    const ctrl = meshControlPoints(pts, mesh)
    const nx = mesh.cols * MESH_SUBDIV, ny = mesh.rows * MESH_SUBDIV
    const pos: Vec2[] = [], uv: Vec2[] = [], tris: number[] = []
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const s = i / nx, t = j / ny
      pos.push(meshEval(ctrl, mesh, s, t))
      uv.push([s, t])
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1
      tris.push(a, b, c, a, c, d)
    }
    // outline along the mesh border
    const outline: Vec2[] = []
    for (let i = 0; i < nx; i++) outline.push(pos[i])
    for (let j = 0; j < ny; j++) outline.push(pos[j * (nx + 1) + nx])
    for (let i = nx; i > 0; i--) outline.push(pos[ny * (nx + 1) + i])
    for (let j = ny; j > 0; j--) outline.push(pos[j * (nx + 1)])
    return { ...fromTris(pos, uv, tris), outline, outlineUv, closed: true, size, aspect: size[0] / size[1], hInv: null }
  }
  let hInv: Mat3 | null = null
  try {
    hInv = invert3(squareToQuad(pts))
  } catch {
    hInv = null
  }
  const uv: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  return { ...fromTris(pts, uv, [0, 1, 2, 0, 2, 3]), outline: pts, outlineUv, closed: true, size, aspect: size[0] / size[1], hInv }
}

function polyGeometry(pts: Vec2[]): Omit<SurfaceGeometry, 'kind'> {
  const { min, size } = bbox(pts)
  const uv = pts.map(([x, y]) => [(x - min[0]) / size[0], (y - min[1]) / size[1]] as Vec2)
  const tris = triangulate(pts)
  return { ...fromTris(pts, uv, tris), outline: pts, outlineUv: uv, closed: true, size, aspect: size[0] / size[1], hInv: null }
}

function circleGeometry(c: Vec2, rim: Vec2): Omit<SurfaceGeometry, 'kind'> {
  const r = Math.max(0.5, dist(c, rim))
  const a0 = Math.atan2(rim[1] - c[1], rim[0] - c[0])
  const pts: Vec2[] = []
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = a0 + (i / CIRCLE_SEGMENTS) * Math.PI * 2
    pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r])
  }
  const pos: Vec2[] = [c, ...pts]
  const uv = pos.map(([x, y]) => [(x - (c[0] - r)) / (2 * r), (y - (c[1] - r)) / (2 * r)] as Vec2)
  const tris: number[] = []
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) tris.push(0, 1 + i, 1 + ((i + 1) % CIRCLE_SEGMENTS))
  return { ...fromTris(pos, uv, tris), outline: pts, outlineUv: uv.slice(1), closed: true, size: [2 * r, 2 * r], aspect: 1, hInv: null }
}

/** A stroked polyline, LINE_WIDTH wide, miter joins (clamped), uv.x = arc length fraction. */
export function strokePolyline(pts: Vec2[], width = LINE_WIDTH): Omit<SurfaceGeometry, 'kind'> {
  const n = pts.length
  const closed = n > 2 && dist(pts[0], pts[n - 1]) < 0.01
  const lens = [0]
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + dist(pts[i - 1], pts[i]))
  const total = Math.max(1e-3, lens[n - 1])
  const hw = width / 2
  const pos: Vec2[] = [], uv: Vec2[] = [], tris: number[] = []
  const dir = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.max(1e-6, dist(a, b))
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  }
  for (let i = 0; i < n; i++) {
    let prev = i > 0 ? dir(pts[i - 1], pts[i]) : null
    let next = i < n - 1 ? dir(pts[i], pts[i + 1]) : null
    if (closed && i === 0) prev = dir(pts[n - 2], pts[0])
    if (closed && i === n - 1) next = dir(pts[0], pts[1])
    const d = prev && next ? [prev[0] + next[0], prev[1] + next[1]] : (prev ?? next ?? [1, 0])
    const dl = Math.hypot(d[0], d[1]) || 1
    const tx = d[0] / dl, ty = d[1] / dl
    let nx = -ty, ny = tx
    let scale = 1
    if (prev && next) {
      const dot = nx * -prev[1] + ny * prev[0]
      scale = Math.min(4, 1 / Math.max(0.25, dot))
    }
    nx *= hw * scale
    ny *= hw * scale
    const s = lens[i] / total
    pos.push([pts[i][0] + nx, pts[i][1] + ny], [pts[i][0] - nx, pts[i][1] - ny])
    uv.push([s, 0], [s, 1])
    if (i > 0) {
      const a = (i - 1) * 2
      tris.push(a, a + 1, a + 3, a, a + 3, a + 2)
    }
  }
  const outline = pts
  return { ...fromTris(pos, uv, tris), outline, outlineUv: [], closed: false, size: [total, width], aspect: total / width, hInv: null }
}

/** Builds the geometry of one surface from its points. Null when it has too few points. */
export function surfaceGeometry(s: Surface, points: Map<string, Point> | Point[]): SurfaceGeometry | null {
  const map = points instanceof Map ? points : new Map(points.map((p) => [p.id, p]))
  const pts: Vec2[] = s.pointIds.map((id) => map.get(id)).filter((p): p is Point => !!p).map((p) => [p.x, p.y])
  let g: Omit<SurfaceGeometry, 'kind'> | null = null
  switch (s.kind) {
    case 'quad':
      if (pts.length >= 4) g = quadGeometry(pts.slice(0, 4), s.mesh)
      else if (pts.length === 3) g = polyGeometry(pts)
      break
    case 'tri':
    case 'poly':
    case 'mask':
      if (pts.length >= 3) g = polyGeometry(pts)
      break
    case 'circle':
      if (pts.length >= 2) g = circleGeometry(pts[0], pts[1])
      break
    case 'line':
      if (pts.length >= 2) g = strokePolyline(pts)
      break
  }
  return g ? { ...g, kind: s.kind } : null
}

/** uv of a scene position for a plain quad (for tests and the editor). */
export function quadUv(hInv: Mat3, x: number, y: number): Vec2 {
  return applyH(hInv, x, y)
}

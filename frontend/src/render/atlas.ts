/**
 * Object atlases (protocol §12): an object's faces unfolded flat, edge to edge, like a dieline. Pure, so the engine,
 * the editor's content view and the template export all agree on where each face lands.
 */
import type { Atlas, AtlasRect, AtlasRotation, Point, Scene, SceneObject, Surface } from '../entities/scene/types'
import { applyH, type Vec2 } from './math/homography'
import { surfaceGeometry, type SurfaceGeometry } from './math/geometry'

/** uv → atlas px: o + u·U + v·V. */
export interface Affine {
  o: Vec2
  u: Vec2
  v: Vec2
}

const QUAD_UV: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

const DIRS: Record<AtlasRotation, { u: Vec2; v: Vec2 }> = {
  0: { u: [1, 0], v: [0, 1] },
  90: { u: [0, 1], v: [-1, 0] },
  180: { u: [-1, 0], v: [0, -1] },
  270: { u: [0, -1], v: [1, 0] },
}

/** The face uv → atlas px mapping of a rect (see the rotation table in protocol §12). */
export function rectAffine(r: AtlasRect): Affine {
  const rot = (r.rotation ?? 0) as AtlasRotation
  switch (rot) {
    case 90:
      return { o: [r.x + r.w, r.y], u: [0, r.h], v: [-r.w, 0] }
    case 180:
      return { o: [r.x + r.w, r.y + r.h], u: [-r.w, 0], v: [0, -r.h] }
    case 270:
      return { o: [r.x, r.y + r.h], u: [0, -r.h], v: [r.w, 0] }
    default:
      return { o: [r.x, r.y], u: [r.w, 0], v: [0, r.h] }
  }
}

export function applyAffine(a: Affine, u: number, v: number): Vec2 {
  return [a.o[0] + u * a.u[0] + v * a.v[0], a.o[1] + u * a.u[1] + v * a.v[1]]
}

/** Inverse of an affine: atlas px → uv (null when degenerate). */
export function invertAffine(a: Affine, x: number, y: number): Vec2 | null {
  const det = a.u[0] * a.v[1] - a.u[1] * a.v[0]
  if (Math.abs(det) < 1e-9) return null
  const dx = x - a.o[0]
  const dy = y - a.o[1]
  return [(dx * a.v[1] - dy * a.v[0]) / det, (a.u[0] * dy - a.u[1] * dx) / det]
}

/** Surfaces of an object that take part in the atlas as faces (no lines, masks or details). */
export function atlasFaces(object: SceneObject): Surface[] {
  return object.surfaces.filter((s) => s.role === 'face' && s.kind !== 'line' && s.kind !== 'mask')
}

const overlaps = (a: AtlasRect, b: AtlasRect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5

/** The deterministic auto layout (protocol §12 Atlas). */
export function autoAtlas(scene: Scene, object: SceneObject): Atlas {
  const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
  const faces = atlasFaces(object)
  const geo = new Map<string, SurfaceGeometry>()
  for (const f of faces) {
    const g = surfaceGeometry(f, pts)
    if (g) geo.set(f.id, g)
  }
  const quads = faces.filter((f) => f.kind === 'quad' && f.pointIds.length === 4 && geo.has(f.id))
  const placed = new Map<string, AtlasRect>()

  // root: the face whose v axis (first point → last point) points most nearly straight down, then the larger, then the earlier
  const down = (f: Surface) => {
    const a = pts.get(f.pointIds[0])!
    const b = pts.get(f.pointIds[3])!
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return Math.round(((b.y - a.y) / l) * 1000) / 1000
  }
  const area = (f: Surface) => geo.get(f.id)!.size[0] * geo.get(f.id)!.size[1]
  const remaining = [...quads]
  while (remaining.length) {
    let root = remaining[0]
    for (const f of remaining) {
      const d = down(f) - down(root)
      if (d > 0 || (d === 0 && area(f) > area(root) + 1e-6)) root = f
    }
    if (placed.size) break // one connected unfold; the rest go in the row below
    const [w, h] = geo.get(root.id)!.size
    placed.set(root.id, { x: 0, y: 0, w, h, rotation: 0 })
    // breadth first, in surface order
    const queue = [root.id]
    while (queue.length) {
      const aid = queue.shift()!
      const a = quads.find((q) => q.id === aid)!
      const aAff = rectAffine(placed.get(aid)!)
      for (const b of quads) {
        if (placed.has(b.id)) continue
        const r = attach(a, aAff, b, geo.get(b.id)!)
        if (!r) continue
        if ([...placed.values()].some((p) => overlaps(p, r))) continue
        placed.set(b.id, r)
        queue.push(b.id)
      }
    }
    remaining.splice(0, remaining.length, ...remaining.filter((f) => !placed.has(f.id)))
  }

  // everything else in a row under the unfold, at its flat size
  let minX = Infinity, minY = Infinity, maxY = -Infinity
  for (const r of placed.values()) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!placed.size) {
    minX = 0
    minY = 0
    maxY = 0
  }
  let rowX = minX
  const rowY = placed.size ? maxY + 16 : 0
  for (const f of faces) {
    if (placed.has(f.id) || !geo.has(f.id)) continue
    const [w, h] = geo.get(f.id)!.size
    placed.set(f.id, { x: rowX, y: rowY, w, h, rotation: 0 })
    rowX += w + 16
  }

  const out: Record<string, AtlasRect> = {}
  let W = 1, H = 1
  for (const f of faces) {
    const r = placed.get(f.id)
    if (!r) continue
    const x0 = Math.round(r.x - minX), y0 = Math.round(r.y - minY)
    const x1 = Math.round(r.x + r.w - minX), y1 = Math.round(r.y + r.h - minY)
    out[f.id] = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), rotation: r.rotation }
    W = Math.max(W, x1)
    H = Math.max(H, y1)
  }
  return { width: W, height: H, faces: out }
}

/** Places quad b against the edge it shares with the placed quad a, or null. */
function attach(a: Surface, aAff: Affine, b: Surface, bGeo: SurfaceGeometry): AtlasRect | null {
  for (let i = 0; i < 4; i++) {
    const pa = a.pointIds[i]
    const pb = a.pointIds[(i + 1) % 4]
    const ja = b.pointIds.indexOf(pa)
    const jb = b.pointIds.indexOf(pb)
    if (ja < 0 || jb < 0) continue
    const uvA = QUAD_UV[ja]
    const uvB = QUAD_UV[jb]
    const du = uvB[0] - uvA[0]
    const dv = uvB[1] - uvA[1]
    if (Math.abs(du) + Math.abs(dv) !== 1) continue // a diagonal, not an edge
    const P = applyAffine(aAff, ...QUAD_UV[i])
    const Q = applyAffine(aAff, ...QUAD_UV[(i + 1) % 4])
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    if (L < 1e-6) continue
    const dir: Vec2 = [Math.round((Q[0] - P[0]) / L), Math.round((Q[1] - P[1]) / L)]
    for (const rot of [0, 90, 180, 270] as AtlasRotation[]) {
      const d = DIRS[rot]
      const m: Vec2 = [du * d.u[0] + dv * d.v[0], du * d.u[1] + dv * d.v[1]]
      if (m[0] !== dir[0] || m[1] !== dir[1]) continue
      const s = L / (du !== 0 ? bGeo.size[0] : bGeo.size[1])
      const wu = bGeo.size[0] * s
      const hv = bGeo.size[1] * s
      const U: Vec2 = [d.u[0] * wu, d.u[1] * wu]
      const V: Vec2 = [d.v[0] * hv, d.v[1] * hv]
      const o: Vec2 = [P[0] - uvA[0] * U[0] - uvA[1] * V[0], P[1] - uvA[0] * U[1] - uvA[1] * V[1]]
      const xs = [o[0], o[0] + U[0], o[0] + V[0], o[0] + U[0] + V[0]]
      const ys = [o[1], o[1] + U[1], o[1] + V[1], o[1] + U[1] + V[1]]
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, rotation: rot }
    }
  }
  return null
}

/** The stored atlas, or the auto layout when there is none. */
export function resolveAtlas(scene: Scene, object: SceneObject): Atlas {
  const a = object.atlas
  if (a && a.width > 0 && a.height > 0 && a.faces) return a
  return autoAtlas(scene, object)
}

/** A content uv point of surface `s` in its own geometry's frame → scene px (inverse of the geometry's uv). */
function uvToScene(geo: SurfaceGeometry, s: Surface, pts: Map<string, Point>, u: number, v: number): Vec2 | null {
  const ps = s.pointIds.map((id) => pts.get(id)).filter((p): p is Point => !!p)
  if (s.kind === 'quad' && ps.length >= 4) {
    // bilinear of the corners (exact for parallelograms, close for the rest)
    const [a, b, c, d] = ps
    return [
      (1 - u) * (1 - v) * a.x + u * (1 - v) * b.x + u * v * c.x + (1 - u) * v * d.x,
      (1 - u) * (1 - v) * a.y + u * (1 - v) * b.y + u * v * c.y + (1 - u) * v * d.y,
    ]
  }
  // tri, poly, circle: uv is the bounding box
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of geo.outline) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  if (!Number.isFinite(x0)) return null
  return [x0 + u * (x1 - x0), y0 + v * (y1 - y0)]
}

/** scene px → the uv of surface `s` (quads: exact homography; others: bounding box). */
function sceneToUv(geo: SurfaceGeometry, x: number, y: number): Vec2 {
  if (geo.hInv) return applyH(geo.hInv, x, y)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [px, py] of geo.outline) {
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py)
  }
  return [(x - x0) / Math.max(1e-6, x1 - x0), (y - y0) / Math.max(1e-6, y1 - y0)]
}

/**
 * Where each surface of an object sits in its atlas: faces by their rect, details inside their parent face (their uv
 * corners mapped through the parent's uv). Surfaces without a place are missing from the map.
 */
export function atlasAffines(scene: Scene, object: SceneObject, atlas: Atlas = resolveAtlas(scene, object)): Map<string, Affine> {
  const out = new Map<string, Affine>()
  for (const [id, r] of Object.entries(atlas.faces)) if (object.surfaces.some((s) => s.id === id)) out.set(id, rectAffine(r))
  const pts = new Map<string, Point>(scene.points.map((p) => [p.id, p]))
  const byId = new Map(object.surfaces.map((s) => [s.id, s]))
  for (const s of object.surfaces) {
    if (out.has(s.id) || !s.parentId || s.kind === 'line' || s.kind === 'mask') continue
    const parent = byId.get(s.parentId)
    const pa = parent ? out.get(parent.id) : null
    if (!parent || !pa) continue
    const g = surfaceGeometry(s, pts)
    const pg = surfaceGeometry(parent, pts)
    if (!g || !pg) continue
    const corner = (u: number, v: number): Vec2 | null => {
      const p = uvToScene(g, s, pts, u, v)
      if (!p) return null
      const puv = sceneToUv(pg, p[0], p[1])
      return applyAffine(pa, puv[0], puv[1])
    }
    const o = corner(0, 0), cu = corner(1, 0), cv = corner(0, 1)
    if (!o || !cu || !cv) continue
    out.set(s.id, { o, u: [cu[0] - o[0], cu[1] - o[1]], v: [cv[0] - o[0], cv[1] - o[1]] })
  }
  return out
}

/**
 * (protocol §19) The object accent's geometry: which faces an object's silhouette is made of, and the silhouette
 * itself. Faces that meet share corner points (protocol §1), so an edge two faces use is inside the object and an
 * edge only one face uses is on its outline. The outer edges are chained into polylines (closed ones end on their
 * first point). Details, edges and masks are never part of it.
 */
import { DEFAULT_OBJECT_ACCENT, type ObjectAccent, type Point, type Scene, type SceneObject, type Surface } from '../entities/scene/types'
import { surfaceGeometry } from './math/geometry'
import type { Vec2 } from './math/homography'

/** The scene's accent with defaults filled in. */
export function objectAccentOf(scene: Scene | null | undefined): ObjectAccent {
  const a = scene?.objectAccent
  if (!a) return DEFAULT_OBJECT_ACCENT
  return {
    on: !!a.on,
    objects: a.objects ?? 'all',
    outline: { ...DEFAULT_OBJECT_ACCENT.outline, ...(a.outline ?? {}) },
    fill: { ...DEFAULT_OBJECT_ACCENT.fill, ...(a.fill ?? {}) },
  }
}

/** The objects the accent draws: visible ones, all or the listed ids. */
export function accentObjects(scene: Scene, accent: ObjectAccent): SceneObject[] {
  return scene.objects.filter((o) => o.visible !== false && (accent.objects === 'all' || accent.objects.includes(o.id)))
}

/** The faces a silhouette is made of: visible surfaces that are not details, edges, lines or masks. */
export function silhouetteFaces(obj: SceneObject): Surface[] {
  return obj.surfaces.filter((s) => s.visible !== false && !s.parentId && s.role !== 'detail' && s.role !== 'edge' && s.kind !== 'line' && s.kind !== 'mask')
}

const key = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

/** The object's outer outline in scene px: polylines along the edges only one face uses. */
export function silhouette(obj: SceneObject, points: Map<string, Point> | Point[]): Vec2[][] {
  const pts = points instanceof Map ? points : new Map(points.map((p) => [p.id, p]))
  const count = new Map<string, number>()
  const edges: Array<[string, string]> = []
  const out: Vec2[][] = []
  for (const s of silhouetteFaces(obj)) {
    if (s.kind === 'circle') {
      // a circle shares no edges: its own outline is on the silhouette
      const g = surfaceGeometry(s, pts)
      if (g && g.outline.length > 2) out.push([...g.outline, g.outline[0]])
      continue
    }
    const ids = s.pointIds.filter((id) => pts.has(id))
    const n = s.kind === 'quad' ? Math.min(4, ids.length) : ids.length
    if (n < 3) continue
    for (let i = 0; i < n; i++) {
      const a = ids[i], b = ids[(i + 1) % n]
      if (a === b) continue
      const k = key(a, b)
      if (!count.has(k)) edges.push([a, b])
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  const outer = edges.filter(([a, b]) => count.get(key(a, b)) === 1)
  // chain: from every point, the outer edges that leave it
  const adj = new Map<string, Array<{ to: string; i: number }>>()
  outer.forEach(([a, b], i) => {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const l = adj.get(p) ?? []
      l.push({ to: q, i })
      adj.set(p, l)
    }
  })
  const used = new Set<number>()
  const at = (id: string): Vec2 => {
    const p = pts.get(id)!
    return [p.x, p.y]
  }
  for (let start = 0; start < outer.length; start++) {
    if (used.has(start)) continue
    used.add(start)
    const [a, b] = outer[start]
    const ids = [a, b]
    let cur = b
    for (;;) {
      const next = (adj.get(cur) ?? []).find((e) => !used.has(e.i))
      if (!next) break
      used.add(next.i)
      ids.push(next.to)
      cur = next.to
      if (cur === a) break
    }
    out.push(ids.map(at))
  }
  return out
}

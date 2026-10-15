/** Pure helpers for the content space: where you are (title, breadcrumbs, mini map) and whether a place is empty. */
import { outlineOf, type Vec } from '../../geometry'
import type { Scene, SceneObject, Surface } from '../../types'

export interface ContentCrumb {
  kind: 'object' | 'face'
  id: string
  label: string
}

const drawable = (x: Surface) => x.kind !== 'line' && x.kind !== 'mask'

/** The object, then each face from the outermost parent down to the open face (a detail shows its face first). */
export function contentCrumbs(scene: Scene, objectId: string, surfaceId: string | null): ContentCrumb[] {
  const obj = scene.objects.find((o) => o.id === objectId)
  if (!obj) return []
  const out: ContentCrumb[] = [{ kind: 'object', id: obj.id, label: obj.name }]
  const chain: Surface[] = []
  let cur = surfaceId ? obj.surfaces.find((x) => x.id === surfaceId) : undefined
  for (let guard = 0; cur && guard < 16; guard++) {
    chain.unshift(cur)
    const pid: string | null = cur.parentId
    cur = pid ? obj.surfaces.find((x) => x.id === pid) : undefined
  }
  for (const x of chain) out.push({ kind: 'face', id: x.id, label: x.name })
  return out
}

/** "zimacube · right face", "zimacube · bay 1 on right", or "zimacube · all faces". */
export function contentTitle(scene: Scene, objectId: string, surfaceId: string | null): string {
  const crumbs = contentCrumbs(scene, objectId, surfaceId)
  if (!crumbs.length) return ''
  const obj = crumbs[0].label
  const faces = crumbs.slice(1)
  if (!faces.length) return `${obj} · all faces`
  const here = faces[faces.length - 1].label
  if (faces.length > 1) return `${obj} · ${here} on ${faces[faces.length - 2].label}`
  return /\bface$/i.test(here) ? `${obj} · ${here}` : `${obj} · ${here} face`
}

/** True when a face shows something of its own: a picture, an effect (a drawing counts once it has strokes), or a timeline clip. */
export function faceHasContent(scene: Scene, surfaceId: string): boolean {
  const s = scene.objects.flatMap((o) => o.surfaces).find((x) => x.id === surfaceId)
  if (!s) return false
  if ((s.layers?.length ?? 0) > 0) return true
  if (s.effects.some((e) => e.effect !== 'drawing' || (Array.isArray(e.params?.strokes) && (e.params.strokes as unknown[]).length > 0))) return true
  return scene.timeline.tracks.some((t) => t.target.kind === 'surface' && t.target.id === surfaceId && scene.timeline.clips.some((c) => c.trackId === t.id))
}

/** True when the object shows anything: a layer across it, or content on any of its faces and details. */
export function objectHasContent(scene: Scene, objectId: string): boolean {
  const obj = scene.objects.find((o) => o.id === objectId)
  if (!obj) return false
  if ((obj.layers?.length ?? 0) > 0) return true
  if (scene.timeline.tracks.some((t) => t.target.kind === 'object' && t.target.id === objectId && scene.timeline.clips.some((c) => c.trackId === t.id))) return true
  return obj.surfaces.some((x) => faceHasContent(scene, x.id))
}

export interface MiniFace {
  id: string
  name: string
  detail: boolean
  /** outline in scene px */
  pts: Vec[]
}

/**
 * The object's faces outlined as they sit on the stage (scene px), and a view box around them with a margin, for
 * the "where am I" map. Lines and masks are left out; details come after their faces so they draw on top.
 */
export function miniMap(scene: Scene, obj: SceneObject, margin = 0.08): { faces: MiniFace[]; box: { x: number; y: number; w: number; h: number } } | null {
  const pts = new Map(scene.points.map((p) => [p.id, p]))
  const faces: MiniFace[] = []
  for (const s of obj.surfaces.filter(drawable)) {
    const raw = s.pointIds.map((id) => pts.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    if (raw.length < 2) continue
    faces.push({ id: s.id, name: s.name, detail: !!s.parentId, pts: outlineOf(s.kind, raw.map((p) => ({ x: p.x, y: p.y }))) })
  }
  if (!faces.length) return null
  faces.sort((a, b) => Number(a.detail) - Number(b.detail))
  const all = faces.flatMap((f) => f.pts)
  const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x))
  const y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y))
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  const m = Math.max(w, h) * margin
  return { faces, box: { x: x0 - m, y: y0 - m, w: w + 2 * m, h: h + 2 * m } }
}

export const CONTENT_TOUR_KEY = 'projmap.tour.content.v1'

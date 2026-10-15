import { BACKDROP_MODES, DEFAULT_UNDERLAY, type Attachment, type BackdropMode, type Clip, type Layer, type LayerStack, type Point, type Scene, type SceneKind, type SceneMode, type SceneObject, type Surface, type Track, type Underlay } from './types'

export interface SurfaceRef {
  object: SceneObject
  objectIndex: number
  surface: Surface
  surfaceIndex: number
}

/** Every surface with its object and indexes, in draw order. */
export function allSurfaces(scene: Scene): SurfaceRef[] {
  const out: SurfaceRef[] = []
  scene.objects.forEach((object, objectIndex) =>
    object.surfaces.forEach((surface, surfaceIndex) => out.push({ object, objectIndex, surface, surfaceIndex })),
  )
  return out
}

export function findSurface(scene: Scene, id: string): SurfaceRef | null {
  return allSurfaces(scene).find((r) => r.surface.id === id) ?? null
}

export function pointMap(scene: Scene): Map<string, Point> {
  return new Map(scene.points.map((p) => [p.id, p]))
}

export function pointIndex(scene: Scene, id: string): number {
  return scene.points.findIndex((p) => p.id === id)
}

/** The surface's points in order (missing ids are skipped). */
export function surfacePoints(scene: Scene, s: Surface, pts = pointMap(scene)): Point[] {
  return s.pointIds.map((id) => pts.get(id)).filter((p): p is Point => !!p)
}

/** Ids of other surfaces that use a point. */
export function surfacesUsingPoint(scene: Scene, pointId: string): SurfaceRef[] {
  return allSurfaces(scene).filter((r) => r.surface.pointIds.includes(pointId))
}

/** The surfaces a timeline track applies to. */
export function trackSurfaces(scene: Scene, track: Track): Surface[] {
  const t = track.target
  if (t.kind === 'all') return allSurfaces(scene).map((r) => r.surface)
  if (t.kind === 'object') return scene.objects.find((o) => o.id === t.id)?.surfaces ?? []
  if (t.kind === 'sound' || !t.id) return []
  const r = findSurface(scene, t.id)
  return r ? [r.surface] : []
}

export function clipsOfTrack(scene: Scene, trackId: string): Clip[] {
  return scene.timeline.clips.filter((c) => c.trackId === trackId)
}

/** Where a backdrop layer lives: its stack (mode) and index, or null. */
export function locateLayer(scene: Scene, id: string): { mode: BackdropMode; i: number } | null {
  for (const mode of BACKDROP_MODES) {
    const i = (scene.backdrop[mode]?.layers ?? []).findIndex((l: Layer) => l.id === id)
    if (i >= 0) return { mode, i }
  }
  return null
}

export function findLayer(scene: Scene, id: string): (Layer & { mode: BackdropMode }) | null {
  const loc = locateLayer(scene, id)
  return loc ? { ...scene.backdrop[loc.mode].layers[loc.i], mode: loc.mode } : null
}

/** The layers of one stack (empty for a missing stack). */
export function stackLayers(scene: Scene, mode: BackdropMode): Layer[] {
  return scene.backdrop[mode]?.layers ?? []
}

/** Every layer of every stack, with its mode. */
export function allLayers(scene: Scene): Array<Layer & { mode: BackdropMode }> {
  return BACKDROP_MODES.flatMap((mode) => stackLayers(scene, mode).map((l) => ({ ...l, mode })))
}

export function underlayOf(scene: Scene): Underlay {
  return { ...DEFAULT_UNDERLAY, ...(scene.underlay ?? {}) }
}

/**
 * What the output draws for a scene in a mode (protocol §1): the backdrop layers, how bright they are, and whether the
 * mapped objects show. A backdrop mode draws its own stack and no objects; objects mode draws the objects, over the
 * underlay when it is on.
 */
export function onAirPlan(scene: Scene, mode: Scene['mode'] = scene.mode): { layers: Layer[]; level: number; objects: boolean } {
  if (mode === 'objects') {
    const u = underlayOf(scene)
    return { layers: u.on ? stackLayers(scene, u.from) : [], level: Math.max(0, Math.min(1, u.level)), objects: true }
  }
  return { layers: stackLayers(scene, (BACKDROP_MODES as string[]).includes(mode) ? (mode as BackdropMode) : 'static'), level: 1, objects: false }
}

/** Points used by no surface. */
export function orphanPoints(scene: Scene): string[] {
  const used = new Set(allSurfaces(scene).flatMap((r) => r.surface.pointIds))
  return scene.points.filter((p) => !used.has(p.id)).map((p) => p.id)
}

/** (§15) what a scene is for: its own `kind`, else inferred (objects → mapping, else its mode, objects mode → mapping). */
export function sceneKind(scene: Pick<Scene, 'kind' | 'mode'> & { objects?: Scene['objects'] }): SceneKind {
  if (scene.kind) return scene.kind
  if (scene.objects?.length) return 'mapping'
  return scene.mode === 'objects' ? 'mapping' : (scene.mode as SceneKind) ?? 'static'
}

/** (§15) the mode a kind puts on air. */
export function kindMode(kind: SceneKind): SceneMode {
  return kind === 'mapping' ? 'objects' : kind
}

/** (§15) the stack of a backdrop mode with its light and attachments (absent on older documents). */
export function stackOf(scene: Scene, mode: BackdropMode): LayerStack {
  return scene.backdrop[mode] ?? { layers: [] }
}

/** (§15) the attachments of a static or live stack. */
export function stackAttachments(scene: Scene, mode: BackdropMode): Attachment[] {
  return stackOf(scene, mode).attachments ?? []
}

/** Where an attachment lives: its stack and index, or null. */
export function locateAttachment(scene: Scene, id: string): { mode: BackdropMode; i: number } | null {
  for (const mode of ['static', 'live'] as const) {
    const i = stackAttachments(scene, mode).findIndex((a) => a.id === id)
    if (i >= 0) return { mode, i }
  }
  return null
}

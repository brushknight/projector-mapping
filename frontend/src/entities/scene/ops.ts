/**
 * Pure builders that turn an editing intent into JSON Patch ops against a scene. Each looks entities up by id, so the
 * same call recomputes correct indexes on a newer document when the server rejects a patch as stale.
 * They return null when the target no longer exists.
 */
import { pointer } from '../../shared/lib/jsonPatch'
import { locateLayer, stackLayers } from './lib'
import type { Atlas, AtlasRect, BackdropMode, Clip, ContentLayer, Cue, EffectInstance, Layer, LayerStack, Mesh, PatchOp, Point, Scene, SceneMode, SceneObject, Surface, Track, Underlay } from './types'

type Ops = PatchOp[] | null

export function locateSurface(scene: Scene, id: string): { o: number; s: number } | null {
  for (let o = 0; o < scene.objects.length; o++) {
    const s = scene.objects[o].surfaces.findIndex((x) => x.id === id)
    if (s >= 0) return { o, s }
  }
  return null
}

export const surfacePath = (loc: { o: number; s: number }, ...rest: Array<string | number>) => pointer('objects', loc.o, 'surfaces', loc.s, ...rest)

// ── points ───────────────────────────────────────────────────────────────────

export function movePoint(scene: Scene, pointId: string, x: number, y: number): Ops {
  const i = scene.points.findIndex((p) => p.id === pointId)
  if (i < 0) return null
  return [
    { op: 'replace', path: pointer('points', i, 'x'), value: x },
    { op: 'replace', path: pointer('points', i, 'y'), value: y },
  ]
}

/** Moves several points by a delta (nudging a whole surface). */
export function movePoints(scene: Scene, ids: string[], dx: number, dy: number): Ops {
  const ops: PatchOp[] = []
  for (const id of new Set(ids)) {
    const i = scene.points.findIndex((p) => p.id === id)
    if (i < 0) continue
    const p = scene.points[i]
    ops.push({ op: 'replace', path: pointer('points', i, 'x'), value: p.x + dx }, { op: 'replace', path: pointer('points', i, 'y'), value: p.y + dy })
  }
  return ops.length ? ops : null
}

/**
 * Welds `fromId` onto `toId`: every surface that used `fromId` uses `toId`, and `fromId` is removed. This is how the
 * magnet makes faces share a corner.
 */
export function mergePoint(scene: Scene, fromId: string, toId: string): Ops {
  if (fromId === toId) return null
  const fi = scene.points.findIndex((p) => p.id === fromId)
  if (fi < 0 || !scene.points.some((p) => p.id === toId)) return null
  const ops: PatchOp[] = []
  scene.objects.forEach((obj, o) =>
    obj.surfaces.forEach((srf, s) => {
      const hasTo = srf.pointIds.includes(toId)
      srf.pointIds.forEach((pid, k) => {
        if (pid !== fromId) return
        // a surface can't use one point twice; keep the weld anyway for lines (a closed loop)
        if (hasTo && srf.kind !== 'line') return
        ops.push({ op: 'replace', path: pointer('objects', o, 'surfaces', s, 'pointIds', k), value: toId })
      })
    }),
  )
  ops.push({ op: 'remove', path: pointer('points', fi) })
  return ops
}

/** Removes points no surface uses (from the highest index down so indexes stay valid). */
export function removeOrphans(scene: Scene, candidates?: string[]): PatchOp[] {
  const used = new Set(scene.objects.flatMap((o) => o.surfaces.flatMap((s) => s.pointIds)))
  const ids = new Set(candidates ?? scene.points.map((p) => p.id))
  const idx: number[] = []
  scene.points.forEach((p, i) => ids.has(p.id) && !used.has(p.id) && idx.push(i))
  return idx.reverse().map((i) => ({ op: 'remove' as const, path: pointer('points', i) }))
}

// ── objects and surfaces ─────────────────────────────────────────────────────

/**
 * Adds a surface with its new points. `objectId` null creates a new object named `objectName`.
 * Points in `newPoints` are appended to the pool; the surface may also reference existing point ids.
 */
export function addSurface(scene: Scene, objectId: string | null, surface: Surface, newPoints: Point[], newObject?: Omit<SceneObject, 'surfaces'>): Ops {
  const ops: PatchOp[] = newPoints.map((p) => ({ op: 'add' as const, path: '/points/-', value: p }))
  if (objectId) {
    const o = scene.objects.findIndex((x) => x.id === objectId)
    if (o < 0) return null
    ops.push({ op: 'add', path: pointer('objects', o, 'surfaces', '-'), value: surface })
  } else {
    if (!newObject) return null
    ops.push({ op: 'add', path: '/objects/-', value: { ...newObject, surfaces: [surface] } })
  }
  return ops
}

export function addObject(object: SceneObject): PatchOp[] {
  return [{ op: 'add', path: '/objects/-', value: object }]
}

/** Deletes a surface, its detail children, and the points nothing uses any more. */
export function deleteSurface(scene: Scene, surfaceId: string): Ops {
  const loc = locateSurface(scene, surfaceId)
  if (!loc) return null
  const doomed = new Set([surfaceId])
  for (const o of scene.objects) for (const s of o.surfaces) if (s.parentId && doomed.has(s.parentId)) doomed.add(s.id)
  const ops: PatchOp[] = []
  const pts = new Set<string>()
  // remove from the end so indexes stay valid
  for (let o = scene.objects.length - 1; o >= 0; o--) {
    const obj = scene.objects[o]
    for (let s = obj.surfaces.length - 1; s >= 0; s--) {
      if (!doomed.has(obj.surfaces[s].id)) continue
      obj.surfaces[s].pointIds.forEach((p) => pts.add(p))
      ops.push({ op: 'remove', path: pointer('objects', o, 'surfaces', s) })
    }
  }
  // the atlas lists faces by id (protocol §12): drop the deleted ones
  scene.objects.forEach((obj, o) => {
    for (const id of doomed) if (obj.atlas?.faces && id in obj.atlas.faces) ops.push({ op: 'remove', path: pointer('objects', o, 'atlas', 'faces', id) })
  })
  const goneLayers = scene.objects.flatMap((o) => o.surfaces.filter((x) => doomed.has(x.id)).flatMap((x) => (x.layers ?? []).map((l) => l.id)))
  const after: Scene = { ...scene, objects: scene.objects.map((o) => ({ ...o, surfaces: o.surfaces.filter((s) => !doomed.has(s.id)) })) }
  ops.push(...removeOrphans(after, [...pts]))
  ops.push(...removeTracksFor(scene, (t) => (t.target.kind === 'layer' && goneLayers.includes(t.target.id)) || (t.target.kind === 'surface' && doomed.has(t.target.id))))
  return ops
}

/** Removes the tracks that match (and their clips), from the end so indexes stay valid. */
function removeTracksFor(scene: Scene, match: (t: Track) => boolean): PatchOp[] {
  const gone = new Set(scene.timeline.tracks.filter(match).map((t) => t.id))
  if (!gone.size) return []
  const ops: PatchOp[] = []
  for (let c = scene.timeline.clips.length - 1; c >= 0; c--) if (gone.has(scene.timeline.clips[c].trackId)) ops.push({ op: 'remove', path: pointer('timeline', 'clips', c) })
  for (let t = scene.timeline.tracks.length - 1; t >= 0; t--) if (gone.has(scene.timeline.tracks[t].id)) ops.push({ op: 'remove', path: pointer('timeline', 'tracks', t) })
  return ops
}

export function deleteObject(scene: Scene, objectId: string): Ops {
  const o = scene.objects.findIndex((x) => x.id === objectId)
  if (o < 0) return null
  const obj = scene.objects[o]
  const pts = obj.surfaces.flatMap((s) => s.pointIds)
  const surfaces = new Set(obj.surfaces.map((x) => x.id))
  const layers = new Set([...(obj.layers ?? []), ...obj.surfaces.flatMap((x) => x.layers ?? [])].map((l) => l.id))
  const after: Scene = { ...scene, objects: scene.objects.filter((x) => x.id !== objectId) }
  return [
    { op: 'remove', path: pointer('objects', o) },
    ...removeOrphans(after, pts),
    ...removeTracksFor(scene, (t) => (t.target.kind === 'object' && t.target.id === objectId) || (t.target.kind === 'surface' && surfaces.has(t.target.id)) || (t.target.kind === 'layer' && layers.has(t.target.id))),
  ]
}

export function setSurfaceField<K extends keyof Surface>(scene: Scene, surfaceId: string, key: K, value: Surface[K]): Ops {
  const loc = locateSurface(scene, surfaceId)
  if (!loc) return null
  return [{ op: 'replace', path: surfacePath(loc, key), value }]
}

export function setObjectField<K extends keyof SceneObject>(scene: Scene, objectId: string, key: K, value: SceneObject[K]): Ops {
  const o = scene.objects.findIndex((x) => x.id === objectId)
  if (o < 0) return null
  return [{ op: 'replace', path: pointer('objects', o, key), value }]
}

export function setMesh(scene: Scene, surfaceId: string, mesh: Mesh | null): Ops {
  return setSurfaceField(scene, surfaceId, 'mesh', mesh)
}

/** A flat mesh: (cols+1)×(rows+1) zero offsets. */
export function flatMesh(cols: number, rows: number, bezier = false): Mesh {
  return { cols, rows, bezier, offsets: Array.from({ length: (cols + 1) * (rows + 1) }, () => [0, 0] as [number, number]) }
}

export function setMeshOffset(scene: Scene, surfaceId: string, index: number, dx: number, dy: number): Ops {
  const loc = locateSurface(scene, surfaceId)
  if (!loc) return null
  const mesh = scene.objects[loc.o].surfaces[loc.s].mesh
  if (!mesh || index < 0 || index >= mesh.offsets.length) return null
  return [
    { op: 'replace', path: surfacePath(loc, 'mesh', 'offsets', index, 0), value: dx },
    { op: 'replace', path: surfacePath(loc, 'mesh', 'offsets', index, 1), value: dy },
  ]
}

// ── surface effects ──────────────────────────────────────────────────────────

export function addSurfaceEffect(scene: Scene, surfaceId: string, fx: EffectInstance): Ops {
  const loc = locateSurface(scene, surfaceId)
  if (!loc) return null
  return [{ op: 'add', path: surfacePath(loc, 'effects', '-'), value: fx }]
}

function locateEffect(scene: Scene, surfaceId: string, fxId: string) {
  const loc = locateSurface(scene, surfaceId)
  if (!loc) return null
  const k = scene.objects[loc.o].surfaces[loc.s].effects.findIndex((e) => e.id === fxId)
  return k < 0 ? null : { ...loc, k }
}

export function removeSurfaceEffect(scene: Scene, surfaceId: string, fxId: string): Ops {
  const l = locateEffect(scene, surfaceId, fxId)
  return l ? [{ op: 'remove', path: surfacePath(l, 'effects', l.k) }] : null
}

export function surfaceEffectPath(scene: Scene, surfaceId: string, fxId: string, ...rest: Array<string | number>): string | null {
  const l = locateEffect(scene, surfaceId, fxId)
  return l ? surfacePath(l, 'effects', l.k, ...rest) : null
}

// ── backdrop layers ──────────────────────────────────────────────────────────

/** Switches what is on air (a leaf replace, so it applies on any base). */
export function setMode(mode: SceneMode): PatchOp[] {
  return [{ op: 'replace', path: '/mode', value: mode }]
}

/** Adds a layer on top of one stack (the live stack's add layer). */
export function addLayer(mode: BackdropMode, layer: Layer): PatchOp[] {
  return [{ op: 'add', path: pointer('backdrop', mode, 'layers', '-'), value: layer }]
}

/** Replaces a whole stack: how single-choice modes (static gobo, color gradient, scenery photo) pick. */
export function replaceStack(mode: BackdropMode, layers: Layer[]): PatchOp[] {
  return [{ op: 'replace', path: pointer('backdrop', mode, 'layers'), value: layers }]
}

/**
 * Picks the one layer of a single-choice stack and puts that mode on air. `keep` copies fields of the stack's current
 * first layer of the same kind (the gobo's light, the photo's adjustments) so a new pick keeps the look.
 */
export function pickSingle(scene: Scene, mode: BackdropMode, layer: Layer, keep: Array<'light' | 'params' | 'opacity' | 'blend'> = []): PatchOp[] {
  const prev = stackLayers(scene, mode).find((l) => l.kind === layer.kind)
  const next: Layer = { ...layer }
  if (prev) for (const k of keep) (next as unknown as Record<string, unknown>)[k] = prev[k]
  const ops = replaceStack(mode, [next])
  if (scene.mode !== mode) ops.push(...setMode(mode))
  return ops
}

/** Applies a preset: replaces its mode's stack and puts that mode on air (protocol §1 Preset). */
export function applyPresetOps(preset: { mode: BackdropMode; backdrop: LayerStack }): PatchOp[] {
  return [
    { op: 'replace', path: pointer('backdrop', preset.mode), value: { layers: preset.backdrop.layers } },
    ...setMode(preset.mode),
  ]
}

export function setUnderlay(scene: Scene, underlay: Underlay): PatchOp[] {
  return [{ op: scene.underlay ? 'replace' : 'add', path: '/underlay', value: underlay }]
}

export function removeLayer(scene: Scene, layerId: string): Ops {
  const loc = locateLayer(scene, layerId)
  return loc ? [{ op: 'remove', path: pointer('backdrop', loc.mode, 'layers', loc.i) }] : null
}

/** Moves a layer by `delta` positions within its stack (+1 = up toward the top). */
export function moveLayer(scene: Scene, layerId: string, delta: number): Ops {
  const loc = locateLayer(scene, layerId)
  if (!loc) return null
  const n = stackLayers(scene, loc.mode).length
  const j = Math.max(0, Math.min(n - 1, loc.i + delta))
  if (loc.i === j) return null
  return [{ op: 'move', from: pointer('backdrop', loc.mode, 'layers', loc.i), path: pointer('backdrop', loc.mode, 'layers', j) }]
}

export function layerPath(scene: Scene, layerId: string, ...rest: Array<string | number>): string | null {
  const loc = locateLayer(scene, layerId)
  return loc ? pointer('backdrop', loc.mode, 'layers', loc.i, ...rest) : null
}

// ── timeline ─────────────────────────────────────────────────────────────────

export function addTrack(track: Track): PatchOp[] {
  return [{ op: 'add', path: '/timeline/tracks/-', value: track }]
}

/** Removes a track and its clips. */
export function removeTrack(scene: Scene, trackId: string): Ops {
  const i = scene.timeline.tracks.findIndex((t) => t.id === trackId)
  if (i < 0) return null
  const ops: PatchOp[] = []
  for (let c = scene.timeline.clips.length - 1; c >= 0; c--) if (scene.timeline.clips[c].trackId === trackId) ops.push({ op: 'remove', path: pointer('timeline', 'clips', c) })
  ops.push({ op: 'remove', path: pointer('timeline', 'tracks', i) })
  return ops
}

export function addClip(clip: Clip): PatchOp[] {
  return [{ op: 'add', path: '/timeline/clips/-', value: clip }]
}

export function clipPath(scene: Scene, clipId: string, ...rest: Array<string | number>): string | null {
  const i = scene.timeline.clips.findIndex((c) => c.id === clipId)
  return i < 0 ? null : pointer('timeline', 'clips', i, ...rest)
}

/** Moves or resizes a clip (leaf replaces, so they apply even on a stale base). */
export function setClipTimes(scene: Scene, clipId: string, start: number, end: number, trackId?: string): Ops {
  const i = scene.timeline.clips.findIndex((c) => c.id === clipId)
  if (i < 0) return null
  const ops: PatchOp[] = [
    { op: 'replace', path: pointer('timeline', 'clips', i, 'start'), value: round3(start) },
    { op: 'replace', path: pointer('timeline', 'clips', i, 'end'), value: round3(end) },
  ]
  if (trackId && trackId !== scene.timeline.clips[i].trackId) ops.push({ op: 'replace', path: pointer('timeline', 'clips', i, 'trackId'), value: trackId })
  return ops
}

export function removeClip(scene: Scene, clipId: string): Ops {
  const i = scene.timeline.clips.findIndex((c) => c.id === clipId)
  return i < 0 ? null : [{ op: 'remove', path: pointer('timeline', 'clips', i) }]
}

export function addCue(cue: Cue): PatchOp[] {
  return [{ op: 'add', path: '/timeline/cues/-', value: cue }]
}

export function removeCue(scene: Scene, cueId: string): Ops {
  const i = scene.timeline.cues.findIndex((c) => c.id === cueId)
  return i < 0 ? null : [{ op: 'remove', path: pointer('timeline', 'cues', i) }]
}

export function cuePath(scene: Scene, cueId: string, ...rest: Array<string | number>): string | null {
  const i = scene.timeline.cues.findIndex((c) => c.id === cueId)
  return i < 0 ? null : pointer('timeline', 'cues', i, ...rest)
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The cues sorted by time, labelled Q1…Qn. */
export function sortedCues(scene: Scene): Array<Cue & { n: number }> {
  return [...scene.timeline.cues].sort((a, b) => a.at - b.at).map((c, i) => ({ ...c, n: i + 1 }))
}

// ── content layers and atlases (protocol §12) ────────────────────────────────

export type LayerOwner = { kind: 'surface'; id: string } | { kind: 'object'; id: string }

/** Where a content layer lives: its owner, the JSON pointer of its list and its index. */
export function locateContentLayer(scene: Scene, layerId: string): { owner: LayerOwner; list: string; i: number; layer: ContentLayer } | null {
  for (let o = 0; o < scene.objects.length; o++) {
    const obj = scene.objects[o]
    const i = (obj.layers ?? []).findIndex((l) => l.id === layerId)
    if (i >= 0) return { owner: { kind: 'object', id: obj.id }, list: pointer('objects', o, 'layers'), i, layer: obj.layers![i] }
    for (let k = 0; k < obj.surfaces.length; k++) {
      const j = (obj.surfaces[k].layers ?? []).findIndex((l) => l.id === layerId)
      if (j >= 0) return { owner: { kind: 'surface', id: obj.surfaces[k].id }, list: pointer('objects', o, 'surfaces', k, 'layers'), i: j, layer: obj.surfaces[k].layers![j] }
    }
  }
  return null
}

export function contentLayerPath(scene: Scene, layerId: string, ...rest: Array<string | number>): string | null {
  const l = locateContentLayer(scene, layerId)
  return l ? `${l.list}/${l.i}${rest.length ? pointer(...rest) : ''}` : null
}

/** The layers list of an owner (surface or object) and its pointer. */
function ownerList(scene: Scene, owner: LayerOwner): { path: string; layers: ContentLayer[] | undefined } | null {
  if (owner.kind === 'object') {
    const o = scene.objects.findIndex((x) => x.id === owner.id)
    return o < 0 ? null : { path: pointer('objects', o, 'layers'), layers: scene.objects[o].layers }
  }
  const loc = locateSurface(scene, owner.id)
  return loc ? { path: surfacePath(loc, 'layers'), layers: scene.objects[loc.o].surfaces[loc.s].layers } : null
}

/** Adds a layer on top of a surface's or an object's layers (creating the list when absent). */
export function addContentLayer(scene: Scene, owner: LayerOwner, layer: ContentLayer): Ops {
  const l = ownerList(scene, owner)
  if (!l) return null
  return l.layers ? [{ op: 'add', path: `${l.path}/-`, value: layer }] : [{ op: 'add', path: l.path, value: [layer] }]
}

/** Removes a content layer and the layer tracks that animate it. */
export function removeContentLayer(scene: Scene, layerId: string): Ops {
  const l = locateContentLayer(scene, layerId)
  if (!l) return null
  // the server leaves an empty list out (protocol §12), so the last layer takes the list with it
  const n = (ownerList(scene, l.owner)?.layers ?? []).length
  return [{ op: 'remove', path: n <= 1 ? l.list : `${l.list}/${l.i}` }, ...removeTracksFor(scene, (t) => t.target.kind === 'layer' && t.target.id === layerId)]
}

/** Moves a content layer by delta within its list (+1 = up, toward the top). */
export function moveContentLayer(scene: Scene, layerId: string, delta: number): Ops {
  const l = locateContentLayer(scene, layerId)
  if (!l) return null
  const n = (ownerList(scene, l.owner)?.layers ?? []).length
  const j = Math.max(0, Math.min(n - 1, l.i + delta))
  return j === l.i ? null : [{ op: 'move', from: `${l.list}/${l.i}`, path: `${l.list}/${j}` }]
}

/** Stores (or replaces) an object's atlas. */
export function setAtlas(scene: Scene, objectId: string, atlas: Atlas | null): Ops {
  const o = scene.objects.findIndex((x) => x.id === objectId)
  if (o < 0) return null
  return [{ op: scene.objects[o].atlas !== undefined ? 'replace' : 'add', path: pointer('objects', o, 'atlas'), value: atlas }]
}

/** Moves one face's rect in a stored atlas. */
export function setAtlasRect(scene: Scene, objectId: string, surfaceId: string, rect: AtlasRect): Ops {
  const o = scene.objects.findIndex((x) => x.id === objectId)
  if (o < 0 || !scene.objects[o].atlas) return null
  return [{ op: surfaceId in (scene.objects[o].atlas!.faces ?? {}) ? 'replace' : 'add', path: pointer('objects', o, 'atlas', 'faces', surfaceId), value: rect }]
}

/** A new media layer for an uploaded or catalog picture. */
export function mediaLayer(id: string, src: string, name: string, media: 'image' | 'video' = 'image', fit: ContentLayer['fit'] = 'fill'): ContentLayer {
  return { id, kind: 'media', name, visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, scale: 1, rotation: 0, reveal: 1, revealAngle: 0, src, media, fit, crop: { x: 0, y: 0, w: 1, h: 1 } }
}

/** A new gradient sweep layer: a bright band on black that a sweep clip moves across. */
export function gradientLayer(id: string, name = 'sweep', color = '#ffffff'): ContentLayer {
  return {
    id, kind: 'gradient', name, visible: true, opacity: 1, blend: 'screen', x: 0, y: 0, scale: 1, rotation: 0, reveal: 1, revealAngle: 0,
    stops: [ { color: '#000000', pos: 0 }, { color, pos: 0.5 }, { color: '#000000', pos: 0.62 } ], angle: 0, offset: 0, repeat: true,
  }
}

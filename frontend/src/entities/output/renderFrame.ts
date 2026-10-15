import { atlasAffines, Renderer, renderFrameToBlob, type RenderInput } from '../../render'
import { applyPatch } from '../../shared/lib/jsonPatch'
import { assetApi } from '../asset/api'
import { loadCatalog } from '../catalog/useCatalog'
import { draftApi } from '../draft/api'
import { effectApi } from '../effect/api'
import { sceneApi } from '../scene/api'
import type { Scene, SceneMode } from '../scene/types'
import { setupApi } from '../setup/api'

export interface RenderFrameArgs {
  sceneId: string
  draftId?: string | null
  t: number
  width: number
  /** draws this mode instead of the scene's (MCP renders ask for objects) */
  mode?: SceneMode | null
}

/** `render.face`: one surface flat (unwarped) at exactly width × height. */
export interface RenderFaceArgs {
  sceneId: string
  draftId?: string | null
  surfaceId: string
  t: number
  width: number
  height: number
}

/** `render.unfold`: an object's atlas (protocol §12) at exactly width × height. */
export interface RenderUnfoldArgs {
  sceneId: string
  draftId?: string | null
  objectId: string
  t: number
  width: number
  height: number
}

export interface RenderedImage {
  sha: string
  width: number
  height: number
}

/** The scene to render: the live scene, or the scene with the draft's ops applied. */
export async function loadRenderScene(sceneId: string, draftId?: string | null): Promise<Scene> {
  let scene: Scene = await sceneApi.get(sceneId)
  if (draftId) {
    const draft = (await draftApi.list()).find((d) => d.id === draftId)
    if (!draft) throw new Error(`Draft ${draftId} does not exist.`)
    scene = applyPatch(scene, draft.ops)
  }
  return scene
}

/** Everything a RenderInput needs besides the scene. */
async function renderInput(scene: Scene, t: number, clock: number, mode: SceneMode | null): Promise<RenderInput> {
  const [setup, catalog, effects] = await Promise.all([setupApi.get(scene.setupId), loadCatalog(), effectApi.list().catch(() => [])])
  // motion (§15) runs on the wall clock: render where it is now
  return { setup, scene, catalog, effects, t: Number(t) || 0, clock, now: Date.now(), blackout: 0, mode }
}

/** A pixel size from an RPC argument, clamped to 16..4096. */
export function clampSize(v: unknown, fallback: number): number {
  const n = Number(v)
  return Math.max(16, Math.min(4096, Math.round(Number.isFinite(n) && n > 0 ? n : fallback)))
}

/** Where a surface lives: its object, and whether it has a place in the object's atlas (then the face view draws it). */
export function locateForRender(scene: Scene, surfaceId: string): { objectId: string; inAtlas: boolean } | null {
  for (const o of scene.objects) {
    if (!o.surfaces.some((s) => s.id === surfaceId)) continue
    return { objectId: o.id, inAtlas: atlasAffines(scene, o).has(surfaceId) }
  }
  return null
}

/**
 * Answers the `render.frame` RPC: renders frame t of the scene (with the draft's ops applied) offscreen, uploads the
 * PNG as a snapshot asset and returns its sha.
 */
export async function renderFrameRpc(args: RenderFrameArgs, clock: number): Promise<{ sha: string }> {
  const scene = await loadRenderScene(args.sceneId, args.draftId)
  const input = await renderInput(scene, args.t, clock, args.mode ?? null)
  const width = Math.max(16, Math.min(4096, Math.round(Number(args.width) || 1280)))
  const blob = await renderFrameToBlob(input, width)
  const asset = await assetApi.upload(blob, 'snapshot', `frame-${args.sceneId}-${args.t}.png`)
  return { sha: asset.sha }
}

/** Renders with a throwaway WebGL renderer on a width × height OffscreenCanvas and uploads the PNG. */
async function renderOffscreen(input: RenderInput, width: number, height: number, name: string, draw: (r: Renderer) => void): Promise<RenderedImage> {
  const canvas = new OffscreenCanvas(width, height)
  const r = new Renderer(canvas, { space: 'scene', preserveDrawingBuffer: true })
  r.setSize(width, height)
  try {
    if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
    await r.ready(input)
    draw(r)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const asset = await assetApi.upload(blob, 'snapshot', name)
    return { sha: asset.sha, width, height }
  } finally {
    r.dispose(true)
  }
}

/**
 * Answers `render.face`: the surface's content flat, as the editor's face view draws it. A face with a place in its
 * object's atlas renders upright in its own uv with its details inside it; any other surface renders alone.
 */
export async function renderFaceRpc(args: RenderFaceArgs, clock: number): Promise<RenderedImage> {
  const scene = await loadRenderScene(args.sceneId, args.draftId)
  const where = locateForRender(scene, String(args.surfaceId))
  if (!where) throw new Error(`Surface ${args.surfaceId} does not exist in scene ${args.sceneId}.`)
  const input = await renderInput(scene, args.t, clock, 'objects')
  const width = clampSize(args.width, 1024)
  const height = clampSize(args.height, width)
  return renderOffscreen(input, width, height, `face-${args.surfaceId}-${args.t}.png`, (r) => {
    const obj = scene.objects.find((o) => o.id === where.objectId)!
    const affine = where.inAtlas ? atlasAffines(scene, obj).get(args.surfaceId) ?? null : null
    if (affine) r.renderAtlas(input, where.objectId, { only: args.surfaceId, view: affine })
    else r.renderSurface(input, args.surfaceId)
  })
}

/** Answers `render.unfold`: the object's whole atlas, every face in its rect with its details. */
export async function renderUnfoldRpc(args: RenderUnfoldArgs, clock: number): Promise<RenderedImage> {
  const scene = await loadRenderScene(args.sceneId, args.draftId)
  if (!scene.objects.some((o) => o.id === args.objectId)) throw new Error(`Object ${args.objectId} does not exist in scene ${args.sceneId}.`)
  const input = await renderInput(scene, args.t, clock, 'objects')
  const width = clampSize(args.width, 1024)
  const height = clampSize(args.height, width)
  return renderOffscreen(input, width, height, `unfold-${args.objectId}-${args.t}.png`, (r) => {
    r.renderAtlas(input, args.objectId)
  })
}

/** Registers render.frame, render.face and render.unfold on a hub (the editor and /out both render for agents). */
export function handleRenderRpcs(hub: { handleRpc: (method: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => () => void }, clock: () => number): () => void {
  const offs = [
    hub.handleRpc('render.frame', (args) => renderFrameRpc(args as unknown as RenderFrameArgs, clock())),
    hub.handleRpc('render.face', (args) => renderFaceRpc(args as unknown as RenderFaceArgs, clock())),
    hub.handleRpc('render.unfold', (args) => renderUnfoldRpc(args as unknown as RenderUnfoldArgs, clock())),
  ]
  return () => offs.forEach((f) => f())
}

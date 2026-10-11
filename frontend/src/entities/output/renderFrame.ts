import { renderFrameToBlob } from '../../render'
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

/**
 * Answers the `render.frame` RPC: renders frame t of the scene (with the draft's ops applied) offscreen, uploads the
 * PNG as a snapshot asset and returns its sha.
 */
export async function renderFrameRpc(args: RenderFrameArgs, clock: number): Promise<{ sha: string }> {
  let scene: Scene = await sceneApi.get(args.sceneId)
  if (args.draftId) {
    const draft = (await draftApi.list()).find((d) => d.id === args.draftId)
    if (!draft) throw new Error(`Draft ${args.draftId} does not exist.`)
    scene = applyPatch(scene, draft.ops)
  }
  const [setup, catalog, effects] = await Promise.all([setupApi.get(scene.setupId), loadCatalog(), effectApi.list().catch(() => [])])
  const width = Math.max(16, Math.min(4096, Math.round(Number(args.width) || 1280)))
  const blob = await renderFrameToBlob({ setup, scene, catalog, effects, t: Number(args.t) || 0, clock, blackout: 0, mode: args.mode ?? null }, width)
  const asset = await assetApi.upload(blob, 'snapshot', `frame-${args.sceneId}-${args.t}.png`)
  return { sha: asset.sha }
}

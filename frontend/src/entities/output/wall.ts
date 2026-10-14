import { useMemo } from 'react'
import { applyPatch } from '../../shared/lib/jsonPatch'
import { useChannel } from '../../shared/lib/useHub'
import type { Hub } from '../../shared/lib/ws'
import type { Draft } from '../draft/types'
import type { Scene } from '../scene/types'
import { useLiveDocs, type LiveDocs } from '../show/live'
import type { Show } from '../show/types'

/**
 * What the wall shows: the show, the active scene and its setup, with an agent's previewed draft (backend §9
 * show.preview) applied over the scene while it lasts. /out and LivePreview render from it.
 */
export function useWallDocs(hub: Hub): LiveDocs & { previewing: boolean } {
  const previewId = useChannel<Show>(hub, 'show').doc?.preview?.draftId ?? null
  const previewDraft = useChannel<Draft>(hub, previewId ? `draft:${previewId}` : null).doc
  const live = useLiveDocs(hub, previewDraft?.sceneId ?? null)
  const scene = useMemo((): Scene | null => {
    if (!live.scene || !previewDraft || !previewId) return live.scene
    try {
      return applyPatch(live.scene, previewDraft.ops)
    } catch {
      return live.scene
    }
  }, [live.scene, previewDraft, previewId])
  return { show: live.show, scene, setup: live.setup, previewing: !!previewId }
}

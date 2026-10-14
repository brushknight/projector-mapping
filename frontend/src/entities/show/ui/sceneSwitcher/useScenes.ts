import { useCallback, useEffect, useState } from 'react'
import { useChannel } from '../../../../shared/lib/useHub'
import type { Hub } from '../../../../shared/lib/ws'
import { sceneApi } from '../../../scene/api'
import type { SceneSummary } from '../../../scene/types'

/**
 * The scene list (§14): the `scenes` channel, with `GET /scenes` as the fallback for servers without the channel.
 * `reload` refetches after a change this client made, so the list is right even before the channel speaks.
 */
export function useScenes(hub: Hub): { scenes: SceneSummary[]; reload: () => void } {
  const ch = useChannel<SceneSummary[]>(hub, 'scenes')
  const [fetched, setFetched] = useState<SceneSummary[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const reload = useCallback(() => {
    sceneApi.list().then(
      (xs) => {
        setFetched(xs)
        setFetchedAt(Date.now())
      },
      () => {},
    )
  }, [])
  useEffect(() => {
    reload()
  }, [reload, hub.status])
  // the newer of the two wins: a channel snapshot carries a ms timestamp as its version
  const chList = Array.isArray(ch.doc) ? ch.doc : null
  const scenes = chList && (ch.version >= fetchedAt || !fetched.length) ? chList : fetched
  return { scenes, reload }
}

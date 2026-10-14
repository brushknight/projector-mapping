import { useCallback, useEffect, useState } from 'react'
import { useChannel } from '../../../shared/lib/useHub'
import type { Hub } from '../../../shared/lib/ws'
import { assetUrl } from '../../asset/types'
import { videoApi } from '../api'
import { youtubeRef, youtubeThumb, type Video } from '../types'

/** The video library (§14): the `videos` channel, with `GET /videos` as the fallback. */
export function useVideos(hub: Hub): { videos: Video[]; reload: () => void } {
  const ch = useChannel<Video[]>(hub, 'videos')
  const [fetched, setFetched] = useState<Video[]>([])
  const [at, setAt] = useState(0)
  const reload = useCallback(() => {
    videoApi.list().then(
      (xs) => {
        setFetched(Array.isArray(xs) ? xs : [])
        setAt(Date.now())
      },
      () => {},
    )
  }, [])
  useEffect(() => {
    reload()
  }, [reload, hub.status])
  const list = Array.isArray(ch.doc) ? ch.doc : null
  return { videos: list && (ch.version >= at || !fetched.length) ? list : fetched, reload }
}

/** A video's tile picture: its thumb asset, YouTube's hqdefault for embeds, or null. */
export function videoThumbUrl(v: Pick<Video, 'thumb' | 'ref' | 'youtubeId'>): string | null {
  if (v.thumb) return assetUrl(v.thumb)
  const yt = v.youtubeId ?? youtubeRef(v.ref)
  return yt ? youtubeThumb(yt) : null
}

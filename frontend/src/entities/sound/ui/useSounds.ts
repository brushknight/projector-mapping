import { useCallback, useEffect, useState } from 'react'
import { useChannel } from '../../../shared/lib/useHub'
import type { Hub } from '../../../shared/lib/ws'
import { soundApi } from '../api'
import type { Sound } from '../types'

/** The sound library (§14): the `sounds` channel, with `GET /sounds` as the fallback. */
export function useSounds(hub: Hub): { sounds: Sound[]; reload: () => void } {
  const ch = useChannel<Sound[]>(hub, 'sounds')
  const [fetched, setFetched] = useState<Sound[]>([])
  const [at, setAt] = useState(0)
  const reload = useCallback(() => {
    soundApi.list().then(
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
  return { sounds: list && (ch.version >= at || !fetched.length) ? list : fetched, reload }
}

/** "0:12.5" style duration. */
export function formatDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(sec < 10 ? 1 : 0)}`
}

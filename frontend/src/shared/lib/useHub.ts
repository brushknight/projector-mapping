import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { Hub, type ChannelSnapshot, type Envelope, type HubStatus } from './ws'

export const HubContext = createContext<Hub | null>(null)

export function useHub(): Hub {
  const hub = useContext(HubContext)
  if (!hub) throw new Error('useHub needs a HubContext provider')
  return hub
}

/** The hub's connection status. */
export function useHubStatus(hub: Hub): HubStatus {
  return useSyncExternalStore(
    (cb) => hub.on('status', cb),
    () => hub.status,
  )
}

/** Subscribes to a channel while mounted and returns its local view. `name` null = nothing. */
export function useChannel<T>(hub: Hub, name: string | null, onMessage?: (env: Envelope) => void): ChannelSnapshot<T> {
  const [snap, setSnap] = useState<ChannelSnapshot<T>>(() => (name ? hub.get<T>(name) : { doc: null, version: 0, pending: false }))
  useEffect(() => {
    if (!name) {
      setSnap({ doc: null, version: 0, pending: false })
      return
    }
    setSnap(hub.get<T>(name))
    return hub.subscribe<T>(name, setSnap, onMessage)
    // onMessage is read once per subscription on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, name])
  return snap
}

/** Creates a hub for the component's lifetime and connects it. */
export function useOwnHub(make: () => Hub): Hub {
  const [hub] = useState(make)
  useEffect(() => {
    hub.connect()
    return () => hub.close()
  }, [hub])
  return hub
}

/** The server clock in ms, re-rendering about once a second (countdowns). */
export function useServerSecond(hub: Hub, everyMs = 500): number {
  const [now, setNow] = useState(() => hub.serverNow())
  useEffect(() => {
    const id = setInterval(() => setNow(hub.serverNow()), everyMs)
    return () => clearInterval(id)
  }, [hub, everyMs])
  return now
}

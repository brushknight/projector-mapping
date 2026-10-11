import { useEffect, useState } from 'react'
import type { Envelope, Hub } from '../../shared/lib/ws'
import type { CameraFrame, CameraStatus } from './types'

/** The newest phone preview frame and status from the `camera` channel. */
export function useCamera(hub: Hub, enabled = true): { frame: CameraFrame | null; status: CameraStatus | null; at: number } {
  const [state, setState] = useState<{ frame: CameraFrame | null; status: CameraStatus | null; at: number }>({ frame: null, status: null, at: 0 })
  useEffect(() => {
    if (!enabled) return
    return hub.subscribe('camera', undefined, (env: Envelope) => {
      if (env.t === 'camera.frame') setState((s) => ({ ...s, frame: env.d as CameraFrame, at: Date.now() }))
      else if (env.t === 'camera.status') setState((s) => ({ ...s, status: env.d as CameraStatus }))
    })
  }, [hub, enabled])
  return state
}

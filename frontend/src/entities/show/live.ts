import { useEffect, useRef } from 'react'
import { useChannel } from '../../shared/lib/useHub'
import type { Hub } from '../../shared/lib/ws'
import type { Scene } from '../scene/types'
import type { Setup } from '../setup/types'
import { playhead, type Show } from './types'

export interface LiveDocs {
  show: Show | null
  scene: Scene | null
  setup: Setup | null
}

/** Subscribes to `show` and to the active scene and setup channels. Pass sceneId to follow another scene. */
export function useLiveDocs(hub: Hub, sceneOverride?: string | null): LiveDocs {
  const show = useChannel<Show>(hub, 'show').doc
  const sceneId = sceneOverride ?? show?.activeSceneId ?? null
  const scene = useChannel<Scene>(hub, sceneId ? `scene:${sceneId}` : null).doc
  const setupId = scene?.setupId ?? show?.activeSetupId ?? null
  const setup = useChannel<Setup>(hub, setupId ? `setup:${setupId}` : null).doc
  return { show, scene: scene && scene.id === sceneId ? scene : null, setup }
}

/** The playhead now, from the transport and the hub's server clock. */
export function playheadNow(hub: Hub, show: Show | null): number {
  return show ? playhead(show.transport, hub.serverNow()) : 0
}

/** The ambient clock for backdrop animation: server seconds, wrapped hourly to keep shader floats precise. */
export function ambientClock(hub: Hub): number {
  return (hub.serverNow() / 1000) % 3600
}

/**
 * Blackout as 0..1, eased toward the show's onAir over setup.blackoutFadeMs. Call step() once per frame.
 */
export function useBlackout(onAir: boolean | undefined, fadeMs: number | undefined) {
  const state = useRef({ value: onAir === false ? 1 : 0, last: 0 })
  const target = useRef(onAir === false ? 1 : 0)
  const fade = useRef(fadeMs ?? 500)
  useEffect(() => {
    target.current = onAir === false ? 1 : 0
    fade.current = fadeMs ?? 500
  }, [onAir, fadeMs])
  return {
    step(nowMs: number): number {
      const s = state.current
      const dt = s.last ? nowMs - s.last : 0
      s.last = nowMs
      const rate = fade.current <= 0 ? Infinity : dt / fade.current
      if (s.value < target.current) s.value = Math.min(target.current, s.value + rate)
      else if (s.value > target.current) s.value = Math.max(target.current, s.value - rate)
      return s.value
    },
  }
}

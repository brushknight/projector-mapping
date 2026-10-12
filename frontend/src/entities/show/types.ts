/** Protocol §1 Show: the live state, one per server. */
export type TransportState = 'stopped' | 'playing' | 'paused'

export interface Transport {
  state: TransportState
  /** server Unix nanoseconds when play started */
  startedAt: number
  offset: number
  cue: number
}

export interface Show {
  activeSetupId: string | null
  activeSceneId: string | null
  onAir: boolean
  transport: Transport
  version: number
  /** (backend §9) an agent previews a draft on the wall; the output renders it instead of the live scene */
  preview?: { draftId: string; until?: number | string | null } | null
  /** (§12) the wall draws only these surfaces until `until` (server Unix ns) */
  solo?: ShowSolo | null
}

export type SoloFill = 'content' | 'white' | 'grid'
export interface ShowSolo {
  surfaceIds: string[]
  fill: SoloFill
  until: number
}

export type ShowAction = 'go' | 'back' | 'play' | 'pause' | 'stop' | 'seek' | 'blackout' | 'activate' | 'solo' | 'preview'

/**
 * The playhead in seconds. `serverNowMs` is the server clock in milliseconds (local clock + measured offset).
 * When playing: offset + (serverNow − startedAt) / 1e9.
 */
export function playhead(t: Transport, serverNowMs: number): number {
  if (t.state !== 'playing') return t.offset
  return t.offset + (serverNowMs - t.startedAt / 1e6) / 1e3
}

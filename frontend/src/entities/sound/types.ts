import type { Asset } from '../asset/types'

/** (§14) a library sound: an asset of kind `sound`; its id is its sha. */
export type Sound = Asset & { kind: 'sound'; name: string; duration: number; peaks: number[] }

/** Server → audio client (§14). */
export interface SoundPlayMsg {
  playId: string
  sound: string
  padId?: string
  cueId?: string
  name?: string
  volume: number
  loop: boolean
}
export interface SoundStopMsg {
  playId?: string
  padId?: string
}
export interface SoundPlayAck {
  playId?: string
  outputs?: number
  stopped?: boolean
}

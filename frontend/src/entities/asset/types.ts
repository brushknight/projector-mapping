export type AssetKind = 'photo' | 'reference' | 'snapshot' | 'calibration' | 'thumb' | 'sound' | 'video'

export interface Asset {
  sha: string
  mime: string
  width: number
  height: number
  bytes: number
  kind: AssetKind
  /** (backend §9) sha of a 512 px JPEG for large images */
  thumb?: string | null
  /** (§14) library name (sounds, videos) */
  name?: string
  /** (§14) seconds (sounds, videos) */
  duration?: number
  /** (§14) sound only: 0..1 loudness per equal slice, normally 128 */
  peaks?: number[]
}

/** URL of an asset's bytes (served outside /api/v1, immutable). */
export const assetUrl = (sha: string) => `/a/${sha}`

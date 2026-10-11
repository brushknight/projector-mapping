export type AssetKind = 'photo' | 'reference' | 'snapshot' | 'calibration' | 'thumb'

export interface Asset {
  sha: string
  mime: string
  width: number
  height: number
  bytes: number
  kind: AssetKind
  /** (backend §9) sha of a 512 px JPEG for large images */
  thumb?: string | null
}

/** URL of an asset's bytes (served outside /api/v1, immutable). */
export const assetUrl = (sha: string) => `/a/${sha}`

/** Progress on channel calib:{id}. */
export interface CalibProgress {
  step: string
  done: number
  total: number
  message: string
}

export interface Calibration {
  id: string
  setupId?: string
  status?: 'running' | 'done' | 'failed' | string
  message?: string
  quality?: { coverage: number; errorPx: number } | null
  mapAsset?: string | null
  cameraWidth?: number
  cameraHeight?: number
  projectorWidth?: number
  projectorHeight?: number
  createdAt?: string
}

type Pt = { x: number; y: number } | [number, number]

/** (backend §9) a planar surface found by the calibration, in camera, projector and scene pixels. */
export interface Candidate {
  id: string
  kind: string
  camera?: Pt[]
  projector?: Pt[]
  scene: Pt[]
  confidence: number
  areaCamPx?: number
}

export const xy = (p: Pt): { x: number; y: number } => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)

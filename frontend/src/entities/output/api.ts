import { http } from '../../shared/lib/http'

/** (§17) a display attached to the Mac that runs projmap; index 1 is the main display */
export interface OutputDisplay {
  index: number
  name: string
  width: number
  height: number
  scale: number
  x: number
  y: number
  /** the frame in points (Accessibility coordinates, y down) */
  pointWidth?: number
  pointHeight?: number
  main: boolean
}

export type OutputRoute = 'out' | 'view'

/** (§17) local requests only: the server starts Chrome on its own Mac */
export const outputsApi = {
  displays: () => http.get<OutputDisplay[]>('/api/v1/outputs/displays'),
  launch: (display: number, route: OutputRoute = 'out') =>
    http.post<{ launched: boolean; url: string; display: OutputDisplay }>('/api/v1/outputs/launch', { display, route }),
}

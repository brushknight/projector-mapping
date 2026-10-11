export type DeviceRole = 'output' | 'editor' | 'remote' | 'agent'

export interface Telemetry {
  fps: number
  dropped: number
  width: number
  height: number
  refresh: number
}

export interface Device {
  id: string
  name: string
  role: DeviceRole
  lastSeen: string
  online: boolean
  /** relayed by the server from the output's telemetry messages */
  telemetry?: Telemetry | null
}

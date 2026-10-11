import { http } from '../../shared/lib/http'
import type { Device } from '../device/types'
import type { PairCode, ServerInfo } from './types'

export const pairingApi = {
  info: () => http.get<ServerInfo>('/api/v1/info'),
  code: () => http.get<PairCode>('/api/v1/pair/code'),
  pair: (code: string, name: string, role: string) => http.post<{ token: string; device: Device }>('/api/v1/pair', { code, name, role }),
}

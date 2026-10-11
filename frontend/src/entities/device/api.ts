import { http } from '../../shared/lib/http'
import type { Device } from './types'

export const deviceApi = {
  list: () => http.get<Device[]>('/api/v1/devices'),
  revoke: (id: string) => http.del(`/api/v1/devices/${id}`),
}

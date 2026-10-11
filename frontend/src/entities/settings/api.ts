import { http } from '../../shared/lib/http'
import type { AgentSettings } from './types'

export const settingsApi = {
  get: () => http.get<AgentSettings>('/api/v1/settings'),
  update: (body: Partial<AgentSettings>) => http.patch<AgentSettings>('/api/v1/settings', body),
}

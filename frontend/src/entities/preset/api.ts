import { http } from '../../shared/lib/http'
import type { Preset, PresetMode } from './types'

export const presetApi = {
  list: () => http.get<Preset[]>('/api/v1/presets'),
  create: (name: string, mode: PresetMode, sceneId: string) => http.post<Preset>('/api/v1/presets', { name, mode, sceneId }),
  apply: (id: string, sceneId: string) => http.post<unknown>(`/api/v1/presets/${id}/apply`, { sceneId }),
  remove: (id: string) => http.del(`/api/v1/presets/${id}`),
}

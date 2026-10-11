import { http } from '../../shared/lib/http'
import type { HistoryEntry, PatchOp, Scene, SceneSummary } from './types'

export const sceneApi = {
  list: () => http.get<SceneSummary[]>('/api/v1/scenes'),
  get: (id: string) => http.get<Scene>(`/api/v1/scenes/${id}`),
  create: (name: string, setupId: string) => http.post<Scene>('/api/v1/scenes', { name, setupId }),
  remove: (id: string) => http.del(`/api/v1/scenes/${id}`),
  patch: (id: string, base: number, ops: PatchOp[]) => http.post<{ version: number }>(`/api/v1/scenes/${id}/patch`, { base, ops }),
  undo: (id: string) => http.post<{ version: number }>(`/api/v1/scenes/${id}/undo`),
  redo: (id: string) => http.post<{ version: number }>(`/api/v1/scenes/${id}/redo`),
  history: (id: string, limit = 50) => http.get<HistoryEntry[]>(`/api/v1/scenes/${id}/history?limit=${limit}`),
  fromPhoto: (asset: string, position: 'lens' | 'anywhere', name: string, extra?: Record<string, unknown>) =>
    http.post<Scene>('/api/v1/scenes/from-photo', { asset, position, name, ...extra }),
}

import { http } from '../../shared/lib/http'
import type { HistoryEntry, PatchOp, Scene, SceneSummary } from './types'

export const sceneApi = {
  list: () => http.get<SceneSummary[]>('/api/v1/scenes'),
  get: (id: string) => http.get<Scene>(`/api/v1/scenes/${id}`),
  /** (§15) `kind` builds the kind's default template; `template` names one */
  create: (name: string, setupId?: string | null, extra?: { kind?: string; template?: string }) => http.post<Scene>('/api/v1/scenes', { name, ...(setupId ? { setupId } : {}), ...(extra ?? {}) }),
  /** (§14) a deep copy of another scene */
  duplicate: (sourceId: string, name: string) => http.post<Scene>('/api/v1/scenes', { name, duplicate: sourceId }),
  rename: (id: string, name: string) => http.patch<SceneSummary>(`/api/v1/scenes/${id}`, { name }),
  remove: (id: string) => http.del(`/api/v1/scenes/${id}`),
  patch: (id: string, base: number, ops: PatchOp[]) => http.post<{ version: number }>(`/api/v1/scenes/${id}/patch`, { base, ops }),
  undo: (id: string) => http.post<{ version: number }>(`/api/v1/scenes/${id}/undo`),
  redo: (id: string) => http.post<{ version: number }>(`/api/v1/scenes/${id}/redo`),
  history: (id: string, limit = 50) => http.get<HistoryEntry[]>(`/api/v1/scenes/${id}/history?limit=${limit}`),
  fromPhoto: (asset: string, position: 'lens' | 'anywhere', name: string, extra?: Record<string, unknown>) =>
    http.post<Scene>('/api/v1/scenes/from-photo', { asset, position, name, ...extra }),
}

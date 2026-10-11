import { http } from '../../shared/lib/http'
import type { Draft } from './types'

export const draftApi = {
  list: () => http.get<Draft[]>('/api/v1/drafts'),
  create: (sceneId: string, author = 'user:editor') => http.post<Draft>('/api/v1/drafts', { sceneId, author }),
  apply: (id: string) => http.post<unknown>(`/api/v1/drafts/${id}/apply`),
  discard: (id: string) => http.post<unknown>(`/api/v1/drafts/${id}/discard`),
}

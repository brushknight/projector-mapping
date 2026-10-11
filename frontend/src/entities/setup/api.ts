import { http } from '../../shared/lib/http'
import type { Setup } from './types'

export const setupApi = {
  list: () => http.get<Setup[]>('/api/v1/setups'),
  get: (id: string) => http.get<Setup>(`/api/v1/setups/${id}`),
  create: (body: Partial<Setup>) => http.post<Setup>('/api/v1/setups', body),
  /** PATCH takes a partial setup and merges it. */
  update: (id: string, body: Partial<Omit<Setup, 'output'>> & { output?: Partial<Setup['output']> }) => http.patch<Setup>(`/api/v1/setups/${id}`, body),
  remove: (id: string) => http.del(`/api/v1/setups/${id}`),
}

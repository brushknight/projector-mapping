import { http } from '../../shared/lib/http'
import type { Show, ShowAction } from './types'

export const showApi = {
  get: () => http.get<Show>('/api/v1/show'),
  action: (action: ShowAction, body?: Record<string, unknown>) => http.post<Show>(`/api/v1/show/${action}`, body ?? {}),
}

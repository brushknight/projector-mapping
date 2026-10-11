import { http } from '../../shared/lib/http'
import type { EffectDef, EffectKind, ParamSchema } from './types'

export const effectApi = {
  list: () => http.get<EffectDef[]>('/api/v1/effects'),
  get: (id: string) => http.get<EffectDef>(`/api/v1/effects/${id}`),
  create: (body: { name: string; kind: EffectKind; source: string; params: ParamSchema }) => http.post<EffectDef>('/api/v1/effects', body),
  update: (id: string, body: Partial<EffectDef>) => http.put<EffectDef>(`/api/v1/effects/${id}`, body),
  remove: (id: string) => http.del(`/api/v1/effects/${id}`),
}

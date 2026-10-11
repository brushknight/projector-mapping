import { http } from '../../shared/lib/http'
import type { Catalog } from './types'

export const catalogApi = {
  get: () => http.get<Catalog>('/api/v1/catalog'),
}

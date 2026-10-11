import { http } from '../../shared/lib/http'
import type { Calibration, Candidate } from './types'

export const calibrationApi = {
  start: (setupId: string) => http.post<{ id: string }>('/api/v1/calibrations', { setupId }),
  get: (id: string) => http.get<Calibration>(`/api/v1/calibrations/${id}`),
  candidates: (id: string) => http.get<Candidate[]>(`/api/v1/calibrations/${id}/candidates`),
}

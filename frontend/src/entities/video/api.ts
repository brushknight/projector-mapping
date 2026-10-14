import { http } from '../../shared/lib/http'
import type { ImportJob, Video, VideoTools } from './types'

export const videoApi = {
  list: () => http.get<Video[]>('/api/v1/videos'),
  upload: (file: File, name?: string, onProgress?: (p: number) => void) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    if (name) fd.append('name', name)
    return http.formProgress<Video>('/api/v1/videos', fd, onProgress)
  },
  rename: (id: string, name: string) => http.patch<Video>(`/api/v1/videos/${id}`, { name }),
  remove: (id: string) => http.del(`/api/v1/videos/${id}`),
  tools: () => http.get<VideoTools>('/api/v1/videos/tools'),
  importYouTube: (body: { url: string; maxHeight?: number; start?: number; end?: number; name?: string }) => http.post<ImportJob>('/api/v1/videos/import', body),
  job: (id: string) => http.get<ImportJob>(`/api/v1/videos/import/${id}`),
}

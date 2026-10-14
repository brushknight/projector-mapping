import { http } from '../../shared/lib/http'
import type { Sound, SoundPlayAck } from './types'

export const soundApi = {
  list: () => http.get<Sound[]>('/api/v1/sounds'),
  /** duration and peaks come from the browser's decode (the server keeps them when it cannot read the file) */
  upload: (file: File, name?: string, decoded?: { duration: number; peaks: number[] } | null, onProgress?: (p: number) => void) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    if (name) fd.append('name', name)
    if (decoded) {
      fd.append('duration', String(decoded.duration))
      fd.append('peaks', JSON.stringify(decoded.peaks))
    }
    return http.formProgress<Sound>('/api/v1/sounds', fd, onProgress)
  },
  rename: (sha: string, name: string) => http.patch<Sound>(`/api/v1/sounds/${sha}`, { name }),
  remove: (sha: string) => http.del(`/api/v1/sounds/${sha}`),
  play: (args: { padId?: string; soundId?: string; volume?: number; sceneId?: string }) => http.post<SoundPlayAck>('/api/v1/sounds/play', args),
  stop: (args: { playId?: string; padId?: string } = {}) => http.post<SoundPlayAck>('/api/v1/sounds/stop', args),
}

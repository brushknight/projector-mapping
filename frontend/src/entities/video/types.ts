/** (§14) one tile of the scenery "videos" category */
export interface Video {
  id: string
  name: string
  /** what a video layer uses: `asset:<sha>` or `youtube:<id>` */
  ref: string
  source: 'file' | 'youtube'
  url?: string | null
  youtubeId?: string | null
  sha?: string | null
  thumb?: string | null
  duration?: number
  width?: number
  height?: number
  createdAt: string
}

export type ImportMode = 'download' | 'embed'
export type ImportStatus = 'running' | 'done' | 'failed'
/** (§14) a YouTube import; progress on channel `import:{id}` */
export interface ImportJob {
  id: string
  url: string
  youtubeId: string
  mode: ImportMode
  status: ImportStatus
  progress: number
  message: string
  maxHeight: number
  start: number
  end: number
  videoId: string | null
  ref: string | null
  createdAt: string
}

export interface VideoTools {
  ytdlp: boolean
  ffmpeg: boolean
}

export const MAX_HEIGHTS = [360, 480, 720, 1080, 1440, 2160] as const

/** The YouTube video id of a watch, youtu.be or Shorts link, or null (§14). */
export function youtubeId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null)
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1])
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') return ok(u.searchParams.get('v'))
    const m = /^\/shorts\/([^/]+)/.exec(u.pathname)
    if (m) return ok(m[1])
  }
  return null
}

/** `youtube:<id>` → id; anything else → null */
export const youtubeRef = (ref: string): string | null => (ref.startsWith('youtube:') ? ref.slice(8) : null)
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

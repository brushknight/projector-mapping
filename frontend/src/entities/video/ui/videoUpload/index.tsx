import { useRef, useState, type ReactNode } from 'react'
import { videoApi } from '../../api'
import type { Video } from '../../types'

export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm'
const OK = /\.(mp4|m4v|mov|webm)$/i

/** "add video file": picks an MP4, MOV or WebM and uploads it to `/videos` with progress (§14). */
export function useVideoUpload({ onDone, onError }: { onDone: (v: Video) => void; onError: (msg: string) => void }): { pick: () => void; progress: number | null; input: ReactNode; upload: (f: File) => Promise<void> } {
  const ref = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const upload = async (f: File) => {
    if (!OK.test(f.name) && !/^video\/(mp4|quicktime|webm)$/.test(f.type)) return onError(`${f.name} is not an MP4, MOV or WebM video.`)
    setProgress(0)
    try {
      const v = await videoApi.upload(f, f.name.replace(/\.[^.]+$/, '').slice(0, 80), setProgress)
      onDone(v)
    } catch (e) {
      onError(`The upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setProgress(null)
    }
  }
  const input = (
    <input
      ref={ref}
      type="file"
      accept={VIDEO_ACCEPT}
      hidden
      data-testid="video-file-input"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void upload(f)
      }}
    />
  )
  return { pick: () => ref.current?.click(), progress, input, upload }
}

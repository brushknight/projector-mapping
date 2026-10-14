import { useEffect, useState } from 'react'
import { Cap, Dialog, Field, Icon, Pill, ProgressBar, Segmented, TextInput } from '../../../../shared/components'
import { useChannel } from '../../../../shared/lib/useHub'
import type { Hub } from '../../../../shared/lib/ws'
import { videoApi } from '../../api'
import { MAX_HEIGHTS, youtubeId, youtubeThumb, type ImportJob, type Video, type VideoTools } from '../../types'
import s from './styles.module.css'

export const YTDLP_HINT = 'Install yt-dlp on this Mac (brew install yt-dlp) for offline, sharper loops you can fully blur. Without it the loop plays as an embedded YouTube player.'
export const BAD_URL = 'Paste a YouTube link: youtube.com/watch, youtu.be or a Shorts link.'

/** Seconds from "75", "1:15" or "0:01:15"; null when it is not a time. Empty = 0. */
export function parseTime(v: string): number | null {
  const t = v.trim()
  if (!t) return 0
  if (!/^\d+(\.\d+)?$|^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(t)) return null
  return t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
}

/**
 * Add from YouTube (§14): paste a link (checked as you type), trim it, pick the quality, then watch the import job on
 * `import:{id}`. Without yt-dlp the server makes an embed at once, and the dialog says how to get offline loops.
 */
export function YouTubeDialog({ hub, onClose, onDone }: { hub: Hub; onClose: () => void; onDone: (v: Video | null) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [height, setHeight] = useState<string>('1080')
  const [tools, setTools] = useState<VideoTools | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = useChannel<ImportJob>(hub, job && job.status === 'running' ? `import:${job.id}` : null).doc
  const cur = live && job && live.id === job.id ? live : job

  useEffect(() => {
    videoApi.tools().then(setTools, () => setTools(null))
  }, [])

  const id = youtubeId(url)
  const st = parseTime(start)
  const en = parseTime(end)
  const urlMsg = url.trim() && !id ? BAD_URL : null
  const timeMsg = st === null || en === null ? 'Write times as seconds (75) or minutes and seconds (1:15).' : en && st !== null && en <= st ? 'The end must come after the start.' : null
  const ok = !!id && !timeMsg && !busy && !(cur && cur.status === 'running')

  // a finished job hands its video back
  useEffect(() => {
    if (!cur || cur.status !== 'done') return
    let alive = true
    videoApi.list().then(
      (vs) => alive && onDone(vs.find((v) => v.id === cur.videoId) ?? null),
      () => alive && onDone(null),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.status])

  const start_ = async () => {
    if (!ok || !id) return
    setBusy(true)
    setError(null)
    try {
      const j = await videoApi.importYouTube({ url: url.trim(), maxHeight: Number(height), ...(st ? { start: st } : {}), ...(en ? { end: en } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
      setJob(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="add from youtube" onClose={onClose} width={560}>
      <div className={s.body} data-testid="youtube-dialog">
        <Field label="youtube link">
          <TextInput autoFocus value={url} placeholder="https://youtu.be/…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void start_()} aria-invalid={!!urlMsg} data-testid="youtube-url" />
        </Field>
        {urlMsg && (
          <p className={s.bad} role="alert" data-testid="youtube-url-error">
            {urlMsg}
          </p>
        )}
        {id && (
          <div className={s.found}>
            <span className={s.thumb} style={{ backgroundImage: `url("${youtubeThumb(id)}")` }} />
            <span className={s.foundText}>
              <span>video {id}</span>
              <span className={s.dim}>found. trim it and import.</span>
            </span>
          </div>
        )}
        <div className={s.grid}>
          <Field label="name (optional)">
            <TextInput value={name} placeholder="waves" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="start">
            <TextInput value={start} placeholder="0:00" onChange={(e) => setStart(e.target.value)} data-testid="youtube-start" />
          </Field>
          <Field label="end">
            <TextInput value={end} placeholder="to the end" onChange={(e) => setEnd(e.target.value)} data-testid="youtube-end" />
          </Field>
        </div>
        {timeMsg && (
          <p className={s.bad} role="alert">
            {timeMsg}
          </p>
        )}
        <div className={s.quality}>
          <Cap>quality</Cap>
          <Segmented ariaLabel="quality" size="sm" value={height} onChange={setHeight} options={MAX_HEIGHTS.map((h) => ({ value: String(h), label: h >= 2160 ? '4k' : `${h}p` }))} />
        </div>
        {tools && !tools.ytdlp && (
          <p className={s.hint} data-testid="ytdlp-hint">
            <Icon name="download" size={14} />
            {YTDLP_HINT}
          </p>
        )}
        {cur && (
          <div className={s.job} data-testid="import-job" data-status={cur.status}>
            <div className={s.jobRow}>
              <span>{cur.status === 'done' ? (cur.mode === 'embed' ? 'added as an embedded player' : 'downloaded and trimmed') : cur.status === 'failed' ? 'the import failed' : 'importing'}</span>
              <span className={s.num}>{Math.round(cur.progress * 100)}%</span>
            </div>
            <ProgressBar value={cur.progress} label="import" />
            {cur.message && <p className={cur.status === 'failed' ? s.bad : s.dim}>{cur.message}</p>}
          </div>
        )}
        {error && (
          <p className={s.bad} role="alert">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <Pill ghost onClick={onClose}>
            cancel
          </Pill>
          <Pill on disabled={!ok} onClick={() => void start_()} data-testid="youtube-import">
            {cur?.status === 'failed' ? 'try again' : 'import'}
          </Pill>
        </div>
      </div>
    </Dialog>
  )
}

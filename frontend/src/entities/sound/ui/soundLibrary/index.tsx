import { useRef, useState } from 'react'
import { EmptyState, Icon, Pill, ProgressBar, TextInput, Waveform } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { soundApi } from '../../api'
import { baseName, decodeSound, isSoundFile, SOUND_ACCEPT } from '../../peaks'
import type { Sound } from '../../types'
import { formatDuration } from '../useSounds'
import s from './styles.module.css'

/** Uploads sound files (§14): decodes each in the browser first for its duration and peaks, then posts it. */
export function useSoundUpload({ onDone, onError }: { onDone: (snd: Sound) => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const upload = async (files: File[]) => {
    for (const f of files) {
      if (!isSoundFile(f)) {
        onError(`${f.name} is not a WAV, MP3, M4A, AIFF or OGG file.`)
        continue
      }
      setProgress(0)
      try {
        const decoded = await decodeSound(f)
        const snd = await soundApi.upload(f, baseName(f.name), decoded, setProgress)
        onDone(snd)
      } catch (e) {
        onError(`The upload failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setProgress(null)
      }
    }
  }
  const input = (
    <input
      ref={ref}
      type="file"
      accept={SOUND_ACCEPT}
      multiple
      hidden
      data-testid="sound-file-input"
      onChange={(e) => {
        const fs = [...(e.target.files ?? [])]
        e.target.value = ''
        void upload(fs)
      }}
    />
  )
  return { pick: () => ref.current?.click(), progress, input, upload }
}

/**
 * The sound library: upload, every sound with its waveform and length, preview on the audio output, rename (double
 * click or the pen), delete. Rows drag onto the timeline's sound tracks as `sound:<sha>`.
 */
export function SoundLibrary({
  sounds,
  reload,
  toast,
  onPreview,
  compact,
  emptyHint = 'no sounds yet. upload a WAV, MP3, M4A, AIFF or OGG file.',
}: {
  sounds: Sound[]
  reload: () => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  onPreview: (sha: string) => void
  compact?: boolean
  emptyHint?: string
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [drop, setDrop] = useState(false)
  const up = useSoundUpload({
    onDone: (snd) => {
      reload()
      toast(`Added ${snd.name}.`)
    },
    onError: (m) => toast(m, { bad: true }),
  })
  const rename = async (snd: Sound, name: string) => {
    setRenaming(null)
    const n = name.trim()
    if (!n || n === snd.name) return
    try {
      await soundApi.rename(snd.sha, n.slice(0, 80))
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  const remove = async (snd: Sound) => {
    setConfirm(null)
    try {
      await soundApi.remove(snd.sha)
      reload()
      toast(`Deleted ${snd.name}. Pads and clips that used it say "missing sound".`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  return (
    <div
      className={cx(s.lib, compact && s.compact, drop && s.drop)}
      data-testid="sound-library"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDrop(true)
        }
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDrop(false)
        void up.upload([...e.dataTransfer.files])
      }}
    >
      <div className={s.up}>
        <Pill size="sm" icon="upload" onClick={up.pick} disabled={up.progress !== null} data-testid="sound-upload">
          {up.progress !== null ? `uploading ${Math.round(up.progress * 100)}%` : 'upload sound'}
        </Pill>
        {!compact && <span className={s.dim}>or drop files here</span>}
        {up.input}
      </div>
      {up.progress !== null && <ProgressBar value={up.progress} label="upload" />}
      {sounds.length === 0 && <EmptyState>{emptyHint}</EmptyState>}
      <div className={s.list}>
        {sounds.map((snd) =>
          confirm === snd.sha ? (
            <div key={snd.sha} className={s.confirm}>
              <span className={s.name}>delete {snd.name}?</span>
              <Pill size="sm" on onClick={() => void remove(snd)} data-testid="sound-delete-yes">
                delete
              </Pill>
              <Pill size="sm" ghost onClick={() => setConfirm(null)}>
                keep
              </Pill>
            </div>
          ) : (
            <div
              key={snd.sha}
              className={s.row}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', `sound:${snd.sha}`)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`${snd.name}: drag it onto a sound track of the timeline`}
              data-testid={`sound-${snd.sha}`}
            >
              <button type="button" className={s.play} onClick={() => onPreview(snd.sha)} aria-label={`play ${snd.name}`} title="play it on the audio output" data-testid={`sound-play-${snd.sha}`}>
                <Icon name="play" size={13} />
              </button>
              <span className={s.mid}>
                {renaming === snd.sha ? (
                  <TextInput autoFocus className={s.rename} defaultValue={snd.name} aria-label={`rename ${snd.name}`} onKeyDown={(e) => (e.key === 'Enter' ? void rename(snd, (e.target as HTMLInputElement).value) : e.key === 'Escape' && setRenaming(null))} onBlur={(e) => void rename(snd, e.target.value)} />
                ) : (
                  <span className={s.top} onDoubleClick={() => setRenaming(snd.sha)}>
                    <span className={s.name}>{snd.name}</span>
                    <span className={s.dur}>{formatDuration(snd.duration)}</span>
                  </span>
                )}
                <Waveform peaks={snd.peaks ?? []} bars={compact ? 48 : 64} height={18} />
              </span>
              <span className={s.acts}>
                <button type="button" className={s.act} aria-label={`rename ${snd.name}`} title="rename" onClick={() => setRenaming(snd.sha)}>
                  <Icon name="edit" size={13} />
                </button>
                <button type="button" className={s.act} aria-label={`delete ${snd.name}`} title="delete" onClick={() => setConfirm(snd.sha)} data-testid={`sound-delete-${snd.sha}`}>
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

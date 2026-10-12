import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * The editor's own playhead (protocol §12, editor preview): plays the stage, the content view and thumbnails without
 * touching the wall. Pure state plus a clock function, so it is testable without React.
 */
export interface PreviewState {
  playing: boolean
  /** playhead while paused; at `startedAt` while playing */
  offset: number
  /** clock ms when play started */
  startedAt: number
  loop: boolean
}

export const PREVIEW_STOPPED: PreviewState = { playing: false, offset: 0, startedAt: 0, loop: false }

/** The playhead at clock `now` (ms): loops over `duration` or holds at its end. */
export function previewTime(st: PreviewState, now: number, duration: number): number {
  if (!st.playing) return Math.max(0, Math.min(duration, st.offset))
  const t = st.offset + (now - st.startedAt) / 1000
  if (duration <= 0) return 0
  if (st.loop) return ((t % duration) + duration) % duration
  return Math.min(duration, t)
}

export function previewPlay(st: PreviewState, now: number, duration: number): PreviewState {
  if (st.playing) return st
  // play from the start again once the end was reached
  const offset = st.offset >= duration - 1e-3 ? 0 : st.offset
  return { ...st, playing: true, offset, startedAt: now }
}

export function previewPause(st: PreviewState, now: number, duration: number): PreviewState {
  return st.playing ? { ...st, playing: false, offset: previewTime(st, now, duration) } : st
}

export function previewSeek(st: PreviewState, t: number, now: number, duration: number): PreviewState {
  const at = Math.max(0, Math.min(duration, t))
  return { ...st, offset: at, startedAt: now }
}

export interface PreviewClock {
  /** the playhead now, seconds */
  t: () => number
  playing: boolean
  loop: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  /** moves the playhead by dt seconds */
  step: (dt: number) => void
  setLoop: (v: boolean) => void
}

/** The editor preview clock as a hook. `onChange` hears every transport change (wall follows editor). */
export function usePreviewClock(duration: number, onChange?: (kind: 'play' | 'pause' | 'seek', t: number) => void): PreviewClock {
  const [st, setSt] = useState<PreviewState>(PREVIEW_STOPPED)
  const ref = useRef(st)
  ref.current = st
  const dur = useRef(duration)
  dur.current = Math.max(0.1, duration)
  const cb = useRef(onChange)
  cb.current = onChange
  const now = () => performance.now()
  const put = useCallback((next: PreviewState) => {
    ref.current = next
    setSt(next)
  }, [])
  const t = useCallback(() => previewTime(ref.current, now(), dur.current), [])
  const play = useCallback(() => {
    put(previewPlay(ref.current, now(), dur.current))
    cb.current?.('play', t())
  }, [put, t])
  const pause = useCallback(() => {
    put(previewPause(ref.current, now(), dur.current))
    cb.current?.('pause', t())
  }, [put, t])
  const seek = useCallback(
    (to: number) => {
      put(previewSeek(ref.current, to, now(), dur.current))
      cb.current?.('seek', t())
    },
    [put, t],
  )
  return useMemo(
    () => ({
      t,
      playing: st.playing,
      loop: st.loop,
      play,
      pause,
      toggle: () => (ref.current.playing ? pause() : play()),
      seek,
      step: (dt: number) => seek(t() + dt),
      setLoop: (v: boolean) => {
        const cur = ref.current
        // keep the playhead where it is when loop changes mid-play
        put({ ...cur, loop: v, offset: previewTime(cur, now(), dur.current), startedAt: now() })
      },
    }),
    [st.playing, st.loop, t, play, pause, seek, put],
  )
}

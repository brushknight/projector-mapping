import { useEffect, useRef } from 'react'

/**
 * Runs fn every animation frame while mounted (latest fn is used, no restarts). maxFps caps the rate. With
 * `pauseHidden` it skips frames while the document is hidden (a web view off screen, a background tab).
 */
export function useRaf(fn: (now: number) => void, maxFps?: number, opts: { pauseHidden?: boolean } = {}) {
  const ref = useRef(fn)
  ref.current = fn
  const pauseHidden = !!opts.pauseHidden
  useEffect(() => {
    let id = 0
    let last = 0
    const minDt = maxFps ? 1000 / maxFps - 2 : 0
    const loop = (now: number) => {
      id = requestAnimationFrame(loop)
      if (pauseHidden && typeof document !== 'undefined' && document.hidden) return
      if (minDt && now - last < minDt) return
      last = now
      ref.current(now)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [maxFps, pauseHidden])
}

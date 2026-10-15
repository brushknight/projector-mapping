import { useCallback, useEffect, useRef, useState } from 'react'
import s from './fullscreen.module.css'

/** How long the "click for full screen" hint shows, and how long the mouse rests before the cursor hides. */
export const FULLSCREEN_HINT_MS = 3000
export const IDLE_HIDE_MS = 2000
/** a double-click this soon after the first click entered full screen keeps it (the two clicks are one gesture) */
const DOUBLE_AFTER_ENTER_MS = 600

const isFull = () => !!document.fullscreenElement

export function enterFullscreen() {
  if (isFull()) return
  try {
    void document.documentElement.requestFullscreen?.()?.catch?.(() => {})
  } catch {
    /* the browser refused: nothing to do */
  }
}

export function exitFullscreen() {
  if (!isFull()) return
  try {
    void document.exitFullscreen?.()?.catch?.(() => {})
  } catch {
    /* already out */
  }
}

export function toggleFullscreen() {
  if (isFull()) exitFullscreen()
  else enterFullscreen()
}

/**
 * Full screen for the output pages (/out and /view, protocol §17): the first click anywhere enters full screen,
 * a double-click and the F key toggle it, Esc leaves it. While not full screen a "click for full screen" hint shows
 * for FULLSCREEN_HINT_MS. `idle` turns true after IDLE_HIDE_MS without mouse movement (hide the cursor and bars).
 * Only the Fullscreen API hides Chrome's location bar on a popup window.
 */
export function useFullscreenControls({ hints = true }: { hints?: boolean } = {}) {
  const [full, setFull] = useState(isFull)
  const [idle, setIdle] = useState(false)
  const [hint, setHint] = useState(hints && !isFull())
  const entered = useRef(0)
  const clicked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wake = useCallback(() => {
    setIdle(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setIdle(true), IDLE_HIDE_MS)
  }, [])

  useEffect(() => {
    wake()
    const hintTimer = hints ? setTimeout(() => setHint(false), FULLSCREEN_HINT_MS) : null
    const onChange = () => {
      const f = isFull()
      setFull(f)
      if (f) setHint(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'f' || e.key === 'F' || e.key === 'Escape') entered.current = 0
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'Escape') {
        exitFullscreen()
      }
    }
    const onClick = () => {
      if (clicked.current) return
      clicked.current = true
      if (!isFull()) {
        entered.current = Date.now()
        enterFullscreen()
      }
    }
    const onDouble = () => {
      const justEntered = Date.now() - entered.current < DOUBLE_AFTER_ENTER_MS
      entered.current = 0
      if (justEntered) return
      toggleFullscreen()
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    window.addEventListener('dblclick', onDouble)
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      if (hintTimer) clearTimeout(hintTimer)
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      window.removeEventListener('dblclick', onDouble)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [hints, wake])

  return { full, idle, hint: hint && !full, toggle: toggleFullscreen, wake }
}

/**
 * The "click for full screen" hint: big and centred on /view, small in a corner on /out (the projector should show
 * the picture, not UI; the launcher puts /out in full screen on its own, so there it rarely shows at all).
 */
export function FullscreenHint({ show, small = false }: { show: boolean; small?: boolean }) {
  if (!show) return null
  if (small)
    return (
      <div className={s.small} data-testid="fullscreen-hint" aria-live="polite">
        click for full screen
      </div>
    )
  return (
    <div className={s.hint} data-testid="fullscreen-hint" aria-live="polite">
      <span className={s.big}>click for full screen</span>
      <span className={s.sub}>double-click or press F to switch, Esc to leave</span>
    </div>
  )
}

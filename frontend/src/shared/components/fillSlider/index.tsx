import { memo, useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../../lib/cx'
import { pressed, releaseFocus } from '../../lib/pointer'
import s from './styles.module.css'

export interface FillSliderProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  /** the readout on the right (defaults to the value) */
  display?: string
  /** live = while dragging (send as param), final = on release (commit) */
  onChange: (v: number, phase: 'live' | 'final') => void
  disabled?: boolean
  className?: string
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * The boards' fill slider: an ink bar fills the track, label left and value right in difference blend.
 * Drag anywhere (relative from the press), arrows step, Shift steps ×10. It never listens to the wheel: a move only
 * drags while a button is down, a drag ends on release, cancel or lost capture, and a pointer press leaves no focus
 * behind (shared/lib/pointer.ts), so scrolling the page after a drag never changes the value.
 */
export const FillSlider = memo(function FillSlider({ label, value, min = 0, max = 1, step, display, onChange, disabled, className }: FillSliderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; v: number; moved: boolean; last: number } | null>(null)
  const range = max - min || 1
  const st = step ?? (Number.isInteger(min) && Number.isInteger(max) && range >= 10 ? 1 : range / 100)
  const q = useCallback((v: number) => clamp(Math.round((v - min) / st) * st + min, min, max), [min, max, st])
  const frac = clamp((value - min) / range, 0, 1)

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return q(min + clamp((clientX - r.left) / r.width, 0, 1) * range)
  }

  const onDown = (e: PointerEvent) => {
    if (disabled || e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, v: value, moved: false, last: value }
  }
  /** ends a drag: commits where it got to (or `at`), and drops the focus the press gave */
  const end = (at: number | null) => {
    const d = drag.current
    drag.current = null
    releaseFocus(ref.current)
    if (!d) return
    onChange(at ?? d.last, 'final')
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    // no button down: a scroll-made move or a release we missed; never drag on it
    if (!pressed(e)) return end(null)
    if (Math.abs(e.clientX - d.x) > 2) d.moved = true
    if (d.moved) {
      d.last = valueAt(e.clientX)
      onChange(d.last, 'live')
    }
  }
  const onUp = (e: PointerEvent) => {
    if (!drag.current) return releaseFocus(ref.current)
    end(valueAt(e.clientX))
  }
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return
    const k = e.key
    const mult = e.shiftKey ? 10 : 1
    let v: number | null = null
    if (k === 'ArrowRight' || k === 'ArrowUp') v = q(value + st * mult)
    else if (k === 'ArrowLeft' || k === 'ArrowDown') v = q(value - st * mult)
    else if (k === 'Home') v = min
    else if (k === 'End') v = max
    if (v !== null) {
      e.preventDefault()
      onChange(v, 'final')
    }
  }

  return (
    <div
      ref={ref}
      className={cx(s.sl, disabled && s.disabled, className)}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={display}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => end(null)}
      onLostPointerCapture={() => drag.current && end(null)}
      onKeyDown={onKey}
    >
      <div className={s.f} style={{ width: `${frac * 100}%` }} />
      <span className={s.l}>{label}</span>
      <span className={s.v}>{display ?? String(value)}</span>
    </div>
  )
})
FillSlider.displayName = 'FillSlider'

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

export type TooltipSide = 'top' | 'bottom'

/** Where a tip sits: centred on the anchor, kept `margin` px inside the viewport. Pure, for tests. */
export function tipPosition(anchor: { left: number; top: number; width: number; height: number }, side: TooltipSide, viewport: { width: number }, tipWidth = 240, gap = 8, margin = 8) {
  const half = tipWidth / 2
  const cx = anchor.left + anchor.width / 2
  const x = Math.max(margin + half, Math.min(viewport.width - margin - half, cx))
  return { x, y: side === 'top' ? anchor.top - gap : anchor.top + anchor.height + gap }
}

/**
 * A small dark label that explains a control. Shows on hover after `delay` ms and at once on keyboard focus; the
 * child gets `aria-describedby`. Wraps one element (a button, usually).
 */
export function Tooltip({ text, side = 'bottom', delay = 350, children, className }: { text: ReactNode; side?: TooltipSide; delay?: number; children: ReactNode; className?: string }) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const show = () => {
    clear()
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(tipPosition(r, side, { width: window.innerWidth }))
  }
  const hide = () => {
    clear()
    setPos(null)
  }
  useEffect(() => clear, [])

  const child = isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': pos ? id : undefined }) : children
  return (
    <span
      ref={ref}
      className={cx(s.wrap, className)}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return
        clear()
        timer.current = window.setTimeout(show, delay)
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => (e.target as HTMLElement).matches?.(':focus-visible') && show()}
      onBlur={hide}
    >
      {child}
      {pos &&
        text &&
        createPortal(
          <span role="tooltip" id={id} className={cx(s.tip, side === 'top' && s.top)} style={{ left: pos.x, top: pos.y }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pill } from '../pill'
import s from './styles.module.css'

export interface TourStep {
  /** CSS selector of what the step points at; none = a card in the middle */
  target?: string
  title: ReactNode
  text: ReactNode
}

type Box = { left: number; top: number; width: number; height: number }

export const TOUR_CARD = { width: 320, height: 176 }

/**
 * Where a step's card goes: under the target when it fits, else above, else beside it, kept 12 px inside the
 * viewport; without a target, in the middle. Pure, for tests.
 */
export function tourCardPosition(target: Box | null, viewport: { width: number; height: number }, card = TOUR_CARD, gap = 14, margin = 12): { left: number; top: number } {
  const clampX = (x: number) => Math.max(margin, Math.min(viewport.width - card.width - margin, x))
  const clampY = (y: number) => Math.max(margin, Math.min(viewport.height - card.height - margin, y))
  if (!target) return { left: clampX((viewport.width - card.width) / 2), top: clampY((viewport.height - card.height) / 2) }
  const below = target.top + target.height + gap
  if (below + card.height + margin <= viewport.height) return { left: clampX(target.left), top: below }
  const above = target.top - gap - card.height
  if (above >= margin) return { left: clampX(target.left), top: above }
  const right = target.left + target.width + gap
  if (right + card.width + margin <= viewport.width) return { left: right, top: clampY(target.top) }
  return { left: clampX(target.left - gap - card.width), top: clampY(target.top) }
}

function measure(sel?: string): Box | null {
  if (!sel) return null
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width || r.height ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}

/**
 * A short guided tour: dims the page around what each step points at and explains it in a small card with back,
 * next and skip. It never blocks the page, so you can try things as you read. Esc skips it.
 */
export function Tour({ steps, step, onStep, onClose, label = 'tour' }: { steps: TourStep[]; step: number; onStep: (i: number) => void; onClose: (finished: boolean) => void; label?: string }) {
  const cur = steps[step]
  const [box, setBox] = useState<Box | null>(() => measure(cur?.target))
  const [vp, setVp] = useState({ width: window.innerWidth, height: window.innerHeight })

  useLayoutEffect(() => {
    const tick = () => {
      setBox((old) => {
        const b = measure(cur?.target)
        return old && b && old.left === b.left && old.top === b.top && old.width === b.width && old.height === b.height ? old : b
      })
      setVp((v) => (v.width === window.innerWidth && v.height === window.innerHeight ? v : { width: window.innerWidth, height: window.innerHeight }))
    }
    tick()
    const iv = window.setInterval(tick, 250)
    window.addEventListener('resize', tick)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('resize', tick)
    }
  }, [cur?.target])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  if (!cur) return null
  const last = step === steps.length - 1
  const pos = tourCardPosition(box, vp)
  const pad = 6
  return createPortal(
    <div className={s.layer} data-testid="tour">
      {box ? (
        <div className={s.spot} style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
      ) : (
        <div className={s.scrim} />
      )}
      <div className={s.card} role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top, width: TOUR_CARD.width }} data-testid="tour-card" data-step={step}>
        <div className={s.count}>
          {step + 1} of {steps.length}
        </div>
        <div className={s.title}>{cur.title}</div>
        <div className={s.text}>{cur.text}</div>
        <div className={s.row}>
          <Pill size="sm" ghost onClick={() => onClose(false)} data-testid="tour-skip">
            skip the tour
          </Pill>
          <span className={s.sp} />
          {step > 0 && (
            <Pill size="sm" onClick={() => onStep(step - 1)} data-testid="tour-back">
              back
            </Pill>
          )}
          <Pill size="sm" on onClick={() => (last ? onClose(true) : onStep(step + 1))} data-testid="tour-next">
            {last ? 'got it' : 'next'}
          </Pill>
        </div>
      </div>
    </div>,
    document.body,
  )
}

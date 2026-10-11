import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/** A rounded #111112 panel (radius 22). */
export function Panel({ className, children, as: As = 'section', ...rest }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'aside' | 'div'; children?: ReactNode }) {
  return (
    <As className={cx(s.pane, className)} {...rest}>
      {children}
    </As>
  )
}

/** The panel header row: caption left, actions right. */
export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.ph, className)}>{children}</div>
}

/** An uppercase dim caption (SURFACES, CORNERS). */
export function Cap({ children, className, bright }: { children: ReactNode; className?: string; bright?: boolean }) {
  return <span className={cx(s.cap, bright && s.bright, className)}>{children}</span>
}

/** A padded section; sections after the first get a hairline on top. */
export function Section({ children, className, tight }: { children: ReactNode; className?: string; tight?: boolean }) {
  return <div className={cx(s.sec, tight && s.tight, className)}>{children}</div>
}

/** A row with space between. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.r, className)}>{children}</div>
}

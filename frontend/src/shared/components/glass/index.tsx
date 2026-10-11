import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/** A blurred chip that sits over media (camera feed, photos). */
export function Glass({ children, solid, className }: { children: ReactNode; solid?: boolean; className?: string }) {
  return <span className={cx(s.glass, solid && s.solid, className)}>{children}</span>
}

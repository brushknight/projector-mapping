import type { ReactNode } from 'react'
import s from './styles.module.css'

/** Centered dim text for an empty list or panel. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={s.empty}>{children}</div>
}

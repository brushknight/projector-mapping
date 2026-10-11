import type { ReactNode } from 'react'
import s from './styles.module.css'

/** A read-only number box with a dim prefix ("zoom 100%"). */
export function Readout({ prefix, children }: { prefix?: string; children: ReactNode }) {
  return (
    <span className={s.num}>
      {prefix && <i>{prefix}</i>}
      {children}
    </span>
  )
}

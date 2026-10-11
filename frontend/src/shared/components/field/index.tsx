import type { ReactNode } from 'react'
import s from './styles.module.css'

/** A label above (or beside, `inline`) a control. */
export function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={inline ? s.inline : s.field}>
      <span className={s.label}>{label}</span>
      {children}
    </label>
  )
}

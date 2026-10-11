import type { ReactNode } from 'react'
import s from './styles.module.css'

/** Keyboard hints at the stage's bottom left. */
export function HintBar({ hints }: { hints: Array<{ keys: ReactNode; text: string }> }) {
  return (
    <div className={s.hint}>
      {hints.map((h) => (
        <span key={h.text}>
          <b>{h.keys}</b>
          {h.text}
        </span>
      ))}
    </div>
  )
}

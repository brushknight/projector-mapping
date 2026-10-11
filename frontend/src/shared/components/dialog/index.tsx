import { useEffect, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Pill } from '../pill'
import s from './styles.module.css'

/** A modal over a blurred scrim. Escape and the close button call onClose. */
export function Dialog({ title, onClose, children, width = 880, className }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className={s.modal} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={cx(s.dlg, className)} style={{ width }} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className={s.head}>
          <span className={s.title}>{title}</span>
          <Pill icon="close" aria-label="close" onClick={onClose} />
        </div>
        {children}
      </section>
    </div>
  )
}

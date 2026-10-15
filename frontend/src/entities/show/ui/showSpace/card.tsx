import type { ReactNode } from 'react'
import { Cap } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import s from './styles.module.css'

/** A rounded card with a caption row. */
export function Card({ cap, aside, children, className, testId }: { cap?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cx(s.card, className)} data-testid={testId}>
      {(cap || aside) && (
        <div className={s.cardHead}>
          {cap ? <Cap>{cap}</Cap> : <span />}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

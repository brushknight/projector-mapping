import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface Crumb {
  key: string
  label: ReactNode
  icon?: string
  /** goes back up to this level; the last crumb (where you are) has none */
  onClick?: () => void
  /** what a click does, read by screen readers and shown on hover */
  title?: string
}

/** Where you are, as a path you can climb back up: `object › face`. The last crumb is the current place. */
export function Breadcrumbs({ items, ariaLabel = 'where you are', className }: { items: Crumb[]; ariaLabel?: string; className?: string }) {
  return (
    <nav aria-label={ariaLabel} className={cx(s.crumbs, className)}>
      <ol className={s.list}>
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={c.key} className={s.item}>
              {i > 0 && (
                <span className={s.sep} aria-hidden="true">
                  ›
                </span>
              )}
              {c.onClick && !last ? (
                <button type="button" className={s.link} onClick={c.onClick} title={c.title} data-crumb={c.key}>
                  {c.icon && <Icon name={c.icon} size={13} />}
                  {c.label}
                </button>
              ) : (
                <span className={cx(s.here, !last && s.dim)} aria-current={last ? 'location' : undefined} data-crumb={c.key}>
                  {c.icon && <Icon name={c.icon} size={13} />}
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

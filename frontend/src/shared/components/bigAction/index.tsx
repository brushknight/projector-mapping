import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface BigActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: string
  label: ReactNode
  /** one short line under the label: what you get */
  note?: ReactNode
}

/** A large square button for the few things worth doing first (an empty state's actions). */
export const BigAction = forwardRef<HTMLButtonElement, BigActionProps>(function BigAction({ icon, label, note, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx(s.big, className)} {...rest}>
      <span className={s.icon}>
        <Icon name={icon} size={22} />
      </span>
      <span className={s.label}>{label}</span>
      {note && <span className={s.note}>{note}</span>}
    </button>
  )
})

/** A row of BigActions under a title and a line of text. */
export function BigActions({ title, text, children, className }: { title?: ReactNode; text?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx(s.group, className)}>
      {title && <div className={s.title}>{title}</div>}
      {text && <div className={s.text}>{text}</div>}
      <div className={s.row}>{children}</div>
    </div>
  )
}

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** on = ink background (selected or primary) */
  on?: boolean
  ghost?: boolean
  /** a round icon-only button; give it an aria-label */
  icon?: string
  iconSize?: number
  size?: 'sm' | 'md' | 'lg'
  children?: ReactNode
}

/** The rounded control of the boards: 34 px (md), 28 px (sm), 40 px (lg). */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { on, ghost, icon, iconSize, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = !!icon && children === undefined
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.pill, s[size], on && s.on, ghost && s.ghost, iconOnly && s.iconOnly, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize ?? (size === 'sm' ? 14 : 15)} />}
      {children}
    </button>
  )
})

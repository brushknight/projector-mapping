import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: string
  title?: string
  disabled?: boolean
}

/** The grey box with equal segments; the chosen one is ink. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  width,
  className,
  size = 'md',
}: {
  options: Array<SegmentOption<T>>
  value: T | null
  onChange: (v: T) => void
  ariaLabel: string
  width?: CSSProperties['width']
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div className={cx(s.seg, size === 'sm' && s.sm, className)} role="group" aria-label={ariaLabel} style={width !== undefined ? { width } : undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx(o.value === value && s.on)}
          aria-pressed={o.value === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

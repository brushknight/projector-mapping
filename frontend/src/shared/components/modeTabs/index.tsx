import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface ModeTab<T extends string> {
  value: T
  label: string
  icon: string
  title?: string
}

/**
 * The phone's tab bar on the web: icon over a short name, the open tab raised, the one on air marked with the red dot.
 * Opening a tab and putting it on air are the same click in the Show space.
 */
export function ModeTabs<T extends string>({
  tabs,
  value,
  onAir,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: Array<ModeTab<T>>
  value: T | null
  /** the tab that is on air (red dot); null = none */
  onAir?: T | null
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div className={cx(s.bar, className)} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className={cx(s.tab, t.value === value && s.on)}
          onClick={() => onChange(t.value)}
          title={t.title}
          data-testid={`mode-tab-${t.value}`}
          data-on-air={t.value === onAir ? 'true' : undefined}
        >
          <Icon name={t.icon} size={19} />
          <span className={s.label}>
            {t.value === onAir && <i className={s.dot} aria-label="on air" />}
            {t.label}
          </span>
        </button>
      ))}
    </div>
  )
}

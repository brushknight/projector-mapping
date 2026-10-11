import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface ToolItem<T extends string> {
  value: T
  icon: string
  label: string
  /** keyboard shortcut shown in the tooltip */
  hotkey?: string
  /** what to do with the tool, appended to the tooltip ("click 4 corners") */
  hint?: string
}

/** The round tool strip of the top bar. */
export function Tools<T extends string>({ items, value, onChange, ariaLabel = 'tools' }: { items: Array<ToolItem<T>>; value: T; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <nav className={s.tools} aria-label={ariaLabel}>
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          className={cx(s.tool, t.value === value && s.on)}
          aria-label={t.hotkey ? `${t.label} (${t.hotkey})` : t.label}
          aria-pressed={t.value === value}
          title={`${t.hotkey ? `${t.label} (${t.hotkey})` : t.label}${t.hint ? `: ${t.hint}` : ''}`}
          onClick={() => onChange(t.value)}
        >
          <Icon name={t.icon} size={17} />
        </button>
      ))}
    </nav>
  )
}

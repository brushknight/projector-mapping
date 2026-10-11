import { cx } from '../../lib/cx'
import s from './styles.module.css'

/** The round on/off switch. */
export function Switch({ checked, onChange, ariaLabel, disabled }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cx(s.sw, checked && s.on)}
      onClick={() => onChange(!checked)}
    />
  )
}

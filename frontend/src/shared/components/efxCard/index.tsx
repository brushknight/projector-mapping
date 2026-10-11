import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import { Switch } from '../switch'
import s from './styles.module.css'

/** An effect in the inspector stack: icon + name + on switch, controls below when on. */
export function EfxCard({ icon, name, enabled, onToggle, children, actions, onHeaderClick }: { icon: string; name: string; enabled: boolean; onToggle?: (v: boolean) => void; children?: ReactNode; actions?: ReactNode; onHeaderClick?: () => void }) {
  return (
    <div className={cx(s.efx, !enabled && s.off)}>
      <div className={s.head}>
        <span className={s.name} onClick={onHeaderClick}>
          <Icon name={icon} />
          {name}
        </span>
        <span className={s.actions}>
          {actions}
          {onToggle && <Switch checked={enabled} onChange={onToggle} ariaLabel={name} />}
        </span>
      </div>
      {enabled && children}
    </div>
  )
}

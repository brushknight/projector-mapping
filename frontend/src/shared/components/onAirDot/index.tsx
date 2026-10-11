import { cx } from '../../lib/cx'
import s from './styles.module.css'

/** The pulsing red dot (on air, live camera). Grey when off. */
export function OnAirDot({ off }: { off?: boolean }) {
  return <i className={cx(s.rd, off && s.off)} aria-hidden="true" />
}

import { Cap } from '../panel'
import s from './styles.module.css'

export interface Step {
  label: string
  /** 0..1 */
  fraction: number
}

/** The auto-map progress strip: one labelled bar per step. */
export function StepBar({ steps }: { steps: Step[] }) {
  return (
    <div className={s.steps}>
      {steps.map((st) => (
        <div className={s.step} key={st.label}>
          <Cap bright={st.fraction > 0}>{st.label}</Cap>
          <i className={s.track} role="progressbar" aria-label={st.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.fraction * 100)}>
            <b style={{ width: `${Math.round(Math.min(1, Math.max(0, st.fraction)) * 100)}%` }} />
          </i>
        </div>
      ))}
    </div>
  )
}

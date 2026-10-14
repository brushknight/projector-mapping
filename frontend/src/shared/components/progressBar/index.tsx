import { memo } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/**
 * Progress as one bar (`value` 0…1) or as segments (`segments` with `filled` of them lit, like the cue card).
 */
export const ProgressBar = memo(function ProgressBar({ value, segments, filled = 0, className, label }: { value?: number; segments?: number; filled?: number; className?: string; label?: string }) {
  if (segments !== undefined) {
    return (
      <div className={cx(s.segs, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={segments} aria-valuenow={filled}>
        {Array.from({ length: Math.max(1, segments) }, (_, i) => (
          <i key={i} className={i < filled ? s.lit : undefined} />
        ))}
      </div>
    )
  }
  const v = Math.max(0, Math.min(1, value ?? 0))
  return (
    <div className={cx(s.bar, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  )
})
ProgressBar.displayName = 'ProgressBar'

import { memo } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/**
 * A sound's loudness as mirrored bars (peaks 0…1, normally 128 of them). `progress` (0…1) fills the played part in
 * ink; `bars` resamples to fit small rows.
 */
export const Waveform = memo(function Waveform({ peaks, progress, bars = 64, height = 28, className }: { peaks: number[]; progress?: number | null; bars?: number; height?: number; className?: string }) {
  const n = Math.max(1, Math.min(bars, peaks.length || bars))
  const vals = Array.from({ length: n }, (_, i) => {
    if (!peaks.length) return 0.04
    const a = Math.floor((i * peaks.length) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / n))
    let m = 0
    for (let k = a; k < b; k++) m = Math.max(m, peaks[k] ?? 0)
    return Math.max(0.04, Math.min(1, m))
  })
  const w = n * 3
  const cut = progress == null ? -1 : progress * n
  return (
    <svg className={cx(s.wave, className)} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      {vals.map((v, i) => {
        const h = v * (height - 2)
        return <rect key={i} x={i * 3} y={(height - h) / 2} width={2} height={h} rx={1} className={i < cut ? s.played : s.bar} />
      })}
    </svg>
  )
})
Waveform.displayName = 'Waveform'

import { memo } from 'react'
import { cx } from '../../lib/cx'
import { FillSlider } from '../fillSlider'
import { Icon } from '../icons'
import s from './styles.module.css'

/** A volume fill slider with a mute button beside it. Muting keeps the level. */
export const VolumeSlider = memo(function VolumeSlider({
  label = 'volume',
  value,
  muted,
  onChange,
  onMute,
  className,
}: {
  label?: string
  value: number
  muted: boolean
  onChange: (v: number, phase: 'live' | 'final') => void
  onMute: (muted: boolean) => void
  className?: string
}) {
  return (
    <div className={cx(s.row, muted && s.muted, className)}>
      <button type="button" className={s.mute} aria-pressed={muted} aria-label={muted ? 'unmute' : 'mute'} title={muted ? 'muted: click to hear it again' : 'mute every sound (keeps the level)'} onClick={() => onMute(!muted)} data-testid="mute">
        <Icon name={muted ? 'speakerOff' : 'speaker'} size={16} />
      </button>
      <FillSlider className={s.sl} label={muted ? `${label} · muted` : label} value={value} display={`${Math.round(value * 100)}%`} onChange={onChange} />
    </div>
  )
})
VolumeSlider.displayName = 'VolumeSlider'

import { useEffect, useState } from 'react'
import { Cap, OnAirDot, Segmented, VolumeSlider } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { showAudio, type AudioOutput, type Show } from '../../types'
import s from './styles.module.css'

const OUTPUTS: Array<{ value: AudioOutput; label: string; title: string }> = [
  { value: 'projector', label: 'projector', title: 'the /out page on the projector computer plays every sound' },
  { value: 'editor', label: 'laptop', title: 'this laptop editor plays every sound' },
  { value: 'phone', label: 'phone', title: 'the iPhone app plays every sound' },
]

/** The wall: on air or blackout, the master volume with mute, and which device plays sound (§14 show.audio). */
export function WallPanel({ show, command }: { show: Show | null; command: (name: string, args?: Record<string, unknown>) => Promise<unknown> }) {
  const audio = showAudio(show)
  const onAir = show?.onAir ?? false
  const [vol, setVol] = useState(audio.volume)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) setVol(audio.volume)
  }, [audio.volume, dragging])
  return (
    <div className={s.wall} data-testid="wall-panel">
      <button type="button" className={cx(s.air, !onAir && s.black)} onClick={() => command('show.blackout', { on: onAir })} aria-label={onAir ? 'on air, click to black out' : 'blacked out, click to go on air'} data-testid="show-on-air">
        <OnAirDot off={!onAir} />
        <span className={s.airText}>{onAir ? 'on air' : 'blackout'}</span>
        <span className={s.airHint}>{onAir ? 'click to black out' : 'click to go on air'}</span>
      </button>
      <VolumeSlider
        label="master"
        value={vol}
        muted={audio.muted}
        onChange={(v, ph) => {
          const r = Math.round(v * 100) / 100
          setVol(r)
          setDragging(ph === 'live')
          if (ph === 'final') void command('show.audio', { volume: r })
        }}
        onMute={(m) => void command('show.audio', { muted: m })}
      />
      <div className={s.out}>
        <Cap>sound plays on</Cap>
        <Segmented<AudioOutput> ariaLabel="audio output" size="sm" value={audio.output} onChange={(v) => void command('show.audio', { output: v })} options={OUTPUTS} />
      </div>
    </div>
  )
}

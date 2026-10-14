import { memo, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

/**
 * A soundboard pad: a glyph (or the name alone), the key that plays it, and a tone colour. Playing pads glow in their
 * tone; a pad whose sound is gone says so. `tone` is a CSS colour, normally a `var(--pad-…)` token.
 */
export const Pad = memo(function Pad({
  label,
  icon,
  tone,
  keyLabel,
  playing,
  loop,
  missing,
  onPress,
  onEdit,
  meta,
  testId,
}: {
  label: string
  /** an icon name; absent draws the name large instead */
  icon?: string | null
  tone: string
  keyLabel?: string | null
  playing?: boolean
  loop?: boolean
  missing?: boolean
  onPress: () => void
  onEdit?: () => void
  meta?: ReactNode
  testId?: string
}) {
  return (
    <div className={cx(s.wrap, playing && s.playing, missing && s.missing)} style={{ '--tone': tone } as CSSProperties} data-testid={testId} data-playing={playing ? 'true' : undefined}>
      <button type="button" className={s.pad} onClick={onPress} aria-pressed={loop ? !!playing : undefined} title={missing ? `${label}: missing sound` : `${loop ? (playing ? 'stop' : 'start') : 'play'} ${label}${keyLabel ? ` (key ${keyLabel.toUpperCase()})` : ''}`}>
        <span className={s.top}>
          {icon ? <Icon name={icon} size={22} className={s.glyph} /> : <span className={s.big}>{label.slice(0, 2)}</span>}
          {keyLabel && <kbd className={s.key}>{keyLabel.toUpperCase()}</kbd>}
        </span>
        <span className={s.name}>{label}</span>
        <span className={s.meta}>
          {playing && (
            <span className={s.eq} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {missing ? 'missing sound' : meta}
          {loop && <Icon name="loop" size={12} />}
        </span>
      </button>
      {onEdit && (
        <button type="button" className={s.edit} onClick={onEdit} aria-label={`edit ${label}`} title={`edit ${label}`}>
          <Icon name="more" size={14} />
        </button>
      )}
    </div>
  )
})
Pad.displayName = 'Pad'

import { memo, type DragEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

/** A library tile (effects, gobos, scenery): icon or swatch over a short name. Draggable. */
export const LibTile = memo(function LibTile({
  icon,
  label,
  on,
  onClick,
  dragData,
  swatch,
  title,
  testId,
}: {
  icon?: string
  label: string
  on?: boolean
  onClick?: () => void
  /** text/plain payload for drag and drop onto the stage or timeline */
  dragData?: string
  /** a CSS background (gradient or image) drawn instead of the icon */
  swatch?: string
  title?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      className={cx(s.fx, on && s.on)}
      onClick={onClick}
      title={title ?? label}
      aria-pressed={on === undefined ? undefined : on}
      data-testid={testId}
      draggable={!!dragData}
      onDragStart={(e: DragEvent) => {
        if (!dragData) return
        e.dataTransfer.setData('text/plain', dragData)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      {swatch ? <span className={s.sw} style={{ background: swatch }} /> : <Icon name={icon ?? 'sparkle'} size={20} />}
      <span className={s.label}>{label as ReactNode}</span>
    </button>
  )
})
LibTile.displayName = 'LibTile'

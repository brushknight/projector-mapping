import { memo, type DragEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

/**
 * A picture tile of the phone boards (gobos, gradients, photos, videos): a rounded swatch with the name under it.
 * The picked one gets the ink ring. `background` is a CSS background (an image url or a gradient).
 */
export const Tile = memo(function Tile({
  label,
  background,
  icon,
  on,
  onClick,
  meta,
  badge,
  aspect = 1,
  title,
  testId,
  dragData,
  disabled,
}: {
  label: string
  background?: string
  /** drawn when there is no background */
  icon?: string
  on?: boolean
  onClick?: () => void
  /** dim text after the name */
  meta?: ReactNode
  /** a small glass label in the corner (a duration, "youtube") */
  badge?: ReactNode
  /** width / height of the swatch */
  aspect?: number
  title?: string
  testId?: string
  dragData?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={cx(s.tile, on && s.on)}
      onClick={onClick}
      title={title ?? label}
      aria-pressed={on === undefined ? undefined : on}
      data-testid={testId}
      disabled={disabled}
      draggable={!!dragData}
      onDragStart={(e: DragEvent) => {
        if (!dragData) return
        e.dataTransfer.setData('text/plain', dragData)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <span className={s.sw} style={{ aspectRatio: String(aspect), ...(background ? { background } : {}) }}>
        {!background && <Icon name={icon ?? 'image'} size={22} />}
        {badge !== undefined && <span className={s.badge}>{badge}</span>}
      </span>
      <span className={s.label}>
        <span className={s.name}>{label}</span>
        {meta !== undefined && <span className={s.meta}>{meta}</span>}
      </span>
    </button>
  )
})
Tile.displayName = 'Tile'

import { memo, type MouseEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface TreeNodeProps {
  icon: string
  label: ReactNode
  meta?: ReactNode
  depth?: number
  selected?: boolean
  dim?: boolean
  visible?: boolean
  onToggleVisible?: () => void
  onClick?: (e: MouseEvent) => void
  onDoubleClick?: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  testId?: string
}

/** One row of the surfaces tree: icon, name, dim meta, eye. */
export const TreeNode = memo(function TreeNode({ icon, label, meta, depth = 0, selected, dim, visible = true, onToggleVisible, onClick, onDoubleClick, draggable, onDragStart, testId }: TreeNodeProps) {
  return (
    <div
      className={cx(s.node, selected && s.sel, (dim || !visible) && s.dimn)}
      style={{ paddingLeft: 8 + depth * 18 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role="treeitem"
      aria-selected={!!selected}
      tabIndex={-1}
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={testId}
    >
      <span className={s.ic}>
        <Icon name={icon} />
      </span>
      <span className={s.k}>{label}</span>
      {meta !== undefined && <span className={s.m}>{meta}</span>}
      {onToggleVisible && (
        <button
          type="button"
          className={s.eye}
          aria-label={visible ? 'hide' : 'show'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible()
          }}
        >
          <Icon name={visible ? 'eye' : 'eyeOff'} />
        </button>
      )}
    </div>
  )
})
TreeNode.displayName = 'TreeNode'

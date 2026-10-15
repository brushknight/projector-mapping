import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: string
  meta?: ReactNode
  on?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
  /** a non-clickable section caption */
  caption?: boolean
  /** data-testid of the item's button */
  testId?: string
}

/**
 * A button that opens a list below it. `trigger` renders the button (gets toggle + open state).
 * Clicking outside or pressing Escape closes it.
 */
export function Menu({
  trigger,
  items,
  align = 'left',
  width = 260,
  children,
  className,
  style,
  open: openProp,
  onOpenChange,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  items?: MenuItem[]
  align?: 'left' | 'right'
  width?: number
  children?: (close: () => void) => ReactNode
  className?: string
  style?: CSSProperties
  /** controlled open state (optional); onOpenChange hears every change */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const changeRef = useRef(onOpenChange)
  changeRef.current = onOpenChange
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v
    setOwn(next)
    changeRef.current?.(next)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  const close = () => setOpen(false)
  return (
    <div className={cx(s.wrap, className)} style={style} ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx(s.pop, align === 'right' && s.right)} style={{ width }} role="menu">
          {items?.map((it) =>
            it.caption ? (
              <div key={it.key} className={s.caption}>
                {it.label}
              </div>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={cx(s.item, it.on && s.on, it.danger && s.danger)}
                data-testid={it.testId}
                onClick={() => {
                  close()
                  it.onSelect?.()
                }}
              >
                {it.icon && <Icon name={it.icon} size={14} />}
                <span className={s.k}>{it.label}</span>
                {it.meta !== undefined && <span className={s.m}>{it.meta}</span>}
              </button>
            ),
          )}
          {children?.(close)}
        </div>
      )}
    </div>
  )
}

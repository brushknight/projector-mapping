import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/**
 * A numeric box with a dim prefix ("x", "zoom"). Commits on Enter or blur; arrows step 1 (Shift 10) and commit.
 */
export function NumField({
  prefix,
  value,
  onCommit,
  step = 1,
  digits = 0,
  selected,
  ariaLabel,
  min,
  max,
  readOnly,
  suffix,
}: {
  prefix?: string
  value: number
  onCommit?: (v: number) => void
  step?: number
  digits?: number
  selected?: boolean
  ariaLabel: string
  min?: number
  max?: number
  readOnly?: boolean
  suffix?: string
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(digits) : '')
  const [text, setText] = useState(fmt(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, digits])

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  // the last value sent, so Enter followed by blur commits once
  const sent = useRef<number | null>(null)
  const commit = (v: number) => {
    if (!Number.isFinite(v) || !onCommit) return
    const c = clamp(v)
    if (sent.current === c) return
    sent.current = c
    onCommit(c)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(Number(text))
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      setText(fmt(value))
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
      const v = clamp(Number(text) + d)
      setText(fmt(v))
      commit(v)
    }
    e.stopPropagation()
  }
  return (
    <label className={cx(s.num, selected && s.sel)}>
      {prefix && <i>{prefix}</i>}
      <input
        value={text}
        readOnly={readOnly || !onCommit}
        aria-label={ariaLabel}
        inputMode="decimal"
        onFocus={() => {
          sent.current = null
          setEditing(true)
        }}
        onBlur={() => {
          setEditing(false)
          if (Number(text) !== value) commit(Number(text))
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      {suffix && <i>{suffix}</i>}
    </label>
  )
}

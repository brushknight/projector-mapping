import { useState, type KeyboardEvent } from 'react'
import { cx } from '../../lib/cx'
import { Pill } from '../pill'
import s from './styles.module.css'

/** The prompt box: a textarea and a round send button. Enter sends, Shift+Enter adds a line. */
export function AskBox({ placeholder, onSend, disabled, multiline, initial = '', sendLabel = 'send', hideSend }: { placeholder: string; onSend?: (text: string) => void; disabled?: boolean; multiline?: boolean; initial?: string; sendLabel?: string; hideSend?: boolean }) {
  const [text, setText] = useState(initial)
  const send = () => {
    const t = text.trim()
    if (!t || disabled || !onSend) return
    onSend(t)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault()
      send()
    }
  }
  return (
    <div className={cx(s.ask, multiline && s.multi)}>
      <textarea
        className={s.input}
        value={text}
        placeholder={placeholder}
        rows={multiline ? 3 : 1}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      {!hideSend && <Pill icon="send" on aria-label={sendLabel} onClick={send} disabled={disabled || !text.trim()} />}
    </div>
  )
}

/** A plain multi-line text area in the ask style (controlled). */
export function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  return (
    <div className={cx(s.ask, s.multi)}>
      <textarea className={s.input} value={value} rows={rows} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </div>
  )
}

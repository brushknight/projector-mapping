import { memo, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../icons'
import s from './styles.module.css'

/** A chat bubble: `me` is the ink bubble on the right. */
export function ChatMessage({ me, children }: { me?: boolean; children: ReactNode }) {
  return <div className={cx(s.msg, me && s.me)}>{children}</div>
}

export type LogState = 'ok' | 'running' | 'failed'

/** One tool call in an agent log: state icon, text, duration. */
export const LogRow = memo(function LogRow({ state, text, time }: { state: LogState; text: ReactNode; time?: string }) {
  return (
    <div className={cx(s.row, state === 'failed' && s.failed)}>
      <span className={s.state}>
        <Icon name={state === 'ok' ? 'check' : state === 'failed' ? 'close' : 'more'} size={13} strokeWidth={2.2} />
      </span>
      <span>{text}</span>
      <span className={s.t}>{time ?? ''}</span>
    </div>
  )
})
LogRow.displayName = 'LogRow'

export function Log({ children }: { children: ReactNode }) {
  return <div className={s.log}>{children}</div>
}

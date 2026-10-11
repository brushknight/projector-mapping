import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

/** A one-line text box in the control style. Keys don't leak to editor shortcuts. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, onKeyDown, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(s.input, className)}
      onKeyDown={(e) => {
        e.stopPropagation()
        onKeyDown?.(e)
      }}
      {...rest}
    />
  )
})

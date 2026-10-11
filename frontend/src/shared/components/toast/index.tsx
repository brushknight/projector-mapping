import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import s from './styles.module.css'

interface ToastItem {
  id: number
  text: string
  bad?: boolean
}

const Ctx = createContext<(text: string, opts?: { bad?: boolean }) => void>(() => {})

/** Shows short messages at the bottom centre for 3.5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, opts?: { bad?: boolean }) => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs.slice(-3), { id, text, bad: opts?.bad }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className={s.stack} aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(s.toast, t.bad && s.bad)} role={t.bad ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}

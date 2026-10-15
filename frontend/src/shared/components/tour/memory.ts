/** Remembers that a tour was seen, in localStorage when the browser allows it (private windows may throw). */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** window.localStorage, or null where reading it throws or it does not exist. */
export function safeStorage(): Store | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** True once the tour was finished or skipped. Unreadable storage counts as not seen. */
export function tourSeen(key: string, store: Store | null = safeStorage()): boolean {
  try {
    return store?.getItem(key) === 'seen'
  } catch {
    return false
  }
}

/** Marks the tour as seen; returns false when the browser would not store it. */
export function rememberTour(key: string, store: Store | null = safeStorage()): boolean {
  try {
    if (!store) return false
    store.setItem(key, 'seen')
    return true
  } catch {
    return false
  }
}

/** Forgets the tour, so it shows again on the next visit. */
export function forgetTour(key: string, store: Store | null = safeStorage()): void {
  try {
    store?.removeItem(key)
  } catch {
    /* nothing to forget */
  }
}

/** The step after `step` going `dir`, or null when the tour ends (past the last step). Never below 0. */
export function stepAfter(step: number, count: number, dir: 1 | -1): number | null {
  const next = step + dir
  if (next >= count) return null
  return Math.max(0, next)
}

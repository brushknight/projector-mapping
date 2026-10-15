import { useEffect } from 'react'
import type { Hub } from './ws'

/** The hashed module script this page was loaded with (`/assets/index-XXXX.js`), or null in dev. */
function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
  return el ? new URL(el.src, location.href).pathname : null
}

/**
 * Long-running display pages (the projector output, the viewer, the phone preview) must never keep running old code
 * after the server is updated: an old /out silently skips effects it does not know. Every time the hub is welcomed
 * (first connect and every reconnect after a server restart) this fetches the page's HTML fresh and reloads when the
 * built bundle changed. Dev builds (no hashed bundle) are left alone.
 */
export function useReloadOnNewBuild(hub: Hub) {
  useEffect(() => {
    const mine = currentBundle()
    if (!mine) return
    let busy = false
    const check = async () => {
      if (busy) return
      busy = true
      try {
        const res = await fetch(`${location.pathname}?build=${Date.now()}`, { cache: 'no-store' })
        const html = await res.text()
        const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\/assets\/[^"]+)"/)
        if (m && new URL(m[1], location.href).pathname !== mine) location.reload()
      } catch {
        /* the server is still coming up; the next welcome checks again */
      } finally {
        busy = false
      }
    }
    return hub.on('welcome', () => void check())
  }, [hub])
}

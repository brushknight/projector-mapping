import { authToken } from '../../shared/lib/http'

/**
 * The viewer's URL (protocol §15): `/view`, with the editor's token when it has one so a viewer opened on another
 * machine can connect read only.
 */
export function viewerUrl(token: string | null = authToken()): string {
  return token ? `/view?token=${encodeURIComponent(token)}` : '/view'
}

/**
 * Opens the viewer in its own window sized to the frame: 16:9, or 9:16 when the projector is portrait. Returns the
 * window (null when the browser blocked it).
 */
export function openViewer(opts: { portrait?: boolean } = {}): Window | null {
  const scr = globalThis.screen
  const maxW = Math.max(480, Math.round((scr?.availWidth ?? 1440) * 0.6))
  const maxH = Math.max(480, Math.round((scr?.availHeight ?? 900) * 0.8))
  let w: number, h: number
  if (opts.portrait) {
    h = maxH
    w = Math.round((h * 9) / 16)
  } else {
    w = maxW
    h = Math.round((w * 9) / 16)
    if (h > maxH) {
      h = maxH
      w = Math.round((h * 16) / 9)
    }
  }
  return window.open(viewerUrl(), 'projmap-viewer', `popup=yes,width=${w},height=${h}`)
}

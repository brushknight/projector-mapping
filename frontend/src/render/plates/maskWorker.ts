/// <reference lib="webworker" />
/**
 * (§16 plate masks) Fetches and decodes plate mask PNGs off the main thread. Message in: `{ id, url }`; out:
 * `{ id, size, data }` (data transferred) or `{ id, error }`.
 */
import { decodeGrayPng } from './maskDecode'

self.onmessage = async (e: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = e.data
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const m = await decodeGrayPng(new Uint8Array(await res.arrayBuffer()))
    ;(self as unknown as Worker).postMessage({ id, size: m.size, data: m.data }, [m.data.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}

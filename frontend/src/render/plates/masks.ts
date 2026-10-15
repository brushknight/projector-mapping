/**
 * (§16 plate masks) The pre-rendered plate masks, shared by every renderer on the page. `npm run masks` writes each
 * plate's mask as a one-channel PNG at 1024, 2048 and 4096 px; the server serves them at
 * `/catalog/assets/masks/<id>-<size>.png` (immutable; the `v` query is a hash of the files). A worker fetches and
 * decodes them off the main thread; renderers upload the bytes as an R8 texture. Plates without a file (and windows
 * reshaped away from their preset) use the vector path (index.ts).
 */
import { decodeGrayPng, type MaskData } from './maskDecode'
import { MASK_INDEX } from './maskIndex'

export type { MaskData } from './maskDecode'

/** The mask sizes on the server, smallest first. */
export const MASK_TIERS = [1024, 2048, 4096] as const

/** Decoded bytes kept for every renderer of the page (about four 4096 masks); GPU textures live in each renderer. */
const DECODED_BUDGET = 72 * 1024 * 1024

/** True when the plate has a pre-rendered mask of `size`. */
export function hasMask(id: string, size: number): boolean {
  return !!MASK_INDEX[id]?.sizes.includes(size)
}

/** The URL of a plate's mask of `size`, or null when there is none. */
export function maskUrl(id: string, size: number, base = ''): string | null {
  const e = MASK_INDEX[id]
  if (!e || !e.sizes.includes(size)) return null
  return `${base}/catalog/assets/masks/${id}-${size}.png?v=${e.v}`
}

type Job = { resolve: (m: MaskData | null) => void }

/** The page's mask cache: decoded masks (LRU by bytes), loads in flight and failures. */
export class MaskStore {
  private decoded = new Map<string, MaskData>()
  private bytes = 0
  private pending = new Map<string, Promise<MaskData | null>>()
  private failed = new Set<string>()
  private worker: Worker | null | undefined
  private jobs = new Map<number, Job>()
  private nextJob = 1
  /** called with (id, size) whenever a mask has decoded, so renderers draw again */
  private listeners = new Set<(id: string, size: number) => void>()
  /** URL prefix (tests and offscreen hosts) */
  base = ''

  /** the mask sizes the page's renderers draw (each renderer registers its own), for prefetches */
  private sizes = new Map<number, number>()
  useTier(size: number): () => void {
    this.sizes.set(size, (this.sizes.get(size) ?? 0) + 1)
    this.ensureWorker()
    return () => {
      const n = (this.sizes.get(size) ?? 1) - 1
      if (n > 0) this.sizes.set(size, n)
      else this.sizes.delete(size)
    }
  }
  tiers(): number[] {
    return [...this.sizes.keys()].filter((s) => (MASK_TIERS as readonly number[]).includes(s))
  }

  subscribe(fn: (id: string, size: number) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** The decoded mask when it is here (and marks it recently used). */
  get(id: string, size: number): MaskData | undefined {
    const k = `${id}@${size}`
    const m = this.decoded.get(k)
    if (m) {
      this.decoded.delete(k)
      this.decoded.set(k, m)
    }
    return m
  }

  /** True when loading this mask failed (the renderer draws the vector path instead). */
  didFail(id: string, size: number): boolean {
    return this.failed.has(`${id}@${size}`)
  }

  isLoading(id: string, size: number): boolean {
    return this.pending.has(`${id}@${size}`)
  }

  /** Fetches and decodes a mask (once; later calls share the load). Null when there is none or it failed. */
  load(id: string, size: number): Promise<MaskData | null> {
    const k = `${id}@${size}`
    const have = this.decoded.get(k)
    if (have) return Promise.resolve(have)
    const p = this.pending.get(k)
    if (p) return p
    const url = maskUrl(id, size, this.base)
    if (!url || this.failed.has(k)) return Promise.resolve(null)
    const promise = this.decode(url).then(
      (m) => {
        this.pending.delete(k)
        if (!m || m.size !== size) {
          this.failed.add(k)
          return null
        }
        this.keep(k, m)
        for (const fn of this.listeners) fn(id, size)
        return m
      },
      () => {
        this.pending.delete(k)
        this.failed.add(k)
        return null
      },
    )
    this.pending.set(k, promise)
    return promise
  }

  /** Warms the HTTP cache with a mask's file without decoding it (cheap; for tiles scrolled into view). */
  warm(id: string, size: number) {
    const url = maskUrl(id, size, this.base)
    if (!url || typeof fetch === 'undefined' || this.warmed.has(url)) return
    this.warmed.add(url)
    fetch(url, { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).catch(() => this.warmed.delete(url))
  }
  private warmed = new Set<string>()

  private keep(k: string, m: MaskData) {
    this.decoded.set(k, m)
    this.bytes += m.data.byteLength
    for (const [key, v] of this.decoded) {
      if (this.bytes <= DECODED_BUDGET || key === k) break
      this.decoded.delete(key)
      this.bytes -= v.data.byteLength
    }
  }

  private decode(url: string): Promise<MaskData | null> {
    const w = this.ensureWorker()
    if (!w) return this.decodeHere(url)
    const id = this.nextJob++
    const viaWorker = new Promise<MaskData | null>((resolve) => this.jobs.set(id, { resolve }))
    w.postMessage({ id, url })
    // the worker answers null when it failed: try once more on the main thread
    return viaWorker.then((m) => m ?? this.decodeHere(url)).finally(() => this.jobs.delete(id))
  }

  private async decodeHere(url: string): Promise<MaskData | null> {
    if (typeof fetch === 'undefined' || typeof DecompressionStream === 'undefined') return null
    const res = await fetch(url)
    if (!res.ok) return null
    return decodeGrayPng(new Uint8Array(await res.arrayBuffer()))
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker
    try {
      if (typeof Worker === 'undefined' || typeof DecompressionStream === 'undefined') throw new Error('no worker')
      const w = new Worker(new URL('./maskWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ id: number; size?: number; data?: Uint8Array; error?: string }>) => {
        const job = this.jobs.get(e.data.id)
        if (!job) return
        job.resolve(e.data.data && e.data.size ? { size: e.data.size, data: e.data.data } : null)
      }
      w.onerror = () => {
        // a worker that cannot start (a strict CSP, an old WebView): decode on the main thread from now on
        this.worker = null
        for (const j of this.jobs.values()) j.resolve(null)
      }
      this.worker = w
    } catch {
      this.worker = null
    }
    return this.worker
  }
}

/** The page's one mask store (also `window.__projmapMasks`, for tests and the console). */
export const maskStore = new MaskStore()
if (typeof globalThis !== 'undefined') (globalThis as unknown as { __projmapMasks?: MaskStore }).__projmapMasks = maskStore

/**
 * Warms the HTTP cache with every plate's mask of `size` at idle, a few at a time (a page that will draw plates at
 * that size: /out at 4096, /preview at 1024). Returns a cancel function.
 */
export function warmPlateMasks(size: number): () => void {
  let cancelled = false
  const ids = Object.keys(MASK_INDEX).filter((id) => hasMask(id, size))
  const idle: (cb: () => void) => void =
    typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 2000 }) : (cb) => setTimeout(cb, 200)
  const next = () => {
    if (cancelled) return
    for (const id of ids.splice(0, 4)) maskStore.warm(id, size)
    if (ids.length) idle(next)
  }
  idle(next)
  return () => {
    cancelled = true
  }
}

/** (§16 masks) Prefetches one plate's masks for the tiers this page draws (a tile hovered or scrolled into view). */
export function prefetchPlate(id: string, decode = false) {
  for (const size of maskStore.tiers()) {
    if (decode) void maskStore.load(id, size)
    else maskStore.warm(id, size)
  }
}

/**
 * Opt-in playback diagnostics (protocol §4 output.diag): a bounded ring of events from the renderer and the page that
 * hosts it, for finding skipped frames and flashes on the wall without per-frame console output. Off by default; on
 * with `?diag` in the page URL, `localStorage['pm:diag'] = '1'`, or the output.diag RPC (MCP output_status).
 *
 * Counters always run (they cost nothing); events are only kept while it is on.
 */

export interface DiagEvent {
  /** performance.now() ms */
  at: number
  kind: string
  [k: string]: unknown
}

const CAP = 4000

class Diag {
  on = false
  private ring: DiagEvent[] = []
  private head = 0
  /** totals since load (or the last clear), whether the ring is on or not */
  counts: Record<string, number> = {}
  /** the newest event per kind, kept even while off, for the status summary */
  lastOf: Record<string, DiagEvent> = {}

  constructor() {
    try {
      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
      this.on = !!q?.has('diag') || (typeof localStorage !== 'undefined' && localStorage.getItem('pm:diag') === '1')
    } catch {
      this.on = false
    }
  }

  /** Counts an event, and records it while diagnostics are on. */
  log(kind: string, data?: Record<string, unknown>) {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1
    const e: DiagEvent = { at: Math.round(performance.now() * 10) / 10, kind, ...data }
    this.lastOf[kind] = e
    if (!this.on) return
    if (this.ring.length < CAP) this.ring.push(e)
    else {
      this.ring[this.head] = e
      this.head = (this.head + 1) % CAP
    }
  }

  setOn(on: boolean) {
    this.on = on
    try {
      if (on) localStorage.setItem('pm:diag', '1')
      else localStorage.removeItem('pm:diag')
    } catch {
      /* private mode */
    }
  }

  clear() {
    this.ring = []
    this.head = 0
    this.counts = {}
    this.lastOf = {}
  }

  /** The recorded events, oldest first; `last` keeps only the newest n, `kinds` only those kinds. */
  events(last = 500, kinds?: readonly string[]): DiagEvent[] {
    const all = this.ring.length < CAP ? this.ring.slice() : [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)]
    const f = kinds?.length ? all.filter((e) => kinds.includes(e.kind)) : all
    return f.slice(-Math.max(1, last))
  }
}

export const diag = new Diag()

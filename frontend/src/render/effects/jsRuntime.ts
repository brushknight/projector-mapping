/**
 * JS effects (docs/effects.md): a module whose default export draws one frame onto an OffscreenCanvas 2D context.
 * They run in one module worker, loaded from a Blob URL with no DOM and no network helpers. A call should stay under
 * the 4 ms budget; an effect over it for OVER_LIMIT frames in a row is disabled and reported (one slow frame, a GC
 * pause on a busy laptop, never takes a show down).
 *
 * The engine asks for a frame per instance (a surface's always-on effect or one clip on one surface) and composites
 * the newest bitmap that still belongs to it (one frame latency live). Every request carries a sequence number, and a
 * reply only counts when it answers the instance's current request with the instance's current source: a reply that
 * arrives after a seek, a source update or the clip's end is dropped, never shown. A bitmap is only shown for the time
 * it was drawn for (MAX_BEHIND, MAX_AHEAD), so a seek never flashes the picture of another moment; an instance
 * the engine stopped asking for (its clip ended) is forgotten at the next frame, so a clip that comes back starts clean.
 */
import { diag } from '../diag'

/** frames over the budget in a row before an effect is disabled */
const OVER_LIMIT = 30
/** ms of one call */
const BUDGET_MS = 4
/** a request without an answer for this long means the worker is stuck (an endless loop): it is restarted */
const STUCK_MS = 1500
/**
 * A bitmap drawn for an earlier moment than asked (playback runs a frame ahead of the worker, or a stall) is shown up to
 * MAX_BEHIND seconds behind; one drawn for a later moment (a seek back, a loop to the start) only within MAX_AHEAD.
 */
const MAX_BEHIND = 1
const MAX_AHEAD = 0.05

const WORKER_SRC = `
const mods = new Map();      // key -> { fn, overs, disabled }
const loading = new Map();   // key -> promise of the import, so early frames wait for it
const canvases = new Map();  // inst -> OffscreenCanvas
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'drop') { canvases.delete(m.inst); return; }
  if (m.type === 'load') {
    let done;
    loading.set(m.key, new Promise((r) => (done = r)));
    try {
      const url = URL.createObjectURL(new Blob([m.source], { type: 'text/javascript' }));
      const mod = await import(url);
      URL.revokeObjectURL(url);
      if (typeof mod.default !== 'function') throw new Error('the module has no default export function');
      mods.set(m.key, { fn: mod.default, overs: 0, disabled: false });
      self.postMessage({ type: 'loaded', key: m.key });
    } catch (err) {
      self.postMessage({ type: 'error', key: m.key, message: String(err && err.message || err) });
    }
    done();
    return;
  }
  if (m.type === 'frame') {
    if (loading.has(m.key)) await loading.get(m.key);
    const mod = mods.get(m.key);
    if (!mod || mod.disabled) { self.postMessage({ type: 'skip', key: m.key, inst: m.inst, req: m.req }); return; }
    let cv = canvases.get(m.inst);
    if (!cv || cv.width !== m.width || cv.height !== m.height) { cv = new OffscreenCanvas(m.width, m.height); canvases.set(m.inst, cv); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, m.width, m.height);
    const t0 = performance.now();
    try {
      mod.fn(ctx, { t: m.t, progress: m.progress, width: m.width, height: m.height, aspect: m.aspect, seed: m.seed, params: m.params });
    } catch (err) {
      mod.disabled = true;
      self.postMessage({ type: 'error', key: m.key, inst: m.inst, req: m.req, message: String(err && err.message || err) });
      return;
    }
    const dt = performance.now() - t0;
    mod.overs = dt > ${BUDGET_MS} ? mod.overs + 1 : 0;
    if (mod.overs >= ${OVER_LIMIT}) {
      mod.disabled = true;
      self.postMessage({ type: 'error', key: m.key, inst: m.inst, req: m.req, message: 'over the ${BUDGET_MS} ms frame budget ${OVER_LIMIT} frames in a row; disabled' });
      return;
    }
    const bmp = cv.transferToImageBitmap();
    self.postMessage({ type: 'frame', key: m.key, inst: m.inst, bitmap: bmp, req: m.req, ms: dt }, [bmp]);
  }
};
`

export interface JsFrameRequest {
  key: string
  source: string
  inst: string
  t: number
  progress: number
  width: number
  height: number
  aspect: number
  seed: number
  params: Record<string, unknown>
}

interface Shown {
  bitmap: ImageBitmap
  req: number
  key: string
  t: number
}

interface Inst {
  key: string
  /** the request waiting for its answer */
  inflight: { req: number; t: number; key: string; sentAt: number } | null
  /** the newest valid bitmap */
  shown: Shown | null
  /** the time of the newest request, for waitFor */
  wantT: number
  /** the frame (beginFrame count) that last asked for this instance */
  frame: number
}

type Reply = { type: string; key: string; inst?: string; req?: number; bitmap?: ImageBitmap; message?: string; ms?: number }

export class JsEffects {
  private worker: Worker | null = null
  private loaded = new Map<string, 'loading' | 'ok' | 'error'>()
  private insts = new Map<string, Inst>()
  private waiters: Array<() => void> = []
  private failed = new Map<string, string>()
  onError: ((key: string, message: string) => void) | null = null
  onFrame: (() => void) | null = null
  private req = 0
  private frame = 0
  /** totals for the status report */
  stats = { requested: 0, shown: 0, stale: 0, wrongSource: 0, skewed: 0, expired: 0, skipped: 0, stuck: 0, maxMs: 0, lastMs: 0 }

  private ensure(): Worker | null {
    if (this.worker) return this.worker
    if (typeof Worker === 'undefined') return null
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    this.worker = new Worker(url, { type: 'module' })
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data as Reply)
    this.loaded.clear()
    return this.worker
  }

  private onMessage(m: Reply) {
    const st = m.inst ? this.insts.get(m.inst) : undefined
    // the request this reply answers is done, whatever it says
    const current = !!st && !!st.inflight && st.inflight.req === m.req
    if (current) st!.inflight = null
    if (m.type === 'loaded') this.loaded.set(m.key, 'ok')
    if (m.type === 'error') {
      this.loaded.set(m.key, 'error')
      this.failed.set(m.key, m.message ?? 'failed')
      diag.log('js.disabled', { key: m.key, inst: m.inst, reason: m.message })
      this.onError?.(m.key, m.message ?? 'failed')
    }
    if (m.type === 'skip') this.stats.skipped++
    if (m.type === 'frame' && m.inst && m.bitmap) {
      this.stats.lastMs = m.ms ?? 0
      this.stats.maxMs = Math.max(this.stats.maxMs, m.ms ?? 0)
      if (!st || !current) {
        // an answer to an older request (after a seek, a restart, or a clip that ended): never shown
        this.stats.stale++
        diag.log('js.drop', { inst: m.inst, req: m.req, reason: st ? 'stale' : 'expired' })
        m.bitmap.close()
      } else if (m.key !== st.key) {
        this.stats.wrongSource++
        diag.log('js.drop', { inst: m.inst, req: m.req, reason: 'source' })
        m.bitmap.close()
      } else {
        const t = this.sentT.get(m.req!) ?? st.wantT
        st.shown?.bitmap.close()
        st.shown = { bitmap: m.bitmap, req: m.req!, key: m.key, t }
        diag.log('js.frame', { inst: m.inst, req: m.req, t: round(t), ms: round(m.ms ?? 0) })
        this.onFrame?.()
      }
    }
    if (m.req) this.sentT.delete(m.req)
    const w = this.waiters
    this.waiters = []
    for (const fn of w) fn()
  }

  /** the t each in-flight request was sent for */
  private sentT = new Map<number, number>()

  /**
   * Starts a rendered frame: instances nobody asked for during the frame before (their clip ended, their surface left)
   * are forgotten, so their last picture can never come back on screen.
   */
  beginFrame() {
    for (const [inst, st] of this.insts) {
      if (st.frame >= this.frame) continue
      st.shown?.bitmap.close()
      this.insts.delete(inst)
      this.stats.expired++
      this.worker?.postMessage({ type: 'drop', inst })
    }
    this.frame++
  }

  /** Asks for a new frame if none is in flight; returns the newest bitmap that belongs to this request, or null. */
  request(r: JsFrameRequest): ImageBitmap | null {
    if (this.failed.has(r.key)) return null
    let w = this.ensure()
    if (!w) return null
    let st = this.insts.get(r.inst)
    if (!st) this.insts.set(r.inst, (st = { key: r.key, inflight: null, shown: null, wantT: r.t, frame: this.frame }))
    st.frame = this.frame
    st.wantT = r.t
    if (st.key !== r.key) {
      // a new source: the old one's picture is obsolete
      diag.log('js.source', { inst: r.inst, from: st.key, to: r.key })
      st.key = r.key
      st.shown?.bitmap.close()
      st.shown = null
    }
    const now = performance.now()
    if (st.inflight && now - st.inflight.sentAt > STUCK_MS) {
      // the worker has not answered: an endless loop in an effect, or a lost message. Restart it without that effect.
      this.stats.stuck++
      const key = st.inflight.key
      diag.log('js.stuck', { inst: r.inst, key, req: st.inflight.req, waitedMs: Math.round(now - st.inflight.sentAt) })
      this.restart()
      this.failed.set(key, `did not answer within ${STUCK_MS} ms; disabled`)
      this.onError?.(key, `did not answer within ${STUCK_MS} ms; disabled`)
      if (key === r.key) return null
      w = this.ensure()
      if (!w) return null
    }
    if (!this.loaded.has(r.key)) {
      this.loaded.set(r.key, 'loading')
      w.postMessage({ type: 'load', key: r.key, source: r.source })
    }
    if (!st.inflight) {
      const req = ++this.req
      st.inflight = { req, t: r.t, key: r.key, sentAt: now }
      this.sentT.set(req, r.t)
      this.stats.requested++
      w.postMessage({ type: 'frame', key: r.key, inst: r.inst, t: r.t, progress: r.progress, width: r.width, height: r.height, aspect: r.aspect, seed: r.seed, params: r.params, req })
    }
    const s = st.shown
    if (!s) return null
    if (r.t - s.t > MAX_BEHIND || s.t - r.t > MAX_AHEAD) {
      // drawn for another moment (before a seek or a loop back): wait for the frame of this one
      this.stats.skewed++
      diag.log('js.wait', { inst: r.inst, reason: 'skew', shownT: round(s.t), t: round(r.t) })
      return null
    }
    this.stats.shown++
    return s.bitmap
  }

  private restart() {
    this.worker?.terminate()
    this.worker = null
    this.loaded.clear()
    this.sentT.clear()
    for (const st of this.insts.values()) st.inflight = null
  }

  has(inst: string): boolean {
    return !!this.insts.get(inst)?.shown
  }

  isFailed(key: string): boolean {
    return this.failed.has(key)
  }

  /** Why effects were disabled, by key. */
  failures(): Record<string, string> {
    return Object.fromEntries(this.failed)
  }

  /** In-flight requests right now. */
  inflight(): number {
    let n = 0
    for (const st of this.insts.values()) if (st.inflight) n++
    return n
  }

  /** Resolves once every instance has its frame for the time last asked (or its effect failed), or after timeoutMs. */
  async waitFor(insts: Array<{ inst: string; key: string }>, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const done = () =>
      insts.every((i) => {
        if (this.failed.has(i.key)) return true
        const st = this.insts.get(i.inst)
        return !!st?.shown && st.shown.key === i.key && st.shown.t === st.wantT
      })
    while (!done() && Date.now() < deadline) {
      await new Promise<void>((res) => {
        this.waiters.push(res)
        setTimeout(res, 50)
      })
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const st of this.insts.values()) st.shown?.bitmap.close()
    this.insts.clear()
    this.sentT.clear()
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

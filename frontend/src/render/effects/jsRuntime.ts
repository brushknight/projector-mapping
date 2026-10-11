/**
 * JS effects (docs/effects.md): a module whose default export draws one frame onto an OffscreenCanvas 2D context.
 * They run in one module worker, loaded from a Blob URL with no DOM and no network helpers; each call has a 4 ms
 * budget, and an effect over budget three frames in a row is disabled and reported.
 *
 * The engine asks for a frame per instance and composites the newest ImageBitmap it has (one frame latency live).
 */

const WORKER_SRC = `
const mods = new Map();      // key -> { fn, overs, disabled }
const loading = new Map();   // key -> promise of the import, so early frames wait for it
const canvases = new Map();  // inst -> OffscreenCanvas
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
self.onmessage = async (e) => {
  const m = e.data;
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
    if (!mod || mod.disabled) { self.postMessage({ type: 'skip', key: m.key, inst: m.inst }); return; }
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
      self.postMessage({ type: 'error', key: m.key, message: String(err && err.message || err) });
      return;
    }
    const dt = performance.now() - t0;
    mod.overs = dt > 4 ? mod.overs + 1 : 0;
    if (mod.overs >= 3) {
      mod.disabled = true;
      self.postMessage({ type: 'error', key: m.key, message: 'over the 4 ms frame budget three frames in a row; disabled' });
      return;
    }
    const bmp = cv.transferToImageBitmap();
    self.postMessage({ type: 'frame', key: m.key, inst: m.inst, bitmap: bmp, req: m.req }, [bmp]);
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

export class JsEffects {
  private worker: Worker | null = null
  private loaded = new Map<string, 'loading' | 'ok' | 'error'>()
  private inflight = new Set<string>()
  private latest = new Map<string, ImageBitmap>()
  private waiters: Array<() => void> = []
  private failed = new Set<string>()
  onError: ((key: string, message: string) => void) | null = null
  onFrame: (() => void) | null = null
  private req = 0

  private ensure(): Worker | null {
    if (this.worker) return this.worker
    if (typeof Worker === 'undefined') return null
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    this.worker = new Worker(url, { type: 'module' })
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data)
    return this.worker
  }

  private onMessage(m: { type: string; key: string; inst?: string; bitmap?: ImageBitmap; message?: string }) {
    if (m.type === 'loaded') this.loaded.set(m.key, 'ok')
    if (m.type === 'error') {
      this.loaded.set(m.key, 'error')
      this.failed.add(m.key)
      for (const k of [...this.inflight]) if (k.startsWith(m.key + '|')) this.inflight.delete(k)
      this.onError?.(m.key, m.message ?? 'failed')
    }
    if (m.type === 'frame' && m.inst && m.bitmap) {
      this.inflight.delete(m.inst)
      this.latest.get(m.inst)?.close()
      this.latest.set(m.inst, m.bitmap)
      this.onFrame?.()
    }
    if (m.type === 'skip' && m.inst) this.inflight.delete(m.inst)
    const w = this.waiters
    this.waiters = []
    for (const fn of w) fn()
  }

  /** Asks for a new frame if none is in flight; returns the newest bitmap (maybe from an earlier frame). */
  request(r: JsFrameRequest): ImageBitmap | null {
    if (this.failed.has(r.key)) return null
    const w = this.ensure()
    if (!w) return null
    if (!this.loaded.has(r.key)) {
      this.loaded.set(r.key, 'loading')
      w.postMessage({ type: 'load', key: r.key, source: r.source })
    }
    if (!this.inflight.has(r.inst)) {
      this.inflight.add(r.inst)
      w.postMessage({ type: 'frame', key: r.key, inst: r.inst, t: r.t, progress: r.progress, width: r.width, height: r.height, aspect: r.aspect, seed: r.seed, params: r.params, req: ++this.req })
    }
    return this.latest.get(r.inst) ?? null
  }

  has(inst: string): boolean {
    return this.latest.has(inst)
  }

  isFailed(key: string): boolean {
    return this.failed.has(key)
  }

  /** Resolves once every instance has a frame (or its effect failed), or after timeoutMs. */
  async waitFor(insts: Array<{ inst: string; key: string }>, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const done = () => insts.every((i) => this.latest.has(i.inst) || this.failed.has(i.key))
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
    for (const b of this.latest.values()) b.close()
    this.latest.clear()
  }
}

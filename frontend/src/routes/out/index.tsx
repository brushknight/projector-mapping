import { useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCatalog } from '../../entities/catalog'
import type { EffectDef } from '../../entities/effect'
import { effectApi } from '../../entities/effect'
import { FrameMeter, renderFrameRpc, type RenderFrameArgs } from '../../entities/output'
import { PairingScreen } from '../../entities/pairing'
import { ambientClock, playheadNow, useBlackout, useLiveDocs, type Show } from '../../entities/show'
import { activeTestPattern } from '../../entities/setup'
import type { Draft } from '../../entities/draft'
import { applyPatch } from '../../shared/lib/jsonPatch'
import { Renderer, type OutlineFlash, type OutputPattern } from '../../render'
import { setAuthToken } from '../../shared/lib/http'
import { useChannel, useHubStatus, useOwnHub } from '../../shared/lib/useHub'
import { useRaf } from '../../shared/lib/useRaf'
import { Hub } from '../../shared/lib/ws'
import s from './styles.module.css'

const SPLASH_MS = 8000

/**
 * The projector output: a fullscreen canvas at device pixels, role `output`. Shows the pairing screen while
 * disconnected, while no scene is active, and for a few seconds after load (skip with ?headless or a click).
 */
export function OutPage() {
  const { headless, token } = useSearch({ from: '/out' })
  // localhost is trusted; a mini PC by the projector passes its device token as ?token=
  const hub = useOwnHub(() => {
    if (token) setAuthToken(token)
    return new Hub({ role: 'output', name: 'projector output', caps: ['render'], token: token ?? null })
  })
  const status = useHubStatus(hub)
  // an agent's draft previewed on the wall (backend §9 show.preview) replaces the live scene while it lasts
  const previewId = useChannel<Show>(hub, 'show').doc?.preview?.draftId ?? null
  const previewDraft = useChannel<Draft>(hub, previewId ? `draft:${previewId}` : null).doc
  const live = useLiveDocs(hub, previewDraft?.sceneId ?? null)
  const { show, setup } = live
  const scene = useMemo(() => {
    if (!live.scene || !previewDraft || !previewId) return live.scene
    try {
      return applyPatch(live.scene, previewDraft.ops)
    } catch {
      return live.scene
    }
  }, [live.scene, previewDraft, previewId])
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  const [effects, setEffects] = useState<EffectDef[]>([])
  const [splash, setSplash] = useState(!headless)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const pattern = useRef<OutputPattern | null>(null)
  const outline = useRef<(OutlineFlash & { until: number }) | null>(null)
  const waiters = useRef<Array<{ frames: number; done: () => void }>>([])
  const meter = useRef(new FrameMeter())
  const blackout = useBlackout(show?.onAir, setup?.blackoutFadeMs)
  const [glError, setGlError] = useState<string | null>(null)
  const [patternOn, setPatternOn] = useState(false)
  const latest = useRef({ show, scene, setup, catalog, effects })
  latest.current = { show, scene, setup, catalog, effects }

  // the WebGL2 renderer, sized to the device pixels of the window
  useEffect(() => {
    const canvas = canvasRef.current!
    try {
      renderer.current = new Renderer(canvas, { space: 'physical', preserveDrawingBuffer: true })
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
      return
    }
    const size = () => {
      const dpr = window.devicePixelRatio || 1
      renderer.current?.setSize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr))
    }
    size()
    window.addEventListener('resize', size)
    return () => {
      window.removeEventListener('resize', size)
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])

  // user and agent effects
  useEffect(() => {
    if (status !== 'open') return
    effectApi.list().then(setEffects, () => {})
  }, [status, scene?.id, scene?.version])

  useEffect(() => {
    if (!splash) return
    const t = setTimeout(() => setSplash(false), SPLASH_MS)
    return () => clearTimeout(t)
  }, [splash])

  // server → output RPCs
  useEffect(() => {
    const afterFrames = (n: number) => new Promise<void>((done) => waiters.current.push({ frames: n, done }))
    const offs = [
      hub.handleRpc('output.pattern', async (args) => {
        const kind = String(args.kind)
        if (kind === 'off') pattern.current = null
        else if (kind === 'gray') pattern.current = { kind: 'gray', axis: args.axis === 'y' ? 'y' : 'x', bit: Number(args.bit) | 0, inverse: !!args.inverse }
        else if (kind === 'white' || kind === 'black') pattern.current = { kind }
        else throw new Error(`Unknown pattern ${kind}.`)
        setPatternOn(!!pattern.current)
        await afterFrames(3)
        const r = renderer.current
        return { presented: true, width: r?.canvas.width ?? 0, height: r?.canvas.height ?? 0 }
      }),
      hub.handleRpc('output.outline', async (args) => {
        const ms = Number(args.ms ?? 1500)
        outline.current = {
          surfaceIds: Array.isArray(args.surfaceIds) ? (args.surfaceIds as string[]) : [],
          color: typeof args.color === 'string' ? args.color : '#ffffff',
          width: Number(args.width ?? 2),
          until: performance.now() + ms,
        }
        await afterFrames(1)
        return { presented: true }
      }),
      hub.handleRpc('render.frame', (args) => renderFrameRpc(args as unknown as RenderFrameArgs, ambientClock(hub))),
    ]
    return () => offs.forEach((f) => f())
  }, [hub])

  // telemetry every 2 s
  useEffect(() => {
    const id = setInterval(() => {
      const r = renderer.current
      const { fps, dropped } = meter.current.take(2)
      hub.telemetry({ fps, dropped, width: r?.canvas.width ?? 0, height: r?.canvas.height ?? 0, refresh: meter.current.refresh() })
    }, 2000)
    return () => clearInterval(id)
  }, [hub])

  // keep the screen awake
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const get = () => {
      if (document.visibilityState === 'visible' && nav.wakeLock) nav.wakeLock.request('screen').then((l) => (lock = l), () => {})
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      document.removeEventListener('visibilitychange', get)
      lock?.release().catch(() => {})
    }
  }, [])

  useRaf((now) => {
    const r = renderer.current
    meter.current.tick(now)
    const L = latest.current
    if (r && L.setup) {
      if (outline.current && outline.current.until < now) outline.current = null
      r.render({
        setup: L.setup,
        scene: L.scene,
        catalog: L.catalog,
        effects: L.effects,
        t: playheadNow(hub, L.show),
        clock: ambientClock(hub),
        blackout: blackout.step(now),
        pattern: pattern.current,
        outline: outline.current,
        testPattern: activeTestPattern(L.setup, hub.serverNow()),
        // an agent previews its mapping: show the objects whatever mode the scene has on air
        mode: L.show?.preview?.draftId ? 'objects' : null,
      })
    } else if (r && pattern.current) {
      // calibration still works before a setup arrives
      r.render({
        setup: { id: '', name: '', output: { width: r.canvas.width, height: r.canvas.height, orientation: 'landscape', flipH: false, flipV: false }, master: 1, blackoutFadeMs: 0, testPattern: 'off', referenceAsset: null, calibrationId: null },
        scene: null,
        catalog: null,
        t: 0,
        clock: 0,
        blackout: 1,
        pattern: pattern.current,
      })
    }
    // frames are presented on the next vsync; count them down for the RPCs that wait
    if (waiters.current.length) {
      waiters.current = waiters.current.filter((w) => {
        w.frames--
        if (w.frames <= 0) {
          w.done()
          return false
        }
        return true
      })
    }
  })

  const idle = status !== 'open' || !show?.activeSceneId || !scene
  const showPairing = !patternOn && (idle || splash) && !headless
  return (
    <div className={s.out} onClick={() => setSplash(false)} data-testid="out">
      <canvas ref={canvasRef} className={s.canvas} data-testid="out-canvas" />
      {showPairing && <PairingScreen connected={status === 'open'} status={show?.activeSceneId ? 'connected · scene ready' : 'connected · no scene yet'} />}
      {glError && <div className={s.error}>This browser can't draw the output: {glError}</div>}
    </div>
  )
}

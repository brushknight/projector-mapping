import { useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTry, useCatalog, withTrialLayer } from '../../entities/catalog'
import { effectApi, type EffectDef } from '../../entities/effect'
import { activeTestPattern, sceneSize } from '../../entities/setup'
import { ambientClock, playheadNow, useBlackout, useLiveDocs, activeSolo } from '../../entities/show'
import { YouTubeBackdrop } from '../../entities/video/youtube'
import { activeYouTube, Renderer, warmPlateMasks } from '../../render'
import { setAuthToken } from '../../shared/lib/http'
import { useOwnHub } from '../../shared/lib/useHub'
import { useReloadOnNewBuild } from '../../shared/lib/reloadOnNewBuild'
import { useRaf } from '../../shared/lib/useRaf'
import { Hub } from '../../shared/lib/ws'
import s from './styles.module.css'

/**
 * The chrome-less preview for the iPhone's WKWebView (protocol §6): the active scene (hero) or one backdrop layer
 * (mode=layer&layer=<id>), read only, at most 30 fps, rendered at `w` px wide (default 640) but (§16 masks) never more than
 * PREVIEW_MAX px: a light renderer (small plate masks, focus blurs at reduced resolution) that the web view scales up,
 * and that does no work while the page is hidden. The hero draws the scene's
 * on-air mode and the active test pattern exactly like /out, and a YouTube video layer in a player behind the canvas
 * (§14). It never plays sound (no cap `audio`). (§16) `try=<procedural id>` draws the scene in live mode with that
 * live layer on top (the live gallery's "try"), locally: nothing goes on air.
 */
/** (§16 masks) the widest the preview renders (the phone's hero is about 1000 device px wide and scales it up) */
export const PREVIEW_MAX = 720

export function PreviewPage() {
  const { token, w, mode, layer, scene: sceneParam, try: tryParam } = useSearch({ from: '/preview' })
  const [hub] = useState(() => {
    if (token) setAuthToken(token)
    return new Hub({ role: 'remote', name: 'preview', token: token ?? null })
  })
  useOwnHub(() => hub)
  useReloadOnNewBuild(hub)
  // (§15) scene=<id> follows that scene (its own mode) without putting it on air: the quick and long-press previews
  const { show, scene: liveScene, setup } = useLiveDocs(hub, sceneParam ?? null)
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  // (§16 masks) the phone switches the trial layer in place (window.projmapPreview.set) instead of loading a new URL
  const [tryOverride, setTryOverride] = useState<{ value: string | null } | null>(null)
  useEffect(() => {
    const w = window as unknown as { projmapPreview?: { set(p: { try?: string | null }): boolean } }
    w.projmapPreview = {
      set: (p) => {
        if ('try' in p) setTryOverride({ value: p.try ?? null })
        return true
      },
    }
    return () => {
      delete w.projmapPreview
    }
  }, [])
  const trying = parseTry(tryOverride ? tryOverride.value ?? undefined : tryParam)
  const scene = useMemo(() => (liveScene && trying && catalog ? withTrialLayer(liveScene, catalog, trying) : liveScene), [liveScene, trying, catalog])
  const [effects, setEffects] = useState<EffectDef[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const blackout = useBlackout(show?.onAir, setup?.blackoutFadeMs)
  const width = Math.max(64, Math.min(PREVIEW_MAX, Number(w) || 640))
  const layerMode = mode === 'layer'

  useEffect(() => {
    try {
      renderer.current = new Renderer(canvasRef.current!, { space: 'scene', maxSceneSize: width, preserveDrawingBuffer: true, transparent: true, preview: true, hold: true })
    } catch {
      renderer.current = null
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [width])

  // (§16 masks) warm the small plate masks at idle, so a pick decodes from memory
  useEffect(() => warmPlateMasks(1024), [])

  useEffect(() => {
    if (layerMode) return
    effectApi.list().then(setEffects, () => {})
    // (§4) an effect was saved: load its new source
    return hub.onMessage('effects.changed', () => void effectApi.list().then(setEffects, () => {}))
  }, [hub, layerMode, scene?.id])

  const announced = useRef(false)

  useRaf(() => {
    const r = renderer.current
    // Draw nothing until the real scene, setup and catalog are here, so the app never sees a default frame first.
    if (!r || !setup || !scene || !catalog) return
    const sz = sceneSize(setup.output)
    r.setSize(width, Math.max(1, Math.round((width * sz.height) / sz.width)))
    const drew = r.render({
      setup,
      scene,
      catalog,
      effects,
      t: playheadNow(hub, show),
      step: sceneParam ? null : show?.transport.step ?? null,
      clock: ambientClock(hub),
      now: hub.serverNow(),
      blackout: layerMode || sceneParam || trying ? 0 : blackout.step(performance.now()),
      layerOnly: layerMode ? layer ?? null : null,
      hideMapping: layerMode,
      // the hero shows exactly what /out shows, test pattern included (expired patterns draw nothing)
      testPattern: layerMode || sceneParam || trying ? 'off' : activeTestPattern(setup, hub.serverNow()),
      solo: layerMode || sceneParam || trying ? null : activeSolo(show, hub.serverNow()),
    })
    if (drew && !announced.current) {
      announced.current = true
      // Tell the iPhone app (WKWebView message handler "projmap") that the first real frame is on screen.
      requestAnimationFrame(() => {
        const w = window as unknown as { webkit?: { messageHandlers?: { projmap?: { postMessage(m: unknown): void } } } }
        w.webkit?.messageHandlers?.projmap?.postMessage({ type: 'ready' })
      })
    }
  }, 30, { pauseHidden: true })

  const aspect = setup ? sceneSize(setup.output) : { width: 16, height: 9 }
  const youtube = activeYouTube(scene, { layerOnly: layerMode ? layer ?? null : null, solo: layerMode ? null : activeSolo(show, hub.serverNow()) })
  return (
    <div className={s.preview}>
      <div className={s.frame} style={{ aspectRatio: `${aspect.width} / ${aspect.height}` }}>
        <YouTubeBackdrop active={youtube} scene={aspect} />
        <canvas ref={canvasRef} className={s.canvas} style={{ aspectRatio: `${aspect.width} / ${aspect.height}` }} data-testid="preview-canvas" />
      </div>
    </div>
  )
}

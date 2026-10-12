import { useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../../entities/catalog'
import { effectApi, type EffectDef } from '../../entities/effect'
import { activeTestPattern, sceneSize } from '../../entities/setup'
import { ambientClock, playheadNow, useBlackout, useLiveDocs, activeSolo } from '../../entities/show'
import { Renderer } from '../../render'
import { setAuthToken } from '../../shared/lib/http'
import { useOwnHub } from '../../shared/lib/useHub'
import { useRaf } from '../../shared/lib/useRaf'
import { Hub } from '../../shared/lib/ws'
import s from './styles.module.css'

/**
 * The chrome-less preview for the iPhone's WKWebView (protocol §6): the active scene (hero) or one backdrop layer
 * (mode=layer&layer=<id>), read only, at most 30 fps, rendered at `w` px wide (default 640). The hero draws the scene's
 * on-air mode and the active test pattern exactly like /out.
 */
export function PreviewPage() {
  const { token, w, mode, layer } = useSearch({ from: '/preview' })
  const [hub] = useState(() => {
    if (token) setAuthToken(token)
    return new Hub({ role: 'remote', name: 'preview', token: token ?? null })
  })
  useOwnHub(() => hub)
  const { show, scene, setup } = useLiveDocs(hub)
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  const [effects, setEffects] = useState<EffectDef[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const blackout = useBlackout(show?.onAir, setup?.blackoutFadeMs)
  const width = Math.max(64, Math.min(2048, Number(w) || 640))
  const layerMode = mode === 'layer'

  useEffect(() => {
    try {
      renderer.current = new Renderer(canvasRef.current!, { space: 'scene', maxSceneSize: Math.max(width, 960), preserveDrawingBuffer: true })
    } catch {
      renderer.current = null
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [width])

  useEffect(() => {
    if (!layerMode) effectApi.list().then(setEffects, () => {})
  }, [layerMode, scene?.id])

  const announced = useRef(false)

  useRaf(() => {
    const r = renderer.current
    // Draw nothing until the real scene, setup and catalog are here, so the app never sees a default frame first.
    if (!r || !setup || !scene || !catalog) return
    const sz = sceneSize(setup.output)
    r.setSize(width, Math.max(1, Math.round((width * sz.height) / sz.width)))
    r.render({
      setup,
      scene,
      catalog,
      effects,
      t: playheadNow(hub, show),
      clock: ambientClock(hub),
      blackout: layerMode ? 0 : blackout.step(performance.now()),
      layerOnly: layerMode ? layer ?? null : null,
      hideMapping: layerMode,
      // the hero shows exactly what /out shows, test pattern included (expired patterns draw nothing)
      testPattern: layerMode ? 'off' : activeTestPattern(setup, hub.serverNow()),
      solo: layerMode ? null : activeSolo(show, hub.serverNow()),
    })
    if (!announced.current) {
      announced.current = true
      // Tell the iPhone app (WKWebView message handler "projmap") that the first real frame is on screen.
      requestAnimationFrame(() => {
        const w = window as unknown as { webkit?: { messageHandlers?: { projmap?: { postMessage(m: unknown): void } } } }
        w.webkit?.messageHandlers?.projmap?.postMessage({ type: 'ready' })
      })
    }
  }, 30)

  const aspect = setup ? sceneSize(setup.output) : { width: 16, height: 9 }
  return (
    <div className={s.preview}>
      <canvas ref={canvasRef} className={s.canvas} style={{ aspectRatio: `${aspect.width} / ${aspect.height}` }} data-testid="preview-canvas" />
    </div>
  )
}

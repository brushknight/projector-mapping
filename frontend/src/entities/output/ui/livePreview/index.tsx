import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activeYouTube, Renderer } from '../../../../render'
import { useRaf } from '../../../../shared/lib/useRaf'
import type { Hub } from '../../../../shared/lib/ws'
import { useCatalog } from '../../../catalog/useCatalog'
import { effectApi } from '../../../effect/api'
import type { EffectDef } from '../../../effect/types'
import { activeSolo, ambientClock, playheadNow, useBlackout } from '../../../show/live'
import { activeTestPattern, sceneSize } from '../../../setup/types'
import { YouTubeBackdrop } from '../../../video/youtube'
import { useWallDocs } from '../../wall'
import s from './styles.module.css'

export interface LivePreviewProps {
  hub: Hub
  /** the canvas's widest size in device pixels (default 1280) */
  maxWidth?: number
  /** frame rate cap (default 30) */
  fps?: number
  /** drawn over the picture (badges, labels); the wrapper is position: relative */
  children?: ReactNode
  className?: string
  'data-testid'?: string
  /** (§14) volume × master for video layers' own sound; absent or 0 keeps every video muted */
  videoVolume?: number
}

/**
 * Exactly what the projector shows, live: the active scene (or an agent's previewed draft) at the wall's clock, in
 * its on-air mode, with blackout, the test pattern, a wall solo and a YouTube backdrop (§14), like /out but in scene
 * space (not turned or flipped for the projector). Fills its parent's width at the scene's aspect. It follows the
 * hub's `show`, scene and setup channels itself; pass the editor's hub.
 *
 *   <LivePreview hub={hub} maxWidth={1600}><Badge /></LivePreview>
 *
 * Test hooks: `data-testid` on the wrapper (default "live-preview"), the canvas is `[data-testid=live-preview-canvas]`,
 * the player `[data-testid=youtube-backdrop]`.
 */
export function LivePreview({ hub, maxWidth = 1280, fps = 30, children, className, 'data-testid': testId = 'live-preview', videoVolume = 0 }: LivePreviewProps) {
  const { show, scene, setup, previewing } = useWallDocs(hub)
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  const [effects, setEffects] = useState<EffectDef[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const r = useRef<Renderer | null>(null)
  const blackout = useBlackout(show?.onAir, setup?.blackoutFadeMs)
  const size = setup ? sceneSize(setup.output) : { width: 1920, height: 1080 }

  useEffect(() => {
    try {
      r.current = new Renderer(canvasRef.current!, { space: 'scene', maxSceneSize: maxWidth, transparent: true })
    } catch {
      r.current = null
    }
    return () => {
      r.current?.dispose()
      r.current = null
    }
  }, [maxWidth])

  useEffect(() => {
    effectApi.list().then(setEffects, () => {})
  }, [scene?.id])

  useRaf(() => {
    const rr = r.current
    const c = canvasRef.current
    if (!rr || !c || !setup) return
    const w = Math.min(maxWidth, Math.round(c.clientWidth * (window.devicePixelRatio || 1)) || 640)
    rr.setSize(w, Math.max(1, Math.round((w * size.height) / size.width)))
    rr.render({
      setup,
      scene,
      catalog,
      effects,
      t: playheadNow(hub, show),
      clock: ambientClock(hub),
      now: hub.serverNow(),
      blackout: blackout.step(performance.now()),
      testPattern: activeTestPattern(setup, hub.serverNow()),
      mode: previewing ? 'objects' : null,
      solo: activeSolo(show, hub.serverNow()),
      videoVolume,
    })
  }, fps)

  const yt = activeYouTube(scene, { mode: previewing ? 'objects' : null, solo: activeSolo(show, hub.serverNow()) })
  return (
    <div className={`${s.view} ${className ?? ''}`} style={{ aspectRatio: `${size.width} / ${size.height}` }} data-testid={testId}>
      <YouTubeBackdrop active={yt} scene={size} />
      <canvas ref={canvasRef} className={s.canvas} data-testid="live-preview-canvas" />
      {children}
    </div>
  )
}

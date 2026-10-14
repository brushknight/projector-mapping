import { useEffect, useRef, type ReactNode } from 'react'
import { activeYouTube, Renderer } from '../../../../render'
import { YouTubeBackdrop } from '../../../video/youtube'
import { Glass } from '../../../../shared/components'
import { useRaf } from '../../../../shared/lib/useRaf'
import { ambientClock, playheadNow } from '../../../show/live'
import { sceneSize } from '../../../setup/types'
import { useEditor } from '../../editor/context'
import { outlineOf } from '../../geometry'
import s from './styles.module.css'

/** A read-only view of the output with the surface outlines (auto map, previews). */
export function OutputView({ label, badge, maxWidth = 1280 }: { label?: ReactNode; badge?: ReactNode; maxWidth?: number }) {
  const ed = useEditor()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const r = useRef<Renderer | null>(null)
  const size = ed.setup ? sceneSize(ed.setup.output) : { width: 1920, height: 1080 }
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
  useRaf(() => {
    const rr = r.current
    const c = canvasRef.current
    if (!rr || !c || !ed.setup) return
    const w = Math.min(maxWidth, Math.round(c.clientWidth * (window.devicePixelRatio || 1)) || 640)
    rr.setSize(w, Math.max(1, Math.round((w * size.height) / size.width)))
    rr.render({ setup: ed.setup, scene: ed.scene, catalog: ed.catalog, effects: ed.userEffects, t: playheadNow(ed.hub, ed.show), clock: ambientClock(ed.hub), blackout: 0 })
  }, 30)
  const pts = new Map((ed.scene?.points ?? []).map((p) => [p.id, p]))
  return (
    <div className={s.view} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      <YouTubeBackdrop active={activeYouTube(ed.scene)} scene={size} />
      <canvas ref={canvasRef} className={s.canvas} />
      <svg className={s.svg} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
        {ed.scene?.objects.flatMap((o) =>
          o.surfaces.map((srf) => {
            const ps = outlineOf(srf.kind, srf.pointIds.map((id) => pts.get(id)).filter((p): p is NonNullable<typeof p> => !!p))
            if (!ps.length) return null
            const sel = srf.id === ed.sel.surfaceId
            const pathD = ps.map((p) => `${p.x},${p.y}`).join(' ')
            return srf.kind === 'line' ? (
              <polyline key={srf.id} points={pathD} className={s.line} />
            ) : (
              <polygon key={srf.id} points={pathD} className={`${s.poly} ${sel ? s.sel : ''} ${srf.role === 'detail' ? s.detail : ''}`} onClick={() => ed.select({ surfaceId: srf.id, objectId: o.id, focus: 'surface' })} />
            )
          }),
        )}
      </svg>
      <div className={s.fbar}>
        {label ? <span className={s.cap}>{label}</span> : <span />}
        {badge && <Glass>{badge}</Glass>}
      </div>
    </div>
  )
}

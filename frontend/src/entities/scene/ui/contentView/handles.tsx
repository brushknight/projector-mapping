import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { photoUrl } from '../../../../render'
import type { ContentLayer } from '../../types'
import s from './styles.module.css'

const aspects = new Map<string, number | 'loading'>()

/** The source aspect of a media layer (loaded once per src), or null until it is known. */
export function useMediaAspect(layer: ContentLayer | null): number | null {
  const src = layer?.kind === 'media' ? layer.src ?? null : null
  const [, bump] = useState(0)
  useEffect(() => {
    if (!src || aspects.has(src)) return
    aspects.set(src, 'loading')
    const url = photoUrl(src)
    const done = (w: number, h: number) => {
      aspects.set(src, w > 0 && h > 0 ? w / h : 1)
      bump((n) => n + 1)
    }
    if (layer?.media === 'video') {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight)
      v.onerror = () => done(1, 1)
      v.src = url
    } else {
      const img = new Image()
      img.onload = () => done(img.naturalWidth, img.naturalHeight)
      img.onerror = () => done(1, 1)
      img.src = url
    }
  }, [src, layer?.media])
  const a = src ? aspects.get(src) : null
  return typeof a === 'number' ? a : null
}

/** The layer's box size in canvas units (protocol §12 fit), before scale. */
export function layerBox(layer: ContentLayer, W: number, H: number, srcAspect: number | null): [number, number] {
  if (layer.kind !== 'media' || !srcAspect) return [W, H]
  const c = layer.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const aS = (srcAspect * c.w) / Math.max(1e-4, c.h)
  const aC = W / H
  if (layer.fit === 'stretch') return [W, H]
  if (layer.fit === 'fit') return aS > aC ? [W, W / aS] : [H * aS, H]
  return aS > aC ? [H * aS, H] : [W, W / aS]
}

export type LayerChange = Partial<Pick<ContentLayer, 'x' | 'y' | 'scale' | 'rotation'>>

type Drag = { kind: 'move' | 'scale' | 'rotate'; start: [number, number]; x: number; y: number; scale: number; rotation: number; d0: number; a0: number }

/**
 * The selected layer's box over a canvas of W × H units (an atlas or a face): drag inside to move, a corner to scale,
 * the knob above to rotate (⇧ snaps to 15°). Units per CSS px: k, so the handles keep their size on screen.
 */
export function LayerHandles({
  layer,
  W,
  H,
  k,
  toCanvas,
  onChange,
}: {
  layer: ContentLayer
  W: number
  H: number
  k: number
  toCanvas: (e: { clientX: number; clientY: number }) => [number, number]
  onChange: (c: LayerChange, phase: 'live' | 'final') => void
}) {
  const aspect = useMediaAspect(layer)
  const drag = useRef<Drag | null>(null)
  const [live, setLive] = useState<LayerChange | null>(null)
  const L = { ...layer, ...live }
  const [bw, bh] = layerBox(layer, W, H, aspect)
  const sc = L.scale ?? 1
  const cx = W / 2 + (L.x ?? 0) * W
  const cy = H / 2 + (L.y ?? 0) * H
  const rot = ((L.rotation ?? 0) * Math.PI) / 180
  const at = (lx: number, ly: number): [number, number] => {
    const px = lx * bw * sc
    const py = ly * bh * sc
    return [cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]
  }
  const corners = [at(-0.5, -0.5), at(0.5, -0.5), at(0.5, 0.5), at(-0.5, 0.5)]
  const topMid = at(0, -0.5)
  const knob: [number, number] = [topMid[0] + 26 * k * Math.sin(rot), topMid[1] - 26 * k * Math.cos(rot)]
  const hs = 9 * k

  const begin = (e: PointerEvent, kind: Drag['kind']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toCanvas(e)
    drag.current = {
      kind,
      start: p,
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      scale: layer.scale ?? 1,
      rotation: layer.rotation ?? 0,
      d0: Math.max(1e-3, Math.hypot(p[0] - cx, p[1] - cy)),
      a0: Math.atan2(p[1] - cy, p[0] - cx),
    }
  }
  const change = (e: PointerEvent): LayerChange | null => {
    const d = drag.current
    if (!d) return null
    const p = toCanvas(e)
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    if (d.kind === 'move') return { x: r3(d.x + (p[0] - d.start[0]) / W), y: r3(d.y + (p[1] - d.start[1]) / H) }
    if (d.kind === 'scale') return { scale: r3(Math.max(0.02, Math.min(100, (d.scale * Math.hypot(p[0] - cx, p[1] - cy)) / d.d0))) }
    let deg = d.rotation + ((Math.atan2(p[1] - cy, p[0] - cx) - d.a0) * 180) / Math.PI
    if (e.shiftKey) deg = Math.round(deg / 15) * 15
    deg = ((((deg + 180) % 360) + 360) % 360) - 180
    return { rotation: Math.round(deg * 10) / 10 }
  }
  const onMove = (e: PointerEvent) => {
    const c = change(e)
    if (!c) return
    setLive(c)
    onChange(c, 'live')
  }
  const onUp = (e: PointerEvent) => {
    const c = change(e)
    drag.current = null
    setLive(null)
    if (c) onChange(c, 'final')
  }
  const common = { onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp }
  return (
    <g className={s.handles} data-testid="layer-handles">
      <polygon points={corners.map((p) => p.join(',')).join(' ')} className={s.box} strokeWidth={1.5 * k} onPointerDown={(e) => begin(e, 'move')} {...common} data-testid="layer-box" />
      <line x1={topMid[0]} y1={topMid[1]} x2={knob[0]} y2={knob[1]} className={s.boxLine} strokeWidth={1.2 * k} />
      <circle cx={knob[0]} cy={knob[1]} r={hs * 0.65} className={s.knob} strokeWidth={1.5 * k} onPointerDown={(e) => begin(e, 'rotate')} {...common} data-testid="layer-rotate" />
      {corners.map((p, i) => (
        <rect key={i} x={p[0] - hs / 2} y={p[1] - hs / 2} width={hs} height={hs} className={s.corner} strokeWidth={1.5 * k} onPointerDown={(e) => begin(e, 'scale')} {...common} data-testid={`layer-scale-${i}`} />
      ))}
    </g>
  )
}

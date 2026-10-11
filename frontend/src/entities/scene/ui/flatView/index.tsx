import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Renderer, surfaceFlatSize } from '../../../../render'
import { Cap, ColorField, EmptyState, FillSlider, Icon, NumField, Pill, Segmented, Switch, TextInput } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { useRaf } from '../../../../shared/lib/useRaf'
import { ambientClock, playheadNow } from '../../../show/live'
import { useEditor } from '../../editor/context'
import { locateSurface, surfaceEffectPath } from '../../ops'
import type { RenderInput } from '../../../../render'
import type { Scene, Stroke, StrokeTool, Surface } from '../../types'
import { appendStroke, buildStroke, clearStrokes, drawingEffect, drawOnClip, hitStroke, removeStroke, strokesOf, type Px, type Size, type StrokeStyle } from './strokes'
import s from './styles.module.css'

type DrawTool = StrokeTool | 'erase'

const TOOLS: Array<{ value: DrawTool; label: string; key: string; title: string }> = [
  { value: 'pen', label: 'pen', key: 'p', title: 'pen (P): drag to draw freehand' },
  { value: 'line', label: 'line', key: 'l', title: 'line (L): drag from start to end' },
  { value: 'rect', label: 'rect', key: 'r', title: 'rectangle (R): drag corner to corner' },
  { value: 'ellipse', label: 'ellipse', key: 'e', title: 'ellipse (E): drag corner to corner of its box' },
  { value: 'text', label: 'text', key: 't', title: 'text (T): click where the text starts, type, press enter' },
  { value: 'erase', label: 'erase', key: 'x', title: 'erase (X): click a stroke to remove it' },
]

/** The ink colour from the theme, as #rrggbb (strokes store plain hex). */
function themeInk(): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() : ''
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#ffffff'
}

/** Faces and details of an object that can be drawn on flat (no lines, no masks). */
export function flatSurfaces(scene: Scene, objectId: string): Surface[] {
  const o = scene.objects.find((x) => x.id === objectId)
  return o ? o.surfaces.filter((x) => x.kind !== 'line' && x.kind !== 'mask') : []
}

/** The flat view over the stage: one surface unwarped to draw on, or an object unfolded. */
export function FlatView() {
  const ed = useEditor()
  const f = ed.flat
  if (!f || !ed.scene) return null
  return (
    <div className={s.flat} data-testid="flat-view">
      {f.kind === 'surface' ? <SurfaceFlat key={f.surfaceId} surfaceId={f.surfaceId} /> : <Unfold key={f.objectId} objectId={f.objectId} />}
    </div>
  )
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 600, h: 400 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

/** The render input for flat renders: the scene at the current playhead (effects and clips animate). */
function useFlatInput(): () => RenderInput | null {
  const ed = useEditor()
  return () =>
    ed.setup
      ? { setup: ed.setup, scene: ed.scene, catalog: ed.catalog, effects: ed.userEffects, t: playheadNow(ed.hub, ed.show), clock: ambientClock(ed.hub), blackout: 0, mutedTracks: ed.mutedTracks }
      : null
}

// ── one surface ──────────────────────────────────────────────────────────────

function SurfaceFlat({ surfaceId }: { surfaceId: string }) {
  const ed = useEditor()
  const scene = ed.scene!
  const loc = locateSurface(scene, surfaceId)
  const surface = loc ? scene.objects[loc.o].surfaces[loc.s] : null
  const object = loc ? scene.objects[loc.o] : null
  const size: Size = useMemo(() => {
    const z = surfaceFlatSize(scene, surfaceId)
    return z ? { width: Math.max(1, z.width), height: Math.max(1, z.height) } : { width: 1, height: 1 }
  }, [scene, surfaceId])
  const [bodyRef, box] = useBox<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const input = useFlatInput()
  const [tool, setTool] = useState<DrawTool>('pen')
  const [style, setStyle] = useState<StrokeStyle>(() => ({ color: themeInk(), width: Math.max(2, Math.round(Math.min(size.width, size.height) / 80)), fill: false, size: Math.max(12, Math.round(size.height / 8)) }))
  const [live, setLive] = useState<{ tool: StrokeTool; pts: Px[] } | null>(null)
  const [textAt, setTextAt] = useState<Px | null>(null)
  const liveRef = useRef(live)
  liveRef.current = live
  const fx = drawingEffect(surface)
  const strokes = strokesOf(fx)
  const fxIdRef = useRef(newId('fx'))

  // fit the surface's aspect into the body
  const pad = 32
  const k = Math.max(0.01, Math.min((box.w - pad * 2) / size.width, (box.h - pad * 2) / size.height))
  const dispW = Math.max(16, size.width * k)
  const dispH = Math.max(16, size.height * k)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    try {
      renderer.current = new Renderer(c, { space: 'scene', preserveDrawingBuffer: true })
    } catch {
      renderer.current = null
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])

  useRaf(() => {
    const r = renderer.current
    const inp = input()
    if (!r || !inp) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(16, Math.min(1024, Math.round(dispW * dpr)))
    r.setSize(cw, Math.max(16, Math.round((cw * dispH) / dispW)))
    r.renderSurface(inp, surfaceId)
  }, 30)

  // keys: tool hotkeys and escape; keep the editor's global keys (delete, stage tools) away while drawing
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (liveRef.current) setLive(null)
        else ed.closeFlat()
        return
      }
      const hit = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (hit) {
        e.stopImmediatePropagation()
        setTool(hit.value)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Tab' || e.key.startsWith('Arrow')) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [ed])

  if (!surface || !object) {
    return (
      <>
        <Bar title="flat" onClose={ed.closeFlat} />
        <EmptyState>this surface no longer exists.</EmptyState>
      </>
    )
  }

  const toPx = (e: { clientX: number; clientY: number }): Px => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * size.width, ((e.clientY - r.top) / r.height) * size.height]
  }

  const commit = (stroke: Stroke | null) => {
    if (!stroke) return
    const id = fxIdRef.current
    void ed.editing.edit((sc) => appendStroke(sc, surfaceId, stroke, id))
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = toPx(e)
    if (tool === 'erase') {
      const i = hitStroke(strokes, p, size, 6 / k)
      if (i >= 0) {
        const victim = strokes[i]
        void ed.editing.edit((sc) => removeStroke(sc, surfaceId, victim))
      }
      return
    }
    if (tool === 'text') {
      setTextAt(p)
      return
    }
    svgRef.current!.setPointerCapture(e.pointerId)
    setLive({ tool, pts: [p] })
  }
  const onMove = (e: PointerEvent) => {
    const cur = liveRef.current
    if (!cur) return
    const p = toPx(e)
    setLive(cur.tool === 'pen' ? { ...cur, pts: [...cur.pts, p] } : { ...cur, pts: [cur.pts[0], p] })
  }
  const onUp = (e: PointerEvent) => {
    const cur = liveRef.current
    setLive(null)
    if (!cur) return
    const p = toPx(e)
    const pts = cur.tool === 'pen' ? [...cur.pts, p] : [cur.pts[0], p]
    commit(buildStroke(cur.tool, pts, size, style))
  }

  const revealPath = fx ? surfaceEffectPath(scene, surfaceId, fx.id, 'params', 'reveal') : null
  const reveal = fx ? Number(fx.params.reveal ?? 1) : 1
  const sw = style.width
  const lp = live?.pts ?? []

  return (
    <>
      <Bar title={`flat · ${object.name} / ${surface.name}`} meta={`${Math.round(size.width)}×${Math.round(size.height)} px`} onClose={ed.closeFlat}>
        {flatSurfaces(scene, object.id).length > 1 && (
          <Pill size="sm" ghost icon="layers" onClick={() => ed.openUnfold(object.id)} title="show every face of this object flat, side by side">
            unfold
          </Pill>
        )}
      </Bar>
      <div className={s.tools}>
        <Segmented<DrawTool> ariaLabel="drawing tool" size="sm" value={tool} onChange={setTool} options={TOOLS.map((t) => ({ value: t.value, label: t.label, title: t.title }))} />
        <div className={s.color}>
          <ColorField label="colour" value={style.color} onChange={(c) => setStyle((x) => ({ ...x, color: c }))} />
        </div>
        {tool === 'text' ? (
          <NumField prefix="size" suffix="px" ariaLabel="text size" value={style.size} min={2} max={2000} onCommit={(v) => setStyle((x) => ({ ...x, size: Math.max(2, Math.round(v)) }))} />
        ) : (
          <NumField prefix="width" suffix="px" ariaLabel="stroke width" value={style.width} min={0} max={500} onCommit={(v) => setStyle((x) => ({ ...x, width: Math.max(0, Math.round(v * 10) / 10) }))} />
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label className={s.fill}>
            <span>fill</span>
            <Switch checked={style.fill} onChange={(v) => setStyle((x) => ({ ...x, fill: v }))} ariaLabel="fill" />
          </label>
        )}
        <span className={s.sp} />
        <Pill size="sm" ghost icon="undo" disabled={!strokes.length} onClick={() => strokes.length && void ed.editing.edit((sc) => removeStroke(sc, surfaceId, strokes[strokes.length - 1]))} title="remove the last stroke">
          undo stroke
        </Pill>
        <Pill size="sm" ghost icon="trash" disabled={!strokes.length} onClick={() => void ed.editing.edit((sc) => clearStrokes(sc, surfaceId))} title="remove every stroke on this surface">
          clear
        </Pill>
        <Pill
          size="sm"
          icon="play"
          disabled={!strokes.length}
          title="add a timeline clip at the playhead that draws these strokes on over 3 s"
          onClick={() => {
            const ids = { track: newId('trk'), clip: newId('clp') }
            const at = playheadNow(ed.hub, ed.show)
            void ed.editing.edit((sc) => drawOnClip(sc, surfaceId, at, 3, ids)).then(() => ed.toast('Added a clip that draws the strokes on. The always-on drawing is off now.'))
          }}
        >
          draw on
        </Pill>
      </div>
      <div ref={bodyRef} className={s.body}>
        <div className={s.sheet} style={{ width: dispW, height: dispH }}>
          <canvas ref={canvasRef} className={s.canvas} data-testid="flat-canvas" />
          <svg
            ref={svgRef}
            className={`${s.ink} ${tool === 'erase' ? s.erase : ''}`}
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setLive(null)}
            data-testid="flat-ink"
          >
            {live && lp.length > 0 && (
              <g className={s.liveStroke} stroke={style.color} fill={style.fill && (live.tool === 'rect' || live.tool === 'ellipse') ? style.color : 'none'} strokeWidth={Math.max(sw, 0.5)}>
                {live.tool === 'pen' && <polyline points={lp.map((p) => p.join(',')).join(' ')} fill="none" />}
                {live.tool === 'line' && lp.length > 1 && <line x1={lp[0][0]} y1={lp[0][1]} x2={lp[1][0]} y2={lp[1][1]} />}
                {live.tool === 'rect' && lp.length > 1 && <rect x={Math.min(lp[0][0], lp[1][0])} y={Math.min(lp[0][1], lp[1][1])} width={Math.abs(lp[1][0] - lp[0][0])} height={Math.abs(lp[1][1] - lp[0][1])} />}
                {live.tool === 'ellipse' && lp.length > 1 && <ellipse cx={(lp[0][0] + lp[1][0]) / 2} cy={(lp[0][1] + lp[1][1]) / 2} rx={Math.abs(lp[1][0] - lp[0][0]) / 2} ry={Math.abs(lp[1][1] - lp[0][1]) / 2} />}
              </g>
            )}
          </svg>
          {textAt && (
            <TextInput
              autoFocus
              className={s.textIn}
              style={{ left: (textAt[0] / size.width) * dispW, top: (textAt[1] / size.height) * dispH }}
              placeholder="type, then enter"
              aria-label="text"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit(buildStroke('text', [textAt], size, style, (e.target as HTMLInputElement).value))
                  setTextAt(null)
                } else if (e.key === 'Escape') setTextAt(null)
              }}
              onBlur={() => setTextAt(null)}
            />
          )}
        </div>
      </div>
      <div className={s.foot}>
        <Cap>{strokes.length ? `${strokes.length} stroke${strokes.length === 1 ? '' : 's'} · shown on the wall through the warp` : 'draw on the surface; strokes show on the wall through the warp'}</Cap>
        {fx && revealPath && (
          <div className={s.reveal}>
            <FillSlider label="reveal" value={reveal} display={`${Math.round(reveal * 100)}%`} onChange={(v, ph) => ed.editing.setValue(revealPath, Math.round(v * 1000) / 1000, ph)} />
          </div>
        )}
      </div>
    </>
  )
}

function Bar({ title, meta, onClose, children }: { title: string; meta?: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className={s.bar}>
      <Pill size="sm" ghost icon="close" onClick={onClose} title="back to the stage (esc)" data-testid="flat-close">
        back to stage
      </Pill>
      <span className={s.title}>{title}</span>
      {meta && <span className={s.meta}>{meta}</span>}
      <span className={s.sp} />
      {children}
    </div>
  )
}

// ── unfold ───────────────────────────────────────────────────────────────────

/** Every face and detail of an object flat, side by side (like a UV atlas); click one to draw on it. */
function Unfold({ objectId }: { objectId: string }) {
  const ed = useEditor()
  const scene = ed.scene!
  const obj = scene.objects.find((o) => o.id === objectId)
  const list = obj ? flatSurfaces(scene, objectId) : []
  const tiles = useRef(new Map<string, HTMLCanvasElement>())
  const renderer = useRef<Renderer | null>(null)
  const input = useFlatInput()

  useEffect(() => {
    try {
      const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 })
      renderer.current = new Renderer(off, { space: 'scene', preserveDrawingBuffer: true })
    } catch {
      renderer.current = null
    }
    return () => {
      renderer.current?.dispose(true)
      renderer.current = null
    }
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      ed.closeFlat()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [ed])

  useRaf(() => {
    const r = renderer.current
    const inp = input()
    if (!r || !inp) return
    for (const srf of list) {
      const cv = tiles.current.get(srf.id)
      const ctx = cv?.getContext('2d')
      if (!cv || !ctx) continue
      r.setSize(cv.width, cv.height)
      r.renderSurface(inp, srf.id)
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(r.canvas as CanvasImageSource, 0, 0, cv.width, cv.height)
    }
  }, 12)

  const TILE_H = 150
  return (
    <>
      <Bar title={`unfold · ${obj?.name ?? 'object'}`} meta={`${list.length} surface${list.length === 1 ? '' : 's'}`} onClose={ed.closeFlat} />
      <div className={s.atlas} data-testid="unfold">
        {list.length === 0 && <EmptyState>this object has no faces yet. draw one on the stage with Q.</EmptyState>}
        {list.map((srf) => {
          const z = surfaceFlatSize(scene, srf.id) ?? { width: 1, height: 1 }
          const aspect = Math.max(0.15, Math.min(6, z.width / Math.max(1, z.height)))
          const w = Math.round(TILE_H * aspect)
          const strokes = strokesOf(drawingEffect(srf)).length
          return (
            <button key={srf.id} type="button" className={s.tile} onClick={() => ed.openFlat(srf.id)} title={`open ${srf.name} flat to draw on it`} data-testid={`unfold-${srf.id}`}>
              <canvas
                ref={(el) => {
                  if (el) tiles.current.set(srf.id, el)
                  else tiles.current.delete(srf.id)
                }}
                width={Math.min(512, w * 2)}
                height={Math.max(8, Math.round((Math.min(512, w * 2) * TILE_H) / w))}
                style={{ width: w, height: TILE_H }}
                className={s.tileCanvas}
              />
              <span className={s.tileLabel}>
                <Icon name={srf.kind === 'circle' ? 'circle' : srf.kind === 'tri' ? 'tri' : srf.kind === 'poly' ? 'poly' : 'quad'} size={13} />
                {srf.name}
                <span className={s.meta}>
                  {srf.role} · {Math.round(z.width)}×{Math.round(z.height)}
                  {strokes ? ` · ${strokes} stroke${strokes === 1 ? '' : 's'}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

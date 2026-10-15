import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { atlasAffines, atlasFaces, autoAtlas, Renderer, resolveAtlas, surfaceFlatSize, type RenderInput } from '../../../../render'
import { Cap, ColorField, EmptyState, HintBar, NumField, Pill, Switch, TextInput, type MenuItem } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { useRaf } from '../../../../shared/lib/useRaf'
import { ambientClock } from '../../../show/live'
import { useEditor } from '../../editor/context'
import { pointInPolygon } from '../../geometry'
import { addContentLayer, contentLayerPath, gradientLayer, locateContentLayer, locateSurface, mediaLayer, setAtlas } from '../../ops'
import { atlasShapes, canvasPng, download, faceTemplateCanvas, fileStem, templateCanvas, templateSvg, zipStore } from '../../template'
import type { Atlas, AtlasRect, AtlasRotation, Scene, Stroke, StrokeTool } from '../../types'
import { appendStroke, buildStroke, clearStrokes, drawingEffect, drawOnClip, hitStroke, removeStroke, strokesOf, type Px, type Size, type StrokeStyle } from '../flatView/strokes'
import { addEffectTo, EffectMenu, EmptyActions } from './emptyActions'
import { LayerHandles, type LayerChange } from './handles'
import { ContentHead, MoreMenu, TipPill, ToolButton } from './head'
import { MiniMap } from './miniMap'
import { faceHasContent, objectHasContent } from './model'
import { useContentTour } from './tour'
import s from './styles.module.css'

type FaceTool = 'move' | StrokeTool | 'erase'

const FACE_TOOLS: Array<{ value: FaceTool; label: string; icon: string; key: string; title: string }> = [
  { value: 'move', label: 'move', icon: 'select', key: 'v', title: 'move (V): drag a picture, its corners scale it, the knob turns it' },
  { value: 'pen', label: 'pen', icon: 'pen', key: '1', title: 'pen (1): drag to draw freehand' },
  { value: 'line', label: 'line', icon: 'line', key: '2', title: 'line (2): drag from start to end' },
  { value: 'rect', label: 'box', icon: 'quad', key: '3', title: 'box (3): drag corner to corner' },
  { value: 'ellipse', label: 'ellipse', icon: 'circle', key: '4', title: 'ellipse (4): drag corner to corner of its box' },
  { value: 'text', label: 'text', icon: 'text', key: '5', title: 'text (5): click where the text starts, type, press enter' },
  { value: 'erase', label: 'erase', icon: 'eraser', key: '6', title: 'erase (6): click a stroke to remove it' },
]

/** The column on the right of the view kept free for the mini map and the stage picture, so they never cover the face. */
const SIDE = 250

/** The ink colour from the theme, as #rrggbb (strokes store plain hex). */
function themeInk(): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() : ''
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#ffffff'
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 800, h: 500 })
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

/** A renderer on a canvas for as long as the canvas lives. */
function useRenderer(ref: React.RefObject<HTMLCanvasElement>, key?: unknown) {
  const r = useRef<Renderer | null>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    try {
      r.current = new Renderer(c, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: 1280 })
    } catch {
      r.current = null
    }
    return () => {
      r.current?.dispose()
      r.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return r
}

/** The render input at the editor's preview playhead (never the wall's). */
function useInput(): () => RenderInput | null {
  const ed = useEditor()
  return () =>
    ed.setup
      ? { setup: ed.setup, scene: ed.scene, catalog: ed.catalog, effects: ed.userEffects, t: ed.preview.t(), clock: ambientClock(ed.hub), now: ed.hub.serverNow(), blackout: 0, mutedTracks: ed.mutedTracks, mode: 'objects' }
      : null
}

/** The faces of an object in atlas order (for [ and ]). */
function faceOrder(scene: Scene, objectId: string): string[] {
  const o = scene.objects.find((x) => x.id === objectId)
  return o ? atlasFaces(o).map((x) => x.id) : []
}

/**
 * The content space: the selected object unfolded as an atlas (its faces edge to edge at real proportions, details
 * inside their parents), or one face zoomed in to put pictures, drawings and effects on it. A live picture of the
 * warped stage sits in a corner.
 */
export function ContentView() {
  const ed = useEditor()
  const scene = ed.scene
  const objectId = ed.contentObjectId
  const obj = scene?.objects.find((o) => o.id === objectId) ?? null
  const zoom = ed.faceZoom && scene && locateSurface(scene, ed.faceZoom) ? ed.faceZoom : null

  // [ and ] step through the faces; esc leaves the face zoom
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (!scene || !objectId) return
      if (e.key === 'Escape' && zoom) {
        e.stopImmediatePropagation()
        ed.setFaceZoom(null)
        return
      }
      if (e.key === '[' || e.key === ']') {
        const order = faceOrder(scene, objectId)
        if (!order.length) return
        e.preventDefault()
        const cur = zoom ?? ed.sel.surfaceId
        const i = cur ? order.indexOf(cur) : -1
        const next = order[(i + (e.key === '[' ? -1 : 1) + order.length) % order.length]
        ed.select({ surfaceId: next, objectId, focus: 'surface', pointId: null })
        if (zoom) ed.setFaceZoom(next)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [ed, scene, objectId, zoom])

  // paste a picture: onto the zoomed or selected face, else across the object
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      if (!files.length || !objectId) return
      e.preventDefault()
      const sid = zoom ?? ed.sel.surfaceId
      void ed.addMedia(files, sid ? { kind: 'surface', id: sid } : { kind: 'object', id: objectId })
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [ed, objectId, zoom])

  const tour = useContentTour(false)
  const [startTool, setStartTool] = useState<FaceTool | null>(null)
  // the tour opens once, the first time the unfold shows
  const hasObj = !!obj
  const startTour = tour.start
  useEffect(() => {
    if (hasObj && !zoom) startTour()
  }, [hasObj, zoom, startTour])

  if (!scene) return <section className={s.content} aria-label="content" />
  if (!obj) {
    return (
      <section className={s.content} aria-label="content" data-testid="content-view">
        <div className={s.empty}>
          <EmptyState>
            Content puts pictures, drawings and effects on the faces of an object. This scene has no faces yet.
            <br />
            <Pill size="sm" icon="quad" onClick={() => ed.setSpace('map')} className={s.emptyGo} data-testid="content-go-map">
              open map to draw the faces
            </Pill>
          </EmptyState>
        </div>
      </section>
    )
  }
  return (
    <section className={s.content} aria-label="content" data-testid="content-view">
      {zoom ? (
        <FacePane key={zoom} surfaceId={zoom} objectId={obj.id} initialTool={startTool} onStarted={() => setStartTool(null)} onHelp={tour.replay} />
      ) : (
        <AtlasPane
          key={obj.id}
          objectId={obj.id}
          onHelp={tour.replay}
          onDrawFace={(id) => {
            setStartTool('pen')
            ed.editFace(id)
          }}
        />
      )}
      <Pip />
      {tour.el}
    </section>
  )
}

// ── the unfold ───────────────────────────────────────────────────────────────

function AtlasPane({ objectId, onHelp, onDrawFace }: { objectId: string; onHelp: () => void; onDrawFace: (surfaceId: string) => void }) {
  const ed = useEditor()
  const scene = ed.scene!
  const obj = scene.objects.find((o) => o.id === objectId)!
  const [arrange, setArrange] = useState(false)
  const [moving, setMoving] = useState<{ id: string; rect: AtlasRect } | null>(null)
  const stored = !!obj.atlas
  const baseAtlas = useMemo(() => resolveAtlas(scene, obj), [scene, obj])
  const atlas: Atlas = moving ? { ...baseAtlas, faces: { ...baseAtlas.faces, [moving.id]: moving.rect } } : baseAtlas
  const shapes = useMemo(() => atlasShapes(scene, obj, atlas), [scene, obj, atlas])
  const [bodyRef, box] = useBox<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const renderer = useRenderer(canvasRef)
  const input = useInput()
  const file = useRef<HTMLInputElement>(null)
  const artwork = useRef<HTMLInputElement>(null)
  const [dropHint, setDropHint] = useState(false)
  const [hideEmpty, setHideEmpty] = useState(false)

  const pad = 40
  const k = Math.max(0.01, Math.min((box.w - pad * 2 - SIDE) / atlas.width, (box.h - pad * 2) / atlas.height))
  const dispW = Math.max(16, atlas.width * k)
  const dispH = Math.max(16, atlas.height * k)
  const u = 1 / k // atlas units per css px

  useRaf(() => {
    const r = renderer.current
    const inp = input()
    if (!r || !inp) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(16, Math.min(2048, Math.round(dispW * dpr)))
    r.setSize(cw, Math.max(16, Math.round((cw * dispH) / dispW)))
    r.renderAtlas(moving ? { ...inp, scene: withAtlas(scene, objectId, atlas) } : inp, objectId)
  })

  const toAtlas = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * atlas.width, ((e.clientY - r.top) / r.height) * atlas.height]
  }
  const hitFace = (p: [number, number]) => [...shapes].reverse().find((sh) => pointInPolygon({ x: p[0], y: p[1] }, sh.pts.map(([x, y]) => ({ x, y }))))

  /** Writes the whole atlas, shifted so it starts at 0, 0 and sized to its rects. */
  const writeAtlas = (a: Atlas) => {
    const rects = Object.values(a.faces)
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y))
    const faces: Record<string, AtlasRect> = {}
    let W = 1, H = 1
    for (const [id, r] of Object.entries(a.faces)) {
      faces[id] = { ...r, x: Math.round(r.x - x0), y: Math.round(r.y - y0), w: Math.round(r.w), h: Math.round(r.h) }
      W = Math.max(W, faces[id].x + faces[id].w)
      H = Math.max(H, faces[id].y + faces[id].h)
    }
    void ed.editing.edit((sc) => setAtlas(sc, objectId, { width: W, height: H, faces }))
  }

  const drag = useRef<{ id: string; start: [number, number]; rect: AtlasRect } | null>(null)
  const onFaceDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const isDetail = !!obj.surfaces.find((x) => x.id === id)?.parentId
    ed.select({ surfaceId: id, objectId, focus: 'surface', pointId: null })
    if (!arrange) return
    if (isDetail || !atlas.faces[id]) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { id, start: toAtlas(e), rect: atlas.faces[id] }
  }
  const onFaceMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toAtlas(e)
    let x = d.rect.x + p[0] - d.start[0]
    let y = d.rect.y + p[1] - d.start[1]
    // snap to the other faces' edges
    const snap = 8 * u
    for (const [id, r] of Object.entries(baseAtlas.faces)) {
      if (id === d.id) continue
      for (const [a, b] of [[x, r.x + r.w], [x + d.rect.w, r.x], [x, r.x], [x + d.rect.w, r.x + r.w]] as Array<[number, number]>) if (Math.abs(a - b) < snap) x += b - a
      for (const [a, b] of [[y, r.y + r.h], [y + d.rect.h, r.y], [y, r.y], [y + d.rect.h, r.y + r.h]] as Array<[number, number]>) if (Math.abs(a - b) < snap) y += b - a
    }
    setMoving({ id: d.id, rect: { ...d.rect, x: Math.round(x), y: Math.round(y) } })
  }
  const onFaceUp = () => {
    const d = drag.current
    drag.current = null
    if (d && moving) writeAtlas({ ...baseAtlas, faces: { ...baseAtlas.faces, [moving.id]: moving.rect } })
    setMoving(null)
  }

  const turnFace = (id: string) => {
    const r = baseAtlas.faces[id]
    if (!r) return
    const rotation = (((r.rotation ?? 0) + 90) % 360) as AtlasRotation
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2
    writeAtlas({ ...baseAtlas, faces: { ...baseAtlas.faces, [id]: { x: cx - r.h / 2, y: cy - r.w / 2, w: r.h, h: r.w, rotation } } })
  }

  const pin = () => (stored ? null : autoAtlas(scene, obj))
  const exportPng = async () => {
    const a = pin()
    if (a) void ed.editing.edit((sc) => setAtlas(sc, objectId, a))
    const at = a ?? baseAtlas
    download(await canvasPng(templateCanvas(scene, obj, at)), `${fileStem(obj.name)}-template-${at.width}x${at.height}.png`)
    ed.toast(`Saved the ${at.width}×${at.height} template. Paint on it and import it back to land on the faces.`)
  }
  const exportSvg = () => {
    const a = pin()
    if (a) void ed.editing.edit((sc) => setAtlas(sc, objectId, a))
    const at = a ?? baseAtlas
    download(new Blob([templateSvg(scene, obj, at)], { type: 'image/svg+xml' }), `${fileStem(obj.name)}-template-${at.width}x${at.height}.svg`)
  }
  const exportZip = async () => {
    const a = pin()
    if (a) void ed.editing.edit((sc) => setAtlas(sc, objectId, a))
    const at = a ?? baseAtlas
    const files: Array<{ name: string; data: Uint8Array }> = []
    files.push({ name: `${fileStem(obj.name)}-atlas-${at.width}x${at.height}.png`, data: new Uint8Array(await (await canvasPng(templateCanvas(scene, obj, at))).arrayBuffer()) })
    for (const f of atlasFaces(obj)) {
      const c = faceTemplateCanvas(scene, obj, at, f.id)
      if (c) files.push({ name: `${fileStem(f.name)}-${c.width}x${c.height}.png`, data: new Uint8Array(await (await canvasPng(c)).arrayBuffer()) })
    }
    download(zipStore(files), `${fileStem(obj.name)}-faces.zip`)
  }
  const importArtwork = async (f: File) => {
    if (f.type.startsWith('image/')) {
      const bmp = await createImageBitmap(f).catch(() => null)
      if (bmp) {
        const ok = Math.abs(bmp.width / bmp.height - baseAtlas.width / baseAtlas.height) < 0.02
        if (!ok) ed.toast(`The artwork is ${bmp.width}×${bmp.height}; the template is ${baseAtlas.width}×${baseAtlas.height}. It is stretched to fit.`, { bad: true })
        bmp.close()
      }
    }
    await ed.addMedia([f], { kind: 'object', id: objectId }, { fit: 'stretch', name: 'artwork' })
  }

  const onDrop = (e: DragEvent) => {
    setDropHint(false)
    const files = [...e.dataTransfer.files]
    const data = e.dataTransfer.getData('text/plain')
    if (!files.length && !data.startsWith('media:')) return
    e.preventDefault()
    const hit = e.altKey ? null : hitFace(toAtlas(e))
    const owner = hit ? { kind: 'surface' as const, id: hit.id } : { kind: 'object' as const, id: objectId }
    if (files.length) void ed.addMedia(files, owner)
    else {
      const [src, name] = data.slice(6).split('|')
      void ed.editing.edit((sc) => addContentLayer(sc, owner, mediaLayer(newId('cl'), src, name ?? 'picture')))
    }
  }

  const sel = ed.sel.contentLayerId ? locateContentLayer(scene, ed.sel.contentLayerId) : null
  const objLayer = sel && sel.owner.kind === 'object' && sel.owner.id === objectId ? sel.layer : null
  const selFace = ed.sel.surfaceId && atlas.faces[ed.sel.surfaceId] ? ed.sel.surfaceId : null

  const addSweep = () => {
    const layer = gradientLayer(newId('cl'))
    void ed.editing.edit((sc) => {
      const ops = addContentLayer(sc, { kind: 'object', id: objectId }, layer)
      const o = sc.objects.find((x) => x.id === objectId)
      if (ops && o && !o.atlas) ops.unshift(...(setAtlas(sc, objectId, autoAtlas(sc, o)) ?? []))
      return ops
    })
    ed.select({ contentLayerId: layer.id, focus: 'content' })
  }
  const faces = atlasFaces(obj).filter((f) => !f.parentId)
  const firstFace = (selFace && faces.some((f) => f.id === selFace) ? selFace : null) ?? faces[0]?.id ?? null
  const empty = !hideEmpty && !arrange && !objectHasContent(scene, objectId)

  const more: MenuItem[] = [
    { key: 'c0', caption: true, label: 'layout' },
    { key: 'arrange', icon: 'layers', label: arrange ? 'stop arranging the faces' : 'arrange the faces by dragging', on: arrange, onSelect: () => setArrange(!arrange) },
    {
      key: 'relayout',
      icon: 'loop',
      label: stored ? 're-layout from the mapping' : 'pin this layout',
      onSelect: () => void ed.editing.edit((sc) => setAtlas(sc, objectId, autoAtlas(sc, sc.objects.find((o) => o.id === objectId)!))),
    },
    { key: 'c', caption: true, label: `template · ${baseAtlas.width}×${baseAtlas.height} px` },
    { key: 'png', icon: 'download', label: 'save the template as PNG', onSelect: () => void exportPng() },
    { key: 'svg', icon: 'download', label: 'save the template as SVG', onSelect: exportSvg },
    { key: 'zip', icon: 'download', label: 'save each face as a PNG (zip)', onSelect: () => void exportZip() },
    { key: 'imp', icon: 'upload', label: 'import artwork made on the template', onSelect: () => artwork.current?.click() },
  ]

  return (
    <>
      <ContentHead
        objectId={objectId}
        surfaceId={null}
        onHelp={onHelp}
        meta={
          <span data-testid="atlas-size">
            unfold · {atlas.width}×{atlas.height} px{stored ? '' : ' · auto'}
          </span>
        }
        hint="Click a face to open it. Drop a picture on a face, or between faces to span the object."
      >
        <TipPill tip="add a picture or a video that spans every face of the object" icon="image" onClick={() => file.current?.click()} data-testid="add-object-media">
          add picture across
        </TipPill>
        <TipPill tip="add a band of light that runs across every face; a sweep clip moves it" icon="gradient" onClick={addSweep} data-testid="add-sweep">
          add sweep
        </TipPill>
        {arrange && (
          <TipPill tip="drag faces to arrange the unfold; their content follows. click to stop" on icon="check" onClick={() => setArrange(false)} data-testid="arrange">
            done arranging
          </TipPill>
        )}
        {arrange && selFace && (
          <TipPill tip="turn the selected face 90° in the unfold" icon="loop" onClick={() => turnFace(selFace)}>
            turn 90°
          </TipPill>
        )}
        <span className={s.sp} />
        <MoreMenu items={more} testId="template-menu" />
      </ContentHead>
      <div
        ref={bodyRef}
        className={`${s.body} ${dropHint ? s.dropping : ''}`}
        style={{ paddingRight: SIDE }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) {
            e.preventDefault()
            setDropHint(true)
          }
        }}
        onDragLeave={() => setDropHint(false)}
        onDrop={onDrop}
        onPointerDown={(e) => e.target === e.currentTarget && ed.select({ surfaceId: null, contentLayerId: null, focus: 'object', objectId })}
      >
        <div className={s.sheet} style={{ width: dispW, height: dispH }} data-testid="atlas">
          <canvas ref={canvasRef} className={s.canvas} data-testid="atlas-canvas" />
          <svg ref={svgRef} className={s.ink} viewBox={`0 0 ${atlas.width} ${atlas.height}`} preserveAspectRatio="none">
            {shapes.map((sh) => {
              const on = ed.sel.surfaceId === sh.id
              return (
                <polygon
                  key={sh.id}
                  points={sh.pts.map((p) => p.join(',')).join(' ')}
                  className={`${s.face} ${sh.detail ? s.detail : ''} ${on ? s.faceOn : ''} ${arrange && !sh.detail ? s.movable : ''}`}
                  strokeWidth={(on ? 2 : 1.25) * u}
                  strokeDasharray={sh.detail ? `${4 * u} ${3 * u}` : undefined}
                  onPointerDown={(e) => onFaceDown(e, sh.id)}
                  onPointerMove={onFaceMove}
                  onPointerUp={onFaceUp}
                  onPointerCancel={onFaceUp}
                  onClick={() => !arrange && ed.editFace(sh.id)}
                  data-testid={`atlas-face-${sh.id}`}
                  data-face={sh.id}
                >
                  <title>{arrange ? `drag ${sh.name} to arrange the unfold` : `open ${sh.name}`}</title>
                </polygon>
              )
            })}
            {shapes
              .filter((sh) => !sh.detail)
              .map((sh) => {
                const cx = sh.pts.reduce((a, p) => a + p[0], 0) / sh.pts.length
                const cy = sh.pts.reduce((a, p) => a + p[1], 0) / sh.pts.length
                return (
                  <text key={sh.id} x={cx} y={cy} fontSize={11 * u} className={s.faceName} textAnchor="middle" dominantBaseline="middle">
                    {sh.name}
                  </text>
                )
              })}
            {objLayer && <LayerHandles layer={objLayer} W={atlas.width} H={atlas.height} k={u} toCanvas={toAtlas} onChange={(c, ph) => writeLayer(ed, objLayer.id, c, ph)} />}
          </svg>
        </div>
        {dropHint && <div className={s.dropNote}>drop on a face for that face, hold alt (or drop between faces) to span the object</div>}
        <MiniMap objectId={objectId} current={null} />
        {empty && (
          <EmptyActions
            title={`${obj.name} shows nothing yet`}
            text="Start with one of these. You can add more, or open a single face, at any time."
            pictureNote="one picture across all its faces"
            drawNote={firstFace ? `open ${obj.surfaces.find((x) => x.id === firstFace)?.name} with the pen` : 'pen, shapes and text'}
            effectNote="a moving effect on every face"
            onPicture={() => file.current?.click()}
            onDraw={() => firstFace && onDrawFace(firstFace)}
            onEffect={(d) => addEffectTo(ed, faces.map((f) => f.id), d)}
            onClose={() => setHideEmpty(true)}
          />
        )}
      </div>
      <div className={s.hints}>
        <HintBar
          hints={[
            { keys: 'click', text: 'open a face' },
            { keys: '[ ]', text: 'faces' },
            { keys: 'S', text: 'solo' },
            { keys: '⌘V', text: 'paste picture' },
            { keys: 'tab', text: 'map' },
          ]}
        />
      </div>
      <input ref={file} type="file" accept="image/*,video/*" hidden onChange={(e) => {
        const fs = [...(e.target.files ?? [])]
        e.target.value = ''
        if (fs.length) void ed.addMedia(fs, { kind: 'object', id: objectId })
      }} data-testid="object-media-input" />
      <input ref={artwork} type="file" accept="image/*,video/*" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void importArtwork(f)
      }} data-testid="artwork-input" />
    </>
  )
}

/** The scene with an object's atlas replaced (a face being dragged previews its content in place). */
function withAtlas(scene: Scene, objectId: string, atlas: Atlas): Scene {
  return { ...scene, objects: scene.objects.map((o) => (o.id === objectId ? { ...o, atlas } : o)) }
}

function writeLayer(ed: ReturnType<typeof useEditor>, layerId: string, c: LayerChange, phase: 'live' | 'final') {
  const sc = ed.scene
  if (!sc) return
  const entries: Array<[string, unknown]> = []
  for (const [key, v] of Object.entries(c)) {
    const p = contentLayerPath(sc, layerId, key)
    if (p) entries.push([p, v])
  }
  if (entries.length) ed.editing.setValues(entries, phase)
}

// ── one face ─────────────────────────────────────────────────────────────────

function FacePane({ surfaceId, objectId, initialTool, onStarted, onHelp }: { surfaceId: string; objectId: string; initialTool: FaceTool | null; onStarted: () => void; onHelp: () => void }) {
  const ed = useEditor()
  const scene = ed.scene!
  const loc = locateSurface(scene, surfaceId)!
  const obj = scene.objects[loc.o]
  const surface = obj.surfaces[loc.s]
  const affine = useMemo(() => atlasAffines(scene, obj).get(surfaceId) ?? null, [scene, obj, surfaceId])
  const size: Size = useMemo(() => {
    if (affine) return { width: Math.max(1, Math.hypot(...affine.u)), height: Math.max(1, Math.hypot(...affine.v)) }
    const z = surfaceFlatSize(scene, surfaceId)
    return z ? { width: Math.max(1, z.width), height: Math.max(1, z.height) } : { width: 1, height: 1 }
  }, [scene, surfaceId, affine])
  const [bodyRef, box] = useBox<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const renderer = useRenderer(canvasRef)
  const input = useInput()
  const [tool, setTool] = useState<FaceTool>(initialTool ?? 'move')
  const [hideEmpty, setHideEmpty] = useState(false)
  // the start tool is used once, by the face that opened with it
  const started = useRef(onStarted)
  useEffect(() => {
    if (initialTool) started.current()
  }, [initialTool])
  const [style, setStyle] = useState<StrokeStyle>(() => ({ color: themeInk(), width: Math.max(2, Math.round(Math.min(size.width, size.height) / 80)), fill: false, size: Math.max(12, Math.round(size.height / 8)) }))
  const [live, setLive] = useState<{ tool: StrokeTool; pts: Px[] } | null>(null)
  const [textAt, setTextAt] = useState<Px | null>(null)
  const liveRef = useRef(live)
  liveRef.current = live
  const fx = drawingEffect(surface)
  const strokes = strokesOf(fx)
  const fxIdRef = useRef(newId('fx'))
  const file = useRef<HTMLInputElement>(null)
  const order = faceOrder(scene, objectId)
  const idx = order.indexOf(surfaceId)

  const pad = 40
  const k = Math.max(0.01, Math.min((box.w - pad * 2 - SIDE) / size.width, (box.h - pad * 2) / size.height))
  const dispW = Math.max(16, size.width * k)
  const dispH = Math.max(16, size.height * k)
  const u = 1 / k

  useRaf(() => {
    const r = renderer.current
    const inp = input()
    if (!r || !inp) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(16, Math.min(1600, Math.round(dispW * dpr)))
    r.setSize(cw, Math.max(16, Math.round((cw * dispH) / dispW)))
    // the face with its details, upright in its own uv; without an atlas place, the face alone
    if (affine) r.renderAtlas(inp, objectId, { only: surfaceId, view: affine })
    else r.renderSurface(inp, surfaceId)
  })

  // drawing keys: V moves, 1 to 6 draw
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && liveRef.current) {
        e.stopImmediatePropagation()
        setLive(null)
        return
      }
      const hit = FACE_TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (hit) {
        e.stopImmediatePropagation()
        setTool(hit.value)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])

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
    if (tool === 'move') {
      ed.select({ contentLayerId: null, focus: 'surface', surfaceId })
      return
    }
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
  const onDrop = (e: DragEvent) => {
    const files = [...e.dataTransfer.files]
    const data = e.dataTransfer.getData('text/plain')
    if (!files.length && !data.startsWith('media:')) return
    e.preventDefault()
    if (files.length) void ed.addMedia(files, { kind: 'surface', id: surfaceId })
    else {
      const [src, name] = data.slice(6).split('|')
      void ed.editing.edit((sc) => addContentLayer(sc, { kind: 'surface', id: surfaceId }, mediaLayer(newId('cl'), src, name ?? 'picture')))
    }
  }

  const sel = ed.sel.contentLayerId ? locateContentLayer(scene, ed.sel.contentLayerId) : null
  const faceLayer = tool === 'move' && sel && sel.owner.kind === 'surface' && sel.owner.id === surfaceId ? sel.layer : null
  const go = (d: number) => {
    if (!order.length) return
    const next = order[(idx + d + order.length) % order.length]
    ed.select({ surfaceId: next, objectId, focus: 'surface' })
    ed.setFaceZoom(next)
  }
  const lp = live?.pts ?? []
  const sw = style.width
  const drawing = tool !== 'move'

  const empty = !hideEmpty && tool === 'move' && !faceHasContent(scene, surfaceId)
  const more: MenuItem[] = [
    { key: 'c', caption: true, label: `${surface.name} · ${Math.round(size.width)}×${Math.round(size.height)} px` },
    { key: 'all', icon: 'layers', label: 'back to all faces (esc)', onSelect: () => ed.setFaceZoom(null) },
    { key: 'prev', icon: 'prev', label: 'previous face ([)', disabled: order.length < 2, onSelect: () => go(-1) },
    { key: 'next', icon: 'next', label: 'next face (])', disabled: order.length < 2, onSelect: () => go(1) },
    { key: 'c2', caption: true, label: 'drawing' },
    { key: 'clear', icon: 'trash', label: 'remove every stroke on this face', danger: true, disabled: !strokes.length, onSelect: () => void ed.editing.edit((sc) => clearStrokes(sc, surfaceId)) },
  ]

  return (
    <>
      <ContentHead
        objectId={objectId}
        surfaceId={surfaceId}
        onHelp={onHelp}
        meta={`${Math.round(size.width)}×${Math.round(size.height)} px`}
        hint="What this face shows on the wall. Esc goes back to all faces."
      >
        <div className={s.toolGroup} role="group" aria-label="face tool">
          {FACE_TOOLS.map((ft) => (
            <ToolButton key={ft.value} icon={ft.icon} label={ft.label} on={tool === ft.value} tip={ft.title} onClick={() => setTool(ft.value)} testId={`face-tool-${ft.value}`} />
          ))}
        </div>
        <TipPill tip="add a picture or a video to this face" icon="image" onClick={() => file.current?.click()} data-testid="add-face-media">
          add picture
        </TipPill>
        <EffectMenu
          onPick={(d) => addEffectTo(ed, [surfaceId], d)}
          trigger={({ toggle, open }) => (
            <TipPill tip="add a moving effect to this face: grid, scan, glitch and more" icon="sparkle" aria-expanded={open} onClick={toggle} data-testid="add-face-effect">
              add effect
            </TipPill>
          )}
        />
        <span className={s.sp} />
        <MoreMenu items={more} />
      </ContentHead>
      {drawing && (
        <div className={s.tools} data-testid="draw-options">
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
          <TipPill tip="remove the last stroke" size="sm" ghost icon="undo" disabled={!strokes.length} onClick={() => strokes.length && void ed.editing.edit((sc) => removeStroke(sc, surfaceId, strokes[strokes.length - 1]))}>
            undo stroke
          </TipPill>
          <TipPill
            tip="add a timeline clip at the playhead that draws these strokes on over 3 s"
            size="sm"
            icon="play"
            disabled={!strokes.length}
            onClick={() => {
              const ids = { track: newId('trk'), clip: newId('clp') }
              const at = ed.preview.t()
              void ed.editing.edit((sc) => drawOnClip(sc, surfaceId, at, 3, ids)).then(() => ed.toast('Added a clip that draws the strokes on. Press space to preview it.'))
            }}
          >
            draw on
          </TipPill>
          <TipPill tip="put the pen down and go back to moving pictures (V)" size="sm" icon="select" onClick={() => setTool('move')}>
            done drawing
          </TipPill>
        </div>
      )}
      <div ref={bodyRef} className={s.body} style={{ paddingRight: SIDE }} onDragOver={(e) => (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) && e.preventDefault()} onDrop={onDrop} data-testid="face-body">
        <div className={s.sheet} style={{ width: dispW, height: dispH }}>
          <canvas ref={canvasRef} className={s.canvas} data-testid="face-canvas" />
          <svg
            ref={svgRef}
            className={`${s.ink} ${tool === 'erase' ? s.erase : drawing ? s.draw : ''}`}
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setLive(null)}
            data-testid="flat-ink"
          >
            <rect x={0} y={0} width={size.width} height={size.height} className={s.faceEdge} strokeWidth={1.5 * u} />
            {live && lp.length > 0 && (
              <g className={s.liveStroke} stroke={style.color} fill={style.fill && (live.tool === 'rect' || live.tool === 'ellipse') ? style.color : 'none'} strokeWidth={Math.max(sw, 0.5)}>
                {live.tool === 'pen' && <polyline points={lp.map((p) => p.join(',')).join(' ')} fill="none" />}
                {live.tool === 'line' && lp.length > 1 && <line x1={lp[0][0]} y1={lp[0][1]} x2={lp[1][0]} y2={lp[1][1]} />}
                {live.tool === 'rect' && lp.length > 1 && <rect x={Math.min(lp[0][0], lp[1][0])} y={Math.min(lp[0][1], lp[1][1])} width={Math.abs(lp[1][0] - lp[0][0])} height={Math.abs(lp[1][1] - lp[0][1])} />}
                {live.tool === 'ellipse' && lp.length > 1 && <ellipse cx={(lp[0][0] + lp[1][0]) / 2} cy={(lp[0][1] + lp[1][1]) / 2} rx={Math.abs(lp[1][0] - lp[0][0]) / 2} ry={Math.abs(lp[1][1] - lp[0][1]) / 2} />}
              </g>
            )}
            {faceLayer && <LayerHandles layer={faceLayer} W={size.width} H={size.height} k={u} toCanvas={toPx} onChange={(c, ph) => writeLayer(ed, faceLayer.id, c, ph)} />}
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
        <MiniMap objectId={objectId} current={surfaceId} />
        {empty && (
          <EmptyActions
            title={`${surface.name} is empty`}
            text="What should this face show? Pick one. You can add more at any time."
            pictureNote="a photo or a video from this computer"
            drawNote="pen, shapes and text, right on the face"
            effectNote="a moving effect: grid, scan, glitch"
            onPicture={() => file.current?.click()}
            onDraw={() => setTool('pen')}
            onEffect={(d) => addEffectTo(ed, [surfaceId], d)}
            onClose={() => setHideEmpty(true)}
          />
        )}
      </div>
      <div className={s.hints}>
        <HintBar
          hints={[
            { keys: 'esc', text: 'all faces' },
            { keys: '[ ]', text: 'faces' },
            { keys: 'V', text: 'move' },
            { keys: '1–6', text: 'draw' },
            { keys: '⌘V', text: 'paste picture' },
          ]}
        />
      </div>
      <input ref={file} type="file" accept="image/*,video/*" hidden onChange={(e) => {
        const fs = [...(e.target.files ?? [])]
        e.target.value = ''
        if (fs.length) void ed.addMedia(fs, { kind: 'surface', id: surfaceId })
      }} data-testid="face-media-input" />
    </>
  )
}

// ── picture in picture: the warped stage, live ───────────────────────────────

const PIP_W = 226

function Pip() {
  const ed = useEditor()
  const [open, setOpen] = useState(true)
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 52 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRenderer(canvasRef, open)
  const input = useInput()
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null)
  const W = ed.setup ? (ed.setup.output.orientation === 'landscape' ? ed.setup.output.width : ed.setup.output.height) : 1920
  const H = ed.setup ? (ed.setup.output.orientation === 'landscape' ? ed.setup.output.height : ed.setup.output.width) : 1080
  const h = Math.round((PIP_W * H) / W)

  useRaf(() => {
    const r = renderer.current
    const inp = input()
    if (!r || !inp || !open) return
    const dpr = window.devicePixelRatio || 1
    r.setSize(Math.round(PIP_W * dpr), Math.round(h * dpr))
    r.render({ ...inp, solo: ed.solo ? { surfaceIds: ed.solo, fill: 'content', others: 0.15 } : null })
  }, 30)

  const onDown = useCallback((e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom }
  }, [pos])
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (d) setPos({ right: Math.max(4, d.right - (e.clientX - d.x)), bottom: Math.max(4, d.bottom - (e.clientY - d.y)) })
  }
  if (!open) {
    return (
      <span className={s.pipOpen} data-tour="content-pip">
        <TipPill tip="show the stage picture: your content warped onto the object, live" side="top" size="sm" icon="pip" onClick={() => setOpen(true)} data-testid="pip-open">
          show the stage
        </TipPill>
      </span>
    )
  }
  return (
    <div className={s.pip} style={{ right: pos.right, bottom: pos.bottom, width: PIP_W }} data-testid="pip" data-tour="content-pip">
      <div className={s.pipHead} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} title="drag to move the stage picture">
        <Cap>the stage, live</Cap>
        <TipPill tip="hide the stage picture" side="top" size="sm" ghost icon="minus" aria-label="hide the stage picture" onClick={() => setOpen(false)} data-testid="pip-close" />
      </div>
      <canvas ref={canvasRef} className={s.pipCanvas} style={{ height: h }} data-testid="pip-canvas" />
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { newId } from '../../../../shared/lib/ids'
import { pointer } from '../../../../shared/lib/jsonPatch'
import { schemaDefaults } from '../../../effect'
import { useEditor, type Tool } from '../../editor/context'
import { clockwise, dist, meshPoints, orderQuad, outlineOf, pointInPolygon, resampleMesh, segDist, type Vec } from '../../geometry'
import { addContentLayer, addSurface, addSurfaceEffect, flatMesh, locateSurface, mediaLayer, mergePoint, surfacePath } from '../../ops'
import type { Point, Scene, Surface, SurfaceKind } from '../../types'
import s from './styles.module.css'

const SNAP_PX = 9
const HANDLE_PX = 10

type Drag =
  | { kind: 'point'; id: string; start: Vec; origin: Vec; snap: string | null; moved: boolean }
  | { kind: 'surface'; ids: string[]; start: Vec; origins: Map<string, Vec>; moved: boolean }
  | { kind: 'mesh'; surfaceId: string; index: number; start: Vec; origin: [number, number]; moved: boolean }

interface DrawPt {
  id: string | null
  x: number
  y: number
}

const NEED: Record<Tool, number> = { select: 0, quad: 4, mesh: 4, tri: 3, circle: 2, poly: 0, line: 0, mask: 0 }
const MIN: Record<Tool, number> = { select: 0, quad: 4, mesh: 4, tri: 3, circle: 2, poly: 3, line: 2, mask: 3 }

export interface OverlayApi {
  finishDrawing: () => void
  cancelDrawing: () => boolean
  drawing: boolean
}

/**
 * The SVG layer over the stage frame, in scene pixels: outlines, point handles, mesh handles, the drawing preview, and
 * every pointer interaction (drag points with the magnet, move surfaces, draw new surfaces, drop effects).
 */
export function StageOverlay({
  W,
  H,
  pxPerScreen,
  showHandles,
  onApi,
  dim,
}: {
  W: number
  H: number
  /** scene pixels per CSS pixel (for constant-size handles) */
  pxPerScreen: number
  showHandles: boolean
  onApi?: (api: OverlayApi) => void
  /** draw outlines dimmer (input view over a photo keeps them bright) */
  dim?: boolean
}) {
  const ed = useEditor()
  const scene = ed.scene
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [draw, setDraw] = useState<DrawPt[]>([])
  const [cursor, setCursor] = useState<Vec | null>(null)
  const k = pxPerScreen
  const pts = useMemo(() => new Map((scene?.points ?? []).map((p) => [p.id, p])), [scene?.points])
  const selSurface = useMemo(() => (scene && ed.sel.surfaceId ? findSurface(scene, ed.sel.surfaceId) : null), [scene, ed.sel.surfaceId])

  const toScene = (e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const snapTarget = (p: Vec, exclude: string | null, useMagnet: boolean): Point | null => {
    if (!useMagnet || !scene) return null
    let best: Point | null = null
    let bd = SNAP_PX * k
    for (const q of scene.points) {
      if (q.id === exclude) continue
      const d = dist(p, q)
      if (d < bd) {
        bd = d
        best = q
      }
    }
    return best
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  const finish = (ptsIn: DrawPt[]) => {
    const tool = ed.tool
    if (!scene || ptsIn.length < MIN[tool]) return
    const kind: SurfaceKind = tool === 'mesh' ? 'quad' : (tool as SurfaceKind)
    let ordered = ptsIn
    if (kind === 'quad') ordered = orderQuad(ptsIn)
    else if (kind === 'tri' || kind === 'poly' || kind === 'mask') ordered = clockwise(ptsIn)
    const newPoints: Point[] = []
    const ids = ordered.map((p) => {
      if (p.id) return p.id
      const id = newId('p')
      newPoints.push({ id, x: Math.round(p.x), y: Math.round(p.y) })
      return id
    })
    // inside the selected face → a detail of it
    const parent = selSurface && selSurface.surface.role === 'face' && selSurface.surface.kind !== 'line' ? selSurface.surface : null
    const parentPoly = parent ? outlineOf(parent.kind, parent.pointIds.map((id) => pts.get(id)).filter((x): x is Point => !!x)) : null
    const inside = !!parentPoly && kind !== 'mask' && ordered.every((p) => pointInPolygon(p, parentPoly))
    const objectId = inside ? selSurface!.objectId : ed.sel.objectId && scene.objects.some((o) => o.id === ed.sel.objectId) ? ed.sel.objectId : null
    const count = scene.objects.reduce((a, o) => a + o.surfaces.filter((x) => x.kind === kind).length, 0)
    const surface: Surface = {
      id: newId('srf'),
      name: `${kind === 'quad' && tool === 'mesh' ? 'mesh' : kind} ${count + 1}`,
      kind,
      role: inside ? 'detail' : kind === 'line' ? 'edge' : 'face',
      pointIds: ids,
      parentId: inside ? parent!.id : null,
      visible: true,
      mesh: tool === 'mesh' ? flatMesh(4, 4) : null,
      effects: [],
      opacity: 1,
      softEdge: kind === 'line' || inside ? 0 : 8,
    }
    const objId = objectId ?? newId('obj')
    const objName = kind === 'mask' ? 'mask' : `object ${scene.objects.length + 1}`
    void ed.editing.edit((sc) => addSurface(sc, objectId, surface, newPoints, objectId ? undefined : { id: objId, name: objName, tags: [], visible: true }))
    ed.select({ objectId: objId, surfaceId: surface.id, pointId: null, meshIndex: null, focus: 'surface' })
    setDraw([])
  }

  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    onApi?.({
      finishDrawing: () => finishRef.current(draw),
      cancelDrawing: () => {
        if (!draw.length) return false
        setDraw([])
        return true
      },
      drawing: draw.length > 0,
    })
  }, [draw, onApi])

  useEffect(() => setDraw([]), [ed.tool])

  // ── pointer ────────────────────────────────────────────────────────────────

  const begin = (e: PointerEvent, d: Drag) => {
    e.stopPropagation()
    e.preventDefault()
    svgRef.current!.setPointerCapture(e.pointerId)
    dragRef.current = d
    setDrag(d)
  }

  const onPointPointerDown = (e: PointerEvent, p: Point) => {
    if (e.button !== 0) return
    if (ed.tool !== 'select') return // drawing tools handle the click on the svg (and snap to this point)
    const owner = selSurface?.surface.pointIds.includes(p.id) ? selSurface : scene ? firstSurfaceUsing(scene, p.id) : null
    ed.select({ pointId: p.id, surfaceId: owner?.surface.id ?? null, objectId: owner?.objectId ?? ed.sel.objectId, meshIndex: null, focus: 'surface' })
    if (selSurface?.surface.mesh && ed.lockCorners && selSurface.surface.pointIds.includes(p.id) && ed.sel.meshIndex !== null) return
    begin(e, { kind: 'point', id: p.id, start: toScene(e), origin: { x: p.x, y: p.y }, snap: null, moved: false })
  }

  const onSurfacePointerDown = (e: PointerEvent, srf: Surface, objectId: string) => {
    if (e.button !== 0 || ed.tool !== 'select') return
    if (e.altKey && srf.kind === 'quad') {
      e.stopPropagation()
      addMeshPoint(srf)
      return
    }
    ed.select({ surfaceId: srf.id, objectId, pointId: null, meshIndex: null, focus: 'surface' })
    const origins = new Map<string, Vec>()
    for (const id of srf.pointIds) {
      const p = pts.get(id)
      if (p) origins.set(id, { x: p.x, y: p.y })
    }
    begin(e, { kind: 'surface', ids: [...origins.keys()], start: toScene(e), origins, moved: false })
  }

  const onMeshPointerDown = (e: PointerEvent, srf: Surface, index: number) => {
    if (e.button !== 0) return
    ed.select({ meshIndex: index, pointId: null })
    const o = srf.mesh!.offsets[index] ?? [0, 0]
    begin(e, { kind: 'mesh', surfaceId: srf.id, index, start: toScene(e), origin: [o[0], o[1]], moved: false })
  }

  const addMeshPoint = (srf: Surface) => {
    const next = srf.mesh ? { cols: srf.mesh.cols + 1, rows: srf.mesh.rows + 1 } : { cols: 2, rows: 2 }
    void ed.editing.edit((sc) => {
      const loc = locateSurface(sc, srf.id)
      if (!loc) return null
      const cur = sc.objects[loc.o].surfaces[loc.s].mesh
      return [{ op: 'replace', path: surfacePath(loc, 'mesh'), value: cur ? resampleMesh(cur, next.cols, next.rows) : flatMesh(next.cols, next.rows) }]
    })
    ed.select({ surfaceId: srf.id, focus: 'surface' })
  }

  const onMove = (e: PointerEvent) => {
    const p = toScene(e)
    setCursor(p)
    const d = dragRef.current
    if (!d || !scene) return
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    if (!d.moved && Math.hypot(dx, dy) < 1.5 * k) return
    d.moved = true
    const magnet = ed.magnet !== (e.metaKey || e.ctrlKey)
    if (d.kind === 'point') {
      let x = Math.round(d.origin.x + dx)
      let y = Math.round(d.origin.y + dy)
      const t = snapTarget({ x, y }, d.id, magnet)
      d.snap = t?.id ?? null
      if (t) {
        x = t.x
        y = t.y
      }
      const i = scene.points.findIndex((q) => q.id === d.id)
      if (i >= 0)
        ed.editing.setValues(
          [
            [pointer('points', i, 'x'), x],
            [pointer('points', i, 'y'), y],
          ],
          'live',
        )
    } else if (d.kind === 'surface') {
      const entries: Array<[string, unknown]> = []
      for (const id of d.ids) {
        const i = scene.points.findIndex((q) => q.id === id)
        const o = d.origins.get(id)!
        if (i >= 0) entries.push([pointer('points', i, 'x'), Math.round(o.x + dx)], [pointer('points', i, 'y'), Math.round(o.y + dy)])
      }
      ed.editing.setValues(entries, 'live')
    } else if (d.kind === 'mesh') {
      const loc = locateSurface(scene, d.surfaceId)
      if (loc)
        ed.editing.setValues(
          [
            [surfacePath(loc, 'mesh', 'offsets', d.index, 0), Math.round((d.origin[0] + dx) * 10) / 10],
            [surfacePath(loc, 'mesh', 'offsets', d.index, 1), Math.round((d.origin[1] + dy) * 10) / 10],
          ],
          'live',
        )
    }
    setDrag({ ...d })
  }

  const onUp = (e: PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d || !d.moved || !scene) return
    const p = toScene(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    if (d.kind === 'point') {
      const i = scene.points.findIndex((q) => q.id === d.id)
      const t = d.snap ? scene.points.find((q) => q.id === d.snap) : null
      const x = t ? t.x : Math.round(d.origin.x + dx)
      const y = t ? t.y : Math.round(d.origin.y + dy)
      if (i >= 0)
        ed.editing.setValues(
          [
            [pointer('points', i, 'x'), x],
            [pointer('points', i, 'y'), y],
          ],
          'final',
        )
      if (t) {
        const from = d.id
        const to = t.id
        void ed.editing.edit((sc) => mergePoint(sc, from, to))
        ed.select({ pointId: to })
      }
    } else if (d.kind === 'surface') {
      const entries: Array<[string, unknown]> = []
      for (const id of d.ids) {
        const i = scene.points.findIndex((q) => q.id === id)
        const o = d.origins.get(id)!
        if (i >= 0) entries.push([pointer('points', i, 'x'), Math.round(o.x + dx)], [pointer('points', i, 'y'), Math.round(o.y + dy)])
      }
      ed.editing.setValues(entries, 'final')
    } else if (d.kind === 'mesh') {
      const loc = locateSurface(scene, d.surfaceId)
      if (loc)
        ed.editing.setValues(
          [
            [surfacePath(loc, 'mesh', 'offsets', d.index, 0), Math.round((d.origin[0] + dx) * 10) / 10],
            [surfacePath(loc, 'mesh', 'offsets', d.index, 1), Math.round((d.origin[1] + dy) * 10) / 10],
          ],
          'final',
        )
    }
  }

  const onSvgPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (ed.tool === 'select') {
      // empty space: clear the selection (the stage pans on drag)
      ed.select({ surfaceId: null, pointId: null, meshIndex: null, focus: ed.sel.focus === 'surface' ? null : ed.sel.focus })
      return
    }
    e.stopPropagation()
    const raw = toScene(e)
    const magnet = ed.magnet !== (e.metaKey || e.ctrlKey)
    // clicking the first point closes a polygon
    if (draw.length >= MIN[ed.tool] && NEED[ed.tool] === 0 && dist(raw, draw[0]) < SNAP_PX * k && ed.tool !== 'line') {
      finish(draw)
      return
    }
    const t = snapTarget(raw, null, magnet)
    const pt: DrawPt = t ? { id: t.id, x: t.x, y: t.y } : { id: null, x: Math.round(raw.x), y: Math.round(raw.y) }
    if (draw.some((q) => q.id && q.id === pt.id) && ed.tool !== 'line') return
    const next = [...draw, pt]
    if (NEED[ed.tool] && next.length >= NEED[ed.tool]) finish(next)
    else setDraw(next)
  }

  const onDouble = (e: { clientX: number; clientY: number }) => {
    if (ed.tool === 'select' && scene) {
      // double-click a surface: open it flat to see and draw on it
      const hit = hitSurface(scene, pts, toScene(e), k)
      if (hit && hit.surface.kind !== 'line' && hit.surface.kind !== 'mask') ed.editFace(hit.surface.id)
      return
    }
    if (draw.length >= MIN[ed.tool] && NEED[ed.tool] === 0) finish(draw)
  }

  const onDrop = (e: DragEvent) => {
    if (!scene) return
    const files = [...e.dataTransfer.files]
    const data = e.dataTransfer.getData('text/plain')
    if (files.length || data.startsWith('media:')) {
      // a picture or video dropped on a face becomes a media layer of that face (protocol §12)
      e.preventDefault()
      const hit = hitSurface(scene, pts, toScene(e), k)
      if (!hit || hit.surface.kind === 'line' || hit.surface.kind === 'mask') {
        ed.toast('Drop the picture onto a face.')
        return
      }
      ed.select({ surfaceId: hit.surface.id, objectId: hit.objectId, focus: 'surface' })
      if (files.length) void ed.addMedia(files, { kind: 'surface', id: hit.surface.id })
      else {
        const src = data.slice(6)
        const name = data.split('|')[1] ?? 'picture'
        const layer = mediaLayer(newId('cl'), src.split('|')[0], name)
        void ed.editing.edit((sc) => addContentLayer(sc, { kind: 'surface', id: hit.surface.id }, layer))
        ed.select({ contentLayerId: layer.id, focus: 'content' })
      }
      return
    }
    if (!data.startsWith('effect:')) return
    e.preventDefault()
    const p = toScene(e)
    const hit = hitSurface(scene, pts, p, k)
    if (!hit) {
      ed.toast('Drop the effect onto a surface.')
      return
    }
    const def = ed.effects.find((x) => x.id === data.slice(7))
    if (!def) return
    void ed.editing.edit((sc) => addSurfaceEffect(sc, hit.surface.id, { id: newId('fx'), effect: def.id, enabled: true, params: schemaDefaults(def.params) }))
    ed.select({ surfaceId: hit.surface.id, objectId: hit.objectId, focus: 'surface' })
  }

  if (!scene) return <svg ref={svgRef} className={s.overlay} viewBox={`0 0 ${W} ${H}`} />

  const handle = HANDLE_PX * k
  const sw = (n: number) => n * k
  const selObj = ed.sel.objectId
  const selPoint = ed.sel.pointId ? pts.get(ed.sel.pointId) : null
  const drawingPoly = draw.length ? [...draw, ...(cursor ? [cursor] : [])] : []
  const handleIds = new Set<string>()
  for (const o of scene.objects) if (o.visible) for (const srf of o.surfaces) if (srf.visible) srf.pointIds.forEach((id) => handleIds.add(id))
  const selMesh = selSurface?.surface.kind === 'quad' && selSurface.surface.mesh ? selSurface.surface : null
  const selQuad = selMesh ? (selMesh.pointIds.map((id) => pts.get(id)).filter(Boolean) as Point[]) : null

  return (
    <svg
      ref={svgRef}
      className={`${s.overlay} ${ed.tool !== 'select' ? s.drawing : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={onSvgPointerDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={onDouble}
      onDragOver={(e) => (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('Files')) && e.preventDefault()}
      onDrop={onDrop}
      data-testid="stage-overlay"
    >
      <defs>
        <pattern id="pm-hatch" width={sw(6)} height={sw(6)} patternUnits="userSpaceOnUse">
          <circle cx={sw(3)} cy={sw(3)} r={sw(0.9)} className={s.hatchDot} />
        </pattern>
        <pattern id="pm-mask" width={sw(8)} height={sw(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={sw(8)} height={sw(8)} className={s.maskBg} />
          <line x1="0" y1="0" x2="0" y2={sw(8)} className={s.maskLine} strokeWidth={sw(1.5)} />
        </pattern>
      </defs>

      {scene.objects.map((o) =>
        o.surfaces.map((srf) => {
          const ps = srf.pointIds.map((id) => pts.get(id)).filter((x): x is Point => !!x)
          if (!ps.length) return null
          const sel = ed.sel.surfaceId === srf.id
          const inSelObj = !selObj || selObj === o.id
          const hidden = !o.visible || !srf.visible
          const cls = [s.srf, sel && s.sel, srf.role === 'detail' && s.detail, !inSelObj && s.other, hidden && s.hidden, dim && s.dimmed].filter(Boolean).join(' ')
          const strokeW = sw(sel ? 2 : srf.role === 'detail' ? 1.5 : 1.75)
          const dash = srf.role === 'detail' && !sel ? `${sw(4)} ${sw(3)}` : undefined
          const common = {
            className: cls,
            strokeWidth: strokeW,
            strokeDasharray: dash,
            onPointerDown: (e: PointerEvent) => onSurfacePointerDown(e, srf, o.id),
            'data-surface': srf.id,
          }
          if (srf.kind === 'line')
            return (
              <g key={srf.id}>
                <polyline points={ps.map((p) => `${p.x},${p.y}`).join(' ')} className={s.hitLine} strokeWidth={sw(12)} onPointerDown={common.onPointerDown} />
                <polyline points={ps.map((p) => `${p.x},${p.y}`).join(' ')} {...common} fill="none" pointerEvents="none" />
              </g>
            )
          if (srf.kind === 'circle' && ps.length >= 2)
            return <circle key={srf.id} cx={ps[0].x} cy={ps[0].y} r={dist(ps[0], ps[1])} {...common} fill={sel ? 'url(#pm-hatch)' : 'transparent'} />
          const outline = selMesh && selMesh.id === srf.id && selQuad?.length === 4 ? meshOutline(selQuad, selMesh.mesh!) : ps
          return <polygon key={srf.id} points={outline.map((p) => `${p.x},${p.y}`).join(' ')} {...common} fill={srf.kind === 'mask' ? 'url(#pm-mask)' : sel ? 'url(#pm-hatch)' : 'transparent'} />
        }),
      )}

      {/* mesh grid of the selected quad */}
      {selMesh && selQuad?.length === 4 && (
        <g>
          {meshLines(selQuad, selMesh.mesh!).map((l, i) => (
            <polyline key={i} points={l.map((p) => `${p.x},${p.y}`).join(' ')} className={s.meshLine} strokeWidth={sw(1)} />
          ))}
          {showHandles &&
            meshPoints(selQuad, selMesh.mesh!).map((p, i) => {
              const corner = isCorner(i, selMesh.mesh!.cols, selMesh.mesh!.rows)
              if (corner) return null
              const on = ed.sel.meshIndex === i
              return <circle key={i} cx={p.x} cy={p.y} r={sw(on ? 5 : 4)} className={on ? s.meshHandleOn : s.meshHandle} strokeWidth={sw(1.5)} onPointerDown={(e) => onMeshPointerDown(e, selMesh, i)} data-testid={`mesh-${i}`} />
            })}
        </g>
      )}

      {showHandles &&
        [...handleIds].map((id) => {
          const p = pts.get(id)
          if (!p) return null
          const on = ed.sel.pointId === id
          const inSel = selSurface?.surface.pointIds.includes(id)
          const target = drag?.kind === 'point' && drag.snap === id
          const size = on ? handle * 1.6 : inSel ? handle : handle * 0.8
          return (
            <g key={id} onPointerDown={(e) => onPointPointerDown(e, p)} className={s.handleG} data-point={id}>
              <rect x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} className={on ? s.handleOn : target ? s.handleTarget : s.handle} strokeWidth={sw(2)} />
              {on && <rect x={p.x - sw(2)} y={p.y - sw(2)} width={sw(4)} height={sw(4)} className={s.handleDot} />}
            </g>
          )
        })}

      {/* the drawing in progress */}
      {drawingPoly.length > 0 && (
        <g pointerEvents="none">
          {ed.tool === 'circle' && drawingPoly.length >= 2 ? (
            <circle cx={drawingPoly[0].x} cy={drawingPoly[0].y} r={dist(drawingPoly[0], drawingPoly[1])} className={s.preview} strokeWidth={sw(1.5)} strokeDasharray={`${sw(5)} ${sw(4)}`} />
          ) : (
            <polyline points={drawingPoly.map((p) => `${p.x},${p.y}`).join(' ')} className={s.preview} strokeWidth={sw(1.5)} strokeDasharray={`${sw(5)} ${sw(4)}`} />
          )}
          {draw.map((p, i) => (
            <rect key={i} x={p.x - handle / 2} y={p.y - handle / 2} width={handle} height={handle} className={s.handleOn} strokeWidth={sw(2)} />
          ))}
        </g>
      )}

      {/* the point readout: P2 · 1404, 318 px */}
      {selPoint && showHandles && (
        <g pointerEvents="none" className={s.readout}>
          <rect x={selPoint.x + sw(14)} y={selPoint.y - sw(36)} width={sw(pointLabel(scene, selSurface?.surface ?? null, selPoint).length * 6.6 + 14)} height={sw(20)} className={s.readoutBg} />
          <text x={selPoint.x + sw(21)} y={selPoint.y - sw(22)} fontSize={sw(11)} className={s.readoutText}>
            {pointLabel(scene, selSurface?.surface ?? null, selPoint)}
          </text>
        </g>
      )}
    </svg>
  )
}

function findSurface(scene: Scene, id: string): { surface: Surface; objectId: string } | null {
  for (const o of scene.objects) for (const srf of o.surfaces) if (srf.id === id) return { surface: srf, objectId: o.id }
  return null
}

function firstSurfaceUsing(scene: Scene, pid: string): { surface: Surface; objectId: string } | null {
  for (const o of scene.objects) for (const srf of o.surfaces) if (srf.pointIds.includes(pid)) return { surface: srf, objectId: o.id }
  return null
}

export function pointLabel(scene: Scene, srf: Surface | null, p: Point): string {
  const i = srf ? srf.pointIds.indexOf(p.id) : -1
  const name = i >= 0 ? `P${i + 1}` : p.id
  void scene
  return `${name} · ${Math.round(p.x)}, ${Math.round(p.y)} px`
}

/** The surface under p (details and masks first, then faces, then lines by distance). */
export function hitSurface(scene: Scene, pts: Map<string, Point>, p: Vec, k: number): { surface: Surface; objectId: string } | null {
  const all: Array<{ surface: Surface; objectId: string }> = []
  for (const o of scene.objects) for (const srf of o.surfaces) all.push({ surface: srf, objectId: o.id })
  const order = [...all].reverse()
  for (const h of order) {
    const ps = h.surface.pointIds.map((id) => pts.get(id)).filter((x): x is Point => !!x)
    if (h.surface.kind === 'line') {
      for (let i = 0; i + 1 < ps.length; i++) if (segDist(p, ps[i], ps[i + 1]) < 8 * k) return h
      continue
    }
    if (pointInPolygon(p, outlineOf(h.surface.kind, ps))) return h
  }
  return null
}

function isCorner(i: number, cols: number, rows: number) {
  const r = Math.floor(i / (cols + 1))
  const c = i % (cols + 1)
  return (r === 0 || r === rows) && (c === 0 || c === cols)
}

function meshLines(quad: Vec[], mesh: NonNullable<Surface['mesh']>): Vec[][] {
  const mp = meshPoints(quad, mesh)
  const at = (r: number, c: number) => mp[r * (mesh.cols + 1) + c]
  const lines: Vec[][] = []
  for (let r = 0; r <= mesh.rows; r++) lines.push(Array.from({ length: mesh.cols + 1 }, (_, c) => at(r, c)))
  for (let c = 0; c <= mesh.cols; c++) lines.push(Array.from({ length: mesh.rows + 1 }, (_, r) => at(r, c)))
  return lines
}

function meshOutline(quad: Vec[], mesh: NonNullable<Surface['mesh']>): Vec[] {
  const mp = meshPoints(quad, mesh)
  const at = (r: number, c: number) => mp[r * (mesh.cols + 1) + c]
  const out: Vec[] = []
  for (let c = 0; c <= mesh.cols; c++) out.push(at(0, c))
  for (let r = 1; r <= mesh.rows; r++) out.push(at(r, mesh.cols))
  for (let c = mesh.cols - 1; c >= 0; c--) out.push(at(mesh.rows, c))
  for (let r = mesh.rows - 1; r >= 1; r--) out.push(at(r, 0))
  return out
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { draftApi } from '../../../draft/api'
import { assetUrl } from '../../../asset/types'
import { sceneSize } from '../../../setup/types'
import { ambientClock } from '../../../show/live'
import { Renderer } from '../../../../render'
import { Cap, FillSlider, HintBar, Menu, Pill, Row, Segmented, Switch, Tools } from '../../../../shared/components'
import { pointer } from '../../../../shared/lib/jsonPatch'
import { useRaf } from '../../../../shared/lib/useRaf'
import { useEditor, type SoloFill, type StageView } from '../../editor/context'
import { underlayOf } from '../../lib'
import { locateSurface, setUnderlay, surfacePath } from '../../ops'
import { BACKDROP_MODES, type BackdropMode, type Point } from '../../types'
import { TOOL_ITEMS } from '../editorBar'
import { StageOverlay, type OverlayApi } from './overlay'
import s from './styles.module.css'

const LOUPE = 128
const LOUPE_ZOOM = 10

/**
 * The mapping stage: the rendered output (same engine as the wall) over the reference photo, with the editable
 * overlay. Zoom with ⌘/ctrl + wheel or pinch, pan by dragging empty space or with the wheel.
 */
export function Stage() {
  const ed = useEditor()
  const setup = ed.setup
  const size = setup ? sceneSize(setup.output) : { width: 1920, height: 1080 }
  const W = size.width
  const H = size.height
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 800, h: 450 })
  const [scale, setScale] = useState<number | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const refImg = useRef<HTMLImageElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const overlayApi = useRef<OverlayApi | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const [drawingPts, setDrawingPts] = useState(false)
  const split = ed.view === 'split'
  const halves = split ? 2 : 1
  const slotW = (area.w - (split ? 8 : 0)) / halves
  const fit = Math.max(0.05, Math.min((slotW - 48) / W, (area.h - 64) / H))
  const k = scale ?? fit
  const refUrl = setup?.referenceAsset ? assetUrl(setup.referenceAsset) : null
  const showOutput = ed.view !== 'input'

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setArea({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // the stage renderer
  useEffect(() => {
    if (!showOutput) return
    const c = canvasRef.current
    if (!c) return
    try {
      const r = new Renderer(c, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: 1920 })
      // report each broken user or agent effect once
      const seen = new Set<string>()
      r.onEffectError = (e) => {
        const key = `${e.effectId}:${e.message}`
        if (seen.has(key)) return
        seen.add(key)
        ed.toast(`The effect ${e.effectId} doesn't compile: ${e.message.split('\n')[0]}`, { bad: true })
      }
      renderer.current = r
      setGlError(null)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
    // the toast function is stable; the renderer lives as long as the output view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOutput])

  const frameW = W * k
  const frameH = H * k

  useRaf(() => {
    const r = renderer.current
    if (!r || !setup) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(16, Math.min(W, Math.round(frameW * dpr), 2048))
    r.setSize(cw, Math.max(9, Math.round((cw * H) / W)))
    r.render({
      setup,
      scene: ed.scene,
      catalog: ed.catalog,
      effects: ed.userEffects,
      // the editor's own playhead: previewing never touches the wall
      t: ed.preview.t(),
      clock: ambientClock(ed.hub),
      now: ed.hub.serverNow(),
      blackout: 0,
      testPattern: ed.testGrid ? 'grid' : 'off',
      mutedTracks: ed.mutedTracks,
      // the stage always previews objects mode so the mapping shows; the wall keeps scene.mode
      mode: 'objects',
      solo: ed.solo ? { surfaceIds: ed.solo, fill: 'content', others: 0.15 } : null,
    })
    drawLoupe()
  })

  const selPoint: Point | null = ed.scene && ed.sel.pointId ? ed.scene.points.find((p) => p.id === ed.sel.pointId) ?? null : null

  const drawLoupe = () => {
    const lc = loupeRef.current
    const r = renderer.current
    if (!lc || !selPoint) return
    const ctx = lc.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    if (lc.width !== LOUPE * dpr) {
      lc.width = LOUPE * dpr
      lc.height = LOUPE * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = getComputedStyle(lc).getPropertyValue('--stage') || 'black'
    ctx.fillRect(0, 0, LOUPE, LOUPE)
    const span = LOUPE / LOUPE_ZOOM
    const sx = Math.floor(selPoint.x) - Math.floor(span / 2)
    const sy = Math.floor(selPoint.y) - Math.floor(span / 2)
    const img = refImg.current
    if (ed.reference && img?.complete && img.naturalWidth) ctx.drawImage(img, (sx / W) * img.naturalWidth, (sy / H) * img.naturalHeight, (span / W) * img.naturalWidth, (span / H) * img.naturalHeight, 0, 0, LOUPE, LOUPE)
    if (r) {
      ctx.globalCompositeOperation = ed.reference ? 'screen' : 'source-over'
      const cs = r.canvas.width / W
      ctx.drawImage(r.canvas as HTMLCanvasElement, sx * cs, sy * cs, span * cs, span * cs, 0, 0, LOUPE, LOUPE)
      ctx.globalCompositeOperation = 'source-over'
    }
    // 1 px grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= span; i++) {
      ctx.moveTo(i * LOUPE_ZOOM + 0.5, 0)
      ctx.lineTo(i * LOUPE_ZOOM + 0.5, LOUPE)
      ctx.moveTo(0, i * LOUPE_ZOOM + 0.5)
      ctx.lineTo(LOUPE, i * LOUPE_ZOOM + 0.5)
    }
    ctx.stroke()
    const cx = (Math.floor(selPoint.x) - sx) * LOUPE_ZOOM
    const cy = (Math.floor(selPoint.y) - sy) * LOUPE_ZOOM
    ctx.strokeStyle = getComputedStyle(lc).getPropertyValue('--ink-soft') || 'white'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(0, cy + LOUPE_ZOOM / 2)
    ctx.lineTo(cx, cy + LOUPE_ZOOM / 2)
    ctx.moveTo(cx + LOUPE_ZOOM / 2, cy + LOUPE_ZOOM)
    ctx.lineTo(cx + LOUPE_ZOOM / 2, LOUPE)
    ctx.stroke()
    ctx.strokeStyle = getComputedStyle(lc).getPropertyValue('--red') || 'red'
    ctx.lineWidth = 2
    ctx.strokeRect(cx + 1, cy + 1, LOUPE_ZOOM - 2, LOUPE_ZOOM - 2)
  }

  // ── zoom and pan ───────────────────────────────────────────────────────────

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = areaRef.current!.getBoundingClientRect()
      const mx = e.clientX - rect.left - area.w / 2 - (split ? 0 : 0)
      const my = e.clientY - rect.top - area.h / 2
      const nk = Math.min(40, Math.max(0.05, k * Math.exp(-e.deltaY * 0.0025)))
      // keep the scene point under the cursor in place
      setPan((p) => ({ x: mx - ((mx - p.x) * nk) / k, y: my - ((my - p.y) * nk) / k }))
      setScale(nk)
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
  }

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    // React's wheel listener is passive; block the page zoom here
    const block = (e: globalThis.WheelEvent) => (e.ctrlKey || e.metaKey) && e.preventDefault()
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  const onAreaDown = (e: PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && (e.target === areaRef.current || (e.target as HTMLElement).dataset.slot !== undefined))) {
      panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      if (e.button === 0 && ed.tool === 'select') ed.select({ surfaceId: null, pointId: null, meshIndex: null, focus: ed.sel.focus === 'surface' ? null : ed.sel.focus })
    }
  }
  const onAreaMove = (e: PointerEvent) => {
    const d = panDrag.current
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
  }
  const onAreaUp = () => {
    panDrag.current = null
  }

  const fitView = useCallback(() => {
    setScale(null)
    setPan({ x: 0, y: 0 })
  }, [])

  // ── keyboard: nudge, tab, enter, escape, delete ────────────────────────────

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      const scene = ed.scene
      if (!scene) return
      if (e.key === 'Escape') {
        if (overlayApi.current?.cancelDrawing()) {
          e.preventDefault()
          return
        }
        if (ed.tool !== 'select') {
          e.preventDefault()
          ed.setTool('select')
        } else if (ed.sel.pointId) ed.select({ pointId: null, meshIndex: null })
        return
      }
      if (e.key === 'Enter' && overlayApi.current?.drawing) {
        e.preventDefault()
        overlayApi.current.finishDrawing()
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      if (arrows[e.key] && (ed.sel.pointId || ed.sel.surfaceId || ed.sel.meshIndex !== null) && ed.sel.focus === 'surface') {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const [dx, dy] = arrows[e.key].map((v) => v * step)
        if (ed.sel.meshIndex !== null && ed.sel.surfaceId) {
          const loc = locateSurface(scene, ed.sel.surfaceId)
          const off = loc ? scene.objects[loc.o].surfaces[loc.s].mesh?.offsets[ed.sel.meshIndex] : null
          if (loc && off)
            ed.editing.setValues(
              [
                [surfacePath(loc, 'mesh', 'offsets', ed.sel.meshIndex, 0), off[0] + dx],
                [surfacePath(loc, 'mesh', 'offsets', ed.sel.meshIndex, 1), off[1] + dy],
              ],
              'final',
            )
          return
        }
        const ids = ed.sel.pointId ? [ed.sel.pointId] : (scene.objects.flatMap((o) => o.surfaces).find((x) => x.id === ed.sel.surfaceId)?.pointIds ?? [])
        const entries: Array<[string, unknown]> = []
        for (const id of new Set(ids)) {
          const i = scene.points.findIndex((p) => p.id === id)
          if (i >= 0) entries.push([pointer('points', i, 'x'), scene.points[i].x + dx], [pointer('points', i, 'y'), scene.points[i].y + dy])
        }
        ed.editing.setValues(entries, 'final')
        return
      }
      // [ and ] step through the selected surface's points (tab switches Map and Content)
      if ((e.key === ']' || e.key === '[') && ed.sel.surfaceId) {
        const srf = scene.objects.flatMap((o) => o.surfaces).find((x) => x.id === ed.sel.surfaceId)
        if (!srf || !srf.pointIds.length) return
        e.preventDefault()
        const i = ed.sel.pointId ? srf.pointIds.indexOf(ed.sel.pointId) : -1
        const n = srf.pointIds.length
        ed.select({ pointId: srf.pointIds[(i + (e.key === '[' ? -1 : 1) + n) % n], meshIndex: null, focus: 'surface' })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ed])

  const onApi = useCallback((api: OverlayApi) => {
    overlayApi.current = api
    setDrawingPts(api.drawing)
  }, [])

  const draft = ed.mode === 'backstage' ? ed.editing.draft : null
  const pxPerScreen = 1 / k
  void drawingPts

  const frame = (kind: 'input' | 'output', slot: number) => {
    const cx = slot * (slotW + 8) + slotW / 2 + pan.x
    const cy = area.h / 2 + pan.y
    return (
      <div key={kind} className={s.frame} style={{ left: cx - frameW / 2, top: cy - frameH / 2, width: frameW, height: frameH }} data-testid={`stage-${kind}`}>
        {refUrl && (kind === 'input' || ed.reference) && <img ref={kind === 'output' || !split ? refImg : undefined} src={refUrl} alt="" className={s.ref} draggable={false} />}
        {kind === 'input' && !refUrl && <div className={s.noRef}>no reference photo yet. add one in the projector setup (the 16:9 chip).</div>}
        {kind === 'output' && <canvas ref={canvasRef} className={`${s.canvas} ${ed.reference && refUrl ? s.screen : ''}`} data-testid="stage-canvas" />}
        <span className={s.label}>
          {kind === 'output' ? 'output' : 'input · reference'} · {W}×{H}
        </span>
        <StageOverlay W={W} H={H} pxPerScreen={pxPerScreen} showHandles onApi={slot === halves - 1 ? onApi : undefined} dim={kind === 'output' && !ed.reference} />
        {kind === 'output' && selPoint && (
          <Loupe
            canvasRef={loupeRef}
            left={(selPoint.x / W) * frameW}
            top={(selPoint.y / H) * frameH}
            frameW={frameW}
            frameH={frameH}
          />
        )}
      </div>
    )
  }

  return (
    <section className={s.stage} aria-label="stage">
      <div className={s.sbar}>
        <Tools items={TOOL_ITEMS} value={ed.tool} onChange={ed.setTool} />
        <Segmented<StageView>
          ariaLabel="view"
          size="sm"
          width={150}
          value={ed.view}
          onChange={ed.setView}
          options={[
            { value: 'input', label: 'input' },
            { value: 'output', label: 'output' },
            { value: 'split', label: 'split' },
          ]}
        />
        <Pill size="sm" icon="image" on={ed.reference} onClick={() => ed.setReference(!ed.reference)} aria-pressed={ed.reference} title="show the reference photo behind the stage">
          reference
        </Pill>
        <Pill size="sm" icon="magnet" on={ed.magnet} onClick={() => ed.setMagnet(!ed.magnet)} aria-pressed={ed.magnet} title="snap corners to nearby points (hold ⌘ to skip)">
          magnet
        </Pill>
        <Pill size="sm" icon="testGrid" on={ed.testGrid} onClick={() => ed.setTestGrid(!ed.testGrid)} aria-pressed={ed.testGrid} title="show the grid test pattern here and on the projector for 60 s">
          grid
        </Pill>
        <SoloControl />
        <span className={s.sp} />
        <Pill size="sm" ghost onClick={fitView} title="fit the frame (zoom with ⌘ + scroll)">
          {Math.round(k * 100)}%
        </Pill>
      </div>
      <div ref={areaRef} className={s.area} onWheel={onWheel} onPointerDown={onAreaDown} onPointerMove={onAreaMove} onPointerUp={onAreaUp} onPointerCancel={onAreaUp}>
        {ed.view === 'input' && frame('input', 0)}
        {ed.view === 'output' && frame('output', 0)}
        {split && (
          <>
            {frame('input', 0)}
            {frame('output', 1)}
          </>
        )}
        {(draft || ed.previewDraftId) && (
          <div className={s.draftBar}>
            {draft && (
              <>
                <span className={s.draftChip}>draft · {draft.ops.length} change{draft.ops.length === 1 ? '' : 's'}</span>
                <Pill size="sm" on disabled={!draft.ops.length} onClick={() => draftApi.apply(draft.id).then(() => ed.toast('The draft is live.'), (e) => ed.toast(String(e.message ?? e), { bad: true }))}>
                  apply to live
                </Pill>
                <Pill size="sm" ghost disabled={!draft.ops.length} onClick={() => draftApi.discard(draft.id).then(() => ed.toast('Discarded the draft.'), (e) => ed.toast(String(e.message ?? e), { bad: true }))}>
                  discard
                </Pill>
              </>
            )}
            {ed.previewDraftId && (
              <Pill size="sm" on onClick={() => ed.setPreviewDraftId(null)}>
                previewing proposal · stop
              </Pill>
            )}
          </div>
        )}
        <WallChip />
        {glError && <div className={s.glError}>The stage can't draw the output here: {glError}</div>}
        <div className={s.hints}>
          <HintBar
            hints={[
              { keys: '←↑↓→', text: '1 px' },
              { keys: '⇧', text: '10 px' },
              { keys: '[ ]', text: 'points' },
              { keys: 'F', text: 'edit face' },
              { keys: 'S', text: 'solo' },
              { keys: '⌘', text: ed.magnet ? 'no snap' : 'snap' },
            ]}
          />
        </div>
      </div>
    </section>
  )
}

/** What the wall shows while the stage previews objects, and quick ways to draw flat. */
function WallChip() {
  const ed = useEditor()
  const scene = ed.scene
  if (!scene) return null
  const editable = ed.sel.surfaceId ? scene.objects.flatMap((o) => o.surfaces).find((x) => x.id === ed.sel.surfaceId && x.kind !== 'line' && x.kind !== 'mask') : null
  return (
    <div className={s.wallChip} data-testid="wall-chip">
      {scene.mode === 'objects' ? (
        <span className={s.wallText}>objects on air</span>
      ) : (
        <>
          <span className={s.wallText}>
            previewing objects · wall shows <b>{scene.mode}</b>
          </span>
          <Pill size="sm" onClick={() => ed.setSceneMode('objects')} title="switch the wall to the mapped objects and the timeline" data-testid="objects-on-air">
            put objects on air
          </Pill>
        </>
      )}
      <UnderlayMenu />
      {editable && (
        <Pill size="sm" on icon="edit" onClick={() => ed.editFace(editable.id)} title="open this face in content to put pictures, drawings and effects on it (F, or double-click it)" data-testid="stage-edit-face">
          add content
        </Pill>
      )}
    </div>
  )
}

const FILLS: Array<{ value: SoloFill; label: string; meta: string }> = [
  { value: 'grid', label: 'numbered grid', meta: 'check the warp' },
  { value: 'white', label: 'white', meta: 'see the edges' },
  { value: 'content', label: 'its content', meta: 'as on air' },
]

/** Solo: S shows only the selection here (the rest dims to 15 %); on the wall it lasts 60 s and Esc ends it. */
function SoloControl() {
  const ed = useEditor()
  const wall = !!ed.show?.solo?.surfaceIds?.length
  return (
    <Menu
      width={270}
      trigger={({ toggle }) => (
        <Pill size="sm" icon="solo" on={!!ed.solo || wall} aria-pressed={!!ed.solo} onClick={toggle} title="solo the selection: here (S) or on the wall too (shift+S)" data-testid="solo">
          {wall ? 'solo · wall' : ed.solo ? 'solo' : 'solo'}
        </Pill>
      )}
    >
      {(close) => (
        <div className={s.underlay}>
          <Row>
            <Pill size="sm" on={!!ed.solo} onClick={() => { ed.solo ? ed.clearSolo() : ed.soloSelection(false); close() }} data-testid="solo-here">
              {ed.solo ? 'end solo' : 'solo here (S)'}
            </Pill>
            <Pill size="sm" onClick={() => { ed.soloSelection(true); close() }} data-testid="solo-wall">
              solo on the wall (⇧S)
            </Pill>
          </Row>
          <Cap>the wall shows</Cap>
          <Segmented<SoloFill> ariaLabel="wall solo fill" size="sm" width="100%" value={ed.wallSoloFill} onChange={ed.setWallSoloFill} options={FILLS.map((f) => ({ value: f.value, label: f.label, title: f.meta }))} />
          <span className={s.menuNote}>the wall solo turns itself off after 60 s; esc ends it now.</span>
        </div>
      )}
    </Menu>
  )
}

/** "backdrop under objects": off by default; on draws one backdrop stack dimmed under the mapped objects. */
function UnderlayMenu() {
  const ed = useEditor()
  const scene = ed.scene
  if (!scene) return null
  const u = underlayOf(scene)
  const write = (patch: Partial<typeof u>) => void ed.editing.edit((sc) => setUnderlay(sc, { ...underlayOf(sc), ...patch }))
  return (
    <Menu
      width={300}
      trigger={({ toggle }) => (
        <Pill size="sm" ghost={!u.on} icon="layers" onClick={toggle} aria-pressed={u.on} title="draw a backdrop under the objects in objects mode" data-testid="underlay">
          {u.on ? `under: ${u.from}` : 'no backdrop under'}
        </Pill>
      )}
    >
      {() => (
        <div className={s.underlay}>
          <Row>
            <span>backdrop under objects</span>
            <Switch checked={u.on} onChange={(v) => write({ on: v })} ariaLabel="backdrop under objects" />
          </Row>
          <Cap>which backdrop</Cap>
          <Segmented<BackdropMode> ariaLabel="backdrop under objects from" size="sm" width="100%" value={u.from} onChange={(v) => write({ from: v })} options={BACKDROP_MODES.map((m) => ({ value: m, label: m }))} />
          <FillSlider
            label="level"
            value={u.level}
            display={`${Math.round(u.level * 100)}%`}
            disabled={!u.on}
            onChange={(v, ph) => {
              const val = Math.round(v * 100) / 100
              if (scene.underlay) ed.editing.setValue('/underlay/level', val, ph)
              else if (ph === 'final') write({ level: val })
            }}
          />
        </div>
      )}
    </Menu>
  )
}

function Loupe({ canvasRef, left, top, frameW, frameH }: { canvasRef: React.RefObject<HTMLCanvasElement>; left: number; top: number; frameW: number; frameH: number }) {
  // sit to the lower right of the point, flipped when it would leave the frame
  const dx = left + 90 + LOUPE > frameW ? -90 - LOUPE : 90
  const dy = top + 60 + LOUPE > frameH ? -60 - LOUPE : 60
  const lx = left + dx
  const ly = top + dy
  return (
    <>
      <svg className={s.leader} style={{ left: 0, top: 0, width: frameW, height: frameH }}>
        <line x1={left} y1={top} x2={lx + LOUPE / 2} y2={ly + LOUPE / 2} />
      </svg>
      <div className={s.loupe} style={{ left: lx, top: ly }}>
        <canvas ref={canvasRef} style={{ width: LOUPE, height: LOUPE }} />
        <span className={s.loupeLabel}>loupe ×10 · 1 px grid</span>
      </div>
    </>
  )
}

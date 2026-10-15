/**
 * The light model in the Show space (protocol §15): the light lights the whole frame, attachments (gobos) block it,
 * one focus ring softens everything, the frame slide pans the picture, and motion moves it across the wall.
 */
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Cap, EmptyState, FillSlider, Icon, Pill, Segmented, Switch, Tile } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { pressed } from '../../../../shared/lib/pointer'
import { newId } from '../../../../shared/lib/ids'
import { useRaf } from '../../../../shared/lib/useRaf'
import { metalThumbUrl, thumbUrl, type GoboItem } from '../../../catalog'
import { defaultStackLight, newAttachment, presetMotion, stackLightOf } from '../../../catalog/layers'
import { ParamControls, resolveParams } from '../../../effect'
import type { ParamSchema } from '../../../effect/types'
import { stackAttachments } from '../../../scene/lib'
import { addAttachment, attachmentPath, layerPath, lightPath, pickAttachment, removeAttachment, setMotion, setStackLight, type LightStack, type MotionTarget } from '../../../scene/ops'
import { MOTION_EASINGS, MOTION_LOOPS, type Attachment, type FramePt, type LightFxKind, type Motion, type MotionEasing, type MotionLoop, type StackLight } from '../../../scene/types'
import { gradientCss } from '../../../scene/ui/library'
import { durationFromSpeed, pauseMotion, playMotion, retimeMotion, sampleMotion, speedFromDuration } from '../../../../render/motion'
import { AccentCard } from './accent'
import { Card } from './card'
import { focusLabel, StaticGallery, StaticStack } from './staticGallery'
import { useShow } from './context'
import s from './styles.module.css'

const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000
const pct = (v: number) => `${Math.round(v * 100)}%`
const FX: LightFxKind[] = ['none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police']

/** A human duration: 45 s, 10 min, 1 h 30. */
export function formatSpan(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} s`
  if (sec < 5400) return `${Math.round(sec / 60)} min`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec - h * 3600) / 60)
  return m ? `${h} h ${m}` : `${h} h`
}

function useSet() {
  const sh = useShow()
  return (path: string | null, v: unknown, ph: 'live' | 'final' = 'final') => {
    if (path) sh.editing.setValue(path, v, ph)
  }
}

/** The stack light, with defaults filled in, or null (a live stack without a light). */
function useStack(mode: LightStack) {
  const sh = useShow()
  const st = sh.scene?.backdrop[mode]
  const raw = st?.light
  const light = mode === 'static' ? stackLightOf(raw, sh.catalog) : raw ? stackLightOf(raw, sh.catalog) : null
  const atts = sh.scene ? stackAttachments(sh.scene, mode) : []
  return { light, atts, hasLight: !!raw }
}

// ── the attachment browser ───────────────────────────────────────────────────

/** Every catalog attachment by category, with real thumbnails rendered by the engine at build time. */
export function AttachmentBrowser({ mode, selected, onSelect }: { mode: LightStack; selected: string | null; onSelect: (id: string) => void }) {
  const sh = useShow()
  const [cat, setCat] = useState('all')
  // (plates) a plate tile shows the metal plate itself, or the light it projects
  const [plateView, setPlateView] = useState<'metal' | 'light'>('metal')
  const { atts } = useStack(mode)
  const gobos = sh.catalog?.gobos ?? []
  // (catalog 6) the groups come from the catalog: windows, nature, sky, patterns, beams
  const cats = [{ id: 'all', name: 'all' }, ...(sh.catalog?.goboCategories ?? [])]
  const shown = cat === 'all' ? gobos : gobos.filter((g) => g.category === cat)
  const hasPlates = shown.some((g) => g.metalThumb)
  const tileUrl = (g: GoboItem) => (plateView === 'metal' && g.metalThumb ? metalThumbUrl(g) : thumbUrl(g.id))
  const on = new Set(atts.map((a) => a.gobo))
  const trying = sh.staticTry?.kind === 'attachment' ? sh.staticTry.gobo : null

  const pick = (g: GoboItem) => {
    if (!sh.scene) return
    // (§16) in static a tap tries the plate in the hero first; the bar over the hero puts it on
    if (mode === 'static') {
      sh.setStaticTry(sh.staticTry?.kind === 'attachment' && sh.staticTry.gobo === g.id ? null : { kind: 'attachment', gobo: g.id })
      return
    }
    const att = newAttachment(sh.catalog, g.id, newId('att'))
    // (§16) a pick keeps the light as it is (focus, colour, lens) and the place of the attachment it replaces
    void sh.editing.edit((sc) => {
      const ops = pickAttachment(sc, mode, att)
      if (!sc.backdrop[mode]?.light) ops.push(...setStackLight(sc, mode, defaultStackLight(sh.catalog)))
      return ops
    })
    onSelect(sh.scene.backdrop[mode]?.attachments?.[0]?.id ?? att.id)
  }
  const stack = (g: GoboItem) => {
    if (!sh.scene) return
    const att = newAttachment(sh.catalog, g.id, newId('att'))
    void sh.editing.edit((sc) => addAttachment(sc, mode, att))
    onSelect(att.id)
    sh.toast(`Added ${g.name} on top: it blocks more of the light.`)
  }

  return (
    <Card cap={mode === 'static' ? 'attachments · tap to try' : 'attachments'} aside={<span className={s.count}>{gobos.length}</span>} testId={`attachments-${mode}`}>
      <div className={s.catRow} role="tablist" aria-label="attachment category">
        {cats.map((c) => (
          <Pill key={c.id} size="sm" on={cat === c.id} onClick={() => setCat(c.id)} role="tab" aria-selected={cat === c.id} data-testid={`att-cat-${c.id}`}>
            {c.name}
          </Pill>
        ))}
      </div>
      {hasPlates && (
        <div className={s.plateView}>
          <span className={s.dim}>plates show</span>
          <Segmented
            ariaLabel="plate tiles show"
            size="sm"
            value={plateView}
            onChange={setPlateView}
            options={[
              { value: 'metal', label: 'the plate', title: 'show each plate as the metal disc with its cut-outs' },
              { value: 'light', label: 'its light', title: 'show the light each plate projects' },
            ]}
          />
        </div>
      )}
      <div className={s.attGrid} data-testid="attachment-grid">
        {shown.map((g) => (
          <div key={g.id} className={s.attTile}>
            <Tile label={trying === g.id ? `trying ${g.name}` : g.name} aspect={16 / 9} on={on.has(g.id) || trying === g.id} background={`center / cover no-repeat url("${tileUrl(g)}"), var(--bg)`} onClick={() => pick(g)} testId={`gobo-${g.id}`} title={`${g.name}: ${g.description ?? ''}${g.source ? ` (${g.source})` : ''}. ${mode === 'static' ? 'Try it in the preview.' : 'Put it in front of the light (replaces the others).'}`} />
            <button type="button" className={s.attAdd} onClick={() => stack(g)} aria-label={`add ${g.name} on top`} title={`add ${g.name} on top of what is there: masks multiply`} data-testid={`gobo-add-${g.id}`}>
              <Icon name="plus" size={12} />
            </button>
          </div>
        ))}
      </div>
      {mode !== 'static' && <AttachmentList mode={mode} selected={selected} onSelect={onSelect} />}
    </Card>
  )
}

/** What is in front of the light now: select, hide, remove. */
function AttachmentList({ mode, selected, onSelect }: { mode: LightStack; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className={s.attList} data-testid="attachment-list">
      <Cap>in front of the light</Cap>
      <AttachmentRows mode={mode} selected={selected} onSelect={onSelect} />
    </div>
  )
}

/** The attachments in front of the light, one row each: select, hide, remove. */
export function AttachmentRows({ mode, selected, onSelect }: { mode: LightStack; selected: string | null; onSelect: (id: string) => void }) {
  const sh = useShow()
  const set = useSet()
  const { atts } = useStack(mode)
  return (
    <div className={s.attList} data-testid={mode === 'static' ? 'attachment-list' : undefined}>
      {atts.length === 0 && <span className={s.dim}>nothing: the whole frame is lit. {mode === 'static' ? 'try an attachment in the gallery.' : 'pick an attachment above.'}</span>}
      {atts.map((a) => (
        <div key={a.id} className={cx(s.lrow, selected === a.id && s.lsel, !a.visible && s.lhidden)} onClick={() => onSelect(a.id)} data-testid={`att-row-${a.id}`}>
          <span className={s.thumb} style={{ background: `center / cover no-repeat url("${thumbUrl(a.gobo)}")` }} />
          <span className={s.ltext}>
            <span className={s.lname}>{a.name}</span>
            <span className={s.lmeta}>
              {a.motion ? (a.motion.on ? 'moving' : 'motion paused') : 'still'}
              {a.opacity < 1 ? ` · blocks ${pct(a.opacity)}` : ''}
            </span>
          </span>
          <span className={s.lacts} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={s.iconBtn} aria-label={a.visible ? `hide ${a.name}` : `show ${a.name}`} title={a.visible ? 'take it out of the beam' : 'put it back in the beam'} onClick={() => set(sh.scene && attachmentPath(sh.scene, a.id, 'visible'), !a.visible)}>
              <Icon name={a.visible ? 'eye' : 'eyeOff'} size={15} />
            </button>
            <button type="button" className={s.iconBtn} aria-label={`remove ${a.name}`} title="remove it" onClick={() => void sh.editing.edit((sc) => removeAttachment(sc, a.id))} data-testid={`att-remove-${a.id}`}>
              <Icon name="trash" size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── the light ────────────────────────────────────────────────────────────────

/** Intensity, colour (CCT, HSI, a gradient or an animated colour), fx and the lens; in live also both focus rings. */
export function LightCard({ mode }: { mode: LightStack }) {
  const sh = useShow()
  const set = useSet()
  const { light } = useStack(mode)
  if (!light) {
    return (
      <Card cap="light" testId={`light-${mode}`}>
        <EmptyState>no light under the live layers: they draw over black.</EmptyState>
        <Pill icon="sun" onClick={() => void sh.editing.edit((sc) => setStackLight(sc, mode, defaultStackLight(sh.catalog)))} data-testid="add-light">
          light the frame
        </Pill>
      </Card>
    )
  }
  const lp = (...rest: Array<string | number>) => lightPath(mode, ...rest)
  const cct = sh.catalog?.light.cctPresets ?? []
  const cl = light.colorLayer
  const colorKind = cl ? cl.kind : light.color.mode
  const gens = sh.catalog?.colorGenerators ?? []
  const grads = sh.catalog?.gradients ?? []
  const setColorKind = (k: string) => {
    if (k === 'cct' || k === 'hsi') {
      sh.editing.setValues([[lp('colorLayer'), null], [lp('color', 'mode'), k]], 'final')
    } else if (k === 'generator') {
      set(lp('colorLayer'), { kind: 'generator', ref: gens[0]?.id ?? 'hue-cycle', params: {} })
    } else {
      const g = grads[0]
      set(lp('colorLayer'), { kind: 'gradient', ref: g?.id ?? 'ember', params: g ? { ...g.defaults } : {} })
    }
  }
  const genItem = cl?.kind === 'generator' ? gens.find((g) => g.id === cl.ref) : null
  return (
    <Card cap="light" aside={<span className={s.dim}>{mode === 'static' ? 'lights the whole frame' : 'under the live layers'}</span>} testId={`light-${mode}`}>
      <div className={s.controls} data-testid="light-controls">
        <FillSlider label="intensity" value={light.intensity} display={pct(light.intensity)} onChange={(v, ph) => set(lp('intensity'), r2(v), ph)} />
        {/* (§16) in static the two focus rings sit in the stack card, at their level; live shows them here */}
        {mode === 'live' && (
          <div className={s.two}>
            <FillSlider label="attachment focus" value={light.focus} display={focusLabel(light.focus)} onChange={(v, ph) => set(lp('focus'), r2(v), ph)} />
            <FillSlider label="live layer focus" value={light.backgroundFocus ?? 1} display={focusLabel(light.backgroundFocus ?? 1)} onChange={(v, ph) => set(lp('backgroundFocus'), r2(v), ph)} />
          </div>
        )}
        <div className={s.capRow}>
          <Cap>colour</Cap>
          <Segmented
            ariaLabel="colour"
            size="sm"
            width={268}
            value={colorKind}
            onChange={setColorKind}
            options={[
              { value: 'cct', label: 'white', title: 'white light by colour temperature (kelvin) and tint' },
              { value: 'hsi', label: 'colour', title: 'any colour by hue and saturation' },
              { value: 'gradient', label: 'gradient', title: 'a gradient gel in front of the light' },
              { value: 'generator', label: 'animated', title: 'an animated colour: hue cycles, flows, pulses' },
            ]}
          />
        </div>
        {!cl && light.color.mode === 'cct' && (
          <>
            <div className={s.two}>
              <FillSlider label="kelvin" value={light.color.kelvin} min={2000} max={10000} step={50} display={`${Math.round(light.color.kelvin)} K`} onChange={(v, ph) => set(lp('color', 'kelvin'), Math.round(v), ph)} />
              <FillSlider label="tint" value={light.color.tint} min={-1} max={1} step={0.01} display={light.color.tint === 0 ? '0' : light.color.tint > 0 ? `+${light.color.tint.toFixed(2)}` : light.color.tint.toFixed(2)} onChange={(v, ph) => set(lp('color', 'tint'), r2(v), ph)} />
            </div>
            <div className={s.chips}>
              {cct.map((p) => (
                <Pill key={p.id} size="sm" on={light.color.kelvin === p.kelvin} onClick={() => set(lp('color', 'kelvin'), p.kelvin)}>
                  {p.id} <span className={s.chipNum}>{p.kelvin}</span>
                </Pill>
              ))}
            </div>
          </>
        )}
        {!cl && light.color.mode === 'hsi' && (
          <div className={s.two}>
            <FillSlider label="hue" value={light.color.hue} min={0} max={360} step={1} display={`${Math.round(light.color.hue)}°`} onChange={(v, ph) => set(lp('color', 'hue'), Math.round(v), ph)} />
            <FillSlider label="saturation" value={light.color.sat} display={pct(light.color.sat)} onChange={(v, ph) => set(lp('color', 'sat'), r2(v), ph)} />
          </div>
        )}
        {cl?.kind === 'gradient' && (
          <div className={s.chips} data-testid="light-gradients">
            {grads.map((g) => (
              <button key={g.id} type="button" className={cx(s.gel, cl.ref === g.id && s.gelOn)} style={{ background: gradientCss(g.defaults.stops, g.defaults.angle) }} onClick={() => set(lp('colorLayer'), { kind: 'gradient', ref: g.id, params: { ...g.defaults } })} title={`${g.name}: colour the light with it`}>
                <span>{g.name}</span>
              </button>
            ))}
          </div>
        )}
        {cl?.kind === 'generator' && (
          <>
            <div className={s.chips} data-testid="light-generators">
              {gens.map((g) => (
                <Pill key={g.id} size="sm" on={cl.ref === g.id} onClick={() => set(lp('colorLayer'), { kind: 'generator', ref: g.id, params: {} })} title={g.description}>
                  {g.name}
                </Pill>
              ))}
            </div>
            {genItem && <ParamControls schema={genItem.params} values={resolveParams(genItem.params, (cl.params ?? {}) as Record<string, unknown>)} onChange={(k, v, ph) => set(lp('colorLayer', 'params', k), v, ph)} />}
          </>
        )}
        <Cap>light fx</Cap>
        <div className={s.chips} data-testid="fx-chips">
          {FX.map((k) => (
            <Pill key={k} size="sm" on={light.fx.kind === k} onClick={() => set(lp('fx', 'kind'), k)}>
              {k}
            </Pill>
          ))}
        </div>
        {light.fx.kind !== 'none' && <FillSlider label="fx speed" value={light.fx.speed} display={pct(light.fx.speed)} onChange={(v, ph) => set(lp('fx', 'speed'), r2(v), ph)} />}
        <Cap>lens</Cap>
        <div className={s.two}>
          <FillSlider label="colour fringe" value={light.fringe} display={pct(light.fringe)} onChange={(v, ph) => set(lp('fringe'), r2(v), ph)} />
          <FillSlider label="vignette" value={light.vignette} display={pct(light.vignette)} onChange={(v, ph) => set(lp('vignette'), r2(v), ph)} />
        </div>
        <SlideControl mode={mode} light={light} />
      </div>
    </Card>
  )
}

/** The frame slide: the whole picture pans along the long axis of the frame (x in landscape, y in portrait). */
export function SlideControl({ mode, light }: { mode: LightStack; light: StackLight }) {
  const sh = useShow()
  const set = useSet()
  const portrait = !!sh.setup && sh.setup.output.orientation !== 'landscape'
  const axis = portrait ? 'y' : 'x'
  const v = light.slide?.[axis] ?? 0
  return (
    <div className={s.slideRow} data-testid="frame-slide">
      <FillSlider label={portrait ? 'slide up / down' : 'slide left / right'} value={v} min={-1} max={1} step={0.01} display={v === 0 ? 'centred' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`} onChange={(x, ph) => set(lightPath(mode, 'slide', axis), r3(x), ph)} />
      <Pill size="sm" ghost onClick={() => set(lightPath(mode, 'slide'), { x: 0, y: 0 })} disabled={!light.slide?.x && !light.slide?.y} title="put the picture back in the middle of the frame" data-testid="slide-reset">
        reset
      </Pill>
    </div>
  )
}

// ── one attachment ───────────────────────────────────────────────────────────

/** Rotation, scale, position, how much it blocks, and its own shape params (panes, slats, density, blades…). */
export function AttachmentCard({ attachment }: { attachment: Attachment | null }) {
  const sh = useShow()
  const set = useSet()
  if (!attachment) return null
  const a = attachment
  const item = sh.catalog?.gobos.find((g) => g.id === a.gobo)
  const ap = (...rest: Array<string | number>) => (sh.scene ? attachmentPath(sh.scene, a.id, ...rest) : null)
  const own: ParamSchema = { ...(item?.params ?? {}) }
  // (§16) a window preset's geometry params get their own grouped section
  const groups = item?.family === 'window' ? (sh.catalog?.windowParamGroups ?? []) : []
  const geometryKeys = new Set(groups.flatMap((g) => g.params))
  const shape: ParamSchema = Object.fromEntries(Object.entries(own).filter(([k]) => !geometryKeys.has(k)))
  const wall: ParamSchema = sh.catalog?.goboParams ?? {}
  const defaults: Record<string, unknown> = { ...Object.fromEntries(Object.entries(wall).map(([k, v]) => [k, v.default])), ...(item?.defaults ?? {}) }
  const values = { ...defaults, ...resolveParams({ ...wall, ...own }, { ...defaults, ...a.params } as Record<string, unknown>) }
  return (
    <Card cap={a.name} aside={<span className={s.dim}>{item?.category ?? 'attachment'}</span>} testId="attachment-card">
      <div className={s.controls}>
        <div className={s.two}>
          <FillSlider label="rotation" value={a.rotation} min={-180} max={180} step={1} display={`${Math.round(a.rotation)}°`} onChange={(v, ph) => set(ap('rotation'), Math.round(v), ph)} />
          <FillSlider label="scale" value={a.scale} min={0.25} max={4} step={0.01} display={`${a.scale.toFixed(2)}×`} onChange={(v, ph) => set(ap('scale'), r2(v), ph)} />
        </div>
        <div className={s.two}>
          <FillSlider label="left / right" value={a.offsetX} min={-1} max={1} step={0.01} display={`${Math.round(a.offsetX * 100)}%`} onChange={(v, ph) => set(ap('offsetX'), r3(v), ph)} />
          <FillSlider label="up / down" value={a.offsetY} min={-1} max={1} step={0.01} display={`${Math.round(a.offsetY * 100)}%`} onChange={(v, ph) => set(ap('offsetY'), r3(v), ph)} />
        </div>
        <FillSlider label="blocks" value={a.opacity} display={a.opacity >= 1 ? 'all of it' : pct(a.opacity)} onChange={(v, ph) => set(ap('opacity'), r2(v), ph)} />
        {Object.keys(shape).length > 0 && <ParamControls schema={shape} values={values} onChange={(k, v, ph) => set(ap('params', k), v, ph)} skip={['seed']} />}
        {groups.length > 0 && (
          <WindowGeometry
            groups={groups}
            schema={own}
            values={values}
            changed={Object.keys(a.params ?? {}).some((k) => geometryKeys.has(k))}
            onChange={(k, v, ph) => set(ap('params', k), v, ph)}
            onReset={() => {
              if (!sh.scene) return
              const params = Object.fromEntries(Object.entries(a.params ?? {}).filter(([k]) => !geometryKeys.has(k)))
              set(ap('params'), params)
            }}
          />
        )}
        <Cap>on the wall</Cap>
        <ParamControls schema={wall} values={values} onChange={(k, v, ph) => set(ap('params', k), v, ph)} />
      </div>
    </Card>
  )
}

/** (§16) which toggle a dependent window param waits for */
const WINDOW_NEEDS: Record<string, (v: Record<string, unknown>) => boolean> = {
  archHeight: (v) => v.arch === true,
  spokes: (v) => v.arch === true,
  hub: (v) => v.arch === true && Number(v.spokes) > 0,
  diamonds: (v) => v.diamond === true,
  jewels: (v) => v.diamond === true,
  slatWidth: (v) => Number(v.slats) > 0,
  vertical: (v) => Number(v.slats) > 0,
}

/**
 * (§16) A window preset's geometry, in the catalog's groups: grid, frame, arch, shape (round and perspective), lattice
 * and blinds. A param that only matters with a toggle on (arch height with the arch) shows when the toggle is on.
 */
export function WindowGeometry({ groups, schema, values, changed, onChange, onReset }: {
  groups: Array<{ id: string; name: string; params: string[] }>
  schema: ParamSchema
  values: Record<string, unknown>
  changed: boolean
  onChange: (k: string, v: unknown, ph: 'live' | 'final') => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(groups[0]?.id ?? '')
  const group = groups.find((g) => g.id === open) ?? groups[0]
  const keys = (group?.params ?? []).filter((k) => schema[k] && (WINDOW_NEEDS[k]?.(values) ?? true))
  return (
    <div className={s.windowGeo} data-testid="window-geometry">
      <div className={s.windowHead}>
        <Cap>window</Cap>
        <Pill size="sm" onClick={onReset} disabled={!changed} title="put the preset's geometry back" data-testid="window-reset">
          reset to preset
        </Pill>
      </div>
      <div className={s.catRow} role="tablist" aria-label="window geometry">
        {groups.map((g) => (
          <Pill key={g.id} size="sm" on={g.id === group?.id} onClick={() => setOpen(g.id)} role="tab" aria-selected={g.id === group?.id} data-testid={`window-group-${g.id}`}>
            {g.name}
          </Pill>
        ))}
      </div>
      <ParamControls schema={Object.fromEntries(keys.map((k) => [k, schema[k]]))} values={values} onChange={onChange} />
    </div>
  )
}

// ── motion ───────────────────────────────────────────────────────────────────

/** The mini path editor: a small frame with the from, via and to handles and the light's place now. */
export function PathEditor({ motion, portrait, onChange, now }: { motion: Motion; portrait: boolean; onChange: (m: Motion, ph: 'live' | 'final') => void; now: () => number }) {
  const W = portrait ? 90 : 160
  const H = portrait ? 160 : 90
  // the editor shows offsets −1…1 of the frame: the frame itself is the middle half
  const toPx = (p: FramePt) => ({ x: W / 2 + p.x * (W / 2), y: H / 2 + p.y * (H / 2) })
  const svg = useRef<SVGSVGElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  const drag = useRef<'from' | 'via' | 'to' | null>(null)
  const cur = useRef(motion)
  cur.current = motion
  useRaf(() => {
    const m = cur.current
    const sm = sampleMotion(m, now())
    const p = toPx({ x: sm.x, y: sm.y })
    dot.current?.setAttribute('cx', String(p.x))
    dot.current?.setAttribute('cy', String(p.y))
  }, 30)
  const at = (e: RPointerEvent): FramePt => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    const c = (v: number) => Math.max(-1.5, Math.min(1.5, Math.round(v * 1000) / 1000))
    return { x: c((x - W / 2) / (W / 2)), y: c((y - H / 2) / (H / 2)) }
  }
  const move = (e: RPointerEvent, ph: 'live' | 'final') => {
    const k = drag.current
    if (!k) return
    // a move without a button (a wheel scroll under a still pointer) ends the drag instead of moving a handle
    if (ph === 'live' && !pressed(e)) {
      drag.current = null
      return
    }
    onChange({ ...cur.current, preset: '', [k]: at(e) }, ph)
  }
  const f = toPx(motion.from), t = toPx(motion.to)
  const v = motion.via ? toPx(motion.via) : { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 }
  // the quadratic through via: control = 2 via − (from + to) / 2
  const qx = 2 * v.x - (f.x + t.x) / 2, qy = 2 * v.y - (f.y + t.y) / 2
  const handle = (k: 'from' | 'via' | 'to', p: { x: number; y: number }, label: string) => (
    <g
      className={s.handle}
      onPointerDown={(e) => {
        svg.current?.setPointerCapture(e.pointerId)
        drag.current = k
      }}
      data-testid={`path-${k}`}
    >
      <circle cx={p.x} cy={p.y} r={k === 'via' ? 4 : 5.5} className={k === 'via' ? s.viaDot : s.endDot} />
      <text x={p.x} y={p.y - 8} className={s.pathLabel}>
        {label}
      </text>
    </g>
  )
  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className={s.pathSvg}
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerMove={(e) => move(e, 'live')}
      onPointerUp={(e) => {
        move(e, 'final')
        drag.current = null
      }}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
      onDoubleClick={() => onChange({ ...cur.current, preset: '', via: cur.current.via ? null : { x: (cur.current.from.x + cur.current.to.x) / 2, y: (cur.current.from.y + cur.current.to.y) / 2 - 0.1 } }, 'final')}
      data-testid="path-editor"
      aria-label="the motion path: drag from and to, drag the middle point to curve it, double click to add or remove it"
    >
      <rect x={W / 4} y={H / 4} width={W / 2} height={H / 2} className={s.pathFrame} rx={2} />
      <path d={`M${f.x},${f.y} Q${qx},${qy} ${t.x},${t.y}`} className={s.pathLine} />
      {handle('from', f, 'from')}
      {handle('to', t, 'to')}
      {handle('via', v, '')}
      <circle ref={dot} r={3.2} className={s.nowDot} />
    </svg>
  )
}

/** Preset chips, the path editor, speed, easing, loop, drifts and play / pause of a motion. */
export function MotionCard({ mode, attachment }: { mode: LightStack; attachment: Attachment | null }) {
  const sh = useShow()
  const { light } = useStack(mode)
  const portrait = !!sh.setup && sh.setup.output.orientation !== 'landscape'
  const hasOwn = !!attachment?.motion
  const [which, setWhich] = useState<'light' | 'attachment'>(hasOwn || !light?.motion ? 'attachment' : 'light')
  const target: MotionTarget | null = which === 'light' || !attachment ? (light ? { kind: 'light', mode } : null) : { kind: 'attachment', id: attachment.id }
  const motion = target?.kind === 'light' ? light?.motion ?? null : attachment?.motion ?? null
  const presets = sh.catalog?.motionPresets ?? []
  const now = () => sh.hub.serverNow()
  const path = (m: Motion | null, ph: 'live' | 'final') => {
    if (!target || !sh.scene) return
    if (ph === 'live') {
      const p = target.kind === 'light' ? lightPath(target.mode, 'motion') : attachmentPath(sh.scene, target.id, 'motion')
      if (p && motion) sh.editing.setValue(p, m, 'live')
      return
    }
    void sh.editing.edit((sc) => setMotion(sc, target, m))
  }
  const sm = useMemo(() => (motion ? sampleMotion(motion, now()) : null), [motion]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null
  return (
    <Card cap="motion" aside={motion ? <span className={s.dim}>{motion.on ? 'moving' : 'paused'}</span> : <span className={s.dim}>still</span>} testId="motion-card">
      <div className={s.controls}>
        {attachment && light && (
          <Segmented<'light' | 'attachment'>
            ariaLabel="what moves"
            size="sm"
            value={target.kind === 'light' ? 'light' : 'attachment'}
            onChange={setWhich}
            options={[
              { value: 'attachment', label: attachment.name, title: `move ${attachment.name} inside the frame` },
              { value: 'light', label: 'the whole light', title: 'slide the whole picture, like the sun moving' },
            ]}
          />
        )}
        <div className={s.chips} data-testid="motion-presets">
          {presets.map((p) => (
            <Pill key={p.id} size="sm" on={motion?.preset === p.id} onClick={() => path(presetMotion(sh.catalog, p.id, now(), true), 'final')} title={p.description} data-testid={`motion-preset-${p.id}`}>
              {p.name}
            </Pill>
          ))}
          {motion && (
            <Pill size="sm" ghost icon="close" onClick={() => path(null, 'final')} title="stop moving and stay where it started" data-testid="motion-clear">
              no motion
            </Pill>
          )}
        </div>
        {motion && (
          <>
            <div className={s.motionRow}>
              <PathEditor motion={motion} portrait={portrait} onChange={(m, ph) => path(m, ph)} now={now} />
              <div className={s.motionSide}>
                <button type="button" className={s.playBtn} onClick={() => path(motion.on ? pauseMotion(motion, now()) : playMotion(motion, now()), 'final')} aria-pressed={motion.on} data-testid="motion-play">
                  <Icon name={motion.on ? 'pause' : 'play'} size={16} />
                  {motion.on ? 'pause' : 'play'}
                </button>
                <span className={s.dim}>{sm ? `${Math.round(Math.min(1, Math.max(0, sm.e)) * 100)}% along` : ''}</span>
              </div>
            </div>
            <FillSlider label="speed" value={speedFromDuration(motion.duration)} display={`once every ${formatSpan(motion.duration)}`} onChange={(v, ph) => path(retimeMotion(motion, durationFromSpeed(v), now()), ph)} />
            <div className={s.capRow}>
              <Cap>easing</Cap>
              <Segmented<MotionEasing> ariaLabel="easing" size="sm" width={250} value={motion.easing} onChange={(v) => path({ ...motion, easing: v }, 'final')} options={MOTION_EASINGS.map((e) => ({ value: e, label: e === 'inOut' ? 'in out' : e }))} />
            </div>
            <div className={s.capRow}>
              <Cap>repeat</Cap>
              <Segmented<MotionLoop> ariaLabel="repeat" size="sm" width={250} value={motion.loop} onChange={(v) => path({ ...motion, loop: v }, 'final')} options={MOTION_LOOPS.map((l) => ({ value: l, label: l === 'pingpong' ? 'back and forth' : l === 'loop' ? 'loop' : 'once' }))} />
            </div>
            <FillSlider label="turn over the move" value={motion.rotate} min={-45} max={45} step={1} display={`${Math.round(motion.rotate)}°`} onChange={(v, ph) => path({ ...motion, rotate: Math.round(v) }, ph)} />
            <div className={s.two}>
              <FillSlider label="size at start" value={motion.scaleFrom} min={0.5} max={2} step={0.01} display={`${motion.scaleFrom.toFixed(2)}×`} onChange={(v, ph) => path({ ...motion, scaleFrom: r2(v) }, ph)} />
              <FillSlider label="size at end" value={motion.scaleTo} min={0.5} max={2} step={0.01} display={`${motion.scaleTo.toFixed(2)}×`} onChange={(v, ph) => path({ ...motion, scaleTo: r2(v) }, ph)} />
            </div>
            <div className={s.switchRow}>
              <span>warm to cool over the move</span>
              <Switch checked={motion.kelvinFrom > 0 && motion.kelvinTo > 0} onChange={(on) => path({ ...motion, kelvinFrom: on ? 2700 : 0, kelvinTo: on ? 5600 : 0 }, 'final')} ariaLabel="colour temperature drift" />
            </div>
            {motion.kelvinFrom > 0 && motion.kelvinTo > 0 && (
              <div className={s.two}>
                <FillSlider label="from" value={motion.kelvinFrom} min={1800} max={10000} step={50} display={`${Math.round(motion.kelvinFrom)} K`} onChange={(v, ph) => path({ ...motion, kelvinFrom: Math.round(v) }, ph)} />
                <FillSlider label="to" value={motion.kelvinTo} min={1800} max={10000} step={50} display={`${Math.round(motion.kelvinTo)} K`} onChange={(v, ph) => path({ ...motion, kelvinTo: Math.round(v) }, ph)} />
              </div>
            )}
          </>
        )}
        {!motion && <span className={s.dim}>pick a move: the light slides across the wall on its own, even with the timeline stopped.</span>}
      </div>
    </Card>
  )
}

// ── panels ───────────────────────────────────────────────────────────────────

/** Static: the attachment browser, then the light, the picked attachment and its motion. */
export function StaticLightPanel() {
  const sh = useShow()
  const { atts } = useStack('static')
  const [sel, setSel] = useState<string | null>(null)
  const att = atts.find((a) => a.id === sel) ?? atts[atts.length - 1] ?? null
  return (
    <div className={s.split}>
      <StaticGallery selected={att?.id ?? null} onSelect={setSel} />
      <div className={s.stackCol}>
        <StaticStack selected={att?.id ?? null} onSelect={setSel} />
        <LightCard mode="static" />
        {att && <AttachmentCard attachment={att} />}
        {sh.scene && <MotionCard key={att?.id ?? 'light'} mode="static" attachment={att} />}
        <AccentCard />
      </div>
    </div>
  )
}

/** A photo or video layer's motion, for the scenery panel. */
export function PictureMotion({ layerId }: { layerId: string }) {
  const sh = useShow()
  const layer = sh.scene ? [...sh.scene.backdrop.scenery.layers, ...sh.scene.backdrop.color.layers, ...sh.scene.backdrop.live.layers].find((l) => l.id === layerId) : null
  const motion = layer?.motion ?? null
  const presets = (sh.catalog?.motionPresets ?? []).filter((p) => p.id === 'drift' || p.id === 'sway' || p.id.startsWith('sun'))
  const now = () => sh.hub.serverNow()
  const portrait = !!sh.setup && sh.setup.output.orientation !== 'landscape'
  if (!layer || layer.ref.startsWith('youtube:')) return null
  const write = (m: Motion | null, ph: 'live' | 'final') => {
    if (ph === 'live') {
      const p = sh.scene ? layerPath(sh.scene, layerId, 'motion') : null
      if (p && motion) sh.editing.setValue(p, m, 'live')
      return
    }
    void sh.editing.edit((sc) => setMotion(sc, { kind: 'layer', id: layerId }, m))
  }
  return (
    <div className={s.controls} data-testid="picture-motion">
      <Cap>motion</Cap>
      <div className={s.chips}>
        {presets.map((p) => (
          <Pill key={p.id} size="sm" on={motion?.preset === p.id} onClick={() => write(presetMotion(sh.catalog, p.id, now(), true), 'final')} title={p.description}>
            {p.name}
          </Pill>
        ))}
        {motion && (
          <Pill size="sm" ghost icon="close" onClick={() => write(null, 'final')}>
            no motion
          </Pill>
        )}
      </div>
      {motion && (
        <>
          <div className={s.motionRow}>
            <PathEditor motion={motion} portrait={portrait} onChange={write} now={now} />
            <div className={s.motionSide}>
              <button type="button" className={s.playBtn} onClick={() => write(motion.on ? pauseMotion(motion, now()) : playMotion(motion, now()), 'final')} aria-pressed={motion.on}>
                <Icon name={motion.on ? 'pause' : 'play'} size={16} />
                {motion.on ? 'pause' : 'play'}
              </button>
            </div>
          </div>
          <FillSlider label="speed" value={speedFromDuration(motion.duration)} display={`once every ${formatSpan(motion.duration)}`} onChange={(v, ph) => write(retimeMotion(motion, durationFromSpeed(v), now()), ph)} />
        </>
      )}
    </div>
  )
}

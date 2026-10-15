import { useEffect, useMemo, useRef, useState } from 'react'
import { Cap, EmptyState, FillSlider, Icon, Menu, Pill, ProgressBar, Segmented, Switch, TextInput, Tile } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import { useChannel } from '../../../../shared/lib/useHub'
import { useRaf } from '../../../../shared/lib/useRaf'
import { newLayer, sceneryUrl } from '../../../catalog'
import { layerParamSchema } from '../../../catalog/layers'
import { ParamControls, resolveParams } from '../../../effect'
import { presetApi, type Preset } from '../../../preset'
import { stackLayers, underlayOf } from '../../../scene/lib'
import { addLayer, applyPresetOps, convergeSource, layerPath, moveLayer, pickOne, removeLayer, setUnderlay, sortedCues, videoLayer } from '../../../scene/ops'
import { BACKDROP_MODES, defaultIntro, type BackdropMode, type Intro, type BlendMode, type GradientStop, type Layer, type LayerKind, type Light, type LightFxKind, type SceneObject } from '../../../scene/types'
import { gradientCss, layerSwatch } from '../../../scene/ui/library'
import { formatDuration } from '../../../sound/ui/useSounds'
import { YouTubeDialog } from '../../../video/ui/youtubeDialog'
import { useVideoUpload } from '../../../video/ui/videoUpload'
import { useVideos, videoThumbUrl } from '../../../video/ui/useVideos'
import { youtubeRef, type Video } from '../../../video/types'
import { playheadNow } from '../../live'
import { clipPhase, stepBounds } from '../../../../render/timeline'
import { showAudio } from '../../types'
import { useShow } from './context'
import { AccentCard } from './accent'
import { AttachmentBrowser, AttachmentCard, LightCard, MotionCard, PictureMotion, StaticLightPanel } from './light'
import { LiveGallery } from './liveGallery'
import { useLayerThumb } from './thumbs'
import s from './styles.module.css'

const r2 = (v: number) => Math.round(v * 100) / 100
/** swatches for the animated colour tiles (the real thing runs on the wall) */
const GEN_SWATCH: Record<string, string> = {
  'hue-cycle': 'conic-gradient(from 90deg, var(--pad-red), var(--pad-amber), var(--pad-green), var(--pad-teal), var(--pad-blue), var(--pad-violet), var(--pad-pink), var(--pad-red))',
  'color-flow': 'radial-gradient(circle at 30% 30%, var(--pad-amber), transparent 60%), radial-gradient(circle at 70% 70%, var(--pad-violet), transparent 60%), var(--pad-pink)',
  pulse: 'radial-gradient(circle, var(--pad-red), var(--pad-blue))',
  aurora: 'linear-gradient(170deg, var(--bg) 10%, var(--pad-green) 45%, var(--pad-violet) 75%, var(--bg))',
  'kelvin-cycle': 'linear-gradient(90deg, var(--pad-amber), var(--ink), var(--pad-blue))',
}
const pct = (v: number) => `${Math.round(v * 100)}%`
const FX: LightFxKind[] = ['none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police']

export { Card } from './card'
import { Card } from './card'

/** Writes into the scene on the wall (live). */
function useSet() {
  const sh = useShow()
  return (path: string | null, v: unknown, ph: 'live' | 'final' = 'final') => {
    if (path) sh.editing.setValue(path, v, ph)
  }
}

/** The one visible layer of a single-choice stack (what is picked). */
function picked(layers: Layer[]): Layer | null {
  return layers.find((l) => l.visible) ?? layers[0] ?? null
}

/** Puts a single-choice pick on air (§10/§14): one layer, keeping the id and the light or photo controls. */
function usePick() {
  const sh = useShow()
  return (mode: Exclude<BackdropMode, 'live'>, layer: Layer) => void sh.editing.edit((sc) => pickOne(sc, mode, layer))
}

// ── light ────────────────────────────────────────────────────────────────────

/** Intensity, softness, angle, scale, colour (CCT kelvin/tint or HSI hue/sat) and light FX of a gobo or live layer. */
export function LightControls({ layerId, light, fx = true }: { layerId: string; light: Light; fx?: boolean }) {
  const sh = useShow()
  const set = useSet()
  const lp = (...rest: Array<string | number>) => (sh.scene ? layerPath(sh.scene, layerId, 'light', ...rest) : null)
  const cct = sh.catalog?.light.cctPresets ?? []
  return (
    <div className={s.controls} data-testid="light-controls">
      <FillSlider label="intensity" value={light.intensity} display={pct(light.intensity)} onChange={(v, ph) => set(lp('intensity'), r2(v), ph)} />
      <FillSlider label="softness" value={light.softness} display={pct(light.softness)} onChange={(v, ph) => set(lp('softness'), r2(v), ph)} />
      <div className={s.two}>
        <FillSlider label="angle" value={light.angle} min={-90} max={90} step={1} display={`${Math.round(light.angle)}°`} onChange={(v, ph) => set(lp('angle'), Math.round(v), ph)} />
        <FillSlider label="scale" value={light.scale} min={0.25} max={4} step={0.05} display={`${light.scale.toFixed(2)}×`} onChange={(v, ph) => set(lp('scale'), r2(v), ph)} />
      </div>
      <div className={s.capRow}>
        <Cap>color</Cap>
        <Segmented
          ariaLabel="color mode"
          size="sm"
          width={170}
          value={light.color.mode}
          onChange={(v) => set(lp('color', 'mode'), v)}
          options={[
            { value: 'cct', label: 'white', title: 'white light by color temperature (kelvin) and tint' },
            { value: 'hsi', label: 'color', title: 'any color by hue and saturation' },
          ]}
        />
      </div>
      {light.color.mode === 'cct' ? (
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
      ) : (
        <div className={s.two}>
          <FillSlider label="hue" value={light.color.hue} min={0} max={360} step={1} display={`${Math.round(light.color.hue)}°`} onChange={(v, ph) => set(lp('color', 'hue'), Math.round(v), ph)} />
          <FillSlider label="saturation" value={light.color.sat} display={pct(light.color.sat)} onChange={(v, ph) => set(lp('color', 'sat'), r2(v), ph)} />
        </div>
      )}
      {fx && (
        <>
          <Cap>light fx</Cap>
          <div className={s.chips} data-testid="fx-chips">
            {FX.map((k) => (
              <Pill key={k} size="sm" on={light.fx.kind === k} onClick={() => set(lp('fx', 'kind'), k)}>
                {k}
              </Pill>
            ))}
          </div>
          {light.fx.kind !== 'none' && <FillSlider label="fx speed" value={light.fx.speed} display={pct(light.fx.speed)} onChange={(v, ph) => set(lp('fx', 'speed'), r2(v), ph)} />}
        </>
      )}
    </div>
  )
}

// ── presets ──────────────────────────────────────────────────────────────────

/** Presets of one mode as chips: apply (puts the mode on air), save the current stack, delete. */
export function PresetChips({ mode }: { mode: BackdropMode }) {
  const sh = useShow()
  const ch = useChannel<Preset[]>(sh.hub, 'presets').doc
  const [list, setList] = useState<Preset[]>([])
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    if (ch) setList(ch)
    else presetApi.list().then(setList, () => {})
  }, [ch])
  const shown = list.filter((p) => p.mode === mode)
  const save = async (name: string) => {
    setNaming(false)
    if (!sh.scene || !name.trim()) return
    try {
      const p = await presetApi.create(name.trim(), mode, sh.scene.id)
      setList((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p]))
      sh.toast(`Saved the ${mode} preset ${p.name}.`)
    } catch (e) {
      sh.toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  const del = async (p: Preset) => {
    try {
      await presetApi.remove(p.id)
      setList((xs) => xs.filter((x) => x.id !== p.id))
      sh.toast(`Deleted ${p.name}.`)
    } catch (e) {
      sh.toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  return (
    <div className={s.presets} data-testid="presets">
      <Cap>{mode} presets</Cap>
      <div className={s.presetChips}>
        {shown.length === 0 && !naming && <span className={s.dim}>none yet</span>}
        {shown.map((p) => {
          const top = p.backdrop.layers[p.backdrop.layers.length - 1]
          const sw = top ? layerSwatch(sh.catalog, top) : undefined
          return (
            <span key={p.id} className={s.preset}>
              <button type="button" className={s.presetMain} onClick={() => void sh.editing.edit((sc) => applyPresetOps(p, sc)).then(() => sh.toast(`${p.name} is on air.`))} title={`apply ${p.name}: replaces the ${mode} look and puts ${mode} on air`} data-testid={`preset-${p.id}`}>
                {sw && <i className={s.presetSw} style={{ background: sw }} />}
                {p.name}
              </button>
              <button type="button" className={s.presetDel} aria-label={`delete preset ${p.name}`} title="delete this preset" onClick={() => void del(p)}>
                <Icon name="close" size={11} />
              </button>
            </span>
          )
        })}
        {naming ? (
          <TextInput autoFocus className={s.presetInput} placeholder="name, then enter" onKeyDown={(e) => e.key === 'Enter' ? void save((e.target as HTMLInputElement).value) : e.key === 'Escape' && setNaming(false)} onBlur={() => setNaming(false)} data-testid="preset-name" />
        ) : (
          <Pill size="sm" ghost icon="plus" onClick={() => setNaming(true)} title={`save the ${mode} look as a preset`} data-testid="preset-save">
            save
          </Pill>
        )}
      </div>
    </div>
  )
}

// ── static ───────────────────────────────────────────────────────────────────

/** (§15) the light, its attachments and their motion */
export const StaticPanel = StaticLightPanel

// ── live ─────────────────────────────────────────────────────────────────────

function LayerThumb({ layer }: { layer: Layer }) {
  const sh = useShow()
  const url = useLayerThumb(sh.catalog, layer.kind === 'procedural' || layer.kind === 'gobo' ? layer.kind : 'gobo', layer.kind === 'procedural' || layer.kind === 'gobo' ? layer.ref : 'spot')
  const sw = layer.kind === 'gobo' || layer.kind === 'procedural' ? (url ? `center / cover no-repeat url("${url}")` : undefined) : layer.kind === 'video' ? videoSwatch(layer.ref) : layerSwatch(sh.catalog, layer)
  return <span className={s.thumb} style={sw ? { background: sw } : undefined}>{!sw && <Icon name="layers" size={16} />}</span>
}

const videoSwatch = (ref: string) => {
  const u = videoThumbUrl({ ref, thumb: null, youtubeId: youtubeRef(ref) })
  return u ? `center / cover no-repeat url("${u}")` : undefined
}

function layerMeta(l: Layer): string {
  const parts: string[] = []
  if (l.blend !== 'normal') parts.push(l.blend)
  if (l.light) parts.push(l.light.color.mode === 'cct' ? `${l.light.color.kelvin} K` : `hue ${l.light.color.hue}°`)
  if (l.opacity < 1) parts.push(pct(l.opacity))
  if (typeof l.params.wind === 'number') parts.push(`wind ${pct(l.params.wind as number)}`)
  return parts.join(' · ') || l.kind
}

function AddLayerMenu() {
  const sh = useShow()
  const cat = sh.catalog
  const add = (kind: LayerKind, ref: string) => {
    const layer = newLayer(cat, kind, ref, newId('lay'))
    void sh.editing.edit(() => addLayer('live', layer))
    sh.setLiveLayer(layer.id)
  }
  return (
    <Menu
      align="right"
      width={300}
      trigger={({ toggle }) => (
        <Pill size="sm" icon="plus" onClick={toggle} data-testid="show-add-layer">
          add layer
        </Pill>
      )}
      items={[
        { key: 'cp', caption: true, label: 'live' },
        ...(cat?.procedural.map((p) => ({ key: `p-${p.id}`, icon: 'wave', label: p.name, meta: p.category, onSelect: () => add('procedural', p.id) })) ?? []),
        { key: 'cg', caption: true, label: 'animated colour' },
        ...(cat?.colorGenerators?.map((g) => ({ key: `c-${g.id}`, icon: 'gradient', label: g.name, meta: g.description, onSelect: () => add('generator', g.id) })) ?? []),
      ]}
    />
  )
}

export function LivePanel() {
  const sh = useShow()
  const [att, setAtt] = useState<string | null>(null)
  const atts = sh.scene?.backdrop.live.attachments ?? []
  const selAtt = atts.find((a) => a.id === att) ?? null
  return (
    <>
      <LiveGallery />
      <LiveLayers />
      <div className={s.split}>
        <AttachmentBrowser mode="live" selected={selAtt?.id ?? null} onSelect={setAtt} />
        <div className={s.stackCol}>
          <LightCard mode="live" />
          {selAtt && <AttachmentCard attachment={selAtt} />}
          {selAtt && <MotionCard key={selAtt.id} mode="live" attachment={selAtt} />}
          <AccentCard />
        </div>
      </div>
    </>
  )
}

function LiveLayers() {
  const sh = useShow()
  const set = useSet()
  const layers = sh.scene ? stackLayers(sh.scene, 'live') : []
  const sel = layers.find((l) => l.id === sh.liveLayer) ?? layers[layers.length - 1] ?? null
  const schema = sel ? layerParamSchema(sh.catalog, sel) : {}
  const lp = (...rest: Array<string | number>) => (sh.scene && sel ? layerPath(sh.scene, sel.id, ...rest) : null)
  return (
    <div className={s.split}>
      <Card cap="layers · top first" aside={<AddLayerMenu />} testId="live-stack">
        {layers.length === 0 && <EmptyState>no live layers. tap a tile above to try one, then add it to live.</EmptyState>}
        <div className={s.rows}>
          {[...layers].reverse().map((l, k) => {
            const i = layers.length - 1 - k
            return (
              <div key={l.id} className={cx(s.lrow, sel?.id === l.id && s.lsel, !l.visible && s.lhidden)} onClick={() => sh.setLiveLayer(l.id)} data-testid={`live-layer-${l.id}`}>
                <LayerThumb layer={l} />
                <span className={s.ltext}>
                  <span className={s.lname}>{l.name}</span>
                  <span className={s.lmeta}>{layerMeta(l)}</span>
                </span>
                <span className={s.lacts} onClick={(e) => e.stopPropagation()}>
                  <button type="button" className={s.iconBtn} aria-label={`move ${l.name} up`} title="move up" disabled={i >= layers.length - 1} onClick={() => void sh.editing.edit((sc) => moveLayer(sc, l.id, 1))}>
                    <Icon name="chevronDown" size={14} className={s.up} />
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`move ${l.name} down`} title="move down" disabled={i <= 0} onClick={() => void sh.editing.edit((sc) => moveLayer(sc, l.id, -1))}>
                    <Icon name="chevronDown" size={14} />
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={l.visible ? `hide ${l.name}` : `show ${l.name}`} title={l.visible ? 'hide' : 'show'} onClick={() => set(sh.scene && layerPath(sh.scene, l.id, 'visible'), !l.visible)} data-testid={`live-eye-${l.id}`}>
                    <Icon name={l.visible ? 'eye' : 'eyeOff'} size={15} />
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`remove ${l.name}`} title="remove" onClick={() => void sh.editing.edit((sc) => removeLayer(sc, l.id))} data-testid={`live-remove-${l.id}`}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </Card>
      <Card cap={sel ? sel.name : 'layer'} aside={sel && <span className={s.dim}>selected</span>}>
        {!sel ? (
          <EmptyState>select a layer.</EmptyState>
        ) : (
          <div className={s.controls}>
            <Segmented<BlendMode> ariaLabel="blend" size="sm" value={sel.blend} onChange={(v) => set(lp('blend'), v)} options={(['normal', 'multiply', 'screen', 'add'] as BlendMode[]).map((b) => ({ value: b, label: b }))} />
            <FillSlider label="opacity" value={sel.opacity} display={pct(sel.opacity)} onChange={(v, ph) => set(lp('opacity'), r2(v), ph)} />
            {Object.keys(schema).length > 0 && <ParamControls schema={schema} values={resolveParams(schema, sel.params as Record<string, unknown>)} onChange={(k, v, ph) => set(lp('params', k), v, ph)} skip={['seed']} />}
            {sel.light && <LightControls layerId={sel.id} light={sel.light} />}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── color ────────────────────────────────────────────────────────────────────

export function ColorPanel() {
  const sh = useShow()
  const set = useSet()
  const pick = usePick()
  const layer = sh.scene ? picked(stackLayers(sh.scene, 'color')) : null
  const lp = (...rest: Array<string | number>) => (sh.scene && layer ? layerPath(sh.scene, layer.id, ...rest) : null)
  const num = (k: string, d: number) => (typeof layer?.params[k] === 'number' ? (layer.params[k] as number) : d)
  return (
    <div className={s.split}>
      <Card cap="gradients" aside={<span className={s.count}>{sh.catalog?.gradients.length ?? 0}</span>}>
        <div className={s.tiles4}>
          {sh.catalog?.gradients.map((g) => (
            <Tile key={g.id} label={g.name} background={gradientCss(g.defaults.stops, g.defaults.angle)} on={layer?.ref === g.id} onClick={() => pick('color', newLayer(sh.catalog, 'gradient', g.id, newId('lay')))} testId={`gradient-${g.id}`} title={`${g.name}: put it on the wall`} />
          ))}
        </div>
        <Cap>animated colour</Cap>
        <div className={s.tiles4} data-testid="generator-tiles">
          {sh.catalog?.colorGenerators?.map((g) => (
            <Tile key={g.id} label={g.name} background={GEN_SWATCH[g.id] ?? 'var(--control-2)'} on={layer?.kind === 'generator' && layer.ref === g.id} onClick={() => pick('color', newLayer(sh.catalog, 'generator', g.id, newId('lay')))} testId={`generator-${g.id}`} title={`${g.name}: ${g.description}`} />
          ))}
        </div>
      </Card>
      <Card cap="look" aside={layer && <span className={s.dim}>{layer.name}</span>}>
        {!layer ? (
          <EmptyState>pick a gradient.</EmptyState>
        ) : layer.kind === 'generator' ? (
          <div className={s.controls}>
            <ParamControls schema={layerParamSchema(sh.catalog, layer)} values={resolveParams(layerParamSchema(sh.catalog, layer), layer.params as Record<string, unknown>)} onChange={(k, v, ph) => set(lp('params', k), v, ph)} />
          </div>
        ) : (
          <div className={s.controls}>
            {Array.isArray(layer.params.stops) && <span className={s.bigSwatch} style={{ background: gradientCss(layer.params.stops as GradientStop[], num('angle', 135)) }} />}
            <FillSlider label="drift" value={num('drift', 0.2)} display={pct(num('drift', 0.2))} onChange={(v, ph) => set(lp('params', 'drift'), r2(v), ph)} />
            <FillSlider label="grain" value={num('grain', 0.1)} display={pct(num('grain', 0.1))} onChange={(v, ph) => set(lp('params', 'grain'), r2(v), ph)} />
            <FillSlider label="brightness" value={num('brightness', 0.9)} display={pct(num('brightness', 0.9))} onChange={(v, ph) => set(lp('params', 'brightness'), r2(v), ph)} />
            <FillSlider label="angle" value={num('angle', 135)} min={0} max={360} step={1} display={`${Math.round(num('angle', 135))}°`} onChange={(v, ph) => set(lp('params', 'angle'), Math.round(v), ph)} />
          </div>
        )}
      </Card>
    </div>
  )
}

// ── scenery ──────────────────────────────────────────────────────────────────

export function SceneryPanel() {
  const sh = useShow()
  const set = useSet()
  const pick = usePick()
  const { videos, reload } = useVideos(sh.hub)
  const cats = useMemo(() => [...new Set((sh.catalog?.scenery ?? []).map((x) => x.category ?? 'photos'))], [sh.catalog])
  const layer = sh.scene ? picked(stackLayers(sh.scene, 'scenery')) : null
  const [cat, setCat] = useState<string>(() => (layer?.kind === 'video' ? 'videos' : 'nature'))
  const open = cats.includes(cat) || cat === 'videos' ? cat : (cats[0] ?? 'videos')
  const [yt, setYt] = useState(false)
  const upload = useVideoUpload({ onError: (m) => sh.toast(m, { bad: true }), onDone: (v) => (reload(), sh.toast(`Added ${v.name}. Click it to put it on the wall.`), setCat('videos')) })
  const lp = (...rest: Array<string | number>) => (sh.scene && layer ? layerPath(sh.scene, layer.id, ...rest) : null)
  const num = (k: string, d: number) => (typeof layer?.params[k] === 'number' ? (layer.params[k] as number) : d)
  const pickVideo = (v: Video) => pick('scenery', videoLayer(newId('lay'), v.ref, v.name))
  const dur = layer?.kind === 'video' ? videos.find((v) => v.ref === layer.ref)?.duration ?? 0 : 0

  return (
    <div className={s.split}>
      <Card className={s.sceneryCard}>
        <div className={s.catRow} role="tablist" aria-label="scenery category">
          {[...cats, 'videos'].map((c) => (
            <Pill key={c} size="sm" on={open === c} onClick={() => setCat(c)} role="tab" aria-selected={open === c} data-testid={`scenery-cat-${c}`}>
              {c === 'videos' && <Icon name="video" size={13} />}
              {c}
            </Pill>
          ))}
        </div>
        {open === 'videos' ? (
          <div className={s.tiles3} data-testid="video-tiles">
            {videos.map((v) => {
              const u = videoThumbUrl(v)
              return (
                <Tile
                  key={v.id}
                  label={v.name}
                  aspect={16 / 10}
                  background={u ? `center / cover no-repeat url("${u}")` : undefined}
                  icon="video"
                  on={layer?.ref === v.ref}
                  badge={v.ref.startsWith('youtube:') ? <><Icon name="youtube" size={11} /> embed</> : v.duration ? formatDuration(v.duration) : undefined}
                  onClick={() => pickVideo(v)}
                  testId={`video-${v.id}`}
                  title={`${v.name}: put it on the wall (keeps blur, brightness, warmth and drift)`}
                />
              )
            })}
            <button type="button" className={s.addTile} onClick={() => setYt(true)} data-testid="add-youtube">
              <Icon name="youtube" size={22} />
              add from youtube
            </button>
            <button type="button" className={s.addTile} onClick={upload.pick} disabled={upload.progress !== null} data-testid="add-video-file">
              <Icon name="upload" size={20} />
              {upload.progress !== null ? `uploading ${Math.round(upload.progress * 100)}%` : 'add video file'}
              {upload.progress !== null && <ProgressBar value={upload.progress} className={s.addProg} label="upload" />}
            </button>
            {upload.input}
          </div>
        ) : (
          <div className={s.tiles3}>
            {sh.catalog?.scenery
              .filter((x) => (x.category ?? 'photos') === open)
              .map((p) => (
                <Tile key={p.id} label={p.name} aspect={16 / 10} background={`center / cover no-repeat url("${sceneryUrl(p)}")`} on={layer?.ref === p.id} onClick={() => pick('scenery', newLayer(sh.catalog, 'photo', p.id, newId('lay')))} testId={`photo-${p.id}`} title={`${p.name} · ${p.credit}: put it on the wall`} />
              ))}
          </div>
        )}
      </Card>
      <Card cap={layer?.kind === 'video' ? 'video' : 'photo'} aside={layer && <span className={s.dim}>{layer.name}</span>}>
        {!layer ? (
          <EmptyState>pick a photo or a video.</EmptyState>
        ) : (
          <div className={s.controls} data-testid="scenery-controls">
            <FillSlider label="blur" value={num('blur', 0.2)} display={pct(num('blur', 0.2))} onChange={(v, ph) => set(lp('params', 'blur'), r2(v), ph)} />
            {/* (§16) 100 % is the original picture */}
            <FillSlider label="brightness" value={num('brightness', 0.9)} display={num('brightness', 0.9) >= 1 ? '100% · original' : pct(num('brightness', 0.9))} onChange={(v, ph) => set(lp('params', 'brightness'), r2(v), ph)} />
            <FillSlider label="warmth" value={num('warmth', 0)} min={-1} max={1} step={0.01} display={num('warmth', 0) === 0 ? '0' : num('warmth', 0) > 0 ? `+${num('warmth', 0).toFixed(2)}` : num('warmth', 0).toFixed(2)} onChange={(v, ph) => set(lp('params', 'warmth'), r2(v), ph)} />
            {!(layer.kind === 'video' && layer.ref.startsWith('youtube:')) && <FillSlider label="drift" value={num('drift', 0)} display={pct(num('drift', 0))} onChange={(v, ph) => set(lp('params', 'drift'), r2(v), ph)} />}
            {layer.kind === 'video' && (
              <>
                <Cap>loop</Cap>
                <div className={s.two}>
                  <FillSlider label="from" value={num('start', 0)} min={0} max={Math.max(dur, num('start', 0), num('end', 0), 60)} step={0.5} display={`${num('start', 0).toFixed(1)} s`} onChange={(v, ph) => set(lp('params', 'start'), Math.round(v * 10) / 10, ph)} />
                  <FillSlider label="to" value={num('end', 0)} min={0} max={Math.max(dur, num('start', 0), num('end', 0), 60)} step={0.5} display={num('end', 0) === 0 ? 'end' : `${num('end', 0).toFixed(1)} s`} onChange={(v, ph) => set(lp('params', 'end'), Math.round(v * 10) / 10, ph)} />
                </div>
                {/* (§16) the video's own sound plays on the audio output (show.audio.output), at volume × master */}
                <div className={s.switchRow} data-testid="video-sound">
                  <span>sound</span>
                  <Switch checked={layer.params.audio === true} onChange={(v) => set(lp('params', 'audio'), v)} ariaLabel="play the video's sound on the audio output" />
                </div>
                {layer.params.audio === true && (
                  <>
                    <FillSlider label="volume" value={num('volume', 1)} display={pct(num('volume', 1))} onChange={(v, ph) => set(lp('params', 'volume'), r2(v), ph)} />
                    <p className={s.note}>{soundWhere(showAudio(sh.show).output)}</p>
                  </>
                )}
                {layer.ref.startsWith('youtube:') && <p className={s.note}>an embedded youtube player: blur, brightness and warmth apply as a filter, drift and motion do not. it needs the internet.</p>}
              </>
            )}
            <PictureMotion layerId={layer.id} />
          </div>
        )}
      </Card>
      {yt && (
        <YouTubeDialog
          hub={sh.hub}
          onClose={() => setYt(false)}
          onDone={(v) => {
            setYt(false)
            reload()
            setCat('videos')
            if (v) sh.toast(`Added ${v.name}. Click it to put it on the wall.`)
          }}
        />
      )}
    </div>
  )
}

/** (§16) Where a video layer's sound plays, for the scenery panel. */
function soundWhere(output: 'projector' | 'editor' | 'phone'): string {
  if (output === 'projector') return 'plays on the projector computer (/out), at this volume times the master.'
  if (output === 'editor') return 'plays on this laptop, in the editor, at this volume times the master.'
  return 'sound plays on the phone, which does not play video sound yet. pick projector or laptop under sound plays on.'
}

// ── objects ──────────────────────────────────────────────────────────────────

/** (§20) what "start with converge" will do: which light closes onto which object, or why it cannot. */
function convergeOpening(scene: NonNullable<ReturnType<typeof useShow>['scene']>, last: BackdropMode | null): { ok: boolean; hint: string } {
  const clip = scene.timeline.clips.find((c) => c.effect === 'converge' && c.start <= 1e-6)
  const track = clip ? scene.timeline.tracks.find((t) => t.id === clip.trackId) : null
  const target = track?.target.kind === 'object' ? scene.objects.find((o) => o.id === track.target.id)?.name : track?.target.kind === 'all' ? 'every object' : track?.target.kind === 'surface' ? 'its surface' : scene.objects.find((o) => o.visible)?.name
  if (!target) return { ok: false, hint: 'map an object first: the light needs a shape to close onto.' }
  const own = clip ? (clip.params as Record<string, unknown>).source : null
  const source = last ?? (scene.mode !== 'objects' ? scene.mode : typeof own === 'string' ? own : convergeSource(scene))
  return { ok: true, hint: `the ${source} light closes onto ${target}${clip ? '' : ' (adds a 2 s converge at 0)'}, then holds for go.` }
}

function objectClips(scene: NonNullable<ReturnType<typeof useShow>['scene']>, o: SceneObject) {
  const surfaces = new Set(o.surfaces.map((x) => x.id))
  const layers = new Set([...(o.layers ?? []), ...o.surfaces.flatMap((x) => x.layers ?? [])].map((l) => l.id))
  const tracks = new Set(
    scene.timeline.tracks
      .filter((t) => (t.target.kind === 'object' && t.target.id === o.id) || (t.target.kind === 'surface' && surfaces.has(t.target.id)) || (t.target.kind === 'layer' && layers.has(t.target.id)))
      .map((t) => t.id),
  )
  return scene.timeline.clips.filter((c) => tracks.has(c.trackId))
}

/** lit (a clip plays on it now, or holds its end, §20), waiting (one comes later), off. */
function objectState(scene: NonNullable<ReturnType<typeof useShow>['scene']>, o: SceneObject, t: number): 'lit' | 'waiting' | 'off' {
  if (!o.visible) return 'off'
  const c = objectClips(scene, o)
  if (c.some((x) => clipPhase(x, scene.timeline.clips.filter((y) => y.trackId === x.trackId), t, stepBounds(scene)))) return 'lit'
  if (c.some((x) => x.start > t)) return 'waiting'
  return 'off'
}

/** Re-renders a few times a second while the wall plays (states and progress follow the playhead). */
function usePlayhead(): number {
  const sh = useShow()
  const [t, setT] = useState(() => playheadNow(sh.hub, sh.show))
  const last = useRef(0)
  useRaf(() => {
    const now = performance.now()
    if (now - last.current < 200) return
    last.current = now
    setT(playheadNow(sh.hub, sh.show))
  })
  return t
}

/** (§20 "Step 0") the opening look and how go leaves it: a mode, a preset of it, converge or a fade. */
function IntroControls({ intro }: { intro: Intro }) {
  const sh = useShow()
  const presets = (useChannel<Preset[]>(sh.hub, 'presets').doc ?? []).filter((p) => p.mode === intro.source.mode)
  const set = (patch: Partial<Intro>) => void sh.editing.edit(() => [{ op: 'add', path: '/intro', value: { ...intro, on: true, ...patch } }])
  const preset = presets.find((p) => p.id === intro.source.presetId)
  return (
    <div className={s.controls} data-testid="intro-controls">
      <Segmented<BackdropMode> ariaLabel="opening look" size="sm" value={intro.source.mode} onChange={(v) => set({ source: { mode: v, presetId: null } })} options={BACKDROP_MODES.map((m) => ({ value: m, label: m }))} />
      {presets.length > 0 && (
        <Menu
          trigger={({ toggle }) => (
            <Pill size="sm" onClick={toggle} data-testid="intro-preset">
              {preset ? `preset · ${preset.name}` : 'preset · as it is'}
            </Pill>
          )}
          items={[
            { key: '', label: 'as it is', on: !preset, onSelect: () => set({ source: { mode: intro.source.mode, presetId: null } }) },
            ...presets.map((p) => ({ key: p.id, label: p.name, on: p.id === preset?.id, onSelect: () => set({ source: { mode: intro.source.mode, presetId: p.id } }) })),
          ]}
        />
      )}
      <div className={s.switchRow}>
        <span>converge into the object</span>
        <Switch checked={intro.converge} onChange={(v) => set({ converge: v })} ariaLabel="converge into the object" />
      </div>
      {intro.converge ? (
        <>
          <FillSlider label="converge" value={intro.convergeDuration / 10} display={`${intro.convergeDuration.toFixed(1)} s`} onChange={(v, ph) => ph === 'final' && set({ convergeDuration: Math.max(0.1, Math.round(v * 100) / 10) })} />
          <Segmented<Intro['from']> ariaLabel="converge from" size="sm" value={intro.from} onChange={(v) => set({ from: v })} options={[{ value: 'current', label: 'its shape' }, { value: 'circle', label: 'circle' }, { value: 'frame', label: 'frame' }]} />
        </>
      ) : (
        <>
          <Segmented<Intro['transition']> ariaLabel="into the mapping" size="sm" value={intro.transition} onChange={(v) => set({ transition: v })} options={[{ value: 'fade', label: 'fade' }, { value: 'cut', label: 'cut' }]} />
          {intro.transition === 'fade' && <FillSlider label="fade" value={intro.transitionMs / 3000} display={`${(intro.transitionMs / 1000).toFixed(1)} s`} onChange={(v, ph) => ph === 'final' && set({ transitionMs: Math.round(v * 30) * 100 })} />}
        </>
      )}
    </div>
  )
}

export function ObjectsPanel() {
  const sh = useShow()
  const t = usePlayhead()
  const scene = sh.scene
  const cues = scene ? sortedCues(scene) : []
  const transport = sh.show?.transport
  const i = Math.min(Math.max(0, transport?.cue ?? 0), Math.max(0, cues.length - 1))
  const cur = cues[i] ?? null
  const next = cues[i + 1] ?? null
  const segEnd = next ? next.at : scene?.timeline.duration ?? 0
  const segFrac = cur ? Math.max(0, Math.min(1, (t - cur.at) / Math.max(0.01, segEnd - cur.at))) : 0
  const soundName = cur?.sound?.sound ? sh.sounds.find((x) => x.sha === cur.sound!.sound)?.name ?? 'missing sound' : null
  const under = scene ? underlayOf(scene) : null
  // (§20) the opening: the light on air closes onto the object, then the wall holds for go
  const opening = scene ? convergeOpening(scene, sh.lastBackdrop) : null
  // (§20 "Step 0") the opening look: the scene's intro, or the light last on air with converge
  const intro: Intro = scene?.intro ?? defaultIntro(sh.lastBackdrop ?? (scene && scene.mode !== 'objects' ? scene.mode : 'static'))
  const step0 = transport?.step === 'intro'
  const startSequence = async () => {
    if (!scene) return
    if (!scene.intro?.on) await sh.editing.edit(() => [{ op: 'add', path: '/intro', value: { ...intro, on: true } }])
    await sh.command('show.sequence.start')
  }
  const reveal = async (o: SceneObject) => {
    if (!scene) return
    const starts = objectClips(scene, o).map((c) => c.start)
    if (!starts.length) return sh.toast(`${o.name} has no clips on the timeline yet.`, { bad: true })
    await sh.command('show.seek', { t: Math.min(...starts) })
    await sh.command('show.play')
  }
  return (
    <div className={s.split}>
      <Card cap="cues" aside={<span className={s.count}>{cues.length ? `${i + 1} / ${cues.length}` : 'none'}</span>} testId="cue-card">
        <div className={s.cueHead}>
          <span className={s.cueName} data-testid="cue-current">{cur ? `${i + 1} · ${cur.label || 'cue'}` : 'no cues'}</span>
          <span className={s.dim}>{next ? `next · ${next.label || `cue ${i + 2}`}` : 'last cue'}</span>
        </div>
        <ProgressBar segments={Math.max(1, cues.length)} filled={cues.length ? i + 1 : 0} label="cues" />
        <ProgressBar value={transport?.state === 'stopped' ? 0 : segFrac} label="this cue" />
        {opening && scene && (
          <div className={s.convergeRow}>
            {step0 && (
              <span className={s.cueSound} data-testid="step0">
                step 0 · the {intro.source.mode} look holds. go {intro.converge ? 'converges onto the object' : intro.transition === 'cut' ? 'cuts to the mapping' : 'fades into the mapping'}.
              </span>
            )}
            <button type="button" className={s.converge} onClick={startSequence} disabled={!opening.ok} title={opening.ok ? 'put the opening look on the wall: it holds until go' : opening.hint} data-testid="start-converge">
              <Icon name="converge" size={18} /> start sequence
            </button>
            <IntroControls intro={intro} />
            <span className={s.dim} data-testid="converge-hint">
              {opening.ok ? `the ${intro.source.mode} look holds until go, then ${intro.converge ? `closes onto the object over ${intro.convergeDuration} s` : intro.transition === 'cut' ? 'cuts to the mapping' : `fades into the mapping over ${(intro.transitionMs / 1000).toFixed(1)} s`}.` : opening.hint}
            </span>
          </div>
        )}
        <div className={s.goRow}>
          <button type="button" className={s.sq} onClick={() => sh.command('show.back')} aria-label="previous cue" title="previous cue" data-testid="cue-back">
            <Icon name="prev" size={18} />
          </button>
          <button type="button" className={s.go} onClick={() => sh.command('show.go')} title="jump to the next cue and play (enter)" data-testid="show-go">
            go <Icon name="arrowRight" size={20} />
          </button>
          <button type="button" className={s.sq} onClick={() => sh.command('show.stop')} aria-label="stop" title="stop the timeline" data-testid="cue-stop">
            <Icon name="stop" size={16} />
          </button>
        </div>
        {soundName && (
          <span className={s.cueSound} data-testid="cue-sound">
            <Icon name="speaker" size={13} /> {soundName}
          </span>
        )}
      </Card>
      <Card cap="objects in scene" aside={<span className={s.dim}>▸ reveals it</span>} testId="objects-list">
        {!scene?.objects.length && <EmptyState>no objects yet. map them in the map space.</EmptyState>}
        <div className={s.rows}>
          {scene?.objects.map((o) => {
            const st = objectState(scene, o, t)
            return (
              <div key={o.id} className={cx(s.lrow, st === 'lit' && s.lit)} data-testid={`object-${o.id}`} data-state={st}>
                <span className={s.thumb}>
                  <Icon name="cube" size={18} />
                </span>
                <span className={s.ltext}>
                  <span className={s.lname}>{o.name}</span>
                  <span className={s.lmeta}>
                    {o.surfaces.filter((x) => x.role === 'face').length} faces · {objectClips(scene, o).length} clips
                  </span>
                </span>
                <span className={s.ostate}>{st}</span>
                <button type="button" className={s.iconBtn} onClick={() => void reveal(o)} aria-label={`reveal ${o.name}`} title={`play from ${o.name}'s first clip`} data-testid={`reveal-${o.id}`}>
                  <Icon name="play" size={14} />
                </button>
              </div>
            )
          })}
        </div>
        {under && (
          <div className={s.underlay}>
            <div className={s.switchRow}>
              <span>backdrop under the objects</span>
              <Switch checked={under.on} onChange={(v) => void sh.editing.edit((sc) => setUnderlay(sc, { ...underlayOf(sc), on: v }))} ariaLabel="underlay" />
            </div>
            {under.on && (
              <>
                <Segmented<BackdropMode> ariaLabel="underlay from" size="sm" value={under.from} onChange={(v) => void sh.editing.edit((sc) => setUnderlay(sc, { ...underlayOf(sc), from: v }))} options={BACKDROP_MODES.map((m) => ({ value: m, label: m }))} />
                <FillSlider label="level" value={under.level} display={pct(under.level)} onChange={(v, ph) => (ph === 'final' ? void sh.editing.edit((sc) => setUnderlay(sc, { ...underlayOf(sc), level: r2(v) })) : sh.editing.setValue('/underlay/level', r2(v), 'live'))} />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

import { useRef } from 'react'
import { Cap, ColorField, FillSlider, Icon, Menu, NumField, Pill, Row, Section, Segmented, Switch, TextInput } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { LAYER_CLIP_DEFAULTS } from '../../../../render/timeline'
import { useEditor } from '../../editor/context'
import { addClip, addContentLayer, addTrack, contentLayerPath, gradientLayer, locateContentLayer, moveContentLayer, removeContentLayer, round3 } from '../../ops'
import type { BlendMode, Clip, ContentLayer, GradientStop, MediaFit, Scene, Track } from '../../types'
import s from './styles.module.css'

const r3 = (v: number) => Math.round(v * 1000) / 1000

export const contentIcon = (l: ContentLayer) => (l.kind === 'gradient' ? 'gradient' : l.media === 'video' ? 'video' : 'image')

/** The content layers of a surface or an object as rows: click selects, the eye hides, + adds. */
export function LayerList({ owner, layers, title }: { owner: { kind: 'surface' | 'object'; id: string }; layers: ContentLayer[]; title: string }) {
  const ed = useEditor()
  const file = useRef<HTMLInputElement>(null)
  const scene = ed.scene!
  return (
    <Section>
      <Row>
        <Cap>{title}</Cap>
        <Menu
          align="right"
          width={240}
          trigger={({ toggle }) => <Pill size="sm" icon="plus" aria-label={`add to ${title}`} onClick={toggle} data-testid={`add-layer-${owner.kind}`} />}
          items={[
            { key: 'pic', icon: 'image', label: 'a picture or a video', onSelect: () => file.current?.click() },
            {
              key: 'grad',
              icon: 'gradient',
              label: 'a gradient sweep',
              onSelect: () => {
                const l = gradientLayer(newId('cl'))
                void ed.editing.edit((sc) => addContentLayer(sc, owner, l))
                ed.select({ contentLayerId: l.id, focus: 'content' })
              },
            },
          ]}
        />
      </Row>
      {layers.length === 0 && <span className={s.dim}>{owner.kind === 'object' ? 'nothing spans the faces yet. drop a picture between faces in content, or add a sweep.' : 'no pictures yet. drop one on the face or add one here.'}</span>}
      <div className={s.layerRows}>
        {[...layers].reverse().map((l) => {
          const on = ed.sel.contentLayerId === l.id
          const vis = contentLayerPath(scene, l.id, 'visible')
          return (
            <div key={l.id} className={on ? s.layerOn : s.layerRow} onClick={() => ed.select({ contentLayerId: l.id, focus: 'content' })} data-testid={`content-layer-${l.id}`}>
              <Icon name={contentIcon(l)} size={14} />
              <span className={s.layerName}>{l.name}</span>
              <span className={s.dim}>{l.kind === 'media' ? l.fit : `${Math.round(l.opacity * 100)}%`}</span>
              <button
                type="button"
                className={s.eyeBtn}
                aria-label={l.visible ? `hide ${l.name}` : `show ${l.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (vis) ed.editing.setValue(vis, !l.visible, 'final')
                }}
              >
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])]
          e.target.value = ''
          if (fs.length) void ed.addMedia(fs, owner, owner.kind === 'object' ? { fit: 'fill' } : undefined)
        }}
      />
    </Section>
  )
}

/** Adds a layer track (or reuses one) and a reveal or sweep clip at the editor playhead. */
function animate(ed: ReturnType<typeof useEditor>, scene: Scene, layer: ContentLayer, effect: 'reveal' | 'sweep') {
  const existing = scene.timeline.tracks.find((t) => t.target.kind === 'layer' && t.target.id === layer.id)
  const trackId = existing?.id ?? newId('trk')
  const at = round3(Math.max(0, Math.min(scene.timeline.duration - 0.5, ed.preview.t())))
  const clip: Clip = { id: newId('clp'), trackId, effect, start: at, end: round3(Math.min(scene.timeline.duration, at + 3)), fadeIn: 0, fadeOut: 0, params: { ...LAYER_CLIP_DEFAULTS[effect] } }
  void ed.editing.edit(() => [...(existing ? [] : addTrack({ id: trackId, name: `${layer.name} · ${effect}`, target: { kind: 'layer', id: layer.id } } as Track)), ...addClip(clip)])
  ed.setTimelineOpen(true)
  ed.toast(effect === 'reveal' ? 'Added a reveal clip at the playhead. Press space to preview it.' : 'Added a sweep clip at the playhead. Press space to preview it.')
}

/** One content layer (protocol §12): look, placement, wipe and, for media, fit and crop; gradients get their stops. */
export function ContentLayerInspector({ scene, layerId }: { scene: Scene; layerId: string }) {
  const ed = useEditor()
  const loc = locateContentLayer(scene, layerId)!
  const l = loc.layer
  const p = (...rest: Array<string | number>) => contentLayerPath(scene, layerId, ...rest)!
  const set = (key: string, v: unknown, ph: 'live' | 'final' = 'final') => ed.editing.setValue(p(key), v, ph)
  const setDeep = (path: string, v: unknown, ph: 'live' | 'final' = 'final') => ed.editing.setValue(path, v, ph)
  const ownerName =
    loc.owner.kind === 'object'
      ? scene.objects.find((o) => o.id === loc.owner.id)?.name ?? ''
      : scene.objects.flatMap((o) => o.surfaces.map((x) => ({ x, o }))).find((r) => r.x.id === loc.owner.id)?.x.name ?? ''
  const stops = l.stops ?? []
  const crop = l.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const animated = scene.timeline.tracks.some((t) => t.target.kind === 'layer' && t.target.id === l.id)
  return (
    <div className={s.insp} data-testid="content-layer-inspector">
      <div className={s.ph}>
        <span className={s.title}>
          <Cap>{loc.owner.kind === 'object' ? 'across the object' : 'face layer'}</Cap>
          <span className={s.name}>
            {ownerName} / {l.name}
          </span>
        </span>
        <Menu
          align="right"
          width={220}
          trigger={({ toggle }) => <Pill size="sm" icon="more" aria-label="more" onClick={toggle} />}
          items={[
            { key: 'up', label: 'move up', icon: 'chevronDown', onSelect: () => void ed.editing.edit((sc) => moveContentLayer(sc, layerId, 1)) },
            { key: 'down', label: 'move down', icon: 'chevronDown', onSelect: () => void ed.editing.edit((sc) => moveContentLayer(sc, layerId, -1)) },
            {
              key: 'del',
              label: 'remove layer',
              icon: 'trash',
              danger: true,
              onSelect: () => {
                void ed.editing.edit((sc) => removeContentLayer(sc, layerId))
                ed.select({ contentLayerId: null, focus: loc.owner.kind === 'surface' ? 'surface' : 'object' })
              },
            },
          ]}
        />
      </div>
      <Section tight>
        <TextInput defaultValue={l.name} key={l.name} aria-label="name" onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && set('name', e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <Row>
          <span>visible</span>
          <Switch checked={l.visible} onChange={(v) => set('visible', v)} ariaLabel="visible" />
        </Row>
        <Segmented<BlendMode> ariaLabel="blend" value={l.blend} onChange={(v) => set('blend', v)} options={(['normal', 'multiply', 'screen', 'add'] as BlendMode[]).map((b) => ({ value: b, label: b }))} />
        <FillSlider label="opacity" value={l.opacity} display={`${Math.round(l.opacity * 100)}%`} onChange={(v, ph) => set('opacity', Math.round(v * 100) / 100, ph)} />
      </Section>
      {l.kind === 'media' && (
        <Section>
          <Cap>fit</Cap>
          <Segmented<MediaFit>
            ariaLabel="fit"
            value={l.fit ?? 'fill'}
            onChange={(v) => set('fit', v)}
            options={[
              { value: 'fill', label: 'fill', title: 'cover the canvas, crop the rest' },
              { value: 'fit', label: 'fit', title: 'show all of it' },
              { value: 'stretch', label: 'stretch', title: 'fill exactly, ignore the aspect' },
            ]}
          />
          <Cap>crop</Cap>
          <div className={s.two}>
            <NumField prefix="x" ariaLabel="crop x" value={crop.x} digits={3} step={0.01} min={0} max={1} onCommit={(v) => set('crop', { ...crop, x: r3(Math.min(1 - crop.w, Math.max(0, v))) })} />
            <NumField prefix="y" ariaLabel="crop y" value={crop.y} digits={3} step={0.01} min={0} max={1} onCommit={(v) => set('crop', { ...crop, y: r3(Math.min(1 - crop.h, Math.max(0, v))) })} />
            <NumField prefix="w" ariaLabel="crop width" value={crop.w} digits={3} step={0.01} min={0.01} max={1} onCommit={(v) => set('crop', { ...crop, w: r3(Math.min(1 - crop.x, Math.max(0.01, v))) })} />
            <NumField prefix="h" ariaLabel="crop height" value={crop.h} digits={3} step={0.01} min={0.01} max={1} onCommit={(v) => set('crop', { ...crop, h: r3(Math.min(1 - crop.y, Math.max(0.01, v))) })} />
          </div>
          <span className={s.dim}>{l.src?.startsWith('asset:') ? `${l.media} · uploaded` : `${l.media} · ${l.src}`}</span>
        </Section>
      )}
      {l.kind === 'gradient' && (
        <Section>
          <Row>
            <Cap>stops</Cap>
            <Pill size="sm" icon="plus" aria-label="add stop" disabled={stops.length >= 8} onClick={() => set('stops', [...stops, { color: stops[stops.length - 1]?.color ?? '#ffffff', pos: 1 }])} />
          </Row>
          {stops.map((st: GradientStop, i: number) => (
            <div key={i} className={s.stop}>
              <ColorField label={`stop ${i + 1}`} value={st.color} onChange={(hex, ph) => setDeep(p('stops', i, 'color'), hex, ph)} />
              <FillSlider label="at" value={st.pos} display={`${Math.round(st.pos * 100)}%`} onChange={(v, ph) => setDeep(p('stops', i, 'pos'), Math.round(v * 100) / 100, ph)} />
              {stops.length > 1 && <Pill size="sm" ghost icon="trash" aria-label={`remove stop ${i + 1}`} onClick={() => set('stops', stops.filter((_, j) => j !== i))} />}
            </div>
          ))}
          <FillSlider label="angle" value={l.angle ?? 0} min={-180} max={180} step={1} display={`${Math.round(l.angle ?? 0)}°`} onChange={(v, ph) => set('angle', Math.round(v), ph)} />
          <FillSlider label="offset" value={l.offset ?? 0} min={-1} max={1} step={0.01} display={(l.offset ?? 0).toFixed(2)} onChange={(v, ph) => set('offset', r3(v), ph)} />
          <Row>
            <span>repeat</span>
            <Switch checked={!!l.repeat} onChange={(v) => set('repeat', v)} ariaLabel="repeat" />
          </Row>
        </Section>
      )}
      <Section>
        <Cap>placement</Cap>
        <div className={s.two}>
          <NumField prefix="x" ariaLabel="offset x" value={l.x} digits={3} step={0.01} onCommit={(v) => set('x', r3(v))} />
          <NumField prefix="y" ariaLabel="offset y" value={l.y} digits={3} step={0.01} onCommit={(v) => set('y', r3(v))} />
          <NumField prefix="scale" ariaLabel="scale" value={l.scale} digits={2} step={0.05} min={0.01} max={100} onCommit={(v) => set('scale', r3(Math.max(0.01, v)))} />
          <NumField prefix="turn" suffix="°" ariaLabel="rotation" value={l.rotation} digits={1} step={1} onCommit={(v) => set('rotation', Math.round(v * 10) / 10)} />
        </div>
        <span className={s.dim}>drag the box in content to move it, a corner to scale, the knob to turn it.</span>
      </Section>
      <Section>
        <Cap>reveal</Cap>
        <FillSlider label="reveal" value={l.reveal} display={`${Math.round(l.reveal * 100)}%`} onChange={(v, ph) => set('reveal', r3(v), ph)} />
        <FillSlider label="from" value={l.revealAngle} min={-180} max={180} step={1} display={`${Math.round(l.revealAngle)}°`} onChange={(v, ph) => set('revealAngle', Math.round(v), ph)} />
        <Row>
          <Pill size="sm" icon="play" onClick={() => animate(ed, scene, l, 'reveal')} title="add a clip that wipes this layer on, at the editor playhead" data-testid="animate-reveal">
            wipe on
          </Pill>
          <Pill size="sm" icon="gradient" onClick={() => animate(ed, scene, l, 'sweep')} title={l.kind === 'gradient' ? 'add a clip that moves the band across' : 'add a clip that slides the picture across'} data-testid="animate-sweep">
            sweep
          </Pill>
        </Row>
        {animated && <span className={s.dim}>the timeline animates this layer; open it under the stage.</span>}
      </Section>
    </div>
  )
}

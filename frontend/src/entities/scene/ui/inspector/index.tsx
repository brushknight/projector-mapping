import { useState } from 'react'
import {
  Cap,
  ColorField,
  EfxCard,
  EmptyState,
  FillSlider,
  Icon,
  Menu,
  NumField,
  Pill,
  Row,
  Section,
  Segmented,
  Switch,
  TextInput,
} from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { pointer } from '../../../../shared/lib/jsonPatch'
import { layerParamSchema } from '../../../catalog'
import { ParamControls, effectIcon, resolveParams, schemaDefaults, type EffectDef } from '../../../effect'
import { sceneApi } from '../../api'
import { useEditor } from '../../editor/context'
import { dist } from '../../geometry'
import { findLayer, locateLayer, stackLayers } from '../../lib'
import {
  addSurfaceEffect,
  clipPath,
  convergeSource,
  deleteObject,
  deleteSurface,
  flatMesh,
  layerPath,
  locateSurface,
  moveLayer,
  removeClip,
  removeLayer,
  removeSurfaceEffect,
  surfaceEffectPath,
  surfacePath,
} from '../../ops'
import { BACKDROP_MODES, type BackdropMode, type BlendMode, type Clip, type ConvergeEase, type ConvergeFrom, type GradientStop, type Layer, type LightFxKind, type Scene, type Surface, type SurfaceRole } from '../../types'
import { ContentLayerInspector, LayerList } from './content'
import { CueInspector, SoundClipInspector, VideoLayerNote } from './sound'
import { locateContentLayer } from '../../ops'
import { clipHoldMode, clipHolds, LAYER_CLIP_DEFAULTS, SCENE_EFFECTS, type HoldMode } from '../../../../render/timeline'
import { MORPH_KINDS, morphParams, shapeName, type MorphKind, type MorphShapeSpec } from '../../../../render/morph'
import { PLATES, plateSvg } from '../../../../render/plates'
import { convergeParams } from '../../../../render/converge'
import { resolveAtlas } from '../../../../render'
import s from './styles.module.css'

/** The right panel in map and animate: shows whatever is selected. */
export function Inspector() {
  const ed = useEditor()
  const scene = ed.scene
  if (!scene) return <EmptyState>open a scene to edit it.</EmptyState>
  const f = ed.sel.focus
  if (f === 'content' && ed.sel.contentLayerId && locateContentLayer(scene, ed.sel.contentLayerId)) return <ContentLayerInspector scene={scene} layerId={ed.sel.contentLayerId} />
  if ((f === 'surface' || f === 'content') && ed.sel.surfaceId) {
    const loc = locateSurface(scene, ed.sel.surfaceId)
    if (loc) return <SurfaceInspector scene={scene} surface={scene.objects[loc.o].surfaces[loc.s]} objectName={scene.objects[loc.o].name} />
  }
  if (f === 'object' && ed.sel.objectId) {
    const obj = scene.objects.find((o) => o.id === ed.sel.objectId)
    if (obj) return <ObjectInspector scene={scene} objectId={obj.id} />
  }
  if (f === 'layer' && ed.sel.layerId) {
    const layer = findLayer(scene, ed.sel.layerId)
    if (layer) return <LayerInspector scene={scene} layer={layer} />
  }
  if (f === 'clip' && ed.sel.clipId) {
    const clip = scene.timeline.clips.find((c) => c.id === ed.sel.clipId)
    // §14: a clip on a sound track plays a sound
    if (clip && scene.timeline.tracks.find((t) => t.id === clip.trackId)?.target.kind === 'sound') return <SoundClipInspector scene={scene} clipId={clip.id} />
    if (clip) return <ClipInspector scene={scene} clipId={clip.id} />
  }
  if (f === 'cue' && ed.sel.cueId && scene.timeline.cues.some((c) => c.id === ed.sel.cueId)) return <CueInspector scene={scene} cueId={ed.sel.cueId} />
  return <SceneInspector scene={scene} />
}

function Header({ kind, title, menu }: { kind: string; title: string; menu?: Array<{ key: string; label: string; icon?: string; danger?: boolean; onSelect: () => void }> }) {
  return (
    <div className={s.ph}>
      <span className={s.title}>
        <Cap>{kind}</Cap>
        <span className={s.name}>{title}</span>
      </span>
      {menu && (
        <Menu align="right" width={220} trigger={({ toggle }) => <Pill size="sm" icon="more" aria-label="more" onClick={toggle} />} items={menu} />
      )}
    </div>
  )
}

function Rename({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return <TextInput defaultValue={value} key={value} aria-label="name" onBlur={(e) => e.target.value.trim() && e.target.value !== value && onCommit(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
}

// ── surface ──────────────────────────────────────────────────────────────────

function SurfaceInspector({ scene, surface, objectName }: { scene: Scene; surface: Surface; objectName: string }) {
  const ed = useEditor()
  const loc = locateSurface(scene, surface.id)!
  const pts = new Map(scene.points.map((p) => [p.id, p]))
  const sp = (...rest: Array<string | number>) => surfacePath(loc, ...rest)
  const sharedWith = (pid: string) =>
    scene.objects
      .flatMap((o) => o.surfaces)
      .filter((x) => x.id !== surface.id && x.pointIds.includes(pid))
      .map((x) => x.name)
  const selIdx = ed.sel.pointId ? surface.pointIds.indexOf(ed.sel.pointId) : -1
  const selShared = ed.sel.pointId ? sharedWith(ed.sel.pointId) : []
  const warp = surface.mesh ? (surface.mesh.bezier ? 'bezier' : 'mesh') : 'corner pin'
  const kindName = surface.kind === 'mask' ? 'mask' : surface.role
  const parents = scene.objects.flatMap((o) => o.surfaces).filter((x) => x.id !== surface.id && x.role === 'face' && x.kind !== 'line')

  const setPoint = (pid: string, axis: 'x' | 'y', v: number) => {
    const i = scene.points.findIndex((p) => p.id === pid)
    if (i >= 0) ed.editing.setValue(pointer('points', i, axis), Math.round(v * 10) / 10, 'final')
  }

  return (
    <div className={s.insp} data-testid="surface-inspector">
      <Header
        kind={kindName}
        title={`${objectName} / ${surface.name}`}
        menu={[
          { key: 'del', label: 'delete surface', icon: 'trash', danger: true, onSelect: () => {
            void ed.editing.edit((sc) => deleteSurface(sc, surface.id))
            ed.select({ surfaceId: null, pointId: null, focus: null })
          } },
        ]}
      />
      {surface.kind !== 'line' && surface.kind !== 'mask' && (
        <div className={s.flatRow}>
          <Pill on icon="edit" onClick={() => ed.editFace(surface.id)} title="open this face in content to put pictures, drawings and effects on it (F)" data-testid="inspector-edit-face">
            add content
          </Pill>
          <Pill size="sm" ghost icon="solo" onClick={() => ed.soloSelection(false)} title="show only this face on the stage (S); shift+S also on the wall">
            solo
          </Pill>
        </div>
      )}
      {surface.kind !== 'line' && surface.kind !== 'mask' && <LayerList owner={{ kind: 'surface', id: surface.id }} layers={surface.layers ?? []} title="pictures" />}
      <Section tight>
        <Rename value={surface.name} onCommit={(v) => ed.editing.setValue(sp('name'), v, 'final')} />
        <Row>
          <Cap>{surface.kind === 'circle' ? 'centre and rim' : surface.kind === 'line' || surface.kind === 'poly' || surface.kind === 'mask' ? 'points' : 'corners'}</Cap>
          <Cap>{selIdx >= 0 && selShared.length ? `P${selIdx + 1} shared with ${selShared.join(', ')}` : ''}</Cap>
        </Row>
        <div className={s.points}>
          {surface.pointIds.map((pid, i) => {
            const p = pts.get(pid)
            if (!p) return null
            const on = ed.sel.pointId === pid
            const shared = sharedWith(pid).length > 0
            return (
              <div key={`${pid}-${i}`} className={s.vx} onClick={() => ed.select({ pointId: pid, meshIndex: null })}>
                <span className={on ? s.pOn : s.p}>{surface.kind === 'circle' ? (i === 0 ? 'C' : 'R') : `P${i + 1}`}</span>
                <NumField prefix="x" ariaLabel={`P${i + 1} x`} value={p.x} selected={on} onCommit={(v) => setPoint(pid, 'x', v)} />
                <NumField prefix="y" ariaLabel={`P${i + 1} y`} value={p.y} selected={on} onCommit={(v) => setPoint(pid, 'y', v)} />
                <span className={s.dim} title={shared ? 'shared with another surface' : ''}>
                  {shared && <Icon name="link" size={13} />}
                </span>
              </div>
            )
          })}
        </div>
        {surface.kind === 'circle' && surface.pointIds.length >= 2 && pts.get(surface.pointIds[0]) && pts.get(surface.pointIds[1]) && (
          <Row>
            <span className={s.dim}>radius</span>
            <span className={s.numText}>{dist(pts.get(surface.pointIds[0])!, pts.get(surface.pointIds[1])!).toFixed(1)} px</span>
          </Row>
        )}
      </Section>

      {surface.kind === 'quad' && (
        <Section>
          <Cap>warp</Cap>
          <Segmented
            ariaLabel="warp"
            value={warp}
            onChange={(w) => ed.editing.setValue(sp('mesh'), w === 'corner pin' ? null : { ...(surface.mesh ?? flatMesh(4, 4)), bezier: w === 'bezier' }, 'final')}
            options={[
              { value: 'corner pin', label: 'corner pin' },
              { value: 'mesh', label: 'mesh' },
              { value: 'bezier', label: 'bezier' },
            ]}
          />
          {surface.mesh && (
            <div className={s.two}>
              <NumField prefix="cols" ariaLabel="mesh columns" value={surface.mesh.cols} min={1} max={16} onCommit={(v) => ed.editing.setValue(sp('mesh'), resize(surface.mesh!, Math.round(v), surface.mesh!.rows), 'final')} />
              <NumField prefix="rows" ariaLabel="mesh rows" value={surface.mesh.rows} min={1} max={16} onCommit={(v) => ed.editing.setValue(sp('mesh'), resize(surface.mesh!, surface.mesh!.cols, Math.round(v)), 'final')} />
            </div>
          )}
          <Row>
            <span>lock corners while meshing</span>
            <Switch checked={ed.lockCorners} onChange={ed.setLockCorners} ariaLabel="lock corners while meshing" />
          </Row>
          {surface.mesh && (
            <Pill size="sm" ghost onClick={() => ed.editing.setValue(sp('mesh'), flatMesh(surface.mesh!.cols, surface.mesh!.rows, surface.mesh!.bezier), 'final')}>
              flatten the mesh
            </Pill>
          )}
        </Section>
      )}

      <Section>
        <Row>
          <Cap>effects</Cap>
          <AddEffectMenu onPick={(def) => void ed.editing.edit((sc) => addSurfaceEffect(sc, surface.id, { id: newId('fx'), effect: def.id, enabled: true, params: schemaDefaults(def.params) }))} />
        </Row>
        {surface.effects.length === 0 && <span className={s.dim}>no effects. add one, or drop one from the library.</span>}
        {surface.effects.map((fx) => {
          const def = ed.effects.find((d) => d.id === fx.effect)
          const values = resolveParams(def?.params, fx.params as Record<string, unknown>)
          return (
            <EfxCard
              key={fx.id}
              icon={effectIcon(fx.effect, def?.kind)}
              name={def?.name ?? fx.effect}
              enabled={fx.enabled}
              onToggle={(v) => {
                const p = surfaceEffectPath(scene, surface.id, fx.id, 'enabled')
                if (p) ed.editing.setValue(p, v, 'final')
              }}
              actions={<Pill size="sm" ghost icon="trash" aria-label={`remove ${def?.name ?? fx.effect}`} onClick={() => void ed.editing.edit((sc) => removeSurfaceEffect(sc, surface.id, fx.id))} />}
            >
              {def ? (
                <ParamControls
                  schema={def.params}
                  values={values}
                  onChange={(key, v, phase) => {
                    const p = surfaceEffectPath(scene, surface.id, fx.id, 'params', key)
                    if (p) ed.editing.setValue(p, v, phase)
                  }}
                />
              ) : (
                <span className={s.dim}>unknown effect {fx.effect}</span>
              )}
            </EfxCard>
          )
        })}
      </Section>

      <Section>
        <Cap>blend</Cap>
        <FillSlider label="opacity" value={surface.opacity} display={`${Math.round(surface.opacity * 100)}%`} onChange={(v, ph) => ed.editing.setValue(sp('opacity'), Math.round(v * 100) / 100, ph)} />
        <FillSlider label="soft edge" value={surface.softEdge} min={0} max={100} step={1} display={`${Math.round(surface.softEdge)} px`} onChange={(v, ph) => ed.editing.setValue(sp('softEdge'), Math.round(v), ph)} />
      </Section>

      <Section>
        <Cap>role</Cap>
        <Segmented<SurfaceRole>
          ariaLabel="role"
          value={surface.role}
          onChange={(r) => ed.editing.setValues([[sp('role'), r], ...(r !== 'detail' ? ([[sp('parentId'), null]] as Array<[string, unknown]>) : [])], 'final')}
          options={[
            { value: 'face', label: 'face' },
            { value: 'edge', label: 'edge' },
            { value: 'detail', label: 'detail' },
          ]}
        />
        {surface.role === 'detail' && (
          <Row>
            <span>inside</span>
            <Menu
              align="right"
              width={200}
              trigger={({ toggle }) => (
                <Pill size="sm" icon="chevronDown" onClick={toggle}>
                  {parents.find((p) => p.id === surface.parentId)?.name ?? 'pick a face'}
                </Pill>
              )}
              items={parents.map((p) => ({ key: p.id, label: p.name, on: p.id === surface.parentId, onSelect: () => ed.editing.setValue(sp('parentId'), p.id, 'final') }))}
            />
          </Row>
        )}
      </Section>
    </div>
  )
}

function resize(mesh: NonNullable<Surface['mesh']>, cols: number, rows: number) {
  return { ...flatMesh(Math.max(1, cols), Math.max(1, rows), mesh.bezier) }
}

export function AddEffectMenu({ onPick, label, timeline }: { onPick: (def: EffectDef) => void; label?: string; timeline?: boolean }) {
  const ed = useEditor()
  // (§20) the converge only lives on the timeline: it is not something a surface shows all the time
  const builtins = ed.effects.filter((e) => e.kind === 'builtin' && (timeline || !SCENE_EFFECTS.has(e.id)))
  const users = ed.effects.filter((e) => e.kind !== 'builtin')
  return (
    <Menu
      align="right"
      width={240}
      trigger={({ toggle }) => (label ? <Pill size="sm" icon="plus" onClick={toggle}>{label}</Pill> : <Pill size="sm" icon="plus" aria-label="add effect" onClick={toggle} />)}
      items={[
        { key: 'b', caption: true, label: 'built in' },
        ...builtins.map((d) => ({ key: d.id, icon: effectIcon(d.id, d.kind), label: d.name, onSelect: () => onPick(d) })),
        ...(users.length ? [{ key: 'u', caption: true, label: 'made by you and agents' }] : []),
        ...users.map((d) => ({ key: d.id, icon: effectIcon(d.id, d.kind), label: d.name, meta: d.kind, onSelect: () => onPick(d) })),
      ]}
    />
  )
}

// ── object ───────────────────────────────────────────────────────────────────

function ObjectInspector({ scene, objectId }: { scene: Scene; objectId: string }) {
  const ed = useEditor()
  const o = scene.objects.findIndex((x) => x.id === objectId)
  const obj = scene.objects[o]
  const [tag, setTag] = useState('')
  return (
    <div className={s.insp}>
      <Header
        kind="object"
        title={obj.name}
        menu={[
          { key: 'del', label: 'delete object', icon: 'trash', danger: true, onSelect: () => {
            void ed.editing.edit((sc) => deleteObject(sc, objectId))
            ed.select({ objectId: null, surfaceId: null, focus: null })
          } },
        ]}
      />
      <Section tight>
        <Rename value={obj.name} onCommit={(v) => ed.editing.setValue(pointer('objects', o, 'name'), v, 'final')} />
        <Row>
          <span>show on the wall</span>
          <Switch checked={obj.visible} onChange={(v) => ed.editing.setValue(pointer('objects', o, 'visible'), v, 'final')} ariaLabel="show object" />
        </Row>
      </Section>
      <Section>
        <Cap>tags</Cap>
        <div className={s.tags}>
          {obj.tags.map((t) => (
            <Pill key={t} size="sm" onClick={() => ed.editing.setValue(pointer('objects', o, 'tags'), obj.tags.filter((x) => x !== t), 'final')} title="remove tag">
              {t} ×
            </Pill>
          ))}
        </div>
        <TextInput
          value={tag}
          placeholder="add a tag, then enter"
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tag.trim()) {
              ed.editing.setValue(pointer('objects', o, 'tags'), [...new Set([...obj.tags, tag.trim()])], 'final')
              setTag('')
            }
          }}
        />
      </Section>
      <LayerList owner={{ kind: 'object', id: obj.id }} layers={obj.layers ?? []} title="across the faces" />
      <Section>
        <Row>
          <Cap>unfold</Cap>
          <span className={s.numText}>
            {(() => {
              const a = resolveAtlas(scene, obj)
              return `${a.width}×${a.height} px${obj.atlas ? '' : ' · auto'}`
            })()}
          </span>
        </Row>
        <Pill size="sm" icon="layers" onClick={() => ed.setSpace('content')} title="see the faces unfolded flat (tab)">
          open the unfold
        </Pill>
        <span className={s.dim}>{obj.surfaces.length} surfaces. draw with the tools on the stage; new surfaces join this object.</span>
      </Section>
    </div>
  )
}

// ── backdrop layer ───────────────────────────────────────────────────────────

const FX: LightFxKind[] = ['none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police']

function LayerInspector({ scene, layer }: { scene: Scene; layer: Layer }) {
  const ed = useEditor()
  const lp = (...rest: Array<string | number>) => layerPath(scene, layer.id, ...rest)!
  const set = (path: string, v: unknown, ph: 'live' | 'final' = 'final') => ed.editing.setValue(path, v, ph)
  const schema = layerParamSchema(ed.catalog, layer)
  const light = layer.light
  const cat = ed.catalog
  const stops = Array.isArray(layer.params.stops) ? (layer.params.stops as GradientStop[]) : null
  const loc = locateLayer(scene, layer.id)
  const idx = loc?.i ?? -1
  const stackLen = loc ? stackLayers(scene, loc.mode).length : 0

  return (
    <div className={s.insp} data-testid="layer-inspector">
      <Header
        kind={layer.kind === 'procedural' ? 'live layer' : layer.kind}
        title={layer.name}
        menu={[
          { key: 'up', label: 'move up', icon: 'chevronDown', onSelect: () => void ed.editing.edit((sc) => moveLayer(sc, layer.id, 1)) },
          { key: 'down', label: 'move down', icon: 'chevronDown', onSelect: () => void ed.editing.edit((sc) => moveLayer(sc, layer.id, -1)) },
          { key: 'del', label: 'remove layer', icon: 'trash', danger: true, onSelect: () => {
            void ed.editing.edit((sc) => removeLayer(sc, layer.id))
            ed.select({ layerId: null, focus: null })
          } },
        ]}
      />
      <Section tight>
        <Rename value={layer.name} onCommit={(v) => set(lp('name'), v)} />
        <Row>
          <span>visible</span>
          <span className={s.inline}>
            <Pill size="sm" ghost icon="chevronDown" aria-label="move down" disabled={idx <= 0} onClick={() => void ed.editing.edit((sc) => moveLayer(sc, layer.id, -1))} />
            <Pill size="sm" ghost aria-label="move up" disabled={idx >= stackLen - 1} onClick={() => void ed.editing.edit((sc) => moveLayer(sc, layer.id, 1))}>
              <span className={s.flip}>
                <Icon name="chevronDown" size={14} />
              </span>
            </Pill>
            <Switch checked={layer.visible} onChange={(v) => set(lp('visible'), v)} ariaLabel="visible" />
          </span>
        </Row>
        <Segmented<BlendMode>
          ariaLabel="blend"
          value={layer.blend}
          onChange={(v) => set(lp('blend'), v)}
          options={(['normal', 'multiply', 'screen', 'add'] as BlendMode[]).map((b) => ({ value: b, label: b }))}
        />
        <FillSlider label="opacity" value={layer.opacity} display={`${Math.round(layer.opacity * 100)}%`} onChange={(v, ph) => set(lp('opacity'), Math.round(v * 100) / 100, ph)} />
      </Section>

      {light && (
        <Section>
          <Cap>light</Cap>
          <FillSlider label="intensity" value={light.intensity} display={`${Math.round(light.intensity * 100)}%`} onChange={(v, ph) => set(lp('light', 'intensity'), r2(v), ph)} />
          <FillSlider label="softness" value={light.softness} display={`${Math.round(light.softness * 100)}%`} onChange={(v, ph) => set(lp('light', 'softness'), r2(v), ph)} />
          <FillSlider label="angle" value={light.angle} min={-90} max={90} step={1} display={`${Math.round(light.angle)}°`} onChange={(v, ph) => set(lp('light', 'angle'), Math.round(v), ph)} />
          <FillSlider label="scale" value={light.scale} min={0.25} max={4} step={0.05} display={`${light.scale.toFixed(2)}×`} onChange={(v, ph) => set(lp('light', 'scale'), r2(v), ph)} />
          <div className={s.two}>
            <FillSlider label="x" value={light.offsetX} min={-1} max={1} step={0.01} display={light.offsetX.toFixed(2)} onChange={(v, ph) => set(lp('light', 'offsetX'), r2(v), ph)} />
            <FillSlider label="y" value={light.offsetY} min={-1} max={1} step={0.01} display={light.offsetY.toFixed(2)} onChange={(v, ph) => set(lp('light', 'offsetY'), r2(v), ph)} />
          </div>
          <Cap>color</Cap>
          <Segmented
            ariaLabel="color mode"
            value={light.color.mode}
            onChange={(v) => set(lp('light', 'color', 'mode'), v)}
            options={[
              { value: 'cct', label: 'white (kelvin)' },
              { value: 'hsi', label: 'color' },
            ]}
          />
          {light.color.mode === 'cct' ? (
            <>
              <FillSlider label="kelvin" value={light.color.kelvin} min={2000} max={10000} step={50} display={`${Math.round(light.color.kelvin)} K`} onChange={(v, ph) => set(lp('light', 'color', 'kelvin'), Math.round(v), ph)} />
              <FillSlider label="tint" value={light.color.tint} min={-1} max={1} step={0.01} display={light.color.tint > 0 ? `+${light.color.tint.toFixed(2)} magenta` : light.color.tint < 0 ? `${light.color.tint.toFixed(2)} green` : '0'} onChange={(v, ph) => set(lp('light', 'color', 'tint'), r2(v), ph)} />
              <div className={s.chips}>
                {cat?.light.cctPresets.map((p) => (
                  <Pill key={p.id} size="sm" on={light.color.kelvin === p.kelvin} onClick={() => set(lp('light', 'color', 'kelvin'), p.kelvin)}>
                    {p.id} {p.kelvin}
                  </Pill>
                ))}
              </div>
            </>
          ) : (
            <>
              <FillSlider label="hue" value={light.color.hue} min={0} max={360} step={1} display={`${Math.round(light.color.hue)}°`} onChange={(v, ph) => set(lp('light', 'color', 'hue'), Math.round(v), ph)} />
              <FillSlider label="saturation" value={light.color.sat} display={`${Math.round(light.color.sat * 100)}%`} onChange={(v, ph) => set(lp('light', 'color', 'sat'), r2(v), ph)} />
            </>
          )}
          <Cap>light fx</Cap>
          <Menu
            width={200}
            trigger={({ toggle }) => (
              <Pill size="sm" icon="chevronDown" onClick={toggle}>
                {light.fx.kind}
              </Pill>
            )}
            items={FX.map((k) => ({ key: k, label: k, on: k === light.fx.kind, onSelect: () => set(lp('light', 'fx', 'kind'), k) }))}
          />
          {light.fx.kind !== 'none' && <FillSlider label="speed" value={light.fx.speed} display={`${Math.round(light.fx.speed * 100)}%`} onChange={(v, ph) => set(lp('light', 'fx', 'speed'), r2(v), ph)} />}
        </Section>
      )}

      {layer.kind === 'gobo' && cat && (
        <Section>
          <Cap>gobo</Cap>
          <div className={s.chips}>
            {cat.gobos.map((g) => (
              <Pill key={g.id} size="sm" on={g.id === layer.ref} onClick={() => ed.editing.setValues([[lp('ref'), g.id], [lp('name'), g.name]], 'final')}>
                {g.name}
              </Pill>
            ))}
          </div>
        </Section>
      )}

      {layer.kind === 'photo' && cat && (
        <Section>
          <Cap>photo</Cap>
          <div className={s.chips}>
            {cat.scenery.map((g) => (
              <Pill key={g.id} size="sm" on={g.id === layer.ref} onClick={() => ed.editing.setValues([[lp('ref'), g.id], [lp('name'), g.name]], 'final')}>
                {g.name}
              </Pill>
            ))}
          </div>
        </Section>
      )}

      {layer.kind === 'video' && <VideoLayerNote layer={layer} />}

      {stops && (
        <Section>
          <Row>
            <Cap>stops</Cap>
            <Pill size="sm" icon="plus" aria-label="add stop" disabled={stops.length >= 8} onClick={() => set(lp('params', 'stops'), [...stops, { color: stops[stops.length - 1]?.color ?? '#ffffff', pos: 1 }])} />
          </Row>
          {stops.map((st, i) => (
            <div key={i} className={s.stop}>
              <ColorField label={`stop ${i + 1}`} value={st.color} onChange={(hex, ph) => set(lp('params', 'stops', i, 'color'), hex, ph)} />
              <FillSlider label="at" value={st.pos} display={`${Math.round(st.pos * 100)}%`} onChange={(v, ph) => set(lp('params', 'stops', i, 'pos'), r2(v), ph)} />
              {stops.length > 2 && <Pill size="sm" ghost icon="trash" aria-label={`remove stop ${i + 1}`} onClick={() => set(lp('params', 'stops'), stops.filter((_, j) => j !== i))} />}
            </div>
          ))}
        </Section>
      )}

      {Object.keys(schema).length > 0 && (
        <Section>
          <Cap>{layer.kind === 'procedural' ? 'motion' : 'look'}</Cap>
          <ParamControls schema={schema} values={resolveParams(schema, layer.params as Record<string, unknown>)} onChange={(k, v, ph) => set(lp('params', k), v, ph)} />
        </Section>
      )}
    </div>
  )
}

const r2 = (v: number) => Math.round(v * 100) / 100

// ── timeline clip ────────────────────────────────────────────────────────────

function ClipInspector({ scene, clipId }: { scene: Scene; clipId: string }) {
  const ed = useEditor()
  const clip = scene.timeline.clips.find((c) => c.id === clipId)!
  const def = ed.effects.find((d) => d.id === clip.effect)
  const cp = (...rest: Array<string | number>) => clipPath(scene, clipId, ...rest)!
  const track = scene.timeline.tracks.find((t) => t.id === clip.trackId)
  const layerClip = track?.target.kind === 'layer'
  const lp = clip.params as Record<string, unknown>
  const dflt = LAYER_CLIP_DEFAULTS[clip.effect] ?? { from: 0, to: 1 }
  const num = (k: 'from' | 'to') => (Number.isFinite(Number(lp[k])) ? Number(lp[k]) : dflt[k])
  if (layerClip)
    return (
      <div className={s.insp} data-testid="clip-inspector">
        <Header
          kind="layer clip"
          title={`${track?.name ?? ''} / ${clip.effect}`}
          menu={[{ key: 'del', label: 'delete clip', icon: 'trash', danger: true, onSelect: () => {
            void ed.editing.edit((sc) => removeClip(sc, clipId))
            ed.select({ clipId: null, focus: null })
          } }]}
        />
        <Section tight>
          <Cap>timing</Cap>
          <div className={s.two}>
            <NumField prefix="start" ariaLabel="start" value={clip.start} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('start'), Math.min(v, clip.end - 0.05), 'final')} suffix="s" />
            <NumField prefix="end" ariaLabel="end" value={clip.end} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('end'), Math.max(v, clip.start + 0.05), 'final')} suffix="s" />
          </div>
          <Segmented ariaLabel="animates" value={clip.effect} onChange={(v) => ed.editing.setValues([[cp('effect'), v], [cp('params'), { ...LAYER_CLIP_DEFAULTS[v] }]], 'final')} options={[{ value: 'reveal', label: 'reveal' }, { value: 'sweep', label: 'sweep' }]} />
          <div className={s.two}>
            <NumField prefix="from" ariaLabel="from" value={num('from')} digits={2} step={0.05} onCommit={(v) => ed.editing.setValue(cp('params'), { ...lp, from: v }, 'final')} />
            <NumField prefix="to" ariaLabel="to" value={num('to')} digits={2} step={0.05} onCommit={(v) => ed.editing.setValue(cp('params'), { ...lp, to: v }, 'final')} />
          </div>
          <HoldRow clip={clip} path={cp('hold')} />
          <span className={s.dim}>
            {clip.effect === 'reveal' ? 'wipes the layer from "from" to "to" (0 hidden, 1 whole).' : 'moves a gradient band (or slides a picture) from "from" to "to".'}{' '}
            {clipHolds(clip) ? 'after the clip it holds "to".' : 'after the clip it goes back to the value before it.'}
          </span>
        </Section>
      </div>
    )
  return (
    <div className={s.insp} data-testid="clip-inspector">
      <Header
        kind="clip"
        title={`${track?.name ?? ''} / ${def?.name ?? clip.effect}`}
        menu={[
          { key: 'del', label: 'delete clip', icon: 'trash', danger: true, onSelect: () => {
            void ed.editing.edit((sc) => removeClip(sc, clipId))
            ed.select({ clipId: null, focus: null })
          } },
        ]}
      />
      <Section tight>
        <Cap>timing</Cap>
        <div className={s.two}>
          <NumField prefix="start" ariaLabel="start" value={clip.start} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('start'), Math.min(v, clip.end - 0.05), 'final')} suffix="s" />
          <NumField prefix="end" ariaLabel="end" value={clip.end} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('end'), Math.max(v, clip.start + 0.05), 'final')} suffix="s" />
          <NumField prefix="fade in" ariaLabel="fade in" value={clip.fadeIn} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('fadeIn'), v, 'final')} suffix="s" />
          <NumField prefix="fade out" ariaLabel="fade out" value={clip.fadeOut} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('fadeOut'), v, 'final')} suffix="s" />
        </div>
        <Row>
          <span>effect</span>
          <AddEffectMenu timeline label={def?.name ?? clip.effect} onPick={(d) => ed.editing.setValues([[cp('effect'), d.id], [cp('params'), d.id === 'converge' ? { source: convergeSource(scene) } : d.id === 'morph' ? { from: 'object', to: 'circle' } : d.id === 'shape' ? { shape: 'circle' } : {}]], 'final')} />
        </Row>
        <HoldRow clip={clip} path={cp('hold')} />
      </Section>
      <Section>
        <Cap>look</Cap>
        {clip.effect === 'converge' && def ? (
          <ConvergeLook scene={scene} clip={clip} def={def} path={(k) => cp('params', k)} />
        ) : (clip.effect === 'morph' || clip.effect === 'shape') && def ? (
          <MorphLook scene={scene} clip={clip} def={def} path={(k) => cp('params', k)} />
        ) : def ? (
          <ParamControls schema={def.params} values={resolveParams(def.params, clip.params as Record<string, unknown>)} onChange={(k, v, ph) => ed.editing.setValue(cp('params', k), v, ph)} />
        ) : (
          <span className={s.dim}>unknown effect {clip.effect}</span>
        )}
      </Section>
    </div>
  )
}

/** (§20, §21) every clip may keep its end state after its end: off, to the end of its step (the next cue), or for ever. */
function HoldRow({ clip, path }: { clip: Clip; path: string }) {
  const ed = useEditor()
  const mode = clipHoldMode(clip)
  return (
    <>
      <Row>
        <span title={`keeps the end of the clip on the wall: to the next cue (step), or until the next ${clip.effect} clip on this track starts (forever)`}>hold the end</span>
        <Segmented<HoldMode>
          ariaLabel="hold the end"
          size="sm"
          value={mode}
          onChange={(v) => ed.editing.setValue(path, v === 'off' ? false : v, 'final')}
          options={[
            { value: 'off', label: 'off' },
            { value: 'step', label: 'step' },
            { value: 'forever', label: 'forever' },
          ]}
        />
      </Row>
      {mode === 'step' && <span className={s.dim}>holds to the next cue; the next step draws from scratch.</span>}
    </>
  )
}

const MORPH_KIND_LABEL: Record<MorphKind, string> = { object: 'object', circle: 'circle', frame: 'frame', rect: 'rect', plate: 'plate' }

/** (§21) one end of a morph: the shape, and its size (0 = from the object). */
function ShapePick({ label, value, prefix, path }: { label: string; value: MorphShapeSpec; prefix: '' | 'from' | 'to'; path: (k: string) => string }) {
  const ed = useEditor()
  const key = (k: string) => (prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k)
  const nameKey = prefix || 'shape'
  const plate = PLATES.find((p) => p.id === value.plate)
  const set = (k: string, v: number) => ed.editing.setValue(path(key(k)), v, 'final')
  return (
    <>
      <span className={s.dim}>{label}</span>
      <Segmented<MorphKind>
        ariaLabel={label}
        size="sm"
        value={value.kind}
        onChange={(v) => ed.editing.setValue(path(nameKey), v === 'plate' ? shapeName({ kind: 'plate', plate: value.plate ?? PLATES[0]?.id }) : v, 'final')}
        options={MORPH_KINDS.map((k) => ({ value: k, label: MORPH_KIND_LABEL[k] }))}
      />
      {value.kind === 'plate' && (
        <Menu
          width={320}
          trigger={({ toggle }) => (
            <Pill size="sm" icon="chevronDown" onClick={toggle} aria-label={`${label} plate`}>
              {plate?.name ?? 'pick a plate'}
            </Pill>
          )}
        >
          {(close) => (
            <div className={s.plateGrid} role="listbox" aria-label="plates">
              {PLATES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === value.plate}
                  title={p.name}
                  className={s.plateTile}
                  onClick={() => {
                    ed.editing.setValue(path(nameKey), `plate:${p.id}`, 'final')
                    close()
                  }}
                >
                  <img alt={p.name} src={`data:image/svg+xml;utf8,${encodeURIComponent(plateSvg(p))}`} />
                </button>
              ))}
            </div>
          )}
        </Menu>
      )}
      {value.kind === 'circle' && (
        <div className={s.two}>
          <NumField prefix="radius" ariaLabel={`${label} radius`} value={value.r ?? 0} digits={0} step={10} min={0} suffix="px" onCommit={(v) => set('r', v)} />
        </div>
      )}
      {value.kind === 'rect' && (
        <div className={s.two}>
          <NumField prefix="width" ariaLabel={`${label} width`} value={value.w ?? 0} digits={0} step={10} min={0} suffix="px" onCommit={(v) => set('w', v)} />
          <NumField prefix="height" ariaLabel={`${label} height`} value={value.h ?? 0} digits={0} step={10} min={0} suffix="px" onCommit={(v) => set('h', v)} />
        </div>
      )}
      {value.kind === 'plate' && (
        <div className={s.two}>
          <NumField prefix="size" ariaLabel={`${label} plate size`} value={value.size ?? 0} digits={0} step={10} min={0} suffix="px" onCommit={(v) => set('size', v)} />
        </div>
      )}
      {(value.kind === 'circle' || value.kind === 'rect' || value.kind === 'plate') && (
        <div className={s.two}>
          <NumField prefix="x" ariaLabel={`${label} centre x`} value={value.cx ?? -1} digits={0} step={10} min={-1} suffix="px" onCommit={(v) => set('cx', v)} />
          <NumField prefix="y" ariaLabel={`${label} centre y`} value={value.cy ?? -1} digits={0} step={10} min={-1} suffix="px" onCommit={(v) => set('cy', v)} />
        </div>
      )}
    </>
  )
}

/** (§21) the morph's look: from and to shapes, the fill (colour → colour, or a backdrop's light), ease, edge, outline. */
function MorphLook({ scene, clip, def, path }: { scene: Scene; clip: Clip; def: EffectDef; path: (k: string) => string }) {
  const ed = useEditor()
  const p = morphParams(scene, clip)
  const shape = clip.effect === 'shape'
  const skip = Object.keys(def.params).filter((k) => !['color', 'colorTo', 'ease', 'edge', 'outline'].includes(k) || (p.fill === 'light' && (k === 'color' || k === 'colorTo')))
  return (
    <>
      {shape ? (
        <ShapePick label="shape" value={p.from} prefix="" path={path} />
      ) : (
        <>
          <ShapePick label="from" value={p.from} prefix="from" path={path} />
          <ShapePick label="to" value={p.to} prefix="to" path={path} />
        </>
      )}
      <span className={s.dim}>fill</span>
      <Segmented<'color' | 'light'> ariaLabel="fill" size="sm" value={p.fill} onChange={(v) => ed.editing.setValue(path('fill'), v, 'final')} options={[{ value: 'color', label: 'colour' }, { value: 'light', label: 'light' }]} />
      {p.fill === 'light' && (
        <Segmented<BackdropMode> ariaLabel="light from" size="sm" value={p.source} onChange={(v) => ed.editing.setValue(path('source'), v, 'final')} options={BACKDROP_MODES.map((m) => ({ value: m, label: m }))} />
      )}
      <ParamControls schema={def.params} skip={skip} values={resolveParams(def.params, { ...(clip.params as Record<string, unknown>), colorTo: p.colorTo })} onChange={(k, v, ph) => ed.editing.setValue(path(k), v, ph)} />
      <span className={s.dim}>
        {shape ? `holds a ${p.from.kind}` : `turns the ${p.from.kind === 'plate' ? 'plate' : p.from.kind} into the ${p.to.kind === 'plate' ? 'plate' : p.to.kind}`}
        {p.fill === 'color' && p.colorTo !== p.color ? ', changing colour' : ''}. sizes at 0 and centres at -1 follow the object. space plays it here.
      </span>
    </>
  )
}

const CONVERGE_FROM: Array<{ value: ConvergeFrom; label: string }> = [
  { value: 'current', label: 'the light' },
  { value: 'circle', label: 'circle' },
  { value: 'frame', label: 'frame' },
]
const CONVERGE_EASE: Array<{ value: ConvergeEase; label: string }> = [
  { value: 'inOut', label: 'in out' },
  { value: 'in', label: 'in' },
  { value: 'out', label: 'out' },
  { value: 'linear', label: 'linear' },
]

/** (§20) the converge's look: where the light starts, which mode's light, the ease, the soft edge and the outline. */
function ConvergeLook({ scene, clip, def, path }: { scene: Scene; clip: Clip; def: EffectDef; path: (k: string) => string }) {
  const ed = useEditor()
  const p = convergeParams(scene, clip)
  return (
    <>
      <span className={s.dim}>starts from</span>
      <Segmented<ConvergeFrom> ariaLabel="starts from" size="sm" value={p.from} onChange={(v) => ed.editing.setValue(path('from'), v, 'final')} options={CONVERGE_FROM} />
      <span className={s.dim}>light from</span>
      <Segmented<BackdropMode> ariaLabel="light from" size="sm" value={p.source} onChange={(v) => ed.editing.setValue(path('source'), v, 'final')} options={BACKDROP_MODES.map((m) => ({ value: m, label: m }))} />
      <span className={s.dim}>ease</span>
      <Segmented<ConvergeEase> ariaLabel="ease" size="sm" value={p.ease} onChange={(v) => ed.editing.setValue(path('ease'), v, 'final')} options={CONVERGE_EASE} />
      <ParamControls schema={def.params} skip={['from', 'source', 'ease']} values={resolveParams(def.params, clip.params as Record<string, unknown>)} onChange={(k, v, ph) => ed.editing.setValue(path(k), v, ph)} />
      <span className={s.dim}>the {p.source} light closes from {p.from === 'current' ? 'its own shape' : `the ${p.from}`} onto the silhouette. space plays it here.</span>
    </>
  )
}

// ── nothing selected: the scene ──────────────────────────────────────────────

function SceneInspector({ scene }: { scene: Scene }) {
  const ed = useEditor()
  const [history, setHistory] = useState<Array<{ version: number; author: string; ts: string }> | null>(null)
  return (
    <div className={s.insp}>
      <Header kind="scene" title={scene.name} />
      <Section tight>
        <Rename value={scene.name} onCommit={(v) => ed.editing.setValue('/name', v, 'final')} />
        <Row>
          <span className={s.dim}>version</span>
          <span className={s.numText}>v{scene.version}</span>
        </Row>
        <Row>
          <span className={s.dim}>surfaces</span>
          <span className={s.numText}>{scene.objects.reduce((a, o) => a + o.surfaces.length, 0)} in {scene.objects.length} objects</span>
        </Row>
        <Row>
          <span className={s.dim}>timeline</span>
          <NumField prefix="length" ariaLabel="timeline length" value={scene.timeline.duration} digits={1} min={1} max={3600} suffix="s" onCommit={(v) => ed.editing.setValue('/timeline/duration', v, 'final')} />
        </Row>
      </Section>
      <Section>
        <Row>
          <Cap>history</Cap>
          <Pill size="sm" ghost icon="history" onClick={() => ed.sceneId && sceneApi.history(ed.sceneId, 30).then(setHistory, () => setHistory([]))}>
            load
          </Pill>
        </Row>
        <div className={s.history}>
          {history?.length === 0 && <span className={s.dim}>no history yet.</span>}
          {history?.map((h) => (
            <Row key={h.version}>
              <span className={s.numText}>v{h.version}</span>
              <span className={s.dim}>{h.author}</span>
            </Row>
          ))}
        </div>
        <span className={s.dim}>select a surface, a layer or a clip to edit it. ⌘Z undoes, ⇧⌘Z redoes.</span>
      </Section>
    </div>
  )
}

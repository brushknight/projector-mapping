import { useEffect, useRef, useState } from 'react'
import { Cap, EmptyState, LibTile, Menu, OnAirDot, Pill, Segmented, TextInput, TreeNode } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { useChannel } from '../../../../shared/lib/useHub'
import { assetApi } from '../../../asset/api'
import { newLayer, sceneryUrl, type Catalog } from '../../../catalog'
import { effectIcon, schemaDefaults, type EffectDef } from '../../../effect'
import { presetApi, type Preset } from '../../../preset'
import { useEditor } from '../../editor/context'
import { stackLayers } from '../../lib'
import { addContentLayer, addLayer, addSurfaceEffect, applyPresetOps, layerPath, mediaLayer, pickSingle, setMode } from '../../ops'
import { BACKDROP_MODES, type BackdropMode, type GradientStop, type Layer, type LayerKind } from '../../types'
import s from './styles.module.css'

export type LibraryTab = 'effects' | 'media' | 'backdrops'

export const LAYER_ICON: Record<LayerKind, string> = { gobo: 'gobo', procedural: 'wave', gradient: 'gradient', photo: 'image', solid: 'quad' }

export const gradientCss = (stops: GradientStop[], angle = 135) =>
  `linear-gradient(${angle}deg, ${[...stops].sort((a, b) => a.pos - b.pos).map((st) => `${st.color} ${Math.round(st.pos * 100)}%`).join(', ')})`

/** What each backdrop mode's tile says. */
export const MODE_HINT: Record<BackdropMode, string> = {
  static: 'one gobo; picking one replaces it and keeps its light',
  live: 'a stack of live layers',
  color: 'one gradient; picking one replaces it',
  scenery: 'one photo; picking one replaces it',
}

/** The library under the surfaces tree: effects to drop on surfaces and the timeline, media, and the backdrop stacks. */
export function Library({ tab, onTab }: { tab: LibraryTab; onTab: (t: LibraryTab) => void }) {
  return (
    <>
      <div className={s.ph}>
        <Segmented<LibraryTab>
          ariaLabel="library"
          width="100%"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'effects', label: 'effects' },
            { value: 'media', label: 'media' },
            { value: 'backdrops', label: 'backdrops' },
          ]}
        />
      </div>
      <div className={s.body}>
        {tab === 'effects' && <EffectsTab onTab={onTab} />}
        {tab === 'media' && <MediaTab />}
        {tab === 'backdrops' && <BackdropsTab />}
      </div>
    </>
  )
}

/** Adds a layer to the live stack. */
function useAddLayer() {
  const ed = useEditor()
  return (kind: LayerKind, ref: string, extra?: Partial<Layer>) => {
    const layer = { ...newLayer(ed.catalog, kind, ref, newId('lay')), ...extra }
    void ed.editing.edit(() => addLayer('live', layer))
    ed.select({ layerId: layer.id, focus: 'layer' })
  }
}

/** Picks the one layer of a single-choice mode (static gobo, color gradient, scenery photo) and puts it on air. */
function usePick() {
  const ed = useEditor()
  return (mode: Exclude<BackdropMode, 'live'>, kind: LayerKind, ref: string, extra?: Partial<Layer>) => {
    const layer = { ...newLayer(ed.catalog, kind, ref, newId('lay')), ...extra }
    const keep = mode === 'static' ? (['light'] as const) : mode === 'scenery' ? (['params'] as const) : ([] as const)
    void ed.editing.edit((sc) => pickSingle(sc, mode, layer, [...keep]))
    ed.select({ layerId: layer.id, focus: 'layer' })
  }
}

function EffectsTab({ onTab }: { onTab: (t: LibraryTab) => void }) {
  const ed = useEditor()
  const pick = usePick()
  const add = (def: EffectDef) => {
    const sid = ed.sel.surfaceId
    if (!sid) {
      ed.toast('Select a surface first, or drag the effect onto a timeline track.')
      return
    }
    void ed.editing.edit((sc) => addSurfaceEffect(sc, sid, { id: newId('fx'), effect: def.id, enabled: true, params: schemaDefaults(def.params) }))
  }
  return (
    <div className={s.grid}>
      {ed.effects.map((def) => (
        <LibTile key={def.id} icon={effectIcon(def.id, def.kind)} label={def.name} dragData={`effect:${def.id}`} onClick={() => add(def)} title={`${def.name}: click to add to the selected surface, drag onto a track`} />
      ))}
      <LibTile
        icon="gobo"
        label="gobo"
        title="put a window gobo on air (static)"
        onClick={() => {
          pick('static', 'gobo', 'window')
          onTab('backdrops')
        }}
      />
    </div>
  )
}

function MediaTab() {
  const ed = useEditor()
  const pick = usePick()
  const file = useRef<HTMLInputElement>(null)
  const cat = ed.catalog
  // in content (or with a face selected) pictures go onto faces as media layers; else they are scenery backdrops
  const target = (): { kind: 'surface' | 'object'; id: string } | null => {
    const sid = ed.faceZoom ?? (ed.sel.surfaceId && ed.sel.focus !== 'object' ? ed.sel.surfaceId : null)
    if (sid) return { kind: 'surface', id: sid }
    if (ed.space === 'content' && ed.contentObjectId) return { kind: 'object', id: ed.contentObjectId }
    return null
  }
  const onFaces = ed.space === 'content' || !!ed.sel.surfaceId
  const place = (src: string, name: string) => {
    const t = target()
    if (!t) return false
    const layer = mediaLayer(newId('cl'), src, name)
    void ed.editing.edit((sc) => addContentLayer(sc, t, layer))
    ed.select({ contentLayerId: layer.id, focus: 'content' })
    return true
  }
  return (
    <>
      <div className={s.grid}>
        <LibTile icon="upload" label={onFaces ? 'my picture' : 'my photo'} title={onFaces ? 'upload a picture or video onto the selected face (or across the object)' : 'upload a photo and put it on air (scenery)'} onClick={() => file.current?.click()} />
        {cat?.scenery.map((sc) => (
          <LibTile
            key={sc.id}
            label={sc.name}
            swatch={`center / cover no-repeat url("${sceneryUrl(sc)}")`}
            dragData={`media:${sc.id}|${sc.name}`}
            title={onFaces ? `${sc.name}: click to put it on the selected face, or drag it onto a face` : `${sc.name} · ${sc.credit}: click to put it on air, or drag it onto a face`}
            onClick={() => place(sc.id, sc.name) || pick('scenery', 'photo', sc.id)}
          />
        ))}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const t = target()
          if (t) return void ed.addMedia([f], t)
          try {
            const a = await assetApi.upload(f, 'photo', f.name)
            pick('scenery', 'photo', `asset:${a.sha}`, { name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) })
          } catch (err) {
            ed.toast(err instanceof Error ? err.message : String(err), { bad: true })
          }
        }}
      />
    </>
  )
}

export function layerSwatch(cat: Catalog | null, l: Layer): string | undefined {
  if (l.kind === 'gradient' && Array.isArray(l.params.stops)) return gradientCss(l.params.stops as GradientStop[], Number(l.params.angle ?? 135))
  if (l.kind === 'solid') return String(l.params.color ?? '#000')
  if (l.kind === 'photo') {
    const sc = cat?.scenery.find((x) => x.id === l.ref)
    const url = sc ? sceneryUrl(sc) : l.ref.startsWith('asset:') ? `/a/${l.ref.slice(6)}` : null
    return url ? `center / cover no-repeat url("${url}")` : undefined
  }
  return undefined
}

function BackdropsTab() {
  const ed = useEditor()
  const addL = useAddLayer()
  const pick = usePick()
  const cat = ed.catalog
  const onAir = ed.sceneMode
  const [stack, setStack] = useState<BackdropMode>(onAir === 'objects' ? 'static' : onAir)
  useEffect(() => {
    if (onAir !== 'objects') setStack(onAir)
  }, [onAir])
  const layers = ed.scene ? stackLayers(ed.scene, stack) : []
  const presets = useChannel<Preset[]>(ed.hub, 'presets').doc
  const [list, setList] = useState<Preset[]>([])
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    if (presets) setList(presets)
    else presetApi.list().then(setList, () => {})
  }, [presets])
  const shown = list.filter((p) => p.mode === stack)

  const savePreset = async (name: string) => {
    setNaming(false)
    if (!ed.sceneId || !name.trim()) return
    try {
      const p = await presetApi.create(name.trim(), stack, ed.sceneId)
      setList((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p]))
      ed.toast(`Saved preset ${p.name}.`)
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }

  const picks =
    stack === 'static'
      ? cat?.gobos.map((g) => ({ key: g.id, icon: 'gobo', label: g.name, swatch: undefined as string | undefined, on: layers[0]?.ref === g.id, pick: () => pick('static', 'gobo', g.id) }))
      : stack === 'color'
        ? cat?.gradients.map((g) => ({ key: g.id, icon: 'gradient', label: g.name, swatch: gradientCss(g.defaults.stops, g.defaults.angle), on: layers[0]?.ref === g.id, pick: () => pick('color', 'gradient', g.id) }))
        : stack === 'scenery'
          ? cat?.scenery.map((g) => ({ key: g.id, icon: 'image', label: g.name, swatch: `center / cover no-repeat url("${sceneryUrl(g)}")`, on: layers[0]?.ref === g.id, pick: () => pick('scenery', 'photo', g.id) }))
          : null

  return (
    <div className={s.stack} data-testid="backdrops">
      <div className={s.modes}>
        <Segmented<BackdropMode>
          ariaLabel="backdrop stack"
          size="sm"
          width="100%"
          value={stack}
          onChange={setStack}
          options={BACKDROP_MODES.map((m) => ({
            value: m,
            title: `${m}: ${MODE_HINT[m]}${m === onAir ? ' (on air)' : ''}`,
            label: (
              <span className={s.modeLabel} data-testid={`stack-${m}`}>
                {m === onAir && <OnAirDot />}
                {m}
              </span>
            ),
          }))}
        />
      </div>
      <div className={s.row}>
        <Cap>{stack === onAir ? 'on air' : `on air: ${onAir}`}</Cap>
        {stack !== onAir && (
          <Pill size="sm" onClick={() => void ed.editing.edit(() => setMode(stack))} data-testid="put-on-air" title={`switch the wall to ${stack}`}>
            put {stack} on air
          </Pill>
        )}
      </div>
      {picks && (
        <div className={s.grid}>
          {picks.map((p) => (
            <LibTile key={p.key} icon={p.icon} swatch={p.swatch} label={p.label} on={p.on} title={`${p.label}: click to put it on air (replaces the ${stack} pick)`} onClick={p.pick} testId={`pick-${p.key}`} />
          ))}
        </div>
      )}
      <div className={s.row}>
        <Cap>{stack === 'live' ? 'layers · top first' : 'layer'}</Cap>
        {stack === 'live' && (
          <Menu
            align="right"
            width={280}
            trigger={({ toggle }) => (
              <Pill size="sm" icon="plus" onClick={toggle} data-testid="add-layer">
                add layer
              </Pill>
            )}
            items={[
              { key: 'cp', caption: true, label: 'live' },
              ...(cat?.procedural.map((p) => ({ key: `p-${p.id}`, icon: 'wave', label: p.name, meta: p.category, onSelect: () => addL('procedural', p.id) })) ?? []),
              { key: 'cg', caption: true, label: 'shadows' },
              ...(cat?.gobos.map((g) => ({ key: `g-${g.id}`, icon: 'gobo', label: g.name, meta: g.description, onSelect: () => addL('gobo', g.id) })) ?? []),
              { key: 'cgr', caption: true, label: 'color' },
              ...(cat?.gradients.map((g) => ({ key: `gr-${g.id}`, icon: 'gradient', label: g.name, onSelect: () => addL('gradient', g.id) })) ?? []),
              { key: 'solid', icon: 'quad', label: 'solid color', onSelect: () => addL('solid', 'solid') },
              { key: 'cs', caption: true, label: 'scenery' },
              ...(cat?.scenery.map((p) => ({ key: `s-${p.id}`, icon: 'image', label: p.name, onSelect: () => addL('photo', p.id) })) ?? []),
            ]}
          />
        )}
      </div>
      <div className={s.layers}>
        {layers.length === 0 && <EmptyState>{stack === 'live' ? 'no layers. add one above.' : 'nothing picked. pick one above.'}</EmptyState>}
        {[...layers].reverse().map((l) => (
          <TreeNode
            key={l.id}
            icon={LAYER_ICON[l.kind]}
            label={l.name}
            meta={l.blend === 'normal' ? `${Math.round(l.opacity * 100)}%` : l.blend}
            selected={ed.sel.layerId === l.id && ed.sel.focus === 'layer'}
            visible={l.visible}
            onToggleVisible={() => {
              const p = ed.scene && layerPath(ed.scene, l.id, 'visible')
              if (p) ed.editing.setValue(p, !l.visible, 'final')
            }}
            onClick={() => ed.select({ layerId: l.id, focus: 'layer' })}
            testId={`layer-${l.id}`}
          />
        ))}
      </div>
      <div className={s.row}>
        <Cap>{stack} presets</Cap>
        <Pill size="sm" ghost icon="plus" onClick={() => setNaming(true)} title={`save the ${stack} stack as a preset`}>
          save
        </Pill>
      </div>
      {naming && <TextInput autoFocus placeholder="preset name, then enter" onKeyDown={(e) => e.key === 'Enter' && savePreset((e.target as HTMLInputElement).value)} onBlur={() => setNaming(false)} />}
      <div className={s.grid}>
        {shown.length === 0 && <EmptyState>no {stack} presets yet.</EmptyState>}
        {shown.map((p) => {
          const top = p.backdrop.layers[p.backdrop.layers.length - 1]
          return (
            <LibTile
              key={p.id}
              icon={top ? LAYER_ICON[top.kind] : 'layers'}
              swatch={top ? layerSwatch(cat, top) : undefined}
              label={p.name}
              title={`apply ${p.name}: replaces the ${p.mode} stack and puts ${p.mode} on air`}
              onClick={() => void ed.editing.edit(() => applyPresetOps(p)).then(() => ed.toast(`Applied ${p.name}.`))}
            />
          )
        })}
      </div>
    </div>
  )
}

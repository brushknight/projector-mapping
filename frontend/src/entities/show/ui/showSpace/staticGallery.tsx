/**
 * (§16) The static stack, explicit: background layers (colour, gradient, animated colour, effects) colour the light at
 * the bottom, attachments (metal plates) block it on top, each group with its own focus ring. The gallery offers both
 * with try before add: tapping a tile shows it in the hero, here only, and the bar over the hero puts it on air.
 */
import { useEffect, useRef, useState } from 'react'
import { Cap, FillSlider, Glass, Icon, Segmented } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import { backgroundItems, backgroundKey, backgroundLayer, backgroundScene, defaultStackLight, newAttachment, staticTryName, stackLightOf, type BackgroundItem } from '../../../catalog'
import { addAttachment, addLayer, layerPath, lightPath, pickAttachment, removeLayer, setStackLight } from '../../../scene/ops'
import { gradientCss } from '../../../scene/ui/library'
import { Card } from './card'
import { useShow } from './context'
import { animateScene, galleryAvailable, TILE_H, TILE_W } from './galleryAnimator'
import { AttachmentBrowser, AttachmentRows } from './light'
import s from './styles.module.css'
import g from './liveGallery.module.css'

const r2 = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${Math.round(v * 100)}%`
export const focusLabel = (v: number) => (v > 0.995 ? 'sharp' : v < 0.1 ? 'very soft' : pct(v))

/** One background tile: the background under a warm light, animated by the shared renderer. */
function BackgroundTile({ item, on, onClick }: { item: BackgroundItem; on: boolean; onClick: () => void }) {
  const sh = useShow()
  const ref = useRef<HTMLCanvasElement>(null)
  const [live, setLive] = useState(true)
  useEffect(() => {
    if (!ref.current || !galleryAvailable()) {
      setLive(false)
      return
    }
    return animateScene(ref.current, backgroundScene(sh.catalog, item), sh.catalog)
  }, [item, sh.catalog])
  const grad = item.kind === 'gradient' ? sh.catalog?.gradients.find((x) => x.id === item.ref) : null
  const still = item.color ?? (grad ? gradientCss(grad.defaults.stops, grad.defaults.angle) : 'var(--control)')
  return (
    <button type="button" className={cx(g.tile, on && g.on)} onClick={onClick} aria-pressed={on} title={`${item.name}: try it under the attachments in the preview`} data-testid={`bg-tile-${backgroundKey(item)}`}>
      <span className={g.sw} style={live ? undefined : { background: still }}>
        <canvas ref={ref} width={TILE_W} height={TILE_H} className={g.canvas} hidden={!live} />
        {on && <span className={g.badge}>trying</span>}
      </span>
      <span className={g.label}>
        <span className={g.name}>{item.name}</span>
        <span className={g.meta}>{item.group}</span>
      </span>
    </button>
  )
}

/** The background gallery: tap a tile to try it under the attachments. */
function BackgroundGallery() {
  const sh = useShow()
  const items = backgroundItems(sh.catalog)
  const [group, setGroup] = useState<'all' | BackgroundItem['group']>('all')
  const shown = group === 'all' ? items : items.filter((it) => it.group === group)
  const tried = sh.staticTry?.kind === 'background' ? backgroundKey(sh.staticTry.item) : null
  return (
    <>
      <Segmented
        ariaLabel="background kind"
        size="sm"
        value={group}
        onChange={setGroup}
        options={[
          { value: 'all', label: 'all' },
          { value: 'colour', label: 'colour' },
          { value: 'gradient', label: 'gradient' },
          { value: 'animated', label: 'animated' },
          { value: 'effect', label: 'effects' },
        ]}
      />
      <div className={g.grid} data-testid="background-gallery">
        {shown.map((it) => {
          const k = backgroundKey(it)
          return <BackgroundTile key={k} item={it} on={tried === k} onClick={() => sh.setStaticTry(tried === k ? null : { kind: 'background', item: it })} />
        })}
      </div>
    </>
  )
}

/** The static gallery: attachments (plates in front of the light) or background layers (under it). */
export function StaticGallery({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'attachments' | 'background'>('attachments')
  return (
    <div className={s.stackCol}>
      <Segmented
        ariaLabel="add to the static stack"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'attachments', label: 'attachments ↑', title: 'metal plates in front of the light: they block it' },
          { value: 'background', label: 'background ↓', title: 'a colour, gradient, animated colour or effect under the attachments' },
        ]}
      />
      {tab === 'attachments' ? (
        <AttachmentBrowser mode="static" selected={selected} onSelect={onSelect} />
      ) : (
        <Card cap="background · tap to try" testId="background-card">
          <BackgroundGallery />
        </Card>
      )}
    </div>
  )
}

/**
 * The static stack, top to bottom: the attachments with the attachment focus, the light, and the background layers
 * with the background focus.
 */
export function StaticStack({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const sh = useShow()
  const sc = sh.scene
  const raw = sc?.backdrop.static.light
  const light = stackLightOf(raw, sh.catalog)
  const set = (path: string, v: unknown, ph: 'live' | 'final') => sh.editing.setValue(path, v, ph)
  const layers = sc ? [...sc.backdrop.static.layers].reverse() : []
  const bgFocus = light.backgroundFocus ?? 1
  const colour = light.colorLayer ? `${light.colorLayer.kind} ${light.colorLayer.ref}` : light.color.mode === 'cct' ? `white ${Math.round(light.color.kelvin)} K` : `colour ${Math.round(light.color.hue)}°`
  return (
    <Card cap="the stack · top to bottom" testId="static-stack">
      <div className={s.controls}>
        <div className={s.capRow}>
          <Cap>attachments on top ↑</Cap>
          <span className={s.dim}>they block the light</span>
        </div>
        <AttachmentRows mode="static" selected={selected} onSelect={onSelect} />
        <FillSlider label="attachment focus" value={light.focus} display={focusLabel(light.focus)} onChange={(v, ph) => set(lightPath('static', 'focus'), r2(v), ph)} />
        <div className={s.capRow}>
          <Cap>light</Cap>
          <span className={s.dim} data-testid="stack-light">{`${pct(light.intensity)} · ${layers.length ? 'coloured by the background' : colour}`}</span>
        </div>
        <div className={s.capRow}>
          <Cap>background layers ↓</Cap>
          <span className={s.dim}>under the attachments</span>
        </div>
        {layers.length === 0 && <span className={s.dim}>none: the light's own colour. add a colour, gradient or effect from the background gallery.</span>}
        {layers.map((l) => (
          <div key={l.id} className={cx(s.lrow, !l.visible && s.lhidden)} data-testid={`bg-row-${l.id}`}>
            <span className={s.ltext}>
              <span className={s.lname}>{l.name}</span>
              <span className={s.lmeta}>{l.kind === 'procedural' ? 'effect' : l.kind}</span>
            </span>
            <span className={s.lacts}>
              <button type="button" className={s.iconBtn} aria-label={l.visible ? `hide ${l.name}` : `show ${l.name}`} title={l.visible ? 'hide it' : 'show it'} onClick={() => sc && sh.editing.setValue(layerPath(sc, l.id, 'visible') ?? '', !l.visible, 'final')}>
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={15} />
              </button>
              <button type="button" className={s.iconBtn} aria-label={`remove ${l.name}`} title="remove it" onClick={() => void sh.editing.edit((x) => removeLayer(x, l.id))} data-testid={`bg-remove-${l.id}`}>
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        ))}
        <FillSlider label="background focus" value={bgFocus} display={focusLabel(bgFocus)} onChange={(v, ph) => set(lightPath('static', 'backgroundFocus'), r2(v), ph)} />
      </div>
    </Card>
  )
}

/** Over the hero while an attachment or background is tried: what it is, and commit or cancel. */
export function StaticTryBar() {
  const sh = useShow()
  const t = sh.staticTry
  if (!t) return null
  const name = staticTryName(sh.catalog, t)
  const ensureLight = (sc: NonNullable<typeof sh.scene>) => (sc.backdrop.static.light ? [] : setStackLight(sc, 'static', defaultStackLight(sh.catalog)))
  const done = (msg: string) => {
    sh.setStaticTry(null)
    sh.toast(msg)
  }
  const use = () => {
    if (t.kind !== 'attachment') return
    const att = newAttachment(sh.catalog, t.gobo, newId('att'))
    void sh.editing.edit((sc) => [...pickAttachment(sc, 'static', att), ...ensureLight(sc)])
    done(`${name} is in front of the light.`)
  }
  const stack = () => {
    if (t.kind !== 'attachment') return
    const att = newAttachment(sh.catalog, t.gobo, newId('att'))
    void sh.editing.edit((sc) => [...addAttachment(sc, 'static', att), ...ensureLight(sc)])
    done(`Added ${name} on top: it blocks more of the light.`)
  }
  const addBg = () => {
    if (t.kind !== 'background') return
    const layer = backgroundLayer(sh.catalog, t.item, newId('lay'))
    void sh.editing.edit((sc) => [...addLayer('static', layer), ...ensureLight(sc)])
    done(`${name} colours the light under the attachments.`)
  }
  return (
    <div className={g.tryBar} data-testid="static-try-bar">
      <Glass>
        <Icon name="eye" size={14} />
        <span>
          trying {name} · <span className={g.dimText}>only here, not on the wall</span>
        </span>
      </Glass>
      <span className={g.tryActs}>
        <button type="button" className={s.heroBtn} onClick={() => sh.setStaticTry(null)} data-testid="static-try-cancel">
          cancel
        </button>
        {t.kind === 'attachment' ? (
          <>
            <button type="button" className={s.heroBtn} onClick={stack} title="keep what is there and add this on top" data-testid="static-try-stack">
              <Icon name="plus" size={14} />
              add on top
            </button>
            <button type="button" className={cx(s.heroBtn, g.commit)} onClick={use} title="put it in front of the light in place of the attachment there" data-testid="static-try-use">
              put it on
            </button>
          </>
        ) : (
          <button type="button" className={cx(s.heroBtn, g.commit)} onClick={addBg} data-testid="static-try-add">
            <Icon name="plus" size={14} />
            add to the background
          </button>
        )}
      </span>
    </div>
  )
}

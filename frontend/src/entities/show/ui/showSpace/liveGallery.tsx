/**
 * (§16) The live gallery: every live layer as an animated tile drawn by the real engine. Tapping a tile tries it: the
 * hero shows the wall's scene with that layer on top, drawn in this editor only, and "add to live" puts it on air.
 * Shadow layers (trees, clouds, rain…) are masks over the light, like attachments.
 */
import { useEffect, useRef, useState } from 'react'
import { Glass, Icon } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import { defaultStackLight, galleryItems, newLayer, thumbUrl, type ProceduralItem } from '../../../catalog'
import { addLayer, setStackLight } from '../../../scene/ops'
import { Card } from './card'
import { useShow } from './context'
import { animateTile, galleryAvailable, TILE_H, TILE_W } from './galleryAnimator'
import s from './styles.module.css'
import g from './liveGallery.module.css'

/** Puts a live layer on air: on top of the live stack, with the default light when a mask has none to block. */
function useAddLive() {
  const sh = useShow()
  return (ref: string) => {
    const cat = sh.catalog
    const layer = newLayer(cat, 'procedural', ref, newId('lay'))
    void sh.editing.edit((sc) => {
      const ops = addLayer('live', layer)
      if (layer.blend === 'multiply' && !sc.backdrop.live.light) ops.push(...setStackLight(sc, 'live', defaultStackLight(cat, { color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 } })))
      return ops
    })
    sh.setLiveLayer(layer.id)
    sh.setTrying(null)
    sh.toast(`Added ${layer.name} to live.`)
  }
}

function GalleryTile({ item, on, onClick }: { item: ProceduralItem; on: boolean; onClick: () => void }) {
  const sh = useShow()
  const ref = useRef<HTMLCanvasElement>(null)
  const [live, setLive] = useState(true)
  useEffect(() => {
    if (!ref.current || !galleryAvailable()) {
      setLive(false)
      return
    }
    return animateTile(ref.current, item.id, sh.catalog)
  }, [item.id, sh.catalog])
  const mask = (newLayer(sh.catalog, 'procedural', item.id, 'x').blend ?? 'normal') === 'multiply'
  return (
    <button
      type="button"
      className={cx(g.tile, on && g.on)}
      onClick={onClick}
      aria-pressed={on}
      title={`${item.name}: try it in the preview${mask ? ' (it blocks the light like an attachment)' : ''}`}
      data-testid={`live-tile-${item.id}`}
    >
      <span className={g.sw} style={live ? undefined : { background: `center / cover no-repeat url("${thumbUrl(item.id)}"), var(--control)` }}>
        <canvas ref={ref} width={TILE_W} height={TILE_H} className={g.canvas} hidden={!live} />
        {on && <span className={g.badge}>trying</span>}
      </span>
      <span className={g.label}>
        <span className={g.name}>{item.name}</span>
        <span className={g.meta}>{mask ? 'blocks light' : 'adds light'}</span>
      </span>
    </button>
  )
}

/** The gallery card: tap a tile to try it in the hero. */
export function LiveGallery() {
  const sh = useShow()
  const items = galleryItems(sh.catalog)
  return (
    <Card cap="live layers · tap to try" aside={<span className={s.count}>{items.length}</span>} testId="live-gallery">
      <div className={g.grid}>
        {items.map((p) => (
          <GalleryTile key={p.id} item={p} on={sh.trying === p.id} onClick={() => sh.setTrying(sh.trying === p.id ? null : p.id)} />
        ))}
      </div>
    </Card>
  )
}

/** Over the hero while a layer is tried: what it is, and commit or cancel. */
export function TryBar() {
  const sh = useShow()
  const add = useAddLive()
  const item = sh.catalog?.procedural.find((p) => p.id === sh.trying)
  if (!sh.trying || !item) return null
  return (
    <div className={g.tryBar} data-testid="try-bar">
      <Glass>
        <Icon name="eye" size={14} />
        <span>
          trying {item.name} · <span className={g.dimText}>only here, not on the wall</span>
        </span>
      </Glass>
      <span className={g.tryActs}>
        <button type="button" className={s.heroBtn} onClick={() => sh.setTrying(null)} data-testid="try-cancel">
          cancel
        </button>
        <button type="button" className={cx(s.heroBtn, g.commit)} onClick={() => add(item.id)} data-testid="try-add">
          <Icon name="plus" size={14} />
          add to live
        </button>
      </span>
    </div>
  )
}

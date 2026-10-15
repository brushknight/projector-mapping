import { ColorField, FillSlider, Pill, Segmented, Switch } from '../../../../shared/components'
import { objectAccentOf } from '../../../../render/accent'
import { setObjectAccent } from '../../../scene/ops'
import type { AccentFillMode, ObjectAccent } from '../../../scene/types'
import { Card } from './card'
import { useShow } from './context'
import s from './styles.module.css'

const r2 = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${Math.round(v * 100)}%`
const FILLS: Array<{ value: AccentFillMode; label: string; title: string }> = [
  { value: 'light', label: 'light inside', title: 'adds a soft light inside the objects' },
  { value: 'cut', label: 'cut out', title: 'blocks the backdrop inside the objects: they stay dark with lit edges' },
  { value: 'only', label: 'only inside', title: 'shows the backdrop only inside the objects' },
]

/**
 * (protocol §19) The object accent card of the static and live panels: the mapped objects' outer outline over the
 * backdrop (crisp line, colour, glow) and a fill. One setting per scene, shared by every backdrop mode.
 */
export function AccentCard() {
  const sh = useShow()
  const sc = sh.scene
  if (!sc) return null
  const a = objectAccentOf(sc)
  const objects = sc.objects
  // switches and picks write the whole accent; sliders drag leaf values once it exists
  const put = (next: ObjectAccent) => void sh.editing.edit((cur) => setObjectAccent(cur, next))
  const slide = (path: string, v: number, ph: 'live' | 'final', next: ObjectAccent) => {
    if (sc.objectAccent) sh.editing.setValue(path, v, ph)
    else if (ph === 'final') put(next)
  }
  const picked = (id: string) => a.objects === 'all' || a.objects.includes(id)
  const toggleObject = (id: string) => {
    const cur = a.objects === 'all' ? objects.map((o) => o.id) : a.objects
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    put({ ...a, objects: next.length === objects.length ? 'all' : next })
  }
  return (
    <Card cap="object accent" aside={<span className={s.dim}>{objects.length ? 'the objects over the light' : 'map an object first'}</span>} testId="object-accent">
      <div className={s.controls}>
        <div className={s.switchRow}>
          <span>outline the objects</span>
          <Switch checked={a.on} disabled={!objects.length} onChange={(v) => put({ ...a, on: v })} ariaLabel="outline the objects" />
        </div>
        {a.on && (
          <>
            {objects.length > 1 && (
              <div className={s.chips} data-testid="accent-objects">
                <Pill size="sm" on={a.objects === 'all'} onClick={() => put({ ...a, objects: 'all' })}>
                  all
                </Pill>
                {objects.map((o) => (
                  <Pill key={o.id} size="sm" on={a.objects !== 'all' && picked(o.id)} onClick={() => toggleObject(o.id)}>
                    {o.name}
                  </Pill>
                ))}
              </div>
            )}
            <div className={s.switchRow}>
              <span>edge line</span>
              <Switch checked={a.outline.on} onChange={(v) => put({ ...a, outline: { ...a.outline, on: v } })} ariaLabel="edge line" />
            </div>
            {a.outline.on && (
              <>
                <div className={s.two}>
                  <FillSlider label="width" value={a.outline.width} min={0} max={16} step={1} display={`${Math.round(a.outline.width)} px`}
                    onChange={(v, ph) => slide('/objectAccent/outline/width', Math.round(v), ph, { ...a, outline: { ...a.outline, width: Math.round(v) } })} />
                  <FillSlider label="glow" value={a.outline.glow} display={pct(a.outline.glow)}
                    onChange={(v, ph) => slide('/objectAccent/outline/glow', r2(v), ph, { ...a, outline: { ...a.outline, glow: r2(v) } })} />
                </div>
                <ColorField label="line colour" value={a.outline.color}
                  onChange={(hex, ph) => (sc.objectAccent ? sh.editing.setValue('/objectAccent/outline/color', hex, ph) : ph === 'final' && put({ ...a, outline: { ...a.outline, color: hex } }))} />
              </>
            )}
            <div className={s.switchRow}>
              <span>fill the objects</span>
              <Switch checked={a.fill.on} onChange={(v) => put({ ...a, fill: { ...a.fill, on: v } })} ariaLabel="fill the objects" />
            </div>
            {a.fill.on && (
              <>
                <Segmented<AccentFillMode> ariaLabel="fill" size="sm" value={a.fill.mode} onChange={(v) => put({ ...a, fill: { ...a.fill, mode: v } })} options={FILLS} />
                <FillSlider label="fill strength" value={a.fill.opacity} display={pct(a.fill.opacity)}
                  onChange={(v, ph) => slide('/objectAccent/fill/opacity', r2(v), ph, { ...a, fill: { ...a.fill, opacity: r2(v) } })} />
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

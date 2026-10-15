import type { ReactNode } from 'react'
import { atlasFaces } from '../../../../render'
import { Breadcrumbs, Icon, Menu, Pill, Tooltip, type MenuItem, type PillProps } from '../../../../shared/components'
import { useEditor } from '../../editor/context'
import { contentCrumbs, contentTitle } from './model'
import s from './styles.module.css'

/** A Pill with a tooltip: every control in the content space says what it does. */
export function TipPill({ tip, side, ...p }: PillProps & { tip: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <Tooltip text={tip} side={side}>
      <Pill {...p} />
    </Tooltip>
  )
}

/** A labelled tool button: icon and word, ink when it is the tool in hand. */
export function ToolButton({ icon, label, on, tip, onClick, testId }: { icon: string; label: string; on: boolean; tip: string; onClick: () => void; testId?: string }) {
  return (
    <Tooltip text={tip}>
      <Pill icon={icon} iconSize={16} on={on} aria-pressed={on} onClick={onClick} className={s.toolBtn} data-testid={testId}>
        {label}
      </Pill>
    </Tooltip>
  )
}

/** The "more" menu: things you rarely need, out of the way. */
export function MoreMenu({ items, testId = 'content-more' }: { items: MenuItem[]; testId?: string }) {
  return (
    <Menu
      align="right"
      width={300}
      trigger={({ toggle, open }) => (
        <TipPill tip="more: templates, layout and the rarely needed controls" icon="more" aria-label="more" aria-expanded={open} onClick={toggle} data-testid={testId}>
          more
        </TipPill>
      )}
      items={items}
    />
  )
}

/**
 * The content space's head: where you are (breadcrumbs that climb back up, then a big title of what you edit and a
 * line on what this space is for), the tour button, and below it the pane's tools and actions.
 */
export function ContentHead({ objectId, surfaceId, meta, hint, children, onHelp }: { objectId: string; surfaceId: string | null; meta?: ReactNode; hint: ReactNode; children?: ReactNode; onHelp: () => void }) {
  const ed = useEditor()
  const scene = ed.scene!
  const crumbs = contentCrumbs(scene, objectId, surfaceId)
  const choices = scene.objects.filter((o) => atlasFaces(o).length > 0)
  const goObject = () => {
    ed.setFaceZoom(null)
    ed.select({ objectId, surfaceId: null, contentLayerId: null, focus: 'object' })
  }
  return (
    <div className={s.head}>
      <div className={s.crumbRow}>
        <Breadcrumbs
          ariaLabel="where you are"
          items={[
            ...crumbs.map((c, i) => ({
              key: c.id,
              label: c.label,
              icon: c.kind === 'object' ? 'cube' : undefined,
              title: c.kind === 'object' ? `back to all faces of ${c.label}` : `open ${c.label}`,
              onClick: i === crumbs.length - 1 ? undefined : c.kind === 'object' ? goObject : () => ed.editFace(c.id),
            })),
          ]}
        />
        {choices.length > 1 && (
          <Menu
            width={240}
            trigger={({ toggle }) => (
              <TipPill tip="work on another object" size="sm" ghost onClick={toggle} aria-label="switch object" data-testid="content-object">
                switch object
                <Icon name="chevronDown" size={13} />
              </TipPill>
            )}
            items={[
              { key: 'cap', caption: true, label: 'objects' },
              ...choices.map((o) => ({
                key: o.id,
                label: o.name,
                on: o.id === objectId,
                meta: `${atlasFaces(o).length} faces`,
                onSelect: () => {
                  ed.setFaceZoom(null)
                  ed.select({ objectId: o.id, surfaceId: null, contentLayerId: null, focus: 'object' })
                },
              })),
            ]}
          />
        )}
        <span className={s.sp} />
        <TipPill tip="show the 4-step tour of this space again" size="sm" ghost icon="help" aria-label="replay the tour" onClick={onHelp} data-testid="content-help" />
      </div>
      <div className={s.titleRow} data-tour="content-title">
        <h2 className={s.bigTitle} data-testid={surfaceId ? 'face-title' : 'content-title'}>
          {contentTitle(scene, objectId, surfaceId)}
        </h2>
        {meta && <span className={s.meta}>{meta}</span>}
        <span className={s.hint}>{hint}</span>
      </div>
      {children && (
        <div className={s.actions} data-tour="content-actions">
          {children}
        </div>
      )}
    </div>
  )
}

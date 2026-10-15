import type { ReactNode } from 'react'
import { BigAction, BigActions, Menu, Pill, type MenuItem } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { effectIcon, schemaDefaults, type EffectDef } from '../../../effect'
import { useEditor } from '../../editor/context'
import { addSurfaceEffect } from '../../ops'
import type { PatchOp, Scene } from '../../types'
import s from './styles.module.css'

/** The effects you can put on a face (drawing is the draw action, so it is left out), as menu items. */
function effectItems(effects: EffectDef[], onPick: (d: EffectDef) => void): MenuItem[] {
  const builtins = effects.filter((e) => e.kind === 'builtin' && e.id !== 'drawing')
  const users = effects.filter((e) => e.kind !== 'builtin')
  return [
    { key: 'b', caption: true, label: 'effects' },
    ...builtins.map((d) => ({ key: d.id, icon: effectIcon(d.id, d.kind), label: d.name, onSelect: () => onPick(d) })),
    ...(users.length ? [{ key: 'u', caption: true, label: 'made by you and agents' }] : []),
    ...users.map((d) => ({ key: d.id, icon: effectIcon(d.id, d.kind), label: d.name, meta: d.kind, onSelect: () => onPick(d) })),
  ]
}

/** Adds an effect with its default params to each of the surfaces. */
export function addEffectTo(ed: ReturnType<typeof useEditor>, surfaceIds: string[], def: EffectDef) {
  void ed.editing.edit((sc: Scene) => {
    const ops: PatchOp[] = []
    for (const id of surfaceIds) ops.push(...(addSurfaceEffect(sc, id, { id: newId('fx'), effect: def.id, enabled: true, params: schemaDefaults(def.params) }) ?? []))
    return ops.length ? ops : null
  })
  ed.toast(surfaceIds.length > 1 ? `Added ${def.name} to ${surfaceIds.length} faces.` : `Added ${def.name}. Its controls are in the inspector.`)
}

/** A menu of effects behind any trigger. */
export function EffectMenu({ onPick, trigger, align = 'left' }: { onPick: (d: EffectDef) => void; trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; align?: 'left' | 'right' }) {
  const ed = useEditor()
  return <Menu align={align} width={240} trigger={trigger} items={effectItems(ed.effects, onPick)} />
}

/** What an empty face or object offers first: three big actions, in the middle of the view. */
export function EmptyActions({
  title,
  text,
  pictureNote,
  drawNote,
  effectNote,
  onPicture,
  onDraw,
  onEffect,
  onClose,
}: {
  title: string
  text: string
  pictureNote: string
  drawNote: string
  effectNote: string
  onPicture: () => void
  onDraw: () => void
  onEffect: (d: EffectDef) => void
  onClose: () => void
}) {
  return (
    <div className={s.emptyWrap} data-testid="content-empty">
      <BigActions title={title} text={text} className={s.emptyCard}>
        <BigAction icon="image" label="add picture" note={pictureNote} onClick={onPicture} data-testid="empty-add-picture" />
        <BigAction icon="pen" label="draw" note={drawNote} onClick={onDraw} data-testid="empty-draw" />
        <EffectMenu onPick={onEffect} trigger={({ toggle, open }) => <BigAction icon="sparkle" label="add effect" note={effectNote} onClick={toggle} aria-expanded={open} data-testid="empty-add-effect" />} />
      </BigActions>
      <Pill size="sm" ghost onClick={onClose} className={s.emptyClose} data-testid="empty-close">
        hide these choices
      </Pill>
    </div>
  )
}

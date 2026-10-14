import { useState } from 'react'
import { Cap, Icon, Menu, OnAirDot, Pill, TextInput } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import type { Hub } from '../../../../shared/lib/ws'
import { HubError } from '../../../../shared/lib/ws'
import { sceneApi } from '../../../scene/api'
import type { SceneSummary } from '../../../scene/types'
import type { Show } from '../../types'
import s from './styles.module.css'

export interface SceneActions {
  hub: Hub
  show: Show | null
  scenes: SceneSummary[]
  reload: () => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Create, duplicate, rename, delete and activate scenes (§14). Each reports its own failure. */
export function useSceneActions({ hub, show, reload, toast, scenes }: SceneActions) {
  const bad = (e: unknown) => toast(msg(e), { bad: true })
  return {
    activate: async (id: string) => {
      try {
        await hub.cmd('show.activate', { sceneId: id })
        return true
      } catch (e) {
        bad(e instanceof HubError ? e.message : e)
        return false
      }
    },
    create: async () => {
      try {
        const sc = await sceneApi.create(`scene ${scenes.length + 1}`, show?.activeSetupId ?? null)
        reload()
        return sc
      } catch (e) {
        bad(e)
        return null
      }
    },
    duplicate: async (src: SceneSummary) => {
      try {
        const sc = await sceneApi.duplicate(src.id, `${src.name} copy`.slice(0, 80))
        reload()
        return sc
      } catch (e) {
        bad(e)
        return null
      }
    },
    rename: async (id: string, name: string) => {
      const n = name.trim().slice(0, 80)
      if (!n) return
      try {
        await sceneApi.rename(id, n)
        reload()
      } catch (e) {
        bad(e)
      }
    },
    remove: async (sc: SceneSummary) => {
      if (sc.id === show?.activeSceneId) return toast('Activate another scene first.', { bad: true })
      try {
        await sceneApi.remove(sc.id)
        reload()
        toast(`Deleted ${sc.name}.`)
      } catch (e) {
        bad(e)
      }
    },
  }
}

/**
 * The scene list with its actions: click a row to open it (`onOpen`), the projector button puts it on the wall, and
 * each row duplicates, renames (inline) and deletes (not the scene on the wall; asks first).
 */
export function SceneList({
  current,
  onOpen,
  openLabel,
  onCreated,
  onFromPhoto,
  compact,
  ...ctx
}: SceneActions & {
  /** the scene this view shows */
  current: string | null
  onOpen: (id: string) => void
  /** what a row click does, for its title ("edit", "put on the wall") */
  openLabel: string
  onCreated?: (id: string) => void
  onFromPhoto?: () => void
  compact?: boolean
}) {
  const act = useSceneActions(ctx)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const active = ctx.show?.activeSceneId ?? null
  return (
    <div className={cx(s.list, compact && s.compact)} data-testid="scene-list">
      {ctx.scenes.map((sc) => {
        const onWall = sc.id === active
        if (confirm === sc.id) {
          return (
            <div key={sc.id} className={s.confirm} data-testid={`scene-confirm-${sc.id}`}>
              <span className={s.cname}>delete {sc.name}?</span>
              <Pill size="sm" on onClick={() => void act.remove(sc).then(() => setConfirm(null))} data-testid="scene-delete-yes">
                delete
              </Pill>
              <Pill size="sm" ghost onClick={() => setConfirm(null)}>
                keep
              </Pill>
            </div>
          )
        }
        return (
          <div key={sc.id} className={cx(s.row, sc.id === current && s.cur)} data-testid={`scene-row-${sc.id}`} data-active={onWall ? 'true' : undefined}>
            {renaming === sc.id ? (
              <TextInput
                autoFocus
                className={s.rename}
                defaultValue={sc.name}
                aria-label={`rename ${sc.name}`}
                data-testid="scene-rename-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void act.rename(sc.id, (e.target as HTMLInputElement).value)
                    setRenaming(null)
                  } else if (e.key === 'Escape') setRenaming(null)
                }}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value.trim() !== sc.name) void act.rename(sc.id, e.target.value)
                  setRenaming(null)
                }}
              />
            ) : (
              <button type="button" className={s.main} onClick={() => onOpen(sc.id)} onDoubleClick={() => setRenaming(sc.id)} title={`${openLabel} ${sc.name} (double-click to rename)`}>
                <span className={s.dot}>{onWall ? <OnAirDot /> : null}</span>
                <span className={s.name}>{sc.name}</span>
                <span className={s.meta}>{onWall ? 'on the wall' : ''}</span>
              </button>
            )}
            <span className={s.acts}>
              {!onWall && (
                <button type="button" className={s.act} onClick={() => void act.activate(sc.id)} aria-label={`put ${sc.name} on the wall`} title="put it on the wall" data-testid={`scene-activate-${sc.id}`}>
                  <Icon name="projector" size={14} />
                </button>
              )}
              <button type="button" className={s.act} onClick={() => void act.duplicate(sc)} aria-label={`duplicate ${sc.name}`} title="duplicate" data-testid={`scene-duplicate-${sc.id}`}>
                <Icon name="copy" size={14} />
              </button>
              <button type="button" className={s.act} onClick={() => setRenaming(sc.id)} aria-label={`rename ${sc.name}`} title="rename" data-testid={`scene-rename-${sc.id}`}>
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                className={s.act}
                onClick={() => (onWall ? ctx.toast('Activate another scene first.', { bad: true }) : setConfirm(sc.id))}
                aria-label={`delete ${sc.name}`}
                title={onWall ? 'on the wall: activate another scene first' : 'delete'}
                disabled={onWall}
                data-testid={`scene-delete-${sc.id}`}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        )
      })}
      <div className={s.foot}>
        <Pill
          size="sm"
          icon="plus"
          onClick={() =>
            void act.create().then((sc) => {
              if (!sc) return
              setRenaming(sc.id)
              onCreated?.(sc.id)
            })
          }
          data-testid="scene-new"
        >
          new scene
        </Pill>
        {onFromPhoto && (
          <Pill size="sm" ghost icon="image" onClick={onFromPhoto}>
            from photo
          </Pill>
        )}
      </div>
    </div>
  )
}

/** The top bar's scene picker: the current scene's name (red dot when it is on the wall) opening the scene list. */
export function SceneSwitcher(props: Parameters<typeof SceneList>[0] & { width?: number }) {
  const cur = props.scenes.find((x) => x.id === props.current)
  const onWall = !!props.current && props.current === props.show?.activeSceneId
  return (
    <Menu
      width={props.width ?? 340}
      trigger={({ toggle }) => (
        <Pill onClick={toggle} aria-label="choose scene" data-testid="scene-picker" title={onWall ? 'this scene is on the wall' : 'you edit a scene that is not on the wall'}>
          {onWall && <OnAirDot />}
          <span className={s.trig}>{cur ? cur.name.toLowerCase() : 'no scene'}</span>
          <Icon name="chevronDown" size={14} />
        </Pill>
      )}
    >
      {(close) => (
        <div className={s.pop}>
          <Cap className={s.popCap}>scenes</Cap>
          <SceneList
            {...props}
            onOpen={(id) => {
              close()
              props.onOpen(id)
            }}
            onFromPhoto={
              props.onFromPhoto
                ? () => {
                    close()
                    props.onFromPhoto!()
                  }
                : undefined
            }
          />
        </div>
      )}
    </Menu>
  )
}

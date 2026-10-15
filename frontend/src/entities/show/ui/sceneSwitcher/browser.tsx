import { useEffect, useRef, useState } from 'react'
import { Icon, Menu, OnAirDot, Pill, TextInput } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { useChannel } from '../../../../shared/lib/useHub'
import type { Hub } from '../../../../shared/lib/ws'
import type { Catalog } from '../../../catalog/types'
import { sceneApi } from '../../../scene/api'
import { kindMode, sceneKind } from '../../../scene/lib'
import { SCENE_KINDS, type Scene, type SceneKind, type SceneSummary } from '../../../scene/types'
import type { Setup } from '../../../setup/types'
import { ambientClock, playheadNow } from '../../live'
import type { Show } from '../../types'
import { useSceneActions } from './index'
import { useLiveThumb } from './liveThumbs'
import s from './browser.module.css'

const KIND_LABEL: Record<SceneKind, string> = { static: 'static', live: 'live', color: 'colour', scenery: 'scenery', mapping: 'mapping' }
const KIND_ICON: Record<SceneKind, string> = { static: 'modeStatic', live: 'modeLive', color: 'modeColor', scenery: 'image', mapping: 'cube' }
const NEW_LABEL: Record<SceneKind, string> = {
  static: 'new static scene',
  live: 'new live scene',
  color: 'new colour scene',
  scenery: 'new scenery scene',
  mapping: 'new mapping scene',
}

/** The kind of a list row: the server's, else guessed from its mode. */
export const summaryKind = (sc: SceneSummary): SceneKind => sc.kind ?? (sc.mode === 'objects' ? 'mapping' : (sc.mode as SceneKind) ?? 'static')

/** Rows by kind, in the catalog's kind order, empty kinds left out. */
export function groupByKind(scenes: SceneSummary[]): Array<{ kind: SceneKind; scenes: SceneSummary[] }> {
  return SCENE_KINDS.map((kind) => ({ kind, scenes: scenes.filter((sc) => summaryKind(sc) === kind) })).filter((g) => g.scenes.length > 0)
}

interface Ctx {
  hub: Hub
  show: Show | null
  catalog: Catalog | null
  setup: Setup | null
}

/** A small live picture of a scene in its kind's mode, at the wall's clock (not on air unless it is). */
function SceneThumb({ id, ctx, width = 96, height = 54, fps = 8, testId }: { id: string; ctx: Ctx; width?: number; height?: number; fps?: number; testId?: string }) {
  const scene = useChannel<Scene>(ctx.hub, `scene:${id}`).doc
  const ref = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ scene, ctx })
  latest.current = { scene, ctx }
  useLiveThumb(
    ref,
    () => {
      const { scene: sc, ctx: c } = latest.current
      if (!sc || !c.setup) return null
      const onWall = c.show?.activeSceneId === sc.id
      return {
        setup: c.setup,
        scene: sc,
        catalog: c.catalog,
        t: onWall ? playheadNow(c.hub, c.show) : 0,
        clock: ambientClock(c.hub),
        now: c.hub.serverNow(),
        blackout: 0,
        mode: onWall ? null : kindMode(sceneKind(sc)),
      }
    },
    fps,
  )
  return <canvas ref={ref} width={width * 2} height={height * 2} className={s.thumb} style={{ width, height }} data-testid={testId} />
}

/**
 * The scenes grouped by kind (§15) with filter chips, live thumbnails, a quick preview on hover (animated, not on air)
 * with "put on the wall", and new scenes from templates. Clicking a row puts the scene on the wall.
 */
export function SceneBrowser({
  hub,
  show,
  catalog,
  setup,
  scenes,
  reload,
  toast,
  onCreated,
  onFromPhoto,
}: Ctx & {
  scenes: SceneSummary[]
  reload: () => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  /** a scene was made from a template (mapping scenes go to the map space) */
  onCreated?: (id: string, kind: SceneKind) => void
  onFromPhoto?: () => void
}) {
  const act = useSceneActions({ hub, show, scenes, reload, toast })
  const [filter, setFilter] = useState<SceneKind | 'all'>('all')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ id: string; top: number; left: number } | null>(null)
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = show?.activeSceneId ?? null
  const ctx: Ctx = { hub, show, catalog, setup }
  const groups = groupByKind(scenes).filter((g) => filter === 'all' || g.kind === filter)
  const counts = Object.fromEntries(SCENE_KINDS.map((k) => [k, scenes.filter((sc) => summaryKind(sc) === k).length])) as Record<SceneKind, number>

  useEffect(() => () => void (hover.current && clearTimeout(hover.current)), [])

  const create = async (kind: SceneKind) => {
    try {
      const n = scenes.filter((x) => summaryKind(x) === kind).length + 1
      const sc = await sceneApi.create(`${KIND_LABEL[kind]} ${n}`, show?.activeSetupId ?? null, { kind })
      reload()
      onCreated?.(sc.id, kind)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  const openPeek = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setPeek({ id, top: Math.max(8, Math.min(window.innerHeight - 260, r.top - 40)), left: r.right + 12 })
  }

  return (
    <div className={s.browser} data-testid="scene-browser" onMouseLeave={() => setPeek(null)}>
      <div className={s.filters} role="tablist" aria-label="scene kind">
        <Pill size="sm" on={filter === 'all'} onClick={() => setFilter('all')} role="tab" aria-selected={filter === 'all'} data-testid="scene-filter-all">
          all <span className={s.n}>{scenes.length}</span>
        </Pill>
        {SCENE_KINDS.filter((k) => counts[k] > 0).map((k) => (
          <Pill key={k} size="sm" on={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)} role="tab" aria-selected={filter === k} data-testid={`scene-filter-${k}`} title={`only ${KIND_LABEL[k]} scenes`}>
            {KIND_LABEL[k]} <span className={s.n}>{counts[k]}</span>
          </Pill>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g.kind} className={s.group} data-testid={`scene-group-${g.kind}`}>
          <div className={s.groupHead}>
            <Icon name={KIND_ICON[g.kind]} size={13} />
            <span>{KIND_LABEL[g.kind]}</span>
          </div>
          {g.scenes.map((sc) => {
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
              <div key={sc.id} className={cx(s.row, onWall && s.cur)} data-testid={`scene-row-${sc.id}`} data-active={onWall ? 'true' : undefined} data-kind={g.kind}>
                <button
                  type="button"
                  className={s.thumbBtn}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget
                    if (hover.current) clearTimeout(hover.current)
                    hover.current = setTimeout(() => openPeek(sc.id, el), 280)
                  }}
                  onMouseLeave={() => hover.current && clearTimeout(hover.current)}
                  onClick={(e) => (peek?.id === sc.id ? setPeek(null) : openPeek(sc.id, e.currentTarget))}
                  aria-label={`preview ${sc.name} without putting it on the wall`}
                  title="preview it here, the wall keeps what it shows"
                  data-testid={`scene-peek-${sc.id}`}
                >
                  <SceneThumb id={sc.id} ctx={ctx} testId={`scene-thumb-${sc.id}`} />
                </button>
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
                  <button type="button" className={s.main} onClick={() => !onWall && void act.activate(sc.id)} onDoubleClick={() => setRenaming(sc.id)} title={onWall ? `${sc.name} is on the wall (double-click to rename)` : `put ${sc.name} on the wall (double-click to rename)`} data-testid={`scene-open-${sc.id}`}>
                    <span className={s.name}>
                      {onWall && <OnAirDot />}
                      {sc.name}
                    </span>
                    <span className={s.meta}>{onWall ? 'on the wall' : 'click to put it on the wall'}</span>
                  </button>
                )}
                <span className={s.acts}>
                  <button type="button" className={s.act} onClick={() => void act.duplicate(sc)} aria-label={`duplicate ${sc.name}`} title="duplicate" data-testid={`scene-duplicate-${sc.id}`}>
                    <Icon name="copy" size={13} />
                  </button>
                  <button type="button" className={s.act} onClick={() => setRenaming(sc.id)} aria-label={`rename ${sc.name}`} title="rename" data-testid={`scene-rename-${sc.id}`}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button type="button" className={s.act} onClick={() => (onWall ? toast('Activate another scene first.', { bad: true }) : setConfirm(sc.id))} aria-label={`delete ${sc.name}`} title={onWall ? 'on the wall: activate another scene first' : 'delete'} disabled={onWall} data-testid={`scene-delete-${sc.id}`}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </div>
            )
          })}
        </section>
      ))}
      <div className={s.foot}>
        <Menu
          width={250}
          trigger={({ toggle }) => (
            <Pill size="sm" icon="plus" onClick={toggle} data-testid="scene-new">
              new scene
            </Pill>
          )}
          items={[
            ...SCENE_KINDS.map((k) => ({
              key: k,
              icon: KIND_ICON[k],
              label: NEW_LABEL[k],
              meta: catalog?.sceneTemplates?.find((t) => t.kind === k)?.name,
              onSelect: () => void create(k),
              testId: `scene-new-${k}`,
            })),
          ]}
        />
        {onFromPhoto && (
          <Pill size="sm" ghost icon="image" onClick={onFromPhoto}>
            from photo
          </Pill>
        )}
      </div>
      {peek && (
        <div className={s.peek} style={{ top: peek.top, left: peek.left }} data-testid="scene-preview" onMouseLeave={() => setPeek(null)}>
          <SceneThumb id={peek.id} ctx={ctx} width={320} height={180} fps={30} testId="scene-preview-canvas" />
          <div className={s.peekBar}>
            <span className={s.peekName}>{scenes.find((x) => x.id === peek.id)?.name}</span>
            {peek.id === active ? (
              <span className={s.meta}>on the wall</span>
            ) : (
              <Pill size="sm" on icon="projector" onClick={() => void act.activate(peek.id).then((ok) => ok && setPeek(null))} data-testid="scene-preview-activate">
                put on the wall
              </Pill>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

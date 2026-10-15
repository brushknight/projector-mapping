import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cap, Glass, Icon, ModeTabs, OnAirDot, Panel, type ModeTab } from '../../../../shared/components'
import { useChannel, useServerSecond } from '../../../../shared/lib/useHub'
import { pressed } from '../../../../shared/lib/pointer'
import { useRaf } from '../../../../shared/lib/useRaf'
import { HubError, type Hub } from '../../../../shared/lib/ws'
import type { Catalog } from '../../../catalog/types'
import type { EffectDef } from '../../../effect/types'
import { useSceneEditing } from '../../../scene/editing'
import { stackLayers } from '../../../scene/lib'
import { padForKey, setMode, sortedCues } from '../../../scene/ops'
import type { BackdropMode, SceneKind, SceneMode, SceneSummary } from '../../../scene/types'
import { activeTestPattern, testPatternSecondsLeft, type Setup } from '../../../setup'
import type { SoundPlayAck } from '../../../sound/types'
import { SoundLibrary } from '../../../sound/ui/soundLibrary'
import { Soundboard } from '../../../sound/ui/soundboard'
import { useSounds } from '../../../sound/ui/useSounds'
import { formatTime } from '../../../scene/ui/timeline/time'
import { playheadNow, soloSecondsLeft } from '../../live'
import { showAudio, type Show } from '../../types'
import { SceneBrowser } from '../sceneSwitcher/browser'
import { WallPanel } from '../wallPanel'
import { ShowContext, useShow, type ShowState } from './context'
import { ColorPanel, LivePanel, ObjectsPanel, PresetChips, SceneryPanel, StaticPanel } from './modes'
import { LivePreview } from './preview'
import { TryBar } from './liveGallery'
import { StaticTryBar } from './staticGallery'
import type { StaticTry } from '../../../catalog/staticTry'
import { openViewer } from '../../../output/viewer'
import { PutOnProjector } from '../../../output/ui/putOnProjector'
import s from './styles.module.css'

export const NO_AUDIO = 'Nothing plays sound right now. Open /out on the projector computer and click it once.'

const TABS: Array<ModeTab<SceneMode>> = [
  { value: 'static', label: 'static', icon: 'modeStatic', title: 'one gobo: a window, blinds, leaves' },
  { value: 'live', label: 'live', icon: 'modeLive', title: 'live layers: swaying trees, clouds, rain' },
  { value: 'color', label: 'color', icon: 'modeColor', title: 'a slow gradient' },
  { value: 'scenery', label: 'scenery', icon: 'image', title: 'a blurred photo or a video loop' },
  { value: 'objects', label: 'objects', icon: 'cube', title: 'the mapped objects and the timeline' },
]

/**
 * The Show space: run the wall without knowing anything about mapping. It always shows and controls the scene on the
 * wall (`show.activeSceneId`) and edits it live. The phone's information architecture in the editor's look: a big
 * preview of exactly what the projector shows, mode tabs that switch what is on air, a panel per mode with presets,
 * the scenes, the wall (on air, volume, where sound plays) and the soundboard.
 */
export function ShowSpace({
  hub,
  show,
  catalog,
  effects,
  scenes,
  reloadScenes,
  toast,
  command,
  onFromPhoto,
  onSceneCreated,
}: {
  hub: Hub
  show: Show | null
  catalog: Catalog | null
  effects: EffectDef[]
  scenes: SceneSummary[]
  reloadScenes: () => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  command: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  onFromPhoto?: () => void
  /** (§15) a scene made from a template: the editor puts it on the wall, or opens a mapping scene in the map space */
  onSceneCreated?: (id: string, kind: SceneKind) => void
}) {
  const bad = useCallback((m: string) => toast(m, { bad: true }), [toast])
  const activeId = show?.activeSceneId ?? null
  const editing = useSceneEditing(hub, activeId, 'live', bad)
  const scene = editing.scene
  const setup = useChannel<Setup>(hub, scene?.setupId ? `setup:${scene.setupId}` : show?.activeSetupId ? `setup:${show.activeSetupId}` : null).doc
  const { sounds, reload: reloadSounds } = useSounds(hub)
  const [tab, setTab] = useState<SceneMode>('static')
  const [liveLayer, setLiveLayer] = useState<string | null>(null)
  const [trying, setTrying] = useState<string | null>(null)
  const [staticTry, setStaticTry] = useState<StaticTry | null>(null)
  // a try ends when the scene on the wall changes or the tab changes
  useEffect(() => {
    setTrying(null)
    setStaticTry(null)
  }, [scene?.id, tab])

  // the open tab is what is on air: follow the wall (another client may switch it), never send on open
  useEffect(() => {
    if (scene?.mode) setTab(scene.mode)
  }, [scene?.mode, scene?.id])

  // (§20) the last backdrop mode seen on air per scene: "start with converge" closes that light onto the objects
  const [lastBackdrop, setLastBackdrop] = useState<Record<string, BackdropMode>>({})
  useEffect(() => {
    const m = scene?.mode
    if (scene && m && m !== 'objects') setLastBackdrop((o) => (o[scene.id] === m ? o : { ...o, [scene.id]: m }))
  }, [scene?.mode, scene?.id, scene])

  const openTab = useCallback(
    (m: SceneMode) => {
      setTab(m)
      if (scene && scene.mode !== m) void editing.edit(() => setMode(m))
    },
    [scene, editing],
  )

  const play = useCallback(
    async (args: { padId?: string; soundId?: string }): Promise<SoundPlayAck | undefined> => {
      try {
        return ((await hub.cmd('sound.play', args)) ?? {}) as SoundPlayAck
      } catch (e) {
        if (e instanceof HubError && e.code === 'no_audio') toast(NO_AUDIO, { bad: true })
        else toast(e instanceof Error ? e.message : String(e), { bad: true })
        return undefined
      }
    },
    [hub, toast],
  )

  const state: ShowState = {
    hub,
    show,
    scene,
    setup,
    catalog,
    effects,
    editing,
    scenes,
    reloadScenes,
    sounds,
    reloadSounds,
    tab,
    openTab,
    toast,
    command,
    play: async (a) => void (await play(a)),
    liveLayer,
    setLiveLayer,
    trying,
    setTrying,
    staticTry,
    setStaticTry,
    presetMode: tab === 'objects' ? 'static' : tab,
    lastBackdrop: scene ? lastBackdrop[scene.id] ?? null : null,
  }

  // ── keys: pads on their keys, Enter (or G when no pad has it) is GO; Space stays with nothing ──────────────
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      const sc = sceneRef.current
      if (e.key === 'Enter') {
        e.preventDefault()
        void command('show.go')
        return
      }
      if (!sc || e.key.length !== 1) return
      const pad = padForKey(sc, e.key)
      if (pad) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('pm:pad', { detail: pad.id }))
        return
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        void command('show.go')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [command])

  const loops = showAudio(show).loops ?? []

  return (
    <ShowContext.Provider value={state}>
      <div className={s.show} data-testid="show-space">
        <Panel as="aside" className={s.left} aria-label="scenes and the wall">
          <div className={s.sec}>
            <div className={s.secHead}>
              <Cap>scenes</Cap>
              <span className={s.dim}>{scenes.length}</span>
            </div>
            <SceneBrowser hub={hub} show={show} catalog={catalog} setup={setup} scenes={scenes} reload={reloadScenes} toast={toast} onFromPhoto={onFromPhoto} onCreated={onSceneCreated} />
          </div>
          <div className={s.sec}>
            <div className={s.secHead}>
              <Cap>the wall</Cap>
            </div>
            <WallPanel show={show} command={command} />
          </div>
          <KeysHint />
        </Panel>

        <div className={s.center}>
          <Hero />
          <ModeTabs<SceneMode> ariaLabel="what is on the wall" tabs={TABS} value={tab} onAir={show?.onAir === false ? null : scene?.mode ?? null} onChange={openTab} className={s.tabs} />
          {!scene ? (
            <div className={s.empty}>{activeId ? 'loading the scene on the wall…' : 'no scene on the wall. create one on the left.'}</div>
          ) : (
            <div className={s.modeBody} data-testid={`mode-panel-${tab}`}>
              {tab === 'static' && <StaticPanel />}
              {tab === 'live' && <LivePanel />}
              {tab === 'color' && <ColorPanel />}
              {tab === 'scenery' && <SceneryPanel />}
              {tab === 'objects' && <ObjectsPanel />}
              {tab !== 'objects' && <PresetChips mode={tab} />}
            </div>
          )}
        </div>

        <Panel as="aside" className={s.right} aria-label="sound">
          <div className={s.sec}>
            <div className={s.secHead}>
              <Cap>soundboard</Cap>
              <span className={s.dim}>{scene ? scene.name : ''}</span>
            </div>
            {scene && (
              <Soundboard
                scene={scene}
                editing={editing}
                sounds={sounds}
                loops={loops}
                onPlay={(padId) => play({ padId })}
                onStopAll={() => void hub.cmd('sound.stop', {}).catch((e) => bad(e instanceof Error ? e.message : String(e)))}
                toast={toast}
                reloadSounds={reloadSounds}
              />
            )}
          </div>
          <div className={`${s.sec} ${s.grow}`}>
            <div className={s.secHead}>
              <Cap>sounds</Cap>
              <span className={s.dim}>{sounds.length}</span>
            </div>
            <SoundLibrary sounds={sounds} reload={reloadSounds} toast={toast} onPreview={(sha) => void play({ soundId: sha })} compact />
          </div>
        </Panel>
      </div>
    </ShowContext.Provider>
  )
}

function KeysHint() {
  return (
    <div className={s.keys}>
      <Icon name="keyboard" size={14} />
      <span>
        a pad's key plays it · <kbd>enter</kbd> or <kbd>g</kbd> = go · space does nothing here
      </span>
    </div>
  )
}

/** What the on-air label says after "on air" for each mode, like the phone hero. */
function useDetail(): string {
  const sh = useShow()
  const sc = sh.scene
  if (!sc) return ''
  if (sc.mode === 'objects') {
    const cues = sortedCues(sc)
    return cues.length ? `cue ${Math.min(cues.length, (sh.show?.transport.cue ?? 0) + 1)} / ${cues.length}` : 'objects'
  }
  const layers = stackLayers(sc, sc.mode).filter((l) => l.visible)
  // (§15) static and live: what is in front of the light
  const atts = sc.mode === 'static' || sc.mode === 'live' ? (sc.backdrop[sc.mode].attachments ?? []).filter((a) => a.visible) : []
  if (sc.mode === 'live') return `${layers.length} layer${layers.length === 1 ? '' : 's'}${atts.length ? ` · ${atts.map((a) => a.name).join(' + ')}` : ''}`
  if (sc.mode === 'static') return atts.length ? atts.map((a) => a.name).join(' + ') : 'open light'
  return layers[0]?.name ?? 'nothing picked'
}

/**
 * (§15) Drag the hero sideways (up and down in portrait) to slide the whole light inside the frame. Only a clearly
 * horizontal drag counts, so a vertical swipe keeps scrolling the page. Double click puts it back in the middle.
 */
function SlideDrag() {
  const sh = useShow()
  const sc = sh.scene
  const mode = sc?.mode === 'static' || sc?.mode === 'live' ? sc.mode : null
  const light = mode ? sc?.backdrop[mode]?.light : null
  const portrait = !!sh.setup && sh.setup.output.orientation !== 'landscape'
  const axis = portrait ? 'y' : 'x'
  const drag = useRef<{ x: number; y: number; v: number; on: boolean; w: number; h: number } | null>(null)
  if (!mode || !light) return null
  const path = `/backdrop/${mode}/light/slide/${axis}`
  const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 1000) / 1000))
  return (
    <div
      className={s.slideDrag}
      title="drag sideways to slide the light across the frame, double click to centre it"
      data-testid="hero-slide"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        drag.current = { x: e.clientX, y: e.clientY, v: light.slide?.[axis] ?? 0, on: false, w: r.width, h: r.height }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        // a move without a button (the wheel scrolls the page under a still pointer) never slides the light
        if (!pressed(e)) {
          drag.current = null
          return
        }
        const dx = e.clientX - d.x, dy = e.clientY - d.y
        const along = portrait ? dy : dx, across = portrait ? dx : dy
        if (!d.on) {
          if (Math.abs(along) < 6) return
          if (Math.abs(along) < 1.5 * Math.abs(across)) {
            drag.current = null
            return
          }
          d.on = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        sh.editing.setValue(path, clamp(d.v + along / (portrait ? d.h : d.w)), 'live')
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d?.on) return
        const along = portrait ? e.clientY - d.y : e.clientX - d.x
        sh.editing.setValue(path, clamp(d.v + along / (portrait ? d.h : d.w)), 'final')
      }}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={(e) => {
        // released or left before the slide took the pointer: forget the press
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) drag.current = null
      }}
      onDoubleClick={() => sh.editing.setValue(`/backdrop/${mode}/light/slide`, { x: 0, y: 0 }, 'final')}
    />
  )
}

function ratio(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(w, h)
  const r = `${w / d}:${h / d}`
  return r === '8:5' ? '16:10' : r
}

/** The big preview with the on-air label, the format and (objects) the wall's playhead. */
function Hero() {
  const sh = useShow()
  const detail = useDetail()
  const now = useServerSecond(sh.hub)
  const tc = useRef<HTMLSpanElement>(null)
  useRaf(() => {
    if (tc.current) tc.current.textContent = formatTime(playheadNow(sh.hub, sh.show))
  })
  const onAir = sh.show?.onAir !== false
  const o = sh.setup?.output
  const pattern = activeTestPattern(sh.setup, now)
  const patternLeft = testPatternSecondsLeft(sh.setup, now)
  const soloLeft = soloSecondsLeft(sh.show, now)
  const ar = useMemo(() => (o ? (o.orientation === 'landscape' ? o.width / o.height : o.height / o.width) : 16 / 9), [o])
  return (
    <div className={s.heroWrap}>
      <div className={s.hero} style={{ aspectRatio: String(ar), ['--ar' as string]: String(ar) }} data-testid="show-hero">
        <LivePreview className={s.canvas} />
        <TryBar />
        <StaticTryBar />
        <div className={s.heroTop}>
          <Glass>
            <OnAirDot off={!onAir} />
            <span data-testid="on-air-label">{onAir ? `on air${detail ? ` · ${detail}` : ''}` : 'blackout'}</span>
          </Glass>
          <span className={s.heroRight}>
            {pattern !== 'off' && <Glass>test pattern · {pattern}{patternLeft !== null ? ` · ${patternLeft} s` : ''}</Glass>}
            {soloLeft !== null && <Glass>solo · {soloLeft} s</Glass>}
            {o && <Glass>{`${ratio(o.width, o.height)} · ${Math.min(o.width, o.height)}p`}</Glass>}
            <button type="button" className={s.heroBtn} onClick={() => { if (!openViewer({ portrait: !!o && o.orientation !== 'landscape' })) sh.toast('The browser blocked the viewer window. Allow pop-ups for this page.', { bad: true }) }} title="open a window that shows exactly what the projector shows" data-testid="show-open-viewer">
              <Icon name="viewer" size={14} />
              open viewer
            </button>
            <PutOnProjector
              className={s.heroMenu}
              onDone={(m) => sh.toast(m)}
              onError={(m) => sh.toast(m, { bad: true })}
              trigger={({ toggle }) => (
                <button type="button" className={s.heroBtn} onClick={toggle} title="open the output full screen on a display, with no browser bars" data-testid="show-put-on-projector">
                  <Icon name="projector" size={14} />
                  put on projector
                </button>
              )}
            />
          </span>
        </div>
        {!sh.trying && !sh.staticTry && <SlideDrag />}
        {sh.scene?.mode === 'objects' && (
          <div className={s.heroBottom}>
            <Glass>
              {sh.show?.transport.state === 'playing' && <i className={s.playDot} aria-hidden="true" />}
              <span ref={tc} className={s.tc} data-testid="show-playhead">
                00:00.00
              </span>
            </Glass>
          </div>
        )}
      </div>
    </div>
  )
}

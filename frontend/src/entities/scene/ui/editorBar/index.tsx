import { useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { Cap, Icon, Menu, OnAirDot, Pill, Segmented, type ToolItem } from '../../../../shared/components'
import { useChannel, useServerSecond } from '../../../../shared/lib/useHub'
import { useRaf } from '../../../../shared/lib/useRaf'
import type { Device } from '../../../device/types'
import { SetupPanel } from '../../../setup'
import { playheadNow, soloSecondsLeft } from '../../../show/live'
import { useEditor, type Space, type Tool } from '../../editor/context'
import { SCENE_MODES, type SceneMode } from '../../types'
import { SceneSwitcher } from '../../../show/ui/sceneSwitcher'
import { formatTime } from '../timeline/time'
import s from './styles.module.css'

export const TOOL_ITEMS: Array<ToolItem<Tool>> = [
  { value: 'select', icon: 'select', label: 'select', hotkey: 'V', hint: 'click a surface or point; drag to move it' },
  { value: 'quad', icon: 'quad', label: 'quad', hotkey: 'Q', hint: 'click the 4 corners of a face, clockwise from top left' },
  { value: 'tri', icon: 'tri', label: 'tri', hotkey: 'T', hint: 'click 3 corners' },
  { value: 'poly', icon: 'poly', label: 'poly', hotkey: 'P', hint: 'click each corner, then the first point or Enter' },
  { value: 'circle', icon: 'circle', label: 'circle', hotkey: 'C', hint: 'click the centre, then the rim' },
  { value: 'mesh', icon: 'mesh', label: 'mesh', hotkey: 'W', hint: 'click 4 corners, then bend the mesh points' },
  { value: 'line', icon: 'line', label: 'line', hotkey: 'E', hint: 'click along an edge, Enter finishes' },
  { value: 'mask', icon: 'mask', label: 'mask', hotkey: 'M', hint: 'click around an area to keep dark, Enter closes it' },
]

/** What each on-air mode shows (protocol §1 Scene.mode). */
export const MODE_META: Record<SceneMode, string> = {
  static: 'one gobo',
  live: 'live layers',
  color: 'a gradient',
  scenery: 'a photo',
  objects: 'mapped objects + timeline',
}

/**
 * The editor's top bar: scene, Map | Content, the editor's own preview transport, set up, and the wall's controls
 * (what is on air, GO, the wall's playhead, on air) kept apart on the right.
 */
export function EditorBar() {
  const ed = useEditor()
  const scene = ed.scene

  const inShow = ed.workspace === 'show'

  return (
    <header className={s.bar}>
      <span className={s.wm}>projector map</span>
      <SceneSwitcher
        hub={ed.hub}
        show={ed.show}
        scenes={ed.scenes}
        reload={ed.reloadScenes}
        toast={ed.toast}
        current={ed.sceneId ?? scene?.id ?? null}
        openLabel={inShow ? 'put on the wall:' : 'edit'}
        onOpen={(id) => (inShow ? id !== ed.show?.activeSceneId && void ed.command('show.activate', { sceneId: id }) : ed.openScene(id))}
        onCreated={inShow ? undefined : (id) => ed.openScene(id)}
        onFromPhoto={ed.openFromPhoto}
      />
      {ed.workspace === 'automap' ? (
        <Pill icon="close" onClick={() => ed.setSpace('map')} data-testid="close-automap">
          close auto map
        </Pill>
      ) : (
        <Segmented<Space>
          ariaLabel="space"
          width={250}
          className={s.ws}
          value={ed.space}
          onChange={ed.setSpace}
          options={[
            { value: 'show', label: 'show', title: 'run the wall: modes, scenes, cues and the soundboard' },
            { value: 'map', label: 'map', title: 'place the faces on the object (tab)' },
            { value: 'content', label: 'content', title: 'the faces unfolded flat, to put content on them (tab)' },
          ]}
        />
      )}
      {!inShow && <PreviewMini />}
      <span className={s.sp} />
      <SetUpMenu />
      {!inShow && <Segmented
        ariaLabel="output"
        size="sm"
        width={150}
        value={ed.mode}
        onChange={ed.setMode}
        options={[
          { value: 'backstage', label: 'backstage', title: 'edits go to a draft; the wall keeps the live scene' },
          { value: 'live', label: 'live', title: 'edits change the scene on the wall at once' },
        ]}
      />}
      <WallGroup />
    </header>
  )
}

/** The editor's own transport in the top bar: play the preview and see its time. */
function PreviewMini() {
  const ed = useEditor()
  const tc = useRef<HTMLSpanElement>(null)
  useRaf(() => {
    if (tc.current) tc.current.textContent = formatTime(ed.preview.t())
  })
  const p = ed.preview
  return (
    <div className={s.preview} role="group" aria-label="editor preview">
      <Pill
        size="sm"
        icon={p.playing ? 'pause' : 'play'}
        on
        aria-label={p.playing ? 'pause the preview (space)' : 'play the preview (space)'}
        title={p.playing ? 'pause the preview (space)' : 'play the preview here, the wall keeps going (space)'}
        onClick={p.toggle}
        data-testid="preview-play"
      />
      <span className={s.tc} title="editor playhead">
        <span ref={tc} data-testid="preview-time">00:00.00</span>
      </span>
      <Pill
        size="sm"
        ghost={!ed.wallFollows}
        on={ed.wallFollows}
        icon="projector"
        aria-pressed={ed.wallFollows}
        onClick={() => ed.setWallFollows(!ed.wallFollows)}
        title={ed.wallFollows ? 'the wall follows the editor: play, pause and scrub move it too. click to stop' : 'make the wall follow the editor preview (in backstage it previews your draft)'}
        data-testid="wall-follows"
      >
        {ed.wallFollows ? 'wall follows' : 'wall apart'}
      </Pill>
    </div>
  )
}

function ratio(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(w, h)
  const r = `${w / d}:${h / d}`
  return r === '8:5' ? '16:10' : r
}

/** Set up: the projector (reference photo, test patterns, output), auto map with the iPhone, devices. */
function SetUpMenu() {
  const ed = useEditor()
  const nav = useNavigate()
  const devices = useChannel<Device[]>(ed.hub, 'devices').doc ?? []
  const outputs = devices.filter((d) => d.role === 'output' && d.online)
  const setup = ed.setup
  return (
    <Menu
      align="right"
      width={360}
      open={ed.setupOpen}
      onOpenChange={ed.setSetupOpen}
      trigger={({ toggle }) => (
        <Pill icon="projector" onClick={toggle} aria-label="set up" data-testid="setup-chip" className={outputs.some((o) => (o.telemetry?.dropped ?? 0) > 5) ? s.warn : undefined}>
          set up
          {setup && <span className={s.dim}>{`${ratio(setup.output.width, setup.output.height)} · ${setup.output.width}×${setup.output.height}`}</span>}
        </Pill>
      )}
    >
      {(close) => (
        <div className={s.setup} data-testid="setup-menu">
          <Cap>1 · reference: a photo from the lens, or the test grid</Cap>
          {setup ? <SetupPanel hub={ed.hub} setup={setup} onError={(m) => ed.toast(m, { bad: true })} /> : <span className={s.dim}>no setup</span>}
          <Cap>calibration</Cap>
          <div className={s.setupRow}>
            <Pill
              size="sm"
              icon="phone"
              onClick={() => {
                close()
                nav({ to: '/editor/$space', params: { space: 'automap' }, search: ed.sceneId ? { scene: ed.sceneId } : {} })
              }}
              data-testid="open-automap"
            >
              auto map with the iphone
            </Pill>
            <Pill
              size="sm"
              ghost
              icon="image"
              onClick={() => {
                close()
                ed.openFromPhoto()
              }}
            >
              new scene from photo
            </Pill>
          </div>
          <Cap>devices</Cap>
          <div className={s.devices}>
            {devices.length === 0 && <span className={s.dim}>no devices yet</span>}
            {devices.map((d) => (
              <span key={d.id} className={d.online ? s.dev : s.devOff}>
                <Icon name={d.role === 'remote' ? 'phone' : d.role === 'output' ? 'projector' : 'select'} size={13} />
                {d.name}
                <span className={s.dim}>{d.online ? (d.telemetry ? `${d.telemetry.fps} fps` : d.role) : 'offline'}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Menu>
  )
}

/** The wall: what it shows, its playhead, GO, solo and test pattern countdowns, and on air. Kept apart from the editor's preview. */
function WallGroup() {
  const ed = useEditor()
  const onAir = ed.show?.onAir ?? false
  const tc = useRef<HTMLSpanElement>(null)
  const now = useServerSecond(ed.hub)
  const soloLeft = soloSecondsLeft(ed.show, now)
  const playing = ed.show?.transport.state === 'playing'
  useRaf(() => {
    if (tc.current) tc.current.textContent = formatTime(playheadNow(ed.hub, ed.show))
  })
  return (
    <div className={s.wall} role="group" aria-label="the wall" data-testid="wall-group">
      <span className={s.wallCap}>wall</span>
      {ed.show?.preview && (
        <Pill size="sm" on onClick={() => ed.command('show.stop')} title="a draft plays on the wall; click to stop it">
          draft preview · stop
        </Pill>
      )}
      {ed.testPattern.pattern !== 'off' && (
        <Pill size="sm" on onClick={() => ed.setTestPattern(ed.testPattern.pattern)} title="the projector shows a test pattern; click to keep it on for another 60 s" data-testid="test-pattern-chip">
          {ed.testPattern.pattern} · {ed.testPattern.secondsLeft ?? 60} s
        </Pill>
      )}
      {ed.testPattern.pattern !== 'off' && <Pill size="sm" ghost icon="close" aria-label="turn the test pattern off" title="turn the test pattern off" onClick={() => ed.setTestPattern('off')} />}
      {soloLeft !== null && ed.show?.solo && (
        <Pill
          size="sm"
          on
          onClick={() => ed.command('show.solo', { surfaceIds: ed.show!.solo!.surfaceIds, fill: ed.show!.solo!.fill, seconds: 60 })}
          title="the wall shows only the soloed faces; click to keep it for another 60 s, esc ends it"
          data-testid="wall-solo-chip"
        >
          solo · {ed.show.solo.fill} · {soloLeft} s
        </Pill>
      )}
      {ed.workspace !== 'show' && <Menu
        align="right"
        width={280}
        trigger={({ toggle }) => (
          <Pill size="sm" onClick={toggle} aria-label={`on air: ${ed.sceneMode}, click to switch`} title="what the wall shows: one mode at a time" data-testid="mode-picker">
            {ed.sceneMode}
            <Icon name="chevronDown" size={13} />
          </Pill>
        )}
        items={[
          { key: 'cap', caption: true, label: 'on the wall' },
          ...SCENE_MODES.map((m) => ({ key: `mode-${m}`, label: m, meta: MODE_META[m], on: m === ed.sceneMode, onSelect: () => ed.setSceneMode(m) })),
        ]}
      />}
      <span className={s.wallTc} title={playing ? 'the wall is playing' : 'the wall playhead'}>
        {playing && <i className={s.playDot} aria-hidden="true" />}
        <span ref={tc} data-testid="wall-time">00:00.00</span>
      </span>
      <Pill size="sm" icon="next" iconSize={13} onClick={() => ed.command('show.go')} title="the wall jumps to the next cue and plays" data-testid="go">
        go
      </Pill>
      <Pill
        size="sm"
        onClick={() => ed.command('show.blackout', { on: onAir })}
        aria-label={onAir ? 'on air, click to black out' : 'blacked out, click to go on air'}
        data-testid="on-air"
      >
        <OnAirDot off={!onAir} />
        {onAir ? 'on air' : 'blackout'}
      </Pill>
    </div>
  )
}

import { useNavigate } from '@tanstack/react-router'
import { Cap, Menu, OnAirDot, Pill, Segmented, Tools, type ToolItem } from '../../../../shared/components'
import { useChannel } from '../../../../shared/lib/useHub'
import type { Device } from '../../../device/types'
import { SetupPanel } from '../../../setup'
import { useEditor, type Tool, type Workspace } from '../../editor/context'
import { SCENE_MODES, type SceneMode } from '../../types'
import { sceneApi } from '../../api'
import s from './styles.module.css'

export const TOOL_ITEMS: Array<ToolItem<Tool>> = [
  { value: 'select', icon: 'select', label: 'select', hotkey: 'V', hint: 'click a surface or point; drag to move it' },
  { value: 'quad', icon: 'quad', label: 'quad', hotkey: 'Q', hint: 'click the 4 corners of a face, clockwise from top left' },
  { value: 'tri', icon: 'tri', label: 'tri', hotkey: 'T', hint: 'click 3 corners' },
  { value: 'poly', icon: 'poly', label: 'poly', hotkey: 'P', hint: 'click each corner, then the first point or Enter' },
  { value: 'circle', icon: 'circle', label: 'circle', hotkey: 'C', hint: 'click the centre, then the rim' },
  { value: 'mesh', icon: 'mesh', label: 'mesh', hotkey: 'W', hint: 'click 4 corners, then bend the mesh points' },
  { value: 'line', icon: 'line', label: 'line', hotkey: 'L', hint: 'click along an edge, Enter finishes' },
  { value: 'mask', icon: 'mask', label: 'mask', hotkey: 'K', hint: 'click around an area to keep dark, Enter closes it' },
]

/** What each on-air mode shows (protocol §1 Scene.mode). */
export const MODE_META: Record<SceneMode, string> = {
  static: 'one gobo',
  live: 'live layers',
  color: 'a gradient',
  scenery: 'a photo',
  objects: 'mapped objects + timeline',
}

function ratio(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(w, h)
  const r = `${w / d}:${h / d}`
  return r === '8:5' ? '16:10' : r
}

/** The editor's top bar: scene picker, workspaces, tools, iPhone, setup, backstage/live and on air. */
export function EditorBar() {
  const ed = useEditor()
  const nav = useNavigate()
  const devices = useChannel<Device[]>(ed.hub, 'devices').doc ?? []
  const phones = devices.filter((d) => d.role === 'remote')
  const phoneOnline = phones.some((d) => d.online)
  const outputs = devices.filter((d) => d.role === 'output' && d.online)
  const onAir = ed.show?.onAir ?? false
  const scene = ed.scene
  const setup = ed.setup

  const goWorkspace = (w: Workspace) => nav({ to: w === 'map' ? '/editor/map' : w === 'animate' ? '/editor/animate' : '/editor/automap', search: ed.sceneId ? { scene: ed.sceneId } : {} })

  const newScene = async () => {
    const setupId = setup?.id ?? ed.show?.activeSetupId
    if (!setupId) return ed.toast('Create a setup first.', { bad: true })
    try {
      const sc = await sceneApi.create(`scene ${ed.scenes.length + 1}`, setupId)
      ed.reloadScenes()
      ed.openScene(sc.id)
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }

  return (
    <header className={s.bar}>
      <span className={s.wm}>projector map</span>
      <Menu
        width={300}
        trigger={({ toggle }) => (
          <Pill onClick={toggle} aria-label="choose scene" data-testid="scene-picker">
            {scene ? scene.name.toLowerCase() : 'no scene'}
            {setup && <span className={s.dim}>· {setup.name.toLowerCase()}</span>}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Pill>
        )}
        items={[
          { key: 'cap', caption: true, label: 'scenes' },
          ...ed.scenes.map((sc) => ({
            key: sc.id,
            label: sc.name,
            on: sc.id === ed.sceneId,
            meta: sc.id === ed.show?.activeSceneId ? 'on the wall' : `v${sc.version}`,
            onSelect: () => ed.openScene(sc.id),
          })),
          { key: 'new', label: 'new empty scene', icon: 'plus', onSelect: newScene },
          { key: 'photo', label: 'new scene from photo', icon: 'image', onSelect: ed.openFromPhoto },
        ]}
      />
      <Segmented<Workspace>
        ariaLabel="workspace"
        width={250}
        className={s.ws}
        value={ed.workspace}
        onChange={goWorkspace}
        options={[
          { value: 'map', label: 'map' },
          { value: 'animate', label: 'animate' },
          { value: 'automap', label: 'auto map' },
        ]}
      />
      <div className={s.mid}>
        <Tools items={TOOL_ITEMS} value={ed.tool} onChange={ed.setTool} />
      </div>
      <Menu
        align="right"
        width={300}
        trigger={({ toggle }) => (
          <Pill ghost={!phoneOnline} icon="phone" onClick={toggle} aria-label="devices">
            iphone
          </Pill>
        )}
        items={[
          { key: 'c', caption: true, label: 'devices' },
          ...(devices.length
            ? devices.map((d) => ({
                key: d.id,
                icon: d.role === 'remote' ? 'phone' : d.role === 'output' ? 'projector' : 'select',
                label: d.name,
                meta: d.online ? (d.telemetry ? `${d.telemetry.fps} fps · ${d.telemetry.width}×${d.telemetry.height}` : d.role) : 'offline',
                disabled: !d.online,
              }))
            : [{ key: 'none', label: 'no devices yet', disabled: true }]),
        ]}
      />
      <Menu
        align="right"
        width={340}
        trigger={({ toggle }) => (
          <Pill icon="projector" onClick={toggle} aria-label="projector setup" data-testid="setup-chip" className={outputs.some((o) => (o.telemetry?.dropped ?? 0) > 5) ? s.warn : undefined}>
            {setup ? `${ratio(setup.output.width, setup.output.height)} · ${setup.output.width}×${setup.output.height}` : 'no setup'}
          </Pill>
        )}
      >
        {() => (setup ? <SetupPanel hub={ed.hub} setup={setup} onError={(m) => ed.toast(m, { bad: true })} /> : <Cap>no setup</Cap>)}
      </Menu>
      {ed.show?.preview && (
        <Pill on onClick={() => ed.command('show.stop')} title="an agent previews its draft on the wall; click to stop it">
          agent preview · stop
        </Pill>
      )}
      {ed.testPattern.pattern !== 'off' && (
        <Pill
          on
          size="sm"
          onClick={() => ed.setTestPattern(ed.testPattern.pattern)}
          title="the projector shows a test pattern; click to keep it on for another 60 s"
          data-testid="test-pattern-chip"
        >
          {ed.testPattern.pattern} · {ed.testPattern.secondsLeft ?? 60} s
        </Pill>
      )}
      {ed.testPattern.pattern !== 'off' && (
        <Pill size="sm" ghost onClick={() => ed.setTestPattern('off')} title="turn the test pattern off">
          off
        </Pill>
      )}
      <Menu
        align="right"
        width={280}
        trigger={({ toggle }) => (
          <Pill onClick={toggle} aria-label={`on air: ${ed.sceneMode}, click to switch`} title="what the wall shows: one mode at a time" data-testid="mode-picker">
            {ed.sceneMode}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Pill>
        )}
        items={[
          { key: 'cap', caption: true, label: 'on the wall' },
          ...SCENE_MODES.map((m) => ({ key: `mode-${m}`, label: m, meta: MODE_META[m], on: m === ed.sceneMode, onSelect: () => ed.setSceneMode(m) })),
        ]}
      />
      <Segmented
        ariaLabel="output"
        width={170}
        value={ed.mode}
        onChange={ed.setMode}
        options={[
          { value: 'backstage', label: 'backstage', title: 'edits go to a draft; the wall keeps the live scene' },
          { value: 'live', label: 'live', title: 'edits change the scene on the wall at once' },
        ]}
      />
      <Pill
        onClick={() => ed.command('show.blackout', { on: onAir })}
        aria-label={onAir ? 'on air, click to black out' : 'blacked out, click to go on air'}
        data-testid="on-air"
      >
        <OnAirDot off={!onAir} />
        {onAir ? 'on air' : 'blackout'}
      </Pill>
    </header>
  )
}

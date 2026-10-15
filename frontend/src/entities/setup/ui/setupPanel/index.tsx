import { useEffect, useRef, useState } from 'react'
import { openViewer } from '../../../output/viewer'
import { settingsApi, type AgentSettings } from '../../../settings'
import { useServerSecond } from '../../../../shared/lib/useHub'
import { Cap, FillSlider, Field, NumField, Pill, Row, Segmented, Switch } from '../../../../shared/components'
import type { Hub } from '../../../../shared/lib/ws'
import { assetApi } from '../../../asset/api'
import { assetUrl } from '../../../asset/types'
import { setupApi } from '../../api'
import { activeTestPattern, TEST_PATTERNS, testPatternSecondsLeft, type Orientation, type Setup, type TestPattern } from '../../types'
import s from './styles.module.css'

const SIZES: Array<[number, number]> = [
  [1920, 1080],
  [1280, 720],
  [3840, 2160],
  [1024, 768],
  [1280, 800],
]

/** Edits the active projector rig: output size, orientation, flips, master, blackout fade, test pattern, reference photo. */
export function SetupPanel({ hub, setup, onError }: { hub: Hub; setup: Setup; onError: (m: string) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const update = (body: Parameters<typeof setupApi.update>[1]) => setupApi.update(setup.id, body).catch((e) => onError(e instanceof Error ? e.message : String(e)))
  const o = setup.output
  const ch = `setup:${setup.id}`
  const now = useServerSecond(hub)
  const pattern = activeTestPattern(setup, now)
  const left = testPatternSecondsLeft(setup, now)
  // a pattern lasts 60 s (protocol §1 testPatternUntil); sending it again renews it
  const setPattern = (p: TestPattern) =>
    hub.cmd('setup.testPattern', { setupId: setup.id, pattern: p, seconds: 60 }).catch(() => update({ testPattern: p }))
  // (§15) agents edit live: the backdrop MCP tools write straight to the wall instead of a draft
  const [agents, setAgents] = useState<AgentSettings | null>(null)
  useEffect(() => {
    settingsApi.get().then(setAgents, () => setAgents(null))
  }, [])
  const setLive = (v: boolean) =>
    settingsApi.update({ agentLiveEdits: v }).then(setAgents, (e) => onError(e instanceof Error ? e.message : String(e)))
  return (
    <div className={s.panel}>
      <Row>
        <Cap>projector</Cap>
        <span className={s.name}>{setup.name}</span>
      </Row>
      <Pill icon="viewer" onClick={() => { if (!openViewer({ portrait: o.orientation !== 'landscape' })) onError('The browser blocked the viewer window. Allow pop-ups for this page.') }} title="open a window that shows exactly what the projector shows" data-testid="setup-open-viewer">
        open viewer
      </Pill>
      <Field label="orientation">
        <Segmented<Orientation>
          ariaLabel="orientation"
          value={o.orientation}
          onChange={(v) => update({ output: { orientation: v } })}
          options={[
            { value: 'landscape', label: 'landscape' },
            { value: 'portrait-cw', label: 'portrait ↻' },
            { value: 'portrait-ccw', label: 'portrait ↺' },
          ]}
        />
      </Field>
      <Field label="output pixels">
        <div className={s.size}>
          <NumField prefix="w" ariaLabel="output width" value={o.width} min={16} max={8192} onCommit={(v) => update({ output: { width: Math.round(v) } })} />
          <NumField prefix="h" ariaLabel="output height" value={o.height} min={16} max={8192} onCommit={(v) => update({ output: { height: Math.round(v) } })} />
        </div>
        <div className={s.chips}>
          {SIZES.map(([w, h]) => (
            <Pill key={`${w}x${h}`} size="sm" on={o.width === w && o.height === h} onClick={() => update({ output: { width: w, height: h } })}>
              {w}×{h}
            </Pill>
          ))}
        </div>
      </Field>
      <Row>
        <span>flip horizontally</span>
        <Switch checked={o.flipH} onChange={(v) => update({ output: { flipH: v } })} ariaLabel="flip horizontally" />
      </Row>
      <Row>
        <span>flip vertically</span>
        <Switch checked={o.flipV} onChange={(v) => update({ output: { flipV: v } })} ariaLabel="flip vertically" />
      </Row>
      <FillSlider label="master" value={setup.master} display={`${Math.round(setup.master * 100)}%`} onChange={(v) => hub.param(ch, '/master', Math.round(v * 100) / 100)} />
      <Field label="blackout fade">
        <Segmented<string>
          ariaLabel="blackout fade"
          value={String(setup.blackoutFadeMs)}
          onChange={(v) => update({ blackoutFadeMs: Number(v) })}
          options={[
            { value: '0', label: 'cut' },
            { value: '500', label: '0.5 s' },
            { value: '2000', label: '2 s' },
          ]}
        />
      </Field>
      <Field label="test pattern on the projector">
        <Segmented<TestPattern> ariaLabel="test pattern" size="sm" value={pattern} onChange={setPattern} options={TEST_PATTERNS.map((p) => ({ value: p, label: p }))} />
        {pattern !== 'off' && (
          <Row>
            <span className={s.none} data-testid="test-pattern-left">
              turns off in {left ?? 60} s
            </span>
            <Pill size="sm" onClick={() => setPattern(pattern)} title="keep the pattern on for another 60 s">
              keep on 60 s
            </Pill>
          </Row>
        )}
      </Field>
      {agents && (
        <Field label="agents">
          <Row>
            <span>agents edit live</span>
            <Switch checked={!!agents.agentLiveEdits} onChange={setLive} ariaLabel="agents edit live" />
          </Row>
          <span className={s.none}>{agents.agentLiveEdits ? 'Claude and Codex change the light on the wall, the phone and the viewer at once.' : 'Claude and Codex propose light changes in a draft you apply.'}</span>
        </Field>
      )}
      <Field label="reference photo (never projected)">
        <div className={s.ref}>
          {setup.referenceAsset ? <img src={assetUrl(setup.referenceAsset)} alt="reference" className={s.thumb} /> : <span className={s.none}>none yet</span>}
          <div className={s.refActions}>
            <Pill size="sm" icon="upload" onClick={() => file.current?.click()}>
              upload
            </Pill>
            {setup.referenceAsset && (
              <Pill size="sm" ghost onClick={() => update({ referenceAsset: null })}>
                clear
              </Pill>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const a = await assetApi.upload(f, 'reference', f.name)
                await update({ referenceAsset: a.sha })
              } catch (err) {
                onError(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </div>
      </Field>
    </div>
  )
}

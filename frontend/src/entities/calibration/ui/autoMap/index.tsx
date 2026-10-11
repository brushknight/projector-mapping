import { useEffect, useState } from 'react'
import { Cap, Glass, Icon, OnAirDot, Pill, Row, Section, Segmented, StepBar } from '../../../../shared/components'
import { assetApi } from '../../../asset/api'
import { CameraFeed, frameBlob, type CameraFrame, type CameraStatus } from '../../../camera'
import { setupApi } from '../../../setup/api'
import { useEditor } from '../../../scene/editor/context'
import { OutputView } from '../../../scene/ui/outputView'
import { SurfaceTree } from '../../../scene/ui/surfaceTree'
import { calibrationApi } from '../../api'
import { xy, type CalibProgress, type Calibration, type Candidate } from '../../types'
import { newId } from '../../../../shared/lib/ids'
import { clockwise, orderQuad } from '../../../scene/geometry'
import { addSurface } from '../../../scene/ops'
import type { Surface, SurfaceKind } from '../../../scene/types'
import s from './styles.module.css'

export interface AutoMapState {
  frame: CameraFrame | null
  status: CameraStatus | null
  frameAt: number
  calib: { progress: CalibProgress | null; result: Calibration | null; running: boolean; done: boolean; error: string | null; start: () => void }
  agentRunning: boolean
  agentDone: boolean
}

const live = (st: AutoMapState) => !!st.frame && Date.now() - st.frameAt < 5000

/** Left panel of auto map: readiness, calibration quality, objects in view, (re)calibrate. */
export function AutoMapPanel({ st }: { st: AutoMapState }) {
  const ed = useEditor()
  const p = st.calib.progress
  const q = st.calib.result?.quality
  const surfaces = ed.scene?.objects.reduce((a, o) => a + o.surfaces.length, 0) ?? 0
  const steady = st.status?.steady ?? live(st)
  return (
    <>
      <div className={s.ph}>
        <Cap>auto map</Cap>
      </div>
      <Section tight>
        <Row>
          <span className={s.item}>
            <Icon name="phone" /> iphone on stand
          </span>
          <span className={s.dim}>{steady ? <Icon name="check" size={14} strokeWidth={2.4} /> : live(st) ? 'moving' : 'not connected'}</span>
        </Row>
        <Row>
          <span className={s.item}>
            <Icon name="testGrid" /> calibration
          </span>
          <span className={s.dim}>{p ? `${p.done} / ${p.total}` : ed.setup?.calibrationId ? 'done' : 'not yet'}</span>
        </Row>
        <Row>
          <span className={s.item}>
            <Icon name="target" /> camera ↔ projector
          </span>
          <span className={s.dim}>{q ? `${q.errorPx.toFixed(1)} px` : '…'}</span>
        </Row>
        <Row>
          <span className={s.item}>
            <Icon name="cube" /> surfaces found
          </span>
          <span className={s.dim}>{surfaces}</span>
        </Row>
        {st.calib.error && <span className={s.err}>{st.calib.error}</span>}
        {p?.message && <span className={s.dim}>{p.message}</span>}
      </Section>
      <Candidates st={st} />
      <Section>
        <Cap>objects in view</Cap>
      </Section>
      <SurfaceTree header={false} />
      <Section>
        <Pill icon={ed.setup?.calibrationId || p ? 'loop' : 'target'} onClick={st.calib.start} disabled={st.calib.running || !ed.setup} data-testid="calibrate">
          {st.calib.running ? 'calibrating…' : ed.setup?.calibrationId || p ? 'recalibrate' : 'run calibration'}
        </Pill>
      </Section>
    </>
  )
}

/** Planar surfaces the calibration found; add one as a surface of a new object. */
function Candidates({ st }: { st: AutoMapState }) {
  const ed = useEditor()
  const id = st.calib.result?.id
  const [list, setList] = useState<Candidate[]>([])
  useEffect(() => {
    if (!id || st.calib.running) return
    calibrationApi.candidates(id).then(setList, () => setList([]))
  }, [id, st.calib.running])
  if (!list.length) return null
  const add = (c: Candidate) => {
    const pts = c.scene.map(xy).map((p) => ({ id: newId('p'), x: Math.round(p.x), y: Math.round(p.y) }))
    const kind: SurfaceKind = pts.length === 4 ? 'quad' : pts.length === 3 ? 'tri' : 'poly'
    const ordered = kind === 'quad' ? orderQuad(pts) : clockwise(pts)
    const objectId = newId('obj')
    const surface: Surface = { id: newId('srf'), name: `${c.kind} ${Math.round(c.confidence * 100)}%`, kind, role: 'face', pointIds: ordered.map((p) => p.id), parentId: null, visible: true, mesh: null, effects: [], opacity: 1, softEdge: 8 }
    void ed.editing.edit((sc) => addSurface(sc, null, surface, ordered, { id: objectId, name: `found ${(ed.scene?.objects.length ?? 0) + 1}`, tags: ['found'], visible: true }))
    ed.select({ objectId, surfaceId: surface.id, focus: 'surface' })
  }
  return (
    <Section>
      <Cap>surfaces found</Cap>
      {list.map((c) => (
        <Row key={c.id}>
          <span className={s.dim}>
            {c.kind} · {Math.round(c.confidence * 100)}%
          </span>
          <Pill size="sm" icon="plus" onClick={() => add(c)}>
            add
          </Pill>
        </Row>
      ))}
    </Section>
  )
}

type FeedView = 'camera' | 'output' | 'both'

/** The middle of auto map: the phone's camera next to what the projector gets. */
export function AutoMapStage({ st }: { st: AutoMapState }) {
  const ed = useEditor()
  const [view, setView] = useState<FeedView>('both')
  const stt = st.status
  const save = async (asReference: boolean) => {
    if (!st.frame) return ed.toast('No camera frame yet.', { bad: true })
    try {
      const a = await assetApi.upload(frameBlob(st.frame), asReference ? 'reference' : 'photo', `camera-${st.frame.seq}.jpg`)
      if (asReference && ed.setup) {
        await setupApi.update(ed.setup.id, { referenceAsset: a.sha })
        ed.toast('The camera frame is the reference photo now.')
      } else ed.toast(`Saved the snapshot (${a.sha.slice(0, 8)}).`)
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), { bad: true })
    }
  }
  const err = st.calib.result?.quality?.errorPx
  return (
    <section className={s.stage} aria-label="camera and output">
      <div className={s.sbar}>
        <Segmented<FeedView>
          ariaLabel="view"
          width={230}
          value={view}
          onChange={setView}
          options={[
            { value: 'camera', label: 'camera' },
            { value: 'output', label: 'output' },
            { value: 'both', label: 'both', icon: 'split' },
          ]}
        />
        <Pill icon="camera" onClick={() => save(false)} disabled={!st.frame}>
          snapshot
        </Pill>
        <Pill icon="upload" onClick={() => save(true)} disabled={!st.frame}>
          use as reference
        </Pill>
        <span className={s.sp} />
        <Glass solid>
          <OnAirDot off={!live(st)} />
          {live(st) ? `iphone live · ${stt?.height ?? st.frame?.height ?? 0}p · ${Math.round(stt?.fps ?? 0)} fps` : 'iphone not streaming'}
        </Glass>
      </div>
      <div className={view === 'both' ? s.both : s.one}>
        {view !== 'output' && <CameraFeed frame={st.frame} left="camera · what the phone sees" right={err != null ? `error ${err.toFixed(1)} px` : undefined} />}
        {view !== 'camera' && (
          <div className={s.outWrap}>
            <OutputView label="output · what the agent sends" badge={st.agentRunning ? 'agent working' : st.agentDone ? 'pass done' : undefined} />
          </div>
        )}
      </div>
    </section>
  )
}

/** The bottom strip: stand, patterns, matching, surfaces, agent maps, verify. */
export function AutoMapSteps({ st }: { st: AutoMapState }) {
  const p = st.calib.progress
  const frac = p && p.total ? p.done / p.total : 0
  const calibrated = st.calib.done || (!!st.calib.result?.quality && !st.calib.running)
  const steps = [
    { label: 'stand', fraction: live(st) ? 1 : 0 },
    { label: 'patterns', fraction: calibrated ? 1 : Math.min(1, frac * 1.2) },
    { label: 'matching', fraction: calibrated ? 1 : frac > 0.8 ? (frac - 0.8) * 5 : 0 },
    { label: 'surfaces', fraction: calibrated ? 1 : 0 },
    { label: 'agent maps', fraction: st.agentDone ? 1 : st.agentRunning ? 0.5 : 0 },
    { label: 'verify', fraction: st.agentDone && calibrated ? 1 : 0 },
  ]
  return (
    <section className={s.steps} aria-label="auto map progress">
      <StepBar steps={steps} />
    </section>
  )
}

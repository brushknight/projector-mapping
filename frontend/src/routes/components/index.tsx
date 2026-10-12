import { useState, type ReactNode } from 'react'
import {
  AskBox,
  Cap,
  ChatMessage,
  ColorField,
  Dialog,
  EfxCard,
  EmptyState,
  Field,
  FillSlider,
  Glass,
  HintBar,
  Icon,
  ICON_NAMES,
  LibTile,
  Log,
  LogRow,
  Menu,
  NumField,
  OnAirDot,
  Panel,
  PanelHeader,
  Pill,
  QrCode,
  Readout,
  Row,
  Section,
  Segmented,
  StepBar,
  Switch,
  TextArea,
  TextInput,
  Tools,
  TreeNode,
  useToast,
} from '../../shared/components'
import { ParamControls } from '../../entities/effect'
import type { ParamSchema } from '../../entities/effect'
import s from './styles.module.css'

function Demo({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <section className={s.demo} id={name}>
      <div className={s.head}>
        <span className={s.name}>{name}</span>
        {note && <span className={s.note}>{note}</span>}
      </div>
      <div className={s.body}>{children}</div>
    </section>
  )
}

const SCHEMA: ParamSchema = {
  mode: { type: 'enum', options: ['border', 'boomerang'], default: 'border', label: 'mode' },
  line: { type: 'number', min: 1, max: 12, default: 3, label: 'line', unit: 'px' },
  speed: { type: 'number', min: 0.2, max: 10, default: 2, label: 'speed', unit: 's' },
  glow: { type: 'number', min: 0, max: 1, default: 0.62, label: 'glow' },
  cells: { type: 'integer', min: 2, max: 32, default: 8, label: 'cells' },
  color: { type: 'color', default: '#e9fbff', label: 'color' },
  text: { type: 'string', default: 'ZIMACUBE', label: 'text' },
  loop: { type: 'boolean', default: true, label: 'loop' },
}

/** The living style guide: every shared component, as the editor and the output use them. */
export function ComponentsPage() {
  const toast = useToast()
  const [seg, setSeg] = useState('output')
  const [tool, setTool] = useState('select')
  const [v, setV] = useState(0.62)
  const [sw, setSw] = useState(true)
  const [num, setNum] = useState(1404)
  const [color, setColor] = useState('#ff4d00')
  const [dialog, setDialog] = useState(false)
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [sel, setSel] = useState('top')

  return (
    <main className={s.page}>
      <header className={s.top}>
        <span className={s.wm}>projector map</span>
        <Cap>components · the living style guide</Cap>
        <span className={s.sp} />
        <a className={s.link} href="/editor">
          open the editor
        </a>
      </header>
      <div className={s.grid}>
        <Demo name="Pill" note="md 34 · sm 28 · lg 40; on, ghost, icon">
          <Row>
            <Pill>default</Pill>
            <Pill on>on</Pill>
            <Pill ghost>ghost</Pill>
            <Pill icon="phone">with icon</Pill>
            <Pill icon="plus" aria-label="add" />
            <Pill size="sm">small</Pill>
            <Pill size="lg" on>
              create scene
            </Pill>
            <Pill disabled>disabled</Pill>
          </Row>
        </Demo>

        <Demo name="OnAirDot" note="the one red, for on air and live camera">
          <Row>
            <Pill>
              <OnAirDot />
              on air
            </Pill>
            <Pill>
              <OnAirDot off />
              blackout
            </Pill>
          </Row>
        </Demo>

        <Demo name="Segmented">
          <Segmented
            ariaLabel="view"
            width={260}
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'input', label: 'input' },
              { value: 'output', label: 'output' },
              { value: 'split', label: 'split', icon: 'split' },
            ]}
          />
          <Segmented ariaLabel="small" size="sm" value="a" onChange={() => {}} options={[{ value: 'a', label: 'inspect' }, { value: 'b', label: 'agent' }]} />
        </Demo>

        <Demo name="Tools" note="the top bar's tool strip">
          <Tools
            value={tool}
            onChange={setTool}
            items={[
              { value: 'select', icon: 'select', label: 'select', hotkey: 'V' },
              { value: 'quad', icon: 'quad', label: 'quad', hotkey: 'Q' },
              { value: 'tri', icon: 'tri', label: 'tri', hotkey: 'T' },
              { value: 'poly', icon: 'poly', label: 'poly', hotkey: 'P' },
              { value: 'circle', icon: 'circle', label: 'circle', hotkey: 'C' },
              { value: 'mesh', icon: 'mesh', label: 'mesh', hotkey: 'W' },
              { value: 'line', icon: 'line', label: 'line', hotkey: 'L' },
              { value: 'mask', icon: 'mask', label: 'mask', hotkey: 'K' },
            ]}
          />
        </Demo>

        <Demo name="FillSlider" note="drag, arrows, shift ×10">
          <FillSlider label="glow" value={v} display={`${Math.round(v * 100)}%`} onChange={(x) => setV(x)} />
          <FillSlider label="line" value={3} min={1} max={12} display="3 px" onChange={() => {}} />
          <FillSlider label="disabled" value={0.3} disabled onChange={() => {}} />
        </Demo>

        <Demo name="Switch">
          <Row>
            <span>lock corners while meshing</span>
            <Switch checked={sw} onChange={setSw} ariaLabel="lock corners" />
          </Row>
        </Demo>

        <Demo name="NumField and Readout" note="enter commits, arrows step">
          <div className={s.two}>
            <NumField prefix="x" ariaLabel="x" value={num} onCommit={setNum} />
            <NumField prefix="y" ariaLabel="y" value={318} selected onCommit={() => {}} />
          </div>
          <Readout prefix="zoom">100%</Readout>
        </Demo>

        <Demo name="TextInput, TextArea and Field">
          <Field label="scene name">
            <TextInput placeholder="desk" />
          </Field>
          <TextArea value="outline the zimacube faces" onChange={() => {}} placeholder="prompt" />
        </Demo>

        <Demo name="ColorField">
          <ColorField label="color" value={color} onChange={(h) => setColor(h)} />
        </Demo>

        <Demo name="Panel, PanelHeader, Section, Cap">
          <Panel className={s.panelDemo}>
            <PanelHeader>
              <Cap>surfaces</Cap>
              <Pill size="sm" icon="plus" aria-label="add" />
            </PanelHeader>
            <Section tight>
              <Row>
                <Cap>corners</Cap>
                <Cap>P2 shared with right</Cap>
              </Row>
            </Section>
            <Section>
              <span>sections after the first get a hairline</span>
            </Section>
          </Panel>
        </Demo>

        <Demo name="TreeNode">
          <div className={s.col}>
            <TreeNode icon="folder" label="zimacube" meta="7 pts" onToggleVisible={() => {}} />
            {['top', 'left', 'edges'].map((n) => (
              <TreeNode key={n} depth={1} icon={n === 'edges' ? 'line' : 'quad'} label={n} meta={n === 'edges' ? '9' : 'face'} selected={sel === n} onClick={() => setSel(n)} onToggleVisible={() => {}} action={n === 'edges' ? undefined : <Pill size="sm" on={sel === n} icon="edit">edit</Pill>} />
            ))}
            <TreeNode icon="folder" label="desk lamp" meta="8 pts" dim onToggleVisible={() => {}} />
            <TreeNode icon="mask" label="monitor" meta="mask" visible={false} onToggleVisible={() => {}} />
          </div>
        </Demo>

        <Demo name="LibTile">
          <div className={s.tiles}>
            <LibTile icon="mesh" label="grid build" />
            <LibTile icon="line" label="trace" on />
            <LibTile icon="scan" label="scan" />
            <LibTile label="ember" swatch="linear-gradient(135deg, var(--ink), var(--control-3))" />
          </div>
        </Demo>

        <Demo name="EfxCard and ParamControls" note="controls drawn from a param schema">
          <EfxCard icon="line" name="trace" enabled onToggle={() => {}}>
            <ParamControls schema={SCHEMA} values={params} onChange={(k, val) => setParams((p) => ({ ...p, [k]: val }))} />
          </EfxCard>
          <EfxCard icon="mesh" name="grid build" enabled={false} onToggle={() => {}} />
        </Demo>

        <Demo name="Menu">
          <Menu
            trigger={({ toggle }) => (
              <Pill icon="chevronDown" onClick={toggle}>
                desk · zimacube reveal
              </Pill>
            )}
            items={[
              { key: 'c', caption: true, label: 'scenes' },
              { key: 'a', label: 'desk', on: true, meta: 'on the wall' },
              { key: 'b', label: 'shelf', meta: 'v12' },
              { key: 'n', label: 'new scene from photo', icon: 'image' },
              { key: 'd', label: 'delete', icon: 'trash', danger: true },
            ]}
          />
        </Demo>

        <Demo name="Glass and HintBar">
          <div className={s.media}>
            <div className={s.mediaBar}>
              <Glass>camera · what the phone sees</Glass>
              <Glass>error 0.8 px</Glass>
            </div>
            <div className={s.mediaHints}>
              <HintBar
                hints={[
                  { keys: '←↑↓→', text: '1 px' },
                  { keys: '⇧', text: '10 px' },
                  { keys: 'tab', text: 'next point' },
                ]}
              />
            </div>
          </div>
        </Demo>

        <Demo name="ChatMessage, Log, LogRow, AskBox" note="the agent panel">
          <ChatMessage me>map the zimacube: the three faces I can see.</ChatMessage>
          <Log>
            <LogRow state="ok" text="camera_snapshot" time="0.4s" />
            <LogRow state="ok" text="surface_create · top, left, right" time="0.2s" />
            <LogRow state="failed" text="alignment_error · no phone" time="0.1s" />
            <LogRow state="running" text="project_outline + camera_snapshot" time="…" />
          </Log>
          <ChatMessage>top, left and right are mapped with a shared corner.</ChatMessage>
          <AskBox placeholder="ask codex…" onSend={(t) => toast(`sent: ${t}`)} />
        </Demo>

        <Demo name="StepBar">
          <StepBar
            steps={[
              { label: 'stand', fraction: 1 },
              { label: 'patterns', fraction: 1 },
              { label: 'matching', fraction: 0.6 },
              { label: 'verify', fraction: 0 },
            ]}
          />
        </Demo>

        <Demo name="QrCode" note="dark on white whatever the theme">
          <div className={s.qr}>
            <QrCode text="projmap://connect?server=studio-mac.local:7400&code=K7Q2" size={140} label="pairing QR" />
          </div>
        </Demo>

        <Demo name="Dialog and Toast">
          <Row>
            <Pill onClick={() => setDialog(true)}>open a dialog</Pill>
            <Pill onClick={() => toast('Saved preset golden hour.')}>show a toast</Pill>
            <Pill onClick={() => toast('That code is wrong or expired.', { bad: true })}>show an error</Pill>
          </Row>
          {dialog && (
            <Dialog title="new scene from photo" width={520} onClose={() => setDialog(false)}>
              <span>Dialogs sit on a blurred scrim; Escape closes them.</span>
              <Row>
                <Pill ghost onClick={() => setDialog(false)}>
                  cancel
                </Pill>
                <Pill on size="lg" onClick={() => setDialog(false)}>
                  create scene
                </Pill>
              </Row>
            </Dialog>
          )}
        </Demo>

        <Demo name="EmptyState">
          <EmptyState>no objects yet. pick a drawing tool and click the corners on the stage.</EmptyState>
        </Demo>

        <Demo name="Icon" note={`${ICON_NAMES.length} line icons`}>
          <div className={s.icons}>
            {ICON_NAMES.map((n) => (
              <span key={n} className={s.icon} title={n}>
                <Icon name={n} size={18} />
                <i>{n}</i>
              </span>
            ))}
          </div>
        </Demo>
      </div>
    </main>
  )
}

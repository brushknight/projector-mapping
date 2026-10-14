import { useEffect, useMemo, useRef, useState } from 'react'
import { AskBox, Cap, ChatMessage, EmptyState, Log, LogRow, Menu, Pill, Row, Segmented, Switch } from '../../../../shared/components'
import { useChannel, useHubStatus } from '../../../../shared/lib/useHub'
import type { Envelope, Hub } from '../../../../shared/lib/ws'
import { draftApi, type Draft } from '../../../draft'
import { settingsApi, type AgentSettings } from '../../../settings'
import { agentApi } from '../../api'
import type { AgentEvent, AgentKind, AgentSession } from '../../types'
import s from './styles.module.css'

function mergeEvents(a: AgentEvent[], b: AgentEvent[]): AgentEvent[] {
  const m = new Map<number, AgentEvent>()
  for (const e of [...a, ...b]) m.set(e.seq, e)
  return [...m.values()].sort((x, y) => x.seq - y.seq)
}

/** The prompt as the chat shows it: sessions an MCP client started on its own have no prompt of their own. */
export function promptLabel(x: Pick<AgentSession, 'agent' | 'prompt'>): string {
  return !x.prompt || x.prompt === '(connected over MCP)' ? `${x.agent} over MCP` : x.prompt
}

/**
 * Which session the panel shows after a list reload: the one the user picked, else the newest. A session that started
 * after the shown one (for example Claude Code connecting over MCP) takes over unless the user picked one by hand.
 */
export function pickSession(list: AgentSession[], current: string | null, pinned: boolean): string | null {
  if (!list.length) return null
  if (current && pinned && list.some((x) => x.id === current)) return current
  return list[0].id
}

const POLL_MS = 3000

const fmtMs = (ms?: number | null) => (ms == null ? '' : ms < 1000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 1000).toFixed(1)}s`)

/**
 * The agent panel: pick Codex or Claude, send a prompt, follow the session log live (channel agent:{id}), and keep,
 * preview or discard the proposal it leaves in a draft. Permission toggles come from /api/v1/settings.
 */
export function AgentPanel({ hub, sceneId, onError, onNotice, previewDraftId, onPreviewDraft }: { hub: Hub; sceneId: string | null; onError: (m: string) => void; onNotice: (m: string) => void; previewDraftId: string | null; onPreviewDraft: (id: string | null) => void }) {
  const status = useHubStatus(hub)
  const [agent, setAgent] = useState<AgentKind>('codex')
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  /** true once the user picked a session in the menu; then new sessions do not take over */
  const pinned = useRef(false)
  /** drafts applied from this panel (the rest were applied by the agent, with "agent may apply") */
  const appliedHere = useRef(new Set<string>())
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const reload = () =>
    agentApi.list().then(
      (list) => {
        const mine = list.filter((x) => !sceneId || x.sceneId === sceneId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        setSessions(mine)
        setCurrentId((cur) => pickSession(mine, cur, pinned.current))
      },
      () => {},
    )

  useEffect(() => {
    setCurrentId(null)
    pinned.current = false
    setEvents([])
    void reload()
    // sessions an MCP client starts outside the editor (Claude Code, Codex) appear on their own
    const id = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  useEffect(() => {
    settingsApi.get().then(setSettings, () => setSettings(null))
  }, [])

  const session = sessions.find((x) => x.id === currentId) ?? null

  // the live log: snapshot (events array, or {session, events}) plus event/session messages
  const onMessage = (env: Envelope) => {
    if (env.t === 'event' || env.t === 'agent.event') setEvents((xs) => mergeEvents(xs, [env.d as AgentEvent]))
    if (env.t === 'session') {
      const ss = env.d as AgentSession
      setSessions((xs) => xs.map((x) => (x.id === ss.id ? ss : x)))
    }
  }
  const snap = useChannel<AgentEvent[] | { session?: AgentSession; events?: AgentEvent[] }>(hub, currentId ? `agent:${currentId}` : null, onMessage)
  useEffect(() => {
    const d = snap.doc
    if (!d) return
    if (Array.isArray(d)) setEvents((xs) => mergeEvents(xs, d))
    else {
      if (d.events) setEvents((xs) => mergeEvents(xs, d.events!))
      if (d.session) setSessions((xs) => xs.map((x) => (x.id === d.session!.id ? d.session! : x)))
    }
  }, [snap.doc])
  useEffect(() => {
    setEvents([])
    if (!currentId) return
    agentApi.events(currentId).then((ev) => setEvents((xs) => mergeEvents(xs, ev)), () => {})
  }, [currentId])

  const draft = useChannel<Draft>(hub, session?.draftId ? `draft:${session.draftId}` : null).doc
  // the session status also changes when its draft becomes a proposal
  useEffect(() => {
    if (draft?.status) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.status])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [events.length])

  const start = async (prompt: string) => {
    if (!sceneId) return onError('Open a scene first.')
    try {
      const ss = await agentApi.start(agent, prompt, sceneId)
      setSessions((xs) => [ss, ...xs.filter((x) => x.id !== ss.id)])
      setCurrentId(ss.id)
      pinned.current = false
      setEvents([])
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const setPerm = async (patch: Partial<AgentSettings>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    try {
      setSettings(await settingsApi.update(patch))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const lastTool = useMemo(() => [...events].reverse().find((e) => e.kind === 'tool'), [events])
  const running = session?.status === 'running'
  const proposal = draft && draft.status === 'proposed' ? draft : null
  const applied = draft && draft.status === 'applied' ? draft : null

  return (
    <div className={s.panel} data-testid="agent-panel">
      <div className={s.ph}>
        <Segmented<AgentKind>
          ariaLabel="agent"
          width={160}
          value={agent}
          onChange={setAgent}
          options={[
            { value: 'codex', label: 'codex' },
            { value: 'claude', label: 'claude' },
          ]}
        />
        <Cap>{status === 'open' ? 'mcp · connected' : 'offline'}</Cap>
      </div>
      {sessions.length > 1 && (
        <div className={s.sessions}>
          <Menu
            width={280}
            trigger={({ toggle }) => (
              <Pill size="sm" ghost icon="history" onClick={toggle}>
                {sessions.length} sessions
              </Pill>
            )}
            items={sessions.map((x) => ({ key: x.id, label: promptLabel(x), meta: `${x.agent} · ${x.status}`, on: x.id === currentId, onSelect: () => { pinned.current = true; setCurrentId(x.id) } }))}
          />
        </div>
      )}
      <div className={s.log} ref={logRef}>
        {!session && <EmptyState>ask {agent} to map, animate or tidy this scene. it works in a draft; you keep or discard what it proposes.</EmptyState>}
        {session && <ChatMessage me>{promptLabel(session)}</ChatMessage>}
        {session && (
          <Log>
            {events
              .filter((e) => e.kind === 'tool')
              .map((e) => (
                <LogRow key={e.seq} state={e.ok === false ? 'failed' : running && e === lastTool && !e.durationMs ? 'running' : 'ok'} text={e.text || e.tool} time={fmtMs(e.durationMs)} />
              ))}
            {running && <LogRow state="running" text="working" time="…" />}
          </Log>
        )}
        {events
          .filter((e) => e.kind === 'message')
          .map((e) => (
            <ChatMessage key={e.seq}>{e.text}</ChatMessage>
          ))}
        {events
          .filter((e) => e.kind === 'status')
          .slice(-1)
          .map((e) => (
            <span key={e.seq} className={s.status}>
              {e.text}
            </span>
          ))}
        {session && !running && session.status !== 'done' && <span className={s.status}>session {session.status}</span>}
        {proposal && (
          <div className={s.proposal} data-testid="proposal">
            <Cap bright>proposal</Cap>
            <span>{proposal.summary || `${proposal.ops.length} changes`}</span>
            <Row>
              <Pill size="sm" on onClick={() => (appliedHere.current.add(proposal.id), draftApi.apply(proposal.id)).then(() => { onPreviewDraft(null); onNotice('Applied the proposal.') }, (e) => onError(String(e.message ?? e)))}>
                apply
              </Pill>
              <Pill size="sm" on={previewDraftId === proposal.id} onClick={() => onPreviewDraft(previewDraftId === proposal.id ? null : proposal.id)}>
                {previewDraftId === proposal.id ? 'stop preview' : 'preview'}
              </Pill>
              <Pill size="sm" ghost onClick={() => draftApi.discard(proposal.id).then(() => { onPreviewDraft(null); onNotice('Discarded the proposal.') }, (e) => onError(String(e.message ?? e)))}>
                discard
              </Pill>
            </Row>
          </div>
        )}
        {applied && (
          <span className={s.status} data-testid="applied">
            {appliedHere.current.has(applied.id) ? 'applied' : `applied by ${session?.agent ?? 'the agent'}`}
            {applied.summary ? `: ${applied.summary}` : ''}
          </span>
        )}
        {running && (
          <Pill size="sm" ghost icon="stop" iconSize={12} onClick={() => session && agentApi.cancel(session.id).then(reload, (e) => onError(String(e.message ?? e)))}>
            stop {session?.agent}
          </Pill>
        )}
      </div>
      <div className={s.foot}>
        {settings && (
          <>
            <Row>
              <span>let {agent} project test outlines</span>
              <Switch checked={settings.agentMayPreview} onChange={(v) => setPerm({ agentMayPreview: v })} ariaLabel="allow projecting outlines" />
            </Row>
            <Row>
              <span>let {agent} go live</span>
              <Switch checked={settings.agentMayGoLive} onChange={(v) => setPerm({ agentMayGoLive: v })} ariaLabel="allow going live" />
            </Row>
            {settings.agentMayApply !== undefined && (
              <Row>
                <span>let {agent} apply its drafts</span>
                <Switch checked={!!settings.agentMayApply} onChange={(v) => setPerm({ agentMayApply: v })} ariaLabel="allow applying drafts" />
              </Row>
            )}
          </>
        )}
        <AskBox placeholder={`ask ${agent}…`} onSend={start} disabled={!sceneId} />
      </div>
    </div>
  )
}

export type AgentKind = 'codex' | 'claude'
export type AgentStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface AgentSession {
  id: string
  agent: AgentKind
  prompt: string
  status: AgentStatus
  sceneId: string
  draftId: string | null
  createdAt: string
}

export interface AgentEvent {
  seq: number
  kind: 'message' | 'tool' | 'status'
  tool?: string | null
  text: string
  durationMs?: number | null
  ok?: boolean | null
  ts: string
}

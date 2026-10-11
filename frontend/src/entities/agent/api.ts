import { http } from '../../shared/lib/http'
import type { AgentEvent, AgentKind, AgentSession } from './types'

export const agentApi = {
  list: () => http.get<AgentSession[]>('/api/v1/agents/sessions'),
  start: (agent: AgentKind, prompt: string, sceneId: string) => http.post<AgentSession>('/api/v1/agents/sessions', { agent, prompt, sceneId }),
  events: (id: string) => http.get<AgentEvent[]>(`/api/v1/agents/sessions/${id}/events`),
  cancel: (id: string) => http.post<unknown>(`/api/v1/agents/sessions/${id}/cancel`),
}

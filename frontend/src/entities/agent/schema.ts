import { bool, int, lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const agentSessionShape = obj({ id: str, agent: lit('codex', 'claude'), prompt: str, status: lit('running', 'done', 'failed', 'cancelled'), sceneId: str, draftId: nullable(str), createdAt: str })
export const agentEventShape = obj({ seq: int, kind: lit('message', 'tool', 'status'), tool: nullable(str), text: str, durationMs: nullable(num), ok: nullable(bool), ts: str })

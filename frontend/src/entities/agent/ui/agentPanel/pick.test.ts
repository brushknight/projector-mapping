import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../../types'
import { pickSession, promptLabel } from './index'

const s = (id: string, prompt = 'map it'): AgentSession => ({ id, agent: 'claude', prompt, status: 'running', sceneId: 'scn', draftId: 'drf', createdAt: '' })

describe('agent panel sessions', () => {
  it('follows the newest session unless the user picked one', () => {
    const list = [s('agt_new'), s('agt_old')]
    expect(pickSession(list, 'agt_old', false)).toBe('agt_new')
    expect(pickSession(list, 'agt_old', true)).toBe('agt_old')
    expect(pickSession(list, 'agt_gone', true)).toBe('agt_new')
    expect(pickSession([], null, false)).toBeNull()
  })

  it('names sessions an MCP client started on its own', () => {
    expect(promptLabel(s('a', '(connected over MCP)'))).toBe('claude over MCP')
    expect(promptLabel(s('a', 'dress the cube'))).toBe('dress the cube')
  })
})

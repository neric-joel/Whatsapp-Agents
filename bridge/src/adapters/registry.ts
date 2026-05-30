import type { AgentAdapter } from '@agentroom/shared'

import { ClaudeCodeAdapter } from './claude-code-adapter.js'
import { CodexCliAdapter } from './codex-cli-adapter.js'
import { MockAgentAdapter } from './mock-agent-adapter.js'
import { MyClaudeAdapter } from './myclaude-adapter.js'
import { RuFloAdapter } from './ruflo-adapter.js'

export function getAdapter(adapterType: string): AgentAdapter {
  switch (adapterType) {
    case 'mock':
      return new MockAgentAdapter()
    case 'claude-code':
    case 'subprocess':
      return new ClaudeCodeAdapter()
    case 'codex-cli':
      return new CodexCliAdapter()
    case 'myclaude':
      return new MyClaudeAdapter()
    case 'ruflo':
      return new RuFloAdapter()
    default:
      throw new Error(`Unknown adapter type: ${adapterType}`)
  }
}

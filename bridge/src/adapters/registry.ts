import type { AgentAdapter } from '@agentroom/shared'

import { ClaudeCodeAdapter } from './claude-code-adapter.js'
import { CliProfileAdapter } from './cli-profile-adapter.js'
import { CodexCliAdapter } from './codex-cli-adapter.js'
import { MockAgentAdapter } from './mock-agent-adapter.js'

export function getAdapter(adapterType: string): AgentAdapter {
  switch (adapterType) {
    case 'mock':
      return new MockAgentAdapter()
    case 'claude-code':
    case 'subprocess':
      return new ClaudeCodeAdapter()
    case 'codex-cli':
      return new CodexCliAdapter()
    // Any CLI connected via the Connections screen / config.json. The agent's
    // `provider` column holds the profile id the adapter resolves at run time.
    case 'cli':
      return new CliProfileAdapter()
    default:
      throw new Error(`Unknown adapter type: ${adapterType}`)
  }
}

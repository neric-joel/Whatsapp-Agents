import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { parseClaudeJsonLine } from './output-parsers.js'
import { buildAgentPrompt } from './prompt.js'
import { SubprocessAdapter } from './subprocess-adapter.js'

export class ClaudeCodeAdapter extends SubprocessAdapter {
  readonly name = 'claude-code'

  protected resolveCommand(): string {
    return process.env['CLAUDE_BIN'] ?? 'claude'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    // Static args only. The agent's system_prompt is attacker-influenced, so it
    // is delivered via stdin (buildStdin) — never as an argv flag.
    return ['--print', '--output-format', 'json']
  }

  protected envVarName(): string {
    return 'CLAUDE_BIN'
  }

  protected buildStdin(packet: ContextPacketV1): string {
    return buildAgentPrompt(packet)
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    return parseClaudeJsonLine(line) ?? super.parseStdoutLine(line)
  }
}

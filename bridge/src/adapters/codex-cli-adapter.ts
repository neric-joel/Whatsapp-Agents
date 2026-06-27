import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { parseCodexJsonLine } from './output-parsers.js'
import { buildAgentPrompt } from './prompt.js'
import { SubprocessAdapter } from './subprocess-adapter.js'

export class CodexCliAdapter extends SubprocessAdapter {
  readonly name = 'codex-cli'

  protected resolveCommand(): string {
    return process.env['CODEX_BIN'] ?? 'codex'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return ['exec', '--json', '-']
  }

  protected envVarName(): string {
    return 'CODEX_BIN'
  }

  protected buildStdin(packet: ContextPacketV1): string {
    return buildAgentPrompt(packet, {
      intro: `You are ${packet.agent.name}, a coding assistant in the room "${packet.room.name}".`,
      includeSystemPrompt: false,
    })
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    return parseCodexJsonLine(line) ?? super.parseStdoutLine(line)
  }
}

import { SubprocessAdapter } from './subprocess-adapter.js'
import type { AgentEvent, ContextPacketV1, SenderType } from '@agentroom/shared'

export class ClaudeCodeAdapter extends SubprocessAdapter {
  readonly name = 'claude-code'

  protected resolveCommand(): string {
    return process.env['CLAUDE_BIN'] ?? 'claude'
  }

  protected buildArgs(packet: ContextPacketV1): string[] {
    const args = ['--print', '--output-format', 'json']
    if (packet.agent.system_prompt) {
      args.push('--system-prompt', packet.agent.system_prompt)
    }
    return args
  }

  protected envVarName(): string { return 'CLAUDE_BIN' }

  protected buildStdin(packet: ContextPacketV1): string {
    const triggerMessage = packet.trigger_message
    const history = packet.recent_messages
      .filter((m) => m.id !== triggerMessage.id)
      .map((m) => `${this.senderLabel(m.sender_type)}: ${m.content}`)
      .join('\n')

    const sections = [
      `You are ${packet.agent.name}, an AI participant in the group chat room "${packet.room.name}".`,
    ]

    if (history) {
      sections.push(`Relevant recent context only. Use it as background, but prioritize the current message if there is any conflict:\n${history}`)
    }

    sections.push(`-----
CURRENT MESSAGE YOU MUST RESPOND TO:
${triggerMessage.content}
-----

Respond directly and specifically to the CURRENT MESSAGE above as ${packet.agent.name}.`)

    return sections.join('\n\n')
  }

  private senderLabel(senderType: SenderType): string {
    if (senderType === 'user') return 'User'
    if (senderType === 'system') return 'System'
    return 'Agent'
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    let obj: Record<string, unknown>

    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      return null
    }

    if (obj.is_error === true) {
      const message = typeof obj.result === 'string'
        ? obj.result
        : typeof obj.error === 'string'
          ? obj.error
          : typeof obj.message === 'string'
            ? obj.message
            : 'Claude returned an error.'
      return { type: 'error', run_id: '', message }
    }

    if (obj.type === 'result' && typeof obj.result === 'string') {
      return { type: 'visible_message', run_id: '', content: obj.result }
    }

    return super.parseStdoutLine(line)
  }
}

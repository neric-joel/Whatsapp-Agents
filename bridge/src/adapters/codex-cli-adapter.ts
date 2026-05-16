import { SubprocessAdapter } from './subprocess-adapter.js'
import type { AgentEvent, ContextPacketV1, SenderType } from '@agentroom/shared'

export class CodexCliAdapter extends SubprocessAdapter {
  readonly name = 'codex-cli'

  protected resolveCommand(): string {
    return process.env['CODEX_BIN'] ?? 'codex'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return ['exec', '--json', '-']
  }

  protected envVarName(): string { return 'CODEX_BIN' }

  protected buildStdin(packet: ContextPacketV1): string {
    const triggerIndex = this.lastUserMessageIndex(packet.recent_messages)
    const triggerMessage = triggerIndex >= 0
      ? packet.recent_messages[triggerIndex]
      : packet.trigger_message
    const priorMessages = triggerIndex >= 0
      ? packet.recent_messages.slice(0, triggerIndex)
      : packet.recent_messages
    const history = priorMessages
      .map((message) => `${this.senderLabel(message.sender_type)}: ${message.content}`)
      .join('\n')

    const sections = [
      `You are ${packet.agent.name}, a coding assistant in the room "${packet.room.name}".`,
    ]

    if (history) {
      sections.push(`Conversation so far:\n${history}`)
    }

    sections.push(`-----
CURRENT MESSAGE YOU MUST RESPOND TO:
${triggerMessage.content}
-----

Respond directly and specifically to the CURRENT MESSAGE above as ${packet.agent.name}.`)

    return sections.join('\n\n')
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    let obj: Record<string, unknown>

    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      return { type: 'visible_message', run_id: '', content: line }
    }

    const content = this.extractMessageContent(obj)
    if (content) {
      return { type: 'visible_message', run_id: '', content }
    }

    return null
  }

  private senderLabel(senderType: SenderType): string {
    if (senderType === 'user') return 'User'
    if (senderType === 'system') return 'System'
    return 'Agent'
  }

  private lastUserMessageIndex(messages: ContextPacketV1['recent_messages']): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.sender_type === 'user') return index
    }

    return -1
  }

  private extractMessageContent(event: Record<string, unknown>): string | null {
    if (this.isMessageEvent(event)) {
      return this.contentFromRecord(event)
    }

    const item = event.item
    if (this.isRecord(item) && this.isMessageEvent(item)) {
      return this.contentFromRecord(item)
    }

    return null
  }

  private isMessageEvent(event: Record<string, unknown>): boolean {
    return event.type === 'message' || event.type === 'agent_message'
  }

  private contentFromRecord(record: Record<string, unknown>): string | null {
    if (typeof record.content === 'string') return record.content
    if (typeof record.text === 'string') return record.text
    return null
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

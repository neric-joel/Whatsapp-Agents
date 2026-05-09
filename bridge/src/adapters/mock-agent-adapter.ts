import type { AgentAdapter, ContextPacketV1, AgentEvent } from '@agentroom/shared'

export class MockAgentAdapter implements AgentAdapter {
  async *run(packet: ContextPacketV1, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const { slug } = packet.agent
    const brief = packet.trigger_message.content.slice(0, 80)

    let content: string
    if (slug.includes('claude') || slug.includes('thinker')) {
      content = `I think we should ${brief}`
    } else if (slug.includes('codex') || slug.includes('builder')) {
      content = `I can implement ${brief}`
    } else {
      content = `I see a potential risk with ${brief}`
    }

    await new Promise<void>((r) => setTimeout(r, 500))
    if (signal.aborted) throw new Error('aborted')

    yield {
      type: 'partial_content',
      run_id: packet.run_id,
      delta: content,
    }

    if (signal.aborted) throw new Error('aborted')

    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: {
        schema_version: 1,
        run_id: packet.run_id,
        content,
        content_type: 'text',
      },
    }
  }
}

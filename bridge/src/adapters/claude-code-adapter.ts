import { SubprocessAdapter } from './subprocess-adapter.js'
import type { ContextPacketV1 } from '@agentroom/shared'

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
}

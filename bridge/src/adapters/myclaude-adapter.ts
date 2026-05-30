import type { ContextPacketV1 } from '@agentroom/shared'

import { SubprocessAdapter } from './subprocess-adapter.js'

export class MyClaudeAdapter extends SubprocessAdapter {
  readonly name = 'myclaude'

  protected resolveCommand(): string {
    return process.env['MYCLAUDE_BIN'] ?? 'myclaude'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return []
  }

  protected envVarName(): string {
    return 'MYCLAUDE_BIN'
  }
}

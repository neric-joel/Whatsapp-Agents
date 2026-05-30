import type { ContextPacketV1 } from '@agentroom/shared'

import { SubprocessAdapter } from './subprocess-adapter.js'

export class RuFloAdapter extends SubprocessAdapter {
  readonly name = 'ruflo'

  protected resolveCommand(): string {
    return process.env['RUFLO_BIN'] ?? 'ruflo'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return []
  }

  protected envVarName(): string {
    return 'RUFLO_BIN'
  }
}

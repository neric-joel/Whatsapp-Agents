import { SubprocessAdapter } from './subprocess-adapter.js'
import type { ContextPacketV1 } from '@agentroom/shared'

export class RuFloAdapter extends SubprocessAdapter {
  readonly name = 'ruflo'

  protected resolveCommand(): string {
    return process.env['RUFLO_BIN'] ?? 'ruflo'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return []
  }

  protected envVarName(): string { return 'RUFLO_BIN' }
}

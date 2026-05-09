import { SubprocessAdapter } from './subprocess-adapter.js'
import type { ContextPacketV1 } from '@agentroom/shared'

export class CodexCliAdapter extends SubprocessAdapter {
  readonly name = 'codex-cli'

  protected resolveCommand(): string {
    return process.env['CODEX_BIN'] ?? 'codex'
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return ['--json']
  }

  protected envVarName(): string { return 'CODEX_BIN' }
}

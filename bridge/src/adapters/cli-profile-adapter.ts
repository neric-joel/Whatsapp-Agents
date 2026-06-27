import { type CliProfile, getProfile } from '@agentroom/db'
import type { AgentEvent, ContextPacketV1, RuntimeCredential } from '@agentroom/shared'

import { parseClaudeJsonLine, parseCodexJsonLine } from './output-parsers.js'
import { buildAgentPrompt } from './prompt.js'
import { SubprocessAdapter } from './subprocess-adapter.js'

/**
 * Profile-driven adapter for any connected CLI (Connections screen / config.json).
 *
 * The agent row links to its profile through the `provider` column, which holds the
 * profile id. At run time we look the profile up, then spawn its `bin` with its
 * `args` (via the hardened SubprocessAdapter: shell:false, PATH-resolved binary,
 * allowlisted env, output cap, timeout, kill-tree). Auth is the CLI's job — the
 * optional per-profile `env` is the only extra a user can opt into.
 */
export class CliProfileAdapter extends SubprocessAdapter {
  readonly name = 'cli'
  private profile: CliProfile | null = null

  override async *run(
    packet: ContextPacketV1,
    signal: AbortSignal,
    runtime?: RuntimeCredential,
  ): AsyncGenerator<AgentEvent> {
    const profileId = packet.agent.provider
    const profile = profileId ? getProfile(profileId) : undefined
    if (!profile) {
      yield {
        type: 'error',
        run_id: packet.run_id,
        message: `No connected CLI found for "${packet.agent.name}". Open Connections and re-add it.`,
      }
      return
    }
    if (profile.enabled === false) {
      yield {
        type: 'error',
        run_id: packet.run_id,
        message: `The CLI "${profile.name}" is turned off in Connections. Enable it to let this agent reply.`,
      }
      return
    }
    this.profile = profile
    yield* super.run(packet, signal, runtime)
  }

  protected resolveCommand(): string {
    return this.profile!.bin
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return [...this.profile!.args]
  }

  protected envVarName(): string {
    return `the binary path for "${this.profile?.name ?? 'this CLI'}" (edit it in Connections)`
  }

  protected extraChildEnv(): Record<string, string> {
    return this.profile?.env ?? {}
  }

  protected buildStdin(packet: ContextPacketV1): string {
    // codex omits the persona system_prompt (matches the dedicated CodexCliAdapter);
    // every other CLI gets it so a connected agent honors the role set in the room.
    const includeSystemPrompt = this.profile!.kind !== 'codex-cli'
    return buildAgentPrompt(packet, { includeSystemPrompt })
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    switch (this.profile?.kind) {
      case 'claude-code':
        return parseClaudeJsonLine(line) ?? super.parseStdoutLine(line)
      case 'codex-cli':
        return parseCodexJsonLine(line) ?? super.parseStdoutLine(line)
      default:
        return super.parseStdoutLine(line)
    }
  }
}

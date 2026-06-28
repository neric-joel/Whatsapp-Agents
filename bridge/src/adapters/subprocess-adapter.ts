import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import type {
  AgentAdapter,
  AgentEvent,
  AgentResponseV1,
  ContextPacketV1,
  RuntimeCredential,
} from '@agentroom/shared'

import {
  BinaryNotFoundError,
  buildChildEnv,
  resolveBinaryPath,
  resolveSpawnTarget,
} from '../lib/subprocess-security.js'

export abstract class SubprocessAdapter implements AgentAdapter {
  abstract readonly name: string

  protected abstract resolveCommand(): string
  protected abstract buildArgs(packet: ContextPacketV1): string[]
  protected abstract envVarName(): string
  protected getTimeoutMs(): number {
    return 120_000
  }
  /** Max combined stdout+stderr bytes before the child is killed (DoS/OOM guard). */
  protected getMaxOutputBytes(): number {
    return 10 * 1024 * 1024
  }

  protected buildStdin(packet: ContextPacketV1): string {
    return JSON.stringify(packet)
  }

  /**
   * Extra environment variables to set on the child, merged AFTER the secret-strip
   * allowlist. Default none. A profile-driven adapter overrides this to apply the
   * optional per-profile `env` a user explicitly opted into (their own machine,
   * their own config) — process.env secrets are still never forwarded.
   */
  protected extraChildEnv(): Record<string, string> {
    return {}
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>

      // Agent-emitted control envelopes (Phase 9 memory, Phase 10 hand-off). The
      // run worker validates these downstream (zod) and treats memory/roster as
      // DATA — emitting them here is what wires those features end-to-end. run_id
      // is stamped by withRunId().
      if (obj.type === 'memory_op' && typeof obj.content === 'string') {
        return {
          type: 'memory_op',
          run_id: '',
          op: obj.op,
          scope: obj.scope,
          kind: obj.kind,
          ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
          content: obj.content,
          ...(typeof obj.target_id === 'string' ? { target_id: obj.target_id } : {}),
        } as AgentEvent
      }
      if (obj.type === 'handoff_requested' && typeof obj.to_agent_slug === 'string') {
        return {
          type: 'handoff_requested',
          run_id: '',
          to_agent_slug: obj.to_agent_slug,
          reason: typeof obj.reason === 'string' ? obj.reason : '',
          ...(typeof obj.payload === 'string' ? { payload: obj.payload } : {}),
        } as AgentEvent
      }

      if (
        obj.schema_version === 1 &&
        typeof obj.run_id === 'string' &&
        typeof obj.content === 'string'
      ) {
        const response = obj as unknown as AgentResponseV1
        return { type: 'final_response', run_id: response.run_id, response }
      }
    } catch {
      /* not valid JSON */
    }

    return null
  }

  async *run(
    packet: ContextPacketV1,
    signal: AbortSignal,
    runtime?: RuntimeCredential,
  ): AsyncGenerator<AgentEvent> {
    const args = this.buildArgs(packet)

    // Resolve the binary to an absolute path from a trusted source (the *_BIN
    // env var or PATH) before spawning. Never spawn agent-controlled strings.
    let target: { command: string; args: string[] }
    try {
      const binPath = resolveBinaryPath(this.resolveCommand())
      target = resolveSpawnTarget(binPath, args)
    } catch (err) {
      if (err instanceof BinaryNotFoundError) {
        yield {
          type: 'error',
          run_id: packet.run_id,
          message: `Adapter '${this.name}' binary not found. Set ${this.envVarName()} env var.`,
        }
        return
      }
      throw err
    }

    const stdoutLines: string[] = []
    const stdoutEvents: AgentEvent[] = []
    const stderrLines: string[] = []
    let exitCode: number | null = null
    let spawnError: Error | null = null

    let exitResolve!: () => void
    const exitPromise = new Promise<void>((r) => {
      exitResolve = r
    })
    let forceExitResolve!: () => void
    const forceExitPromise = new Promise<void>((r) => {
      forceExitResolve = r
    })

    // BYO credential (ADR-0010): inject the resolved key into THIS child's one env var
    // (after the strip/allowlist). The decrypted secret arrives out-of-band via `runtime`
    // — never in the packet/stdin, argv, or logs. base_url (non-secret) is set alongside.
    const childEnv = runtime
      ? buildChildEnv(process.env, { inject: { name: runtime.envVarName, value: runtime.secret } })
      : buildChildEnv()
    if (runtime?.baseUrl && runtime.baseUrlEnvName) {
      childEnv[runtime.baseUrlEnvName] = runtime.baseUrl
    }
    // Per-profile env the user explicitly configured (BYO CLI). Applied last so it wins
    // over the base allowlist for exactly the vars the user opted into. This is also last
    // vs the BYO-credential inject above (#65): a same-named per-profile var would override
    // the injected credential — intentional, and harmless today because CLI-profile agents
    // (the only source of extraChildEnv) carry no injected credential, while credential-backed
    // adapters use the empty base extraChildEnv().
    for (const [k, v] of Object.entries(this.extraChildEnv())) childEnv[k] = v

    // SECURITY (issue #67): no user-controlled `cwd` is set — the child inherits the
    // bridge's working directory. A session's `working_dir` is NOT wired here yet; if it
    // ever is, it MUST first pass `validateWorkingDir` from @agentroom/db (realpath +
    // allow-root, rejects UNC/traversal/symlink-escape) and ONLY the returned canonical
    // path may be used as `cwd`. Never pass a raw stored/user path to spawn().
    const child = spawn(target.command, target.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // never spawn through a shell — no command-injection surface
      env: childEnv, // allowlisted env — process.env secrets stripped; only the resolved BYO var injected
      windowsHide: true,
      // On POSIX, make the child its own process-group leader so a force-kill can
      // signal the WHOLE group (`process.kill(-pid)`) and reap grandchildren — a bare
      // `process.kill(pid)` would orphan them. Windows uses `taskkill /T` instead, and
      // `detached` there would spawn a stray console window, so keep it POSIX-only.
      detached: process.platform !== 'win32',
    })

    // SIGTERM → 2s grace → force-kill. Some CLIs ignore termination, so
    // forceExitPromise prevents a stuck run. Declared before output listeners so
    // the output-cap guard can call it.
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let forceExitTimer: ReturnType<typeof setTimeout> | null = null
    let killed = false
    const kill = () => {
      if (killed) return
      killed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        this.forceKillProcessTree(child.pid)
        forceExitTimer = setTimeout(() => {
          forceExitResolve()
        }, 1_000)
      }, 2_000)
    }

    // Output cap: kill the child if combined stdout+stderr exceeds the limit.
    const maxOutputBytes = this.getMaxOutputBytes()
    let outputBytes = 0
    let outputExceeded = false
    const countBytes = (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (maxOutputBytes > 0 && outputBytes > maxOutputBytes && !outputExceeded) {
        outputExceeded = true
        kill()
      }
    }
    child.stdout!.on('data', countBytes)
    child.stderr!.on('data', countBytes)

    // Swallow stdin errors (EPIPE when child fails to start)
    child.stdin!.on('error', () => {
      /* intentional noop */
    })
    child.stdin!.write(this.buildStdin(packet), 'utf8', () => child.stdin!.end())

    createInterface({ input: child.stdout! }).on('line', (line) => {
      stdoutLines.push(line)
      const event = this.parseStdoutLine(line)
      if (event) stdoutEvents.push(this.withRunId(event, packet.run_id))
    })
    createInterface({ input: child.stderr! }).on('line', (line) => stderrLines.push(line))

    // exitResolve is called only from these two events — ensures we wait for actual process close
    child.on('close', (code) => {
      exitCode = code
      exitResolve()
    })
    child.on('error', (err) => {
      spawnError = err
      exitResolve()
    })

    signal.addEventListener('abort', kill, { once: true })

    let timedOut = false
    const timeoutMs = this.getTimeoutMs()
    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            kill()
          }, timeoutMs)
        : null

    // Wait for process exit, but do not let a killed subprocess keep the run alive forever.
    await Promise.race([exitPromise, forceExitPromise])

    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (killTimer) clearTimeout(killTimer)
    if (forceExitTimer) clearTimeout(forceExitTimer)
    signal.removeEventListener('abort', kill)

    if (spawnError) {
      const e = spawnError as Error & { code?: string }
      const msg =
        e.code === 'ENOENT'
          ? `Adapter '${this.name}' binary not found. Set ${this.envVarName()} env var.`
          : e.message
      yield { type: 'error', run_id: packet.run_id, message: msg }
      return
    }

    if (outputExceeded) {
      yield {
        type: 'error',
        run_id: packet.run_id,
        message: `Adapter '${this.name}' exceeded the ${maxOutputBytes}-byte output limit and was terminated.`,
      }
      return
    }

    if (signal.aborted) {
      yield { type: 'error', run_id: packet.run_id, message: 'Run was cancelled.' }
      return
    }

    if (timedOut) {
      yield {
        type: 'error',
        run_id: packet.run_id,
        message: `Adapter '${this.name}' timed out after ${timeoutMs}ms.`,
      }
      return
    }

    const rawOutput = stdoutLines.join('\n').trim()

    let finalResponseSeen = false
    const visibleMessages: string[] = []

    for (const event of stdoutEvents) {
      yield event

      if (event.type === 'final_response') finalResponseSeen = true
      if (event.type === 'visible_message') visibleMessages.push(event.content)
      if (event.type === 'error') return
    }

    if (exitCode !== null && exitCode !== 0 && !finalResponseSeen) {
      const stderr = stderrLines.join('\n').trim()
      const detail = stderr || rawOutput || '(no output)'
      yield {
        type: 'error',
        run_id: packet.run_id,
        message: `Process exited with code ${exitCode}. Output: ${detail}`,
      }
      return
    }

    if (!finalResponseSeen && visibleMessages.length > 0) {
      const content = visibleMessages.join('\n')
      yield {
        type: 'final_response',
        run_id: packet.run_id,
        response: { schema_version: 1, run_id: packet.run_id, content, content_type: 'text' },
      }
    } else if (!finalResponseSeen) {
      const content = rawOutput || '(no output)'
      yield { type: 'visible_message', run_id: packet.run_id, content }
      yield {
        type: 'final_response',
        run_id: packet.run_id,
        response: { schema_version: 1, run_id: packet.run_id, content, content_type: 'text' },
      }
    }
  }

  private withRunId(event: AgentEvent, runId: string): AgentEvent {
    if (event.run_id) return event

    switch (event.type) {
      case 'final_response':
        return {
          ...event,
          run_id: runId,
          response: { ...event.response, run_id: event.response.run_id || runId },
        }
      case 'partial_content':
      case 'error':
      case 'tool_call_requested':
      case 'visible_message':
      case 'memory_op':
      case 'handoff_requested':
        return { ...event, run_id: runId }
    }
  }

  private forceKillProcessTree(pid: number | undefined): void {
    if (!pid) return

    if (process.platform === 'win32' && pid) {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('error', () => {
        /* best effort */
      })
      return
    }

    // POSIX: the child was spawned `detached`, so it leads its own process group
    // whose id == pid. Signal the NEGATIVE pid to SIGKILL the entire group —
    // children and grandchildren — not just the direct child (which would orphan
    // the subtree). Fall back to the direct pid if the group kill fails.
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          /* best effort */
        }
      }
    }
  }
}

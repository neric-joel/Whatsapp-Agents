import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentAdapter, AgentEvent, AgentResponseV1, ContextPacketV1 } from '@agentroom/shared'

export abstract class SubprocessAdapter implements AgentAdapter {
  abstract readonly name: string

  protected abstract resolveCommand(): string
  protected abstract buildArgs(packet: ContextPacketV1): string[]
  protected abstract envVarName(): string
  protected getTimeoutMs(): number { return 120_000 }

  protected buildStdin(packet: ContextPacketV1): string {
    return JSON.stringify(packet)
  }

  protected parseStdoutLine(line: string): AgentEvent | null {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (obj.schema_version === 1 && typeof obj.run_id === 'string' && typeof obj.content === 'string') {
        const response = obj as unknown as AgentResponseV1
        return { type: 'final_response', run_id: response.run_id, response }
      }
    } catch { /* not valid JSON */ }

    return null
  }

  async *run(packet: ContextPacketV1, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const command = this.resolveCommand()
    const args = this.buildArgs(packet)

    const stdoutLines: string[] = []
    const stdoutEvents: AgentEvent[] = []
    const stderrLines: string[] = []
    let exitCode: number | null = null
    let spawnError: Error | null = null

    let exitResolve!: () => void
    const exitPromise = new Promise<void>((r) => { exitResolve = r })

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    // Swallow stdin errors (EPIPE when child fails to start)
    child.stdin!.on('error', () => { /* intentional noop */ })
    child.stdin!.write(this.buildStdin(packet), 'utf8', () => child.stdin!.end())

    createInterface({ input: child.stdout! }).on('line', (line) => {
      stdoutLines.push(line)
      const event = this.parseStdoutLine(line)
      if (event) stdoutEvents.push(this.withRunId(event, packet.run_id))
    })
    createInterface({ input: child.stderr! }).on('line', (line) => stderrLines.push(line))

    // exitResolve is called only from these two events — ensures we wait for actual process close
    child.on('close', (code) => { exitCode = code; exitResolve() })
    child.on('error', (err) => { spawnError = err; exitResolve() })

    // SIGTERM → 2s grace → SIGKILL; does NOT resolve exitPromise (let 'close' do it)
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const kill = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => { child.kill('SIGKILL') }, 2_000)
    }
    signal.addEventListener('abort', kill, { once: true })

    let timedOut = false
    const timeoutMs = this.getTimeoutMs()
    const timeoutHandle = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; kill() }, timeoutMs)
      : null

    // Wait for process to actually exit (no heartbeat — liveness is the daemon's job)
    await exitPromise

    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (killTimer) clearTimeout(killTimer)
    signal.removeEventListener('abort', kill)

    if (spawnError) {
      const e = spawnError as (Error & { code?: string })
      const msg = e.code === 'ENOENT'
        ? `Adapter '${this.name}' binary not found. Set ${this.envVarName()} env var.`
        : e.message
      yield { type: 'error', run_id: packet.run_id, message: msg }
      return
    }

    if (signal.aborted) {
      yield { type: 'error', run_id: packet.run_id, message: 'Run was cancelled.' }
      return
    }

    if (timedOut) {
      yield { type: 'error', run_id: packet.run_id, message: `Adapter '${this.name}' timed out after ${timeoutMs}ms.` }
      return
    }

    const rawOutput = stdoutLines.join('\n').trim()

    if (exitCode !== null && exitCode !== 0) {
      const stderr = stderrLines.join('\n').trim()
      yield {
        type: 'error', run_id: packet.run_id,
        message: `Process exited with code ${exitCode}. Stderr: ${stderr || '(empty)'}`,
      }
      return
    }

    let finalResponseSeen = false
    const visibleMessages: string[] = []

    for (const event of stdoutEvents) {
      yield event

      if (event.type === 'final_response') finalResponseSeen = true
      if (event.type === 'visible_message') visibleMessages.push(event.content)
      if (event.type === 'error') return
    }

    if (!finalResponseSeen && visibleMessages.length > 0) {
      const content = visibleMessages.join('\n')
      yield {
        type: 'final_response', run_id: packet.run_id,
        response: { schema_version: 1, run_id: packet.run_id, content, content_type: 'text' },
      }
    } else if (!finalResponseSeen) {
      const content = rawOutput || '(no output)'
      yield { type: 'visible_message', run_id: packet.run_id, content }
      yield {
        type: 'final_response', run_id: packet.run_id,
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
        return { ...event, run_id: runId }
    }
  }
}

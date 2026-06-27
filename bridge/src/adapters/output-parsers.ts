/**
 * Stdout line parsers for the agent CLIs, shared by the dedicated adapters
 * (ClaudeCodeAdapter / CodexCliAdapter) and the profile-driven CliProfileAdapter.
 *
 * Each returns a single AgentEvent for a line it recognizes, or null to defer to
 * the base SubprocessAdapter parser (which handles the AgentResponseV1 envelope and
 * the memory_op / handoff_requested control envelopes, and ultimately the plain-text
 * fallback). run_id is stamped to '' here and filled in by the base adapter.
 */
import type { AgentEvent } from '@agentroom/shared'

function asRecord(line: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(line) as unknown
    return obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Parse a line of `claude --print --output-format json`. Surfaces the `result`
 * string as the visible reply and `is_error` as an error event.
 */
export function parseClaudeJsonLine(line: string): AgentEvent | null {
  const obj = asRecord(line)
  if (!obj) return null

  if (obj.is_error === true) {
    const message =
      typeof obj.result === 'string'
        ? obj.result
        : typeof obj.error === 'string'
          ? obj.error
          : typeof obj.message === 'string'
            ? obj.message
            : 'Claude returned an error.'
    return { type: 'error', run_id: '', message }
  }

  if (obj.type === 'result' && typeof obj.result === 'string') {
    return { type: 'visible_message', run_id: '', content: obj.result }
  }

  return null
}

/**
 * Parse a line of `codex exec --json`. Extracts message/agent_message content
 * (top-level or nested under `item`). Non-JSON noise lines return null and are
 * dropped (a non-JSON line is process noise, not reply content).
 */
export function parseCodexJsonLine(line: string): AgentEvent | null {
  const obj = asRecord(line)
  if (!obj) return null

  const content = extractCodexContent(obj)
  if (content) return { type: 'visible_message', run_id: '', content }
  return null
}

function extractCodexContent(event: Record<string, unknown>): string | null {
  if (isCodexMessage(event)) return contentFromRecord(event)
  const item = event.item
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const rec = item as Record<string, unknown>
    if (isCodexMessage(rec)) return contentFromRecord(rec)
  }
  return null
}

function isCodexMessage(event: Record<string, unknown>): boolean {
  return event.type === 'message' || event.type === 'agent_message'
}

function contentFromRecord(record: Record<string, unknown>): string | null {
  if (typeof record.content === 'string') return record.content
  if (typeof record.text === 'string') return record.text
  return null
}

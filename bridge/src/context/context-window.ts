export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 6
export const DEFAULT_CONTEXT_MESSAGE_MAX_CHARS = 1200
// ADR-0011: a discussion run loads the whole thread (plan + every peer's per-phase reply), so it
// needs a larger window than the rolling default. Bounded so it can never blow up the prompt.
export const DEFAULT_DISCUSSION_CONTEXT_LIMIT = 24

export function readContextMessageLimit(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(env.AGENTROOM_CONTEXT_MESSAGE_LIMIT, DEFAULT_CONTEXT_MESSAGE_LIMIT, 0, 20)
}

export function readDiscussionContextLimit(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(
    env.AGENTROOM_DISCUSSION_CONTEXT_LIMIT,
    DEFAULT_DISCUSSION_CONTEXT_LIMIT,
    4,
    60,
  )
}

export function readContextMessageMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(
    env.AGENTROOM_CONTEXT_MESSAGE_MAX_CHARS,
    DEFAULT_CONTEXT_MESSAGE_MAX_CHARS,
    200,
    8000,
  )
}

export function trimContextContent(
  content: string,
  maxChars = DEFAULT_CONTEXT_MESSAGE_MAX_CHARS,
): string {
  if (content.length <= maxChars) return content

  const omitted = content.length - maxChars
  return `${content.slice(0, maxChars).trimEnd()}\n[...truncated ${omitted} chars]`
}

export function trimContextMessages<T extends { content: string }>(
  messages: T[],
  maxChars = DEFAULT_CONTEXT_MESSAGE_MAX_CHARS,
): T[] {
  return messages.map((message) => ({
    ...message,
    content: trimContextContent(message.content, maxChars),
  }))
}

function readBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

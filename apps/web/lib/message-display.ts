import {
  buildDiscussionStagePrompt,
  type DiscussCommand,
  type DiscussionPhase,
} from '@agentroom/shared'

const DISCUSSION_PHASES = new Set<DiscussionPhase>([
  'plan',
  'execute',
  'integrate',
  'dissent',
  'converge',
  'assign',
  'argue',
  'rebut',
  'adjudicate',
  'individual',
  'critique',
  'consensus',
])

const EDITED_EPSILON_MS = 1000

/**
 * True when updated_at has moved far enough past created_at to represent a real
 * edit, not timestamp jitter or an immediate server metadata finalization.
 */
export function hasMeaningfulUpdate(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): boolean {
  if (!createdAt || !updatedAt) return false
  const createdTime = Date.parse(createdAt)
  const updatedTime = Date.parse(updatedAt)
  if (!Number.isFinite(createdTime) || !Number.isFinite(updatedTime)) return false
  return updatedTime - createdTime > EDITED_EPSILON_MS
}

function serverBuiltDiscussionPrompt(disc: Record<string, unknown>): string | null {
  if (
    (disc.command !== 'discuss' && disc.command !== 'debate') ||
    typeof disc.phase !== 'string' ||
    !DISCUSSION_PHASES.has(disc.phase as DiscussionPhase) ||
    typeof disc.original_prompt !== 'string' ||
    disc.original_prompt.length === 0
  ) {
    return null
  }

  return buildDiscussionStagePrompt(
    disc.command as DiscussCommand,
    disc.phase as DiscussionPhase,
    disc.original_prompt,
  )
}

/**
 * What the timeline should show for a message, as opposed to what is stored.
 *
 * A /discuss or /debate kickoff stores the coordinator phase prompt as the user
 * message content so agents can be triggered from the DB. When that stored
 * prompt is still intact, show the human's original command instead. Once the
 * stored content diverges from the server-built prompt, keep the edited content.
 */
export function userVisibleContent(
  content: string,
  senderType: string,
  metadata: Record<string, unknown> | null | undefined,
  timestamps?: { createdAt?: string | null; updatedAt?: string | null },
): string {
  if (senderType !== 'user' || !metadata) return content
  const d = metadata['discussion']
  if (!d || typeof d !== 'object' || Array.isArray(d)) return content
  const disc = d as Record<string, unknown>
  if (disc.enabled !== true) return content

  const serverPrompt = serverBuiltDiscussionPrompt(disc)
  if (serverPrompt) {
    if (content !== serverPrompt) return content
  } else if (hasMeaningfulUpdate(timestamps?.createdAt, timestamps?.updatedAt)) {
    return content
  }

  if (typeof disc.original_input === 'string' && disc.original_input.length > 0) {
    return disc.original_input
  }

  if (
    typeof disc.command === 'string' &&
    disc.command.length > 0 &&
    typeof disc.original_prompt === 'string' &&
    disc.original_prompt.length > 0
  ) {
    return `/${disc.command} ${disc.original_prompt}`
  }

  return content
}

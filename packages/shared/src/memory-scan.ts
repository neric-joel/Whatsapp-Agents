import { redact } from './redact.js'

/**
 * Phase 9 memory-injection scanning (the Hermes "scan memory entries" requirement).
 * Lives in shared so BOTH the bridge (agent-emitted memory) and the web API
 * (user `/remember`) scan + sanitize identically before anything is persisted.
 *
 * Stored memory is DATA, never instructions. This is defense-in-depth on top of
 * the structural guarantee that recall renders memory as quoted, non-instruction
 * text:
 *   - `flagged`   — the content contains a known prompt-injection pattern, so the
 *                   row is marked and rendered with an extra "treat as data" warning.
 *   - `sanitized` — chat-template control tokens (no legitimate place in a memory
 *                   note) are stripped and secrets redacted before it is persisted.
 *
 * Scanning never *rejects* a write — it labels + neutralizes — because a note
 * legitimately quoting "the user said 'ignore previous steps'" is valid data.
 * The security property is that no stored text can change agent behavior.
 */

export interface MemoryScanResult {
  sanitized: string
  flagged: boolean
  matchedPatterns: string[]
}

/** Instruction-injection patterns. Targeted to avoid flagging ordinary prose. */
const INJECTION_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'ignore-previous',
    pattern:
      /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(?:instruction|message|context|prompt|rule|direction)/i,
  },
  { name: 'system-prompt-ref', pattern: /\bsystem\s*(?:prompt|message|instruction)/i },
  { name: 'you-are-now', pattern: /\byou\s+(?:are|must|will|shall)\s+now\b/i },
  {
    name: 'new-instructions',
    pattern: /\bnew\s+(?:instructions|rules|directives|system\s*prompt|persona)\b/i,
  },
  {
    name: 'override-instructions',
    pattern: /\boverride\b[^.\n]{0,30}\b(?:instruction|prompt|rule|system|persona|policy)/i,
  },
  {
    name: 'approve-all-tools',
    pattern:
      /\b(?:approve|allow|auto[-\s]?approve|enable)\b[^.\n]{0,20}\b(?:all|any|every)\b[^.\n]{0,20}\btool/i,
  },
  {
    name: 'grant-privilege',
    pattern:
      /\b(?:grant|give|enable|escalate)\b[^.\n]{0,20}\b(?:admin|root|full|elevated|all)\b[^.\n]{0,20}\b(?:access|permission|privilege|right)/i,
  },
  { name: 'role-marker', pattern: /^\s*(?:system|assistant|developer)\s*:/im },
  {
    name: 'chat-template-token',
    pattern: /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>/i,
  },
  {
    name: 'jailbreak',
    pattern: /\b(?:jailbreak|do\s+anything\s+now|DAN\s+mode|developer\s+mode\s+enabled)\b/i,
  },
]

/** Control tokens stripped from stored content — never legitimate in a note. */
const CONTROL_TOKEN_PATTERN =
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?s>/gi

export function scanMemoryContent(rawContent: string): MemoryScanResult {
  const content = rawContent.trim()
  const matchedPatterns: string[] = []
  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(content)) matchedPatterns.push(name)
  }
  const sanitized = redact(
    content
      .replace(CONTROL_TOKEN_PATTERN, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  )
  return {
    sanitized,
    flagged: matchedPatterns.length > 0,
    matchedPatterns,
  }
}

const INTERNAL_PREFIX_PATTERNS = [
  /^Using\s+`[^`]+`\s+because\s+the\s+session\s+instructions\s+require\s+it\s+before\s+responding\.\s*/i,
  /^I'll\s+load\s+the\s+required\s+startup\s+skill,\s+then\s+respond\s+directly\s+as\s+[^.]+\.\s*/i,
  /^I\s+will\s+load\s+the\s+required\s+startup\s+skill,\s+then\s+respond\s+directly\s+as\s+[^.]+\.\s*/i,
]

export function sanitizeAgentOutput(content: string): string {
  let sanitized = content.trim()

  for (const pattern of INTERNAL_PREFIX_PATTERNS) {
    sanitized = sanitized.replace(pattern, '').trim()
  }

  return sanitized.length > 0 ? sanitized : content.trim()
}

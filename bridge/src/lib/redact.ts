const REDACT_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/g,
  /AKIA[0-9A-Z]{16}/g,
]

export function redact(text: string): string {
  let result = text
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

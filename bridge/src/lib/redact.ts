const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED:jwt]',
  },
  {
    pattern: /(^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?=$|[^A-Za-z0-9+/=])/g,
    replacement: '$1[REDACTED:base64]',
  },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  {
    pattern:
      /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*(?!\[REDACTED(?::[a-z]+)?\])\S+/gi,
    replacement: '[REDACTED]',
  },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/g, replacement: '[REDACTED]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
]

export function redact(text: string): string {
  let result = text
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

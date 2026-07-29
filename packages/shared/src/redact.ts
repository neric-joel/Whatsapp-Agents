// Secret/PII redaction shared by web + bridge (logs and DB-persisted strings).
// Pure string -> string; order matters (JWT before generic base64).
//
// Provider-key rules sit BETWEEN the JWT rule and the generic base64 rule on purpose:
// a modern key body is base64url, so the base64 rule (which excludes `-`/`_`) would
// otherwise eat only the longest separator-free run and leave the prefix and tail of
// the live key in cleartext. Matching the whole key first removes it entirely.
const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED:jwt]',
  },
  // Provider API keys. Bodies are base64url ([A-Za-z0-9_-]), NOT base64 — an
  // alphanumeric-only run stops at the first `-`/`_`, which is why `sk-ant-…`
  // and `sk-proj-…` never matched the old /sk-[a-zA-Z0-9]{20,}/ rule.
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED]' },
  // Generic `sk-` catch-all: LAST of the sk- rules so the specific ones win.
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replacement: '[REDACTED]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED]' },
  { pattern: /\bAIza[A-Za-z0-9_-]{35}/g, replacement: '[REDACTED]' },
  {
    pattern: /(^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?=$|[^A-Za-z0-9+/=])/g,
    replacement: '$1[REDACTED:base64]',
  },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  // Labelled secrets. Tolerates a whitespace-separated label ("api key: …") and an
  // optional `Bearer ` scheme. BOTH lookaheads are load-bearing: the second keeps
  // redaction idempotent, and the first stops `\S+` from backtracking onto the word
  // `Bearer` when the value behind it was already redacted by an earlier rule.
  {
    pattern:
      /(?:password|passwd|secret|token|credential|api[\s_-]?key|authorization)\s*[:=]\s*(?!Bearer\s+\[REDACTED(?::[a-z]+)?\])(?!\[REDACTED(?::[a-z]+)?\])(?:Bearer\s+)?\S+/gi,
    replacement: '[REDACTED]',
  },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/g, replacement: '[REDACTED]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
]

/** Object keys whose VALUE is a secret whatever its shape (see `redactDeep`). */
const SENSITIVE_KEY_NAME =
  /(secret|password|passwd|token|api[_-]?key|credential|authorization|cookie|private[_-]?key)/i

// Format-independent backstop: exact values the process knows are secret (registered
// where a credential is decrypted). Bounded and process-local — never persisted, never
// logged, never exported.
const MIN_REGISTERED_SECRET_LENGTH = 8
const MAX_REGISTERED_SECRETS = 64
const knownSecrets = new Set<string>()

/**
 * Register a value as a known secret so `redact()` strips it verbatim regardless of
 * format. Safe to call repeatedly with the same value. Values shorter than
 * {@link MIN_REGISTERED_SECRET_LENGTH} are ignored (they would redact ordinary prose),
 * and the registry evicts oldest-first so a long-lived process cannot grow unbounded.
 */
export function registerSecret(value: string): void {
  if (typeof value !== 'string') return
  const secret = value.trim()
  if (secret.length < MIN_REGISTERED_SECRET_LENGTH) return
  if (knownSecrets.has(secret)) return
  while (knownSecrets.size >= MAX_REGISTERED_SECRETS) {
    const oldest = knownSecrets.values().next().value
    if (oldest === undefined) break
    knownSecrets.delete(oldest)
  }
  knownSecrets.add(secret)
}

export function redact(text: string): string {
  // Registered secrets first: an exact known value is the highest-confidence match,
  // and removing it up front stops a later pattern from splitting it into fragments.
  let result = text
  for (const secret of knownSecrets) result = result.replaceAll(secret, '[REDACTED]')
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/** Recursively redact every string value in a value/array/object (non-strings pass through). */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Key-name pass BEFORE the value pass: a secret under a telling name is redacted
      // whatever its shape, so `{ apiKey: <plaintext> }` cannot slip past on format.
      out[k] = SENSITIVE_KEY_NAME.test(k) ? '[REDACTED]' : redactDeep(v)
    }
    return out
  }
  return value
}

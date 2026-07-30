// Secret/PII redaction shared by web + bridge (logs and DB-persisted strings).
// `redact()` is string -> string and order matters (JWT before generic base64). It is
// deterministic for a given registry state but NOT referentially transparent: the
// known-secret registry below is module state that `registerSecret()` mutates. That is
// inherent to a format-independent backstop — see the registry comment.
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
  // Generic `sk-` catch-all: LAST of the sk- rules so the specific ones win. The leading
  // \b is load-bearing here (and on the rules around it): without it the rule fires inside
  // ordinary hyphenated English — `task-management-and-scheduling-refactor` would redact
  // from its embedded `sk-` onward.
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
  // Labelled secrets. Widened to a space-separated label ("api key: …") and an optional
  // `Bearer ` scheme. Deliberately NOT widened to `authorization`/`credential`: redact()
  // also runs over agent replies persisted to `messages` and rendered in the UI, and those
  // two words are ordinary prose whenever an agent discusses HTTP ("set the Authorization:
  // Bearer <token> header"). They are covered as redactDeep KEY names instead — see
  // SENSITIVE_KEY_NAME. `[ _-]` not `[\s_-]` so a label can never be joined across a
  // newline. BOTH lookaheads are load-bearing: the second keeps redaction idempotent, and
  // the first stops `\S+` from backtracking onto the word `Bearer` when the value behind it
  // was already redacted by an earlier rule.
  {
    pattern:
      /(?:password|passwd|secret|token|api[ _-]?key)\s*[:=]\s*(?!Bearer\s+\[REDACTED(?::[a-z0-9]+)?\])(?!\[REDACTED(?::[a-z0-9]+)?\])(?:Bearer\s+)?\S+/gi,
    replacement: '[REDACTED]',
  },
  {
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!\[REDACTED(?::[a-z0-9]+)?\])\S+/g,
    replacement: '[REDACTED]',
  },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
]

/** Object keys whose VALUE is a secret whatever its shape (see `redactDeep`). */
const SENSITIVE_KEY_NAME =
  /(secret|password|passwd|token|api[_-]?key|credential|authorization|cookie|private[_-]?key)/i

// Format-independent backstop: exact values this process knows are secret, registered
// where a credential is decrypted.
//
// TRADE-OFF, stated explicitly: a decrypted secret used to be transient (decrypt → child
// env → dropped); registering it retains the plaintext in process memory for as long as it
// stays in the registry, which widens the heap-snapshot / core-dump surface. That is
// accepted because it is the only redaction measure that survives a provider changing its
// key format. The Set is module-private — never exported, logged, serialized or persisted
// — and is bounded. Be precise about the lifetime: nothing in production clears it, so a
// registered secret is retained for the daemon's uptime. clearRegisteredSecrets() exists
// for tests. Clearing per-run would be wrong (it would strip the backstop from concurrent
// runs) and clearing at shutdown is pointless (the heap goes with the process).
const MIN_REGISTERED_SECRET_LENGTH = 8
const MAX_REGISTERED_SECRETS = 64
const knownSecrets = new Set<string>()

/**
 * Register a value as a known secret so `redact()` strips it verbatim regardless of
 * format. Safe to call repeatedly with the same value. Values shorter than
 * {@link MIN_REGISTERED_SECRET_LENGTH} are ignored (they would redact ordinary prose),
 * and the registry evicts least-recently-registered first so it cannot grow unbounded.
 */
export function registerSecret(value: string): void {
  if (typeof value !== 'string') return
  const secret = value.trim()
  if (secret.length < MIN_REGISTERED_SECRET_LENGTH) return
  if (knownSecrets.has(secret)) {
    // Re-register = refresh recency. registerSecret runs on EVERY credential resolution,
    // so without the delete/re-add the most-used secret keeps its original insertion slot
    // and is the first one evicted — silently dropping the control where it matters most.
    knownSecrets.delete(secret)
    knownSecrets.add(secret)
    return
  }
  while (knownSecrets.size >= MAX_REGISTERED_SECRETS) {
    const oldest = knownSecrets.values().next().value
    if (oldest === undefined) break
    knownSecrets.delete(oldest)
  }
  knownSecrets.add(secret)
}

/**
 * Forget every registered secret. Call on credential rotation/deletion or worker teardown
 * so a decrypted plaintext is not retained for the whole process lifetime.
 */
export function clearRegisteredSecrets(): void {
  knownSecrets.clear()
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
      // null/undefined are left alone — replacing them would assert a secret was present
      // where there was none.
      out[k] = SENSITIVE_KEY_NAME.test(k) && v != null ? '[REDACTED]' : redactDeep(v)
    }
    return out
  }
  return value
}

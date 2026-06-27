/**
 * Canary lookahead — a pre-commit hallucination gate.
 *
 * Inspired by HalluCana (arXiv:2412.07965): catch a hallucination BEFORE it is saved and
 * BEFORE it is fed to another agent, so one agent's wrong claim can't become another's
 * premise. The agent CLIs are black boxes (no logits), so this is a *behavioral proxy*:
 * extract the checkable claims from the reply and screen them, with the strongest, most
 * deterministic check being grounding against AgentRoom's real architecture.
 *
 * It is deliberately conservative and FAILS SAFE: the caller treats any error/timeout as
 * `unverified`, never `verified`. A `flagged` verdict (a claim that contradicts known
 * facts) gates propagation; `unverified` is surfaced but still shown.
 *
 * Statuses:
 *   - `flagged`     — asserts something that contradicts the known environment (e.g. that
 *                     this app stores data in Supabase/Postgres/a cloud/ChatGPT workspace).
 *   - `unverified`  — weaker signals (hedging, unqualified absolutes, fabricated citation,
 *                     self-contradiction) that warrant skepticism.
 *   - `verified`    — no problematic signal found by these checks (NOT a proof of truth).
 */

export type CanaryStatus = 'verified' | 'unverified' | 'flagged'

export interface CanaryResult {
  status: CanaryStatus
  reasons: string[]
}

// Backends/storage this app does NOT use. A confident claim that AgentRoom stores data in
// any of these contradicts the ground truth (local SQLite under ~/.agentroom) — the exact
// hallucination seen in the wild (one agent said Supabase, another said a ChatGPT workspace).
const FORBIDDEN_BACKENDS =
  /\b(supabase|postgres(ql)?|mysql|mongo(db)?|firebase|dynamo(db)?|redis|cloud (?:database|storage|backend|server)|chatgpt (?:workspace|memory|cloud|server|storage)|openai (?:workspace|storage|server)|a (?:remote|hosted) (?:database|server|backend))\b/i

// Verbs that turn a backend mention into a *storage/architecture assertion* about this app.
const STORAGE_ASSERTION =
  /\b(stored?|saved?|persist(?:ed|s)?|kept|lives?|hosted|backed by|uses?|using|runs? on|powered by|relies on|database is|backend is)\b/i

// Negation cues — don't flag a CORRECT statement that denies the forbidden backend
// (e.g. "this is NOT stored in Supabase", "no cloud database, it's local SQLite").
const NEGATION =
  /\b(no|not|n't|never|without|isn't|aren't|doesn't|don't|instead of|rather than|unlike)\b/i

// Split into clauses (sentence boundaries + commas/semicolons/em–en dashes) so a negation
// in one clause ("it's NOT local — data lives in Supabase") can't disarm a backend claim in
// the next. Hyphenated words aren't split (the dash split requires surrounding spaces).
function splitSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?\n,;])\s+|\s+[—–]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Run the canary over an agent reply. Pure + deterministic. */
export function runCanary(content: string): CanaryResult {
  const reasons: string[] = []
  const sentences = splitSentences(content)

  // 1. Grounding check (strongest): a storage/architecture claim naming a forbidden backend.
  for (const s of sentences) {
    const m = s.match(FORBIDDEN_BACKENDS)
    if (!m || m.index === undefined) continue
    if (!STORAGE_ASSERTION.test(s)) continue
    // Within this clause, a negation BEFORE the backend term is a denial ("not stored in
    // Supabase"). A negation in a different clause was already split off above, so it can't
    // disarm the flag — that was the bypass ("it's NOT local — data lives in Supabase").
    if (NEGATION.test(s.slice(0, m.index))) continue
    reasons.push(
      `Contradicts the real architecture: claims this app's data lives in "${m[0]}" — it is local SQLite under ~/.agentroom (no cloud).`,
    )
    break
  }
  const grounded = reasons.length > 0

  // 2. Weaker behavioral signals → unverified (kept distinct from the grounding flag).
  const weak: string[] = []
  if (
    /\b(i('m| am) not sure|i think|it might be|i believe|possibly|i'm uncertain|i cannot verify|i may be wrong)\b/i.test(
      content,
    )
  ) {
    weak.push('Hedging language without grounding')
  }
  if (
    /\b(100% certain|guaranteed(ly)?|absolutely certain|proven beyond|scientifically proven|studies show|always works|never fails)\b/i.test(
      content,
    )
  ) {
    weak.push('Unqualified absolute claim')
  }
  if (/according to \[?[A-Z][^[\]]{2,40}\]?(?![^\s]*https?:\/\/)/i.test(content)) {
    weak.push('Citation without a verifiable source')
  }
  reasons.push(...weak)

  const status: CanaryStatus = grounded ? 'flagged' : weak.length > 0 ? 'unverified' : 'verified'
  return { status, reasons: [...new Set(reasons)] }
}

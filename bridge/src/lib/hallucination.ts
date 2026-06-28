interface HallucinationResult {
  flagged: boolean
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
}

export function detectHallucination(content: string): HallucinationResult {
  const reasons: string[] = []

  // DoS bound: a reply is capped only by the 10MB subprocess output cap, and the
  // self-contradiction scan below is O(sentences^2). A malicious or compromised agent CLI
  // could return a reply engineered to stall the single-threaded bridge. Analyze a bounded
  // prefix and a bounded sentence count — hallucination signals appear early in a reply.
  const MAX_SCAN_CHARS = 20_000
  const MAX_SENTENCES = 200
  const text = content.length > MAX_SCAN_CHARS ? content.slice(0, MAX_SCAN_CHARS) : content

  // Hedging without substance
  const hedging =
    /\b(i('m| am) not sure( but)?|i think|it might be|i believe|possibly|probably|i'm uncertain|i cannot verify|i may be wrong)\b/i
  if (hedging.test(text)) reasons.push('Contains hedging language without grounding')

  // Fabricated citations (citation without URL)
  const fakeCite = /according to \[?[A-Z][^[\]]{2,40}\]?(?![^\s]*https?:\/\/)/i
  if (fakeCite.test(text)) reasons.push('Contains citation without verifiable source')

  // Extraordinary claims
  const extraordinary =
    /\b(proven beyond|100% certain|guaranteed(ly)?|absolutely certain|always works|never fails|scientifically proven|studies show)\b/i
  if (extraordinary.test(text)) reasons.push('Contains unqualified absolute claim')

  // Self-contradiction (very simple: "X is ... X is not"). Capped to MAX_SENTENCES so the
  // nested scan stays O(MAX_SENTENCES^2) on a bounded prefix regardless of reply size.
  const lines = text
    .split(/[.!?]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_SENTENCES)
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i] ?? ''
      const b = lines[j] ?? ''
      if (a.length > 10 && b.includes('not') && b.replace(' not', '').includes(a.slice(0, 15))) {
        reasons.push('Potential self-contradiction detected')
        break
      }
    }
  }

  // Dedupe reasons: the self-contradiction scan above can push the same reason once
  // per outer-loop line, and confidence is derived from reason COUNT — so duplicates
  // would (a) falsely inflate confidence toward 'high' from a single category and
  // (b) collide as non-unique React keys in HallucinationBanner. Confidence must
  // reflect distinct signal categories, not repeat hits of one.
  const uniqueReasons = [...new Set(reasons)]
  const flagged = uniqueReasons.length > 0
  const confidence =
    uniqueReasons.length >= 3 ? 'high' : uniqueReasons.length === 2 ? 'medium' : 'low'
  return { flagged, confidence, reasons: uniqueReasons }
}

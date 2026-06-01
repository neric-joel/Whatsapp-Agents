interface HallucinationResult {
  flagged: boolean
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
}

export function detectHallucination(content: string): HallucinationResult {
  const reasons: string[] = []

  // Hedging without substance
  const hedging =
    /\b(i('m| am) not sure( but)?|i think|it might be|i believe|possibly|probably|i'm uncertain|i cannot verify|i may be wrong)\b/i
  if (hedging.test(content)) reasons.push('Contains hedging language without grounding')

  // Fabricated citations (citation without URL)
  const fakeCite = /according to \[?[A-Z][^[\]]{2,40}\]?(?![^\s]*https?:\/\/)/i
  if (fakeCite.test(content)) reasons.push('Contains citation without verifiable source')

  // Extraordinary claims
  const extraordinary =
    /\b(proven beyond|100% certain|guaranteed(ly)?|absolutely certain|always works|never fails|scientifically proven|studies show)\b/i
  if (extraordinary.test(content)) reasons.push('Contains unqualified absolute claim')

  // Self-contradiction (very simple: "X is ... X is not")
  const lines = content
    .split(/[.!?]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
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

  const flagged = reasons.length > 0
  const confidence = reasons.length >= 3 ? 'high' : reasons.length === 2 ? 'medium' : 'low'
  return { flagged, confidence, reasons }
}

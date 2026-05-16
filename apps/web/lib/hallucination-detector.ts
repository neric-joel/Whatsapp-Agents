export interface HallucinationMeta {
  flagged: boolean
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
  checked_at?: string
  accepted?: boolean
}

export function extractHallucination(metadata: Record<string, unknown>): HallucinationMeta | null {
  const h = (metadata as { hallucination?: unknown }).hallucination
  if (!h || typeof h !== 'object') return null

  const hallucination = h as Partial<HallucinationMeta>
  if (!hallucination.flagged) return null
  return hallucination as HallucinationMeta
}

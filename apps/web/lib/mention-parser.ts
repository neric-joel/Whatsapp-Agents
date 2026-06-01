export interface ParsedMention {
  type: 'agent' | 'everyone'
  slug?: string
  agent_id?: string
  raw: string
}

export function parseMentions(
  content: string,
  agents: ReadonlyArray<{ id: string; slug: string }>,
): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const seen = new Set<string>()
  const tokens = content.match(/@[\w-]+/g) ?? []

  for (const raw of tokens) {
    const token = raw.slice(1).toLowerCase()
    const normalizedToken = normalizeMentionToken(token)
    if (seen.has(normalizedToken)) continue
    seen.add(normalizedToken)

    if (normalizedToken === 'everyone') {
      mentions.push({ type: 'everyone', raw })
      continue
    }

    const agent = agents.find((a) => normalizeMentionToken(a.slug) === normalizedToken)
    if (agent) {
      mentions.push({ type: 'agent', slug: agent.slug, agent_id: agent.id, raw })
    }
  }

  return mentions
}

function normalizeMentionToken(token: string): string {
  return token.toLowerCase().replace(/[_-]/g, '')
}

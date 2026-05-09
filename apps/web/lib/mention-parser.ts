export interface ParsedMention {
  type: 'agent' | 'everyone'
  slug?: string
  agent_id?: string
  raw: string
}

export function parseMentions(
  content: string,
  agents: ReadonlyArray<{ id: string; slug: string }>
): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const seen = new Set<string>()
  const tokens = content.match(/@[\w-]+/g) ?? []

  for (const raw of tokens) {
    const token = raw.slice(1).toLowerCase()
    if (seen.has(token)) continue
    seen.add(token)

    if (token === 'everyone') {
      mentions.push({ type: 'everyone', raw })
      continue
    }

    const agent = agents.find((a) => a.slug.toLowerCase() === token)
    if (agent) {
      mentions.push({ type: 'agent', slug: agent.slug, agent_id: agent.id, raw })
    }
  }

  return mentions
}

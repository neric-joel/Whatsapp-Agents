export interface ParsedMention {
  type: 'agent' | 'everyone'
  slug?: string
  agent_id?: string
  raw: string
}

export function parseMentions(
  content: string,
  agents: ReadonlyArray<{ id: string; slug: string; name?: string }>,
): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const seen = new Set<string>()
  const addMention = (mention: ParsedMention, key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    mentions.push(mention)
  }

  const nameAgents = agents
    .filter((agent) => agent.name && /\s/.test(agent.name))
    .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))

  for (const agent of nameAgents) {
    const name = agent.name as string
    const pattern = new RegExp(`@${escapeRegExp(name).replace(/\\ /g, '\\s+')}(?![\\w-])`, 'gi')
    for (const match of content.matchAll(pattern)) {
      addMention({ type: 'agent', slug: agent.slug, agent_id: agent.id, raw: match[0] }, normalizeMentionToken(agent.name ?? agent.slug))
    }
  }

  const tokens = content.match(/@[\w-]+/g) ?? []

  for (const raw of tokens) {
    const token = raw.slice(1).toLowerCase()
    const normalizedToken = normalizeMentionToken(token)
    if (seen.has(normalizedToken)) continue

    if (normalizedToken === 'everyone') {
      addMention({ type: 'everyone', raw }, normalizedToken)
      continue
    }

    const agent = agents.find((item) => {
      return normalizeMentionToken(item.slug) === normalizedToken
        || normalizeMentionToken(item.name ?? '') === normalizedToken
    })
    if (agent) addMention({ type: 'agent', slug: agent.slug, agent_id: agent.id, raw }, normalizedToken)
  }

  return mentions
}

function normalizeMentionToken(token: string): string {
  return token.toLowerCase().replace(/[_\-\s]/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

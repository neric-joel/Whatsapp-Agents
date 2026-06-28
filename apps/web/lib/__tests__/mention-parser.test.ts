import { parseMentions } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

const agents = [
  { id: 'a1', slug: 'claude_thinker' },
  { id: 'a2', slug: 'codex_builder' },
]

describe('parseMentions', () => {
  it('@everyone returns everyone type', () => {
    const result = parseMentions('@everyone hi', agents)
    expect(result).toEqual([{ type: 'everyone', raw: '@everyone' }])
  })

  it('@known_slug returns matching agent', () => {
    const result = parseMentions('@claude_thinker please help', agents)
    expect(result[0]).toMatchObject({ type: 'agent', agent_id: 'a1', slug: 'claude_thinker' })
  })

  it('@unknown handle is ignored', () => {
    const result = parseMentions('@nobody here', agents)
    expect(result).toHaveLength(0)
  })

  it('case-insensitive slug matching', () => {
    const result = parseMentions('@CodexBuilder hello', agents)
    expect(result[0]).toMatchObject({ type: 'agent', agent_id: 'a2' })
  })

  it('deduplicates repeated mentions', () => {
    const result = parseMentions('@claude_thinker @claude_thinker', agents)
    expect(result).toHaveLength(1)
  })

  it('empty string returns empty array', () => {
    const result = parseMentions('', agents)
    expect(result).toHaveLength(0)
  })
})

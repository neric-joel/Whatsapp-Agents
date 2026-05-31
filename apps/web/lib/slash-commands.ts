// Phase 9 slash commands: `/remember` and `/recall`. These coexist with
// `@mentions` and the existing `/discuss` (parsed separately in @agentroom/shared)
// — only a leading `/remember` or `/recall` is matched here; everything else
// (plain text, mentions, `/discuss`) returns null and flows through unchanged.
//
// A future Phase 11 introduces a full command registry; this is the minimal,
// dependency-free parser those two commands need now.

export interface RememberCommand {
  command: 'remember'
  text: string
  global: boolean
}

export interface RecallCommand {
  command: 'recall'
  query: string
}

export interface HandoffCommand {
  command: 'handoff'
  toSlug: string
  task: string
}

export interface AgentsCommand {
  command: 'agents'
}

export type SlashCommand = RememberCommand | RecallCommand | HandoffCommand | AgentsCommand

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim()

  const remember = /^\/remember\b([\s\S]*)$/i.exec(trimmed)
  if (remember) {
    let rest = (remember[1] ?? '').trim()
    let global = false
    if (/(^|\s)--global(\s|$)/.test(rest)) {
      global = true
      // strip every occurrence (a user may type the flag more than once)
      rest = rest
        .replace(/(^|\s)--global(?=\s|$)/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }
    return { command: 'remember', text: rest, global }
  }

  const recall = /^\/recall\b([\s\S]*)$/i.exec(trimmed)
  if (recall) {
    return { command: 'recall', query: (recall[1] ?? '').trim() }
  }

  // /handoff @agent <task>
  const handoff = /^\/handoff\b([\s\S]*)$/i.exec(trimmed)
  if (handoff) {
    const rest = (handoff[1] ?? '').trim()
    const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(rest)
    return { command: 'handoff', toSlug: m?.[1] ?? '', task: (m?.[2] ?? '').trim() }
  }

  // /agents (list the room's agents)
  if (/^\/agents\b/i.test(trimmed)) {
    return { command: 'agents' }
  }

  return null
}

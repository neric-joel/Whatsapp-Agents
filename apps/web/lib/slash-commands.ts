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

export type SlashCommand = RememberCommand | RecallCommand

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim()

  const remember = /^\/remember\b([\s\S]*)$/i.exec(trimmed)
  if (remember) {
    let rest = (remember[1] ?? '').trim()
    let global = false
    if (/(^|\s)--global(\s|$)/.test(rest)) {
      global = true
      rest = rest.replace(/(^|\s)--global(\s|$)/, ' ').trim()
    }
    return { command: 'remember', text: rest, global }
  }

  const recall = /^\/recall\b([\s\S]*)$/i.exec(trimmed)
  if (recall) {
    return { command: 'recall', query: (recall[1] ?? '').trim() }
  }

  return null
}

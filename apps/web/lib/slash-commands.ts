// Phase 11 — the in-product slash-command parser. It reads the single source of
// truth (`COMMAND_REGISTRY` in @agentroom/shared) to decide what is a command,
// so command existence + role gating live in one place. It coexists with
// `@mentions` and `/discuss`: `/discuss` is parsed in @agentroom/shared and
// dispatched by the messages route, so it intentionally flows through as a
// normal message here (returns `null`).
//
// Pure parsing only — RBAC is decided by the caller (it needs the user's room
// role) and ALWAYS re-enforced server-side (e.g. the `/reset` route requires
// admin). The parser never bypasses RLS or the tool-approval flow.

import { extractCommand, getCommandSpec } from '@agentroom/shared'

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

export interface HelpCommand {
  command: 'help'
}

export interface PinCommand {
  command: 'pin'
}

export interface ResetCommand {
  command: 'reset'
}

/** A leading `/word` that is not a known command — UI shows a friendly hint. */
export interface UnknownCommand {
  command: 'unknown'
  name: string
}

export type SlashCommand =
  | RememberCommand
  | RecallCommand
  | HandoffCommand
  | AgentsCommand
  | HelpCommand
  | PinCommand
  | ResetCommand
  | UnknownCommand

export function parseSlashCommand(input: string): SlashCommand | null {
  const extracted = extractCommand(input)
  if (!extracted) return null
  const { name, rest } = extracted

  // `/discuss` is owned by @agentroom/shared + the messages route — let it pass
  // through as a normal message rather than intercepting it here.
  if (name === 'discuss') return null

  const spec = getCommandSpec(name)
  if (!spec) return { command: 'unknown', name }

  switch (name) {
    case 'help':
    case 'commands':
      return { command: 'help' }
    case 'agents':
      return { command: 'agents' }
    case 'pin':
      return { command: 'pin' }
    case 'reset':
      return { command: 'reset' }
    case 'recall':
      return { command: 'recall', query: rest }
    case 'remember': {
      let text = rest
      let global = false
      if (/(^|\s)--global(\s|$)/.test(text)) {
        global = true
        // strip every occurrence (a user may type the flag more than once)
        text = text
          .replace(/(^|\s)--global(?=\s|$)/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      }
      return { command: 'remember', text, global }
    }
    case 'handoff': {
      const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(rest)
      return { command: 'handoff', toSlug: m?.[1] ?? '', task: (m?.[2] ?? '').trim() }
    }
    default:
      // A registered command with no parser branch — treat as unknown so the UI
      // surfaces it rather than silently sending it as a message.
      return { command: 'unknown', name }
  }
}

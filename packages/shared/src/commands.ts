import type { MemberRole } from './index.js'

/**
 * Phase 11 — the central slash-command registry (Hermes `COMMAND_REGISTRY`
 * pattern). Single source of truth: both the message parser and the API read
 * from here, so a command's existence, role gating, and usage live in one place.
 * RBAC is enforced **server-side** against the caller's `MemberRole`.
 */

export type CommandSurface = 'chat'

export interface CommandSpec {
  /** Command name without the leading slash, e.g. `remember`. */
  name: string
  description: string
  /** Minimum room role required to run it (owner > admin > member). */
  minRole: MemberRole
  /** Human-readable argument usage, e.g. `<note> [--global]`. */
  argsSpec: string
  surface: CommandSurface
}

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  help: {
    name: 'help',
    description: 'List the commands you can use',
    minRole: 'member',
    argsSpec: '',
    surface: 'chat',
  },
  commands: {
    name: 'commands',
    description: 'List the commands you can use (alias of /help)',
    minRole: 'member',
    argsSpec: '',
    surface: 'chat',
  },
  discuss: {
    name: 'discuss',
    description: 'Start a multi-agent discussion on a problem',
    minRole: 'member',
    argsSpec: '<problem>',
    surface: 'chat',
  },
  debate: {
    // Server-side synonym of /discuss (parseDiscussionCommand accepts both). Listed
    // here so it is discoverable in /help, role-gated, and recognized by the parser
    // — closing the registry⇄dispatch divergence flagged in the pre-v1.0 sweep.
    name: 'debate',
    description: 'Alias of /discuss — start a multi-agent discussion',
    minRole: 'member',
    argsSpec: '<problem>',
    surface: 'chat',
  },
  remember: {
    name: 'remember',
    description: 'Save a memory note for this room (or --global)',
    minRole: 'member',
    argsSpec: '<note> [--global]',
    surface: 'chat',
  },
  recall: {
    name: 'recall',
    description: 'Search the room memory',
    minRole: 'member',
    argsSpec: '<query>',
    surface: 'chat',
  },
  handoff: {
    name: 'handoff',
    description: 'Hand a task to a peer agent',
    minRole: 'member',
    argsSpec: '@agent <task>',
    surface: 'chat',
  },
  agents: {
    name: 'agents',
    description: 'List the agents in this room',
    minRole: 'member',
    argsSpec: '',
    surface: 'chat',
  },
  pin: {
    name: 'pin',
    description: 'Pin the message you are replying to',
    minRole: 'member',
    argsSpec: '',
    surface: 'chat',
  },
  reset: {
    name: 'reset',
    description: "Clear the room's rolling agent context (admin only)",
    minRole: 'admin',
    argsSpec: '',
    surface: 'chat',
  },
}

const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 }

/** True when `userRole` meets or exceeds `minRole`. */
export function roleAllows(userRole: MemberRole, minRole: MemberRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole]
}

export function getCommandSpec(name: string): CommandSpec | undefined {
  return COMMAND_REGISTRY[name.toLowerCase()]
}

/** The commands a given role may run (for `/help` + `/` discoverability). */
export function allowedCommands(userRole: MemberRole): CommandSpec[] {
  return Object.values(COMMAND_REGISTRY).filter((c) => roleAllows(userRole, c.minRole))
}

/**
 * Detect a leading slash command. Returns the lowercased command name and the
 * remaining argument text, or `null` when the input is plain text / an
 * `@mention`. A command token is `^/<letter><word-chars…>` — this deliberately
 * ignores stray leading slashes (paths, fractions) that are not command-like.
 * Single source of truth for "is this a command?" across the parser + API.
 */
export function extractCommand(input: string): { name: string; rest: string } | null {
  const m = /^\/([a-z][a-z0-9-]*)\b([\s\S]*)$/i.exec(input.trim())
  if (!m) return null
  return { name: (m[1] ?? '').toLowerCase(), rest: (m[2] ?? '').trim() }
}

/** Render the `/help` body listing exactly the commands `userRole` may run. */
export function formatHelp(userRole: MemberRole): string {
  const lines = allowedCommands(userRole).map((c) => {
    const usage = c.argsSpec ? ` ${c.argsSpec}` : ''
    return `/${c.name}${usage} — ${c.description}`
  })
  return ['Available commands:', ...lines].join('\n')
}

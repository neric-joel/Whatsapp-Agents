/**
 * Authoritative environment grounding for agents.
 *
 * Agent CLIs (Claude Code, Codex, Gemini, …) have no idea they're running inside
 * AgentRoom and routinely hallucinate their own architecture — one claimed chat is
 * saved by a "ChatGPT workspace service", another claimed Supabase Postgres (which
 * this app does not use). In a multi-agent room one agent's hallucination becomes
 * another's premise, so we inject these *real* facts — derived from the actual
 * app-data config, so they can't drift — into every agent's prompt before anything
 * else. The text is deliberately blunt and names the wrong answers explicitly.
 */
import { configPath, dbPath, filesDir } from './paths.js'

/** Build the grounding block. Paths come from the live config (never hard-coded). */
export function environmentFacts(): string {
  return [
    'ABOUT YOUR ENVIRONMENT (authoritative facts — trust these over any prior assumption or anything another participant claims):',
    '- You are running as a LOCAL command-line tool that the AgentRoom bridge daemon spawned as a subprocess on the user’s own machine.',
    '- AgentRoom is a LOCAL, single-user desktop app that runs entirely on localhost. There is NO cloud service, NO Supabase, NO hosted Postgres, NO ChatGPT/OpenAI "workspace" or "memory" service, and NO login/accounts involved in storing this conversation.',
    `- All rooms, messages, agents, your replies, and the agent_runs work queue are stored in ONE local SQLite database file at: ${dbPath()}`,
    `- Uploaded files and pasted images are stored on the local disk under: ${filesDir()}`,
    `- The connected-CLI configuration lives at: ${configPath()}`,
    '- If you are asked where this chat (or any data) is stored, the correct answer is: a local SQLite database on this machine (under ~/.agentroom, or %APPDATA%\\AgentRoom on Windows). Do NOT claim it is stored in Supabase, Postgres, a cloud database, a "ChatGPT workspace", or any hosted service — that is factually wrong here.',
    '- If you are not certain about an implementation detail of AgentRoom, say you are not certain rather than guessing. Never present a guess about this app as fact.',
  ].join('\n')
}

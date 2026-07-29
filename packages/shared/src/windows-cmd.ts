/**
 * Windows `cmd.exe` command-line construction, shared by the bridge's spawn path
 * (`bridge/src/lib/subprocess-security.ts`) and the Connections screen's CLI probe
 * (`packages/db/src/cli-detect.ts`) so the two can never drift apart again.
 *
 * Node refuses to execute a Windows `.cmd`/`.bat` shim without a shell (EINVAL,
 * post-CVE-2024-27980), so both callers route those through `cmd.exe /d /s /c` with
 * `shell:false`. When any token carries a space or a cmd metacharacter the whole argv
 * is packed into ONE escaped `/c` string spawned with `windowsVerbatimArguments` —
 * which means this module, not Node, owns the quoting.
 *
 * Pure string logic with no `node:` imports, so it is safe in the package barrel that
 * client code also imports.
 */

/** cmd.exe metacharacters that must be caret-escaped to stay data. */
const CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g

/** A token cmd.exe cannot misread: no space, no quote, no metacharacter. */
const CMD_SAFE_TOKEN_RE = /^[A-Za-z0-9_./:\\-]+$/

function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META_RE, '^$1')
}

/**
 * Quote one argument per the MSVCRT / CommandLineToArgvW rules, then caret-escape it.
 *
 * A backslash is only special in front of a `"` or the closing quote: a run of n
 * backslashes becomes 2n+1 there (the odd one escapes the quote) and 2n at the end.
 *
 * `(\\*)` MUST be greedy. The previous `(?=(\\+?)?)\1"` form was silently wrong because
 * ECMAScript lookaheads are ATOMIC: once the lookahead succeeded the engine never
 * backtracked to grow the lazy `\\+?`, so the group held at most ONE backslash and a run
 * of n left the first n-1 un-doubled. `a\\"b` emitted 4 backslashes where the algorithm
 * requires 5 — an even count leaves the `"` a live delimiter and flips the argument's
 * quoting state, and a trailing `x\\` emitted 3 instead of 4, escaping the closing quote
 * so the argument never terminates. `\\*` over a single-character class is linear, so
 * the greedy form carries no ReDoS risk.
 */
function escapeCmdArgument(arg: string): string {
  let escaped = String(arg)
  escaped = escaped.replace(/(\\*)"/g, '$1$1\\"')
  escaped = escaped.replace(/(\\*)$/, '$1$1')
  escaped = `"${escaped}"`
  escaped = escaped.replace(CMD_META_RE, '^$1')
  return escaped.replace(CMD_META_RE, '^$1')
}

/** Pack `binPath` + `args` into a single `cmd /c` command string. */
export function buildWindowsCmdCommandLine(binPath: string, args: readonly string[]): string {
  const argv = [escapeCmdCommand(binPath), ...args.map((arg) => escapeCmdArgument(arg))]
  // With `cmd /s /c`, cmd.exe strips the first and last quote from the command
  // string. The outer pair here is deliberate; the escaped inner argv survives as
  // the literal .cmd invocation, including paths with spaces.
  return `"${argv.join(' ')}"`
}

/**
 * True when a token would be mangled by cmd.exe's own parsing, so the caller must use
 * {@link buildWindowsCmdCommandLine} + `windowsVerbatimArguments` instead of letting
 * Node do the escaping.
 */
export function needsWindowsCmdCommandLine(binPath: string, args: readonly string[]): boolean {
  return ![binPath, ...args].every((arg) => CMD_SAFE_TOKEN_RE.test(arg))
}

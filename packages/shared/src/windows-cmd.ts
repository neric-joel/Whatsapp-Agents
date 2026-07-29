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
 * backslashes becomes 2n+1 there (the odd one escapes the quote) and 2n at the end, and
 * stays n everywhere else. Getting the RUN LENGTH wrong is the whole bug class — an even
 * count before a quote leaves that quote a live delimiter, so text migrates across
 * argument boundaries.
 *
 * Written as an explicit single pass rather than a regex, for two independent reasons.
 *
 * 1. Correctness. The original `(?=(\\+?)?)\1"` form was silently wrong: ECMAScript
 *    lookaheads are ATOMIC, so once the lookahead succeeded the engine never backtracked
 *    to grow the lazy `\\+?`. The group held at most ONE backslash and a run of n left
 *    the first n-1 un-doubled — `a\\"b` emitted 4 backslashes where the rules require 5,
 *    and a trailing `x\\` emitted 3 instead of 4, escaping the closing quote so the
 *    argument never terminated.
 * 2. Complexity. The obvious regex repairs are quadratic, not linear as previously
 *    claimed here: a greedy `\\*` gives back one character at a time and is re-tried at
 *    every start offset, so a long backslash run that is followed by neither a quote nor
 *    end-of-string backtracks O(n) times per offset. Measured on a 32767-character run
 *    (the Windows command-line ceiling): two-pass `/(\\*)"/g` + `/(\\*)$/` 1441ms,
 *    single-pass `/(\\*)("|$)/g` 1037ms, this loop 0.16ms. Not reachable today — argv is
 *    host-configured and never agent-influenced (see resolveSpawnTarget's contract) — but
 *    the loop removes the question instead of documenting it away.
 *
 * The caret passes below are single-character-class replacements with no quantifier, so
 * they are linear.
 */
function escapeCmdArgument(arg: string): string {
  let quoted = '"'
  let backslashes = 0
  for (const ch of String(arg)) {
    if (ch === '\\') {
      backslashes++
      continue
    }
    if (ch === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
      continue
    }
    quoted += '\\'.repeat(backslashes) + ch
    backslashes = 0
  }
  quoted += '\\'.repeat(backslashes * 2) + '"'
  const carets = quoted.replace(CMD_META_RE, '^$1')
  return carets.replace(CMD_META_RE, '^$1')
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

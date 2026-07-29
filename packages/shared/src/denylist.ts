// Destructive-command speed bump for the tool-approval path (used by the bridge's
// tool-exec guard). Pure string/regex matching with no Node imports, so it lives in
// @agentroom/shared and can be imported by either workspace without reaching across a
// package boundary.
//
// THIS IS NOT A SECURITY BOUNDARY, and nothing should be built as if it were.
// `isDeniedCommand` NFKC-normalizes a free-form string, lowercases it, and looks for
// literal substrings and a handful of regexes. Deciding what an arbitrary shell string
// will actually do is undecidable, and every one of these walks straight through:
// `find . -delete`; `python -c "import shutil; shutil.rmtree('/')"`; `curl x | sh`;
// `base64 -d <<<… | sh`; word-splitting and quoting tricks (`r''m -rf`, `$IFS`,
// `${x:-rm}`); and literally any payload chained after a prefix that does not match
// (`ls && …`). It catches the unmissable, typo-grade cases so a human sees a clear
// "blocked" instead of a silent execution — that is the whole of its value.
//
// The controls that actually hold are elsewhere: the subprocess sandbox (`shell: false`,
// static argv, allowlisted child environment, output cap, process-tree kill — see
// SECURITY.md), the server-derived approval gate in the bridge run worker (a tool the
// agent's `tool_permissions` does not explicitly pre-approve stops for a human, and the
// agent-supplied `requires_approval` flag is ignored), and the agent CLI's own permission
// mode. Do not grant a capability on the strength of this list; grant it on those.

const DENIED_SUBSTRINGS = [
  'rm -rf',
  'rm -r /',
  'sudo rm',
  'dd if=',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod 777 /',
  'chown -r',
  'iptables -f',
  'ufw disable',
]

const DENIED_REGEXES = [
  /\brm\s*(-[rRfF]+\s*)+/i,
  // A real DDL object, not the bare verb: `git commit -m "drop legacy flag"` is not a
  // destructive command, and denying it teaches operators to switch the list off.
  /\bdrop\s+(?:table|database|schema|index)\b/i,
  // `format` must name a volume — the destructive Windows form takes it as the FIRST
  // operand (`format C:`, `format D: /fs:ntfs`, `format \\?\Volume{…}`). "format" on its
  // own is an ordinary English verb ("format the output as JSON") and is not denied.
  /\bformat\s+(?:[a-z]:(?!\w)|\/\S|\\\\)/i,
  // `mkfs` stays broad on purpose. It is a command name, not an English word, so it has
  // no false positives to save — while requiring it to name a device would let
  // `mkfs.ext4 $DEV` through.
  /\bmkfs(?:\.[a-z0-9]+)?\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i,
]

export function isDeniedCommand(command: string): boolean {
  const normalized = command.normalize('NFKC')
  const lower = normalized.toLowerCase()
  return (
    DENIED_SUBSTRINGS.some((p) => lower.includes(p)) ||
    DENIED_REGEXES.some((pattern) => pattern.test(normalized))
  )
}

/** Bounds for the walk over agent-supplied `arguments`, which is untrusted JSON: it can
 *  be cyclic, arbitrarily deep, or enormous. Hitting a bound ENDS the scan rather than
 *  denying — this is a speed bump, not a boundary (see the header). */
const MAX_SCAN_DEPTH = 12
const MAX_SCAN_NODES = 5000

/**
 * Scan every string leaf reachable from an agent-supplied argument value — object
 * values, array elements, and any nesting of the two — and return one the denylist
 * rejects, or `null`.
 *
 * Argument NAMES are deliberately not consulted. A tool names its own parameters, so a
 * shell string can arrive as `command`, `cmd`, `script`, `argv[0]`, or
 * `options.exec.command`; checking a single well-known key scans nothing at all for
 * every tool that picked a different one.
 */
export function findDeniedArgument(args: unknown): string | null {
  const seen = new WeakSet<object>()
  const pending: Array<{ value: unknown; depth: number }> = [{ value: args, depth: 0 }]
  let budget = MAX_SCAN_NODES

  while (pending.length > 0 && budget > 0) {
    budget -= 1
    const { value, depth } = pending.pop() as { value: unknown; depth: number }
    if (typeof value === 'string') {
      if (isDeniedCommand(value)) return value
      continue
    }
    if (value === null || typeof value !== 'object') continue
    if (depth >= MAX_SCAN_DEPTH || seen.has(value)) continue
    seen.add(value)
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      pending.push({ value: child, depth: depth + 1 })
    }
  }
  return null
}

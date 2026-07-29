// Destructive-command speed bump for the tool-approval path. Its only consumer is the
// dormant `tool_call_requested` branch in the bridge run worker (#83) — there is no
// tool-exec guard, and nothing executes a tool today. Pure string/regex matching with no
// Node imports, so it lives in @agentroom/shared and can be imported by either workspace
// without reaching across a package boundary.
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
// agent's `tool_permissions` does not name explicitly stops for a human; the agent-supplied
// `requires_approval` and `tool_category` fields are both ignored), and the agent CLI's own
// permission mode. Do not grant a capability on the strength of this list; grant it on those.

const DENIED_SUBSTRINGS = [
  'rm -rf',
  'rm -r /',
  'sudo rm',
  'dd if=',
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
  // Host power control, anchored to COMMAND POSITION (string start, or after a `;`/`&`/`|`
  // /newline separator). These were bare substrings, which was survivable while only
  // `arguments.command` was scanned; once the scan widened to the argument tree they denied
  // ordinary prose — `git commit -m "fix graceful shutdown"`, "handle reboot loop", and
  // (because `halt` matched inside `halting`) "write a haiku about the halting problem".
  /(?:^|[\n;&|])\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b/i,
  // The same verbs as the OPERAND of a controller that is itself in command position —
  // `systemctl poweroff`, `init 0` — which anchoring alone would otherwise let through.
  /\b(?:systemctl|init|telinit)\s+(?:\d\b|poweroff|reboot|halt)\b/i,
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
 *  be cyclic, arbitrarily deep, or enormous. */
const MAX_SCAN_DEPTH = 12
const MAX_SCAN_NODES = 5000

export interface ArgumentScanResult {
  /** A string leaf the denylist rejected, or `null` if none was found. */
  denied: string | null
  /**
   * TRUE when the walk stopped early — depth or node budget exhausted — so part of the
   * payload was never looked at. The scan FAILS OPEN here (`denied` stays `null` and the
   * call is not blocked), which is the correct trade for a speed bump but must never be
   * silent: the caller is expected to log it. A payload engineered to bury a command past
   * a bound is exactly what this flag exists to surface.
   */
  truncated: boolean
}

/**
 * Scan the string leaves reachable from an agent-supplied argument value — object
 * values, array elements, and any nesting of the two — for a denied command.
 *
 * Argument NAMES are deliberately not consulted. A tool names its own parameters, so a
 * shell string can arrive as `command`, `cmd`, `script`, `argv[0]`, or
 * `options.exec.command`; checking a single well-known key scans nothing at all for
 * every tool that picked a different one.
 *
 * NOT exhaustive, by construction. The walk is breadth-first and bounded to
 * MAX_SCAN_NODES nodes and MAX_SCAN_DEPTH levels; anything past a bound is skipped, NOT
 * denied, and reported via `truncated`. Breadth-first is the load-bearing choice: a
 * command that a tool would plausibly execute sits at a shallow key, so shallow leaves are
 * always scanned before a wide or deep subtree can exhaust the budget. (Depth-first
 * visited an object's last key first, so 10 000 filler keys after the payload hid it.)
 */
export function scanArgumentsForDenied(args: unknown): ArgumentScanResult {
  const seen = new WeakSet<object>()
  // A queue with a moving head rather than shift() — shift() is O(n) per call.
  const queue: Array<{ value: unknown; depth: number }> = [{ value: args, depth: 0 }]
  let head = 0
  // Counts nodes ever ENQUEUED, so the queue itself can never exceed the cap. Bounding at
  // dequeue instead would let one wide level push millions of entries before any check.
  let enqueued = 1
  let truncated = false

  while (head < queue.length) {
    const { value, depth } = queue[head++] as { value: unknown; depth: number }
    if (typeof value === 'string') {
      if (isDeniedCommand(value)) return { denied: value, truncated }
      continue
    }
    // A repeat visit is a cycle or shared reference, not truncation: it was already scanned.
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    if (depth >= MAX_SCAN_DEPTH) {
      truncated = true
      continue
    }
    seen.add(value)
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (enqueued >= MAX_SCAN_NODES) {
        truncated = true
        break
      }
      queue.push({ value: child, depth: depth + 1 })
      enqueued += 1
    }
  }
  return { denied: null, truncated }
}

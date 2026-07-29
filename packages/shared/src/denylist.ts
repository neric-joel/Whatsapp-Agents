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
//
// KNOWN FALSE POSITIVES, kept deliberately. Each one denies a tool call and FAILS THE RUN,
// so they are the cost side of the ledger and belong on the record next to the bypasses:
//   • `reboot 2 servers`, `shutdown 5 nodes` — a digit OPERAND after the verb reads as a
//     command. Kept so `shutdown 19:00` and `reboot 30` stay denied. (A digit BEFORE the verb
//     is not a prefix — see FLAG_OR_ARG — so `     12 reboot` from `uniq -c` is allowed.)
//   • `scripts/reboot`, `./bin/halt`, `/etc/init.d/reboot` — a path ending in the verb is a
//     real way to invoke it, so a repo path that happens to end the same way is denied. URLs
//     are excluded (PATH_PREFIX rejects `:`), but relative paths cannot be.
//   • A bare verb inside a delimiter pair, whenever the opening quote/paren follows a WORD
//     character. That is command position by design — it is how `bash -c "shutdown -h now"`
//     and `sh -c 'poweroff'` are caught — and only the `[-{[,:=(]` punctuation classes are
//     excluded, so this is a broad class, not a corner: markdown inline code
//     (`` `reboot` is aliased to … ``), `case "reboot":`, `return "reboot"`, `throw "halt"`,
//     and `TypeError: cannot read property "reboot" of undefined` all deny, as do
//     `(reboot) see appendix` and `See section "Shutdown"`. Call syntax specifically —
//     `print("reboot")`, `console.log("reboot")` — is excluded, because `(` is in the class.
//   • `-x foo reboot` — indistinguishable from `sudo -u root reboot`.
//   • `| shutdown | …` in a markdown table — a leading `|` is indistinguishable from a
//     pipeline separator.
//
// KNOWN MISSES from the same trades, so the cost is legible in both directions:
//   • `<shell> -c "<verb> now"`, `$(<verb> now)` and `` `<verb> now` `` are RECOVERED by the
//     third rule, but only in those unambiguous contexts. A `now` command ending at any other
//     closing quote is still allowed — that is what keeps `echo "shutdown now"` and
//     `halt now, then investigate` from failing a run.
//   • A quote preceded by `=` or `:` is never command position, which gives up
//     `--command="shutdown -h now"`, `run: "shutdown -h now"` and `{"cmd": "shutdown -h now"}`.
//     Accepted: the same rule is what stops every config value from failing a run.
//   • Narrowing FLAG_OR_ARG, WRAPPER_CMD and PATH_PREFIX to kill false positives gave up 18
//     spellings, all verified lost. Each narrowing is still the right trade — a false positive
//     fails a run, a miss here costs nothing this list was ever able to guarantee — but the
//     cost is real and belongs on the record:
//       - the POSIX end-of-options token, because a flag's dashes must be followed by a word
//         char (which is what stops `->`, `-->`, `--`, `--- reboot ---`): `sudo -- reboot`,
//         `sudo -- shutdown -h now`, `sudo -- poweroff`, `env -- reboot`,
//         `nohup -- shutdown -h now`, `doas -- reboot`, `setsid -- reboot`,
//         `sudo -u root -- reboot`, `command -- halt`;
//       - `timeout` with its own flags, because the duration binds tightly to the word (which
//         is what stops a bare number opening command position): `timeout -s KILL 5 reboot`,
//         `timeout -k 10 5 reboot`, `timeout --signal=KILL 5 reboot`,
//         `timeout --foreground 5 poweroff`, `timeout -v 30 halt`,
//         `sudo timeout -s TERM 5 reboot`;
//       - the Windows drive-letter path, because PATH_PREFIX rejects `:` to let URLs through:
//         `C:/Windows/System32/shutdown /s /t 0`, `C:/tools/reboot`, `file:///sbin/shutdown`.
//         Worth naming: this list does target Windows (it denies `shutdown /s /t 0` and has a
//         `format C:` rule), so this is a real gap rather than an irrelevant platform. Only the
//         forward-slash spelling is affected; `C:\Windows\…` never matched PATH_PREFIX anyway.

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

// ── Host power control ───────────────────────────────────────────────────────────────
// Built from shared fragments rather than written twice: the two rules below previously
// drifted apart (one accepted `-\S`, the other `-\w`, which cannot match a GNU long flag
// because the second `-` is not a word character — so `sudo --preserve-env shutdown` and
// `sudo -u root reboot` were both allowed). Sharing the prefix makes that class of drift
// impossible rather than merely fixed.
//
// Two things must be true at once, because these words are also ordinary English and EVERY
// LEAF IS SCANNED AS ITS OWN STRING — position 0 is the normal case for a prose leaf, not
// an edge case, so an anchor alone is not enough:
//   1. command POSITION — string start, or after a separator; and
//   2. command SHAPE — followed by end-of-string, a separator, or a whitespace-separated
//      operand (`-h`, `/s`, `+5`, `19:00`, `now`).
// Shape is what allows `halt the rollout`, `shutdown runbook`, `reboot.sh`,
// `poweroff/reboot procedures`, `shutdown-hooks.md` — a following bare word, or a `-`/`/`
// with no space before it, is prose — while still denying bare `halt` and `shutdown now`.
//
// PERFORMANCE IS A CORRECTNESS PROPERTY HERE: up to MAX_SCAN_NODES leaves are scanned per
// tool call, so a per-leaf cost in seconds is a denial of service. Two quadratic defects have
// already shipped in these rules — an unbounded `\S*\/` path prefix that rescanned to
// end-of-string at every separator (362ms on a 32 KB leaf), and a misplaced lookbehind (see
// CMD_START, 6947ms on a 64 KB leaf).
//
// The rule is NOT "bound every quantifier" — the `[ \t]*` / `[ \t]+` whitespace runs below are
// deliberately unbounded (CMD_START's lookbehind, CMD_PREFIX, CMD_END, CMD_SHAPE, WRAPPER_CMD,
// FLAG_OR_ARG) and are all linear. What actually caused both defects, and what to avoid:
//   1. no unbounded quantifier over a class that can ALSO match the construct following it —
//      `\S*` then `\/` rescans the whole token at every start position, whereas `[ \t]*` then
//      a non-whitespace construct cannot;
//   2. no variable-length lookbehind placed AHEAD of a character class — it makes the engine
//      evaluate it at every input position instead of only where the class can match.
// Neither is a property a reader can check by eye, so the enforcement is the
// `stays linear on adversarial leaves` test. Keep every shape in it, and if you change these
// rules, re-run a scaling probe (8/16/32/64 KB, growth must stay ~2x): the test's fixed budget
// still admits a large slowdown, so a pass is necessary but not sufficient.
const BACKTICK = '\x60'
const POWER_VERB = '(?:shutdown|reboot|halt|poweroff)'
/**
 * Command position: string start, a shell separator, or an opening quote/paren — but NOT a
 * quote/paren that follows JSON/YAML/attribute/call punctuation, which introduces a VALUE or
 * an argument, not a command. Without that exclusion `{"action": "reboot"}`, `policy="reboot"`
 * and `print("reboot")` are all denied, and a denial fails the whole run.
 *
 * PLACEMENT IS LOAD-BEARING. The lookbehind must come AFTER the character class, so it is
 * evaluated once per quote. Written before the class it is evaluated at EVERY input position,
 * which on a run of spaces is quadratic: measured 107 / 432 / 1733 / 6947 ms at 8 / 16 / 32 /
 * 64 KB (4x per doubling) against 0.24 / 0.49 / 0.97 / 1.96 ms here (2x, linear).
 */
const CMD_START =
  '(?:^|[\\n;&|]|[' + BACKTICK + '("\'](?<![-{[,:=(][ \\t]*\\n?[ \\t]{0,24}[' + BACKTICK + '("\']))'
/** A path prefix on the command word (`/sbin/shutdown`). Excludes `:` so a URL is not read as
 *  a path to a binary — `https://api.example.com/v1/shutdown` is an ordinary tool argument. */
const PATH_PREFIX = '(?:[^\\s;&|"\'' + BACKTICK + ':]{0,64}\\/)?'
/** Commands that run another command. `timeout` needs its duration and `su` needs a flag,
 *  or bare `timeout shutdown` / `su reboot` (prose) would count as command position. */
const WRAPPER_CMD =
  '(?:timeout[ \\t]+\\d{1,9}[smhd]?|sudo|doas|env|nohup|time|exec|command|setsid|su(?=[ \\t]+-))'
/**
 * A flag (with an optional separate-word value) or a VAR=VALUE assignment. The dashes must be
 * followed by a WORD character: `-\S` let `->`, `-->`, `--` and `--- reboot ---` count as
 * flags, so mermaid arrows, SQL comments and text dividers all reached command position. A
 * bare number is deliberately NOT a prefix — it made every `sort | uniq -c` count column and
 * numbered list item (`     12 reboot`) a command, with an arbitrary cliff at the digit bound.
 */
const FLAG_OR_ARG = '(?:-{1,2}\\w[^\\s]{0,30}(?:[ \\t]+[\\w.:@\\/-]{1,32})?|\\w{1,32}=[^\\s]{0,64})'
const CMD_PREFIX =
  '[ \\t]*(?:(?:' + PATH_PREFIX + WRAPPER_CMD + '|' + FLAG_OR_ARG + ')[ \\t]+){0,6}' + PATH_PREFIX
/** End of the command: end-of-string, a shell separator, or a closing quote/paren. */
const CMD_END = '[ \\t]*(?:$|[\\n;&|' + BACKTICK + ')"\'])'
/** `now` counts as an operand only at the real end of a command — otherwise
 *  `halt now, then investigate` and `echo "shutdown now"` fail the run. */
const CMD_SHAPE = '(?=[ \\t]+(?:[-/+]|\\d|now(?=[ \\t]*(?:$|[\\n;&|])))|' + CMD_END + ')'

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
  // Host power control in command position — see the fragment definitions above.
  new RegExp(CMD_START + CMD_PREFIX + POWER_VERB + CMD_SHAPE, 'i'),
  // The same verbs as the OPERAND of a controller in command position. The runlevel must END
  // the command: an unanchored `\binit\s+\d` denied `git init 2>/dev/null`, `npm init 2` and
  // `init 3 replicas`, each of which fails the whole run.
  new RegExp(
    CMD_START +
      CMD_PREFIX +
      '(?:systemctl[ \\t]+(?:-{1,2}\\w[^\\s]{0,30}[ \\t]+){0,4}(?:poweroff|reboot|halt)\\b' +
      '|(?:tel)?init[ \\t]+[0-6](?=' +
      CMD_END +
      '))',
    'i',
  ),
  // `<verb> now` inside an UNAMBIGUOUS command-execution context. CMD_SHAPE deliberately
  // refuses to treat a closing quote as the end of a `now` command, because `echo "shutdown
  // now"` must not fail a run — but that also gave up `bash -c "shutdown now"`, every other
  // shell/flag spelling of it, and `$(shutdown now)` / backticks, whose siblings with `-h` are
  // denied. `$(`, a backtick, and `<shell> -c "` are not ambiguous: nothing else uses them.
  new RegExp(
    '(?:\\$\\(|' +
      BACKTICK +
      '|\\b(?:ba|z|k|da)?sh[ \\t]+-[a-z]{0,4}c[ \\t]+["\'])[ \\t]*' +
      POWER_VERB +
      '[ \\t]+now\\b',
    'i',
  ),
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
 * denied, and reported via `truncated`.
 *
 * Breadth-first is a better bet, not a guarantee. It means a shallow leaf is reached before
 * a deeper one — which is where a command a tool would plausibly execute sits, and which
 * depth-first got backwards (it visited an object's LAST key first, so 10 000 filler keys
 * placed after a payload hid it). But ORDER WITHIN A LEVEL still decides: a denied command
 * sitting after MAX_SCAN_NODES siblings at the same depth is still missed. That case is
 * reported via `truncated`, never silently allowed.
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

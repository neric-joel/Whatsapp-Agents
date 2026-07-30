import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDeniedCommand, scanArgumentsForDenied } from '../src/denylist.js'

/**
 * Three properties are under test, each with its own way of failing silently.
 *
 * 1. FALSE POSITIVES. `/\bdrop\b/i` and `/\bformat\b/i` denied ordinary English —
 *    `git commit -m "drop legacy flag"`, "format the output as JSON" — and the bare
 *    `shutdown`/`reboot`/`halt`/`poweroff` substrings denied prose containing those
 *    words, including inside longer words (`halting`). A denylist that blocks routine
 *    work is a denylist an operator turns off, so the must-ALLOW cases are asserted
 *    alongside the true positives they must not cost.
 * 2. WHERE the scan looks. It must reach string leaves regardless of the key they sit
 *    under, because the tool — not the bridge — names its own parameters.
 * 3. WHAT the scan admits it missed. The walk is bounded, so it fails OPEN past a bound.
 *    That is acceptable for a speed bump only if the truncation is reported, so the
 *    `truncated` flag is asserted as load-bearing output, not incidental.
 */

test('a bare destructive verb in prose is not a destructive command', () => {
  // Each of these was denied by the old /\bdrop\b/i and /\bformat\b/i patterns.
  for (const benign of [
    'git commit -m "drop legacy flag"',
    'git commit -m "drop the v1 compatibility shim"',
    'npm run format',
    'prettier --write . to format the source',
    'format the output as JSON',
    'reformat the changelog',
    'echo "we will drop support for node 20"',
  ]) {
    assert.equal(isDeniedCommand(benign), false, `should be allowed: ${benign}`)
  }
})

test('power-control verbs in prose are not commands (position AND shape are both required)', () => {
  // Every leaf is scanned as its own string, so position 0 is the NORMAL case for a prose
  // leaf — an anchor alone leaves `halt the rollout` denied, and a denial fails the run.
  for (const benign of [
    // bare leaves at position 0
    'halt the rollout',
    'shutdown runbook',
    'shutdown the beta programme',
    'shutdown.md',
    'reboot.sh',
    'reboot loop root cause',
    'poweroff.target',
    'poweroff button behaviour',
    'document the shutdown sequence',
    'the reboot took four minutes',
    'write a haiku about the halting problem',
    'shutdowns are scheduled weekly',
    // `-`/`/` with no whitespace is a compound word, not a flag or a path operand
    'shutdown-hooks.md',
    'reboot-loop analysis',
    'poweroff/reboot procedures',
    'shutdown/restart guide',
    'halt-and-catch-fire',
    // embedded after an opening quote (which IS a separator) — shape saves these
    'git commit -m "fix graceful shutdown"',
    'git commit -m "handle reboot loop"',
    'git commit -m "halt the rollout"',
    // the wrapper-command prefix must not drag prose in
    'time reboot took four minutes',
    'command shutdown procedures',
    'exec summary shutdown notes',
    'systemctl restart nginx',
    'systemctl status poweroff.target',
    'systemctl 0',
    // `now` only counts as an operand at the real end of a command
    'halt now, then investigate',
    'echo "shutdown now"',
    // a bare NUMBER is not a command prefix: `uniq -c` counts, TSV rows, numbered plans
    '     12 reboot',
    '12\treboot',
    '1 reboot\n2 shutdown',
    '2 reboot',
    '2026 reboot',
    '12345 reboot',
    // a flag's dashes must be followed by a word char, or arrows/comments/dividers qualify
    '-> reboot',
    '--> reboot',
    '-- reboot',
    '--- reboot ---',
    // a wrapper needs its own operand, or the bare word is just prose
    'timeout shutdown',
    'su reboot',
    // a URL is an ordinary tool argument, not a path to a binary
    'https://api.example.com/v1/shutdown',
    'http://x.io/reboot',
  ]) {
    assert.equal(isDeniedCommand(benign), false, `should be allowed: ${benign}`)
  }
})

test('a bare verb in a config VALUE position is not a command', () => {
  // Treating a quote/bracket as a command separator makes every JSON, YAML and HTML
  // attribute value with a `reboot`/`shutdown` key look like a command in command position.
  // An agent writing a config file or emitting a structured payload is an everyday case, and
  // a denial fails the entire run — so the separator does not count after JSON/attribute
  // punctuation. Quoted PHRASES were always safe; this is specifically the bare quoted verb.
  for (const benign of [
    '{"action": "reboot"}',
    '{"shutdown": true}',
    "{'reboot': False}",
    'policy="reboot"',
    '["reboot", "status"]',
    'action: "reboot"',
    '- "reboot"',
    '<option value="reboot">',
    '{"mode":"poweroff"}',
    "{'action': 'halt'}",
    'onclick="poweroff"',
    'key: "shutdown"',
    '{"a": 1, "b": "reboot"}',
    "value='shutdown'",
    // a call/argument paren introduces a value too, not a command
    'print("reboot")',
    'console.log("reboot")',
    'app.get("/reboot", handler)',
    "INSERT INTO actions (name) VALUES ('reboot')",
    // pretty-printed JSON: the quote is preceded by newline+indent, not by `[` directly
    '{\n  "actions": [\n    "reboot"\n  ]\n}',
    // the phrase forms, which must stay allowed
    '"graceful shutdown"',
    '"shutdown hooks"',
  ]) {
    assert.equal(isDeniedCommand(benign), false, `should be allowed: ${benign}`)
  }
})

test('an unanchored init/systemctl operand rule denied ordinary commands', () => {
  // `\b(?:systemctl|init|telinit)\s+(?:\d\b|…)` fired on any digit operand, so these
  // everyday commands were denied and failed the whole run.
  for (const benign of [
    'git init 2>/dev/null',
    'git init 2>&1',
    'npm init 2',
    'terraform init 1',
    'init 3 replicas',
    'we need to init 2 workers',
    'systemctl 3 status',
    // the word boundary already protected these; pinned so it stays that way
    'initialize the database',
    'initial rollout plan',
    'initiate the handover',
    'the initialization halted midway',
  ]) {
    assert.equal(isDeniedCommand(benign), false, `should be allowed: ${benign}`)
  }
})

test('power-control verbs IN command position are still denied', () => {
  for (const denied of [
    'shutdown -h now',
    'shutdown now',
    'shutdown /s /t 0',
    'shutdown +5',
    'shutdown 19:00',
    'sudo reboot',
    'sudo -i reboot',
    'poweroff',
    'halt',
    '  halt',
    'ls && shutdown -r now',
    'echo hi; poweroff',
    'cat x | halt',
    'cd /tmp\nshutdown -h now',
    'shutdown\necho done',
    // absolute-path and wrapper forms — the ordinary way these actually appear, and all
    // of them were ALLOWED by the first anchoring attempt
    '/sbin/shutdown -h now',
    '/usr/sbin/shutdown -h now',
    'bash -c "shutdown -h now"',
    "sh -c 'poweroff'",
    '"poweroff"',
    '$(shutdown -h now)',
    '$(poweroff)',
    '`reboot`',
    'env X=1 shutdown -h now',
    'X=1 shutdown -h now',
    'nohup shutdown -h +1 &',
    'time reboot',
    'exec poweroff',
    'sudo nohup shutdown -h now',
    // sudo/wrapper forms the `-\w{1,32}` flag alphabet could not reach: `\w` cannot match a
    // GNU long flag (the second `-` is not a word char) and nothing consumed a flag's
    // separate-word value, so all of these were allowed while the substrings had caught them
    'sudo -u root reboot',
    'sudo -n -E -u root reboot',
    'sudo --preserve-env shutdown -h now',
    'sudo --user=root reboot',
    '/usr/bin/sudo reboot',
    'su -c reboot',
    'timeout 5 reboot',
    // no arbitrary cliff on the duration: `timeout 99999 reboot` denied but
    // `timeout 999999 reboot` allowed was the same kind of bound-shaped bug as `\d{1,4}`
    'timeout 99999 reboot',
    'timeout 999999 reboot',
    'timeout 123456789 reboot',
    'setsid reboot',
    // `<verb> now` in an unambiguous command-execution context. Every one of these was
    // allowed when `now` was narrowed to protect `echo "shutdown now"` — the loss was a
    // whole family, not "one more spelling", and $( ) and backticks are not `bash -c` at all.
    'bash -c "shutdown now"',
    'bash -c "reboot now"',
    'sh -c "shutdown now"',
    'zsh -c "halt now"',
    'bash -lc "shutdown now"',
    'sudo bash -c "shutdown now"',
    '$(shutdown now)',
    '`shutdown now`',
    // separator forms that must survive the value-position lookbehind
    'shutdown now; echo bye',
    // controller forms
    'systemctl poweroff',
    'systemctl reboot',
    'systemctl --no-block poweroff',
    'sudo systemctl halt',
    'init 0',
    'init 6',
    'telinit 6',
    'echo x; init 0',
  ]) {
    assert.equal(isDeniedCommand(denied), true, `should be denied: ${denied}`)
  }
})

test('isDeniedCommand stays linear on adversarial leaves', () => {
  // Two separate quadratic bugs have shipped here, and BOTH were invisible to a guard that
  // used the wrong filler character. Keep every shape below.
  //
  //   * an unbounded `\S*\/` path prefix rescanned to end-of-string at every separator
  //     (362ms on a 32 KB leaf);
  //   * a variable-length lookbehind placed BEFORE its character class was evaluated at every
  //     input position, which is quadratic on a run of SPACES specifically — 6947ms on 64 KB.
  //     Tabs ran that same pattern in 1.85ms and the paren/near-miss shape in 4.83ms, so a
  //     guard built from either one passed while the real defect was 3500x over budget.
  //
  // Up to MAX_SCAN_NODES leaves are scanned per tool call, so a per-leaf cost in seconds is a
  // denial of service, not a slow test.
  const shapes: Array<[string, string]> = [
    ['spaces', ' '.repeat(64 * 1024)],
    ['tabs', '\t'.repeat(64 * 1024)],
    ['newline+indent', '\n    '.repeat(13 * 1024)],
    ['quotes', '"'.repeat(64 * 1024)],
    ['parens + near-miss verb', '('.repeat(4000) + 'shutdow'.repeat(4000)],
    ['flag spam', "'" + '-a b '.repeat(8000)],
  ]
  for (const [label, leaf] of shapes) {
    const started = Date.now()
    isDeniedCommand(leaf)
    const elapsed = Date.now() - started
    assert.ok(elapsed < 500, `${label} leaf took ${elapsed}ms; expected well under 500ms`)
  }
})

test('destructive verbs WITH a real object are still denied', () => {
  for (const denied of [
    'DROP TABLE users',
    'drop table users',
    'drop database prod',
    'DROP SCHEMA public CASCADE',
    'drop index idx_messages_room',
    'mkfs /dev/sda',
    'mkfs.ext4 -F /dev/sdb1',
    'format C:',
    'format c:\\',
    'format D: /fs:ntfs',
    'format /dev/sda',
  ]) {
    assert.equal(isDeniedCommand(denied), true, `should be denied: ${denied}`)
  }
})

test('the pre-existing patterns are unchanged', () => {
  assert.equal(isDeniedCommand('rm -rf /home'), true)
  assert.equal(isDeniedCommand('rm -r -f /tmp/project'), true)
  assert.equal(isDeniedCommand('ｒｍ -rf /tmp/project'), true, 'NFKC normalization still applies')
  assert.equal(isDeniedCommand('TRUNCATE TABLE users'), true)
  assert.equal(isDeniedCommand('DELETE FROM users'), true)
  assert.equal(isDeniedCommand('DELETE FROM users WHERE id = 1'), false)
  assert.equal(isDeniedCommand('ls -la'), false)
  assert.equal(isDeniedCommand('echo hello'), false)
})

test('scanArgumentsForDenied reaches string leaves under ANY key name', () => {
  // The old code read arguments['command'] and nothing else, so every one of these was
  // scanned as the empty string and waved through.
  assert.deepEqual(scanArgumentsForDenied({ cmd: 'rm -rf /' }), {
    denied: 'rm -rf /',
    truncated: false,
  })
  assert.equal(scanArgumentsForDenied({ script: 'DROP TABLE users' }).denied, 'DROP TABLE users')
  assert.equal(scanArgumentsForDenied({ args: 'mkfs /dev/sda' }).denied, 'mkfs /dev/sda')
})

test('scanArgumentsForDenied descends into nested objects and arrays', () => {
  assert.equal(scanArgumentsForDenied({ shell: { exec: { run: 'rm -rf /' } } }).denied, 'rm -rf /')
  assert.equal(scanArgumentsForDenied({ argv: ['bash', '-lc', 'rm -rf /'] }).denied, 'rm -rf /')
  assert.equal(
    scanArgumentsForDenied({ steps: [{ name: 'cleanup', run: { command: 'DROP TABLE users' } }] })
      .denied,
    'DROP TABLE users',
  )
  assert.equal(scanArgumentsForDenied([[['format C:']]]).denied, 'format C:')
})

test('scanArgumentsForDenied returns null for clean and non-string payloads', () => {
  assert.deepEqual(scanArgumentsForDenied({ command: 'ls -la' }), {
    denied: null,
    truncated: false,
  })
  assert.equal(scanArgumentsForDenied({ nested: { n: 1, ok: true, nothing: null } }).denied, null)
  assert.equal(scanArgumentsForDenied({}).denied, null)
  assert.equal(scanArgumentsForDenied(undefined).denied, null)
  assert.equal(scanArgumentsForDenied('ls -la').denied, null)
})

test('the walk is breadth-first, so filler cannot bury a shallow command', () => {
  // Depth-first popped the LAST key first, so 10 000 trailing filler keys exhausted the
  // node budget before the payload at the front was ever visited. Breadth-first visits
  // shallow leaves — where a command a tool would actually run sits — first.
  const wideObject: Record<string, unknown> = { a_payload: 'rm -rf /' }
  for (let i = 0; i < 10_000; i++) wideObject[`k${i}`] = 'ls -la'
  assert.equal(scanArgumentsForDenied(wideObject).denied, 'rm -rf /')

  const longArray = ['rm -rf /', ...Array.from({ length: 6000 }, () => 'ls -la')]
  assert.equal(scanArgumentsForDenied({ argv: longArray }).denied, 'rm -rf /')

  // A shallow leaf is still reached when a large subtree sits beside it.
  let deepDecoy: Record<string, unknown> = { leaf: 'ls -la' }
  for (let i = 0; i < 40; i++) deepDecoy = { next: deepDecoy }
  assert.equal(scanArgumentsForDenied({ decoy: deepDecoy, cmd: 'rm -rf /' }).denied, 'rm -rf /')
})

test('exceeding a scan bound reports truncated:true and does NOT deny', () => {
  // Fails open by design — but never silently. run-worker logs tool.scan.truncated on this.
  let tooDeep: Record<string, unknown> = { leaf: 'rm -rf /' }
  for (let i = 0; i < 40; i++) tooDeep = { next: tooDeep }
  assert.deepEqual(scanArgumentsForDenied(tooDeep), { denied: null, truncated: true })

  // A payload past the node cap is missed — and the flag says so, which is the contract.
  const buried: Record<string, unknown> = {}
  for (let i = 0; i < 20_000; i++) buried[`k${i}`] = 'ls -la'
  buried['z_payload'] = 'rm -rf /'
  const result = scanArgumentsForDenied(buried)
  assert.equal(result.denied, null)
  assert.equal(result.truncated, true, 'a missed leaf must be reported, never silent')
})

test('a payload within the bounds reports truncated:false', () => {
  const modest: Record<string, unknown> = { cmd: 'ls -la' }
  for (let i = 0; i < 100; i++) modest[`k${i}`] = 'echo hi'
  assert.deepEqual(scanArgumentsForDenied(modest), { denied: null, truncated: false })
})

test('scanArgumentsForDenied terminates on cyclic input without reporting truncation', () => {
  // A revisit is a cycle, not a bound: the value was already scanned, nothing was missed.
  const cyclic: Record<string, unknown> = { name: 'loop' }
  cyclic['self'] = cyclic
  cyclic['sibling'] = { back: cyclic }
  assert.deepEqual(scanArgumentsForDenied(cyclic), { denied: null, truncated: false })

  // A cycle must not hide a denied leaf reachable within the bounds.
  const cyclicWithPayload: Record<string, unknown> = { cmd: 'rm -rf /' }
  cyclicWithPayload['self'] = cyclicWithPayload
  assert.equal(scanArgumentsForDenied(cyclicWithPayload).denied, 'rm -rf /')
})

test('scanArgumentsForDenied bounds total characters, not just node count and depth', () => {
  // The node and depth caps bound the tree's SHAPE and say nothing about its size. Ten
  // 10 MiB leaves is 11 nodes at depth 2 — inside both caps — and measured 12.4 seconds
  // with truncated:false before this budget existed: no cap tripped, so nothing reported it.
  const fewHuge = { argv: Array.from({ length: 10 }, () => 'a '.repeat(5 * 1024 * 1024)) }
  const started = Date.now()
  const result = scanArgumentsForDenied(fewHuge)
  const elapsedMs = Date.now() - started
  assert.equal(result.denied, null)
  assert.equal(result.truncated, true, 'a few enormous leaves must report truncation')
  assert.ok(
    elapsedMs < 2_000,
    `few-huge-leaf scan took ${elapsedMs}ms — the budget is not bounding it`,
  )
})

test('the character budget is CUMULATIVE, not per-leaf', () => {
  // The assertion that actually pins the design. Every leaf here fits the budget alone, so
  // a per-leaf cap of any size lets all of them through — and a 512 KB per-leaf cap admits
  // 4998 leaves of 511 KB at 261 seconds, an order of magnitude worse than the case the
  // budget exists to bound. Only a running total truncates this input.
  const fitsAlone = 'a '.repeat(64 * 1024) // 128 KB each, comfortably under the budget
  const spread = scanArgumentsForDenied({ argv: Array.from({ length: 16 }, () => fitsAlone) })
  assert.equal(spread.truncated, true, 'a per-leaf cap is not a cumulative cap')
})

test('the character budget still scans realistic tool payloads in full', () => {
  // Guards against over-tightening: a file write and a patch of plausible size must not
  // truncate, or the denylist stops seeing the arguments it exists to inspect.
  const write = scanArgumentsForDenied({ path: 'src/app.ts', content: 'x'.repeat(200 * 1024) })
  assert.deepEqual(write, { denied: null, truncated: false })
  const patch = scanArgumentsForDenied({ diff: 'y'.repeat(800 * 1024) })
  assert.deepEqual(patch, { denied: null, truncated: false })
  // And a denial inside a realistic payload is still found.
  const withPayload = scanArgumentsForDenied({ content: 'z'.repeat(100 * 1024), cmd: 'rm -rf /' })
  assert.equal(withPayload.denied, 'rm -rf /')
})

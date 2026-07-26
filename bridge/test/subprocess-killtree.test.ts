import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { SubprocessAdapter } from '../src/adapters/subprocess-adapter.js'

/**
 * Regression guard for the POSIX kill-tree fix in subprocess-adapter.ts.
 *
 * The adapter spawns the agent CLI with `detached: true` on POSIX so the child leads
 * its own process group, then force-kills the WHOLE group via `process.kill(-pid,
 * 'SIGKILL')`. A bare `process.kill(pid)` would reap only the direct child and orphan
 * grandchildren (the bug this guards against). On Windows the adapter uses `taskkill
 * /T` (tree-aware) and `detached` is off, so this POSIX mechanism test is skipped.
 *
 * Model: `parent` is the detached group leader (== the adapter's CLI child); it spawns
 * a NON-detached `grandchild` which therefore inherits the parent's process group (==
 * what a CLI's own subprocess does). Killing the group (`-parent.pid`) must reap both.
 */
const isPosix = process.platform !== 'win32'
const isWindows = process.platform === 'win32'
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Poll until pid is dead or the budget elapses. */
async function waitDead(pid: number, budgetMs = 3000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await wait(50)
  }
  return !alive(pid)
}

async function waitForFile(path: string, budgetMs = 3000): Promise<string> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try {
      const content = readFileSync(path, 'utf8').trim()
      if (content) return content
    } catch {
      /* not written yet */
    }
    await wait(50)
  }
  throw new Error(`timed out waiting for ${path}`)
}

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'run-killtree',
  room: {
    id: 'room-1',
    name: 'Kill Tree',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  },
  agent: {
    id: 'agent-1',
    name: 'KillTree',
    slug: 'killtree',
    system_prompt: null,
    provider: 'cli',
  },
  trigger_message: {
    id: 'msg-1',
    content: 'cancel',
    sender_type: 'user',
    created_at: '2026-07-26T00:00:00.000Z',
  },
  recent_messages: [
    {
      id: 'msg-1',
      content: 'cancel',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-07-26T00:00:00.000Z',
      metadata: {},
    },
  ],
  round_index: 1,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
}

class WindowsCmdTreeAdapter extends SubprocessAdapter {
  readonly name = 'windows-cmd-tree'

  constructor(
    private readonly shim: string,
    private readonly marker: string,
  ) {
    super()
  }

  protected resolveCommand(): string {
    return this.shim
  }

  protected buildArgs(_packet: ContextPacketV1): string[] {
    return [this.marker]
  }

  protected envVarName(): string {
    return 'WINDOWS_CMD_TREE_BIN'
  }

  protected getTimeoutMs(): number {
    return 0
  }
}

test(
  'POSIX: detached spawn + negative-pid SIGKILL reaps a grandchild (no orphan)',
  { skip: isPosix ? false : 'POSIX-only (Windows uses taskkill /T)' },
  async () => {
    // Parent leads its own group; the grandchild is NOT detached, so it inherits the
    // parent's group — exactly the case the negative-pid group kill must cover.
    const script = `
      const { spawn } = require('node:child_process')
      const gc = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1e9)'], { stdio: 'ignore' })
      process.stdout.write('GC:' + gc.pid + '\\n')
      setInterval(() => {}, 1e9)
    `
    const parent = spawn(process.execPath, ['-e', script], {
      detached: true, // parent leads its own process group (group id == parent.pid)
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const grandchildPid = await new Promise<number>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('no grandchild pid')), 5000)
      parent.stdout.on('data', (d: Buffer) => {
        buf += d.toString()
        const m = buf.match(/GC:(\d+)/)
        if (m) {
          clearTimeout(timer)
          resolve(Number(m[1]))
        }
      })
      parent.on('error', reject)
    })

    assert.ok(parent.pid, 'parent has a pid')
    await wait(150)
    assert.equal(alive(grandchildPid), true, 'grandchild is running before the kill')

    // The fix: kill the whole process group (negative pid), not just the child pid.
    process.kill(-parent.pid!, 'SIGKILL')

    assert.equal(await waitDead(parent.pid!), true, 'parent reaped')
    assert.equal(
      await waitDead(grandchildPid),
      true,
      'grandchild reaped (no orphan) — the kill-tree fix',
    )
  },
)

test(
  'Windows: adapter cancel taskkills a live cmd.exe wrapper process tree',
  { skip: isWindows ? false : 'Windows-only taskkill /T behavior' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentroom adapter kill '))
    const marker = join(dir, 'grandchild.pid')
    const script = join(dir, 'spawn-grandchild.cjs')
    const shim = join(dir, 'agent shim.cmd')
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        "const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' })",
        'fs.writeFileSync(process.argv[2], String(gc.pid))',
        'setInterval(() => {}, 1e9)',
      ].join('\n'),
    )
    writeFileSync(shim, '@echo off\r\nnode "%~dp0spawn-grandchild.cjs" %*\r\n')

    const adapter = new WindowsCmdTreeAdapter(shim, marker)
    const controller = new AbortController()
    const eventsPromise = (async () => {
      const events: AgentEvent[] = []
      for await (const event of adapter.run(packet, controller.signal)) events.push(event)
      return events
    })()

    const grandchildPid = Number(await waitForFile(marker))
    assert.equal(alive(grandchildPid), true, 'grandchild is running before cancel')

    controller.abort()
    const events = await eventsPromise

    assert.deepEqual(events, [
      { type: 'error', run_id: 'run-killtree', message: 'Run was cancelled.' },
    ])
    assert.equal(await waitDead(grandchildPid), true, 'grandchild reaped by taskkill /T')
  },
)

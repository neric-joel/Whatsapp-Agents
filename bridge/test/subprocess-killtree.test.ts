import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

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

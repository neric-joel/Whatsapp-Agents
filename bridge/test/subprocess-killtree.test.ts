import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

/**
 * Regression guard for the POSIX kill-tree fix in subprocess-adapter.ts.
 *
 * The adapter spawns children with `detached: true` on POSIX so each child leads
 * its own process group, and force-kills the WHOLE group via `process.kill(-pid,
 * 'SIGKILL')`. A bare `process.kill(pid)` would reap only the direct child and
 * orphan grandchildren (the bug this guards against). On Windows the adapter uses
 * `taskkill /T` (tree-aware) and `detached` is intentionally off, so this POSIX
 * mechanism test is skipped there.
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

test(
  'POSIX: detached spawn + negative-pid SIGKILL reaps a grandchild (no orphan)',
  { skip: isPosix ? false : 'POSIX-only (Windows uses taskkill /T)' },
  async () => {
    // Parent (group leader) spawns a long-lived detached grandchild and prints its
    // pid, then idles. Mirrors what an agent CLI subprocess tree looks like.
    const script = `
      const { spawn } = require('node:child_process')
      const gc = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1e9)'], { detached: true, stdio: 'ignore' })
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
    await wait(300)

    assert.equal(alive(parent.pid!), false, 'parent reaped')
    assert.equal(alive(grandchildPid), false, 'grandchild reaped (no orphan) — the kill-tree fix')
  },
)

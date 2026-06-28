import type { getDb } from '@agentroom/db'

type Db = ReturnType<typeof getDb>

/**
 * Write a fresh heartbeat timestamp to the given in-flight runs. Extracted from the daemon
 * loop so it is unit-testable (the loop supplies the active run ids + the clock). A no-op for
 * an empty set. Returns the number of runs whose heartbeat was bumped.
 *
 * Stale-run recovery (stale-runs.ts) is the CONSUMER of heartbeat_at; this is the producer —
 * a regression here (dropped heartbeats, wrong ids) would otherwise only surface indirectly as
 * spurious stale-failures, so it gets its own test.
 */
export function writeHeartbeats(db: Db, runIds: readonly string[], now: string): number {
  if (runIds.length === 0) return 0
  db.prepare(
    `UPDATE agent_runs SET heartbeat_at = ? WHERE id IN (${runIds.map(() => '?').join(',')})`,
  ).run(now, ...runIds)
  return runIds.length
}

export type AgentRunStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

const CANCELLABLE_STATUSES = new Set<AgentRunStatus>(['queued', 'claimed', 'running'])

export function isCancellableRunStatus(status: AgentRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status)
}

export function buildCancelledRunPatch(cancelledAt = new Date().toISOString()) {
  return {
    status: 'cancelled' as const,
    error_message: 'Cancelled by user',
    completed_at: cancelledAt,
  }
}


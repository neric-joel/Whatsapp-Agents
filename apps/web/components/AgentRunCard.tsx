'use client'

type RunStatus = 'queued' | 'running' | 'completed' | 'failed'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export interface AgentRunCardProps {
  run: {
    id: string
    status: RunStatus
    error_message?: string | null
    error?: string | null
    agents: { name: string; provider: string } | null
  }
  onRetry?: () => void
}

const statusLabel: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

const statusClass: Record<RunStatus, string> = {
  queued: 'bg-gray-200 text-gray-600',
  running: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function AgentRunCard({ run, onRetry }: AgentRunCardProps) {
  const { status, agents } = run
  const error = run.error ?? run.error_message

  return (
    <div className="mx-5 my-2 rounded-xl border border-gray-100 bg-[#F8F8F8] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-700">
          <span className="text-[11px] font-semibold text-white">
            {agents ? initials(agents.name) : 'AG'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium text-purple-700">
              {agents?.name ?? 'Agent'}
            </span>
            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusClass[status]}`}>
              {statusLabel[status]}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            {status === 'running' ? (
              <>
                <span>Thinking</span>
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1 w-1 rounded-full bg-purple-500 animate-pulse"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              </>
            ) : (
              <span>{status === 'queued' ? 'Waiting to respond' : statusLabel[status]}</span>
            )}
          </div>
          {status === 'failed' && error && (
            <p className="mt-2 line-clamp-2 text-xs text-red-600">{error}</p>
          )}
          {status === 'failed' && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

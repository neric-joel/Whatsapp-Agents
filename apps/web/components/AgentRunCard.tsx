'use client'

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export interface AgentRunCardProps {
  run: {
    id: string
    status: 'queued' | 'running' | 'failed'
    error_message?: string | null
    error?: string | null
    agents: { name: string; provider: string } | null
  }
  onRetry?: () => void
}

export default function AgentRunCard({ run, onRetry }: AgentRunCardProps) {
  const { status, agents } = run
  const statusText = status === 'queued' ? 'Waiting to respond...' : 'Thinking...'

  if (status === 'failed') {
    return (
      <div className="mx-4 my-1 rounded-xl border border-red-800/30 bg-red-950/20 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-red-400 text-xs font-medium">Failed - {agents?.name ?? 'Agent'}</span>
          {onRetry && (
            <button onClick={onRetry} className="text-[#52525b] hover:text-[#f4f4f5] text-xs transition-colors">
              Retry
            </button>
          )}
        </div>
        {(run.error ?? run.error_message) && (
          <p className="text-[#52525b] text-xs mt-1 line-clamp-2">{run.error ?? run.error_message}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-row items-center gap-3 px-4 py-3 mx-4 my-1 rounded-xl bg-[#18181b] border border-dashed border-[#27272a]">
      <div className="w-7 h-7 rounded-full bg-[#27272a] flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] text-[#52525b]">
          {agents ? initials(agents.name) : 'AG'}
        </span>
      </div>
      <div className="flex flex-col flex-1">
        <span className="text-[#f4f4f5] text-[13px]">{agents?.name ?? 'Agent'}</span>
        <span className="text-[#52525b] text-[11px]">{statusText}</span>
      </div>
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-[#52525b] animate-pulse"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  )
}

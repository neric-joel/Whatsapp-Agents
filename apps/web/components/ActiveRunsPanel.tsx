'use client'
import { useAgentRuns } from '@/hooks/useAgentRuns'

interface Props {
  roomId: string
}

const statusClassName = {
  queued: 'border-[#27272a] bg-[#18181b] text-[#71717a]',
  running: 'border-[#8b5cf6]/30 bg-[#8b5cf6]/10 text-[#8b5cf6]',
  failed: 'border-red-800/30 bg-red-950/20 text-red-400',
} as const

export default function ActiveRunsPanel({ roomId }: Props) {
  const { runs, loading } = useAgentRuns(roomId)
  const activeRuns = runs.filter((run) => ['queued', 'running', 'failed'].includes(run.status))

  return (
    <section className="border-b border-[#27272a]">
      <div className="border-b border-[#27272a] px-3 py-2 text-xs font-medium uppercase tracking-widest text-[#71717a]">
        Active Runs
      </div>
      <div className="space-y-2 p-3">
        {loading ? (
          <p className="text-xs text-[#52525b]">Loading runs...</p>
        ) : activeRuns.length === 0 ? (
          <p className="text-center text-xs text-[#52525b]">No active runs.</p>
        ) : (
          activeRuns.map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#27272a] bg-[#18181b] p-2">
              <span className="min-w-0 truncate text-sm font-medium text-[#f4f4f5]">
                {run.agents?.name ?? 'Agent'}
              </span>
              <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClassName[run.status]}`}>
                {run.status}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

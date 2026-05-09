function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export interface AgentRunCardProps {
  run: {
    id: string
    status: 'queued' | 'running'
    agents: { name: string; provider: string } | null
  }
}

export default function AgentRunCard({ run }: AgentRunCardProps) {
  const { status, agents } = run
  const statusText = status === 'queued' ? 'Waiting to respond...' : 'Thinking...'

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

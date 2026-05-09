'use client'

interface ToolCallCardProps {
  toolCall: {
    id: string
    tool_name: string
    input_args: Record<string, unknown>
    output: string | Record<string, unknown> | null
    status: string
    error: string | null
  }
  onApprove: () => void
  onDeny: () => void
}

function preview(value: string | Record<string, unknown> | null, lines: number) {
  if (!value) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.split('\n').slice(0, lines).join('\n')
}

export default function ToolCallCard({ toolCall, onApprove, onDeny }: ToolCallCardProps) {
  return (
    <div className="mx-4 my-2 rounded-xl border border-[#27272a] bg-[#18181b] p-3 text-sm text-[#f4f4f5]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium">{toolCall.tool_name}</span>
        <span className="text-xs text-[#52525b]">{toolCall.status}</span>
      </div>

      {toolCall.status === 'waiting_approval' && (
        <>
          <pre className="max-h-[15rem] overflow-hidden whitespace-pre-wrap rounded-lg bg-[#09090b] p-2 text-xs text-[#d4d4d8]">
            {JSON.stringify(toolCall.input_args, null, 2).split('\n').slice(0, 10).join('\n')}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onApprove}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onDeny}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
            >
              Deny
            </button>
          </div>
        </>
      )}

      {(toolCall.status === 'approved' || toolCall.status === 'running') && (
        <div className="flex items-center gap-2 text-[#d4d4d8]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#52525b] border-t-[#8b5cf6]" />
          <span>Running...</span>
        </div>
      )}

      {toolCall.status === 'succeeded' && (
        <div className="text-emerald-400">
          <div className="mb-1">✓ Succeeded</div>
          {toolCall.output && <pre className="whitespace-pre-wrap text-xs text-[#d4d4d8]">{preview(toolCall.output, 3)}</pre>}
        </div>
      )}

      {toolCall.status === 'denied' && (
        <div className="text-red-400">Denied</div>
      )}

      {toolCall.status === 'failed' && (
        <div className="text-red-400">
          <div className="mb-1">✕ Failed</div>
          {toolCall.error && <div className="text-xs">{toolCall.error}</div>}
        </div>
      )}
    </div>
  )
}

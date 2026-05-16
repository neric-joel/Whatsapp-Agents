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
    <div className="mx-5 my-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-sm text-[var(--text)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium">{toolCall.tool_name}</span>
        <span className="text-xs text-gray-500">{toolCall.status}</span>
      </div>

      {toolCall.status === 'waiting_approval' && (
        <>
          <pre className="max-h-[15rem] overflow-hidden whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-700">
            {JSON.stringify(toolCall.input_args, null, 2).split('\n').slice(0, 10).join('\n')}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onApprove}
              className="rounded-lg bg-[#2EB67D] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onDeny}
              className="rounded-lg bg-[#E01E5A] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
            >
              Deny
            </button>
          </div>
        </>
      )}

      {(toolCall.status === 'approved' || toolCall.status === 'running') && (
        <div className="flex items-center gap-2 text-gray-600">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-purple-700" />
          <span>Running...</span>
        </div>
      )}

      {toolCall.status === 'succeeded' && (
        <div className="text-green-700">
          <div className="mb-1">Succeeded</div>
          {toolCall.output && <pre className="whitespace-pre-wrap text-xs text-gray-700">{preview(toolCall.output, 3)}</pre>}
        </div>
      )}

      {toolCall.status === 'denied' && (
        <div className="text-red-600">Denied</div>
      )}

      {toolCall.status === 'failed' && (
        <div className="text-red-600">
          <div className="mb-1">Failed</div>
          {toolCall.error && <div className="text-xs">{toolCall.error}</div>}
        </div>
      )}
    </div>
  )
}

export type TimelineMessageLike = {
  id: string
  created_at: string
}

export type TimelineRunLike = {
  id: string
  trigger_msg_id: string | null
  created_at: string
}

export type TimelineEvent<TMessage extends TimelineMessageLike, TRun extends TimelineRunLike> =
  | { type: 'message'; id: string; message: TMessage }
  | { type: 'run'; id: string; run: TRun }

export function buildTimelineEvents<
  TMessage extends TimelineMessageLike,
  TRun extends TimelineRunLike,
>(messages: TMessage[], runs: TRun[]): Array<TimelineEvent<TMessage, TRun>> {
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const decoratedMessages = messages.map((message, index) => ({
    type: 'message' as const,
    id: `message-${message.id}`,
    message,
    sortTime: timestamp(message.created_at),
    rank: 0,
    tie: index,
  }))

  const decoratedRuns = runs.map((run, index) => {
    const triggerMessage = run.trigger_msg_id ? messageById.get(run.trigger_msg_id) : undefined
    return {
      type: 'run' as const,
      id: `run-${run.id}`,
      run,
      sortTime: timestamp(triggerMessage?.created_at ?? run.created_at),
      rank: triggerMessage ? 1 : 0.5,
      tie: timestamp(run.created_at) + index / 1000,
    }
  })

  return [...decoratedMessages, ...decoratedRuns]
    .sort((a, b) => a.sortTime - b.sortTime || a.rank - b.rank || a.tie - b.tie)
    .map((event) =>
      event.type === 'message'
        ? { type: 'message', id: event.id, message: event.message }
        : { type: 'run', id: event.id, run: event.run },
    )
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

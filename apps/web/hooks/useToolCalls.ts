'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface ToolCallRow {
  id: string
  room_id: string
  tool_name: string
  input_args: Record<string, unknown>
  output: string | Record<string, unknown> | null
  status: string
  error: string | null
}

export function useToolCalls(roomId: string) {
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.from('tool_calls').select('*')
      .eq('room_id', roomId)
      .in('status', ['waiting_approval', 'approved', 'running', 'succeeded', 'failed', 'denied'])
      .then(({ data }) => setToolCalls((data as ToolCallRow[]) ?? []))

    const sub = supabase.channel(`toolcalls:${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tool_calls',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') setToolCalls((p) => [...p, payload.new as ToolCallRow])
        else if (payload.eventType === 'UPDATE') setToolCalls((p) => p.map((tc) => tc.id === payload.new.id ? payload.new as ToolCallRow : tc))
      }).subscribe()
    return () => { void sub.unsubscribe() }
  }, [roomId])

  return toolCalls
}

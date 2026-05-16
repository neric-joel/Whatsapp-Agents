type DeleteResult = {
  error: { message: string } | null
}

export type RoomChatDeleteClient = {
  from(table: string): {
    delete(): {
      eq(column: string, value: string): PromiseLike<DeleteResult>
    }
  }
}

export async function clearRoomChat(supabase: RoomChatDeleteClient, roomId: string): Promise<void> {
  for (const table of ['tool_calls', 'agent_runs', 'messages']) {
    const { error } = await supabase.from(table).delete().eq('room_id', roomId)
    if (error) throw new Error(error.message)
  }
}

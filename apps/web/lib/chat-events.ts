const CHAT_CLEARED_EVENT = 'agentroom:chat-cleared'

export function notifyChatCleared(roomId: string) {
  window.dispatchEvent(new CustomEvent(CHAT_CLEARED_EVENT, { detail: { roomId } }))
}

export function subscribeToChatCleared(roomId: string, callback: () => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ roomId?: string }>).detail
    if (detail?.roomId === roomId) callback()
  }

  window.addEventListener(CHAT_CLEARED_EVENT, handler)
  return () => window.removeEventListener(CHAT_CLEARED_EVENT, handler)
}

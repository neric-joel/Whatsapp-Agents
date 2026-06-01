export const DELETED_MESSAGE_CONTENT = 'This message was deleted.'

interface DeletableMessage {
  sender_type: string
  sender_user_id: string | null
}

export function canCurrentUserDeleteMessage(message: DeletableMessage, userId: string) {
  return message.sender_type === 'user' && message.sender_user_id === userId
}

export function createDeletedMessagePatch() {
  return { content: DELETED_MESSAGE_CONTENT }
}

export interface PinMessageRow {
  id: string
  message_id: string | null
  is_active: boolean
}

export type PinsByMessageId = Record<string, string>

export function buildPinsByMessageId(pins: PinMessageRow[]): PinsByMessageId {
  return pins.reduce<PinsByMessageId>((acc, pin) => {
    if (pin.is_active && pin.message_id) {
      acc[pin.message_id] = pin.id
    }
    return acc
  }, {})
}

export function applyPinnedItemChange(current: PinsByMessageId, pin: PinMessageRow): PinsByMessageId {
  if (!pin.message_id) return current

  if (pin.is_active) {
    return { ...current, [pin.message_id]: pin.id }
  }

  if (current[pin.message_id] !== pin.id) return current

  const next = { ...current }
  delete next[pin.message_id]
  return next
}

export function removePinnedItemById(current: PinsByMessageId, pinId: string): PinsByMessageId {
  const entry = Object.entries(current).find(([, currentPinId]) => currentPinId === pinId)
  if (!entry) return current

  const next = { ...current }
  delete next[entry[0]]
  return next
}

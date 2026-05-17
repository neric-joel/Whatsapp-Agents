import { describe, expect, it } from 'vitest'
import { applyPinnedItemChange, buildPinsByMessageId, removePinnedItemById } from '../pins'

describe('pin message state helpers', () => {
  it('maps active message pins to their message ids', () => {
    expect(buildPinsByMessageId([
      { id: 'pin-1', message_id: 'message-1', is_active: true },
      { id: 'pin-2', message_id: 'message-2', is_active: false },
      { id: 'pin-3', message_id: null, is_active: true },
    ])).toEqual({ 'message-1': 'pin-1' })
  })

  it('adds active realtime pin changes and removes inactive changes', () => {
    const withPin = applyPinnedItemChange({}, { id: 'pin-1', message_id: 'message-1', is_active: true })
    expect(withPin).toEqual({ 'message-1': 'pin-1' })

    expect(applyPinnedItemChange(withPin, {
      id: 'pin-1',
      message_id: 'message-1',
      is_active: false,
    })).toEqual({})
  })

  it('removes pins by id when realtime delete payloads do not include message ids', () => {
    expect(removePinnedItemById({ 'message-1': 'pin-1', 'message-2': 'pin-2' }, 'pin-1')).toEqual({
      'message-2': 'pin-2',
    })
  })
})

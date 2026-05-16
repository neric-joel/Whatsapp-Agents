import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyChatCleared, subscribeToChatCleared } from '../chat-events'

describe('chat cleared events', () => {
  beforeEach(() => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    vi.stubGlobal('CustomEvent', class<T = unknown> extends Event {
      detail: T

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type)
        this.detail = init?.detail as T
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('notifies only subscribers for the cleared room', () => {
    const roomOne = vi.fn()
    const roomTwo = vi.fn()
    const unsubscribeOne = subscribeToChatCleared('room-1', roomOne)
    const unsubscribeTwo = subscribeToChatCleared('room-2', roomTwo)

    notifyChatCleared('room-1')

    expect(roomOne).toHaveBeenCalledTimes(1)
    expect(roomTwo).not.toHaveBeenCalled()

    unsubscribeOne()
    unsubscribeTwo()
  })
})

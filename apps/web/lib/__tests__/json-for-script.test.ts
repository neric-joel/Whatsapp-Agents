import { describe, expect, it } from 'vitest'

import { jsonForScript } from '../json-for-script'

describe('jsonForScript', () => {
  it('escapes `<` so a `</script>` substring cannot survive serialization', () => {
    const hostile = '</script><script>alert(1)</script>'
    const serialized = jsonForScript(hostile)
    expect(serialized).not.toContain('</script')
    expect(serialized).toContain('\\u003c/script>')
  })

  it('round-trips through JSON.parse back to the original value', () => {
    const hostile = '</script><img src=x onerror=alert(1)>'
    const serialized = jsonForScript(hostile)
    const parsed: unknown = JSON.parse(serialized)
    expect(parsed).toBe(hostile)
  })

  it('behaves like plain JSON.stringify for values with no `<`', () => {
    expect(jsonForScript('agentroom-theme')).toBe(JSON.stringify('agentroom-theme'))
    expect(jsonForScript(['a', 'b', 'c'])).toBe(JSON.stringify(['a', 'b', 'c']))
  })
})

import { describe, expect, it } from 'vitest'

import { normalizeMathDelimiters } from '../math-format'

describe('normalizeMathDelimiters', () => {
  it('converts display TeX brackets to remark-math block delimiters', () => {
    expect(normalizeMathDelimiters(String.raw`Start \[x^2\] end`)).toBe('Start $$x^2$$ end')
  })

  it('converts inline TeX parentheses to remark-math inline delimiters', () => {
    expect(normalizeMathDelimiters(String.raw`Use \(a+b\).`)).toBe('Use $a+b$.')
  })
})

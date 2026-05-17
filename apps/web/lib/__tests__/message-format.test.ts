import { describe, expect, it } from 'vitest'
import { parseInlineMarkdown, splitMessageBlocks } from '../message-format'

describe('splitMessageBlocks', () => {
  it('keeps paragraphs separated by blank lines', () => {
    expect(splitMessageBlocks('First line\nstill first\n\nSecond')).toEqual([
      { type: 'paragraph', text: 'First line\nstill first' },
      { type: 'paragraph', text: 'Second' },
    ])
  })

  it('groups markdown-style bullet lines as list items', () => {
    expect(splitMessageBlocks('Plan:\n- One\n- Two')).toEqual([
      { type: 'paragraph', text: 'Plan:' },
      { type: 'list', items: ['One', 'Two'] },
    ])
  })

  it('keeps fenced code as code text', () => {
    expect(splitMessageBlocks('Use:\n```ts\nconst x = 1\n```')).toEqual([
      { type: 'paragraph', text: 'Use:' },
      { type: 'code', text: 'const x = 1' },
    ])
  })

  it('parses inline bold, italic, and code spans', () => {
    expect(parseInlineMarkdown('Use **bold**, *italic*, and `code`.')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ', ' },
      { type: 'italic', text: 'italic' },
      { type: 'text', text: ', and ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: '.' },
    ])
  })

  it('leaves unclosed markdown markers as text', () => {
    expect(parseInlineMarkdown('This is **not closed')).toEqual([
      { type: 'text', text: 'This is **not closed' },
    ])
  })
})

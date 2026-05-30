export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string }

export type InlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }

export function splitMessageBlocks(content: string): MessageBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MessageBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let code: string[] | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
    paragraph = []
  }

  const flushList = () => {
    if (list.length === 0) return
    blocks.push({ type: 'list', items: list })
    list = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push({ type: 'code', text: code.join('\n') })
        code = null
      } else {
        flushParagraph()
        flushList()
        code = []
      }
      continue
    }

    if (code) {
      code.push(line)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    const listMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      list.push(listMatch[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  if (code) blocks.push({ type: 'code', text: code.join('\n') })

  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text: '' }]
}

export function parseInlineMarkdown(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let index = 0

  const pushText = (value: string) => {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous?.type === 'text') previous.text += value
    else segments.push({ type: 'text', text: value })
  }

  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1)
      if (end > index + 1) {
        segments.push({ type: 'code', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2)
      if (end > index + 2) {
        segments.push({ type: 'bold', text: text.slice(index + 2, end) })
        index = end + 2
        continue
      }
    }

    if (text[index] === '*' && text[index + 1] !== '*') {
      const end = text.indexOf('*', index + 1)
      if (end > index + 1 && text[end + 1] !== '*') {
        segments.push({ type: 'italic', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    const nextMarkers = [
      text.indexOf('`', index + 1),
      text.indexOf('**', index + 1),
      text.indexOf('*', index + 1),
    ].filter((position) => position !== -1)
    const nextIndex = nextMarkers.length > 0 ? Math.min(...nextMarkers) : text.length
    pushText(text.slice(index, nextIndex))
    index = nextIndex
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: '' }]
}

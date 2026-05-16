export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
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
      list.push(listMatch[1])
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

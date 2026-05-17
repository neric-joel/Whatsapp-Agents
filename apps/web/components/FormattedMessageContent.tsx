'use client'

import { parseInlineMarkdown, splitMessageBlocks } from '@/lib/message-format'

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((segment, index) => {
        if (segment.type === 'bold') return <strong key={index} className="font-semibold">{segment.text}</strong>
        if (segment.type === 'italic') return <em key={index}>{segment.text}</em>
        if (segment.type === 'code') {
          return (
            <code key={index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">
              {segment.text}
            </code>
          )
        }
        return <span key={index}>{segment.text}</span>
      })}
    </>
  )
}

export default function FormattedMessageContent({ content }: { content: string }) {
  const blocks = splitMessageBlocks(content)

  return (
    <div className="space-y-3 break-words">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre key={index} className="max-h-72 overflow-auto rounded-md border border-current/10 bg-white/65 p-3 text-xs leading-5">
              <code>{block.text}</code>
            </pre>
          )
        }

        if (block.type === 'list') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="whitespace-pre-wrap"><InlineMarkdown text={item} /></li>
              ))}
            </ul>
          )
        }

        return <p key={index} className="whitespace-pre-wrap"><InlineMarkdown text={block.text} /></p>
      })}
    </div>
  )
}

'use client'

import { splitMessageBlocks } from '@/lib/message-format'

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
                <li key={itemIndex} className="whitespace-pre-wrap">{item}</li>
              ))}
            </ul>
          )
        }

        return <p key={index} className="whitespace-pre-wrap">{block.text}</p>
      })}
    </div>
  )
}

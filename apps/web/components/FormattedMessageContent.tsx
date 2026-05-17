'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { normalizeMathDelimiters } from '@/lib/math-format'

export default function FormattedMessageContent({ content }: { content: string }) {
  return (
    <div className="message-markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="whitespace-normal">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="mb-3 max-h-72 overflow-auto rounded-md border border-current/10 bg-white/65 p-3 text-xs leading-5 last:mb-0">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-current/15" />,
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  )
}

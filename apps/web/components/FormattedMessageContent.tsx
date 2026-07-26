'use client'

import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { normalizeMathDelimiters } from '@/lib/math-format'

export default function FormattedMessageContent({ content }: { content: string }) {
  return (
    <div className="message-markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="whitespace-normal">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            // Inline code: background/contrast handled theme-aware in globals.css
            // (.message-markdown :not(pre) > code) so it stays legible on all themes.
            return <code className="font-mono">{children}</code>
          },
          pre: ({ children }) => (
            // Background + border are theme-aware via globals.css (.message-markdown pre).
            <pre className="mb-3 max-h-72 overflow-auto rounded-md p-3 text-xs leading-5 last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="min-w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_6%,transparent)]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-[var(--border)] last:border-b-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th
              scope="col"
              className="border border-[var(--border)] px-3 py-2 text-left font-semibold"
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--border)] px-3 py-2 align-top">{children}</td>
          ),
          hr: () => <hr className="my-3 border-current/15" />,
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  )
}

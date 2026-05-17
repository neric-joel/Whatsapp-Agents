import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatFilesForPrompt } from '../src/context/file-context.js'

test('formats extracted image text so agents can answer screenshot questions', () => {
  const prompt = formatFilesForPrompt([
    {
      id: 'file-1',
      filename: 'equation.png',
      mime_type: 'image/png',
      size_bytes: 3587,
      extracted_text_preview: String.raw`\int_0^{\pi/2} \frac{dx}{(1+\tan x)^2}`,
    },
  ])

  assert.match(prompt, /Attached files/)
  assert.match(prompt, /equation\.png/)
  assert.match(prompt, /Extracted image\/file text:/)
  assert.match(prompt, /\\int_0\^\{\\pi\/2\}/)
})

test('warns clearly when an image attachment has no extracted text', () => {
  const prompt = formatFilesForPrompt([
    {
      id: 'file-1',
      filename: 'screenshot.png',
      mime_type: 'image/png',
      size_bytes: 3587,
      extracted_text_preview: null,
    },
  ])

  assert.match(prompt, /No extracted text is available/)
})

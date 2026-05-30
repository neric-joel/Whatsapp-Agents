import type { SupabaseClient } from '@supabase/supabase-js'

export interface ContextFilePreview {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  extracted_text_preview: string | null
}

export interface FilePreviewRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_path: string
  storage_bucket: string
  extracted_text: string | null
  metadata?: Record<string, unknown> | null
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_VISION_MODEL = 'gpt-4.1-mini'

export function formatFilesForPrompt(files?: ContextFilePreview[]): string | null {
  if (!files || files.length === 0) return null

  const lines = [
    'Attached files:',
    'Use the extracted text below as part of the current problem when relevant. If the user asks to solve a screenshot, the extracted math/text is the problem statement.',
  ]

  files.forEach((file, index) => {
    lines.push(`${index + 1}. ${file.filename} (${file.mime_type}, ${formatBytes(file.size_bytes)})`)
    if (file.extracted_text_preview?.trim()) {
      lines.push('Extracted image/file text:')
      lines.push(file.extracted_text_preview.trim())
    } else {
      lines.push('No extracted text is available for this attachment.')
    }
  })

  return lines.join('\n')
}

export async function hydrateFilePreviews(
  supabase: SupabaseClient,
  fileRows: FilePreviewRow[],
): Promise<ContextFilePreview[]> {
  const hydrated: ContextFilePreview[] = []

  for (const file of fileRows) {
    const extractedText = file.extracted_text ?? await extractAndPersistImageText(supabase, file)
    hydrated.push({
      id: file.id,
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      extracted_text_preview: extractedText ? extractedText.slice(0, 1200) : null,
    })
  }

  return hydrated
}

/**
 * Whether to send image attachments to OpenAI for text/OCR extraction.
 *
 * This egresses user-uploaded image bytes to a third party (OpenAI), so it is
 * OFF by default and must be explicitly opted into: set
 * ENABLE_IMAGE_TEXT_EXTRACTION=true AND provide OPENAI_API_KEY. Documented in
 * bridge/.env.example.
 */
function imageExtractionEnabled(): boolean {
  return process.env.ENABLE_IMAGE_TEXT_EXTRACTION === 'true' && Boolean(process.env.OPENAI_API_KEY)
}

async function extractAndPersistImageText(
  supabase: SupabaseClient,
  file: FilePreviewRow,
): Promise<string | null> {
  if (!imageExtractionEnabled()) return null
  if (!file.mime_type.startsWith('image/')) return null
  if (file.size_bytes > MAX_IMAGE_BYTES) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  try {
    const { data, error } = await supabase.storage
      .from(file.storage_bucket)
      .download(file.storage_path)
    if (error || !data) return null

    const base64 = Buffer.from(await data.arrayBuffer()).toString('base64')
    const extractedText = await extractImageTextWithOpenAI({
      apiKey,
      mimeType: file.mime_type,
      base64,
      filename: file.filename,
    })

    if (!extractedText) return null

    await supabase
      .from('files')
      .update({
        extracted_text: extractedText,
        metadata: {
          ...(file.metadata ?? {}),
          extraction: { provider: 'openai', model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL },
        },
      })
      .eq('id', file.id)

    return extractedText
  } catch (error) {
    console.warn(`File text extraction failed for ${file.id}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function extractImageTextWithOpenAI({
  apiKey,
  mimeType,
  base64,
  filename,
}: {
  apiKey: string
  mimeType: string
  base64: string
  filename: string
}): Promise<string | null> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Extract all visible text and mathematical notation from this image. If it is a math expression, return clean LaTeX. Do not solve it. Return only the extracted content.',
            },
            {
              type: 'input_image',
              image_url: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
      max_output_tokens: 600,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI vision extraction failed for ${filename}: HTTP ${response.status}`)
  }

  const json = await response.json() as { output_text?: unknown; output?: unknown }
  if (typeof json.output_text === 'string') return json.output_text.trim() || null

  return extractTextFromResponsesOutput(json.output)
}

function extractTextFromResponsesOutput(output: unknown): string | null {
  if (!Array.isArray(output)) return null
  const parts: string[] = []

  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string') {
        parts.push(content.text)
      }
    }
  }

  const text = parts.join('\n').trim()
  return text || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(1)} KB`
}

import { describe, expect, it } from 'vitest'

import { getImageFilesFromClipboardItems } from '../pasted-files'

describe('pasted files', () => {
  it('extracts image files from clipboard items', () => {
    const png = { name: 'shot.png', type: 'image/png' } as File
    const text = { name: 'note.txt', type: 'text/plain' } as File
    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'text/plain', getAsFile: () => text },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ] as unknown as DataTransferItemList

    expect(getImageFilesFromClipboardItems(items)).toEqual([png])
  })

  it('ignores empty clipboard file items', () => {
    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => null },
    ] as unknown as DataTransferItemList

    expect(getImageFilesFromClipboardItems(items)).toEqual([])
  })
})

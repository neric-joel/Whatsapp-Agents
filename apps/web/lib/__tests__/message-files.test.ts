import { describe, expect, it } from 'vitest'

import { fileIdsFromMessages, unresolvedFileIds } from '../message-files'

describe('message file lookup helpers', () => {
  it('extracts unique string file ids from message metadata', () => {
    expect(
      fileIdsFromMessages([
        { metadata: { file_ids: ['file-1', 'file-2', 'file-1', 7] } },
        { metadata: { file_ids: ['file-3'] } },
        { metadata: {} },
      ]),
    ).toEqual(['file-1', 'file-2', 'file-3'])
  })

  it('excludes files already loaded or negatively cached', () => {
    expect(
      unresolvedFileIds(
        ['file-1', 'file-2', 'missing-1', 'missing-2'],
        { 'file-1': { id: 'file-1' } },
        new Set(['missing-1']),
      ),
    ).toEqual(['file-2', 'missing-2'])
  })
})

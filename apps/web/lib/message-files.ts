export function fileIdsFromMessages(messages: Array<{ metadata: Record<string, unknown> }>) {
  return [
    ...new Set(
      messages.flatMap((message) => {
        const ids = (message.metadata as { file_ids?: unknown }).file_ids
        return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
      }),
    ),
  ]
}

export function unresolvedFileIds(
  fileIds: string[],
  filesMap: Record<string, unknown>,
  knownMissingIds: ReadonlySet<string>,
) {
  return fileIds.filter((id) => !filesMap[id] && !knownMissingIds.has(id))
}

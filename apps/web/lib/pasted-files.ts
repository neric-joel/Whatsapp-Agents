export function getImageFilesFromClipboardItems(items: DataTransferItemList | null): File[] {
  if (!items) return []

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

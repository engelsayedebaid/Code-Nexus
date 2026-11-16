export const IDE_SCRATCH_PREVIEW_FILE_EVENT = 'ide:scratch-preview-file'

export function revealIdeScratchPreviewFile(relativePath: string): void {
  window.dispatchEvent(
    new CustomEvent<string>(IDE_SCRATCH_PREVIEW_FILE_EVENT, { detail: relativePath })
  )
}

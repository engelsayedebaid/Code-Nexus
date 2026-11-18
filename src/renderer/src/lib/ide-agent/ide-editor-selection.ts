export type ActiveIdeEditorSelection = {
  relativePath: string
  startLine: number
  endLine: number
  text: string
  updatedAt: number
}

let latestEditorSelection: ActiveIdeEditorSelection | null = null

export function recordIdeEditorSelection(selection: ActiveIdeEditorSelection | null): void {
  latestEditorSelection = selection
}

export function getActiveIdeEditorSelection(
  expectedRelativePath?: string
): ActiveIdeEditorSelection | null {
  if (!latestEditorSelection || !latestEditorSelection.text.trim()) {
    return null
  }
  if (
    expectedRelativePath &&
    latestEditorSelection.relativePath.toLowerCase() !== expectedRelativePath.toLowerCase()
  ) {
    return null
  }
  return latestEditorSelection
}

export function installIdeSelectionTracking<
  TSelection extends {
    isEmpty: () => boolean
    startLineNumber: number
    endLineNumber: number
  }
>(
  editorInstance: {
    getModel: () => { getValueInRange: (range: TSelection) => string } | null
    getSelection: () => TSelection | null
    onDidChangeCursorSelection: (listener: () => void) => { dispose: () => void }
  },
  getRelativePath: () => string | undefined
): { dispose: () => void } {
  const sub = editorInstance.onDidChangeCursorSelection(() => {
    const model = editorInstance.getModel()
    const sel = editorInstance.getSelection()
    const rel = getRelativePath()
    if (!model || !sel || sel.isEmpty() || !rel) {
      if (!rel || latestEditorSelection?.relativePath.toLowerCase() === rel.toLowerCase()) {
        recordIdeEditorSelection(null)
      }
      return
    }
    const selectedText = model.getValueInRange(sel)
    if (!selectedText.trim()) {
      if (latestEditorSelection?.relativePath.toLowerCase() === rel.toLowerCase()) {
        recordIdeEditorSelection(null)
      }
      return
    }
    recordIdeEditorSelection({
      relativePath: rel,
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      text: selectedText.slice(0, 10_000),
      updatedAt: Date.now()
    })
  })
  return {
    dispose: () => {
      const rel = getRelativePath()
      if (!rel || latestEditorSelection?.relativePath.toLowerCase() === rel.toLowerCase()) {
        recordIdeEditorSelection(null)
      }
      sub.dispose()
    }
  }
}

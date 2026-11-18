import type { editor } from 'monaco-editor'

export type IdeMonacoSelectionSnapshot = {
  startLine: number
  endLine: number
  text: string
  hasRangeSelection: boolean
  top: number
  left: number
}

export function computeIdeMonacoAnchorCoords(
  editorInstance: editor.IStandaloneCodeEditor,
  containerEl: HTMLDivElement | null,
  lineNumber: number,
  column: number
): { top: number; left: number } {
  const pos = editorInstance.getScrolledVisiblePosition({ lineNumber, column })
  const containerWidth = containerEl?.clientWidth ?? 640
  if (!pos) {
    return { top: 12, left: 24 }
  }
  const top = pos.top > 48 ? pos.top - 38 : pos.top + pos.height + 6
  const maxLeft = Math.max(16, containerWidth - 340)
  const left = Math.min(Math.max(16, pos.left), maxLeft)
  return { top, left }
}

export function readIdeMonacoSelectionSnapshot(
  editorInstance: editor.IStandaloneCodeEditor,
  containerEl: HTMLDivElement | null,
  allowEmptyCursor: boolean
): IdeMonacoSelectionSnapshot | null {
  const model = editorInstance.getModel()
  const sel = editorInstance.getSelection()
  if (!model || !sel) {
    return null
  }
  if (!sel.isEmpty()) {
    const text = model.getValueInRange(sel)
    if (!text.trim()) {
      return null
    }
    const coords = computeIdeMonacoAnchorCoords(
      editorInstance,
      containerEl,
      sel.startLineNumber,
      sel.startColumn
    )
    return {
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      text: text.slice(0, 10_000),
      hasRangeSelection: true,
      ...coords
    }
  }
  if (!allowEmptyCursor) {
    return null
  }
  const pos = editorInstance.getPosition()
  const line = pos?.lineNumber ?? 1
  const fromLine = Math.max(1, line - 8)
  const toLine = Math.min(model.getLineCount(), line + 8)
  const text = model.getValueInRange({
    startLineNumber: fromLine,
    startColumn: 1,
    endLineNumber: toLine,
    endColumn: model.getLineMaxColumn(toLine)
  })
  const coords = computeIdeMonacoAnchorCoords(editorInstance, containerEl, line, pos?.column ?? 1)
  return {
    startLine: line,
    endLine: line,
    text: text.slice(0, 6_000),
    hasRangeSelection: false,
    ...coords
  }
}

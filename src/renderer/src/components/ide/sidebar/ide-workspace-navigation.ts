import { useAppStore } from '@/store'
import { joinWorkspacePath, resolveActiveIdeWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'
import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import { normalizeWorkspaceRelativePath } from '../../../../../shared/ide-agent/ide-plan-policy'
import { revealIdeScratchPreviewFile } from '../ide-scratch-preview-navigation'

export function openWorkspaceFileInEditor(
  relativePath: string,
  line?: number,
  scratchWorkspace = false
): boolean {
  const workspace = resolveActiveIdeWorkspace()
  if (!workspace) {
    if (scratchWorkspace) {
      revealIdeScratchPreviewFile(relativePath)
      return true
    }
    return false
  }
  const cleanRel = normalizeWorkspaceRelativePath(relativePath)
  if (!cleanRel) {
    return false
  }
  const fullPath = joinWorkspacePath(workspace.workspacePath, cleanRel)
  const state = useAppStore.getState()
  state.openFile(
    {
      filePath: fullPath,
      relativePath: cleanRel,
      worktreeId: workspace.worktreeId,
      language: detectLanguage(fullPath),
      mode: 'edit'
    },
    { preview: false, focusEditor: true }
  )
  if (typeof line === 'number' && line >= 1) {
    state.setIdeActiveEditHighlight({
      relativePath: cleanRel,
      startLine: line,
      endLine: line,
      label: `Line ${line}`,
      updatedAt: Date.now()
    })
  }
  return true
}

export function resolveActiveWorkspaceLinkTarget(href: string): {
  relativePath: string
  line?: number
} | null {
  const trimmed = href.trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return null
  }
  let rawPath = trimmed
  let line: number | undefined
  const lineMatch = rawPath.match(/^(.*?)(?:#L(\d+)|:(\d+)(?::\d+)?)$/)
  if (lineMatch) {
    rawPath = lineMatch[1]
    const parsed = Number.parseInt(lineMatch[2] ?? lineMatch[3] ?? '', 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      line = parsed
    }
  }
  if (rawPath.startsWith('file://')) {
    rawPath = decodeURIComponent(rawPath.replace(/^file:\/+/i, ''))
    const workspace = resolveActiveIdeWorkspace()
    if (workspace) {
      const normalizedRoot = workspace.workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')
      const normalizedFile = rawPath.replaceAll('\\', '/')
      if (normalizedFile.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
        rawPath = normalizedFile.slice(normalizedRoot.length + 1)
      }
    }
  }
  const normalized = normalizeWorkspaceRelativePath(rawPath)
  if (!normalized || normalized.startsWith('..')) {
    return null
  }
  return { relativePath: normalized, line }
}

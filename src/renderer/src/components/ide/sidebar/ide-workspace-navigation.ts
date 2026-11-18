import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { joinWorkspacePath, resolveActiveIdeWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'
import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import {
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'
import { revealIdeScratchPreviewFile } from '../ide-scratch-preview-navigation'

let navigationHighlightTimer: ReturnType<typeof setTimeout> | null = null

export function openWorkspaceFileInEditor(
  relativePath: string,
  line?: number,
  scratchWorkspace?: boolean
): boolean {
  const workspace = resolveActiveIdeWorkspace()
  const isScratch =
    scratchWorkspace ??
    useIdeAgentStore.getState().activeConversation?.workspaceKey.startsWith('ide-scratch:') === true
  if (!workspace) {
    if (isScratch) {
      revealIdeScratchPreviewFile(relativePath)
      return true
    }
    return false
  }
  const cleanRel = normalizeWorkspaceRelativePath(relativePath)
  if (!cleanRel || isUnsafeRelativePath(cleanRel)) {
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
    if (navigationHighlightTimer !== null) {
      clearTimeout(navigationHighlightTimer)
    }
    state.setIdeActiveEditHighlight({
      worktreeId: workspace.worktreeId,
      relativePath: cleanRel,
      startLine: line,
      endLine: line,
      label: `Line ${line}`,
      status: 'navigation',
      updatedAt: Date.now()
    })
    navigationHighlightTimer = setTimeout(() => {
      navigationHighlightTimer = null
      const curr = useAppStore.getState().ideActiveEditHighlight
      if (curr?.status === 'navigation') {
        useAppStore.getState().setIdeActiveEditHighlight(null)
      }
    }, 1600)
  }
  return true
}

function stripWorkspacePrefixIfPresent(candidatePath: string): string {
  const workspace = resolveActiveIdeWorkspace()
  if (!workspace) {
    return candidatePath
  }
  const normalizedRoot = workspace.workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedFile = candidatePath.replaceAll('\\', '/')
  if (normalizedFile.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1)
  }
  return candidatePath
}

export function resolveActiveWorkspaceLinkTarget(href: string): {
  relativePath: string
  line?: number
} | null {
  const trimmed = href.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^(?:https?|mailto|tel|orca|vscode|javascript|data):/i.test(trimmed)
  ) {
    return null
  }
  let rawPath = trimmed
  if (/^file:\/\//i.test(rawPath)) {
    try {
      const parsedUrl = new URL(rawPath)
      let pathname = decodeURIComponent(parsedUrl.pathname)
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1)
      }
      rawPath = `${pathname}${parsedUrl.hash || ''}`
    } catch {
      return null
    }
  } else {
    try {
      rawPath = decodeURIComponent(rawPath)
    } catch {
      // Keep unencoded path when literal % exists.
    }
  }

  let line: number | undefined
  const lineMatch = rawPath.match(/^(.*?)(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+)?)$/i)
  if (lineMatch) {
    rawPath = lineMatch[1]
    const parsed = Number.parseInt(lineMatch[2] ?? lineMatch[3] ?? '', 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      line = parsed
    }
  }

  rawPath = stripWorkspacePrefixIfPresent(rawPath)
  if (isUnsafeRelativePath(rawPath)) {
    return null
  }
  const normalized = normalizeWorkspaceRelativePath(rawPath)
  if (!normalized || isUnsafeRelativePath(normalized)) {
    return null
  }
  return { relativePath: normalized, line }
}

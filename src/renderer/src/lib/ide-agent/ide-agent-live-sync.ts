import { useAppStore } from '@/store'
import { notifyEditorExternalFileChange } from '@/components/editor/autosave/editor-autosave'
import {
  markWorktreeCatchUpPayload,
  ORCA_WORKTREE_FILE_CHANGE_EVENT
} from '@/hooks/worktree-file-change-event'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import { getFolderWorkspaceWorktree } from '../../../../shared/folder-workspaces/folder-workspace-worktree'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import type { IdeAgentStreamEvent } from '../../../../shared/ide-agent/ide-agent-types'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'

export type ResolvedActiveIdeWorkspace = {
  worktreeId: string
  workspaceKey: string
  workspacePath: string
  worktreeSelector: string
  runtimeEnvironmentId: string | null
}

export function resolveIdeWorkspaceSnapshot(
  state: Pick<
    ReturnType<typeof useAppStore.getState>,
    'activeWorktreeId' | 'worktreesByRepo' | 'folderWorkspaces' | 'activeWorkspaceExecutionHostId'
  >
): ResolvedActiveIdeWorkspace | null {
  const activeId = state.activeWorktreeId
  if (!activeId) {
    return null
  }
  const worktreesByRepo = selectWorktreesByRepo(state)
  for (const list of Object.values(worktreesByRepo)) {
    const found = list.find((w) => w.id === activeId)
    if (found) {
      const hostParsed = parseExecutionHostId(
        state.activeWorkspaceExecutionHostId ?? LOCAL_EXECUTION_HOST_ID
      )
      return {
        worktreeId: found.id,
        workspaceKey: found.id,
        workspacePath: found.path,
        worktreeSelector: `id:${found.id}`,
        runtimeEnvironmentId: hostParsed?.kind === 'runtime' ? hostParsed.environmentId : null
      }
    }
  }
  for (const fw of state.folderWorkspaces ?? []) {
    if (fw.id === activeId || `folder:${fw.id}` === activeId) {
      const wt = getFolderWorkspaceWorktree(fw)
      return {
        worktreeId: wt.id,
        workspaceKey: wt.id,
        workspacePath: wt.path,
        worktreeSelector: `id:${wt.id}`,
        runtimeEnvironmentId: null
      }
    }
  }
  return null
}

export function resolveActiveIdeWorkspace(): ResolvedActiveIdeWorkspace | null {
  return resolveIdeWorkspaceSnapshot(useAppStore.getState())
}

export function joinWorkspacePath(worktreePath: string, relativePath: string): string {
  const cleanRel = normalizeWorkspaceRelativePath(relativePath)
  const useBackslash = /^[A-Za-z]:\\/.test(worktreePath) || worktreePath.includes('\\')
  const trimmedRoot = worktreePath.replace(/[\\/]+$/, '')
  const normalizedRel = useBackslash ? cleanRel.replaceAll('/', '\\') : cleanRel
  return `${trimmedRoot}${useBackslash ? '\\' : '/'}${normalizedRel}`
}

export function collectDirtyRelativePaths(worktreeId?: string): string[] {
  const state = useAppStore.getState()
  return state.openFiles
    .filter((f) => f.isDirty && (!worktreeId || f.worktreeId === worktreeId) && f.relativePath)
    .map((f) => normalizeWorkspaceRelativePath(f.relativePath))
}

function isUserTypingOutsideEditor(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const active = document.activeElement
  if (!active || !(active instanceof HTMLElement)) {
    return false
  }
  if (
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'INPUT' ||
    active.isContentEditable
  ) {
    return true
  }
  // Also preserve focus if user is actively inside a Monaco editor widget.
  return Boolean(active.closest('.monaco-editor'))
}

function openFileInIdeIfAllowed(relativePath: string, workspace: ResolvedActiveIdeWorkspace): void {
  const state = useAppStore.getState()
  const cleanRel = normalizeWorkspaceRelativePath(relativePath)
  const fullPath = joinWorkspacePath(workspace.workspacePath, cleanRel)

  const existing = state.openFiles.find(
    (f) =>
      f.worktreeId === workspace.worktreeId &&
      normalizeWorkspaceRelativePath(f.relativePath).toLowerCase() === cleanRel.toLowerCase()
  )
  // Never replace an unsaved user buffer or steal focus when user is actively typing.
  if (existing?.isDirty) {
    return
  }

  const preserveUserFocus = isUserTypingOutsideEditor()
  if (existing && state.activeFileId === existing.id) {
    return
  }
  if (!state.ideFollowAgent) {
    return
  }

  state.openFile(
    {
      filePath: fullPath,
      relativePath: cleanRel,
      worktreeId: workspace.worktreeId,
      language: detectLanguage(fullPath),
      mode: 'edit'
    },
    {
      preview: false,
      focusEditor: !preserveUserFocus
    }
  )
}

function dispatchWorktreeFsEvent(
  kind: 'create' | 'update' | 'delete',
  relativePath: string,
  workspace: ResolvedActiveIdeWorkspace
): void {
  const fullPath = joinWorkspacePath(workspace.workspacePath, relativePath)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ORCA_WORKTREE_FILE_CHANGE_EVENT, {
        detail: {
          payload: markWorktreeCatchUpPayload({
            worktreePath: workspace.workspacePath,
            events: [{ kind, absolutePath: fullPath }]
          }),
          runtimeEnvironmentId: workspace.runtimeEnvironmentId
        }
      })
    )
  }
  notifyEditorExternalFileChange({
    relativePath: normalizeWorkspaceRelativePath(relativePath),
    worktreeId: workspace.worktreeId,
    worktreePath: workspace.workspacePath
  })
}

export function syncIdeAgentEventToWorkspace(event: IdeAgentStreamEvent): void {
  const workspace = resolveActiveIdeWorkspace()
  const ui = useAppStore.getState()

  if (!workspace) {
    if (
      event.type === 'run_status' &&
      (event.status === 'completed' || event.status === 'failed' || event.status === 'canceled')
    ) {
      ui.setIdeActiveEditHighlight(null)
    }
    return
  }

  switch (event.type) {
    case 'editor_file_opened':
      openFileInIdeIfAllowed(event.relativePath, workspace)
      return

    case 'editor_edit_chunk':
      openFileInIdeIfAllowed(event.relativePath, workspace)
      ui.setIdeActiveEditHighlight({
        relativePath: normalizeWorkspaceRelativePath(event.relativePath),
        startLine: event.startLine,
        endLine: event.endLine,
        label: event.label,
        updatedAt: Date.now()
      })
      notifyEditorExternalFileChange({
        relativePath: normalizeWorkspaceRelativePath(event.relativePath),
        worktreeId: workspace.worktreeId,
        worktreePath: workspace.workspacePath
      })
      return

    case 'file_created':
      dispatchWorktreeFsEvent('create', event.relativePath, workspace)
      return

    case 'file_modified':
      dispatchWorktreeFsEvent('update', event.relativePath, workspace)
      return

    case 'file_deleted':
      dispatchWorktreeFsEvent('delete', event.relativePath, workspace)
      return

    case 'run_status':
      if (
        event.status === 'completed' ||
        event.status === 'failed' ||
        event.status === 'canceled' ||
        event.status === 'idle'
      ) {
        ui.setIdeActiveEditHighlight(null)
      }
      break

    default:
      break
  }
}

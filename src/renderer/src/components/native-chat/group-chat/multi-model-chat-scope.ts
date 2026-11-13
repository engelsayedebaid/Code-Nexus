import { useShallow } from 'zustand/react/shallow'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { isFloatingWorkspaceId } from '../../../../../shared/floating-workspace-worktree'
import { workspaceTabs } from '@/lib/agent-session/tab-identity/structured-chat-tab-index'
import { getKnownExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { findNativeChatTabOwnerWorktreeId } from '../pane/ownership/native-chat-tab-owner'
import { resolveNativeChatTabDirectory } from '../pane/routing/native-chat-tab-directory'

export type MultiModelChatScope = {
  /** Stable owner of the inline chat: the terminal tab survives a saved-chat restore. */
  chatId: string
  worktreeId: string | null
  /** Local path the read-only Council turns run in; null on remote hosts or missing folders. */
  worktreePath: string | null
}

export function findTerminalTab(state: Pick<AppState, 'tabsByWorktree'>, tabId: string) {
  for (const tabs of Object.values(state.tabsByWorktree ?? {})) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab) {
      return tab
    }
  }
  return null
}

export function multiModelChatScopeFor(
  state: AppState,
  terminalTabId: string
): MultiModelChatScope {
  const safeState: AppState = {
    ...state,
    tabsByWorktree: state.tabsByWorktree ?? {},
    worktreesByRepo: state.worktreesByRepo ?? {},
    folderWorkspaces: state.folderWorkspaces ?? []
  }
  const terminalTab = findTerminalTab(safeState, terminalTabId)
  const worktreeId =
    findNativeChatTabOwnerWorktreeId(safeState, terminalTabId) ?? terminalTab?.worktreeId ?? null
  if (!worktreeId) {
    return {
      chatId: terminalTabId,
      worktreeId: null,
      worktreePath: terminalTab?.startupCwd ?? null
    }
  }
  const structuredTab = workspaceTabs(safeState.unifiedTabsByWorktree, worktreeId)?.find(
    (candidate) => candidate.id === terminalTabId
  )
  const hostId =
    structuredTab?.executionHostId ?? getKnownExecutionHostIdForWorktree(safeState, worktreeId)
  if (hostId && hostId !== LOCAL_EXECUTION_HOST_ID) {
    return {
      chatId: terminalTabId,
      worktreeId,
      worktreePath: null
    }
  }
  const directory = resolveNativeChatTabDirectory(safeState, terminalTabId, worktreeId, hostId)
  const fallbackCwd = !isFloatingWorkspaceId(worktreeId) ? (terminalTab?.startupCwd ?? null) : null
  return {
    chatId: terminalTabId,
    worktreeId,
    worktreePath: directory ?? fallbackCwd
  }
}

export function useMultiModelChatScope(terminalTabId: string): MultiModelChatScope {
  return useAppStore(useShallow((state) => multiModelChatScopeFor(state, terminalTabId)))
}

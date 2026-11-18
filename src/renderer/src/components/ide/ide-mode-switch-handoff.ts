import type { AppState } from '@/store/types'

export type IdeModeSwitchSlice = Pick<
  AppState,
  | 'appMode'
  | 'sidebarOpen'
  | 'rightSidebarOpen'
  | 'activeWorktreeId'
  | 'activeFileId'
  | 'activeFileIdByWorktree'
  | 'activeGroupIdByWorktree'
  | 'groupsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'activateTab'
  | 'setActiveTabType'
>

/**
 * Transitions workspace chrome and center-pane focus cleanly when switching
 * between Agent Command Center (`command`) and IDE Code Studio (`ide`).
 */
export function performIdeModeSwitchHandoff(
  get: () => IdeModeSwitchSlice,
  set: (partial: Partial<IdeModeSwitchSlice>) => void,
  nextMode: AppState['appMode']
): void {
  const prev = get()
  if (prev.appMode === nextMode) {
    return
  }

  if (nextMode !== 'ide') {
    set({ appMode: nextMode })
    return
  }

  set({
    appMode: 'ide',
    sidebarOpen: true,
    rightSidebarOpen: true
  })

  const state = get()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return
  }

  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const activeGroup = state.groupsByWorktree[worktreeId]?.find((g) => g.id === activeGroupId)
  const currentTab = activeGroup?.activeTabId
    ? unifiedTabs.find((t) => t.id === activeGroup.activeTabId)
    : undefined

  // If the center pane is currently showing an Agent/Chat tab, bring an open code file to the front.
  if (currentTab?.contentType === 'editor' || currentTab?.contentType === 'browser') {
    return
  }

  const preferredFileId = state.activeFileIdByWorktree[worktreeId] ?? state.activeFileId
  const preferredEditorTab =
    (preferredFileId
      ? unifiedTabs.find((t) => t.contentType === 'editor' && t.entityId === preferredFileId)
      : undefined) ?? unifiedTabs.find((t) => t.contentType === 'editor')

  if (preferredEditorTab) {
    state.activateTab(preferredEditorTab.id)
    state.setActiveTabType('editor', worktreeId)
  }
}

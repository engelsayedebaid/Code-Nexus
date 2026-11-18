import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { persistAgentLaunchTabOrder } from '@/lib/agent-session/launch/pane/launch-agent-tab-order'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import { setGroupRatioThroughLayoutOwner } from '@/components/tab-group/tab-group-layout-owner-commands'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import {
  findBottomTerminalTarget,
  findVerticalSplitPathForGroups,
  resolveEditorGroupId
} from './ide-bottom-terminal-layout'

const IDE_DOCKED_TERMINAL_RATIO = 0.68

function resolveReferenceEditorGroupId(state: AppState, worktreeId: string): string {
  const activeFileId = state.activeFileIdByWorktree[worktreeId] ?? state.activeFileId
  if (activeFileId) {
    return resolveEditorGroupId(state, worktreeId, activeFileId)
  }
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const firstEditorTab = unifiedTabs.find((tab) => tab.contentType === 'editor')
  if (firstEditorTab) {
    return firstEditorTab.groupId
  }
  return state.activeGroupIdByWorktree[worktreeId] ?? state.ensureWorktreeRootGroup(worktreeId)
}

function isPlainShellTab(state: AppState, worktreeId: string, entityId: string): boolean {
  const term = (state.tabsByWorktree[worktreeId] ?? []).find((t) => t.id === entityId)
  return Boolean(term && !term.launchAgent)
}

function hasTopEditorOrBrowserSurface(state: AppState, worktreeId: string): boolean {
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
    (tab) => tab.contentType === 'editor' || tab.contentType === 'browser'
  )
}

export function hasOpenIdeBottomTerminal(state: AppState, worktreeId: string | null): boolean {
  if (!worktreeId) {
    return false
  }
  if (!hasTopEditorOrBrowserSurface(state, worktreeId)) {
    return (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
      (tab) =>
        tab.contentType === 'terminal' &&
        tab.viewMode !== 'chat' &&
        isPlainShellTab(state, worktreeId, tab.entityId)
    )
  }
  const editorGroupId = resolveReferenceEditorGroupId(state, worktreeId)
  const target = findBottomTerminalTarget(state, worktreeId, editorGroupId)
  return target.kind === 'reuse-tab'
}

function spawnBottomTerminalInGroupOrSplit(
  worktreeId: string,
  editorGroupId: string,
  targetGroupId: string | undefined,
  splitDown: boolean
): void {
  const state = useAppStore.getState()
  const created = state.createTab(
    worktreeId,
    targetGroupId,
    undefined,
    splitDown
      ? { split: { sourceGroupId: editorGroupId, splitDirection: 'down', activate: true } }
      : undefined
  )
  const nextState = useAppStore.getState()
  if (splitDown) {
    const bottomGroupId = nextState.unifiedTabsByWorktree[worktreeId]?.find(
      (entry) =>
        entry.contentType === 'terminal' &&
        (entry.id === created.id || entry.entityId === created.id)
    )?.groupId
    const layout = nextState.layoutByWorktree[worktreeId]
    const splitPath =
      layout && bottomGroupId
        ? findVerticalSplitPathForGroups(layout, editorGroupId, bottomGroupId)
        : null
    if (splitPath !== null) {
      if (ORCA_LAYOUT_OWNER_IS_MAIN) {
        setGroupRatioThroughLayoutOwner(worktreeId, splitPath, IDE_DOCKED_TERMINAL_RATIO)
      } else {
        nextState.setTabGroupSplitRatio(worktreeId, splitPath, IDE_DOCKED_TERMINAL_RATIO)
      }
    }
  }
  nextState.setActiveTabType('terminal', worktreeId)
  persistAgentLaunchTabOrder(worktreeId, created.id)
  focusTerminalTabSurface(created.id)
}

export function openNewIdeBottomTerminalTab(worktreeId: string | null): void {
  if (!worktreeId) {
    return
  }
  const state = useAppStore.getState()
  if (!hasTopEditorOrBrowserSurface(state, worktreeId)) {
    const rootGroupId = state.ensureWorktreeRootGroup(worktreeId)
    const created = state.createTab(worktreeId, rootGroupId)
    state.setActiveTabType('terminal', worktreeId)
    persistAgentLaunchTabOrder(worktreeId, created.id)
    focusTerminalTabSurface(created.id)
    return
  }
  const editorGroupId = resolveReferenceEditorGroupId(state, worktreeId)
  const target = findBottomTerminalTarget(state, worktreeId, editorGroupId)
  if (target.kind === 'split-down') {
    spawnBottomTerminalInGroupOrSplit(worktreeId, editorGroupId, undefined, true)
    return
  }
  spawnBottomTerminalInGroupOrSplit(worktreeId, editorGroupId, target.groupId, false)
}

export function toggleIdeBottomTerminal(worktreeId: string | null): void {
  if (!worktreeId) {
    return
  }
  const state = useAppStore.getState()
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []

  if (!hasTopEditorOrBrowserSurface(state, worktreeId)) {
    const plainTabs = unifiedTabs.filter(
      (tab) =>
        tab.contentType === 'terminal' &&
        tab.viewMode !== 'chat' &&
        isPlainShellTab(state, worktreeId, tab.entityId)
    )
    if (plainTabs.length > 0) {
      for (const tab of plainTabs) {
        closeTerminalTab(tab.entityId, { reason: 'user', preserveWorktreeSelection: true })
      }
      return
    }
    openNewIdeBottomTerminalTab(worktreeId)
    return
  }

  const editorGroupId = resolveReferenceEditorGroupId(state, worktreeId)
  const target = findBottomTerminalTarget(state, worktreeId, editorGroupId)

  if (target.kind === 'reuse-tab') {
    const groupPlainTabs = unifiedTabs.filter(
      (tab) =>
        tab.groupId === target.groupId &&
        tab.contentType === 'terminal' &&
        tab.viewMode !== 'chat' &&
        isPlainShellTab(state, worktreeId, tab.entityId)
    )
    for (const tab of groupPlainTabs) {
      closeTerminalTab(tab.entityId, { reason: 'user', preserveWorktreeSelection: true })
    }
    useAppStore.getState().focusGroup(worktreeId, editorGroupId)
    return
  }

  spawnBottomTerminalInGroupOrSplit(
    worktreeId,
    editorGroupId,
    target.kind === 'create-in-group' ? target.groupId : undefined,
    target.kind === 'split-down'
  )
}

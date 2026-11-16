import type { AppState } from '@/store/types'
import type { Tab, TabGroupLayoutNode } from '../../../../shared/tab-types'

export type BottomTerminalTarget =
  | { kind: 'reuse-tab'; tab: Tab; groupId: string }
  | { kind: 'create-in-group'; groupId: string }
  | { kind: 'split-down'; sourceGroupId: string }

function containsGroup(node: TabGroupLayoutNode, groupId: string): boolean {
  return node.type === 'leaf'
    ? node.groupId === groupId
    : containsGroup(node.first, groupId) || containsGroup(node.second, groupId)
}

function collectLayoutGroupIds(node: TabGroupLayoutNode, into: string[] = []): string[] {
  if (node.type === 'leaf') {
    into.push(node.groupId)
    return into
  }
  collectLayoutGroupIds(node.first, into)
  collectLayoutGroupIds(node.second, into)
  return into
}

function findVerticalBottomSubtree(
  node: TabGroupLayoutNode,
  editorGroupId: string
): TabGroupLayoutNode | null {
  if (node.type === 'leaf') {
    return null
  }
  if (containsGroup(node.first, editorGroupId)) {
    return (
      findVerticalBottomSubtree(node.first, editorGroupId) ??
      (node.direction === 'vertical' ? node.second : null)
    )
  }
  return containsGroup(node.second, editorGroupId)
    ? findVerticalBottomSubtree(node.second, editorGroupId)
    : null
}

/** Return the layout tree path for the vertical split separating `topGroupId` above `bottomGroupId`. */
export function findVerticalSplitPathForGroups(
  node: TabGroupLayoutNode,
  topGroupId: string,
  bottomGroupId: string,
  path = ''
): string | null {
  if (node.type === 'leaf') {
    return null
  }
  if (containsGroup(node.first, topGroupId) && containsGroup(node.first, bottomGroupId)) {
    return findVerticalSplitPathForGroups(
      node.first,
      topGroupId,
      bottomGroupId,
      path ? `${path}.first` : 'first'
    )
  }
  if (containsGroup(node.second, topGroupId) && containsGroup(node.second, bottomGroupId)) {
    return findVerticalSplitPathForGroups(
      node.second,
      topGroupId,
      bottomGroupId,
      path ? `${path}.second` : 'second'
    )
  }
  if (
    node.direction === 'vertical' &&
    containsGroup(node.first, topGroupId) &&
    containsGroup(node.second, bottomGroupId)
  ) {
    return path
  }
  return null
}

/** Resolve the tab group hosting `fileId`, falling back to the active or root group. */
export function resolveEditorGroupId(state: AppState, worktreeId: string, fileId: string): string {
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const matchingTabs = unifiedTabs.filter(
    (tab) => tab.entityId === fileId && tab.contentType === 'editor'
  )
  const inActiveGroup = activeGroupId
    ? matchingTabs.find((tab) => tab.groupId === activeGroupId)
    : undefined
  return (
    inActiveGroup?.groupId ??
    matchingTabs[0]?.groupId ??
    activeGroupId ??
    state.ensureWorktreeRootGroup(worktreeId)
  )
}

function isEligiblePlainShellTab(
  state: AppState,
  worktreeId: string,
  tab: Tab,
  matchesShell?: (shellOverride: string | undefined) => boolean
): boolean {
  if (tab.contentType !== 'terminal' || tab.viewMode === 'chat') {
    return false
  }
  const terminalTab = (state.tabsByWorktree[worktreeId] ?? []).find(
    (entry) => entry.id === tab.entityId
  )
  if (!terminalTab || terminalTab.launchAgent) {
    return false
  }
  return matchesShell ? matchesShell(terminalTab.shellOverride) : true
}

/** Pick an existing bottom shell pane below `editorGroupId`, or request a new downward split. */
export function findBottomTerminalTarget(
  state: AppState,
  worktreeId: string,
  editorGroupId: string,
  options: {
    preferredTabId?: string
    matchesShell?: (shellOverride: string | undefined) => boolean
  } = {}
): BottomTerminalTarget {
  const layout = state.layoutByWorktree[worktreeId]
  const bottomSubtree = layout ? findVerticalBottomSubtree(layout, editorGroupId) : null
  if (!bottomSubtree) {
    return { kind: 'split-down', sourceGroupId: editorGroupId }
  }
  const bottomGroupIds = collectLayoutGroupIds(bottomSubtree)
  const bottomGroupSet = new Set(bottomGroupIds)
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  if (options.preferredTabId) {
    const trackedTab = unifiedTabs.find(
      (tab) => tab.id === options.preferredTabId && bottomGroupSet.has(tab.groupId)
    )
    if (
      trackedTab &&
      isEligiblePlainShellTab(state, worktreeId, trackedTab, options.matchesShell)
    ) {
      return { kind: 'reuse-tab', tab: trackedTab, groupId: trackedTab.groupId }
    }
  }
  const groups = state.groupsByWorktree[worktreeId] ?? []
  for (const groupId of bottomGroupIds) {
    const group = groups.find((entry) => entry.id === groupId)
    if (!group) {
      continue
    }
    const candidateIds = group.activeTabId
      ? [group.activeTabId, ...group.tabOrder.filter((id) => id !== group.activeTabId)]
      : group.tabOrder
    for (const tabId of candidateIds) {
      const candidate = unifiedTabs.find((tab) => tab.id === tabId)
      if (
        candidate &&
        isEligiblePlainShellTab(state, worktreeId, candidate, options.matchesShell)
      ) {
        return { kind: 'reuse-tab', tab: candidate, groupId }
      }
    }
  }
  return bottomGroupIds[0]
    ? { kind: 'create-in-group', groupId: bottomGroupIds[0] }
    : { kind: 'split-down', sourceGroupId: editorGroupId }
}

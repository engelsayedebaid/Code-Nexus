import { describe, expect, it } from 'vitest'
import { landsOnEmptiedWorktree } from './tabs-empty-workspace'

const WORKTREE_ID = 'repo::workspace'

function emptyWorkspaceState(
  appMode: 'command' | 'ide'
): Parameters<typeof landsOnEmptiedWorktree>[0] {
  return {
    appMode,
    activeWorktreeId: WORKTREE_ID,
    unifiedTabsByWorktree: { [WORKTREE_ID]: [] },
    tabsByWorktree: { [WORKTREE_ID]: [] },
    browserTabsByWorktree: { [WORKTREE_ID]: [] },
    openFiles: [],
    activeTabIdByWorktree: { [WORKTREE_ID]: null },
    activeBrowserTabIdByWorktree: { [WORKTREE_ID]: null },
    activeFileIdByWorktree: { [WORKTREE_ID]: null },
    activeTabTypeByWorktree: { [WORKTREE_ID]: 'editor' as const },
    groupsByWorktree: { [WORKTREE_ID]: [] },
    splitLandingGroupIds: {}
  }
}

describe('landsOnEmptiedWorktree', () => {
  it('keeps an empty IDE workspace selected after its final file tab closes', () => {
    expect(landsOnEmptiedWorktree(emptyWorkspaceState('ide'), WORKTREE_ID, 0)).toBe(false)
    expect(landsOnEmptiedWorktree(emptyWorkspaceState('command'), WORKTREE_ID, 0)).toBe(true)
  })
})

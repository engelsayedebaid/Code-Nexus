import { describe, expect, it, vi } from 'vitest'
import { performIdeModeSwitchHandoff, type IdeModeSwitchSlice } from './ide-mode-switch-handoff'

describe('performIdeModeSwitchHandoff', () => {
  it('opens both IDE sidebars and brings an open editor file to the front when leaving an agent chat tab', () => {
    const activateTab = vi.fn()
    const setActiveTabType = vi.fn()
    let state: IdeModeSwitchSlice = {
      appMode: 'command',
      sidebarOpen: false,
      rightSidebarOpen: false,
      activeWorktreeId: 'wt-1',
      activeFileId: 'file-css',
      activeFileIdByWorktree: { 'wt-1': 'file-css' },
      activeGroupIdByWorktree: { 'wt-1': 'grp-1' },
      groupsByWorktree: {
        'wt-1': [
          {
            id: 'grp-1',
            worktreeId: 'wt-1',
            activeTabId: 'tab-agent',
            tabOrder: ['tab-agent', 'tab-editor'],
            recentTabIds: []
          }
        ]
      },
      unifiedTabsByWorktree: {
        'wt-1': [
          {
            id: 'tab-agent',
            entityId: 'term-1',
            worktreeId: 'wt-1',
            groupId: 'grp-1',
            contentType: 'terminal',
            viewMode: 'chat',
            label: 'Codex Chat',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 100
          },
          {
            id: 'tab-editor',
            entityId: 'file-css',
            worktreeId: 'wt-1',
            groupId: 'grp-1',
            contentType: 'editor',
            label: 'styles.css',
            customLabel: null,
            color: null,
            sortOrder: 1,
            createdAt: 200
          }
        ]
      },
      activateTab,
      setActiveTabType
    }

    performIdeModeSwitchHandoff(
      () => state,
      (patch) => {
        state = { ...state, ...patch }
      },
      'ide'
    )

    expect(state.appMode).toBe('ide')
    expect(state.sidebarOpen).toBe(true)
    expect(state.rightSidebarOpen).toBe(true)
    expect(activateTab).toHaveBeenCalledWith('tab-editor')
    expect(setActiveTabType).toHaveBeenCalledWith('editor', 'wt-1')
  })
})

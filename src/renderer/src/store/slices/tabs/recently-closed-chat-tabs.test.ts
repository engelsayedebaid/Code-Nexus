import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import { createTestStore } from '../../testing/app-store-test-fixture'
import { makeTabGroup, makeUnifiedTab } from './tab-group.test-fixture'
import { removeWorktreeLayout } from './worktree-layout-lifecycle'

function installMemoryLocalStorage(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const entries = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, String(value))
    }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: memoryStorage
  })
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'localStorage', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  }
}

const restoreLocalStorage = installMemoryLocalStorage()

const openDesktopStructuredSessionMock = vi.fn().mockResolvedValue({ kind: 'opened' })

vi.mock('@/lib/agent-session/open/activate-ai-vault-structured-session', () => ({
  openDesktopStructuredSession: (...args: unknown[]) => openDesktopStructuredSessionMock(...args)
}))

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const mockApi = createTabsSliceMockApi()
Object.assign(mockApi, {
  runtime: {
    call: vi.fn().mockResolvedValue({ closed: true })
  },
  agentSession: {
    close: vi.fn().mockResolvedValue({ closed: true })
  }
})

const WT = 'folder::home-chat'

function setupChatTabInStore(
  store: ReturnType<typeof createTestStore>,
  sessionId = 'sess-1',
  label = 'Antigravity Chat'
): string {
  const groupId = 'group-1'
  const tab = makeUnifiedTab({
    id: `tab-${sessionId}`,
    entityId: sessionId,
    contentType: 'agent-session',
    agentSessionAgent: 'antigravity',
    label,
    worktreeId: WT,
    groupId
  })
  store.setState({
    unifiedTabsByWorktree: { [WT]: [tab] },
    groupsByWorktree: {
      [WT]: [
        makeTabGroup({
          id: groupId,
          worktreeId: WT,
          activeTabId: tab.id,
          tabOrder: [tab.id],
          recentTabIds: [tab.id]
        })
      ]
    },
    activeGroupIdByWorktree: { [WT]: groupId },
    activeWorktreeId: WT
  })
  return tab.id
}

describe('recently closed chat tabs', () => {
  afterAll(() => {
    restoreLocalStorage()
  })

  beforeEach(() => {
    localStorage.clear()
    openDesktopStructuredSessionMock.mockClear()
  })

  it('records a closed agent-session tab and restores it via reopenClosedTab', async () => {
    const store = createTestStore()
    const tabId = setupChatTabInStore(store, 'sess-restore', 'Design discussion')

    store.getState().closeUnifiedTab(tabId)

    const closedList = store.getState().recentlyClosedChatTabsByWorktree[WT]
    expect(closedList).toHaveLength(1)
    expect(closedList[0]).toMatchObject({
      sessionId: 'sess-restore',
      worktreeId: WT,
      agent: 'antigravity',
      label: 'Design discussion'
    })
    expect(store.getState().recentlyClosedTabKindsByWorktree[WT]).toEqual(['chat'])
    expect(store.getState().recentlyClosedTabWorktreeHistory[0]).toBe(WT)

    expect(store.getState().reopenClosedTab(WT)).toBe(true)
    expect(store.getState().recentlyClosedChatTabsByWorktree[WT]).toBeUndefined()

    await vi.waitFor(() => {
      expect(openDesktopStructuredSessionMock).toHaveBeenCalledWith(
        {
          kind: 'history',
          structuredSession: { workspaceId: WT, sessionId: 'sess-restore' },
          agent: 'antigravity'
        },
        undefined
      )
    })
  })

  it('reopens the most recent closed chat across workspaces from landing', async () => {
    const store = createTestStore()
    const tabId = setupChatTabInStore(store, 'sess-landing', 'Saved chat')

    store.getState().closeUnifiedTab(tabId)
    store.setState({ activeWorktreeId: null })

    expect(store.getState().reopenLastClosedTab()).toBe(WT)
    await vi.waitFor(() => {
      expect(openDesktopStructuredSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'history',
          structuredSession: { workspaceId: WT, sessionId: 'sess-landing' }
        }),
        undefined
      )
    })
  })

  it('persists closed chats in localStorage across store restarts and prunes deleted worktrees', () => {
    const store = createTestStore()
    const tabId = setupChatTabInStore(store, 'sess-persist', 'Persisted thread')
    store.getState().closeUnifiedTab(tabId)

    const restartedStore = createTestStore()
    expect(restartedStore.getState().recentlyClosedChatTabsByWorktree[WT]?.[0]?.sessionId).toBe(
      'sess-persist'
    )
    expect(restartedStore.getState().recentlyClosedTabKindsByWorktree[WT]).toEqual(['chat'])

    const patch = removeWorktreeLayout(restartedStore.getState(), {
      worktreeIds: new Set([WT]),
      tabIds: new Set(),
      activeFileCleared: false
    })
    restartedStore.setState(patch)

    expect(restartedStore.getState().recentlyClosedChatTabsByWorktree[WT]).toBeUndefined()
    expect(restartedStore.getState().recentlyClosedTabWorktreeHistory).not.toContain(WT)

    const afterDeleteRestart = createTestStore()
    expect(afterDeleteRestart.getState().recentlyClosedChatTabsByWorktree[WT]).toBeUndefined()
  })
})

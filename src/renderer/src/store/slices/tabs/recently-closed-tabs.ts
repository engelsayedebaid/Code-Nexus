import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/workspace/ownership/resolved-worktree-execution-host'
import { runtimeRpcTargetForAuthorityKey } from '@/runtime/rpc/targets/runtime-client-target'
import { restoreRecentlyClosedTabPosition } from './recently-closed-tab-position'
import {
  loadRecentlyClosedChatTabsStorage,
  prependClosedChatTab,
  pushClosedTabWorktreeHistory,
  removeClosedChatTabBySessionId,
  saveRecentlyClosedChatTabsStorage,
  seedRecentlyClosedTabKindsFromChats,
  type RecentlyClosedChatTab
} from './recently-closed-chat-tabs'

export type RecentlyClosedTabKind = 'terminal' | 'browser' | 'editor' | 'chat'
export type { RecentlyClosedChatTab }

// Cross-type history exceeds per-type cap 10; drained snapshot kinds are skipped on pop.
const MAX_RECENT_CLOSED_TAB_KINDS = 30

export function pushRecentlyClosedTabKind(
  map: Record<string, RecentlyClosedTabKind[]> | undefined,
  worktreeId: string,
  kind: RecentlyClosedTabKind,
  count = 1
): Record<string, RecentlyClosedTabKind[]> {
  // No-op pushes preserve identity for unrelated subscribers, like closeTab unread maps.
  if (count <= 0) {
    return map ?? {}
  }
  // Thousands of close-all entries beyond history cap cannot affect reopen order.
  const retainedCount = Math.min(count, MAX_RECENT_CLOSED_TAB_KINDS)
  return {
    ...map,
    [worktreeId]: [
      ...(Array(retainedCount).fill(kind) as RecentlyClosedTabKind[]),
      ...(map?.[worktreeId] ?? [])
    ].slice(0, MAX_RECENT_CLOSED_TAB_KINDS)
  }
}

function consumeOneClosedChatKind(
  map: Record<string, RecentlyClosedTabKind[]> | undefined,
  worktreeId: string
): Record<string, RecentlyClosedTabKind[]> {
  const existing = map?.[worktreeId]
  if (!existing || existing.length === 0) {
    return map ?? {}
  }
  const index = existing.indexOf('chat')
  if (index === -1) {
    return map ?? {}
  }
  return {
    ...map,
    [worktreeId]: [...existing.slice(0, index), ...existing.slice(index + 1)]
  }
}

function restoreClosedChatEntry(get: () => AppState, entry: RecentlyClosedChatTab): void {
  const state = get()
  const existingTab = (state.unifiedTabsByWorktree?.[entry.worktreeId] ?? []).find(
    (tab) => tab.contentType === 'agent-session' && tab.entityId === entry.sessionId
  )
  if (existingTab) {
    state.activateTab?.(existingTab.id, { worktreeId: entry.worktreeId })
    return
  }
  if (typeof window === 'undefined' || !window.api?.runtime) {
    return
  }
  const resolvedHostId =
    entry.executionHostId ??
    getResolvedExecutionHostIdForWorktree(state, entry.worktreeId) ??
    undefined
  const host = resolvedHostId
    ? (runtimeRpcTargetForAuthorityKey(resolvedHostId) ?? undefined)
    : undefined
  void import('@/lib/agent-session/open/activate-ai-vault-structured-session')
    .then(async ({ openDesktopStructuredSession }) => {
      const result = await openDesktopStructuredSession(
        {
          kind: 'history',
          structuredSession: { workspaceId: entry.worktreeId, sessionId: entry.sessionId },
          ...(entry.agent ? { agent: entry.agent } : {})
        },
        host
      )
      if (result.kind === 'opened' && entry.position) {
        restoreRecentlyClosedTabPosition(get, entry.worktreeId, entry.sessionId, entry.position)
      }
    })
    .catch(() => {})
}

export type RecentlyClosedTabsSlice = {
  /** Newest-first close order across the terminal/browser/editor/chat reopen stacks
   *  so Cmd+Shift+T pops true cross-type MRU (Chrome/Ghostty semantics). */
  recentlyClosedTabKindsByWorktree: Record<string, RecentlyClosedTabKind[]>
  recentlyClosedChatTabsByWorktree: Record<string, RecentlyClosedChatTab[]>
  recentlyClosedTabWorktreeHistory: string[]
  recordClosedChatTab: (entry: RecentlyClosedChatTab) => void
  reopenClosedTab: (worktreeId: string) => boolean
  reopenClosedChatTab: (worktreeId: string) => boolean
  reopenClosedChatTabById: (worktreeId: string, sessionId: string) => boolean
  dismissClosedChatTab: (worktreeId: string, sessionId: string) => void
  reopenLastClosedTab: () => string | null
}

export const createRecentlyClosedTabsSlice: StateCreator<
  AppState,
  [],
  [],
  RecentlyClosedTabsSlice
> = (set, get) => {
  const initialClosedChats = loadRecentlyClosedChatTabsStorage()
  return {
    recentlyClosedTabKindsByWorktree: seedRecentlyClosedTabKindsFromChats(
      initialClosedChats.byWorktree
    ),
    recentlyClosedChatTabsByWorktree: initialClosedChats.byWorktree,
    recentlyClosedTabWorktreeHistory: initialClosedChats.worktreeHistory,

    recordClosedChatTab: (entry) => {
      set((s) => {
        const nextChats = prependClosedChatTab(s.recentlyClosedChatTabsByWorktree, entry)
        const nextHistory = pushClosedTabWorktreeHistory(
          s.recentlyClosedTabWorktreeHistory,
          entry.worktreeId
        )
        saveRecentlyClosedChatTabsStorage(nextChats, nextHistory)
        return {
          recentlyClosedChatTabsByWorktree: nextChats,
          recentlyClosedTabWorktreeHistory: nextHistory,
          recentlyClosedTabKindsByWorktree: pushRecentlyClosedTabKind(
            s.recentlyClosedTabKindsByWorktree,
            entry.worktreeId,
            'chat'
          )
        }
      })
    },

    reopenClosedChatTab: (worktreeId) => {
      let popped: RecentlyClosedChatTab | null = null
      set((s) => {
        const existing = s.recentlyClosedChatTabsByWorktree?.[worktreeId] ?? []
        const target = existing[0]
        if (!target) {
          return s
        }
        const { nextMap, removed } = removeClosedChatTabBySessionId(
          s.recentlyClosedChatTabsByWorktree,
          worktreeId,
          target.sessionId
        )
        popped = removed
        saveRecentlyClosedChatTabsStorage(nextMap, s.recentlyClosedTabWorktreeHistory)
        return { recentlyClosedChatTabsByWorktree: nextMap }
      })
      if (!popped) {
        return false
      }
      restoreClosedChatEntry(get, popped)
      return true
    },

    reopenClosedChatTabById: (worktreeId, sessionId) => {
      let popped: RecentlyClosedChatTab | null = null
      set((s) => {
        const { nextMap, removed } = removeClosedChatTabBySessionId(
          s.recentlyClosedChatTabsByWorktree,
          worktreeId,
          sessionId
        )
        if (!removed) {
          return s
        }
        popped = removed
        saveRecentlyClosedChatTabsStorage(nextMap, s.recentlyClosedTabWorktreeHistory)
        return {
          recentlyClosedChatTabsByWorktree: nextMap,
          recentlyClosedTabKindsByWorktree: consumeOneClosedChatKind(
            s.recentlyClosedTabKindsByWorktree,
            worktreeId
          )
        }
      })
      if (!popped) {
        return false
      }
      restoreClosedChatEntry(get, popped)
      return true
    },

    dismissClosedChatTab: (worktreeId, sessionId) => {
      set((s) => {
        const { nextMap, removed } = removeClosedChatTabBySessionId(
          s.recentlyClosedChatTabsByWorktree,
          worktreeId,
          sessionId
        )
        if (!removed) {
          return s
        }
        saveRecentlyClosedChatTabsStorage(nextMap, s.recentlyClosedTabWorktreeHistory)
        return {
          recentlyClosedChatTabsByWorktree: nextMap,
          recentlyClosedTabKindsByWorktree: consumeOneClosedChatKind(
            s.recentlyClosedTabKindsByWorktree,
            worktreeId
          )
        }
      })
    },

    reopenClosedTab: (worktreeId) => {
      // Kind entries can outlive tighter/deduped snapshots; skip drained kinds, bounded by one shift per entry.
      for (;;) {
        let kind: RecentlyClosedTabKind | undefined
        set((s) => {
          const kinds = s.recentlyClosedTabKindsByWorktree[worktreeId] ?? []
          kind = kinds[0]
          if (!kind) {
            return s
          }
          return {
            recentlyClosedTabKindsByWorktree: {
              ...s.recentlyClosedTabKindsByWorktree,
              [worktreeId]: kinds.slice(1)
            }
          }
        })
        if (!kind) {
          return false
        }
        const reopened =
          kind === 'terminal'
            ? get().reopenClosedTerminalTab(worktreeId)
            : kind === 'browser'
              ? get().reopenClosedBrowserTab(worktreeId) !== null
              : kind === 'chat'
                ? get().reopenClosedChatTab(worktreeId)
                : get().reopenClosedEditorTab(worktreeId)
        if (reopened) {
          return true
        }
      }
    },

    reopenLastClosedTab: () => {
      const state = get()
      const candidates = [
        ...state.recentlyClosedTabWorktreeHistory,
        ...Object.keys(state.recentlyClosedTabKindsByWorktree).filter(
          (id) => (state.recentlyClosedTabKindsByWorktree[id]?.length ?? 0) > 0
        ),
        ...Object.keys(state.recentlyClosedChatTabsByWorktree).filter(
          (id) => (state.recentlyClosedChatTabsByWorktree[id]?.length ?? 0) > 0
        )
      ]
      const tried = new Set<string>()
      for (const worktreeId of candidates) {
        if (tried.has(worktreeId)) {
          continue
        }
        tried.add(worktreeId)
        if (get().reopenClosedTab(worktreeId)) {
          return worktreeId
        }
      }
      return null
    }
  }
}

import { create } from 'zustand'

const STORAGE_KEY = 'orca:ide-open-chat-tabs:v1'
const MAX_PERSISTED_WORKSPACES = 40

function loadPersistedTabs(): Record<string, string[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const out: Record<string, string[]> = {}
    for (const [wsKey, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        const ids = list.filter(
          (item): item is string => typeof item === 'string' && item.length > 0
        )
        if (ids.length > 0) {
          out[wsKey] = ids
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

function persistTabs(byWorkspace: Record<string, string[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    const entries = Object.entries(byWorkspace).slice(-MAX_PERSISTED_WORKSPACES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Ignore storage quota errors
  }
}

type IdeChatTabsState = {
  openTabIdsByWorkspace: Record<string, string[]>
  ensureTabOpen: (workspaceKey: string, conversationId: string) => void
  syncWorkspaceTabs: (
    workspaceKey: string,
    availableIds: readonly string[],
    activeId: string | null
  ) => void
  closeTab: (workspaceKey: string, tabId: string) => string | null
  closeOtherTabs: (workspaceKey: string, keepTabId: string) => void
}

export const useIdeChatTabsStore = create<IdeChatTabsState>((set, get) => ({
  openTabIdsByWorkspace: loadPersistedTabs(),

  ensureTabOpen: (workspaceKey, conversationId) => {
    if (!workspaceKey || !conversationId) {
      return
    }
    const current = get().openTabIdsByWorkspace[workspaceKey] ?? []
    if (current.includes(conversationId)) {
      return
    }
    const nextMap = {
      ...get().openTabIdsByWorkspace,
      [workspaceKey]: [...current, conversationId]
    }
    persistTabs(nextMap)
    set({ openTabIdsByWorkspace: nextMap })
  },

  syncWorkspaceTabs: (workspaceKey, availableIds, activeId) => {
    if (!workspaceKey) {
      return
    }
    const availableSet = new Set(availableIds)
    const existing = get().openTabIdsByWorkspace[workspaceKey] ?? []
    let next = existing.filter((id) => availableSet.has(id))
    if (activeId && availableSet.has(activeId) && !next.includes(activeId)) {
      next = [...next, activeId]
    } else if (next.length === 0 && availableIds[0]) {
      next = [availableIds[0]]
    }
    const unchanged =
      next.length === existing.length && next.every((id, index) => id === existing[index])
    if (unchanged) {
      return
    }
    const nextMap = { ...get().openTabIdsByWorkspace, [workspaceKey]: next }
    persistTabs(nextMap)
    set({ openTabIdsByWorkspace: nextMap })
  },

  closeTab: (workspaceKey, tabId) => {
    const current = get().openTabIdsByWorkspace[workspaceKey] ?? []
    const idx = current.indexOf(tabId)
    if (idx === -1) {
      return current[0] ?? null
    }
    const next = current.filter((id) => id !== tabId)
    const fallbackId = next[idx] ?? next[idx - 1] ?? null
    const nextMap = { ...get().openTabIdsByWorkspace, [workspaceKey]: next }
    persistTabs(nextMap)
    set({ openTabIdsByWorkspace: nextMap })
    return fallbackId
  },

  closeOtherTabs: (workspaceKey, keepTabId) => {
    const nextMap = {
      ...get().openTabIdsByWorkspace,
      [workspaceKey]: [keepTabId]
    }
    persistTabs(nextMap)
    set({ openTabIdsByWorkspace: nextMap })
  }
}))

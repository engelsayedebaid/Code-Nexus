import type { AgentType } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { Tab } from '../../../../../shared/tab-types'
import type { RecentlyClosedTabPosition } from './recently-closed-tab-position'

export const MAX_RECENT_CLOSED_CHAT_TABS = 20
export const MAX_RECENT_CLOSED_TAB_WORKTREES = 30
const RECENTLY_CLOSED_CHAT_TABS_STORAGE_KEY = 'orca.recentlyClosedChatTabs.v1'

export type RecentlyClosedChatTab = {
  id: string
  sessionId: string
  worktreeId: string
  groupId?: string
  executionHostId?: ExecutionHostId
  agent?: AgentType
  label: string
  customLabel?: string
  closedAt: number
  position?: RecentlyClosedTabPosition
}

type PersistedClosedChatsPayload = {
  byWorktree: Record<string, RecentlyClosedChatTab[]>
  worktreeHistory: string[]
}

function isValidClosedChatEntry(value: unknown): value is RecentlyClosedChatTab {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Partial<RecentlyClosedChatTab>
  return (
    typeof entry.id === 'string' &&
    typeof entry.sessionId === 'string' &&
    entry.sessionId.length > 0 &&
    typeof entry.worktreeId === 'string' &&
    entry.worktreeId.length > 0 &&
    typeof entry.label === 'string' &&
    typeof entry.closedAt === 'number' &&
    Number.isFinite(entry.closedAt)
  )
}

export function loadRecentlyClosedChatTabsStorage(): PersistedClosedChatsPayload {
  try {
    const raw = globalThis.localStorage?.getItem(RECENTLY_CLOSED_CHAT_TABS_STORAGE_KEY)
    if (!raw) {
      return { byWorktree: {}, worktreeHistory: [] }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedClosedChatsPayload> | null
    if (!parsed || typeof parsed !== 'object') {
      return { byWorktree: {}, worktreeHistory: [] }
    }
    const byWorktree: Record<string, RecentlyClosedChatTab[]> = {}
    if (parsed.byWorktree && typeof parsed.byWorktree === 'object') {
      for (const [worktreeId, entries] of Object.entries(parsed.byWorktree)) {
        if (!Array.isArray(entries)) {
          continue
        }
        const valid = entries.filter(isValidClosedChatEntry).slice(0, MAX_RECENT_CLOSED_CHAT_TABS)
        if (valid.length > 0) {
          byWorktree[worktreeId] = valid
        }
      }
    }
    const worktreeHistory = Array.isArray(parsed.worktreeHistory)
      ? parsed.worktreeHistory
          .filter((id): id is string => typeof id === 'string' && (byWorktree[id]?.length ?? 0) > 0)
          .slice(0, MAX_RECENT_CLOSED_TAB_WORKTREES)
      : Object.keys(byWorktree).slice(0, MAX_RECENT_CLOSED_TAB_WORKTREES)
    return { byWorktree, worktreeHistory }
  } catch {
    return { byWorktree: {}, worktreeHistory: [] }
  }
}

export function saveRecentlyClosedChatTabsStorage(
  byWorktree: Record<string, RecentlyClosedChatTab[]>,
  worktreeHistory: string[]
): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) {
      return
    }
    const compact: Record<string, RecentlyClosedChatTab[]> = {}
    for (const [worktreeId, entries] of Object.entries(byWorktree)) {
      if (entries.length > 0) {
        compact[worktreeId] = entries.slice(0, MAX_RECENT_CLOSED_CHAT_TABS)
      }
    }
    if (Object.keys(compact).length === 0) {
      storage.removeItem(RECENTLY_CLOSED_CHAT_TABS_STORAGE_KEY)
      return
    }
    storage.setItem(
      RECENTLY_CLOSED_CHAT_TABS_STORAGE_KEY,
      JSON.stringify({
        byWorktree: compact,
        worktreeHistory: worktreeHistory.slice(0, MAX_RECENT_CLOSED_TAB_WORKTREES)
      } satisfies PersistedClosedChatsPayload)
    )
  } catch {
    // Storage quota or restricted test environments must not block tab closing.
  }
}

export function buildClosedChatTabSnapshot(
  tab: Pick<
    Tab,
    | 'entityId'
    | 'worktreeId'
    | 'groupId'
    | 'executionHostId'
    | 'agentSessionAgent'
    | 'label'
    | 'generatedLabel'
    | 'aiVaultTitle'
    | 'customLabel'
  >,
  position?: RecentlyClosedTabPosition,
  closedAt = Date.now()
): RecentlyClosedChatTab {
  const customLabel = tab.customLabel?.trim() || undefined
  const label =
    customLabel ||
    tab.aiVaultTitle?.title?.trim() ||
    tab.generatedLabel?.trim() ||
    tab.label?.trim() ||
    'Chat'
  return {
    id: `${tab.worktreeId}:${tab.entityId}`,
    sessionId: tab.entityId,
    worktreeId: tab.worktreeId,
    groupId: tab.groupId,
    ...(tab.executionHostId ? { executionHostId: tab.executionHostId } : {}),
    ...(tab.agentSessionAgent ? { agent: tab.agentSessionAgent } : {}),
    label,
    ...(customLabel ? { customLabel } : {}),
    closedAt,
    ...(position ? { position } : {})
  }
}

export function prependClosedChatTab(
  map: Record<string, RecentlyClosedChatTab[]>,
  entry: RecentlyClosedChatTab
): Record<string, RecentlyClosedChatTab[]> {
  const existing = map[entry.worktreeId] ?? []
  const nextList = [entry, ...existing.filter((item) => item.sessionId !== entry.sessionId)].slice(
    0,
    MAX_RECENT_CLOSED_CHAT_TABS
  )
  return {
    ...map,
    [entry.worktreeId]: nextList
  }
}

export function removeClosedChatTabBySessionId(
  map: Record<string, RecentlyClosedChatTab[]>,
  worktreeId: string,
  sessionId: string
): {
  nextMap: Record<string, RecentlyClosedChatTab[]>
  removed: RecentlyClosedChatTab | null
} {
  const existing = map[worktreeId] ?? []
  const matchIndex = existing.findIndex((item) => item.sessionId === sessionId)
  if (matchIndex === -1) {
    return { nextMap: map, removed: null }
  }
  const removed = existing[matchIndex]
  const nextList = existing.filter((_, idx) => idx !== matchIndex)
  if (nextList.length === 0) {
    const rest = { ...map }
    delete rest[worktreeId]
    return { nextMap: rest, removed }
  }
  return {
    nextMap: { ...map, [worktreeId]: nextList },
    removed
  }
}

export function pushClosedTabWorktreeHistory(
  history: readonly string[],
  worktreeId: string
): string[] {
  return [worktreeId, ...history.filter((id) => id !== worktreeId)].slice(
    0,
    MAX_RECENT_CLOSED_TAB_WORKTREES
  )
}

export function removeClosedTabWorktreeHistoryEntries(
  history: readonly string[],
  worktreeIds: ReadonlySet<string>
): string[] {
  return history.filter((id) => !worktreeIds.has(id))
}

export function seedRecentlyClosedTabKindsFromChats(
  byWorktree: Record<string, RecentlyClosedChatTab[]>
): Record<string, 'chat'[]> {
  const seeded: Record<string, 'chat'[]> = {}
  for (const [worktreeId, entries] of Object.entries(byWorktree)) {
    if (entries.length > 0) {
      seeded[worktreeId] = entries.map(() => 'chat')
    }
  }
  return seeded
}

import { normalizeRuntimePathForComparison } from '../cross-platform-path'
import { worktreeIdentityKey } from '../worktree/id'

export const GLOBAL_CONVERSATION_WORKSPACE_KEY = '__global__'

export type ChatConversationKind = 'multi-model' | 'council'

export type ChatConversationStatus =
  | 'draft'
  | 'active'
  | 'running'
  | 'paused'
  | 'completed'
  | 'interrupted'
  | 'error'

export type ChatMessageStatus = 'pending' | 'streaming' | 'completed' | 'interrupted' | 'error'

export type ChatConversationRecord = {
  id: string
  kind: ChatConversationKind
  workspaceKey: string
  workspaceId: string | null
  scopeKey: string
  title: string
  status: ChatConversationStatus
  configJson: string
  metadataJson: string
  createdAt: number
  updatedAt: number
  lastMessageAt: number
}

export type ChatMessageRecord = {
  id: string
  conversationId: string
  sequence: number
  role: string
  content: string
  status: ChatMessageStatus
  metadataJson: string
  createdAt: number
  updatedAt: number
}

export type ChatConversationWithMessages = {
  conversation: ChatConversationRecord
  messages: ChatMessageRecord[]
  hasMore: boolean
}

export type UpsertChatConversationInput = {
  id: string
  kind: ChatConversationKind
  workspaceId?: string | null
  scopeKey: string
  title: string
  status: ChatConversationStatus
  configJson?: string
  metadataJson?: string
  createdAt?: number
  updatedAt?: number
  lastMessageAt?: number
}

export type UpsertChatMessageInput = {
  id: string
  conversationId: string
  sequence: number
  role: string
  content: string
  status: ChatMessageStatus
  metadataJson?: string
  createdAt?: number
  updatedAt?: number
}

export type UpsertChatConversationTurnInput = {
  conversation: UpsertChatConversationInput
  messages: UpsertChatMessageInput[]
}

export type ListChatConversationsInput = {
  workspaceId?: string | null
  kind?: ChatConversationKind
  scopeKey?: string
  includeGlobal?: boolean
  limit?: number
}

export type GetChatConversationInput = {
  conversationId: string
  limit?: number
  beforeSequence?: number
}

export type ChatWorkspaceStructuredHistoryEntry = {
  sessionId: string
  agent: string
  workspaceId: string
  workspaceKey: string
  title: string | null
  createdAt: number
  updatedAt: number
  tabId: string | null
  isOpenTab: boolean
  status: string | null
}

/** Normalize workspace identity for queries without rewriting stored workspace IDs. */
export function normalizeConversationWorkspaceKey(workspaceId: string | null | undefined): string {
  const trimmed = workspaceId?.trim()
  if (!trimmed) {
    return GLOBAL_CONVERSATION_WORKSPACE_KEY
  }
  return trimmed.includes('::')
    ? worktreeIdentityKey(trimmed)
    : normalizeRuntimePathForComparison(trimmed)
}

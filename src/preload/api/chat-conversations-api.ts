import type {
  ChatConversationRecord,
  ChatConversationWithMessages,
  ChatMessageRecord,
  ChatWorkspaceStructuredHistoryEntry,
  GetChatConversationInput,
  ListChatConversationsInput,
  UpsertChatConversationInput,
  UpsertChatConversationTurnInput,
  UpsertChatMessageInput
} from '../../shared/chat-conversations/chat-conversation-types'

export type ChatConversationsApi = {
  list: (input?: ListChatConversationsInput) => Promise<ChatConversationRecord[]>
  get: (input: GetChatConversationInput) => Promise<ChatConversationWithMessages | null>
  upsertConversation: (input: UpsertChatConversationInput) => Promise<ChatConversationRecord>
  upsertMessages: (
    messages: readonly UpsertChatMessageInput[],
    streamed?: boolean
  ) => Promise<ChatMessageRecord[]>
  saveTurn: (
    input: UpsertChatConversationTurnInput,
    streamed?: boolean
  ) => Promise<ChatConversationWithMessages>
  deleteConversation: (conversationId: string) => Promise<boolean>
  importConversations: (
    entries: readonly UpsertChatConversationTurnInput[]
  ) => Promise<{ importedCount: number }>
  getKvState: (key: string) => Promise<string | null>
  setKvState: (key: string, valueJson: string) => Promise<void>
  importKvStateIfMissing: (entries: Record<string, string>) => Promise<number>
  listStructuredHistory: (workspaceId?: string | null) => Promise<ChatWorkspaceStructuredHistoryEntry[]>
}

import { create } from 'zustand'
import type {
  IdeChatAttachment,
  IdeExecutionMode
} from '../../../../shared/ide-agent/ide-agent-types'

export type IdeQueuedPromptItem = {
  id: string
  conversationId: string
  worktreeSelector: string
  text: string
  mode: IdeExecutionMode
  agentId: string
  modelId: string
  multiAgentEnabled: boolean
  followAgent: boolean
  attachments: IdeChatAttachment[]
  createdAt: number
}

type IdePromptQueueState = {
  byConversation: Record<string, IdeQueuedPromptItem[]>
  enqueue: (item: Omit<IdeQueuedPromptItem, 'id' | 'createdAt'>) => IdeQueuedPromptItem
  remove: (conversationId: string, itemId: string) => IdeQueuedPromptItem | null
  moveUp: (conversationId: string, itemId: string) => void
  shiftNext: (conversationId: string) => IdeQueuedPromptItem | null
  clear: (conversationId: string) => void
}

function makeQueueItemId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export const useIdePromptQueueStore = create<IdePromptQueueState>((set, get) => ({
  byConversation: {},

  enqueue: (input) => {
    const item: IdeQueuedPromptItem = {
      ...input,
      id: makeQueueItemId(),
      createdAt: Date.now()
    }
    set((s) => ({
      byConversation: {
        ...s.byConversation,
        [input.conversationId]: [...(s.byConversation[input.conversationId] ?? []), item]
      }
    }))
    return item
  },

  remove: (conversationId, itemId) => {
    const list = get().byConversation[conversationId] ?? []
    const found = list.find((entry) => entry.id === itemId) ?? null
    if (!found) {
      return null
    }
    set((s) => ({
      byConversation: {
        ...s.byConversation,
        [conversationId]: (s.byConversation[conversationId] ?? []).filter(
          (entry) => entry.id !== itemId
        )
      }
    }))
    return found
  },

  moveUp: (conversationId, itemId) => {
    set((s) => {
      const list = [...(s.byConversation[conversationId] ?? [])]
      const index = list.findIndex((entry) => entry.id === itemId)
      if (index <= 0) {
        return s
      }
      const prev = list[index - 1]
      list[index - 1] = list[index]
      list[index] = prev
      return {
        byConversation: {
          ...s.byConversation,
          [conversationId]: list
        }
      }
    })
  },

  shiftNext: (conversationId) => {
    const list = get().byConversation[conversationId] ?? []
    const first = list[0] ?? null
    if (!first) {
      return null
    }
    set((s) => ({
      byConversation: {
        ...s.byConversation,
        [conversationId]: (s.byConversation[conversationId] ?? []).slice(1)
      }
    }))
    return first
  },

  clear: (conversationId) => {
    set((s) => {
      if (!s.byConversation[conversationId]?.length) {
        return s
      }
      return {
        byConversation: {
          ...s.byConversation,
          [conversationId]: []
        }
      }
    })
  }
}))

import { create } from 'zustand'
import { subscribeRuntimeRpc } from '@/runtime/rpc/subscriptions/runtime-rpc-subscribe'
import { syncIdeAgentEventToWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'
import type {
  IdeAgentStreamEvent,
  IdeChatAttachment
} from '../../../../shared/ide-agent/ide-agent-types'
import {
  applyIdeAgentStreamEvent,
  type IdeAgentStoreData
} from './ide-agent-event-reducer'
import {
  createIdeAgentStoreActions,
  initializeWorkspaceSession
} from './ide-agent-store-actions'

type IdeAgentStoreState = IdeAgentStoreData &
  ReturnType<typeof createIdeAgentStoreActions> & {
    clearError: () => void
    setDraft: (conversationId: string, text: string) => void
    addAttachment: (conversationId: string, attachment: IdeChatAttachment) => void
    removeAttachment: (conversationId: string, attachmentId: string) => void
    clearAttachments: (conversationId: string) => void
    ensureWorkspaceInitialized: (
      workspaceKey: string,
      workspacePath: string,
      worktreeSelector: string
    ) => Promise<void>
  }

let activeEventUnsubscribe: (() => void) | null = null

export const useIdeAgentStore = create<IdeAgentStoreState>((set, get) => ({
  workspaceKey: null,
  providers: [],
  providersLoading: false,
  conversations: [],
  activeConversation: null,
  draftsByConversation: {},
  attachmentsByConversation: {},
  todosByWorkspace: {},
  commandLiveOutput: {},
  lastError: null,
  subscriptionActive: false,

  clearError: () => set({ lastError: null }),

  setDraft: (conversationId, text) =>
    set((s) => ({
      draftsByConversation: { ...s.draftsByConversation, [conversationId]: text }
    })),

  addAttachment: (conversationId, attachment) =>
    set((s) => ({
      attachmentsByConversation: {
        ...s.attachmentsByConversation,
        [conversationId]: [...(s.attachmentsByConversation[conversationId] ?? []), attachment]
      }
    })),

  removeAttachment: (conversationId, attachmentId) =>
    set((s) => ({
      attachmentsByConversation: {
        ...s.attachmentsByConversation,
        [conversationId]: (s.attachmentsByConversation[conversationId] ?? []).filter(
          (a) => a.id !== attachmentId
        )
      }
    })),

  clearAttachments: (conversationId) =>
    set((s) => ({
      attachmentsByConversation: { ...s.attachmentsByConversation, [conversationId]: [] }
    })),

  ensureWorkspaceInitialized: async (workspaceKey, workspacePath, worktreeSelector) => {
    const state = get()
    if (!state.subscriptionActive && typeof window !== 'undefined' && Boolean(window.api?.runtime?.subscribe)) {
      set({ subscriptionActive: true })
      subscribeRuntimeRpc({ kind: 'local' }, 'ideAgent.subscribeEvents', {}, {
        onEvent: (raw) => {
          if (!raw || typeof raw !== 'object') {
            return
          }
          const event = raw as IdeAgentStreamEvent
          syncIdeAgentEventToWorkspace(event)
          set((curr) => applyIdeAgentStreamEvent(curr, event))
        },
        onError: () => set({ subscriptionActive: false }),
        onClose: () => set({ subscriptionActive: false })
      })
        .then((sub) => {
          activeEventUnsubscribe?.()
          activeEventUnsubscribe = sub.unsubscribe
        })
        .catch(() => {
          set({ subscriptionActive: false })
        })
    }
    if (state.providers.length === 0 && !state.providersLoading) {
      void state.refreshProviders(worktreeSelector)
    }
    if (state.workspaceKey === workspaceKey && state.activeConversation) {
      return
    }
    set({ workspaceKey })
    try {
      await initializeWorkspaceSession(workspaceKey, workspacePath, set)
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  ...createIdeAgentStoreActions(set, get)
}))

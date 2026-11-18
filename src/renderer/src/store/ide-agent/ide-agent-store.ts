import { create } from 'zustand'
import { subscribeRuntimeRpc } from '@/runtime/rpc/subscriptions/runtime-rpc-subscribe'
import { syncIdeAgentEventToWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'
import type {
  IdeAgentStreamEvent,
  IdeChatAttachment
} from '../../../../shared/ide-agent/ide-agent-types'
import { applyIdeAgentStreamEvent, type IdeAgentStoreData } from './ide-agent-event-reducer'
import { useIdePromptQueueStore } from './ide-prompt-queue'
import { createIdeAgentStoreActions, initializeWorkspaceSession } from './ide-agent-store-actions'

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
let subscriptionGeneration = 0
let workspaceInitGeneration = 0

function isIdeStreamEvent(value: unknown): value is IdeAgentStreamEvent {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

const bufferedEvents: IdeAgentStreamEvent[] = []
let flushScheduled = false
const drainingConversations = new Set<string>()

function maybeDrainQueuedPrompt(): void {
  const store = useIdeAgentStore.getState()
  const active = store.activeConversation
  if (!active || active.activeRunId !== null) {
    return
  }
  if (active.status !== 'idle' && active.status !== 'completed') {
    return
  }
  if (drainingConversations.has(active.id)) {
    return
  }
  const queuedList = useIdePromptQueueStore.getState().byConversation[active.id]
  if (!queuedList || queuedList.length === 0) {
    return
  }
  const nextItem = useIdePromptQueueStore.getState().shiftNext(active.id)
  if (!nextItem) {
    return
  }
  drainingConversations.add(active.id)
  void store
    .sendPrompt({
      conversationId: nextItem.conversationId,
      worktreeSelector: nextItem.worktreeSelector,
      text: nextItem.text,
      mode: nextItem.mode,
      agentId: nextItem.agentId,
      modelId: nextItem.modelId,
      multiAgentEnabled: nextItem.multiAgentEnabled,
      followAgent: nextItem.followAgent,
      fromQueue: { attachments: nextItem.attachments }
    })
    .finally(() => {
      drainingConversations.delete(active.id)
    })
}

function scheduleBufferedEventFlush(
  applyBatch: (events: readonly IdeAgentStreamEvent[]) => void
): void {
  if (flushScheduled) {
    return
  }
  flushScheduled = true
  const runFlush = (): void => {
    flushScheduled = false
    if (bufferedEvents.length === 0) {
      return
    }
    const batch = bufferedEvents.splice(0)
    applyBatch(batch)
    maybeDrainQueuedPrompt()
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    typeof document !== 'undefined' &&
    !document.hidden
  ) {
    window.requestAnimationFrame(runFlush)
  } else {
    setTimeout(runFlush, 16)
  }
}

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
    set((s) => {
      const existing = s.attachmentsByConversation[conversationId] ?? []
      if (existing.length >= 24) {
        return { lastError: 'Maximum of 24 attachments reached for this message.' }
      }
      const duplicate = existing.some(
        (item) =>
          item.kind === attachment.kind &&
          item.relativePath &&
          item.relativePath === attachment.relativePath &&
          item.lineRange?.start === attachment.lineRange?.start &&
          item.lineRange?.end === attachment.lineRange?.end
      )
      if (duplicate) {
        return s
      }
      return {
        attachmentsByConversation: {
          ...s.attachmentsByConversation,
          [conversationId]: [...existing, attachment]
        }
      }
    }),

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
    if (
      !state.subscriptionActive &&
      typeof window !== 'undefined' &&
      Boolean(window.api?.runtime?.subscribe)
    ) {
      subscriptionGeneration += 1
      const myGen = subscriptionGeneration
      set({ subscriptionActive: true })
      subscribeRuntimeRpc(
        { kind: 'local' },
        'ideAgent.subscribeEvents',
        {},
        {
          onEvent: (raw) => {
            if (!isIdeStreamEvent(raw)) {
              return
            }
            syncIdeAgentEventToWorkspace(raw, get().activeConversation)
            bufferedEvents.push(raw)
            scheduleBufferedEventFlush((batch) => {
              set((curr) => {
                let next: IdeAgentStoreData = curr
                for (const ev of batch) {
                  const patch = applyIdeAgentStreamEvent(next, ev)
                  next = patch === next ? next : { ...next, ...patch }
                }
                return next === curr ? curr : next
              })
            })
          },
          onError: () => {
            if (myGen === subscriptionGeneration) {
              set({ subscriptionActive: false })
            }
          },
          onClose: () => {
            if (myGen === subscriptionGeneration) {
              set({ subscriptionActive: false })
            }
          }
        }
      )
        .then((sub) => {
          if (myGen !== subscriptionGeneration) {
            sub.unsubscribe()
            return
          }
          activeEventUnsubscribe?.()
          activeEventUnsubscribe = sub.unsubscribe
        })
        .catch(() => {
          if (myGen === subscriptionGeneration) {
            set({ subscriptionActive: false })
          }
        })
    }

    const workspaceChanged = state.workspaceKey !== workspaceKey
    if ((state.providers.length === 0 || workspaceChanged) && !state.providersLoading) {
      void get().refreshProviders(worktreeSelector)
    }
    if (
      !workspaceChanged &&
      state.activeConversation &&
      state.activeConversation.workspaceKey === workspaceKey
    ) {
      return
    }
    workspaceInitGeneration += 1
    const myInitGen = workspaceInitGeneration
    if (workspaceChanged) {
      set({
        workspaceKey,
        conversations: [],
        activeConversation: null,
        lastError: null
      })
    } else {
      set({ workspaceKey })
    }
    try {
      await initializeWorkspaceSession(
        workspaceKey,
        workspacePath,
        () => myInitGen !== workspaceInitGeneration || get().workspaceKey !== workspaceKey,
        set
      )
    } catch (error) {
      if (myInitGen === workspaceInitGeneration) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    }
  },

  ...createIdeAgentStoreActions(set, get)
}))

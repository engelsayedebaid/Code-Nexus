import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { useAppStore } from '@/store'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode,
  IdeLiveEditSpeed,
  IdeProviderAgentOption,
  IdeTodoItem
} from '../../../../shared/ide-agent/ide-agent-types'
import {
  mergeIncomingConversation,
  type IdeAgentStoreData,
  updateSummaryFromConversation
} from './ide-agent-event-reducer'
import { useIdeChatTabsStore } from './ide-chat-tabs-store'

export type IdeStoreSet = (
  partial:
    | Partial<IdeAgentStoreData>
    | ((state: IdeAgentStoreData) => Partial<IdeAgentStoreData> | IdeAgentStoreData)
) => void

export function toIdeStoreError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function applyConversationUpdate(set: IdeStoreSet, conversation: IdeConversation): void {
  set((curr) => {
    if (curr.workspaceKey && curr.workspaceKey !== conversation.workspaceKey) {
      return curr
    }
    return {
      conversations: updateSummaryFromConversation(curr.conversations, conversation),
      activeConversation:
        curr.activeConversation?.id === conversation.id
          ? mergeIncomingConversation(curr.activeConversation, conversation)
          : curr.activeConversation,
      lastError: null
    }
  })
}

export function createIdeConversationLifecycleActions(
  set: IdeStoreSet,
  get: () => IdeAgentStoreData
) {
  return {
    refreshProviders: async (worktreeSelector?: string) => {
      set({ providersLoading: true })
      try {
        const { agents } = await callRuntimeRpc<{ agents: IdeProviderAgentOption[] }>(
          { kind: 'local' },
          'ideAgent.listProviders',
          worktreeSelector ? { worktreeSelector } : {}
        )
        set({ providers: agents, providersLoading: false })
      } catch (error) {
        set({ providersLoading: false, lastError: toIdeStoreError(error) })
      }
    },

    selectConversation: async (conversationId: string) => {
      const expectedWorkspace = get().workspaceKey
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation | null }>(
          { kind: 'local' },
          'ideAgent.getConversation',
          { conversationId }
        )
        if (
          conversation &&
          (!expectedWorkspace || conversation.workspaceKey === expectedWorkspace)
        ) {
          useIdeChatTabsStore.getState().ensureTabOpen(conversation.workspaceKey, conversation.id)
          useAppStore.getState().setIdeFollowAgent(conversation.followAgent)
          set({ activeConversation: conversation, lastError: null })
        }
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
      }
    },

    createNewConversation: async (params: {
      workspaceKey: string
      workspacePath: string
      mode?: IdeExecutionMode
    }) => {
      try {
        const active = get().activeConversation
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.createConversation',
          {
            workspaceKey: params.workspaceKey,
            workspacePath: params.workspacePath,
            mode: params.mode ?? active?.mode ?? 'agent',
            ...(active?.agentId ? { agentId: active.agentId } : {}),
            ...(active?.modelId ? { modelId: active.modelId } : {}),
            multiAgentEnabled: active?.multiAgentEnabled ?? false,
            followAgent: active?.followAgent ?? true
          }
        )
        useIdeChatTabsStore.getState().ensureTabOpen(conversation.workspaceKey, conversation.id)
        set((curr) =>
          curr.workspaceKey && curr.workspaceKey !== conversation.workspaceKey
            ? curr
            : {
                conversations: updateSummaryFromConversation(curr.conversations, conversation),
                activeConversation: conversation,
                lastError: null
              }
        )
        return conversation
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
        return null
      }
    },

    deleteConversation: async (conversationId: string) => {
      try {
        const targetConv = get().activeConversation
        await callRuntimeRpc({ kind: 'local' }, 'ideAgent.deleteConversation', { conversationId })
        const remaining = get().conversations.filter((c) => c.id !== conversationId)
        set({ conversations: remaining })
        if (targetConv?.id === conversationId) {
          if (remaining[0]) {
            const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation | null }>(
              { kind: 'local' },
              'ideAgent.getConversation',
              { conversationId: remaining[0].id }
            )
            set({ activeConversation: conversation })
          } else {
            const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
              { kind: 'local' },
              'ideAgent.createConversation',
              {
                workspaceKey: targetConv.workspaceKey,
                workspacePath: targetConv.workspacePath,
                mode: targetConv.mode
              }
            )
            set((curr) => ({
              conversations: updateSummaryFromConversation(curr.conversations, conversation),
              activeConversation: conversation
            }))
          }
        }
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
      }
    },

    updateSettings: async (params: {
      conversationId: string
      mode?: IdeExecutionMode
      agentId?: string
      modelId?: string
      multiAgentEnabled?: boolean
      followAgent?: boolean
      liveEditSpeed?: IdeLiveEditSpeed
      title?: string
    }) => {
      if (params.followAgent !== undefined) {
        useAppStore.getState().setIdeFollowAgent(params.followAgent)
      }
      set((curr) =>
        curr.activeConversation?.id === params.conversationId
          ? {
              activeConversation: {
                ...curr.activeConversation,
                ...(params.mode !== undefined ? { mode: params.mode } : {}),
                ...(params.agentId !== undefined ? { agentId: params.agentId } : {}),
                ...(params.modelId !== undefined ? { modelId: params.modelId } : {}),
                ...(params.multiAgentEnabled !== undefined
                  ? { multiAgentEnabled: params.multiAgentEnabled }
                  : {}),
                ...(params.followAgent !== undefined ? { followAgent: params.followAgent } : {}),
                ...(params.liveEditSpeed !== undefined
                  ? { liveEditSpeed: params.liveEditSpeed }
                  : {}),
                ...(params.title !== undefined ? { title: params.title } : {})
              }
            }
          : curr
      )
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.updateConversationSettings',
          params
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
      }
    },

    loadTodos: async (workspaceKey: string) => {
      try {
        const { items } = await callRuntimeRpc<{ items: IdeTodoItem[] }>(
          { kind: 'local' },
          'ideAgent.todosList',
          { workspaceKey }
        )
        set((curr) => ({ todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: items } }))
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
      }
    },

    saveTodos: async (workspaceKey: string, items: IdeTodoItem[]) => {
      const prev = get().todosByWorkspace[workspaceKey] ?? []
      set((curr) => ({ todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: items } }))
      try {
        const res = await callRuntimeRpc<{ items: IdeTodoItem[] }>(
          { kind: 'local' },
          'ideAgent.todosSave',
          { workspaceKey, items }
        )
        set((curr) => ({
          todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: res.items }
        }))
      } catch (error) {
        set((curr) => ({
          todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: prev },
          lastError: toIdeStoreError(error)
        }))
      }
    }
  }
}

export async function initializeWorkspaceSession(
  workspaceKey: string,
  workspacePath: string,
  isStale: () => boolean,
  set: IdeStoreSet
): Promise<void> {
  const [{ conversations }, { items }] = await Promise.all([
    callRuntimeRpc<{ conversations: IdeConversationSummary[] }>(
      { kind: 'local' },
      'ideAgent.listConversations',
      { workspaceKey }
    ),
    callRuntimeRpc<{ items: IdeTodoItem[] }>({ kind: 'local' }, 'ideAgent.todosList', {
      workspaceKey
    })
  ])
  if (isStale()) {
    return
  }
  set((curr) => ({
    conversations,
    todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: items }
  }))
  if (conversations.length > 0) {
    const res = await callRuntimeRpc<{ conversation: IdeConversation | null }>(
      { kind: 'local' },
      'ideAgent.getConversation',
      { conversationId: conversations[0].id }
    )
    if (isStale()) {
      return
    }
    if (res.conversation) {
      useAppStore.getState().setIdeFollowAgent(res.conversation.followAgent)
      set({ activeConversation: res.conversation })
      return
    }
  }
  const created = await callRuntimeRpc<{ conversation: IdeConversation }>(
    { kind: 'local' },
    'ideAgent.createConversation',
    { workspaceKey, workspacePath, mode: 'agent' }
  )
  if (isStale()) {
    return
  }
  set((curr) => ({
    conversations: updateSummaryFromConversation(curr.conversations, created.conversation),
    activeConversation: created.conversation
  }))
}

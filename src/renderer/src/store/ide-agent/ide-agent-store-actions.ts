import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { useAppStore } from '@/store'
import {
  collectDirtyRelativePaths,
  resolveActiveIdeWorkspace
} from '@/lib/ide-agent/ide-agent-live-sync'
import type {
  IdeCommandCategory,
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode,
  IdeLiveEditSpeed,
  IdeProviderAgentOption,
  IdeTodoItem
} from '../../../../shared/ide-agent/ide-agent-types'
import { type IdeAgentStoreData, updateSummaryFromConversation } from './ide-agent-event-reducer'

type StoreSet = (
  partial:
    | Partial<IdeAgentStoreData>
    | ((state: IdeAgentStoreData) => Partial<IdeAgentStoreData> | IdeAgentStoreData)
) => void

function applyConversationUpdate(set: StoreSet, conversation: IdeConversation): void {
  set((curr) => ({
    conversations: updateSummaryFromConversation(curr.conversations, conversation),
    activeConversation:
      curr.activeConversation?.id === conversation.id || curr.activeConversation === null
        ? conversation
        : curr.activeConversation,
    lastError: null
  }))
}

function getActiveEditorRelativePath(worktreeId?: string): string | undefined {
  const state = useAppStore.getState()
  const activeFile = state.openFiles.find((f) => f.id === state.activeFileId)
  if (!activeFile || (worktreeId && activeFile.worktreeId !== worktreeId)) {
    return undefined
  }
  return activeFile.relativePath
}

export function createIdeAgentStoreActions(set: StoreSet, get: () => IdeAgentStoreData) {
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
        set({
          providersLoading: false,
          lastError: error instanceof Error ? error.message : String(error)
        })
      }
    },

    selectConversation: async (conversationId: string) => {
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation | null }>(
          { kind: 'local' },
          'ideAgent.getConversation',
          { conversationId }
        )
        if (conversation) {
          useAppStore.getState().setIdeFollowAgent(conversation.followAgent)
          set({ activeConversation: conversation, lastError: null })
        }
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    createNewConversation: async (params: {
      workspaceKey: string
      workspacePath: string
      mode?: IdeExecutionMode
    }) => {
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
      set((curr) => ({
        conversations: updateSummaryFromConversation(curr.conversations, conversation),
        activeConversation: conversation,
        lastError: null
      }))
      return conversation
    },

    deleteConversation: async (conversationId: string) => {
      await callRuntimeRpc({ kind: 'local' }, 'ideAgent.deleteConversation', { conversationId })
      const remaining = get().conversations.filter((c) => c.id !== conversationId)
      set({ conversations: remaining })
      if (get().activeConversation?.id === conversationId) {
        if (remaining[0]) {
          const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation | null }>(
            { kind: 'local' },
            'ideAgent.getConversation',
            { conversationId: remaining[0].id }
          )
          set({ activeConversation: conversation })
        } else {
          set({ activeConversation: null })
        }
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
      const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
        { kind: 'local' },
        'ideAgent.updateConversationSettings',
        params
      )
      set((curr) => ({
        conversations: updateSummaryFromConversation(curr.conversations, conversation),
        activeConversation:
          curr.activeConversation?.id === conversation.id ? conversation : curr.activeConversation
      }))
    },

    sendPrompt: async (params: {
      conversationId: string
      worktreeSelector: string
      text: string
      mode: IdeExecutionMode
      agentId?: string
      modelId?: string
      multiAgentEnabled?: boolean
      followAgent?: boolean
      liveEditSpeed?: IdeLiveEditSpeed
    }) => {
      // The composer can hold a stale conversation snapshot; always send the latest committed config.
      const latest = get().activeConversation
      const pinned = latest?.id === params.conversationId ? latest : null
      const effective = pinned
        ? {
            ...params,
            mode: pinned.mode,
            agentId: pinned.agentId,
            modelId: pinned.modelId,
            multiAgentEnabled: pinned.multiAgentEnabled,
            followAgent: pinned.followAgent,
            liveEditSpeed: pinned.liveEditSpeed
          }
        : params
      const workspace = resolveActiveIdeWorkspace()
      const attachments = get().attachmentsByConversation[params.conversationId] ?? []
      const activeRelPath = workspace
        ? getActiveEditorRelativePath(workspace.worktreeId)
        : undefined
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.sendPrompt',
          {
            ...effective,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(activeRelPath ? { activeFilePath: activeRelPath } : {}),
            dirtyRelativePaths: workspace ? collectDirtyRelativePaths(workspace.worktreeId) : []
          }
        )
        set((curr) => ({
          conversations: updateSummaryFromConversation(curr.conversations, conversation),
          activeConversation: conversation,
          draftsByConversation: { ...curr.draftsByConversation, [params.conversationId]: '' },
          attachmentsByConversation: {
            ...curr.attachmentsByConversation,
            [params.conversationId]: []
          },
          lastError: null
        }))
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    decidePlan: async (params: {
      conversationId: string
      planId: string
      decision: 'approve' | 'reject' | 'revise'
      revisionNote?: string
      agentId?: string
      modelId?: string
    }) => {
      const workspace = resolveActiveIdeWorkspace()
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.planDecision',
          {
            ...params,
            ...(workspace ? { worktreeSelector: workspace.worktreeSelector } : {}),
            dirtyRelativePaths: collectDirtyRelativePaths(workspace?.worktreeId)
          }
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    decidePermission: async (params: {
      conversationId: string
      permissionId: string
      decision: 'approve' | 'deny'
      note?: string
    }) => {
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.permissionDecision',
          params
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    controlRun: async (params: {
      conversationId: string
      runId: string
      action: 'pause' | 'resume' | 'stop' | 'retry'
    }) => {
      const workspace = resolveActiveIdeWorkspace()
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.runControl',
          {
            ...params,
            ...(workspace ? { worktreeSelector: workspace.worktreeSelector } : {}),
            dirtyRelativePaths: collectDirtyRelativePaths(workspace?.worktreeId)
          }
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    decideChange: async (params: {
      conversationId: string
      action: 'accept' | 'reject' | 'restore_checkpoint'
      changeId?: string
      checkpointId?: string
    }) => {
      const workspace = resolveActiveIdeWorkspace()
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.changeDecision',
          {
            ...params,
            ...(workspace ? { worktreeSelector: workspace.worktreeSelector } : {}),
            dirtyRelativePaths: collectDirtyRelativePaths(workspace?.worktreeId)
          }
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    runCommand: async (params: {
      conversationId: string
      worktreeSelector: string
      command: string
      category?: IdeCommandCategory
      permissionApproved?: boolean
    }) => {
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.runCommand',
          params
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) })
      }
    },

    loadTodos: async (workspaceKey: string) => {
      const { items } = await callRuntimeRpc<{ items: IdeTodoItem[] }>(
        { kind: 'local' },
        'ideAgent.todosList',
        { workspaceKey }
      )
      set((curr) => ({ todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: items } }))
    },

    saveTodos: async (workspaceKey: string, items: IdeTodoItem[]) => {
      set((curr) => ({ todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: items } }))
      const res = await callRuntimeRpc<{ items: IdeTodoItem[] }>(
        { kind: 'local' },
        'ideAgent.todosSave',
        { workspaceKey, items }
      )
      set((curr) => ({ todosByWorkspace: { ...curr.todosByWorkspace, [workspaceKey]: res.items } }))
    }
  }
}

export async function initializeWorkspaceSession(
  workspaceKey: string,
  workspacePath: string,
  set: StoreSet
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
  set((curr) => ({
    conversations: updateSummaryFromConversation(curr.conversations, created.conversation),
    activeConversation: created.conversation
  }))
}

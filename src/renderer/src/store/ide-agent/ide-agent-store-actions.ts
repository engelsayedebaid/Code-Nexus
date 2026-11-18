import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { useAppStore } from '@/store'
import {
  collectDirtyRelativePaths,
  resolveActiveIdeWorkspace
} from '@/lib/ide-agent/ide-agent-live-sync'
import type {
  IdeChatAttachment,
  IdeCommandCategory,
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed,
  IdePermissionRequest
} from '../../../../shared/ide-agent/ide-agent-types'
import {
  mergeIncomingConversation,
  type IdeAgentStoreData,
  updateSummaryFromConversation,
  withOptimisticUserPrompt,
  withoutOptimisticUserPrompt
} from './ide-agent-event-reducer'
import {
  applyConversationUpdate,
  createIdeConversationLifecycleActions,
  initializeWorkspaceSession,
  toIdeStoreError,
  type IdeStoreSet
} from './ide-agent-conversation-actions'
import { reconcileIdeChangeDecisionEffects } from './ide-diff-review-store'

export { initializeWorkspaceSession }

function getWorkspaceEditorTabContext(worktreeId?: string): {
  activeFilePath?: string
  openFilePaths: string[]
} {
  if (!worktreeId) {
    return { openFilePaths: [] }
  }
  const state = useAppStore.getState()
  const workspaceTabs = state.openFiles.filter((f) => f.worktreeId === worktreeId && f.relativePath)
  const activeFile = workspaceTabs.find((f) => f.id === state.activeFileId)
  return {
    ...(activeFile?.relativePath ? { activeFilePath: activeFile.relativePath } : {}),
    openFilePaths: workspaceTabs.map((f) => f.relativePath).slice(0, 24)
  }
}

export function createIdeAgentStoreActions(set: IdeStoreSet, get: () => IdeAgentStoreData) {
  return {
    ...createIdeConversationLifecycleActions(set, get),

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
      fromQueue?: { attachments: IdeChatAttachment[] }
    }) => {
      const latest = get().activeConversation
      const pinned = latest?.id === params.conversationId ? latest : null
      const effective =
        pinned && !params.fromQueue
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
      const prevDraft = get().draftsByConversation[params.conversationId] ?? ''
      const attachments =
        params.fromQueue?.attachments ??
        get().attachmentsByConversation[params.conversationId] ??
        []
      const editorTabs = getWorkspaceEditorTabContext(workspace?.worktreeId)
      const now = Date.now()
      const optimisticId = `optimistic-user-${now}`
      set((curr) => ({
        ...(params.fromQueue
          ? {}
          : {
              draftsByConversation: { ...curr.draftsByConversation, [params.conversationId]: '' },
              attachmentsByConversation: {
                ...curr.attachmentsByConversation,
                [params.conversationId]: []
              }
            }),
        activeConversation: withOptimisticUserPrompt(curr.activeConversation, {
          conversationId: params.conversationId,
          optimisticId,
          now,
          text: params.text,
          mode: effective.mode,
          agentId: effective.agentId,
          modelId: effective.modelId,
          attachments
        }),
        lastError: null
      }))
      try {
        const { fromQueue: _ignoredQueueMeta, ...rpcEffective } = effective
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.sendPrompt',
          {
            ...rpcEffective,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(editorTabs.activeFilePath ? { activeFilePath: editorTabs.activeFilePath } : {}),
            ...(editorTabs.openFilePaths.length > 0
              ? { openFilePaths: editorTabs.openFilePaths }
              : {}),
            dirtyRelativePaths: collectDirtyRelativePaths(workspace?.worktreeId)
          }
        )
        set((curr) => {
          if (curr.workspaceKey && curr.workspaceKey !== conversation.workspaceKey) {
            return curr
          }
          const currentActive = curr.activeConversation
          const hasOnlyOptimisticDiff =
            currentActive?.id === conversation.id &&
            currentActive.messages.some((m) => m.id === optimisticId) &&
            !currentActive.messages.some((m) => m.streaming)
          const keepNewerStream =
            !hasOnlyOptimisticDiff &&
            currentActive?.id === conversation.id &&
            (currentActive.updatedAt > conversation.updatedAt ||
              currentActive.messages.some((m) => m.streaming))
          return {
            conversations: updateSummaryFromConversation(curr.conversations, conversation),
            activeConversation: keepNewerStream
              ? mergeIncomingConversation(currentActive, conversation)
              : currentActive?.id === conversation.id || currentActive === null
                ? conversation
                : currentActive
          }
        })
      } catch (error) {
        set((curr) => ({
          ...(params.fromQueue
            ? {}
            : {
                draftsByConversation: {
                  ...curr.draftsByConversation,
                  [params.conversationId]:
                    curr.draftsByConversation[params.conversationId] || prevDraft
                },
                attachmentsByConversation: {
                  ...curr.attachmentsByConversation,
                  [params.conversationId]:
                    (curr.attachmentsByConversation[params.conversationId]?.length ?? 0) > 0
                      ? curr.attachmentsByConversation[params.conversationId]
                      : attachments
                }
              }),
          activeConversation: withoutOptimisticUserPrompt(
            curr.activeConversation,
            params.conversationId,
            optimisticId
          ),
          lastError: toIdeStoreError(error)
        }))
      }
    },

    decidePlan: async (params: {
      conversationId: string
      planId: string
      decision: 'approve' | 'reject' | 'revise'
      revisionNote?: string
      agentId?: string
      modelId?: string
    }): Promise<boolean> => {
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
        return true
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
        return false
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
        set({ lastError: toIdeStoreError(error) })
      }
    },

    controlRun: async (params: {
      conversationId: string
      runId?: string
      action: 'pause' | 'resume' | 'stop' | 'retry'
    }) => {
      const workspace = resolveActiveIdeWorkspace()
      try {
        const { conversation } = await callRuntimeRpc<{ conversation: IdeConversation }>(
          { kind: 'local' },
          'ideAgent.runControl',
          {
            conversationId: params.conversationId,
            ...(params.runId ? { runId: params.runId } : {}),
            action: params.action,
            ...(workspace ? { worktreeSelector: workspace.worktreeSelector } : {}),
            dirtyRelativePaths: collectDirtyRelativePaths(workspace?.worktreeId)
          }
        )
        applyConversationUpdate(set, conversation)
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
      }
    },

    decideChange: async (params: {
      conversationId: string
      action: 'accept' | 'reject' | 'restore_checkpoint'
      changeId?: string
      checkpointId?: string
    }): Promise<boolean> => {
      const workspace = resolveActiveIdeWorkspace()
      const prevChanges = get().activeConversation?.fileChanges ?? []
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
        reconcileIdeChangeDecisionEffects(params.action, prevChanges, conversation)
        return true
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
        return false
      }
    },

    runCommand: async (params: {
      conversationId: string
      worktreeSelector: string
      command: string
      category?: IdeCommandCategory
      permissionApproved?: boolean
    }): Promise<{ ok: boolean; needsPermission?: IdePermissionRequest }> => {
      try {
        const res = await callRuntimeRpc<{
          conversation: IdeConversation
          needsPermission?: IdePermissionRequest
        }>({ kind: 'local' }, 'ideAgent.runCommand', params)
        applyConversationUpdate(set, res.conversation)
        return { ok: true, needsPermission: res.needsPermission }
      } catch (error) {
        set({ lastError: toIdeStoreError(error) })
        return { ok: false }
      }
    }
  }
}

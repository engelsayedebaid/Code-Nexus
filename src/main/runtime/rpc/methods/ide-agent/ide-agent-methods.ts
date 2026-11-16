import {
  IdeAgentChangeDecisionParams,
  IdeAgentCreateConversationParams,
  IdeAgentDeleteConversationParams,
  IdeAgentEmptyParams,
  IdeAgentGetConversationParams,
  IdeAgentListConversationsParams,
  IdeAgentPermissionDecisionParams,
  IdeAgentPlanDecisionParams,
  IdeAgentProvidersParams,
  IdeAgentReadAttachmentContentParams,
  IdeAgentRunCommandParams,
  IdeAgentRunControlParams,
  IdeAgentSavePastedAttachmentParams,
  IdeAgentSendPromptParams,
  IdeAgentSubscribeEventsParams,
  IdeAgentTodosListParams,
  IdeAgentTodosSaveParams,
  IdeAgentUpdateConversationParams
} from '../../../../../shared/ide-agent/ide-agent-contract'
import { getIdeAgentEngine } from '../../../../ide-agent/ide-agent-runtime-service'
import { resolveIdeAgentScratchWorkspace } from '../../../../ide-agent/ide-agent-scratch-workspace'
import { defineMethod, defineStreamingMethod } from '../../core'

export const IDE_AGENT_METHODS = [
  defineMethod({
    name: 'ideAgent.listProviders',
    permission: 'workspace',
    params: IdeAgentProvidersParams,
    handler: async (params, ctx) => ({
      agents: await getIdeAgentEngine(ctx.runtime).listProviders(params.worktreeSelector)
    })
  }),
  defineMethod({
    name: 'ideAgent.listConversations',
    permission: 'workspace',
    params: IdeAgentListConversationsParams,
    handler: async (params, ctx) => ({
      conversations: getIdeAgentEngine(ctx.runtime).listConversations(params.workspaceKey)
    })
  }),
  defineMethod({
    name: 'ideAgent.getConversation',
    permission: 'workspace',
    params: IdeAgentGetConversationParams,
    handler: async (params, ctx) => ({
      conversation: getIdeAgentEngine(ctx.runtime).getConversation(params.conversationId)
    })
  }),
  defineMethod({
    name: 'ideAgent.createConversation',
    permission: 'workspace',
    params: IdeAgentCreateConversationParams,
    handler: async (params, ctx) => ({
      conversation: getIdeAgentEngine(ctx.runtime).createConversation(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.updateConversationSettings',
    permission: 'workspace',
    params: IdeAgentUpdateConversationParams,
    handler: async (params, ctx) => ({
      conversation: getIdeAgentEngine(ctx.runtime).updateConversationSettings(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.deleteConversation',
    permission: 'workspace',
    params: IdeAgentDeleteConversationParams,
    handler: async (params, ctx) => {
      getIdeAgentEngine(ctx.runtime).deleteConversation(params.conversationId)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'ideAgent.sendPrompt',
    permission: 'workspace',
    params: IdeAgentSendPromptParams,
    handler: async (params, ctx) => ({
      conversation: await getIdeAgentEngine(ctx.runtime).sendPrompt(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.planDecision',
    permission: 'workspace',
    params: IdeAgentPlanDecisionParams,
    handler: async (params, ctx) => ({
      conversation: await getIdeAgentEngine(ctx.runtime).handlePlanDecision(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.permissionDecision',
    permission: 'workspace',
    params: IdeAgentPermissionDecisionParams,
    handler: async (params, ctx) => ({
      conversation: getIdeAgentEngine(ctx.runtime).handlePermissionDecision(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.runControl',
    permission: 'workspace',
    params: IdeAgentRunControlParams,
    handler: async (params, ctx) => ({
      conversation: await getIdeAgentEngine(ctx.runtime).handleRunControl(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.changeDecision',
    permission: 'workspace',
    params: IdeAgentChangeDecisionParams,
    handler: async (params, ctx) => ({
      conversation: await getIdeAgentEngine(ctx.runtime).handleChangeDecision(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.runCommand',
    permission: 'workspace',
    params: IdeAgentRunCommandParams,
    handler: async (params, ctx) => getIdeAgentEngine(ctx.runtime).runManualCommand(params)
  }),
  defineMethod({
    name: 'ideAgent.scratchWorkspace',
    permission: 'workspace',
    params: IdeAgentEmptyParams,
    handler: async () => ({ workspace: await resolveIdeAgentScratchWorkspace() })
  }),
  defineMethod({
    name: 'ideAgent.todosList',
    permission: 'workspace',
    params: IdeAgentTodosListParams,
    handler: async (params, ctx) => ({
      items: getIdeAgentEngine(ctx.runtime).listTodos(params.workspaceKey)
    })
  }),
  defineMethod({
    name: 'ideAgent.todosSave',
    permission: 'workspace',
    params: IdeAgentTodosSaveParams,
    handler: async (params, ctx) => ({
      items: getIdeAgentEngine(ctx.runtime).saveTodos(params.workspaceKey, params.items)
    })
  }),
  defineMethod({
    name: 'ideAgent.savePastedAttachment',
    permission: 'workspace',
    params: IdeAgentSavePastedAttachmentParams,
    handler: async (params, ctx) => ({
      attachment: await getIdeAgentEngine(ctx.runtime).savePastedAttachment(params)
    })
  }),
  defineMethod({
    name: 'ideAgent.readAttachmentContent',
    permission: 'workspace',
    params: IdeAgentReadAttachmentContentParams,
    handler: async (params, ctx) => getIdeAgentEngine(ctx.runtime).readAttachmentContent(params)
  }),
  defineStreamingMethod({
    name: 'ideAgent.subscribeEvents',
    permission: 'workspace',
    params: IdeAgentSubscribeEventsParams,
    handler: async (params, ctx, emit) => {
      const engine = getIdeAgentEngine(ctx.runtime)
      await new Promise<void>((resolve) => {
        const unsubscribe = engine.subscribe((event) => {
          emit(event)
        }, params.conversationId)
        const finish = (): void => {
          unsubscribe()
          resolve()
        }
        if (ctx.signal?.aborted) {
          finish()
          return
        }
        ctx.signal?.addEventListener('abort', finish, { once: true })
      })
    }
  })
]

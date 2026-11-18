import type {
  IdeAgentStreamEvent,
  IdeConversation,
  IdeConversationSummary,
  IdeProviderAgentOption,
  IdeTodoItem
} from '../../shared/ide-agent/ide-agent-types'
import { applyChangeDecision } from './ide-agent-change-control'
import { IdeEngineConversationState } from './ide-agent-engine-state'
import { processPlanDecision } from './ide-agent-plan-decisions'
import { dispatchIdePrompt } from './ide-agent-prompt-dispatch'
import {
  executeManualWorkspaceCommand,
  processRunControlAction,
  resolvePermissionDecision
} from './ide-agent-run-controls'
import {
  pickExecutionSettings,
  type IdeChangeDecisionInput,
  type IdeCreateConversationInput,
  type IdeManualCommandInput,
  type IdeManualCommandResult,
  type IdePermissionDecisionInput,
  type IdePlanDecisionInput,
  type IdeRunControlInput,
  type IdeSendPromptInput,
  type IdeUpdateSettingsInput,
  type ResolveWorkspaceGateway
} from './ide-agent-runtime-types'
import {
  applyConversationSettingsUpdate,
  buildNewIdeConversation,
  recordKnownProviderModels,
  registerNewRunControl,
  resolveConversationSelectionUpdate
} from './ide-agent-selection'
import type { IdeAiClient } from './ide-ai-client'
import type { IdeAgentStore } from './ide-agent-persistence'
import {
  requireEngineAttachmentStore,
  resolveEngineAttachmentStore,
  type IdeAttachmentContentPage,
  type IdeAttachmentStore
} from './ide-attachment-store'

export type { ResolveWorkspaceGateway } from './ide-agent-runtime-types'

export class IdeAgentEngine {
  private readonly state: IdeEngineConversationState

  constructor(
    private readonly deps: {
      store: IdeAgentStore
      attachmentStore?: IdeAttachmentStore | null
      aiClient: IdeAiClient
      resolveGateway: ResolveWorkspaceGateway
      defaultAgentId?: string
      chunkDelayMs?: number
    }
  ) {
    const attachmentStore = resolveEngineAttachmentStore(
      deps.store.attachmentsRootDir,
      deps.attachmentStore
    )
    this.state = new IdeEngineConversationState(
      deps.store,
      attachmentStore,
      deps.aiClient,
      deps.chunkDelayMs
    )
  }

  subscribe(listener: (event: IdeAgentStreamEvent) => void, conversationId?: string): () => void {
    return this.state.subscribe(listener, conversationId)
  }

  async listProviders(worktreeSelector?: string): Promise<IdeProviderAgentOption[]> {
    const providers = await this.deps.aiClient.listProviders(worktreeSelector)
    recordKnownProviderModels(this.state.knownProviderModels, providers)
    return providers
  }

  listConversations(workspaceKey: string): IdeConversationSummary[] {
    return this.deps.store.listConversationSummaries(workspaceKey)
  }

  getConversation(conversationId: string): IdeConversation | null {
    return this.state.getConversation(conversationId)
  }

  createConversation(params: IdeCreateConversationInput): IdeConversation {
    const created = buildNewIdeConversation({
      knownProviderModels: this.state.knownProviderModels,
      defaultAgentId: this.deps.defaultAgentId,
      ...params
    })
    this.state.deletedConversations.delete(created.id)
    return structuredClone(this.state.saveAndPublish(created))
  }

  updateConversationSettings(params: IdeUpdateSettingsInput): IdeConversation {
    const conv = applyConversationSettingsUpdate(
      this.state.requireConversation(params.conversationId),
      this.state.knownProviderModels,
      params
    )
    return structuredClone(this.state.saveAndPublish(conv, pickExecutionSettings(conv)))
  }

  deleteConversation(conversationId: string): void {
    this.state.deleteConversation(conversationId)
  }

  async savePastedAttachment(params: Parameters<IdeAttachmentStore['savePastedText']>[0]) {
    this.state.requireConversation(params.conversationId)
    return requireEngineAttachmentStore(this.state.attachmentStore).savePastedText(params)
  }

  async readAttachmentContent(
    params: Parameters<IdeAttachmentStore['readRange']>[0]
  ): Promise<IdeAttachmentContentPage> {
    this.state.requireConversation(params.conversationId)
    return requireEngineAttachmentStore(this.state.attachmentStore).readRange(params)
  }

  listTodos(workspaceKey: string): IdeTodoItem[] {
    return this.deps.store.listTodos(workspaceKey)
  }

  saveTodos(workspaceKey: string, items: IdeTodoItem[]): IdeTodoItem[] {
    this.deps.store.saveTodos(workspaceKey, items)
    return items
  }

  handlePermissionDecision(params: IdePermissionDecisionInput): IdeConversation {
    return resolvePermissionDecision(this.state.hostOps, this.state.activeRuns, params)
  }

  private buildRunDispatchContext(conversationId: string, dirtyRelativePaths?: string[]) {
    return {
      host: this.state.hostOps,
      activeRuns: this.state.activeRuns,
      resolveGateway: this.deps.resolveGateway,
      createRunControl: (c: IdeConversation, sel: string, dirty: Set<string>) =>
        registerNewRunControl(this.state.activeRuns, c, sel, dirty),
      resolveSelectionUpdate: (c: IdeConversation, u: { agentId?: string; modelId?: string }) =>
        resolveConversationSelectionUpdate(this.state.knownProviderModels, c, u),
      dirtySet: this.state.updateDirtySet(conversationId, dirtyRelativePaths)
    }
  }

  sendPrompt(params: IdeSendPromptInput): Promise<IdeConversation> {
    return dispatchIdePrompt({
      ...this.buildRunDispatchContext(params.conversationId, params.dirtyRelativePaths),
      ...params
    })
  }

  handlePlanDecision(params: IdePlanDecisionInput): Promise<IdeConversation> {
    return processPlanDecision({
      ...this.buildRunDispatchContext(params.conversationId, params.dirtyRelativePaths),
      ...params
    })
  }

  runManualCommand(params: IdeManualCommandInput): Promise<IdeManualCommandResult> {
    return executeManualWorkspaceCommand({
      host: this.state.hostOps,
      resolveGateway: this.deps.resolveGateway,
      dirtyFilesByConversation: this.state.dirtyFilesByConversation,
      ...params
    })
  }

  handleRunControl(params: IdeRunControlInput): Promise<IdeConversation> | IdeConversation {
    if (params.dirtyRelativePaths) {
      this.state.updateDirtySet(params.conversationId, params.dirtyRelativePaths)
    }
    return processRunControlAction({
      host: this.state.hostOps,
      activeRuns: this.state.activeRuns,
      ...params,
      onApproveRetry: (planId) =>
        this.handlePlanDecision({
          conversationId: params.conversationId,
          planId,
          decision: 'approve',
          worktreeSelector: params.worktreeSelector,
          dirtyRelativePaths: params.dirtyRelativePaths
        }),
      onResendPrompt: (text, mode, attachments) =>
        this.sendPrompt({
          conversationId: params.conversationId,
          worktreeSelector:
            params.worktreeSelector ??
            this.state.requireConversation(params.conversationId).workspacePath,
          text,
          mode,
          attachments,
          dirtyRelativePaths: params.dirtyRelativePaths,
          reuseLastUserMessage: true
        })
    })
  }

  handleChangeDecision(params: IdeChangeDecisionInput): Promise<IdeConversation> {
    if (params.dirtyRelativePaths) {
      this.state.updateDirtySet(params.conversationId, params.dirtyRelativePaths)
    }
    return applyChangeDecision({
      host: this.state.hostOps,
      activeRuns: this.state.activeRuns,
      resolveGateway: this.deps.resolveGateway,
      dirtyFilesByConversation: this.state.dirtyFilesByConversation,
      ...params
    })
  }
}

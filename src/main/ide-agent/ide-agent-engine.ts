import { EventEmitter } from 'node:events'
import type {
  IdeActivityEvent,
  IdeAgentStreamEvent,
  IdeConversation,
  IdeConversationSummary,
  IdeProviderAgentOption,
  IdeRunStatus,
  IdeTodoItem
} from '../../shared/ide-agent/ide-agent-types'
import { applyChangeDecision } from './ide-agent-change-control'
import { processPlanDecision } from './ide-agent-plan-decisions'
import {
  executeManualWorkspaceCommand,
  processRunControlAction,
  requestExplicitRunPermission,
  resolvePermissionDecision
} from './ide-agent-run-controls'
import { dispatchIdePrompt } from './ide-agent-run-lifecycle'
import {
  pickExecutionSettings,
  waitUntilRunResumedOrAborted,
  type ActiveRunControl,
  type ConversationExecutionSettings,
  type EngineHostOps,
  type IdeAppendActivityInput,
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
  pushBoundedActivityEvent,
  recordKnownProviderModels,
  registerNewRunControl,
  resolveConversationSelectionUpdate,
  updateDirtyPathsMap
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
  private readonly emitter = new EventEmitter()
  private readonly activeRuns = new Map<string, ActiveRunControl>()
  private readonly dirtyFilesByConversation = new Map<string, Set<string>>()
  private readonly knownProviderModels = new Map<string, Set<string>>()
  private readonly executionSettingsCache = new Map<string, ConversationExecutionSettings>()
  private readonly attachmentStore: IdeAttachmentStore | null
  private eventSeq = 0

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
    this.attachmentStore = resolveEngineAttachmentStore(
      deps.store.attachmentsRootDir,
      deps.attachmentStore
    )
    this.emitter.setMaxListeners(100)
  }

  private get hostOps(): EngineHostOps {
    return {
      store: this.deps.store,
      attachmentStore: this.attachmentStore,
      aiClient: this.deps.aiClient,
      chunkDelayMs: this.deps.chunkDelayMs,
      emit: (e) => this.emitter.emit('event', e),
      saveAndPublish: (c, s) => this.saveAndPublish(c, s),
      requireConversation: (id) => this.requireConversation(id),
      setRunStatus: (c, r, s, d) => this.setRunStatus(c, r, s, d),
      appendActivity: (c, p) => this.appendActivity(c, p),
      requestExplicitPermission: (c, r, p) => requestExplicitRunPermission(this.hostOps, c, r, p),
      waitIfPausedOrAborted: (c, r) =>
        waitUntilRunResumedOrAborted(c, r, (conv, id) => this.setRunStatus(conv, id, 'paused'))
    }
  }

  subscribe(listener: (event: IdeAgentStreamEvent) => void, conversationId?: string): () => void {
    const handler = (event: IdeAgentStreamEvent): void => {
      if (conversationId && 'conversationId' in event && event.conversationId !== conversationId) {
        return
      }
      listener(event)
    }
    this.emitter.on('event', handler)
    return () => {
      this.emitter.off('event', handler)
    }
  }

  private saveAndPublish(
    conv: IdeConversation,
    settings?: ConversationExecutionSettings
  ): IdeConversation {
    conv.updatedAt = Date.now()
    let effective = settings ?? this.executionSettingsCache.get(conv.id)
    if (!effective) {
      const persisted = this.deps.store.getConversation(conv.id)
      effective = persisted ? pickExecutionSettings(persisted) : pickExecutionSettings(conv)
    }
    this.executionSettingsCache.set(conv.id, { ...effective })
    Object.assign(conv, effective)
    this.deps.store.saveConversation(conv)
    this.emitter.emit('event', {
      type: 'conversation_updated',
      conversation: structuredClone(conv)
    })
    return conv
  }

  private requireConversation(conversationId: string): IdeConversation {
    const existing = this.deps.store.getConversation(conversationId)
    if (!existing) {
      throw new Error(`Conversation "${conversationId}" not found.`)
    }
    return existing
  }

  private setRunStatus(
    conv: IdeConversation,
    runId: string | null,
    status: IdeRunStatus,
    detail?: string
  ): void {
    if (runId === null) {
      // Release the active-run lock before publishing terminal/awaiting status so immediate approve/retry callers cannot race `finally`.
      this.activeRuns.delete(conv.id)
    }
    conv.status = status
    conv.activeRunId = runId
    this.saveAndPublish(conv)
    this.emitter.emit('event', {
      type: 'run_status',
      conversationId: conv.id,
      runId,
      status,
      detail
    })
  }

  private appendActivity(conv: IdeConversation, params: IdeAppendActivityInput): IdeActivityEvent {
    this.eventSeq += 1
    const event = pushBoundedActivityEvent(conv, this.eventSeq, params)
    this.saveAndPublish(conv)
    this.emitter.emit('event', { type: 'activity', conversationId: conv.id, event })
    return event
  }

  private updateDirtySet(conversationId: string, dirtyPaths?: readonly string[]): Set<string> {
    return updateDirtyPathsMap(
      this.dirtyFilesByConversation,
      this.activeRuns,
      conversationId,
      dirtyPaths
    )
  }

  async listProviders(worktreeSelector?: string): Promise<IdeProviderAgentOption[]> {
    const providers = await this.deps.aiClient.listProviders(worktreeSelector)
    recordKnownProviderModels(this.knownProviderModels, providers)
    return providers
  }

  listConversations(workspaceKey: string): IdeConversationSummary[] {
    return this.deps.store.listConversationSummaries(workspaceKey)
  }

  getConversation(conversationId: string): IdeConversation | null {
    return this.deps.store.getConversation(conversationId)
  }

  createConversation(params: IdeCreateConversationInput): IdeConversation {
    return this.saveAndPublish(
      buildNewIdeConversation({
        knownProviderModels: this.knownProviderModels,
        defaultAgentId: this.deps.defaultAgentId,
        ...params
      })
    )
  }

  updateConversationSettings(params: IdeUpdateSettingsInput): IdeConversation {
    const conv = applyConversationSettingsUpdate(
      this.requireConversation(params.conversationId),
      this.knownProviderModels,
      params
    )
    return this.saveAndPublish(conv, pickExecutionSettings(conv))
  }

  deleteConversation(conversationId: string): void {
    const active = this.activeRuns.get(conversationId)
    if (active) {
      active.abortController.abort()
      this.activeRuns.delete(conversationId)
    }
    this.executionSettingsCache.delete(conversationId)
    this.deps.store.deleteConversation(conversationId)
    void this.attachmentStore?.deleteConversationAttachments(conversationId).catch(() => {})
  }

  async savePastedAttachment(params: Parameters<IdeAttachmentStore['savePastedText']>[0]) {
    this.requireConversation(params.conversationId)
    return requireEngineAttachmentStore(this.attachmentStore).savePastedText(params)
  }

  async readAttachmentContent(
    params: Parameters<IdeAttachmentStore['readRange']>[0]
  ): Promise<IdeAttachmentContentPage> {
    this.requireConversation(params.conversationId)
    return requireEngineAttachmentStore(this.attachmentStore).readRange(params)
  }

  listTodos(workspaceKey: string): IdeTodoItem[] {
    return this.deps.store.listTodos(workspaceKey)
  }
  saveTodos(workspaceKey: string, items: IdeTodoItem[]): IdeTodoItem[] {
    this.deps.store.saveTodos(workspaceKey, items)
    return items
  }

  handlePermissionDecision(params: IdePermissionDecisionInput): IdeConversation {
    return resolvePermissionDecision(this.hostOps, this.activeRuns, params)
  }

  private buildRunDispatchContext(conversationId: string, dirtyRelativePaths?: string[]) {
    return {
      host: this.hostOps,
      activeRuns: this.activeRuns,
      resolveGateway: this.deps.resolveGateway,
      createRunControl: (c: IdeConversation, sel: string, dirty: Set<string>) =>
        registerNewRunControl(this.activeRuns, c, sel, dirty),
      resolveSelectionUpdate: (c: IdeConversation, u: { agentId?: string; modelId?: string }) =>
        resolveConversationSelectionUpdate(this.knownProviderModels, c, u),
      dirtySet: this.updateDirtySet(conversationId, dirtyRelativePaths)
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
      host: this.hostOps,
      resolveGateway: this.deps.resolveGateway,
      dirtyFilesByConversation: this.dirtyFilesByConversation,
      ...params
    })
  }

  handleRunControl(params: IdeRunControlInput): Promise<IdeConversation> | IdeConversation {
    if (params.dirtyRelativePaths) {
      this.updateDirtySet(params.conversationId, params.dirtyRelativePaths)
    }
    return processRunControlAction({
      host: this.hostOps,
      activeRuns: this.activeRuns,
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
            this.requireConversation(params.conversationId).workspacePath,
          text,
          mode,
          attachments,
          dirtyRelativePaths: params.dirtyRelativePaths
        })
    })
  }

  handleChangeDecision(params: IdeChangeDecisionInput): Promise<IdeConversation> {
    if (params.dirtyRelativePaths) {
      this.updateDirtySet(params.conversationId, params.dirtyRelativePaths)
    }
    return applyChangeDecision({
      host: this.hostOps,
      resolveGateway: this.deps.resolveGateway,
      dirtyFilesByConversation: this.dirtyFilesByConversation,
      ...params
    })
  }
}

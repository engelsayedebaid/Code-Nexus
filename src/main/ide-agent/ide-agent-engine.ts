import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  classifySensitiveCommand,
  classifySensitiveFilePath,
  computeIdePlanHash,
  isModeWriteAllowed,
  isPlanApprovedForExecution,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import { buildProgressiveEditChunks } from '../../shared/ide-agent/ide-patch-chunker'
import type {
  IdeActivityEvent,
  IdeActivityEventType,
  IdeAgentRole,
  IdeAgentStreamEvent,
  IdeChatAttachment,
  IdeChatMessage,
  IdeCheckpoint,
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode,
  IdeFileChangeRecord,
  IdeLiveEditSpeed,
  IdePermissionRequest,
  IdePlanFileAction,
  IdePlanStep,
  IdeProviderAgentOption,
  IdeRunStatus,
  IdeSensitiveActionKind,
  IdeTaskPlan,
  IdeTodoItem
} from '../../shared/ide-agent/ide-agent-types'
import { hasArabicText } from '../../shared/ide-agent/ide-language'
import {
  buildAskPrompt,
  buildExecutionStepPrompt,
  buildPlanPrompt,
  buildRepairFailurePrompt,
  buildReviewPrompt,
  buildRevisePlanPrompt,
  formatPlanIntroMarkdown,
  isClarificationOrQuestionPrompt,
  parsePlanJsonFromAiOutput,
  parsePlanOrAnswerFromAiOutput,
  parseStepOperationsFromAiOutput,
  type RawStepExecutionOperation
} from './ide-agent-prompts'
import type { IdeAiClient } from './ide-ai-client'
import type { IdeAgentStore } from './ide-agent-persistence'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import {
  getCommitMessageAgentSpec,
  getCommitMessageModel
} from '../../shared/source-control/ai/generation/commit-message-agent-spec'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'

export type ResolveWorkspaceGateway = (worktreeSelector: string) => Promise<IdeWorkspaceGateway>

type ConversationExecutionSettings = Pick<
  IdeConversation,
  'title' | 'mode' | 'agentId' | 'modelId' | 'multiAgentEnabled' | 'followAgent' | 'liveEditSpeed'
>

type RunExecutionConfig = {
  mode: IdeExecutionMode
  agentId: string
  modelId: string
  multiAgentEnabled: boolean
  liveEditSpeed?: IdeLiveEditSpeed
}

function pickExecutionSettings(conv: IdeConversation): ConversationExecutionSettings {
  return {
    title: conv.title,
    mode: conv.mode,
    agentId: conv.agentId,
    modelId: conv.modelId,
    multiAgentEnabled: conv.multiAgentEnabled,
    followAgent: conv.followAgent,
    liveEditSpeed: conv.liveEditSpeed
  }
}

type ActiveRunControl = {
  runId: string
  conversationId: string
  abortController: AbortController
  paused: boolean
  resumeResolvers: Array<() => void>
  permissionWaiters: Map<string, (approved: boolean) => void>
  worktreeSelector: string
  dirtyPaths: Set<string>
  config: RunExecutionConfig
}

export class IdeAgentEngine {
  private readonly emitter = new EventEmitter()
  private readonly activeRuns = new Map<string, ActiveRunControl>()
  private readonly dirtyFilesByConversation = new Map<string, Set<string>>()
  private readonly knownProviderModels = new Map<string, Set<string>>()
  private readonly executionSettingsCache = new Map<string, ConversationExecutionSettings>()
  private eventSeq = 0

  constructor(
    private readonly deps: {
      store: IdeAgentStore
      aiClient: IdeAiClient
      resolveGateway: ResolveWorkspaceGateway
      defaultAgentId?: string
      chunkDelayMs?: number
    }
  ) {
    this.emitter.setMaxListeners(100)
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

  private emit(event: IdeAgentStreamEvent): void {
    this.emitter.emit('event', event)
  }

  private nextSeq(): number {
    this.eventSeq += 1
    return this.eventSeq
  }

  private saveAndPublish(
    conversation: IdeConversation,
    settings?: ConversationExecutionSettings
  ): IdeConversation {
    conversation.updatedAt = Date.now()
    // Long-running executions hold a snapshot of the conversation; without this merge every
    // activity/status publish would rewrite stale mode/agent/model settings over newer user selections.
    let effective = settings ?? this.executionSettingsCache.get(conversation.id)
    if (!effective) {
      const persisted = this.deps.store.getConversation(conversation.id)
      effective = persisted ? pickExecutionSettings(persisted) : pickExecutionSettings(conversation)
    }
    this.executionSettingsCache.set(conversation.id, { ...effective })
    conversation.title = effective.title
    conversation.mode = effective.mode
    conversation.agentId = effective.agentId
    conversation.modelId = effective.modelId
    conversation.multiAgentEnabled = effective.multiAgentEnabled
    conversation.followAgent = effective.followAgent
    this.deps.store.saveConversation(conversation)
    this.emit({ type: 'conversation_updated', conversation: structuredClone(conversation) })
    return conversation
  }

  private requireConversation(conversationId: string): IdeConversation {
    const existing = this.deps.store.getConversation(conversationId)
    if (!existing) {
      throw new Error(`Conversation "${conversationId}" not found.`)
    }
    return existing
  }

  private setRunStatus(
    conversation: IdeConversation,
    runId: string | null,
    status: IdeRunStatus,
    detail?: string
  ): void {
    conversation.status = status
    conversation.activeRunId = runId
    this.saveAndPublish(conversation)
    this.emit({ type: 'run_status', conversationId: conversation.id, runId, status, detail })
  }

  private appendActivity(
    conversation: IdeConversation,
    params: {
      runId: string
      role: IdeAgentRole
      type: IdeActivityEventType
      summary: string
      detail?: string
      relativePath?: string
      command?: string
      status?: IdeActivityEvent['status']
      expandablePayload?: Record<string, unknown>
    }
  ): IdeActivityEvent {
    const event: IdeActivityEvent = {
      id: randomUUID(),
      seq: this.nextSeq(),
      conversationId: conversation.id,
      runId: params.runId,
      timestamp: Date.now(),
      role: params.role,
      type: params.type,
      summary: params.summary,
      status: params.status ?? 'info',
      ...(params.detail ? { detail: params.detail } : {}),
      ...(params.relativePath ? { relativePath: params.relativePath } : {}),
      ...(params.command ? { command: params.command } : {}),
      ...(params.expandablePayload ? { expandablePayload: params.expandablePayload } : {})
    }
    conversation.activity.push(event)
    if (conversation.activity.length > 400) {
      conversation.activity = conversation.activity.slice(-400)
    }
    this.saveAndPublish(conversation)
    this.emit({ type: 'activity', conversationId: conversation.id, event })
    return event
  }

  private updateDirtySet(conversationId: string, dirtyPaths?: readonly string[]): Set<string> {
    const next = new Set(
      (dirtyPaths ?? []).map((item) => normalizeWorkspaceRelativePath(item).toLowerCase())
    )
    this.dirtyFilesByConversation.set(conversationId, next)
    const run = this.activeRuns.get(conversationId)
    if (run) {
      run.dirtyPaths = next
    }
    return next
  }

  async listProviders(worktreeSelector?: string): Promise<IdeProviderAgentOption[]> {
    const providers = await this.deps.aiClient.listProviders(worktreeSelector)
    for (const provider of providers) {
      this.knownProviderModels.set(
        provider.id,
        new Set([provider.defaultModelId, ...provider.models.map((m) => m.id)])
      )
    }
    return providers
  }

  listConversations(workspaceKey: string): IdeConversationSummary[] {
    return this.deps.store.listConversationSummaries(workspaceKey)
  }

  getConversation(conversationId: string): IdeConversation | null {
    return this.deps.store.getConversation(conversationId)
  }

  createConversation(params: {
    workspaceKey: string
    workspacePath: string
    title?: string
    mode?: IdeExecutionMode
    agentId?: string
    modelId?: string
    multiAgentEnabled?: boolean
    followAgent?: boolean
    liveEditSpeed?: IdeLiveEditSpeed
  }): IdeConversation {
    const requestedAgentId = params.agentId ?? this.deps.defaultAgentId ?? 'claude'
    // A conversation must always hold an executable provider; agents without a generation
    // spec (e.g. gemini) fall back so workspace init cannot brick the chat surface.
    const agentId = this.isExecutableAgent(requestedAgentId)
      ? requestedAgentId
      : this.isExecutableAgent(this.deps.defaultAgentId ?? '')
        ? (this.deps.defaultAgentId as string)
        : 'claude'
    const selection = this.resolveExecutionSelection(
      agentId,
      agentId === requestedAgentId ? params.modelId : undefined
    )
    const now = Date.now()
    const conversation: IdeConversation = {
      id: randomUUID(),
      workspaceKey: params.workspaceKey,
      workspacePath: params.workspacePath,
      title: params.title?.trim() || 'New IDE Chat',
      mode: params.mode ?? 'agent',
      agentId: selection.agentId,
      modelId: selection.modelId,
      multiAgentEnabled: params.multiAgentEnabled ?? false,
      followAgent: params.followAgent ?? true,
      liveEditSpeed: params.liveEditSpeed ?? 'natural',
      activePlanId: null,
      activeRunId: null,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      messages: [],
      plans: [],
      activity: [],
      fileChanges: [],
      checkpoints: [],
      commandExecutions: [],
      pendingPermissions: []
    }
    return this.saveAndPublish(conversation)
  }

  private isExecutableAgent(agentId: string | undefined): boolean {
    return Boolean(agentId && isTuiAgent(agentId) && getCommitMessageAgentSpec(agentId))
  }

  private resolveExecutionSelection(
    agentId: string,
    modelId?: string
  ): { agentId: string; modelId: string } {
    if (!isTuiAgent(agentId)) {
      throw new Error(`Provider "${agentId}" does not support IDE chat execution.`)
    }
    const spec = getCommitMessageAgentSpec(agentId)
    if (!spec) {
      throw new Error(`Provider "${agentId}" cannot generate text for IDE chat.`)
    }
    const resolvedModelId = modelId?.trim() || spec.defaultModelId
    if (spec.modelSource === 'static' && !getCommitMessageModel(agentId, resolvedModelId)) {
      throw new Error(`Model "${resolvedModelId}" is not available for ${spec.label}.`)
    }
    const known = this.knownProviderModels.get(agentId)
    if (
      known &&
      resolvedModelId !== 'default' &&
      resolvedModelId !== spec.defaultModelId &&
      !known.has(resolvedModelId)
    ) {
      throw new Error(
        `Model "${resolvedModelId}" is not available for ${spec.label}. Refresh AI models or choose another.`
      )
    }
    return { agentId, modelId: resolvedModelId }
  }

  private resolveSelectionUpdate(
    conv: IdeConversation,
    update: { agentId?: string; modelId?: string }
  ): { agentId: string; modelId: string } {
    const agentId = update.agentId ?? conv.agentId
    // Switching providers without an explicit model resets to that provider's default;
    // carrying e.g. a Claude alias into Codex/OMP would produce an invalid --model flag.
    const modelId =
      update.modelId ??
      (update.agentId !== undefined && update.agentId !== conv.agentId ? undefined : conv.modelId)
    return this.resolveExecutionSelection(agentId, modelId)
  }

  updateConversationSettings(params: {
    conversationId: string
    title?: string
    mode?: IdeExecutionMode
    agentId?: string
    modelId?: string
    multiAgentEnabled?: boolean
    followAgent?: boolean
    liveEditSpeed?: IdeLiveEditSpeed
  }): IdeConversation {
    const conv = this.requireConversation(params.conversationId)
    if (params.title !== undefined) conv.title = params.title.trim() || conv.title
    if (params.mode !== undefined) conv.mode = params.mode
    if (params.agentId !== undefined || params.modelId !== undefined) {
      const selection = this.resolveSelectionUpdate(conv, params)
      conv.agentId = selection.agentId
      conv.modelId = selection.modelId
    }
    if (params.multiAgentEnabled !== undefined) conv.multiAgentEnabled = params.multiAgentEnabled
    if (params.followAgent !== undefined) conv.followAgent = params.followAgent
    if (params.liveEditSpeed !== undefined) {
      conv.liveEditSpeed = params.liveEditSpeed
    }
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
  }

  listTodos(workspaceKey: string): IdeTodoItem[] {
    return this.deps.store.listTodos(workspaceKey)
  }

  saveTodos(workspaceKey: string, items: IdeTodoItem[]): IdeTodoItem[] {
    this.deps.store.saveTodos(workspaceKey, items)
    return items
  }

  private async requestExplicitPermission(
    conversation: IdeConversation,
    run: ActiveRunControl,
    params: {
      kind: IdeSensitiveActionKind
      title: string
      detail: string
      targetPath?: string
      command?: string
    }
  ): Promise<boolean> {
    const existingApproved = conversation.pendingPermissions.find(
      (p) =>
        p.runId === run.runId &&
        p.status === 'approved' &&
        p.kind === params.kind &&
        p.targetPath === params.targetPath &&
        p.command === params.command
    )
    if (existingApproved) {
      return true
    }

    const permission: IdePermissionRequest = {
      id: randomUUID(),
      conversationId: conversation.id,
      runId: run.runId,
      kind: params.kind,
      title: params.title,
      detail: params.detail,
      ...(params.targetPath ? { targetPath: params.targetPath } : {}),
      ...(params.command ? { command: params.command } : {}),
      status: 'pending',
      createdAt: Date.now()
    }
    conversation.pendingPermissions.push(permission)
    this.appendActivity(conversation, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'permission.requested',
      summary: params.title,
      detail: params.detail,
      relativePath: params.targetPath,
      command: params.command,
      status: 'warning'
    })
    this.setRunStatus(conversation, run.runId, 'awaiting_permission', params.title)
    this.emit({ type: 'permission_requested', conversationId: conversation.id, permission })

    return await new Promise<boolean>((resolveDecision) => {
      const onAbort = (): void => {
        run.permissionWaiters.delete(permission.id)
        resolveDecision(false)
      }
      if (run.abortController.signal.aborted) {
        onAbort()
        return
      }
      run.abortController.signal.addEventListener('abort', onAbort, { once: true })
      run.permissionWaiters.set(permission.id, (approved) => {
        run.abortController.signal.removeEventListener('abort', onAbort)
        resolveDecision(approved)
      })
    })
  }

  handlePermissionDecision(params: {
    conversationId: string
    permissionId: string
    decision: 'approve' | 'deny'
    note?: string
  }): IdeConversation {
    const conv = this.requireConversation(params.conversationId)
    const perm = conv.pendingPermissions.find((p) => p.id === params.permissionId)
    if (!perm) {
      throw new Error(`Permission request "${params.permissionId}" not found.`)
    }
    const approved = params.decision === 'approve'
    perm.status = approved ? 'approved' : 'denied'
    perm.resolvedAt = Date.now()
    if (params.note) {
      perm.note = params.note
    }
    this.appendActivity(conv, {
      runId: perm.runId,
      role: 'orchestrator',
      type: 'permission.resolved',
      summary: `${approved ? 'Approved' : 'Denied'}: ${perm.title}`,
      relativePath: perm.targetPath,
      command: perm.command,
      status: approved ? 'completed' : 'warning'
    })
    this.saveAndPublish(conv)
    const run = this.activeRuns.get(conv.id)
    const waiter = run?.permissionWaiters.get(perm.id)
    if (waiter) {
      run?.permissionWaiters.delete(perm.id)
      waiter(approved)
    }
    return conv
  }

  private async waitIfPausedOrAborted(
    conversation: IdeConversation,
    run: ActiveRunControl
  ): Promise<boolean> {
    if (run.abortController.signal.aborted) {
      return false
    }
    while (run.paused && !run.abortController.signal.aborted) {
      this.setRunStatus(conversation, run.runId, 'paused')
      await new Promise<void>((resolve) => {
        const finish = (): void => resolve()
        run.resumeResolvers.push(finish)
        run.abortController.signal.addEventListener('abort', finish, { once: true })
      })
    }
    return !run.abortController.signal.aborted
  }

  async sendPrompt(params: {
    conversationId: string
    worktreeSelector: string
    text: string
    mode: IdeExecutionMode
    agentId?: string
    modelId?: string
    multiAgentEnabled?: boolean
    followAgent?: boolean
    liveEditSpeed?: IdeLiveEditSpeed
    attachments?: IdeChatAttachment[]
    activeFilePath?: string
    dirtyRelativePaths?: string[]
  }): Promise<IdeConversation> {
    const conv = this.requireConversation(params.conversationId)
    if (this.activeRuns.has(conv.id)) {
      throw new Error('Another run is already active in this conversation. Stop or pause it first.')
    }

    const selection = this.resolveSelectionUpdate(conv, params)
    conv.mode = params.mode
    conv.agentId = selection.agentId
    conv.modelId = selection.modelId
    if (params.multiAgentEnabled !== undefined) conv.multiAgentEnabled = params.multiAgentEnabled
    if (params.followAgent !== undefined) conv.followAgent = params.followAgent
    if (params.liveEditSpeed !== undefined) {
      conv.liveEditSpeed = params.liveEditSpeed
    }
    if (conv.messages.length === 0 && conv.title === 'New IDE Chat') {
      conv.title = params.text.trim().replace(/\s+/g, ' ').slice(0, 64) || 'IDE Session'
    }

    const dirtySet = this.updateDirtySet(conv.id, params.dirtyRelativePaths)
    const rawAttachments = params.attachments ?? []
    const runId = randomUUID()

    const userMessage: IdeChatMessage = {
      id: randomUUID(),
      conversationId: conv.id,
      role: 'user',
      mode: conv.mode,
      text: params.text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: conv.agentId,
      modelId: conv.modelId,
      teamMode: conv.multiAgentEnabled,
      ...(rawAttachments.length > 0 ? { attachments: rawAttachments } : {})
    }
    conv.messages.push(userMessage)
    this.saveAndPublish(conv, pickExecutionSettings(conv))

    const gateway = await this.deps.resolveGateway(params.worktreeSelector)
    const runControl: ActiveRunControl = {
      runId,
      conversationId: conv.id,
      abortController: new AbortController(),
      paused: false,
      resumeResolvers: [],
      permissionWaiters: new Map(),
      worktreeSelector: params.worktreeSelector,
      dirtyPaths: dirtySet,
      config: {
        mode: conv.mode,
        agentId: conv.agentId,
        modelId: conv.modelId,
        multiAgentEnabled: conv.multiAgentEnabled,
        liveEditSpeed: conv.liveEditSpeed
      }
    }
    this.activeRuns.set(conv.id, runControl)

    void this.runPromptLifecycle(conv.id, runControl, gateway, params).catch((error) => {
      const latest = this.deps.store.getConversation(conv.id)
      if (!latest) return
      const errText = error instanceof Error ? error.message : String(error)
      this.appendActivity(latest, {
        runId,
        role: 'orchestrator',
        type: 'run.failed',
        summary: 'Run failed',
        detail: errText,
        status: 'error'
      })
      latest.messages.push({
        id: randomUUID(),
        conversationId: latest.id,
        role: 'assistant',
        mode: latest.mode,
        text: `Error: ${errText}`,
        error: errText,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runId,
        agentId: latest.agentId,
        modelId: latest.modelId
      })
      this.setRunStatus(latest, null, 'failed', errText)
    })

    return conv
  }

  private async filterAttachmentsForSecretSafety(
    conv: IdeConversation,
    run: ActiveRunControl,
    attachments: readonly IdeChatAttachment[]
  ): Promise<IdeChatAttachment[]> {
    const safe: IdeChatAttachment[] = []
    for (const att of attachments) {
      const targetPath = att.relativePath ?? att.name
      const isSecret =
        att.sensitiveWarning ||
        classifySensitiveFilePath(targetPath, 'read-context') === 'send_secret_context'
      if (!isSecret) {
        safe.push(att)
        continue
      }
      const allowed = await this.requestExplicitPermission(conv, run, {
        kind: 'send_secret_context',
        title: `Allow sending secret/credential context (${targetPath})?`,
        detail: `"${targetPath}" looks like a secrets/credentials file. Only include its contents in AI prompts if you trust the provider and approve.`,
        targetPath
      })
      if (allowed) {
        safe.push(att)
      } else {
        safe.push({
          ...att,
          previewText: '[REDACTED: user denied sending secret file contents]'
        })
      }
    }
    return safe
  }

  private async runPromptLifecycle(
    conversationId: string,
    run: ActiveRunControl,
    gateway: IdeWorkspaceGateway,
    params: {
      text: string
      attachments?: IdeChatAttachment[]
      activeFilePath?: string
    }
  ): Promise<void> {
    const conv = this.requireConversation(conversationId)
    try {
      const attachments = await this.filterAttachmentsForSecretSafety(
        conv,
        run,
        params.attachments ?? []
      )
      if (run.abortController.signal.aborted) {
        this.setRunStatus(conv, null, 'canceled')
        return
      }

      this.setRunStatus(conv, run.runId, 'analyzing', 'Inspecting workspace context...')
      this.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
        type: 'analysis.started',
        summary: `Inspecting workspace in ${run.config.mode.toUpperCase()} mode`,
        status: 'running'
      })

      const hintTerms = params.text
        .split(/[^A-Za-z0-9_.-]+/)
        .filter((token) => token.length >= 3)
        .slice(0, 10)
      const snapshot = await gateway.inspectWorkspace(hintTerms)

      for (const file of snapshot.keyFiles.slice(0, 5)) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'analysis.file_read',
          summary: `Read ${file.relativePath}`,
          relativePath: file.relativePath,
          status: 'completed'
        })
      }

      let activeFileContent: { relativePath: string; content: string } | null = null
      if (params.activeFilePath) {
        const normalizedActive = normalizeWorkspaceRelativePath(params.activeFilePath)
        const readRes = await gateway.readTextFile(normalizedActive)
        if (readRes.ok && readRes.content !== null) {
          activeFileContent = { relativePath: normalizedActive, content: readRes.content }
        }
      }

      this.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'analysis.completed',
        summary: `Inspected ${snapshot.fileList.length} files (${snapshot.keyFiles.length} loaded)`,
        status: 'completed'
      })

      if (run.config.mode === 'ask') {
        await this.executeReadOnlyChatTurn(conv, run, {
          prompt: buildAskPrompt({
            question: params.text,
            snapshot,
            attachments,
            activeFileContent,
            history: conv.messages.slice(0, -1),
            activePlan: conv.plans.find((p) => p.id === conv.activePlanId) ?? conv.plans.at(-1)
          }),
          mode: 'ask'
        })
        return
      }

      if (run.config.mode === 'agent' && isClarificationOrQuestionPrompt(params.text)) {
        const activePlan =
          conv.plans.find((p) => p.id === conv.activePlanId) ?? conv.plans.at(-1) ?? null
        await this.executeReadOnlyChatTurn(conv, run, {
          prompt: buildAskPrompt({
            question: params.text,
            snapshot,
            attachments,
            activeFileContent,
            history: conv.messages.slice(0, -1),
            activePlan
          }),
          mode: 'ask',
          preserveAwaitingPlan: activePlan?.status === 'awaiting_approval'
        })
        return
      }

      if (run.config.mode === 'review') {
        const diffSummary = await gateway.getGitDiffSummary()
        const trackedSummary = conv.fileChanges
          .map(
            (c) =>
              `- ${c.relativePath} (${c.changeType}, state=${c.acceptedState}, chunks=${c.chunksApplied})`
          )
          .join('\n')
        const combinedDiff = [
          diffSummary,
          trackedSummary ? `### Tracked Agent Changes\n${trackedSummary}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
        const cmdSummary = conv.commandExecutions
          .slice(-5)
          .map((c) => `- \`${c.command}\`: ${c.status} (exit ${c.exitCode ?? 'n/a'})`)
          .join('\n')

        await this.executeReadOnlyChatTurn(conv, run, {
          prompt: buildReviewPrompt({
            request: params.text,
            diffSummary: combinedDiff,
            commandHistorySummary: cmdSummary,
            snapshot
          }),
          mode: 'review'
        })
        return
      }

      // BOTH `plan` mode and `agent` mode MUST produce an implementation plan and wait for explicit user approval!
      this.setRunStatus(conv, run.runId, 'planning', 'Generating implementation plan...')
      if (run.config.multiAgentEnabled) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'planner',
          type: 'agent.role_started',
          summary: 'Planner Agent drafting implementation plan',
          status: 'running'
        })
      }

      const planPrompt = buildPlanPrompt({
        request: params.text,
        snapshot,
        attachments,
        activeFileContent,
        history: conv.messages.slice(0, -1),
        mode: run.config.mode === 'agent' ? 'agent' : 'plan'
      })
      const aiRes = await this.deps.aiClient.complete({
        workspacePath: gateway.target.workspacePath,
        agentId: run.config.agentId,
        modelId: run.config.modelId,
        prompt: planPrompt,
        signal: run.abortController.signal
      })

      if (!aiRes.ok) {
        if (aiRes.canceled || run.abortController.signal.aborted) {
          this.appendActivity(conv, {
            runId: run.runId,
            role: 'planner',
            type: 'run.canceled',
            summary: 'Planning canceled',
            status: 'warning'
          })
          this.setRunStatus(conv, null, 'canceled')
          return
        }
        throw new Error(aiRes.error)
      }

      const triage = parsePlanOrAnswerFromAiOutput(aiRes.text, params.text)
      if (!triage) {
        throw new Error(
          'Model response did not include a valid structured implementation plan JSON. Try revising or switching models.'
        )
      }

      if (triage.kind === 'answer') {
        const answerMessage: IdeChatMessage = {
          id: randomUUID(),
          conversationId: conv.id,
          role: 'assistant',
          mode: 'ask',
          text: triage.message,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: run.config.agentId,
          modelId: run.config.modelId,
          runId: run.runId
        }
        conv.messages.push(answerMessage)
        this.emit({ type: 'message_complete', conversationId: conv.id, message: answerMessage })
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'run.completed',
          summary: 'Answered directly (no file changes needed)',
          status: 'completed'
        })
        const activePlan = conv.plans.find((p) => p.id === conv.activePlanId)
        this.setRunStatus(
          conv,
          null,
          activePlan?.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed'
        )
        return
      }

      const parsedPlan = triage.plan
      const plan = this.buildPlanRecord({
        conversation: conv,
        requestSummary: params.text,
        raw: parsedPlan,
        version: (conv.plans[conv.plans.length - 1]?.version ?? 0) + 1
      })

      for (const prev of conv.plans) {
        if (prev.status === 'awaiting_approval' || prev.status === 'draft') {
          prev.status = 'superseded'
        }
      }
      conv.plans.push(plan)
      conv.activePlanId = plan.id

      const shouldAutoExecute =
        run.config.mode === 'agent' &&
        parsedPlan.requiresApproval === false &&
        plan.estimatedComplexity === 'low' &&
        plan.affectedFiles.length > 0 &&
        plan.affectedFiles.length <= 2 &&
        plan.affectedFiles.every(
          (file) =>
            file.action !== 'delete' && classifySensitiveFilePath(file.path, 'write') === null
        )

      if (shouldAutoExecute) {
        plan.status = 'approved'
        plan.updatedAt = Date.now()
        plan.approvalRecord = {
          planId: plan.id,
          planVersion: plan.version,
          planHash: plan.planHash,
          decision: 'approved',
          decidedAt: Date.now(),
          agentId: run.config.agentId,
          modelId: run.config.modelId,
          note: 'auto_approved_small_change'
        }
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'plan.approved',
          summary: `Auto-approved small scoped edit (${plan.affectedFiles.length} file(s))`,
          status: 'completed'
        })
        await this.executeApprovedPlanRun(conv.id, plan.id, run, gateway)
        return
      }

      const planMessage: IdeChatMessage = {
        id: randomUUID(),
        conversationId: conv.id,
        role: 'assistant',
        mode: run.config.mode,
        text: formatPlanIntroMarkdown(plan),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentId: run.config.agentId,
        modelId: run.config.modelId,
        teamMode: run.config.multiAgentEnabled,
        planId: plan.id,
        runId: run.runId
      }
      conv.messages.push(planMessage)
      this.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
        type: 'plan.generated',
        summary: `Plan v${plan.version} ready for approval (${plan.affectedFiles.length} files, ${plan.steps.length} steps)`,
        status: 'completed',
        expandablePayload: { planId: plan.id, planHash: plan.planHash }
      })
      if (run.config.multiAgentEnabled) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'planner',
          type: 'agent.role_completed',
          summary: 'Planner Agent finished plan proposal',
          status: 'completed'
        })
      }
      this.emit({ type: 'plan_proposed', conversationId: conv.id, plan })
      this.setRunStatus(
        conv,
        null,
        'awaiting_approval',
        'Waiting for user approval before modifying files'
      )
    } finally {
      this.activeRuns.delete(conversationId)
    }
  }

  private async executeReadOnlyChatTurn(
    conv: IdeConversation,
    run: ActiveRunControl,
    params: { prompt: string; mode: 'ask' | 'review'; preserveAwaitingPlan?: boolean }
  ): Promise<void> {
    const assistantMsg: IdeChatMessage = {
      id: randomUUID(),
      conversationId: conv.id,
      role: 'assistant',
      mode: params.mode,
      text: '',
      streaming: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      runId: run.runId
    }
    conv.messages.push(assistantMsg)
    this.setRunStatus(conv, run.runId, 'executing', `Generating ${params.mode} response...`)

    const res = await this.deps.aiClient.complete({
      workspacePath: conv.workspacePath,
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      prompt: params.prompt,
      signal: run.abortController.signal,
      onDelta: (delta) => {
        assistantMsg.text += delta
        assistantMsg.updatedAt = Date.now()
        this.emit({
          type: 'message_delta',
          conversationId: conv.id,
          messageId: assistantMsg.id,
          text: assistantMsg.text
        })
      }
    })

    assistantMsg.streaming = false
    assistantMsg.updatedAt = Date.now()

    if (!res.ok) {
      if (res.canceled || run.abortController.signal.aborted) {
        if (!assistantMsg.text) {
          assistantMsg.text = '_Generation stopped by user._'
        }
        this.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'run.canceled',
          summary: 'Stopped by user',
          status: 'warning'
        })
        this.setRunStatus(conv, null, 'canceled')
        return
      }
      assistantMsg.error = res.error
      assistantMsg.text = assistantMsg.text || `Error: ${res.error}`
      this.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
      this.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'run.failed',
        summary: res.error,
        status: 'error'
      })
      this.setRunStatus(conv, null, 'failed', res.error)
      return
    }

    assistantMsg.text = res.text
    this.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
    this.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.completed',
      summary: `${params.mode === 'review' ? 'Code review' : 'Answer'} completed (read-only)`,
      status: 'completed'
    })
    const activePlan = params.preserveAwaitingPlan
      ? conv.plans.find((p) => p.id === conv.activePlanId)
      : undefined
    const nextIdleStatus =
      activePlan?.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed'
    this.setRunStatus(conv, null, nextIdleStatus)
  }

  private buildPlanRecord(params: {
    conversation: IdeConversation
    requestSummary: string
    raw: NonNullable<ReturnType<typeof parsePlanJsonFromAiOutput>>
    version: number
    revisionNotes?: string[]
  }): IdeTaskPlan {
    const now = Date.now()
    const steps: IdePlanStep[] = params.raw.steps.map((step, index) => ({
      id: randomUUID(),
      index,
      title: step.title,
      detail: step.detail,
      targetFiles: step.targetFiles,
      status: 'pending'
    }))
    const affectedFiles: IdePlanFileAction[] = params.raw.affectedFiles
    const planHash = computeIdePlanHash({
      objective: params.raw.objective,
      affectedFiles,
      steps,
      risks: params.raw.risks,
      testsAndVerification: params.raw.testsAndVerification
    })
    return {
      id: randomUUID(),
      conversationId: params.conversation.id,
      version: params.version,
      planHash,
      ...(params.raw.intro ? { intro: params.raw.intro } : {}),
      objective: params.raw.objective,
      requestSummary: params.requestSummary,
      affectedFiles,
      steps,
      risks: params.raw.risks,
      testsAndVerification: params.raw.testsAndVerification,
      estimatedComplexity: params.raw.estimatedComplexity,
      status: 'awaiting_approval',
      createdAt: now,
      updatedAt: now,
      approvalRecord: null,
      revisionNotes: params.revisionNotes ?? []
    }
  }

  async handlePlanDecision(params: {
    conversationId: string
    planId: string
    worktreeSelector?: string
    decision: 'approve' | 'reject' | 'revise'
    revisionNote?: string
    agentId?: string
    modelId?: string
    dirtyRelativePaths?: string[]
  }): Promise<IdeConversation> {
    const conv = this.requireConversation(params.conversationId)
    const plan = conv.plans.find((p) => p.id === params.planId)
    if (!plan) {
      throw new Error(`Plan "${params.planId}" not found.`)
    }
    if (params.agentId !== undefined || params.modelId !== undefined) {
      const selection = this.resolveSelectionUpdate(conv, params)
      conv.agentId = selection.agentId
      conv.modelId = selection.modelId
    }
    const dirtySet = this.updateDirtySet(conv.id, params.dirtyRelativePaths)

    if (params.decision === 'reject') {
      plan.status = 'rejected'
      plan.updatedAt = Date.now()
      plan.approvalRecord = {
        planId: plan.id,
        planVersion: plan.version,
        planHash: plan.planHash,
        decision: 'rejected',
        decidedAt: Date.now(),
        agentId: conv.agentId,
        modelId: conv.modelId,
        ...(params.revisionNote ? { note: params.revisionNote } : {})
      }
      this.appendActivity(conv, {
        runId: randomUUID(),
        role: 'orchestrator',
        type: 'plan.rejected',
        summary: `Plan v${plan.version} rejected by user`,
        status: 'warning'
      })
      conv.messages.push({
        id: randomUUID(),
        conversationId: conv.id,
        role: 'system',
        mode: conv.mode,
        text: `Plan v${plan.version} rejected. No workspace files were modified.`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        planId: plan.id
      })
      this.setRunStatus(conv, null, 'idle', 'Plan rejected')
      return conv
    }

    if (params.decision === 'revise') {
      const note = params.revisionNote?.trim()
      if (!note) {
        throw new Error('Revision instructions are required to revise the plan.')
      }
      if (this.activeRuns.has(conv.id)) {
        throw new Error('An active run is already in progress.')
      }
      plan.status = 'superseded'
      plan.updatedAt = Date.now()
      plan.approvalRecord = {
        planId: plan.id,
        planVersion: plan.version,
        planHash: plan.planHash,
        decision: 'revision_requested',
        decidedAt: Date.now(),
        agentId: conv.agentId,
        modelId: conv.modelId,
        note
      }
      const selector = params.worktreeSelector ?? conv.workspacePath
      const gateway = await this.deps.resolveGateway(selector)
      const runId = randomUUID()
      const runControl: ActiveRunControl = {
        runId,
        conversationId: conv.id,
        abortController: new AbortController(),
        paused: false,
        resumeResolvers: [],
        permissionWaiters: new Map(),
        worktreeSelector: selector,
        dirtyPaths: dirtySet,
        config: {
          mode: conv.mode,
          agentId: conv.agentId,
          modelId: conv.modelId,
          multiAgentEnabled: conv.multiAgentEnabled,
          liveEditSpeed: conv.liveEditSpeed
        }
      }
      this.activeRuns.set(conv.id, runControl)

      this.appendActivity(conv, {
        runId,
        role: 'planner',
        type: 'plan.revision_requested',
        summary: `Revising Plan v${plan.version}`,
        detail: note,
        status: 'running'
      })
      conv.messages.push({
        id: randomUUID(),
        conversationId: conv.id,
        role: 'user',
        mode: conv.mode,
        text: `Revise plan: ${note}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      this.setRunStatus(conv, runId, 'planning', 'Generating revised implementation plan...')

      void (async () => {
        try {
          const snapshot = await gateway.inspectWorkspace()
          const aiRes = await this.deps.aiClient.complete({
            workspacePath: gateway.target.workspacePath,
            agentId: runControl.config.agentId,
            modelId: runControl.config.modelId,
            prompt: buildRevisePlanPrompt({
              previousPlan: plan,
              revisionNote: note,
              snapshot,
              attachments: []
            }),
            signal: runControl.abortController.signal
          })
          if (!aiRes.ok) {
            if (aiRes.canceled || runControl.abortController.signal.aborted) {
              this.setRunStatus(conv, null, 'canceled')
              return
            }
            throw new Error(aiRes.error)
          }
          const rawNext = parsePlanJsonFromAiOutput(aiRes.text, plan.requestSummary)
          if (!rawNext) {
            throw new Error('Model did not return a valid revised plan JSON.')
          }
          const revised = this.buildPlanRecord({
            conversation: conv,
            requestSummary: plan.requestSummary,
            raw: rawNext,
            version: plan.version + 1,
            revisionNotes: [...plan.revisionNotes, note]
          })
          conv.plans.push(revised)
          conv.activePlanId = revised.id
          conv.messages.push({
            id: randomUUID(),
            conversationId: conv.id,
            role: 'assistant',
            mode: conv.mode,
            text: formatPlanIntroMarkdown(revised),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            agentId: conv.agentId,
            modelId: conv.modelId,
            planId: revised.id,
            runId
          })
          this.appendActivity(conv, {
            runId,
            role: 'planner',
            type: 'plan.generated',
            summary: `Revised Plan v${revised.version} awaiting approval`,
            status: 'completed'
          })
          this.emit({ type: 'plan_proposed', conversationId: conv.id, plan: revised })
          this.setRunStatus(conv, null, 'awaiting_approval')
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          conv.messages.push({
            id: randomUUID(),
            conversationId: conv.id,
            role: 'assistant',
            mode: conv.mode,
            text: `Error revising plan: ${msg}`,
            error: msg,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
          this.setRunStatus(conv, null, 'failed', msg)
        } finally {
          this.activeRuns.delete(conv.id)
        }
      })()

      return conv
    }

    // decision === 'approve': lock plan version + hash, switch to agent mode, execute ONLY approved scope!
    if (this.activeRuns.has(conv.id)) {
      throw new Error('Another run is already active in this conversation.')
    }
    if (plan.status !== 'awaiting_approval') {
      throw new Error(`Plan v${plan.version} is "${plan.status}" and cannot be approved.`)
    }
    const recomputed = computeIdePlanHash(plan)
    if (recomputed !== plan.planHash) {
      throw new Error('Plan integrity check failed: plan content no longer matches its hash.')
    }

    conv.mode = 'agent'
    plan.status = 'approved'
    plan.updatedAt = Date.now()
    plan.approvalRecord = {
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      decision: 'approved',
      decidedAt: Date.now(),
      agentId: conv.agentId,
      modelId: conv.modelId
    }

    const runId = randomUUID()
    const selector = params.worktreeSelector ?? conv.workspacePath
    const gateway = await this.deps.resolveGateway(selector)
    const runControl: ActiveRunControl = {
      runId,
      conversationId: conv.id,
      abortController: new AbortController(),
      paused: false,
      resumeResolvers: [],
      permissionWaiters: new Map(),
      worktreeSelector: selector,
      dirtyPaths: dirtySet,
      config: {
        mode: 'agent',
        agentId: conv.agentId,
        modelId: conv.modelId,
        multiAgentEnabled: conv.multiAgentEnabled,
        liveEditSpeed: conv.liveEditSpeed
      }
    }
    this.activeRuns.set(conv.id, runControl)

    this.appendActivity(conv, {
      runId,
      role: 'orchestrator',
      type: 'plan.approved',
      summary: `Approved Plan v${plan.version} (hash ${plan.planHash.slice(0, 8)})`,
      status: 'completed',
      expandablePayload: {
        planId: plan.id,
        planVersion: plan.version,
        planHash: plan.planHash
      }
    })
    this.saveAndPublish(conv, pickExecutionSettings(conv))

    void this.executeApprovedPlanRun(conv.id, plan.id, runControl, gateway).catch((error) => {
      const latest = this.deps.store.getConversation(conv.id)
      if (!latest) return
      const errText = error instanceof Error ? error.message : String(error)
      const latestPlan = latest.plans.find((p) => p.id === plan.id)
      if (latestPlan) latestPlan.status = 'failed'
      this.appendActivity(latest, {
        runId,
        role: 'orchestrator',
        type: 'run.failed',
        summary: `Execution failed: ${errText}`,
        status: 'error'
      })
      latest.messages.push({
        id: randomUUID(),
        conversationId: latest.id,
        role: 'assistant',
        mode: 'agent',
        text: `Execution failed: ${errText}`,
        error: errText,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runId,
        planId: plan.id
      })
      this.setRunStatus(latest, null, 'failed', errText)
    })

    return conv
  }

  private async executeApprovedPlanRun(
    conversationId: string,
    planId: string,
    run: ActiveRunControl,
    gateway: IdeWorkspaceGateway
  ): Promise<void> {
    const conv = this.requireConversation(conversationId)
    const plan = conv.plans.find((p) => p.id === planId)
    if (!plan) {
      throw new Error(`Approved plan "${planId}" missing.`)
    }

    const gateCheck = isPlanApprovedForExecution(plan)
    if (!gateCheck.ok) {
      throw new Error(gateCheck.reason)
    }

    const checkpoint: IdeCheckpoint = {
      id: randomUUID(),
      conversationId: conv.id,
      runId: run.runId,
      label: `Before Plan v${plan.version}: ${plan.objective.slice(0, 48)}`,
      createdAt: Date.now(),
      files: []
    }
    const baselineShaByFile = new Map<string, string | null>()

    try {
      plan.status = 'executing'
      plan.updatedAt = Date.now()
      this.setRunStatus(conv, run.runId, 'executing', 'Starting approved implementation...')

      // Capture clean non-Git checkpoint baseline for every file in approved scope first.
      for (const item of plan.affectedFiles) {
        const normalized = normalizeWorkspaceRelativePath(item.path)
        const readRes = await gateway.readTextFile(normalized, { allowSecretRead: false })
        const content = readRes.ok ? readRes.content : null
        const sha = readRes.ok ? readRes.sha256 : null
        baselineShaByFile.set(normalized, sha)
        checkpoint.files.push({
          relativePath: normalized,
          existedBefore: content !== null,
          beforeContent: content,
          afterContent: content,
          status: 'pending'
        })
      }
      conv.checkpoints.push(checkpoint)
      this.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'checkpoint.created',
        summary: `Saved recovery checkpoint (${checkpoint.files.length} scoped files)`,
        status: 'completed'
      })

      const completedSummaries: string[] = []
      const modifiedFilesSet = new Set<string>()
      const verificationCommands = new Set<string>(plan.testsAndVerification)

      if (run.config.multiAgentEnabled) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'coder',
          type: 'agent.role_started',
          summary: 'Coder Agent applying approved steps',
          status: 'running'
        })
      }

      for (const step of plan.steps) {
        const canContinue = await this.waitIfPausedOrAborted(conv, run)
        if (!canContinue) {
          plan.status = 'failed'
          this.setRunStatus(conv, null, 'canceled', 'Execution canceled by user')
          return
        }

        step.status = 'in_progress'
        this.appendActivity(conv, {
          runId: run.runId,
          role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
          type: 'step.started',
          summary: `Step ${step.index + 1}/${plan.steps.length}: ${step.title}`,
          detail: step.detail,
          status: 'running'
        })

        const contextPaths = Array.from(
          new Set(
            [...step.targetFiles, ...plan.affectedFiles.map((f) => f.path)].map(
              normalizeWorkspaceRelativePath
            )
          )
        ).slice(0, 12)

        const currentFiles: Array<{ relativePath: string; content: string | null }> = []
        for (const relPath of contextPaths) {
          const readRes = await gateway.readTextFile(relPath)
          currentFiles.push({
            relativePath: relPath,
            content: readRes.ok ? readRes.content : null
          })
        }

        const aiRes = await this.deps.aiClient.complete({
          workspacePath: gateway.target.workspacePath,
          agentId: run.config.agentId,
          modelId: run.config.modelId,
          prompt: buildExecutionStepPrompt({
            plan,
            step,
            currentFiles,
            completedSummaries,
            roleLabel: run.config.multiAgentEnabled ? 'Code Nexus Coder Agent' : 'Code Nexus Agent'
          }),
          signal: run.abortController.signal
        })

        if (!aiRes.ok) {
          step.status = 'failed'
          if (aiRes.canceled || run.abortController.signal.aborted) {
            this.setRunStatus(conv, null, 'canceled')
            return
          }
          throw new Error(aiRes.error)
        }

        const stepOutput = parseStepOperationsFromAiOutput(aiRes.text)
        if (!stepOutput) {
          step.status = 'failed'
          throw new Error(
            `Model returned invalid structured JSON for step "${step.title}". Switch models or retry.`
          )
        }

        for (const cmd of stepOutput.verificationCommands) {
          verificationCommands.add(cmd)
        }

        for (const op of stepOutput.operations) {
          const canApply = await this.waitIfPausedOrAborted(conv, run)
          if (!canApply) {
            plan.status = 'failed'
            this.setRunStatus(conv, null, 'canceled')
            return
          }

          await this.applyApprovedFileOperation({
            conv,
            plan,
            checkpoint,
            baselineShaByFile,
            run,
            gateway,
            op,
            modifiedFilesSet
          })
        }

        step.status = 'completed'
        completedSummaries.push(`${step.title}: ${stepOutput.summary}`)
        this.appendActivity(conv, {
          runId: run.runId,
          role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
          type: 'step.completed',
          summary: stepOutput.summary,
          status: 'completed'
        })
      }

      if (run.config.multiAgentEnabled) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'coder',
          type: 'agent.role_completed',
          summary: `Coder Agent finished ${plan.steps.length} step(s)`,
          status: 'completed'
        })
      }

      // Verification phase
      const executedCmdIds: string[] = []
      const runnableCommands = Array.from(verificationCommands).filter((cmd) =>
        looksLikeExecutableCommand(cmd)
      )
      if (runnableCommands.length > 0) {
        this.setRunStatus(conv, run.runId, 'verifying', 'Running verification checks...')
        for (const command of runnableCommands) {
          if (run.abortController.signal.aborted) break
          const cmdRecord = await this.executeVerifiedCommand(conv, run, gateway, command)
          if (cmdRecord) {
            executedCmdIds.push(cmdRecord.id)
          }
          if (cmdRecord?.status === 'failed') {
            await this.attemptTestFailureRepair({
              conv,
              plan,
              checkpoint,
              baselineShaByFile,
              run,
              gateway,
              failedCommand: cmdRecord,
              modifiedFilesSet,
              executedCmdIds
            })
          }
        }
      }

      // Optional Multi-Agent Reviewer verification before final summary
      let reviewerReport = ''
      if (run.config.multiAgentEnabled && !run.abortController.signal.aborted) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'reviewer',
          type: 'agent.role_started',
          summary: 'Reviewer Agent checking changes & test output',
          status: 'running'
        })
        const diffSummary = await gateway.getGitDiffSummary()
        const snapshot = await gateway.inspectWorkspace()
        const revRes = await this.deps.aiClient.complete({
          workspacePath: gateway.target.workspacePath,
          agentId: run.config.agentId,
          modelId: run.config.modelId,
          prompt: buildReviewPrompt({
            request: plan.objective,
            diffSummary:
              diffSummary ??
              Array.from(modifiedFilesSet)
                .map((p) => `Modified: ${p}`)
                .join('\n'),
            commandHistorySummary: conv.commandExecutions
              .filter((c) => executedCmdIds.includes(c.id))
              .map((c) => `${c.command}: ${c.status} (exit ${c.exitCode ?? 'n/a'})`)
              .join('\n'),
            snapshot,
            multiAgentReviewer: true
          }),
          signal: run.abortController.signal
        })
        if (revRes.ok) {
          reviewerReport = `\n\n### Reviewer Check\n${revRes.text}`
          this.appendActivity(conv, {
            runId: run.runId,
            role: 'reviewer',
            type: 'agent.role_completed',
            summary: 'Reviewer Agent completed inspection',
            status: 'completed'
          })
        }
      }

      const plannedPaths = plan.affectedFiles.map((f) => normalizeWorkspaceRelativePath(f.path))
      const arabicPlan = hasArabicText(`${plan.requestSummary ?? ''}\n${plan.objective}`)
      const expectedFileChanges =
        plannedPaths.length > 0 || plan.steps.some((s) => s.targetFiles.length > 0)
      const unmodifiedPlannedFiles = plannedPaths.filter((p) => !modifiedFilesSet.has(p))

      if (expectedFileChanges && modifiedFilesSet.size === 0) {
        plan.status = 'failed'
        plan.updatedAt = Date.now()
        conv.messages.push({
          id: randomUUID(),
          conversationId: conv.id,
          role: 'assistant',
          mode: 'agent',
          text: [
            arabicPlan
              ? `### لم يكتمل التنفيذ: ${plan.objective}`
              : `### Implementation Incomplete: ${plan.objective}`,
            arabicPlan
              ? '**لم تُطبّق أي تغييرات على الملفات.** أنهى الوكيل الخطوات دون إنشاء أو تعديل ملفات ضمن النطاق المعتمد.'
              : '**No file changes were applied.** The agent finished its steps without writing or modifying any files in the approved scope.',
            completedSummaries.length > 0 ? completedSummaries.map((s) => `- ${s}`).join('\n') : '',
            arabicPlan
              ? '**الخطوة المقترحة:** أعد التنفيذ أو اطلب تعديل الخطة لتحديد عمليات الملفات بوضوح أكبر.'
              : '**Suggested next step:** retry execution, or ask the agent to revise the plan with more explicit file operations.'
          ]
            .filter(Boolean)
            .join('\n\n'),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: run.config.agentId,
          modelId: run.config.modelId,
          teamMode: run.config.multiAgentEnabled,
          planId: plan.id,
          runId: run.runId
        })
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'run.failed',
          summary: 'Execution finished with no file changes applied',
          status: 'error'
        })
        this.setRunStatus(conv, null, 'failed')
        return
      }

      plan.status = 'completed'
      plan.updatedAt = Date.now()
      const modifiedList = Array.from(modifiedFilesSet)

      conv.messages.push({
        id: randomUUID(),
        conversationId: conv.id,
        role: 'assistant',
        mode: 'agent',
        text: [
          arabicPlan
            ? `### تم تنفيذ التغييرات\n${plan.objective}`
            : `### Changes Applied\n${plan.objective}`,
          completedSummaries.length > 0 ? completedSummaries.map((s) => `- ${s}`).join('\n') : '',
          unmodifiedPlannedFiles.length > 0
            ? `**${arabicPlan ? 'ملاحظة — ملفات مخططة لم تتغير' : 'Note — planned files unchanged'}:** ${unmodifiedPlannedFiles.map((f) => `\`${f}\``).join('، ')}`
            : '',
          reviewerReport
        ]
          .filter(Boolean)
          .join('\n\n'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentId: run.config.agentId,
        modelId: run.config.modelId,
        teamMode: run.config.multiAgentEnabled,
        planId: plan.id,
        runId: run.runId,
        modifiedFiles: modifiedList,
        commandIds: executedCmdIds
      })

      this.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'run.completed',
        summary: `Completed Plan v${plan.version} (${modifiedList.length} files updated)`,
        status: 'completed'
      })
      this.setRunStatus(conv, null, 'completed')
    } finally {
      this.activeRuns.delete(conversationId)
    }
  }

  private async applyApprovedFileOperation(params: {
    conv: IdeConversation
    plan: IdeTaskPlan
    checkpoint: IdeCheckpoint
    baselineShaByFile: Map<string, string | null>
    run: ActiveRunControl
    gateway: IdeWorkspaceGateway
    op: RawStepExecutionOperation
    modifiedFilesSet: Set<string>
  }): Promise<void> {
    const { conv, plan, checkpoint, baselineShaByFile, run, gateway, op, modifiedFilesSet } = params
    const normalized = normalizeWorkspaceRelativePath(op.path)

    // Hard runtime gate #1: verify mode + plan approval + file scope
    const scopeCheck = isPlanApprovedForExecution(plan, [normalized])
    let allowSecretWrite = false
    if (!scopeCheck.ok) {
      if (scopeCheck.outOfScopePath) {
        const approvedExtra = await this.requestExplicitPermission(conv, run, {
          kind: 'out_of_scope_file',
          title: `Allow editing unapproved file "${normalized}"?`,
          detail: scopeCheck.reason,
          targetPath: normalized
        })
        if (!approvedExtra) {
          this.appendActivity(conv, {
            runId: run.runId,
            role: 'orchestrator',
            type: 'file.conflict',
            summary: `Skipped out-of-scope file ${normalized}`,
            relativePath: normalized,
            status: 'warning'
          })
          return
        }
        plan.affectedFiles.push({
          path: normalized,
          action: op.action,
          summary: op.rationale ?? 'Approved expansion'
        })
        plan.planHash = computeIdePlanHash(plan)
        if (plan.approvalRecord) {
          plan.approvalRecord.planHash = plan.planHash
        }
      } else {
        throw new Error(scopeCheck.reason)
      }
    }

    // Hard runtime gate #2: sensitive files & deletions
    const sensitiveKind = classifySensitiveFilePath(
      normalized,
      op.action === 'delete' ? 'delete' : 'write'
    )
    if (sensitiveKind) {
      const approvedSensitive = await this.requestExplicitPermission(conv, run, {
        kind: sensitiveKind,
        title:
          sensitiveKind === 'delete_important_file'
            ? `Allow deleting "${normalized}"?`
            : sensitiveKind === 'modify_secrets'
              ? `Allow modifying secrets file "${normalized}"?`
              : `Allow modifying production config "${normalized}"?`,
        detail: op.rationale ?? `Requested ${op.action} on "${normalized}".`,
        targetPath: normalized
      })
      if (!approvedSensitive) {
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'permission.resolved',
          summary: `Denied sensitive ${op.action} on ${normalized}`,
          relativePath: normalized,
          status: 'warning'
        })
        return
      }
      if (sensitiveKind === 'modify_secrets') {
        allowSecretWrite = true
      }
    }

    // Capture baseline if not captured yet (e.g. scope-expanded file)
    if (!baselineShaByFile.has(normalized)) {
      const readRes = await gateway.readTextFile(normalized, { allowSecretRead: allowSecretWrite })
      const content = readRes.ok ? readRes.content : null
      baselineShaByFile.set(normalized, readRes.ok ? readRes.sha256 : null)
      checkpoint.files.push({
        relativePath: normalized,
        existedBefore: content !== null,
        beforeContent: content,
        afterContent: content,
        status: 'pending'
      })
    }

    const cpEntry = checkpoint.files.find((f) => f.relativePath === normalized)!
    const beforeContent = cpEntry.beforeContent

    if (op.action === 'delete') {
      const delRes = await gateway.deleteWorkspaceFile(normalized, { mode: run.config.mode })
      if (!delRes.ok) {
        throw new Error(delRes.message)
      }
      cpEntry.afterContent = null
      this.upsertFileChangeRecord(conv, {
        runId: run.runId,
        checkpointId: checkpoint.id,
        relativePath: normalized,
        changeType: 'deleted',
        existedBefore: cpEntry.existedBefore,
        beforeContent,
        afterContent: null,
        chunksApplied: 1,
        totalChunks: 1,
        acceptedState: 'pending'
      })
      modifiedFilesSet.add(normalized)
      this.emit({
        type: 'file_deleted',
        conversationId: conv.id,
        runId: run.runId,
        relativePath: normalized
      })
      this.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
        type: 'file.deleted',
        summary: `Deleted ${normalized}`,
        relativePath: normalized,
        status: 'completed'
      })
      return
    }

    const targetContent = op.content ?? ''
    const chunks = buildProgressiveEditChunks({
      beforeContent: beforeContent,
      afterContent: targetContent
    })
    if (chunks.length === 0) {
      return
    }

    // Emit real file-open event so IDE opens the tab live before applying chunks.
    this.emit({
      type: 'editor_file_opened',
      conversationId: conv.id,
      runId: run.runId,
      relativePath: normalized,
      reason: op.action === 'create' ? `Creating ${normalized}` : `Editing ${normalized}`
    })
    this.appendActivity(conv, {
      runId: run.runId,
      role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
      type: 'editor.file_opened',
      summary: `Opened ${normalized} in editor`,
      relativePath: normalized,
      status: 'running'
    })

    let expectedSha = baselineShaByFile.get(normalized) ?? null
    let appliedCount = 0
    for (const chunk of chunks) {
      const canChunk = await this.waitIfPausedOrAborted(conv, run)
      if (!canChunk) {
        break
      }
      const writeRes = await gateway.writeTextChunk(normalized, chunk.content, {
        mode: run.config.mode,
        expectedBeforeSha: expectedSha,
        dirtyRelativePaths: run.dirtyPaths,
        allowSecretWrite
      })
      if (!writeRes.ok) {
        if (writeRes.reason === 'dirty_conflict' || writeRes.reason === 'disk_conflict') {
          cpEntry.status = 'conflict'
          this.upsertFileChangeRecord(conv, {
            runId: run.runId,
            checkpointId: checkpoint.id,
            relativePath: normalized,
            changeType: beforeContent === null ? 'created' : 'modified',
            existedBefore: cpEntry.existedBefore,
            beforeContent,
            afterContent: cpEntry.afterContent,
            chunksApplied: appliedCount,
            totalChunks: chunks.length,
            acceptedState: 'conflict',
            conflictMessage: writeRes.message
          })
          this.appendActivity(conv, {
            runId: run.runId,
            role: 'orchestrator',
            type: 'file.conflict',
            summary: `Conflict protecting ${normalized}`,
            detail: writeRes.message,
            relativePath: normalized,
            status: 'warning'
          })
          return
        }
        throw new Error(writeRes.message)
      }

      expectedSha = writeRes.sha256
      baselineShaByFile.set(normalized, writeRes.sha256)
      cpEntry.afterContent = chunk.content
      appliedCount += 1

      this.upsertFileChangeRecord(conv, {
        runId: run.runId,
        checkpointId: checkpoint.id,
        relativePath: normalized,
        changeType: cpEntry.existedBefore ? 'modified' : 'created',
        existedBefore: cpEntry.existedBefore,
        beforeContent,
        afterContent: chunk.content,
        chunksApplied: appliedCount,
        totalChunks: chunks.length,
        acceptedState: 'pending'
      })

      this.emit({
        type: 'editor_edit_chunk',
        conversationId: conv.id,
        runId: run.runId,
        relativePath: normalized,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        label: chunk.label
      })
      this.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
        type: 'editor.edit_chunk',
        summary: `${chunk.label} (${normalized}:${chunk.startLine}-${chunk.endLine})`,
        relativePath: normalized,
        status: 'completed'
      })

      const speed = run.config.liveEditSpeed ?? 'natural'
      const delay =
        this.deps.chunkDelayMs ?? (speed === 'instant' ? 0 : speed === 'fast' ? 120 : 380)
      if (delay > 0 && chunk.chunkIndex < chunk.totalChunks - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    modifiedFilesSet.add(normalized)
    this.emit({
      type: cpEntry.existedBefore ? 'file_modified' : 'file_created',
      conversationId: conv.id,
      runId: run.runId,
      relativePath: normalized
    })
  }

  private upsertFileChangeRecord(
    conv: IdeConversation,
    input: Omit<IdeFileChangeRecord, 'id' | 'conversationId' | 'updatedAt'>
  ): void {
    const existing = conv.fileChanges.find(
      (item) => item.runId === input.runId && item.relativePath === input.relativePath
    )
    if (existing) {
      Object.assign(existing, { ...input, updatedAt: Date.now() })
    } else {
      conv.fileChanges.push({
        id: randomUUID(),
        conversationId: conv.id,
        ...input,
        updatedAt: Date.now()
      })
    }
    this.saveAndPublish(conv)
  }

  private async executeVerifiedCommand(
    conv: IdeConversation,
    run: ActiveRunControl,
    gateway: IdeWorkspaceGateway,
    command: string,
    category?: IdeCommandCategory
  ): Promise<IdeCommandExecutionRecord | null> {
    if (!isModeWriteAllowed(run.config.mode)) {
      throw new Error(`Command execution is disabled in ${run.config.mode} mode.`)
    }
    const sensitive = classifySensitiveCommand(command)
    if (sensitive) {
      const approved = await this.requestExplicitPermission(conv, run, {
        kind: sensitive.kind,
        title: `Allow sensitive command: ${command}`,
        detail: sensitive.reason,
        command
      })
      if (!approved) {
        const denied: IdeCommandExecutionRecord = {
          id: randomUUID(),
          conversationId: conv.id,
          runId: run.runId,
          command,
          cwd: gateway.target.workspacePath,
          category: category ?? inferCommandCategory(command),
          status: 'denied',
          exitCode: null,
          stdoutTail: '',
          stderrTail: 'Denied by user policy.',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          durationMs: 0
        }
        conv.commandExecutions.push(denied)
        this.saveAndPublish(conv)
        this.emit({ type: 'command_done', conversationId: conv.id, execution: denied })
        return denied
      }
    }

    const record: IdeCommandExecutionRecord = {
      id: randomUUID(),
      conversationId: conv.id,
      runId: run.runId,
      command,
      cwd: gateway.target.workspacePath,
      category: category ?? inferCommandCategory(command),
      status: 'running',
      exitCode: null,
      stdoutTail: '',
      stderrTail: '',
      startedAt: Date.now()
    }
    conv.commandExecutions.push(record)
    this.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'command.started',
      summary: `Running: ${command}`,
      command,
      status: 'running'
    })

    const res = await gateway.runShellCommand(command, {
      signal: run.abortController.signal,
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') {
          record.stdoutTail = (record.stdoutTail + chunk).slice(-16_000)
        } else {
          record.stderrTail = (record.stderrTail + chunk).slice(-16_000)
        }
        this.emit({
          type: 'command_output',
          conversationId: conv.id,
          commandId: record.id,
          stream,
          chunk
        })
      }
    })

    record.exitCode = res.exitCode
    record.stdoutTail = res.stdout.slice(-16_000)
    record.stderrTail = res.stderr.slice(-16_000)
    record.finishedAt = Date.now()
    record.durationMs = res.durationMs
    record.status = res.canceled
      ? 'canceled'
      : !res.timedOut && res.exitCode === 0
        ? 'passed'
        : 'failed'

    this.saveAndPublish(conv)
    this.emit({ type: 'command_done', conversationId: conv.id, execution: record })
    this.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'command.finished',
      summary: `${command} -> ${record.status} (exit ${record.exitCode ?? 'n/a'})`,
      command,
      status: record.status === 'passed' ? 'completed' : 'error',
      expandablePayload: { stdoutTail: record.stdoutTail, stderrTail: record.stderrTail }
    })
    return record
  }

  private async attemptTestFailureRepair(params: {
    conv: IdeConversation
    plan: IdeTaskPlan
    checkpoint: IdeCheckpoint
    baselineShaByFile: Map<string, string | null>
    run: ActiveRunControl
    gateway: IdeWorkspaceGateway
    failedCommand: IdeCommandExecutionRecord
    modifiedFilesSet: Set<string>
    executedCmdIds: string[]
  }): Promise<void> {
    const { conv, plan, run, gateway, failedCommand } = params
    this.appendActivity(conv, {
      runId: run.runId,
      role: 'test-fixer',
      type: 'agent.role_started',
      summary: `Analyzing failure in "${failedCommand.command}"`,
      status: 'running'
    })
    const currentFiles: Array<{ relativePath: string; content: string | null }> = []
    for (const f of plan.affectedFiles.slice(0, 10)) {
      const readRes = await gateway.readTextFile(f.path)
      currentFiles.push({
        relativePath: normalizeWorkspaceRelativePath(f.path),
        content: readRes.ok ? readRes.content : null
      })
    }
    const aiRes = await this.deps.aiClient.complete({
      workspacePath: gateway.target.workspacePath,
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      prompt: buildRepairFailurePrompt({
        plan,
        failedCommand: failedCommand.command,
        stdoutTail: failedCommand.stdoutTail,
        stderrTail: failedCommand.stderrTail,
        currentFiles
      }),
      signal: run.abortController.signal
    })
    if (!aiRes.ok) {
      return
    }
    const parsed = parseStepOperationsFromAiOutput(aiRes.text)
    if (!parsed || parsed.operations.length === 0) {
      return
    }
    for (const op of parsed.operations) {
      await this.applyApprovedFileOperation({
        conv,
        plan,
        checkpoint: params.checkpoint,
        baselineShaByFile: params.baselineShaByFile,
        run,
        gateway,
        op,
        modifiedFilesSet: params.modifiedFilesSet
      })
    }
    const retryCmd = await this.executeVerifiedCommand(
      conv,
      run,
      gateway,
      failedCommand.command,
      failedCommand.category
    )
    if (retryCmd) {
      params.executedCmdIds.push(retryCmd.id)
    }
    this.appendActivity(conv, {
      runId: run.runId,
      role: 'test-fixer',
      type: 'agent.role_completed',
      summary: `Repair retry finished: ${retryCmd?.status ?? 'done'}`,
      status: retryCmd?.status === 'passed' ? 'completed' : 'warning'
    })
  }

  async runManualCommand(params: {
    conversationId: string
    worktreeSelector: string
    command: string
    category?: IdeCommandCategory
    permissionApproved?: boolean
  }): Promise<{
    needsPermission?: IdePermissionRequest
    execution?: IdeCommandExecutionRecord
    conversation: IdeConversation
  }> {
    const conv = this.requireConversation(params.conversationId)
    if (!isModeWriteAllowed(conv.mode)) {
      throw new Error(
        `Command execution is disabled in ${conv.mode} mode. Switch to Agent mode first.`
      )
    }
    const planCheck = isPlanApprovedForExecution(conv.plans.find((p) => p.id === conv.activePlanId))
    if (!planCheck.ok) {
      throw new Error(`Cannot run commands before plan approval: ${planCheck.reason}`)
    }

    const runId = conv.activeRunId ?? randomUUID()
    const sensitive = classifySensitiveCommand(params.command)
    if (sensitive && !params.permissionApproved) {
      const perm: IdePermissionRequest = {
        id: randomUUID(),
        conversationId: conv.id,
        runId,
        kind: sensitive.kind,
        title: `Allow sensitive command: ${params.command}`,
        detail: sensitive.reason,
        command: params.command,
        status: 'pending',
        createdAt: Date.now()
      }
      conv.pendingPermissions.push(perm)
      this.saveAndPublish(conv)
      this.emit({ type: 'permission_requested', conversationId: conv.id, permission: perm })
      return { needsPermission: perm, conversation: conv }
    }

    const gateway = await this.deps.resolveGateway(params.worktreeSelector)
    const manualRun: ActiveRunControl = {
      runId,
      conversationId: conv.id,
      abortController: new AbortController(),
      paused: false,
      resumeResolvers: [],
      permissionWaiters: new Map(),
      worktreeSelector: params.worktreeSelector,
      dirtyPaths: this.dirtyFilesByConversation.get(conv.id) ?? new Set(),
      config: {
        mode: conv.mode,
        agentId: conv.agentId,
        modelId: conv.modelId,
        multiAgentEnabled: conv.multiAgentEnabled,
        liveEditSpeed: conv.liveEditSpeed
      }
    }
    const execution = await this.executeVerifiedCommand(
      conv,
      manualRun,
      gateway,
      params.command,
      params.category
    )
    return { ...(execution ? { execution } : {}), conversation: conv }
  }

  handleRunControl(params: {
    conversationId: string
    runId: string
    action: 'pause' | 'resume' | 'stop' | 'retry'
    worktreeSelector?: string
    dirtyRelativePaths?: string[]
  }): Promise<IdeConversation> | IdeConversation {
    const conv = this.requireConversation(params.conversationId)
    if (params.dirtyRelativePaths) {
      this.updateDirtySet(conv.id, params.dirtyRelativePaths)
    }
    const run = this.activeRuns.get(conv.id)

    if (params.action === 'pause') {
      if (run) {
        run.paused = true
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'run.paused',
          summary: 'Execution paused by user',
          status: 'warning'
        })
        this.setRunStatus(conv, run.runId, 'paused')
      }
      return conv
    }

    if (params.action === 'resume') {
      if (run) {
        run.paused = false
        for (const resolve of run.resumeResolvers.splice(0)) {
          resolve()
        }
        this.appendActivity(conv, {
          runId: run.runId,
          role: 'orchestrator',
          type: 'run.resumed',
          summary: 'Execution resumed',
          status: 'running'
        })
        this.setRunStatus(conv, run.runId, 'executing')
      }
      return conv
    }

    if (params.action === 'stop') {
      if (run) {
        run.abortController.abort()
        for (const resolve of run.resumeResolvers.splice(0)) {
          resolve()
        }
        for (const [, resolvePerm] of run.permissionWaiters) {
          resolvePerm(false)
        }
        run.permissionWaiters.clear()
      }
      this.setRunStatus(conv, null, 'canceled', 'Stopped by user')
      return conv
    }

    // Retry: re-run active approved plan or last prompt in clean new run
    const activePlan = conv.plans.find((p) => p.id === conv.activePlanId)
    if (activePlan && activePlan.approvalRecord?.decision === 'approved') {
      activePlan.status = 'awaiting_approval'
      return this.handlePlanDecision({
        conversationId: conv.id,
        planId: activePlan.id,
        decision: 'approve',
        worktreeSelector: params.worktreeSelector,
        dirtyRelativePaths: params.dirtyRelativePaths
      })
    }
    const lastUserMessage = [...conv.messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMessage) {
      throw new Error('Nothing to retry in this conversation.')
    }
    return this.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: params.worktreeSelector ?? conv.workspacePath,
      text: lastUserMessage.text,
      mode: conv.mode,
      attachments: lastUserMessage.attachments,
      dirtyRelativePaths: params.dirtyRelativePaths
    })
  }

  async handleChangeDecision(params: {
    conversationId: string
    worktreeSelector?: string
    action: 'accept' | 'reject' | 'restore_checkpoint'
    changeId?: string
    checkpointId?: string
    dirtyRelativePaths?: string[]
  }): Promise<IdeConversation> {
    const conv = this.requireConversation(params.conversationId)
    const dirtySet = this.updateDirtySet(conv.id, params.dirtyRelativePaths)
    const gateway = await this.deps.resolveGateway(params.worktreeSelector ?? conv.workspacePath)

    if (params.action === 'accept') {
      const target = conv.fileChanges.find((c) => c.id === params.changeId)
      if (!target) {
        throw new Error('File change record not found.')
      }
      target.acceptedState = 'accepted'
      target.updatedAt = Date.now()
      return this.saveAndPublish(conv)
    }

    const targets =
      params.action === 'restore_checkpoint'
        ? conv.fileChanges.filter((c) => c.checkpointId === params.checkpointId)
        : conv.fileChanges.filter((c) => c.id === params.changeId)

    if (targets.length === 0) {
      throw new Error('No matching tracked file changes found to restore.')
    }

    for (const change of targets) {
      if (dirtySet.has(normalizeWorkspaceRelativePath(change.relativePath).toLowerCase())) {
        change.acceptedState = 'conflict'
        change.conflictMessage = `Skipped restore of "${change.relativePath}" because the editor has unsaved changes.`
        continue
      }
      const currentRead = await gateway.readTextFile(change.relativePath, { allowSecretRead: true })
      const currentSha = currentRead.ok ? currentRead.sha256 : null
      if (!change.existedBefore || change.beforeContent === null) {
        const delRes = await gateway.deleteWorkspaceFile(change.relativePath, { mode: 'agent' })
        if (!delRes.ok) {
          throw new Error(delRes.message)
        }
        this.emit({
          type: 'file_deleted',
          conversationId: conv.id,
          runId: change.runId,
          relativePath: change.relativePath
        })
      } else {
        const restoreRes = await gateway.writeTextChunk(change.relativePath, change.beforeContent, {
          mode: 'agent',
          expectedBeforeSha: currentSha,
          dirtyRelativePaths: dirtySet,
          allowSecretWrite: true
        })
        if (!restoreRes.ok) {
          change.acceptedState = 'conflict'
          change.conflictMessage = restoreRes.message
          continue
        }
        this.emit({
          type: 'editor_edit_chunk',
          conversationId: conv.id,
          runId: change.runId,
          relativePath: change.relativePath,
          startLine: 1,
          endLine: Math.max(1, change.beforeContent.split(/\r?\n/).length),
          chunkIndex: 0,
          totalChunks: 1,
          label: 'Restored checkpoint content'
        })
        this.emit({
          type: 'file_modified',
          conversationId: conv.id,
          runId: change.runId,
          relativePath: change.relativePath
        })
      }
      change.acceptedState = 'reverted'
      change.updatedAt = Date.now()
    }

    const cp = conv.checkpoints.find(
      (c) => c.id === (params.checkpointId ?? targets[0]?.checkpointId)
    )
    if (cp && params.action === 'restore_checkpoint') {
      for (const file of cp.files) {
        file.status = 'reverted'
      }
    }

    this.appendActivity(conv, {
      runId: targets[0]?.runId ?? randomUUID(),
      role: 'orchestrator',
      type: 'checkpoint.restored',
      summary:
        params.action === 'restore_checkpoint'
          ? `Restored checkpoint (${targets.length} file(s))`
          : `Reverted changes to ${targets[0]?.relativePath ?? 'file'}`,
      status: 'completed'
    })

    return this.saveAndPublish(conv)
  }
}

function inferCommandCategory(command: string): IdeCommandCategory {
  const lower = command.toLowerCase()
  if (/\b(vitest|jest|pytest|mocha|ava|test)\b/.test(lower)) return 'test'
  if (/\b(tsc|typecheck|tc|mypy|pyright)\b/.test(lower)) return 'typecheck'
  if (/\b(lint|eslint|oxlint|oxfmt|prettier|ruff|clippy)\b/.test(lower)) return 'lint'
  if (/\b(build|vite|webpack|rollup|cargo build)\b/.test(lower)) return 'build'
  return 'custom'
}

function looksLikeExecutableCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 160 || trimmed.includes('\n')) {
    return false
  }
  return /^(?:pnpm|npm|yarn|bun|npx|node|vitest|jest|tsc|oxlint|oxfmt|pytest|python|cargo|go|make)\b/i.test(
    trimmed
  )
}

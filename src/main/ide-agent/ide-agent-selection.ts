import { randomUUID } from 'node:crypto'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed
} from '../../shared/ide-agent/ide-agent-types'
import type { ActiveRunControl } from './ide-agent-runtime-types'
import {
  getCommitMessageAgentSpec,
  getCommitMessageModel
} from '../../shared/source-control/ai/generation/commit-message-agent-spec'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'
import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeActivityEvent,
  IdeProviderAgentOption
} from '../../shared/ide-agent/ide-agent-types'
import { createActivityEventRecord, type IdeAppendActivityInput } from './ide-agent-runtime-types'

export function isExecutableIdeAgent(agentId: string | undefined): boolean {
  return Boolean(agentId && isTuiAgent(agentId) && getCommitMessageAgentSpec(agentId))
}

export function resolveIdeExecutionSelection(
  knownProviderModels: Map<string, Set<string>>,
  agentId: string,
  modelId?: string,
  options?: { allowModelFallback?: boolean }
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
    if (options?.allowModelFallback) {
      return { agentId, modelId: spec.defaultModelId }
    }
    throw new Error(`Model "${resolvedModelId}" is not available for ${spec.label}.`)
  }
  const known = knownProviderModels.get(agentId)
  if (
    known &&
    resolvedModelId !== 'default' &&
    resolvedModelId !== spec.defaultModelId &&
    !known.has(resolvedModelId)
  ) {
    if (options?.allowModelFallback) {
      return { agentId, modelId: spec.defaultModelId }
    }
    throw new Error(
      `Model "${resolvedModelId}" is not available for ${spec.label}. Refresh AI models or choose another.`
    )
  }
  return { agentId, modelId: resolvedModelId }
}

export function buildNewIdeConversation(params: {
  knownProviderModels: Map<string, Set<string>>
  defaultAgentId?: string
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
  const requested = params.agentId ?? params.defaultAgentId ?? 'claude'
  const agentId = isExecutableIdeAgent(requested)
    ? requested
    : isExecutableIdeAgent(params.defaultAgentId ?? '')
      ? (params.defaultAgentId as string)
      : 'claude'
  const selection = resolveIdeExecutionSelection(
    params.knownProviderModels,
    agentId,
    agentId === requested ? params.modelId : undefined,
    { allowModelFallback: true }
  )
  const now = Date.now()
  return {
    id: randomUUID(),
    workspaceKey: params.workspaceKey,
    workspacePath: params.workspacePath,
    title: params.title?.trim() || 'New Chat',
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
}

export function resolveConversationSelectionUpdate(
  knownProviderModels: Map<string, Set<string>>,
  conv: IdeConversation,
  update: { agentId?: string; modelId?: string }
): { agentId: string; modelId: string } {
  const agentId = update.agentId ?? conv.agentId
  const modelId =
    update.modelId ??
    (update.agentId !== undefined && update.agentId !== conv.agentId ? undefined : conv.modelId)
  return resolveIdeExecutionSelection(knownProviderModels, agentId, modelId)
}

export function applyConversationSettingsUpdate(
  conv: IdeConversation,
  knownProviderModels: Map<string, Set<string>>,
  params: {
    title?: string
    mode?: IdeExecutionMode
    agentId?: string
    modelId?: string
    multiAgentEnabled?: boolean
    followAgent?: boolean
    liveEditSpeed?: IdeLiveEditSpeed
  }
): IdeConversation {
  if (params.title !== undefined) {
    conv.title = params.title.trim() || conv.title
  }
  if (params.mode !== undefined) {
    conv.mode = params.mode
  }
  if (params.agentId !== undefined || params.modelId !== undefined) {
    const sel = resolveConversationSelectionUpdate(knownProviderModels, conv, params)
    conv.agentId = sel.agentId
    conv.modelId = sel.modelId
  }
  if (params.multiAgentEnabled !== undefined) {
    conv.multiAgentEnabled = params.multiAgentEnabled
  }
  if (params.followAgent !== undefined) {
    conv.followAgent = params.followAgent
  }
  if (params.liveEditSpeed !== undefined) {
    conv.liveEditSpeed = params.liveEditSpeed
  }
  return conv
}

export function registerNewRunControl(
  activeRuns: Map<string, ActiveRunControl>,
  conv: IdeConversation,
  worktreeSelector: string,
  dirtyPaths: Set<string>
): ActiveRunControl {
  const control: ActiveRunControl = {
    runId: randomUUID(),
    conversationId: conv.id,
    abortController: new AbortController(),
    paused: false,
    resumeResolvers: [],
    permissionWaiters: new Map(),
    worktreeSelector,
    dirtyPaths,
    config: {
      mode: conv.mode,
      agentId: conv.agentId,
      modelId: conv.modelId,
      multiAgentEnabled: conv.multiAgentEnabled,
      liveEditSpeed: conv.liveEditSpeed
    }
  }
  activeRuns.set(conv.id, control)
  return control
}

export function updateDirtyPathsMap(
  dirtyFilesByConversation: Map<string, Set<string>>,
  activeRuns: Map<string, ActiveRunControl>,
  conversationId: string,
  dirtyPaths?: readonly string[]
): Set<string> {
  const next = new Set(
    (dirtyPaths ?? []).map((item) => normalizeWorkspaceRelativePath(item).toLowerCase())
  )
  dirtyFilesByConversation.set(conversationId, next)
  const run = activeRuns.get(conversationId)
  if (run) {
    run.dirtyPaths = next
  }
  return next
}

export function recordKnownProviderModels(
  knownProviderModels: Map<string, Set<string>>,
  providers: readonly IdeProviderAgentOption[]
): void {
  for (const provider of providers) {
    if (!provider.available || provider.models.length === 0) {
      continue
    }
    knownProviderModels.set(
      provider.id,
      new Set([provider.defaultModelId, ...provider.models.map((m) => m.id)])
    )
  }
}

export function abortAndRemoveRunControl(
  activeRuns: Map<string, ActiveRunControl>,
  conversationId: string
): void {
  const active = activeRuns.get(conversationId)
  if (!active) {
    return
  }
  active.abortController.abort()
  for (const resolve of active.resumeResolvers.splice(0)) {
    resolve()
  }
  for (const [, resolvePerm] of active.permissionWaiters) {
    resolvePerm(false)
  }
  active.permissionWaiters.clear()
  activeRuns.delete(conversationId)
}

export function pushBoundedActivityEvent(
  conv: IdeConversation,
  seq: number,
  params: IdeAppendActivityInput
): IdeActivityEvent {
  const event = createActivityEventRecord({ seq, conversationId: conv.id, ...params })
  conv.activity.push(event)
  if (conv.activity.length > 400) {
    conv.activity = conv.activity.slice(-400)
  }
  return event
}

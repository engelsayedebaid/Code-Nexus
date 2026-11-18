import { randomUUID } from 'node:crypto'
import type {
  IdeActivityEvent,
  IdeActivityEventType,
  IdeAgentRole,
  IdeAgentStreamEvent,
  IdeChatAttachment,
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed,
  IdePermissionRequest,
  IdeSensitiveActionKind
} from '../../shared/ide-agent/ide-agent-types'
import type { IdeAiClient } from './ide-ai-client'
import type { IdeAgentStore } from './ide-agent-persistence'
import type { IdeAttachmentStore } from './ide-attachment-store'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import type { AgentRunTelemetryCollector } from './harness/agent-telemetry'

export type ResolveWorkspaceGateway = (worktreeSelector: string) => Promise<IdeWorkspaceGateway>

export type ConversationExecutionSettings = Pick<
  IdeConversation,
  'title' | 'mode' | 'agentId' | 'modelId' | 'multiAgentEnabled' | 'followAgent' | 'liveEditSpeed'
>

export type RunExecutionConfig = {
  mode: IdeExecutionMode
  agentId: string
  modelId: string
  multiAgentEnabled: boolean
  liveEditSpeed?: IdeLiveEditSpeed
}

export type ActiveRunControl = {
  runId: string
  conversationId: string
  abortController: AbortController
  paused: boolean
  statusBeforePermission?: IdeConversation['status']
  resumeResolvers: (() => void)[]
  permissionWaiters: Map<string, (approved: boolean) => void>
  worktreeSelector: string
  dirtyPaths: Set<string>
  config: RunExecutionConfig
  telemetry?: AgentRunTelemetryCollector
}

export type IdeAppendActivityInput = {
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

export type EngineHostOps = {
  store: IdeAgentStore
  attachmentStore?: IdeAttachmentStore | null
  aiClient: IdeAiClient
  chunkDelayMs?: number
  emit: (event: IdeAgentStreamEvent) => void
  saveAndPublish: (
    conversation: IdeConversation,
    settings?: ConversationExecutionSettings
  ) => IdeConversation
  requireConversation: (conversationId: string) => IdeConversation
  setRunStatus: (
    conversation: IdeConversation,
    runId: string | null,
    status: IdeConversation['status'],
    detail?: string
  ) => void
  appendActivity: (
    conversation: IdeConversation,
    params: IdeAppendActivityInput
  ) => IdeActivityEvent
  requestExplicitPermission: (
    conversation: IdeConversation,
    run: ActiveRunControl,
    params: {
      kind: IdeSensitiveActionKind
      title: string
      detail: string
      targetPath?: string
      command?: string
    }
  ) => Promise<boolean>
  waitIfPausedOrAborted: (conversation: IdeConversation, run: ActiveRunControl) => Promise<boolean>
}

export function pickExecutionSettings(conv: IdeConversation): ConversationExecutionSettings {
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

export function createActivityEventRecord(params: {
  seq: number
  conversationId: string
  runId: string
  role: IdeAgentRole
  type: IdeActivityEventType
  summary: string
  detail?: string
  relativePath?: string
  command?: string
  status?: IdeActivityEvent['status']
  expandablePayload?: Record<string, unknown>
}): IdeActivityEvent {
  return {
    id: randomUUID(),
    seq: params.seq,
    conversationId: params.conversationId,
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
}

export async function waitUntilRunResumedOrAborted(
  conversation: IdeConversation,
  run: ActiveRunControl,
  setPaused: (conv: IdeConversation, runId: string) => void
): Promise<boolean> {
  if (run.abortController.signal.aborted) {
    return false
  }
  while (run.paused && !run.abortController.signal.aborted) {
    setPaused(conversation, run.runId)
    await new Promise<void>((resolve) => {
      const finish = (): void => resolve()
      run.resumeResolvers.push(finish)
      run.abortController.signal.addEventListener('abort', finish, { once: true })
    })
  }
  return !run.abortController.signal.aborted
}

export type IdeCreateConversationInput = {
  workspaceKey: string
  workspacePath: string
  title?: string
  mode?: IdeExecutionMode
  agentId?: string
  modelId?: string
  multiAgentEnabled?: boolean
  followAgent?: boolean
  liveEditSpeed?: IdeLiveEditSpeed
}

export type IdeUpdateSettingsInput = {
  conversationId: string
  title?: string
  mode?: IdeExecutionMode
  agentId?: string
  modelId?: string
  multiAgentEnabled?: boolean
  followAgent?: boolean
  liveEditSpeed?: IdeLiveEditSpeed
}

export type IdeSendPromptInput = {
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
  openFilePaths?: string[]
  dirtyRelativePaths?: string[]
  reuseLastUserMessage?: boolean
}

export type IdePlanDecisionInput = {
  conversationId: string
  planId: string
  worktreeSelector?: string
  decision: 'approve' | 'reject' | 'revise'
  revisionNote?: string
  agentId?: string
  modelId?: string
  dirtyRelativePaths?: string[]
}

export type IdeManualCommandInput = {
  conversationId: string
  worktreeSelector: string
  command: string
  category?: IdeCommandCategory
  permissionApproved?: boolean
}

export type IdeManualCommandResult = {
  needsPermission?: IdePermissionRequest
  execution?: IdeCommandExecutionRecord
  conversation: IdeConversation
}

export type IdePermissionDecisionInput = {
  conversationId: string
  permissionId: string
  decision: 'approve' | 'deny'
  note?: string
}

export type IdeRunControlInput = {
  conversationId: string
  runId?: string
  action: 'pause' | 'resume' | 'stop' | 'retry'
  worktreeSelector?: string
  dirtyRelativePaths?: string[]
}

export type IdeChangeDecisionInput = {
  conversationId: string
  worktreeSelector?: string
  action: 'accept' | 'reject' | 'restore_checkpoint'
  changeId?: string
  checkpointId?: string
  dirtyRelativePaths?: string[]
}

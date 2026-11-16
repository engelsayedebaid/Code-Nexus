import type { IdeContextBudgetSummary } from './ide-agent-events'
import type { PastedContentFormat } from '../smart-paste/smart-paste-config'

export type IdeExecutionMode = 'ask' | 'plan' | 'agent' | 'review'

export type IdeLiveEditSpeed = 'natural' | 'fast' | 'instant'

export type IdeRightSidebarView =
  | 'ai-chat'
  | 'ai-activity'
  | 'task-plan'
  | 'simple-todo'
  | 'code-changes'
  | 'execution-history'

export type IdeAgentRole = 'orchestrator' | 'planner' | 'coder' | 'reviewer' | 'test-fixer'

export type IdePlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'executing'
  | 'completed'
  | 'failed'

export type IdePlanFileAction = {
  path: string
  action: 'create' | 'modify' | 'delete' | 'mkdir' | 'rename' | 'delete_folder'
  fromPath?: string
  summary: string
}

export type IdePlanStep = {
  id: string
  index: number
  title: string
  detail: string
  targetFiles: string[]
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked'
}

export type IdePlanApprovalRecord = {
  planId: string
  planVersion: number
  planHash: string
  decision: 'approved' | 'rejected' | 'revision_requested'
  decidedAt: number
  modelId?: string
  agentId?: string
  note?: string
}

export type IdeTaskPlan = {
  id: string
  conversationId: string
  version: number
  planHash: string
  intro?: string
  objective: string
  requestSummary: string
  affectedFiles: IdePlanFileAction[]
  steps: IdePlanStep[]
  risks: string[]
  testsAndVerification: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
  status: IdePlanStatus
  createdAt: number
  updatedAt: number
  approvalRecord: IdePlanApprovalRecord | null
  revisionNotes: string[]
}

export type IdeSensitiveActionKind =
  | 'delete_important_file'
  | 'modify_secrets'
  | 'send_secret_context'
  | 'install_software'
  | 'destructive_command'
  | 'git_push'
  | 'deploy_application'
  | 'production_config'
  | 'out_of_scope_file'

export type IdePermissionRequest = {
  id: string
  conversationId: string
  runId: string
  kind: IdeSensitiveActionKind
  title: string
  detail: string
  targetPath?: string
  command?: string
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  resolvedAt?: number
  note?: string
}

export type IdeCheckpointFileEntry = {
  relativePath: string
  existedBefore: boolean
  beforeContent: string | null
  afterContent: string | null
  status: 'pending' | 'accepted' | 'reverted' | 'conflict'
}

export type IdeCheckpoint = {
  id: string
  conversationId: string
  runId: string
  label: string
  createdAt: number
  files: IdeCheckpointFileEntry[]
}

export type IdeFileChangeRecord = {
  id: string
  conversationId: string
  runId: string
  checkpointId: string
  relativePath: string
  changeType: 'created' | 'modified' | 'deleted'
  existedBefore: boolean
  beforeContent: string | null
  afterContent: string | null
  chunksApplied: number
  totalChunks: number
  updatedAt: number
  acceptedState: 'pending' | 'accepted' | 'reverted' | 'conflict'
  conflictMessage?: string
}

export type IdeCommandCategory = 'test' | 'typecheck' | 'lint' | 'build' | 'custom'

export type IdeCommandExecutionRecord = {
  id: string
  conversationId: string
  runId: string
  command: string
  cwd: string
  category: IdeCommandCategory
  status: 'running' | 'passed' | 'failed' | 'canceled' | 'denied'
  exitCode: number | null
  stdoutTail: string
  stderrTail: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
}

export type IdeActivityEventType =
  | 'analysis.started'
  | 'analysis.file_read'
  | 'analysis.completed'
  | 'tool.search'
  | 'tool.symbol_lookup'
  | 'diagnostics.checked'
  | 'plan.generated'
  | 'plan.approved'
  | 'plan.rejected'
  | 'plan.revision_requested'
  | 'permission.requested'
  | 'permission.resolved'
  | 'agent.role_started'
  | 'agent.role_completed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'editor.file_opened'
  | 'editor.edit_chunk'
  | 'live_edit.started'
  | 'live_edit.completed'
  | 'folder.created'
  | 'folder.deleted'
  | 'file.created'
  | 'file.modified'
  | 'file.renamed'
  | 'file.deleted'
  | 'file.conflict'
  | 'checkpoint.created'
  | 'checkpoint.restored'
  | 'command.started'
  | 'command.finished'
  | 'run.paused'
  | 'run.resumed'
  | 'run.canceled'
  | 'run.failed'
  | 'run.completed'

export type IdeActivityEvent = {
  id: string
  seq: number
  conversationId: string
  runId: string
  timestamp: number
  role: IdeAgentRole
  type: IdeActivityEventType
  summary: string
  detail?: string
  relativePath?: string
  command?: string
  status: 'info' | 'running' | 'completed' | 'warning' | 'error'
  expandablePayload?: Record<string, unknown>
}

export type IdeChatAttachment = {
  id: string
  kind: 'file' | 'folder' | 'symbol' | 'selection' | 'image' | 'workspace-context' | 'pasted_text'
  name: string
  relativePath?: string
  symbolName?: string
  mimeType?: string
  sizeBytes?: number
  lineCount?: number
  charCount?: number
  format?: PastedContentFormat
  createdAt?: number
  status?: 'ready' | 'missing' | 'error'
  truncatedInPrompt?: boolean
  dataUrl?: string
  previewText?: string
  lineRange?: { start: number; end: number }
  sensitiveWarning?: boolean
}

export type IdeChatMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  mode: IdeExecutionMode
  text: string
  createdAt: number
  updatedAt: number
  streaming?: boolean
  agentId?: string
  modelId?: string
  teamMode?: boolean
  attachments?: IdeChatAttachment[]
  planId?: string
  runId?: string
  modifiedFiles?: string[]
  commandIds?: string[]
  error?: string
}

export type IdeRunStatus =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_permission'
  | 'executing'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceled'

export type IdeConversation = {
  id: string
  workspaceKey: string
  workspacePath: string
  title: string
  mode: IdeExecutionMode
  agentId: string
  modelId: string
  multiAgentEnabled: boolean
  followAgent: boolean
  liveEditSpeed?: IdeLiveEditSpeed
  activePlanId: string | null
  activeRunId: string | null
  status: IdeRunStatus
  createdAt: number
  updatedAt: number
  messages: IdeChatMessage[]
  plans: IdeTaskPlan[]
  activity: IdeActivityEvent[]
  fileChanges: IdeFileChangeRecord[]
  checkpoints: IdeCheckpoint[]
  commandExecutions: IdeCommandExecutionRecord[]
  pendingPermissions: IdePermissionRequest[]
  contextBudget?: IdeContextBudgetSummary
}

export type IdeConversationSummary = {
  id: string
  workspaceKey: string
  title: string
  mode: IdeExecutionMode
  agentId: string
  modelId: string
  status: IdeRunStatus
  messageCount: number
  updatedAt: number
  createdAt: number
}

export type IdeTodoItem = {
  id: string
  workspaceKey: string
  text: string
  done: boolean
  linkedPlanId?: string
  linkedStepId?: string
  createdAt: number
  updatedAt: number
}

export type {
  IdeContextBudgetSummary,
  IdeProviderModelOption,
  IdeProviderAgentOption,
  IdeEditorHighlightTarget,
  IdeAgentStreamEvent
} from './ide-agent-events'

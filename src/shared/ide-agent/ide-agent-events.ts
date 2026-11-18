import type {
  IdeActivityEvent,
  IdeChatMessage,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeLiveEditSpeed,
  IdePermissionRequest,
  IdeRunStatus,
  IdeTaskPlan
} from './ide-agent-types'

export type IdeProviderModelOption = {
  id: string
  label: string
  isDefault?: boolean
  contextWindowTokens?: number
  supportsStreaming?: boolean
  family?: 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'moonshot' | 'generic'
  preferredEditFormat?: 'search_replace' | 'unified_diff' | 'whole_file'
  supportsReasoningEffort?: boolean
  promptDelivery?: 'stdin' | 'argv' | 'file'
}

export type IdeProviderAgentOption = {
  id: string
  label: string
  binary: string
  available: boolean
  defaultModelId: string
  models: IdeProviderModelOption[]
  supportsStreaming?: boolean
  supportsToolLoop?: boolean
  unavailableReason?: string
}

export type IdeContextBudgetSummary = {
  usedChars: number
  estimatedTokens: number
  budgetTokens: number
  isEstimate: boolean
  loadedFiles: number
  deduplicatedReads: number
  stackLabels?: string[]
}

export type IdeRunTelemetrySummary = {
  runId: string
  agentId: string
  modelId: string
  startedAt: number
  finishedAt: number
  durationMs: number
  llmCalls: number
  promptChars: number
  completionChars: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  toolCalls: number
  blockedToolCalls: number
  failedEdits: number
  recoveredErrors: number
  subagentRuns: number
  compactedMessages: number
  verificationChecksRun: number
  verificationChecksPassed: number
}

export type IdeEditorHighlightTarget = {
  worktreeId?: string
  relativePath: string
  startLine: number
  endLine: number
  cursorLine?: number
  cursorColumn?: number
  label: string
  status?: 'streaming' | 'revealing' | 'committed' | 'navigation'
  progressPercent?: number
  updatedAt: number
}

export type IdeAgentStreamEvent =
  | { type: 'conversation_updated'; conversation: IdeConversation }
  | { type: 'message_delta'; conversationId: string; messageId: string; text: string }
  | { type: 'message_complete'; conversationId: string; message: IdeChatMessage }
  | { type: 'activity'; conversationId: string; event: IdeActivityEvent }
  | { type: 'plan_proposed'; conversationId: string; plan: IdeTaskPlan }
  | { type: 'permission_requested'; conversationId: string; permission: IdePermissionRequest }
  | {
      type: 'editor_file_opened'
      conversationId: string
      runId: string
      relativePath: string
      reason: string
    }
  | {
      type: 'editor_edit_chunk'
      conversationId: string
      runId: string
      relativePath: string
      startLine: number
      endLine: number
      chunkIndex: number
      totalChunks: number
      label: string
      beforeContent?: string | null
      afterContent?: string
      speed?: IdeLiveEditSpeed
      sourceKind?: 'streamed' | 'patch_preview'
    }
  | {
      type: 'file_created' | 'file_modified' | 'file_deleted' | 'folder_created' | 'folder_deleted'
      conversationId: string
      runId: string
      relativePath: string
    }
  | {
      type: 'file_renamed'
      conversationId: string
      runId: string
      fromRelativePath: string
      relativePath: string
    }
  | {
      type: 'command_output'
      conversationId: string
      commandId: string
      stream: 'stdout' | 'stderr'
      chunk: string
    }
  | {
      type: 'command_done'
      conversationId: string
      execution: IdeCommandExecutionRecord
    }
  | {
      type: 'run_status'
      conversationId: string
      runId: string | null
      status: IdeRunStatus
      detail?: string
    }

import * as z from 'zod'
import { SMART_PASTE_CONFIG } from '../smart-paste/smart-paste-config'

export const IDE_EXECUTION_MODES = ['ask', 'plan', 'agent', 'review'] as const
export const IDE_RIGHT_SIDEBAR_VIEWS = [
  'ai-chat',
  'ai-activity',
  'task-plan',
  'simple-todo',
  'code-changes',
  'execution-history'
] as const

export const IdeExecutionModeSchema = z.enum(IDE_EXECUTION_MODES)

export const IdeChatAttachmentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: z.enum([
    'file',
    'folder',
    'symbol',
    'selection',
    'image',
    'workspace-context',
    'pasted_text'
  ]),
  name: z.string().min(1).max(512),
  relativePath: z.string().max(4096).optional(),
  symbolName: z.string().max(256).optional(),
  mimeType: z.string().max(128).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  charCount: z.number().int().nonnegative().optional(),
  format: z
    .enum(['typescript', 'json', 'sql', 'markdown', 'yaml', 'diff', 'log', 'code', 'text'])
    .optional(),
  createdAt: z.number().nonnegative().optional(),
  status: z.enum(['ready', 'missing', 'error']).optional(),
  truncatedInPrompt: z.boolean().optional(),
  dataUrl: z
    .string()
    .max(8 * 1024 * 1024)
    .optional(),
  previewText: z
    .string()
    .max(256 * 1024)
    .optional(),
  lineRange: z
    .strictObject({
      start: z.number().int().min(1),
      end: z.number().int().min(1)
    })
    .optional(),
  sensitiveWarning: z.boolean().optional()
})

export const IdeAgentSavePastedAttachmentParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  attachmentId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{4,128}$/)
    .optional(),
  displayName: z.string().min(1).max(256).optional(),
  content: z.string().min(1).max(SMART_PASTE_CONFIG.maxAttachmentBytes),
  mimeType: z.string().max(128).optional()
})

export const IdeAgentReadAttachmentContentParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  attachmentId: z.string().regex(/^[A-Za-z0-9_-]{4,128}$/),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).max(2_000_000).optional(),
  maxChars: z
    .number()
    .int()
    .min(256)
    .max(512 * 1024)
    .optional()
})

export const IdeAgentEmptyParams = z.strictObject({})

export const IdeAgentProvidersParams = z.strictObject({
  worktreeSelector: z.string().min(1).max(4096).optional()
})

export const IdeAgentListConversationsParams = z.strictObject({
  workspaceKey: z.string().min(1).max(4096)
})

export const IdeAgentGetConversationParams = z.strictObject({
  conversationId: z.string().min(1).max(256)
})

export const IdeAgentCreateConversationParams = z.strictObject({
  workspaceKey: z.string().min(1).max(4096),
  workspacePath: z.string().min(1).max(4096),
  title: z.string().min(1).max(256).optional(),
  mode: IdeExecutionModeSchema.optional(),
  agentId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(512).optional(),
  multiAgentEnabled: z.boolean().optional(),
  followAgent: z.boolean().optional(),
  liveEditSpeed: z.enum(['natural', 'fast', 'instant']).optional()
})

export const IdeAgentUpdateConversationParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  title: z.string().min(1).max(256).optional(),
  mode: IdeExecutionModeSchema.optional(),
  agentId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(512).optional(),
  multiAgentEnabled: z.boolean().optional(),
  followAgent: z.boolean().optional(),
  liveEditSpeed: z.enum(['natural', 'fast', 'instant']).optional()
})

export const IdeAgentDeleteConversationParams = z.strictObject({
  conversationId: z.string().min(1).max(256)
})

export const IdeAgentSendPromptParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  worktreeSelector: z.string().min(1).max(4096),
  text: z
    .string()
    .min(1)
    .max(128 * 1024),
  mode: IdeExecutionModeSchema,
  agentId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(512).optional(),
  multiAgentEnabled: z.boolean().optional(),
  followAgent: z.boolean().optional(),
  liveEditSpeed: z.enum(['natural', 'fast', 'instant']).optional(),
  attachments: z.array(IdeChatAttachmentSchema).max(24).optional(),
  activeFilePath: z.string().max(4096).optional(),
  dirtyRelativePaths: z.array(z.string().max(4096)).max(256).optional()
})

export const IdeAgentPlanDecisionParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  planId: z.string().min(1).max(256),
  worktreeSelector: z.string().min(1).max(4096).optional(),
  decision: z.enum(['approve', 'reject', 'revise']),
  revisionNote: z
    .string()
    .max(16 * 1024)
    .optional(),
  agentId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(512).optional(),
  dirtyRelativePaths: z.array(z.string().max(4096)).max(256).optional()
})

export const IdeAgentPermissionDecisionParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  permissionId: z.string().min(1).max(256),
  decision: z.enum(['approve', 'deny']),
  note: z.string().max(2048).optional()
})

export const IdeAgentRunControlParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  worktreeSelector: z.string().min(1).max(4096).optional(),
  action: z.enum(['pause', 'resume', 'stop', 'retry']),
  dirtyRelativePaths: z.array(z.string().max(4096)).max(256).optional()
})

export const IdeAgentChangeDecisionParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  worktreeSelector: z.string().min(1).max(4096).optional(),
  action: z.enum(['accept', 'reject', 'restore_checkpoint']),
  changeId: z.string().min(1).max(256).optional(),
  checkpointId: z.string().min(1).max(256).optional(),
  dirtyRelativePaths: z.array(z.string().max(4096)).max(256).optional()
})

export const IdeAgentRunCommandParams = z.strictObject({
  conversationId: z.string().min(1).max(256),
  worktreeSelector: z.string().min(1).max(4096),
  command: z.string().min(1).max(4096),
  category: z.enum(['test', 'typecheck', 'lint', 'build', 'custom']).optional(),
  permissionApproved: z.boolean().optional()
})

export const IdeAgentSubscribeEventsParams = z.strictObject({
  conversationId: z.string().min(1).max(256).optional()
})

export const IdeTodoItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  workspaceKey: z.string().min(1).max(4096),
  text: z.string().min(1).max(2048),
  done: z.boolean(),
  linkedPlanId: z.string().max(128).optional(),
  linkedStepId: z.string().max(128).optional(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const IdeAgentTodosListParams = z.strictObject({
  workspaceKey: z.string().min(1).max(4096)
})

export const IdeAgentTodosSaveParams = z.strictObject({
  workspaceKey: z.string().min(1).max(4096),
  items: z.array(IdeTodoItemSchema).max(500)
})

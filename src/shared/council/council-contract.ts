import * as z from 'zod'

export const CouncilEmptyParams = z.strictObject({})

export const CouncilAgentParams = z.strictObject({
  worktree: z.string().min(1).max(4096),
  agent: z.string().min(1).max(128)
})

export const CouncilGenerateParams = CouncilAgentParams.extend({
  operationId: z.string().uuid(),
  model: z.string().min(1).max(512),
  thinkingLevel: z.string().min(1).max(128).optional(),
  prompt: z
    .string()
    .min(1)
    .max(256 * 1024)
}).strict()

export const CouncilCancelParams = z.strictObject({ operationId: z.string().uuid() })

export const COUNCIL_MODES = ['parallel', 'debate', 'code-review', 'consensus'] as const
export type CouncilMode = (typeof COUNCIL_MODES)[number]

export const COUNCIL_ROLES = [
  'Software Architect',
  'Backend Engineer',
  'Frontend Engineer',
  'Security Engineer',
  'Performance Engineer',
  'QA Engineer',
  'Moderator'
] as const

export type CouncilParticipant = {
  id: string
  agent: string
  label: string
  model: string
  modelLabel: string
  thinkingLevel?: string
  role: string
  moderator: boolean
}

export type CouncilMessageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type CouncilMessage = {
  id: string
  participantId?: string
  participantLabel: string
  provider?: string
  model?: string
  role: string
  round: number
  createdAt: number
  status: CouncilMessageStatus
  kind: 'user' | 'response' | 'system' | 'decision'
  content: string
  error?: string
  /** Who this turn answers, for inline reply attribution in a chat transcript. */
  replyToLabel?: string
  /** Target message ID when replying to a specific message in the group thread. */
  replyToMessageId?: string
}

export type CouncilRunStatus = 'draft' | 'running' | 'paused' | 'stopped' | 'completed'

export type CouncilSession = {
  id: string
  workspaceId: string
  title: string
  prompt: string
  mode: CouncilMode
  maxRounds: number
  participants: CouncilParticipant[]
  messages: CouncilMessage[]
  status: CouncilRunStatus
  currentRound: number
  createdAt: number
  updatedAt: number
  finalDecision?: string
  queuedUserMessages: string[]
  /** Normal-chat scope when this run lives inline in a chat instead of the Council workspace. */
  chatId?: string
  surface?: 'council' | 'chat'
  /** Earlier single-model transcript shared with the group on its first turn (text only). */
  contextNote?: string
}

export type CouncilAgentAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown' | 'unavailable'

export type CouncilAgentCatalog = {
  id: string
  label: string
  defaultModelId: string
  models: CouncilModelCatalog[]
  modelSource: 'static' | 'dynamic'
  available?: boolean
  availabilityNote?: string
  authStatus?: CouncilAgentAuthStatus
  authNote?: string
  supportsStreaming?: boolean
  supportsMultipleModels?: boolean
}

export type CouncilModelCatalog = {
  id: string
  label: string
  description?: string
  thinkingLevels?: { id: string; label: string }[]
  defaultThinkingLevel?: string
}

export type CouncilModelsResult =
  | {
      success: true
      agent: CouncilAgentCatalog
      catalogOrigin: 'probe' | 'spec'
    }
  | { success: false; error: string }

export type CouncilGenerationResult =
  | { success: true; content: string; agentLabel?: string }
  | { success: false; error: string; cancelled?: boolean }

export type CouncilStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; result: CouncilGenerationResult }

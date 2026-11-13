import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import {
  COUNCIL_ROLES,
  type CouncilAgentCatalog,
  type CouncilGenerationResult,
  type CouncilMessage,
  type CouncilMode,
  type CouncilParticipant
} from '../../../../shared/council/council-contract'
import {
  buildCouncilDecisionPrompt,
  buildCouncilTurnPrompt,
  messageTargetsParticipant
} from './council-prompts'

export const MAX_CONCURRENT_COUNCIL_TURNS = 3

export const MODE_LABELS: Record<CouncilMode, string> = {
  parallel: 'Parallel',
  debate: 'Debate',
  'code-review': 'Code Review',
  consensus: 'Consensus'
}

export const MODE_DESCRIPTIONS: Record<CouncilMode, string> = {
  parallel: 'Independent answers in one round',
  debate: 'Peer critique and refinement',
  'code-review': 'Evidence-led technical review',
  consensus: 'Multi-round synthesis and decision'
}

export function createCouncilUuid(): string {
  return createNonSecureContextUuid()
}

export function defaultRounds(mode: CouncilMode): number {
  return mode === 'parallel' ? 1 : mode === 'consensus' ? 3 : 2
}

export function selectRoundParticipants(
  participants: readonly CouncilParticipant[],
  queuedMessages: readonly string[]
): CouncilParticipant[] {
  if (queuedMessages.length === 0) {
    return [...participants]
  }
  const targeted = participants.filter((participant) =>
    queuedMessages.some((message) => messageTargetsParticipant(message, participant))
  )
  return targeted.length > 0 ? targeted : [...participants]
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index], index)
      }
    })
  )
  return results
}

export function createDefaultCouncilParticipants(
  agents: CouncilAgentCatalog[]
): CouncilParticipant[] {
  const preferred = [...agents].sort(
    (left, right) => Number(right.available !== false) - Number(left.available !== false)
  )
  return preferred.slice(0, Math.min(3, preferred.length)).map((agent, index) => {
    const model =
      agent.models.find((candidate) => candidate.id === agent.defaultModelId) ?? agent.models[0]
    return {
      id: createCouncilUuid(),
      agent: agent.id,
      label: agent.label,
      model: model?.id ?? agent.defaultModelId,
      modelLabel: model?.label ?? agent.defaultModelId,
      thinkingLevel: model?.defaultThinkingLevel,
      role: COUNCIL_ROLES[index] ?? 'Software Architect',
      moderator: index === 0
    }
  })
}

export function createPendingRoundMessages(
  participants: readonly CouncilParticipant[],
  round: number,
  replyToFor?: (
    participant: CouncilParticipant
  ) => string | { label: string; messageId?: string } | undefined
): CouncilMessage[] {
  return participants.map((participant) => {
    const replyTarget = replyToFor?.(participant)
    const replyToLabel = typeof replyTarget === 'string' ? replyTarget : replyTarget?.label
    const replyToMessageId = typeof replyTarget === 'string' ? undefined : replyTarget?.messageId
    return {
      id: createCouncilUuid(),
      participantId: participant.id,
      participantLabel: participant.label,
      provider: participant.agent,
      model: participant.modelLabel,
      role: participant.role,
      round,
      createdAt: Date.now(),
      status: 'processing',
      kind: 'response',
      content: '',
      ...(replyToLabel ? { replyToLabel } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {})
    }
  })
}

export function createPendingDecisionMessage(
  moderator: CouncilParticipant,
  round: number
): CouncilMessage {
  return {
    id: createCouncilUuid(),
    participantId: moderator.id,
    participantLabel: 'Council Decision',
    provider: moderator.agent,
    model: moderator.modelLabel,
    role: 'Moderator',
    round,
    createdAt: Date.now(),
    status: 'processing',
    kind: 'decision',
    content: ''
  }
}

export function applyCouncilGenerationResult(
  baseMessage: CouncilMessage,
  result: CouncilGenerationResult
): CouncilMessage {
  return {
    ...baseMessage,
    status: result.success ? 'completed' : result.cancelled ? 'cancelled' : 'failed',
    content: result.success ? result.content : result.cancelled ? baseMessage.content : '',
    ...(!result.success ? { error: result.error } : {})
  }
}

export function appendCouncilParticipant(
  current: readonly CouncilParticipant[],
  agents: readonly CouncilAgentCatalog[]
): CouncilParticipant[] {
  const agent = agents[current.length % Math.max(agents.length, 1)]
  if (!agent) {
    return [...current]
  }
  const model = agent.models[0]
  return [
    ...current,
    {
      id: createCouncilUuid(),
      agent: agent.id,
      label: agent.label,
      model: model?.id ?? agent.defaultModelId,
      modelLabel: model?.label ?? agent.defaultModelId,
      thinkingLevel: model?.defaultThinkingLevel,
      role: COUNCIL_ROLES[current.length % (COUNCIL_ROLES.length - 1)],
      moderator: false
    }
  ]
}

export function removeCouncilParticipant(
  current: readonly CouncilParticipant[],
  id: string
): CouncilParticipant[] {
  const next = current.filter((participant) => participant.id !== id)
  if (next.length > 0 && !next.some((participant) => participant.moderator)) {
    next[0] = { ...next[0], moderator: true }
  }
  return next
}

export function createUserInterventionMessage(
  round: number,
  content: string,
  replyTo?: { messageId?: string; label?: string }
): CouncilMessage {
  return {
    id: createCouncilUuid(),
    participantLabel: 'You',
    role: 'User intervention',
    round,
    createdAt: Date.now(),
    status: 'completed',
    kind: 'user',
    content,
    ...(replyTo?.label ? { replyToLabel: replyTo.label } : {}),
    ...(replyTo?.messageId ? { replyToMessageId: replyTo.messageId } : {})
  }
}

export function buildRetryTurnPrompt(input: {
  originalPrompt: string
  mode: CouncilMode
  failedMessage: CouncilMessage
  participant: CouncilParticipant
  messages: readonly CouncilMessage[]
  participants?: readonly CouncilParticipant[]
}): string {
  const { originalPrompt, mode, failedMessage, participant, messages, participants } = input
  if (failedMessage.kind === 'decision') {
    return buildCouncilDecisionPrompt({
      originalPrompt,
      mode,
      messages: messages.filter(
        (candidate) => candidate.status === 'completed' && candidate.id !== failedMessage.id
      )
    })
  }
  const hasPriorPeers = messages.some(
    (candidate) =>
      candidate.status === 'completed' &&
      candidate.kind === 'response' &&
      candidate.id !== failedMessage.id &&
      (candidate.round < failedMessage.round || candidate.createdAt < failedMessage.createdAt)
  )
  return buildCouncilTurnPrompt({
    originalPrompt,
    mode,
    round: failedMessage.round,
    participant,
    participants,
    replyToLabel: failedMessage.replyToLabel,
    isOpeningRound: failedMessage.round === 1 && !hasPriorPeers,
    messages: messages.filter(
      (candidate) =>
        candidate.status === 'completed' &&
        candidate.id !== failedMessage.id &&
        (candidate.round < failedMessage.round || candidate.createdAt < failedMessage.createdAt)
    ),
    queuedUserMessages: []
  })
}

export async function waitWhilePaused(
  isPaused: () => boolean,
  isStopped: () => boolean
): Promise<void> {
  while (isPaused() && !isStopped()) {
    await new Promise((resolve) => window.setTimeout(resolve, 200))
  }
}

export function createRetryProcessingMessage(failedMessage: CouncilMessage): CouncilMessage {
  return {
    ...failedMessage,
    status: 'processing',
    content: '',
    error: undefined
  }
}

export function markSessionMessagesStopped(messages: readonly CouncilMessage[]): CouncilMessage[] {
  return messages.map((message) =>
    message.status === 'processing'
      ? { ...message, status: 'cancelled', error: 'Stopped by user' }
      : message
  )
}

export {
  cancelCouncilGenerateRpcs,
  formatCouncilError,
  runCouncilGenerateRpc
} from './council-generate-rpc'

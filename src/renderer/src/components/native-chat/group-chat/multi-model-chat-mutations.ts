import type {
  CouncilAgentCatalog,
  CouncilMode,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import { createCouncilUuid } from '../../council/council-session-execution'
import {
  MAX_GROUP_PARTICIPANTS,
  MIN_GROUP_PARTICIPANTS,
  participantFromCatalog,
  roundsForDiscussion
} from './multi-model-chat-state'

export function toggleAgentModelFromCatalog(
  participants: readonly CouncilParticipant[],
  agent: CouncilAgentCatalog,
  modelId: string
): CouncilParticipant[] {
  const exactIndex = participants.findIndex(
    (participant) => participant.agent === agent.id && participant.model === modelId
  )
  if (exactIndex !== -1) {
    const next = participants.filter((_, position) => position !== exactIndex)
    if (next.length > 0 && !next.some((participant) => participant.moderator)) {
      next[0] = { ...next[0]!, moderator: true }
    }
    return next
  }
  if (agent.supportsMultipleModels === false) {
    const existing = participants.find((participant) => participant.agent === agent.id)
    if (existing) {
      return chooseParticipantModel(participants, existing.id, agent, modelId)
    }
  }
  if (participants.length >= MAX_GROUP_PARTICIPANTS) {
    return [...participants]
  }
  const added = participantFromCatalog(
    agent,
    modelId,
    participants.length,
    participants.map((candidate) => candidate.role)
  )
  return [
    ...participants,
    {
      ...added,
      moderator: participants.length === 0 || !participants.some((candidate) => candidate.moderator)
    }
  ]
}

export function updateGroupParticipant(
  participants: readonly CouncilParticipant[],
  participantId: string,
  patch: Partial<CouncilParticipant>
): CouncilParticipant[] {
  return participants.map((participant) =>
    participant.id === participantId ? { ...participant, ...patch } : participant
  )
}

export function chooseParticipantModel(
  participants: readonly CouncilParticipant[],
  participantId: string,
  agent: CouncilAgentCatalog,
  modelId: string
): CouncilParticipant[] {
  const model = agent.models.find((candidate) => candidate.id === modelId) ?? agent.models[0]
  if (!model) {
    return [...participants]
  }
  return updateGroupParticipant(participants, participantId, {
    model: model.id,
    modelLabel: model.label,
    thinkingLevel: model.defaultThinkingLevel
  })
}

export function makeParticipantModerator(
  participants: readonly CouncilParticipant[],
  participantId: string
): CouncilParticipant[] {
  return participants.map((participant) => ({
    ...participant,
    moderator: participant.id === participantId
  }))
}

/** Null when the group can run; otherwise a truthful reason the user can act on. */
export function validateGroupParticipants(
  participants: readonly CouncilParticipant[],
  agents: readonly CouncilAgentCatalog[]
): string | null {
  if (participants.length < MIN_GROUP_PARTICIPANTS) {
    return `Select at least ${MIN_GROUP_PARTICIPANTS} models to start a multi-model discussion.`
  }
  for (const participant of participants) {
    const agent = agents.find((candidate) => candidate.id === participant.agent)
    if (!agent) {
      return `${participant.label} is not installed on this host.`
    }
    if (agent.available === false) {
      return agent.availabilityNote ?? `${participant.label} is not available on this host.`
    }
    if (!participant.model.trim()) {
      return `${participant.label} has no model selected.`
    }
  }
  return null
}

export function groupChatTitle(prompt: string): string {
  const title = prompt.trim().split(/\s+/).slice(0, 8).join(' ')
  return title.length > 0 ? title : 'Multi-model chat'
}

export function newGroupSession(input: {
  chatId: string
  worktreePath: string
  participants: readonly CouncilParticipant[]
  mode: CouncilMode
  maxRounds: number
  contextNote?: string
}): CouncilSession {
  const now = Date.now()
  return {
    id: createCouncilUuid(),
    chatId: input.chatId,
    surface: 'chat',
    workspaceId: input.worktreePath,
    title: 'Multi-model chat',
    prompt: '',
    mode: input.mode,
    maxRounds: roundsForDiscussion(input.mode, input.maxRounds),
    participants: [...input.participants],
    messages: [],
    status: 'draft',
    currentRound: 0,
    createdAt: now,
    updatedAt: now,
    queuedUserMessages: [],
    ...(input.contextNote ? { contextNote: input.contextNote } : {})
  }
}

/** After a model probe, keep each participant's own model when it still exists. */
export function keepProbedSelection(
  participants: readonly CouncilParticipant[],
  agent: CouncilAgentCatalog
): CouncilParticipant[] {
  return participants.map((participant) => {
    if (participant.agent !== agent.id) {
      return participant
    }
    const model =
      agent.models.find((candidate) => candidate.id === participant.model) ?? agent.models[0]
    return model
      ? {
          ...participant,
          model: model.id,
          modelLabel: model.label,
          thinkingLevel: model.defaultThinkingLevel
        }
      : participant
  })
}

const DEFAULT_GROUP_AGENT_ORDER = ['antigravity', 'gemini', 'codex', 'claude', 'opencode']

/** Seeds a new group with up to three usable providers, keeping the moderator first. */
export function defaultGroupParticipants(
  agents: readonly CouncilAgentCatalog[]
): CouncilParticipant[] {
  const usable = agents.filter((agent) => agent.available !== false && agent.models.length > 0)
  const ranked = [...usable].sort((left, right) => {
    const leftIndex = DEFAULT_GROUP_AGENT_ORDER.indexOf(left.id)
    const rightIndex = DEFAULT_GROUP_AGENT_ORDER.indexOf(right.id)
    return (
      (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    )
  })
  return ranked
    .slice(0, Math.min(3, ranked.length))
    .map((agent, index) => participantFromCatalog(agent, agent.defaultModelId, index))
}

/** Toggling one provider keeps each agent's own selected model; a duplicate agent is not added twice. */
export function toggleParticipantFromCatalog(
  participants: readonly CouncilParticipant[],
  agent: CouncilAgentCatalog
): CouncilParticipant[] {
  const index = participants.findIndex((participant) => participant.agent === agent.id)
  if (index === -1) {
    if (participants.length >= MAX_GROUP_PARTICIPANTS) {
      return [...participants]
    }
    return [
      ...participants,
      participantFromCatalog(
        agent,
        undefined,
        participants.length,
        participants.map((candidate) => candidate.role)
      )
    ]
  }
  const next = participants.filter((participant) => participant.agent !== agent.id)
  if (next.length > 0 && !next.some((participant) => participant.moderator)) {
    next[0] = { ...next[0]!, moderator: true }
  }
  return next
}

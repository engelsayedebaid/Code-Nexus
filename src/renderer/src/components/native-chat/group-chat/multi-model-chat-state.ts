import {
  COUNCIL_ROLES,
  type CouncilAgentCatalog,
  type CouncilMode,
  type CouncilParticipant,
  type CouncilSession
} from '../../../../../shared/council/council-contract'
import { createCouncilSessionStorage } from '../../council/council-session-storage'
import { createCouncilUuid, defaultRounds } from '../../council/council-session-execution'

export const MULTI_MODEL_CHAT_CONFIG_KEY = 'code-nexus.multi-model-chat.config.v1'
export const MULTI_MODEL_CHAT_SESSIONS_KEY = 'code-nexus.multi-model-chat.sessions.v1'
export const MAX_GROUP_PARTICIPANTS = 6
export const MIN_GROUP_PARTICIPANTS = 2
export const MIN_GROUP_ROUNDS = 1
export const MAX_GROUP_ROUNDS = 6

export const WORKTREE_REQUIRED =
  'Multi-model chat needs a local workspace or folder. Open this chat in a local workspace to run it.'

export const ATTACHMENTS_UNSUPPORTED =
  'Image attachments are not part of multi-model chat. Remove them to send this message.'

export type MultiModelChatMode = 'single' | 'multi'

export type MultiModelChatConfig = {
  mode: MultiModelChatMode
  discussionMode: CouncilMode
  maxRounds: number
  participants: CouncilParticipant[]
  sharePriorContext?: boolean
}

export const DEFAULT_MULTI_MODEL_CHAT_CONFIG: MultiModelChatConfig = {
  mode: 'single',
  discussionMode: 'debate',
  maxRounds: defaultRounds('debate'),
  participants: [],
  sharePriorContext: true
}

type ConfigMap = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isParticipant(value: unknown): value is CouncilParticipant {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.agent === 'string' &&
    typeof value.model === 'string'
  )
}

/** Older saved entries may miss a label; the roster needs one for every member. */
function completeParticipant(participant: CouncilParticipant): CouncilParticipant {
  return {
    ...participant,
    label: participant.label || participant.agent,
    modelLabel: participant.modelLabel || participant.model,
    role: participant.role || 'Software Architect',
    moderator: participant.moderator ?? false
  }
}

function readConfigMap(): ConfigMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MULTI_MODEL_CHAT_CONFIG_KEY) ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeConfig(value: unknown): MultiModelChatConfig {
  if (!isRecord(value)) {
    return DEFAULT_MULTI_MODEL_CHAT_CONFIG
  }
  const mode = value.mode === 'multi' ? 'multi' : 'single'
  const discussionMode: CouncilMode =
    value.discussionMode === 'parallel' ||
    value.discussionMode === 'code-review' ||
    value.discussionMode === 'consensus' ||
    value.discussionMode === 'debate'
      ? value.discussionMode
      : 'debate'
  const maxRounds =
    typeof value.maxRounds === 'number' ? value.maxRounds : defaultRounds(discussionMode)
  return {
    mode,
    discussionMode,
    maxRounds: clampGroupRounds(maxRounds),
    participants: Array.isArray(value.participants)
      ? value.participants.filter(isParticipant).map(completeParticipant)
      : [],
    sharePriorContext: value.sharePriorContext !== false
  }
}

export function loadMultiModelChatConfig(
  chatId: string,
  fallbackChatId?: string
): MultiModelChatConfig {
  const map = readConfigMap()
  if (map[chatId] !== undefined) {
    return normalizeConfig(map[chatId])
  }
  if (fallbackChatId && map[fallbackChatId] !== undefined) {
    return normalizeConfig(map[fallbackChatId])
  }
  return normalizeConfig(undefined)
}

export function saveMultiModelChatConfig(chatId: string, config: MultiModelChatConfig): void {
  try {
    const map = readConfigMap()
    map[chatId] = config
    localStorage.setItem(MULTI_MODEL_CHAT_CONFIG_KEY, JSON.stringify(map))
  } catch {
    // A full storage quota keeps the in-memory config; only persistence is lost.
  }
}

const chatSessionStorage = createCouncilSessionStorage(MULTI_MODEL_CHAT_SESSIONS_KEY, 50)

export function loadMultiModelChatSession(
  chatId: string,
  fallbackChatId?: string
): CouncilSession | null {
  const sessions = chatSessionStorage.load()
  return (
    sessions.find((session) => session.chatId === chatId || session.id === chatId) ??
    (fallbackChatId
      ? sessions.find(
          (session) => session.chatId === fallbackChatId || session.id === fallbackChatId
        )
      : undefined) ??
    null
  )
}

export function saveMultiModelChatSession(session: CouncilSession): CouncilSession[] {
  return chatSessionStorage.save(session)
}

export const multiModelChatSessionStorage = chatSessionStorage

export function clampGroupRounds(rounds: number): number {
  if (!Number.isFinite(rounds)) {
    return DEFAULT_MULTI_MODEL_CHAT_CONFIG.maxRounds
  }
  return Math.min(MAX_GROUP_ROUNDS, Math.max(MIN_GROUP_ROUNDS, Math.round(rounds)))
}

export function roundsForDiscussion(mode: CouncilMode, rounds: number): number {
  return mode === 'parallel' ? 1 : clampGroupRounds(rounds)
}

export function participantKey(agent: string, model: string): string {
  return `${agent}\u0000${model}`
}

export function participantDisplayName(
  participant: CouncilParticipant,
  participants: readonly CouncilParticipant[]
): string {
  const sameAgent = participants.filter((candidate) => candidate.agent === participant.agent)
  if (sameAgent.length <= 1) {
    return participant.label
  }
  return `${participant.label} · ${participant.modelLabel}`
}

/** Compact pill text: "Gemini + Codex + Claude". */
export function composerParticipantsLabel(participants: readonly CouncilParticipant[]): string {
  if (participants.length === 0) {
    return 'Choose models'
  }
  return participants
    .map((participant) => participantDisplayName(participant, participants))
    .join(' + ')
}

export function formatParticipantMentionToken(
  participant: CouncilParticipant,
  participants: readonly CouncilParticipant[]
): string {
  const name = participantDisplayName(participant, participants).trim()
  return /\s/.test(name) ? `@"${name}"` : `@${name}`
}

export type NativeChatMentionParticipant = {
  id: string
  agent: string
  label: string
  modelLabel: string
  role: string
  mentionToken: string
}

export function matchingGroupMentionParticipants(
  participants: readonly CouncilParticipant[],
  query: string | null
): NativeChatMentionParticipant[] {
  if (query === null) {
    return []
  }
  const lowered = query.trim().toLowerCase()
  return participants
    .filter((participant) => {
      if (!lowered) {
        return true
      }
      const display = participantDisplayName(participant, participants).toLowerCase()
      return (
        display.includes(lowered) ||
        participant.agent.toLowerCase().includes(lowered) ||
        participant.modelLabel.toLowerCase().includes(lowered) ||
        participant.role.toLowerCase().includes(lowered)
      )
    })
    .map((participant) => ({
      id: participant.id,
      agent: participant.agent,
      label: participantDisplayName(participant, participants),
      modelLabel: participant.modelLabel,
      role: participant.role,
      mentionToken: formatParticipantMentionToken(participant, participants)
    }))
}

const CODE_REVIEW_ROLES = [
  'Software Architect',
  'Security Engineer',
  'Performance Engineer',
  'QA Engineer',
  'Backend Engineer',
  'Frontend Engineer'
] as const

export function pickDistinctRole(
  existingRoles: readonly string[],
  mode: CouncilMode = 'debate',
  fallbackIndex = existingRoles.length
): string {
  const palette = mode === 'code-review' ? CODE_REVIEW_ROLES : COUNCIL_ROLES.slice(0, -1)
  const taken = new Set(existingRoles)
  const unused = palette.find((candidate) => !taken.has(candidate))
  return unused ?? palette[fallbackIndex % palette.length] ?? 'Software Architect'
}

export function assignRolesForDiscussionMode(
  participants: readonly CouncilParticipant[],
  mode: CouncilMode
): CouncilParticipant[] {
  const palette = mode === 'code-review' ? CODE_REVIEW_ROLES : COUNCIL_ROLES.slice(0, -1)
  return participants.map((participant, index) => ({
    ...participant,
    role: palette[index % palette.length] ?? participant.role
  }))
}

export function participantFromCatalog(
  agent: CouncilAgentCatalog,
  modelId?: string,
  roleIndex = 0,
  existingRoles?: readonly string[]
): CouncilParticipant {
  const model =
    agent.models.find((candidate) => candidate.id === modelId) ??
    agent.models.find((candidate) => candidate.id === agent.defaultModelId) ??
    agent.models[0]
  return {
    id: createCouncilUuid(),
    agent: agent.id,
    label: agent.label,
    model: model?.id ?? agent.defaultModelId,
    modelLabel: model?.label ?? agent.defaultModelId,
    thinkingLevel: model?.defaultThinkingLevel,
    role: existingRoles
      ? pickDistinctRole(existingRoles, 'debate', roleIndex)
      : (COUNCIL_ROLES[roleIndex % (COUNCIL_ROLES.length - 1)] ?? 'Software Architect'),
    moderator: roleIndex === 0
  }
}

/** Toggling a specific model allows selecting multiple distinct models from one provider when supported. */
export {
  chooseParticipantModel,
  defaultGroupParticipants,
  groupChatTitle,
  keepProbedSelection,
  makeParticipantModerator,
  newGroupSession,
  toggleAgentModelFromCatalog,
  toggleParticipantFromCatalog,
  updateGroupParticipant,
  validateGroupParticipants
} from './multi-model-chat-mutations'

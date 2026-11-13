import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import type {
  CouncilMessage,
  CouncilMode,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import { createCouncilUuid } from '../../council/council-session-execution'
import { buildMultiModelSharedContext } from './multi-model-chat-context'
import { groupChatTitle, newGroupSession, roundsForDiscussion } from './multi-model-chat-state'

export function buildGroupTurnSession(input: {
  existing: CouncilSession | null
  chatId: string
  worktreePath: string
  participants: readonly CouncilParticipant[]
  discussionMode: CouncilMode
  maxRounds: number
  prompt: string
  routedPrompt: string
  replyMeta?: { label: string; messageId?: string }
  sharePriorContext: boolean
  priorMessages: readonly NativeChatMessage[]
}): { next: CouncilSession; startRound: number; endRound: number } {
  const isNewConversation = !input.existing || input.existing.messages.length === 0
  const base =
    input.existing ??
    newGroupSession({
      chatId: input.chatId,
      worktreePath: input.worktreePath,
      participants: input.participants,
      mode: input.discussionMode,
      maxRounds: input.maxRounds
    })
  const startRound = isNewConversation ? 1 : base.currentRound + 1
  const rounds = roundsForDiscussion(input.discussionMode, input.maxRounds)
  const userMessage: CouncilMessage = {
    id: createCouncilUuid(),
    participantLabel: 'You',
    role: 'User',
    round: startRound,
    createdAt: Date.now(),
    status: 'completed',
    kind: 'user',
    content: input.prompt,
    ...(input.replyMeta
      ? { replyToLabel: input.replyMeta.label, replyToMessageId: input.replyMeta.messageId }
      : {})
  }
  const contextNote = isNewConversation
    ? input.sharePriorContext
      ? (buildMultiModelSharedContext(input.priorMessages) ?? undefined)
      : undefined
    : base.contextNote
  const next: CouncilSession = {
    ...base,
    ...(isNewConversation ? { title: groupChatTitle(input.prompt) } : {}),
    prompt: input.routedPrompt,
    mode: input.discussionMode,
    participants: [...input.participants],
    messages: [...base.messages, userMessage],
    status: 'draft',
    queuedUserMessages: [],
    ...(contextNote ? { contextNote } : {})
  }
  return { next, startRound, endRound: startRound + rounds - 1 }
}

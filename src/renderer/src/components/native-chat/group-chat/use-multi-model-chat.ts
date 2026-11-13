import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  CouncilMessage,
  CouncilMode,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { buildGroupTurnSession } from './multi-model-chat-turn-builder'
import { useMultiModelChatControls } from './use-multi-model-chat-controls'
import { useCouncilSessionRunner } from '../../council/useCouncilSessionRunner'
import { messageTargetsParticipant } from '../../council/council-prompts'
import { createUserInterventionMessage } from '../../council/council-session-execution'
import {
  describeMultiModelSharedContext,
  type MultiModelSharedContextSummary
} from './multi-model-chat-context'
import {
  ATTACHMENTS_UNSUPPORTED,
  WORKTREE_REQUIRED,
  formatParticipantMentionToken,
  loadMultiModelChatSession,
  multiModelChatSessionStorage,
  participantDisplayName,
  roundsForDiscussion,
  validateGroupParticipants,
  type MultiModelChatMode
} from './multi-model-chat-state'
import {
  useMultiModelChatSettings,
  type MultiModelChatSettings
} from './use-multi-model-chat-settings'

export type MultiModelReplyTarget = {
  messageId: string
  participantId?: string
  participantLabel: string
  preview: string
}

export type MultiModelChatController = MultiModelChatSettings & {
  chatId: string
  mode: MultiModelChatMode
  discussionMode: CouncilMode
  maxRounds: number
  participants: CouncilParticipant[]
  session: CouncilSession | null
  isRunning: boolean
  isPaused: boolean
  /** A refusal the person can see and dismiss, such as an unsupported attachment. */
  notice: string | null
  dismissNotice: () => void
  /** Prior single-model transcript text ready to be shared on the first group message. */
  sharedContext?: MultiModelSharedContextSummary | null
  replyTo?: MultiModelReplyTarget | null
  setReplyTarget?: (message: CouncilMessage) => void
  clearReplyTarget?: () => void
  /** Returns true when the message was accepted by the group. */
  send: (text: string, attachmentCount?: number) => boolean
  pause: () => void
  resume: () => void
  stop: () => void
  retry: (message: CouncilMessage) => void
  requestDecision: () => void
  continueDiscussion: () => void
}

/** The live group run of one chat tab: queueing, rounds, moderation and restore. */
export function useMultiModelChat(input: {
  chatId: string
  fallbackChatId?: string
  worktreePath: string | null
  messages: readonly NativeChatMessage[]
}): MultiModelChatController {
  const { chatId, fallbackChatId, worktreePath } = input
  const settings = useMultiModelChatSettings(chatId, worktreePath, fallbackChatId)
  const { config, agents } = settings
  const messagesRef = useRef(input.messages)
  messagesRef.current = input.messages

  const [session, setSession] = useState<CouncilSession | null>(() =>
    loadMultiModelChatSession(chatId, fallbackChatId)
  )
  const [sessionChatId, setSessionChatId] = useState(chatId)
  const [, setSavedSessions] = useState<CouncilSession[]>(() => multiModelChatSessionStorage.load())
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<MultiModelReplyTarget | null>(null)

  const { pauseRef, sessionRef, persist, cancelActive, run, requestDecision, retryMessage } =
    useCouncilSessionRunner({
      session,
      setSession,
      setSavedSessions,
      storage: multiModelChatSessionStorage
    })

  // A restored tab owns its own group transcript; reload it when the scope changes.
  if (sessionChatId !== chatId) {
    setSessionChatId(chatId)
    setSession(loadMultiModelChatSession(chatId, fallbackChatId))
    setReplyTo(null)
  }

  // Keep an active session's roster aligned when the user adds, removes, or edits participants mid-chat.
  const prevSettingsScopeRef = useRef({
    chatId,
    participants: config.participants,
    discussionMode: config.discussionMode,
    maxRounds: config.maxRounds
  })
  useEffect(() => {
    const prev = prevSettingsScopeRef.current
    prevSettingsScopeRef.current = {
      chatId,
      participants: config.participants,
      discussionMode: config.discussionMode,
      maxRounds: config.maxRounds
    }
    if (prev.chatId !== chatId) {
      return
    }
    const current = sessionRef.current
    if (!current || current.chatId !== chatId) {
      return
    }
    const unchanged =
      prev.participants === config.participants &&
      prev.discussionMode === config.discussionMode &&
      prev.maxRounds === config.maxRounds
    if (unchanged) {
      return
    }
    persist({
      ...current,
      participants: config.participants,
      mode: config.discussionMode,
      maxRounds: roundsForDiscussion(config.discussionMode, config.maxRounds)
    })
  }, [chatId, config.discussionMode, config.maxRounds, config.participants, persist, sessionRef])

  const sharedContext = useMemo(
    () =>
      !session || session.messages.length === 0
        ? describeMultiModelSharedContext(input.messages)
        : null,
    [input.messages, session]
  )

  const setReplyTarget = useCallback(
    (message: CouncilMessage) => {
      const targetParticipant = message.participantId
        ? config.participants.find((candidate) => candidate.id === message.participantId)
        : undefined
      const label = targetParticipant
        ? participantDisplayName(targetParticipant, config.participants)
        : message.participantLabel
      const excerpt = message.content.replace(/\s+/g, ' ').trim().slice(0, 120)
      setReplyTo({
        messageId: message.id,
        ...(message.participantId ? { participantId: message.participantId } : {}),
        participantLabel: label,
        preview: excerpt
      })
    },
    [config.participants]
  )

  const clearReplyTarget = useCallback(() => {
    setReplyTo(null)
  }, [])

  const { runTurn, ...controls } = useMultiModelChatControls({
    maxRounds: config.maxRounds,
    isRunning,
    setIsRunning,
    setIsPaused,
    pauseRef,
    sessionRef,
    persist,
    run,
    cancelActive,
    retryMessage,
    requestDecision
  })

  const send = useCallback(
    (text: string, attachmentCount = 0): boolean => {
      const prompt = text.trim()
      if (attachmentCount > 0) {
        setNotice(ATTACHMENTS_UNSUPPORTED)
        return false
      }
      if (!prompt) {
        return false
      }
      if (!worktreePath) {
        toast.error(WORKTREE_REQUIRED)
        return false
      }
      const invalid = validateGroupParticipants(config.participants, agents)
      if (invalid) {
        toast.error(invalid)
        return false
      }
      setNotice(null)
      const activeReply = replyTo
      setReplyTo(null)
      const replyParticipant = activeReply?.participantId
        ? config.participants.find((candidate) => candidate.id === activeReply.participantId)
        : undefined
      const userExplicitlyMentions = config.participants.some((candidate) =>
        config.participants.some((other) => other.id !== candidate.id)
          ? messageTargetsParticipant(prompt, candidate) !==
            messageTargetsParticipant(prompt, {
              id: '__none__',
              agent: '__none__',
              label: '__none__',
              model: '__none__',
              modelLabel: '__none__',
              role: '__none__',
              moderator: false
            })
          : messageTargetsParticipant(prompt, candidate) && /@\S/.test(prompt)
      )
      const routeHeader = activeReply
        ? replyParticipant && !userExplicitlyMentions
          ? `Replying to ${formatParticipantMentionToken(replyParticipant, config.participants)} ("${activeReply.preview}"):`
          : `Replying to ${activeReply.participantLabel} ("${activeReply.preview}"):`
        : ''
      const routedPrompt = routeHeader ? `${routeHeader}\n\n${prompt}` : prompt
      const replyMeta = activeReply
        ? { messageId: activeReply.messageId, label: activeReply.participantLabel }
        : undefined

      const existing = sessionRef.current
      if (
        existing &&
        (isRunning || existing.status === 'running' || existing.status === 'paused')
      ) {
        const queued = createUserInterventionMessage(existing.currentRound + 1, prompt, replyMeta)
        persist({
          ...existing,
          queuedUserMessages: [...existing.queuedUserMessages, routedPrompt],
          messages: [...existing.messages, queued]
        })
        return true
      }
      const { next, startRound, endRound } = buildGroupTurnSession({
        existing,
        chatId,
        worktreePath,
        participants: config.participants,
        discussionMode: config.discussionMode,
        maxRounds: config.maxRounds,
        prompt,
        routedPrompt,
        replyMeta,
        sharePriorContext: config.sharePriorContext !== false,
        priorMessages: messagesRef.current
      })
      void runTurn(next, startRound, endRound, replyMeta)
      return true
    },
    [
      agents,
      chatId,
      config.discussionMode,
      config.maxRounds,
      config.participants,
      config.sharePriorContext,
      isRunning,
      persist,
      replyTo,
      runTurn,
      sessionRef,
      worktreePath
    ]
  )

  return {
    ...settings,
    chatId,
    mode: config.mode,
    discussionMode: config.discussionMode,
    maxRounds: config.maxRounds,
    participants: config.participants,
    session,
    isRunning,
    isPaused,
    notice,
    dismissNotice: () => setNotice(null),
    sharedContext,
    replyTo,
    setReplyTarget,
    clearReplyTarget,
    send,
    ...controls
  }
}

import type { MutableRefObject } from 'react'
import type {
  CouncilGenerationResult,
  CouncilMessage,
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import { buildCouncilTurnPrompt, messageTargetsParticipant } from './council-prompts'
import {
  MAX_CONCURRENT_COUNCIL_TURNS,
  applyCouncilGenerationResult,
  createCouncilUuid,
  createPendingRoundMessages,
  mapWithConcurrency,
  waitWhilePaused
} from './council-session-execution'
import type { CouncilGenerationArgs } from './council-generation-tracker'

/** Rotates round-start order so the model that just finished speaking does not immediately follow itself. */
export function orderRoundParticipantsForDialogue(
  selected: readonly CouncilParticipant[],
  completedMessages: readonly CouncilMessage[]
): CouncilParticipant[] {
  if (selected.length < 2) {
    return [...selected]
  }
  const lastSpeaker = completedMessages
    .toReversed()
    .find((message) => message.kind === 'response' && message.participantId)
  if (!lastSpeaker || selected[0]?.id !== lastSpeaker.participantId) {
    return [...selected]
  }
  return [...selected.slice(1), selected[0]!]
}

/** Picks the live preceding message a sequential speaker is reacting to. */
export function resolveSequentialReplyTarget(input: {
  completedMessages: readonly CouncilMessage[]
  participantId: string
  isFirstSpeakerInUserTurn: boolean
  explicitReplyTo?: { label: string; messageId?: string }
}): { label: string; messageId?: string } | undefined {
  if (input.isFirstSpeakerInUserTurn && input.explicitReplyTo) {
    return input.explicitReplyTo
  }
  const latest = input.completedMessages.at(-1)
  if (latest?.kind === 'response' && latest.participantId !== input.participantId) {
    return { label: latest.participantLabel, messageId: latest.id }
  }
  if (latest?.kind === 'user' && input.isFirstSpeakerInUserTurn) {
    return undefined
  }
  const latestPeer = input.completedMessages
    .toReversed()
    .find(
      (candidate) =>
        candidate.kind === 'response' && candidate.participantId !== input.participantId
    )
  return latestPeer ? { label: latestPeer.participantLabel, messageId: latestPeer.id } : undefined
}

type RoundExecutionContext = {
  working: CouncilSession
  round: number
  startRound: number
  selected: readonly CouncilParticipant[]
  queued: readonly string[]
  explicitReplyTo?: { label: string; messageId?: string }
  pauseRef: MutableRefObject<boolean>
  stopRef: MutableRefObject<boolean>
  sessionRef: MutableRefObject<CouncilSession | null>
  persist: (next: CouncilSession) => CouncilSession
  patchSessionMessage: (
    sessionId: string,
    messageId: string,
    next: CouncilMessage
  ) => CouncilSession
  streamSessionMessage: (sessionId: string, messageId: string, content: string) => void
  executeGeneration: (args: CouncilGenerationArgs) => Promise<CouncilGenerationResult>
}

async function runSingleParticipantTurn(
  ctx: RoundExecutionContext,
  participant: CouncilParticipant,
  pendingMessage: CouncilMessage,
  turnPrompt: string
): Promise<void> {
  try {
    const result = await ctx.executeGeneration({
      workspaceId: ctx.working.workspaceId,
      operationId: createCouncilUuid(),
      participant,
      prompt: turnPrompt,
      onDelta: (text) => ctx.streamSessionMessage(ctx.working.id, pendingMessage.id, text)
    })
    const latestPending =
      ctx.sessionRef.current?.messages.find((message) => message.id === pendingMessage.id) ??
      pendingMessage
    ctx.working = ctx.patchSessionMessage(
      ctx.working.id,
      pendingMessage.id,
      applyCouncilGenerationResult(latestPending, result)
    )
  } catch (error) {
    ctx.working = ctx.patchSessionMessage(ctx.working.id, pendingMessage.id, {
      ...pendingMessage,
      status: ctx.stopRef.current ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Executes one group round, using sequential back-and-forth turns once discussion has begun. */
export async function runCouncilRoundTurns(ctx: RoundExecutionContext): Promise<CouncilSession> {
  const completedBeforeRound = ctx.working.messages.filter(
    (message) => message.status === 'completed'
  )
  const isSequentialDialogue =
    ctx.working.mode !== 'parallel' &&
    (ctx.round > 1 || completedBeforeRound.some((message) => message.kind === 'response'))

  if (isSequentialDialogue) {
    const ordered = orderRoundParticipantsForDialogue(ctx.selected, completedBeforeRound)
    const userLedRound = completedBeforeRound.at(-1)?.kind === 'user'
    ctx.working = ctx.persist({
      ...ctx.working,
      currentRound: ctx.round,
      queuedUserMessages: []
    })
    for (let index = 0; index < ordered.length; index += 1) {
      await waitWhilePaused(
        () => ctx.pauseRef.current,
        () => ctx.stopRef.current
      )
      if (ctx.stopRef.current) {
        break
      }
      const participant = ordered[index]!
      ctx.working =
        ctx.sessionRef.current?.id === ctx.working.id ? ctx.sessionRef.current : ctx.working
      const liveCompleted = ctx.working.messages.filter((message) => message.status === 'completed')
      const isFirstInUserTurn = ctx.round === ctx.startRound && index === 0 && userLedRound
      const replyTarget = resolveSequentialReplyTarget({
        completedMessages: liveCompleted,
        participantId: participant.id,
        isFirstSpeakerInUserTurn: isFirstInUserTurn,
        explicitReplyTo:
          ctx.round === ctx.startRound && index === 0 ? ctx.explicitReplyTo : undefined
      })
      const [pendingMsg] = createPendingRoundMessages([participant], ctx.round, () => replyTarget)
      if (!pendingMsg) {
        continue
      }
      ctx.working = ctx.persist({
        ...ctx.working,
        currentRound: ctx.round,
        messages: [...ctx.working.messages, pendingMsg]
      })
      const turnPrompt = buildCouncilTurnPrompt({
        originalPrompt: ctx.working.prompt,
        mode: ctx.working.mode,
        round: ctx.round,
        participant,
        participants: ctx.working.participants,
        replyToLabel: replyTarget?.label,
        messages: liveCompleted,
        isOpeningRound: false,
        ...(ctx.working.contextNote ? { contextNote: ctx.working.contextNote } : {}),
        queuedUserMessages: ctx.queued.filter((message) =>
          messageTargetsParticipant(message, participant)
        )
      })
      await runSingleParticipantTurn(ctx, participant, pendingMsg, turnPrompt)
    }
    return ctx.sessionRef.current?.id === ctx.working.id ? ctx.sessionRef.current : ctx.working
  }

  const pending = createPendingRoundMessages(ctx.selected, ctx.round, () =>
    ctx.round === ctx.startRound ? ctx.explicitReplyTo : undefined
  )
  ctx.working = ctx.persist({
    ...ctx.working,
    currentRound: ctx.round,
    messages: [...ctx.working.messages, ...pending],
    queuedUserMessages: []
  })
  await mapWithConcurrency(
    ctx.selected,
    MAX_CONCURRENT_COUNCIL_TURNS,
    async (participant, index) => {
      await waitWhilePaused(
        () => ctx.pauseRef.current,
        () => ctx.stopRef.current
      )
      if (ctx.stopRef.current) {
        ctx.working = ctx.patchSessionMessage(ctx.working.id, pending[index].id, {
          ...pending[index],
          status: 'cancelled',
          error: 'Stopped before starting'
        })
        return
      }
      const turnPrompt = buildCouncilTurnPrompt({
        originalPrompt: ctx.working.prompt,
        mode: ctx.working.mode,
        round: ctx.round,
        participant,
        participants: ctx.working.participants,
        replyToLabel: ctx.round === ctx.startRound ? ctx.explicitReplyTo?.label : undefined,
        messages: completedBeforeRound,
        isOpeningRound: ctx.round === ctx.startRound,
        ...(ctx.working.contextNote ? { contextNote: ctx.working.contextNote } : {}),
        queuedUserMessages: ctx.queued.filter((message) =>
          messageTargetsParticipant(message, participant)
        )
      })
      await runSingleParticipantTurn(ctx, participant, pending[index], turnPrompt)
    }
  )
  return ctx.sessionRef.current?.id === ctx.working.id ? ctx.sessionRef.current : ctx.working
}

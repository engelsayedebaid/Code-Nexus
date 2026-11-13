import type {
  CouncilGenerationResult,
  CouncilMessage,
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import { buildCouncilDecisionPrompt } from './council-prompts'
import {
  applyCouncilGenerationResult,
  createCouncilUuid,
  createPendingDecisionMessage,
  formatCouncilError
} from './council-session-execution'

type RunHelpers = {
  persist: (session: CouncilSession) => CouncilSession
  patchMessage: (sessionId: string, messageId: string, message: CouncilMessage) => CouncilSession
  streamMessage?: (sessionId: string, messageId: string, content: string) => void
  generate: (args: {
    workspaceId: string
    operationId: string
    participant: CouncilParticipant
    prompt: string
    onDelta?: (text: string) => void
  }) => Promise<CouncilGenerationResult>
  stopRef: { current: boolean }
  sessionRef: { current: CouncilSession | null }
}

/** Ask the moderator for the closing decision, after any number of discussion rounds. */
export async function runCouncilDecisionTurn(
  base: CouncilSession,
  helpers: RunHelpers
): Promise<void> {
  const { persist, patchMessage, streamMessage, generate, stopRef, sessionRef } = helpers
  const moderator =
    base.participants.find((participant) => participant.moderator) ?? base.participants[0]
  if (!moderator) {
    return
  }
  try {
    let working = persist({ ...base, status: 'running' })
    const decisionMessage = createPendingDecisionMessage(moderator, working.currentRound + 1)
    working = persist({ ...working, messages: [...working.messages, decisionMessage] })
    const result = await generate({
      workspaceId: working.workspaceId,
      operationId: createCouncilUuid(),
      participant: moderator,
      prompt: buildCouncilDecisionPrompt({
        originalPrompt: working.prompt,
        mode: working.mode,
        messages: working.messages.filter((message) => message.status === 'completed'),
        ...(working.contextNote ? { contextNote: working.contextNote } : {})
      }),
      onDelta: (text) => streamMessage?.(working.id, decisionMessage.id, text)
    })
    const latestDecision =
      sessionRef.current?.messages.find((message) => message.id === decisionMessage.id) ??
      decisionMessage
    working = patchMessage(
      working.id,
      decisionMessage.id,
      applyCouncilGenerationResult(latestDecision, result)
    )
    persist({
      ...working,
      ...(result.success ? { finalDecision: result.content } : {}),
      status: stopRef.current ? 'stopped' : 'completed'
    })
  } catch (error) {
    const current = sessionRef.current
    if (!current) {
      return
    }
    persist({
      ...current,
      status: 'stopped',
      messages: current.messages.map((message) =>
        message.status === 'processing'
          ? { ...message, status: 'failed', error: formatCouncilError(error) }
          : message
      )
    })
  }
}

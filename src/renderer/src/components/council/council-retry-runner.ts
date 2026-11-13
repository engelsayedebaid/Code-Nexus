import type {
  CouncilGenerationResult,
  CouncilMessage,
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import {
  applyCouncilGenerationResult,
  buildRetryTurnPrompt,
  createCouncilUuid,
  createRetryProcessingMessage,
  formatCouncilError
} from './council-session-execution'

type RetryHelpers = {
  patchMessage: (sessionId: string, messageId: string, message: CouncilMessage) => CouncilSession
  streamMessage?: (sessionId: string, messageId: string, content: string) => void
  generate: (args: {
    workspaceId: string
    operationId: string
    participant: CouncilParticipant
    prompt: string
    onDelta?: (text: string) => void
  }) => Promise<CouncilGenerationResult>
  persist: (session: CouncilSession) => CouncilSession
}

/** Re-run one failed or stopped turn against its original participant. */
export async function runCouncilMessageRetry(
  session: CouncilSession,
  failedMessage: CouncilMessage,
  helpers: RetryHelpers
): Promise<void> {
  const { patchMessage, streamMessage, generate, persist } = helpers
  const participant = session.participants.find(
    (candidate) => candidate.id === failedMessage.participantId
  )
  if (!participant) {
    return
  }
  const processing = createRetryProcessingMessage(failedMessage)
  let working = patchMessage(session.id, failedMessage.id, processing)
  try {
    const promptText = buildRetryTurnPrompt({
      originalPrompt: working.prompt,
      mode: working.mode,
      failedMessage,
      participant,
      messages: working.messages,
      participants: working.participants
    })
    const result = await generate({
      workspaceId: working.workspaceId,
      operationId: createCouncilUuid(),
      participant,
      prompt: promptText,
      onDelta: (text) => streamMessage?.(working.id, failedMessage.id, text)
    })
    working = patchMessage(
      working.id,
      failedMessage.id,
      applyCouncilGenerationResult(processing, result)
    )
    if (failedMessage.kind === 'decision' && result.success) {
      persist({ ...working, finalDecision: result.content })
    }
  } catch (error) {
    patchMessage(working.id, failedMessage.id, {
      ...processing,
      status: 'failed',
      error: formatCouncilError(error)
    })
  }
}

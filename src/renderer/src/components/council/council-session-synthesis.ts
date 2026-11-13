import { useCallback, type MutableRefObject } from 'react'
import type {
  CouncilGenerationResult,
  CouncilMessage,
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import { buildCouncilDecisionPrompt } from './council-prompts'
import { applyCouncilGenerationResult, createCouncilUuid } from './council-session-execution'
import { runCouncilDecisionTurn } from './council-decision-runner'
import { runCouncilMessageRetry } from './council-retry-runner'
import type { CouncilGenerationArgs } from './council-generation-tracker'

export async function runCouncilFinalDecisionMessage(input: {
  working: CouncilSession
  moderator: CouncilParticipant
  decisionMessage: CouncilMessage
  persist: (session: CouncilSession) => CouncilSession
  patchSessionMessage: (
    sessionId: string,
    messageId: string,
    next: CouncilMessage
  ) => CouncilSession
  streamSessionMessage: (sessionId: string, messageId: string, content: string) => void
  executeGeneration: (args: CouncilGenerationArgs) => Promise<CouncilGenerationResult>
  sessionRef: MutableRefObject<CouncilSession | null>
  stopRef: MutableRefObject<boolean>
}): Promise<CouncilSession> {
  const { decisionMessage } = input
  let working = input.persist({
    ...input.working,
    messages: [...input.working.messages, decisionMessage]
  })
  try {
    const result = await input.executeGeneration({
      workspaceId: working.workspaceId,
      operationId: createCouncilUuid(),
      participant: input.moderator,
      prompt: buildCouncilDecisionPrompt({
        originalPrompt: working.prompt,
        mode: working.mode,
        messages: working.messages.filter((message) => message.status === 'completed'),
        ...(working.contextNote ? { contextNote: working.contextNote } : {})
      }),
      onDelta: (text) => input.streamSessionMessage(working.id, decisionMessage.id, text)
    })
    const finalDecision = result.success ? result.content : working.finalDecision
    const latestDecision =
      input.sessionRef.current?.messages.find((message) => message.id === decisionMessage.id) ??
      decisionMessage
    working = input.patchSessionMessage(
      working.id,
      decisionMessage.id,
      applyCouncilGenerationResult(latestDecision, result)
    )
    return input.persist({ ...working, finalDecision })
  } catch (error) {
    return input.patchSessionMessage(working.id, decisionMessage.id, {
      ...decisionMessage,
      status: input.stopRef.current ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function useCouncilDecisionAndRetry(input: {
  session: CouncilSession | null
  runningRef: MutableRefObject<boolean>
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
}) {
  const {
    session,
    runningRef,
    stopRef,
    sessionRef,
    persist,
    patchSessionMessage,
    streamSessionMessage,
    executeGeneration
  } = input

  const requestDecision = useCallback(
    async (base: CouncilSession): Promise<void> => {
      if (runningRef.current) {
        return
      }
      runningRef.current = true
      stopRef.current = false
      try {
        await runCouncilDecisionTurn(base, {
          persist,
          patchMessage: patchSessionMessage,
          streamMessage: streamSessionMessage,
          generate: executeGeneration,
          stopRef,
          sessionRef
        })
      } finally {
        runningRef.current = false
      }
    },
    [
      executeGeneration,
      patchSessionMessage,
      persist,
      runningRef,
      sessionRef,
      stopRef,
      streamSessionMessage
    ]
  )

  const retryMessage = useCallback(
    async (failedMessage: CouncilMessage): Promise<void> => {
      if (!session || runningRef.current) {
        return
      }
      runningRef.current = true
      stopRef.current = false
      try {
        await runCouncilMessageRetry(session, failedMessage, {
          patchMessage: patchSessionMessage,
          streamMessage: streamSessionMessage,
          generate: executeGeneration,
          persist
        })
      } finally {
        runningRef.current = false
      }
    },
    [
      executeGeneration,
      patchSessionMessage,
      persist,
      runningRef,
      session,
      stopRef,
      streamSessionMessage
    ]
  )

  return { requestDecision, retryMessage }
}

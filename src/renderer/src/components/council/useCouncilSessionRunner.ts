import { useCallback, useRef } from 'react'
import type {
  CouncilGenerationResult,
  CouncilMessage,
  CouncilSession
} from '../../../../shared/council/council-contract'
import { runCouncilRoundTurns } from './council-dialogue-turn'
import {
  loadCouncilSessions,
  saveCouncilSession,
  type CouncilSessionStorage
} from './council-session-storage'
import {
  createPendingDecisionMessage,
  selectRoundParticipants,
  waitWhilePaused
} from './council-session-execution'
import {
  runTrackedCouncilGeneration,
  type CouncilGenerationArgs
} from './council-generation-tracker'
import {
  cancelCouncilRun,
  councilSessionForMessage,
  replaceCouncilSessionMessage
} from './council-session-persistence'
import {
  runCouncilFinalDecisionMessage,
  useCouncilDecisionAndRetry
} from './council-session-synthesis'

const defaultStorage: CouncilSessionStorage = {
  load: loadCouncilSessions,
  save: saveCouncilSession
}

export type CouncilRunOptions = {
  /** The Council workspace always closes with a moderator decision; inline chat asks on demand. */
  autoDecision?: boolean
  replyTo?: { messageId?: string; label: string }
}

export function useCouncilSessionRunner(input: {
  session: CouncilSession | null
  setSession: React.Dispatch<React.SetStateAction<CouncilSession | null>>
  setSavedSessions: React.Dispatch<React.SetStateAction<CouncilSession[]>>
  /** Inline chat runs persist to their own transcript key. */
  storage?: CouncilSessionStorage
}) {
  const { session, setSession, setSavedSessions, storage = defaultStorage } = input
  const runningRef = useRef(false)
  const pauseRef = useRef(false)
  const stopRef = useRef(false)
  const operationIdsRef = useRef(new Set<string>())
  const sessionRef = useRef<CouncilSession | null>(null)

  const persist = useCallback(
    (next: CouncilSession): CouncilSession => {
      const persisted = { ...next, updatedAt: Date.now() }
      sessionRef.current = persisted
      setSession((current) => (!current || current.id === persisted.id ? persisted : current))
      setSavedSessions(storage.save(persisted))
      return persisted
    },
    [setSavedSessions, setSession, storage]
  )

  const patchSessionMessage = useCallback(
    (sessionId: string, messageId: string, updated: CouncilMessage): CouncilSession => {
      const base = councilSessionForMessage(storage, sessionRef, sessionId)
      if (!base) {
        return updated as unknown as CouncilSession
      }
      return persist(replaceCouncilSessionMessage(base, messageId, updated))
    },
    [persist, storage]
  )

  const streamSessionMessage = useCallback(
    (sessionId: string, messageId: string, content: string): void => {
      const base = sessionRef.current?.id === sessionId ? sessionRef.current : null
      if (!base) {
        return
      }
      const existing = base.messages.find((message) => message.id === messageId)
      if (!existing || existing.status !== 'processing' || existing.content === content) {
        return
      }
      const updated = replaceCouncilSessionMessage(base, messageId, {
        ...existing,
        content
      })
      sessionRef.current = updated
      setSession((current) => (!current || current.id === updated.id ? updated : current))
    },
    [setSession]
  )

  const executeGeneration = useCallback(
    (args: CouncilGenerationArgs): Promise<CouncilGenerationResult> =>
      runTrackedCouncilGeneration(args, operationIdsRef.current),
    []
  )

  const cancelActive = useCallback(async () => {
    await cancelCouncilRun({
      operationIds: operationIdsRef.current,
      refs: { stopRef, pauseRef, sessionRef },
      persist
    })
  }, [persist])

  const run = useCallback(
    async (
      base: CouncilSession,
      startRound = 1,
      maxRoundOverride?: number,
      options: CouncilRunOptions = {}
    ): Promise<void> => {
      if (runningRef.current) {
        return
      }
      runningRef.current = true
      stopRef.current = false
      pauseRef.current = false
      const targetMaxRounds = maxRoundOverride ?? base.maxRounds
      let working = persist({
        ...base,
        status: 'running',
        maxRounds: Math.max(base.maxRounds, targetMaxRounds)
      })
      try {
        for (let round = startRound; round <= targetMaxRounds; round += 1) {
          await waitWhilePaused(
            () => pauseRef.current,
            () => stopRef.current
          )
          if (stopRef.current) {
            break
          }
          working = sessionRef.current?.id === working.id ? sessionRef.current : working
          const queued = working.queuedUserMessages
          // An inline chat opens a turn from its prompt, so @mentions there choose the responders.
          const openingMentions = round === startRound && working.chatId ? [working.prompt] : []
          const selected = selectRoundParticipants(working.participants, [
            ...openingMentions,
            ...queued
          ])
          working = await runCouncilRoundTurns({
            working,
            round,
            startRound,
            selected,
            queued,
            explicitReplyTo: options.replyTo,
            pauseRef,
            stopRef,
            sessionRef,
            persist,
            patchSessionMessage,
            streamSessionMessage,
            executeGeneration
          })
          if (working.mode === 'parallel' || stopRef.current) {
            break
          }
        }

        await waitWhilePaused(
          () => pauseRef.current,
          () => stopRef.current
        )
        working = sessionRef.current?.id === working.id ? sessionRef.current : working
        if (!stopRef.current && working.mode !== 'parallel' && options.autoDecision !== false) {
          const moderator =
            working.participants.find((participant) => participant.moderator) ??
            working.participants[0]
          if (moderator) {
            const decisionMessage = createPendingDecisionMessage(
              moderator,
              working.currentRound + 1
            )
            working = await runCouncilFinalDecisionMessage({
              working,
              moderator,
              decisionMessage,
              persist,
              patchSessionMessage,
              streamSessionMessage,
              executeGeneration,
              sessionRef,
              stopRef
            })
          }
        }
        working = sessionRef.current?.id === working.id ? sessionRef.current : working
        persist({ ...working, status: stopRef.current ? 'stopped' : 'completed' })
      } finally {
        runningRef.current = false
      }
    },
    [executeGeneration, patchSessionMessage, persist, streamSessionMessage]
  )

  const { requestDecision, retryMessage } = useCouncilDecisionAndRetry({
    session,
    runningRef,
    stopRef,
    sessionRef,
    persist,
    patchSessionMessage,
    streamSessionMessage,
    executeGeneration
  })

  return {
    runningRef,
    pauseRef,
    stopRef,
    sessionRef,
    persist,
    cancelActive,
    run,
    requestDecision,
    retryMessage
  }
}

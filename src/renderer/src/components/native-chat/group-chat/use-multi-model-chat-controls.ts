import { useCallback, type MutableRefObject } from 'react'
import type { CouncilMessage, CouncilSession } from '../../../../../shared/council/council-contract'
import type { CouncilRunOptions } from '../../council/useCouncilSessionRunner'
import { roundsForDiscussion } from './multi-model-chat-state'

export function useMultiModelChatControls(input: {
  maxRounds: number
  isRunning: boolean
  setIsRunning: (running: boolean) => void
  setIsPaused: (paused: boolean) => void
  pauseRef: MutableRefObject<boolean>
  sessionRef: MutableRefObject<CouncilSession | null>
  persist: (next: CouncilSession) => CouncilSession
  run: (
    base: CouncilSession,
    startRound: number,
    maxRoundOverride?: number,
    options?: CouncilRunOptions
  ) => Promise<void>
  cancelActive: () => Promise<void>
  retryMessage: (message: CouncilMessage) => Promise<void>
  requestDecision: (session: CouncilSession) => Promise<void>
}) {
  const {
    maxRounds,
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
  } = input

  const runTurn = useCallback(
    async (
      base: CouncilSession,
      startRound: number,
      maxRound: number,
      replyContext?: { messageId?: string; label: string }
    ) => {
      setIsRunning(true)
      setIsPaused(false)
      try {
        let current = base
        let from = startRound
        let to = maxRound
        for (;;) {
          await run(current, from, to, {
            autoDecision: false,
            ...(from === startRound && replyContext ? { replyTo: replyContext } : {})
          })
          const latest = sessionRef.current
          // A message added while the final round ran has no round left to answer it.
          if (!latest || latest.status === 'stopped' || latest.queuedUserMessages.length === 0) {
            break
          }
          current = latest
          from = latest.currentRound + 1
          to = from + roundsForDiscussion(latest.mode, maxRounds) - 1
        }
      } finally {
        setIsRunning(false)
        setIsPaused(false)
      }
    },
    [maxRounds, run, sessionRef, setIsPaused, setIsRunning]
  )

  const pause = useCallback(() => {
    if (!sessionRef.current) {
      return
    }
    pauseRef.current = true
    setIsPaused(true)
    persist({ ...sessionRef.current, status: 'paused' })
  }, [pauseRef, persist, sessionRef, setIsPaused])

  const resume = useCallback(() => {
    const current = sessionRef.current
    if (!current) {
      return
    }
    pauseRef.current = false
    setIsPaused(false)
    persist({ ...current, status: 'running' })
    if (!isRunning) {
      const nextRound = Math.max(1, current.currentRound + 1)
      const endRound = Math.max(nextRound, current.maxRounds)
      void runTurn({ ...current, status: 'draft' }, nextRound, endRound)
    }
  }, [isRunning, pauseRef, persist, runTurn, sessionRef, setIsPaused])

  const stop = useCallback(() => {
    pauseRef.current = false
    setIsPaused(false)
    void cancelActive()
  }, [cancelActive, pauseRef, setIsPaused])

  const retry = useCallback(
    (message: CouncilMessage) => {
      setIsRunning(true)
      void retryMessage(message).finally(() => setIsRunning(false))
    },
    [retryMessage, setIsRunning]
  )

  const requestFinalDecision = useCallback(() => {
    const current = sessionRef.current
    if (!current) {
      return
    }
    setIsRunning(true)
    void requestDecision(current).finally(() => setIsRunning(false))
  }, [requestDecision, sessionRef, setIsRunning])

  const continueDiscussion = useCallback(() => {
    const current = sessionRef.current
    if (!current) {
      return
    }
    const startRound = current.currentRound + 1
    const rounds = roundsForDiscussion(current.mode, maxRounds)
    void runTurn({ ...current, status: 'draft' }, startRound, startRound + rounds - 1)
  }, [maxRounds, runTurn, sessionRef])

  return {
    runTurn,
    pause,
    resume,
    stop,
    retry,
    requestDecision: requestFinalDecision,
    continueDiscussion
  }
}

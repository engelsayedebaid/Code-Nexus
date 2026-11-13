import { useEffect, useRef } from 'react'
import { shouldClearNativeChatWorkingSuppression } from '../../../../../../shared/native-chat/native-chat-working-suppression'

/**
 * Clears the working interruption once a newer agent turn takes over, and
 * forgets the previous epoch whenever the agent is idle.
 */
export function useNativeChatWorkingSuppression(input: {
  working: boolean
  interrupted: boolean
  workingEpoch: number | null
  clearInterrupted: () => void
}): void {
  const { clearInterrupted, interrupted, working, workingEpoch } = input
  const previousWorkingEpochRef = useRef<number | null>(null)
  useEffect(() => {
    if (
      shouldClearNativeChatWorkingSuppression({
        working,
        interrupted,
        workingEpoch,
        previousWorkingEpoch: previousWorkingEpochRef.current
      })
    ) {
      clearInterrupted()
    }
    if (working && workingEpoch != null) {
      previousWorkingEpochRef.current = workingEpoch
    }
    if (!working) {
      previousWorkingEpochRef.current = null
    }
  }, [clearInterrupted, interrupted, working, workingEpoch])
}

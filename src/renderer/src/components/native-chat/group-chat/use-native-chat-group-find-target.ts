import { useMemo, useRef } from 'react'
import type { NativeChatMessageListHandle } from '../messages/actions/use-native-chat-reveal-latest'
import type { MultiModelChatTranscriptHandle } from './MultiModelChatTranscript'

export type NativeChatGroupFindTarget = {
  /** Handed to the group transcript so a find match can be brought into view. */
  groupRef: React.RefObject<MultiModelChatTranscriptHandle | null>
  /** The transcript find steps through: the group one while it replaces the single-model list. */
  findRef: React.RefObject<Pick<NativeChatMessageListHandle, 'revealFindMatch'> | null>
}

/** Find follows whichever transcript this pane is showing. */
export function useNativeChatGroupFindTarget(
  multiActive: boolean,
  messageListRef: React.RefObject<NativeChatMessageListHandle | null>
): NativeChatGroupFindTarget {
  const groupRef = useRef<MultiModelChatTranscriptHandle | null>(null)
  const findRef = useMemo(
    () => ({
      get current(): Pick<NativeChatMessageListHandle, 'revealFindMatch'> | null {
        return multiActive ? groupRef.current : messageListRef.current
      }
    }),
    [messageListRef, multiActive]
  )
  return { groupRef, findRef }
}

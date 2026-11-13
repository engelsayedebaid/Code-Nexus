import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { nativeChatStreamingMessage } from '../../../../../../shared/native-chat/native-chat-streaming'
import {
  commandMarkersAsMessages,
  type NativeChatCommandMarker
} from '../../session/terminal/delivery/native-chat-command-marker'
import type { NativeChatLiveSession } from '../../session/terminal/read/native-chat-live-session-contract'

/** The displayed session: the host's turns plus markers, a live preview and optimistic echoes. */
export function nativeChatSessionWithPending(
  session: NativeChatLiveSession,
  pendingCount: number,
  pendingMessages: readonly NativeChatMessage[],
  commandMarkers: readonly NativeChatCommandMarker[],
  streamingText: string | null
): NativeChatLiveSession {
  if (pendingCount === 0 && commandMarkers.length === 0 && !streamingText) {
    return session
  }
  return {
    ...session,
    messages: [
      ...session.messages,
      ...commandMarkersAsMessages(commandMarkers),
      ...(streamingText ? [nativeChatStreamingMessage(streamingText)] : []),
      ...pendingMessages
    ]
  }
}

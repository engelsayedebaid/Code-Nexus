import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { useMultiModelChatScope } from './multi-model-chat-scope'
import { useMultiModelChat, type MultiModelChatController } from './use-multi-model-chat'

/** Resolves the tab's group scope and restores its conversation in one call. */
export function useNativeChatGroupChat(
  terminalTabId: string,
  messages: readonly NativeChatMessage[],
  sessionId?: string
): MultiModelChatController {
  const scope = useMultiModelChatScope(terminalTabId)
  return useMultiModelChat({
    chatId: sessionId ?? scope.chatId,
    ...(sessionId ? { fallbackChatId: scope.chatId } : {}),
    worktreePath: scope.worktreePath,
    messages
  })
}

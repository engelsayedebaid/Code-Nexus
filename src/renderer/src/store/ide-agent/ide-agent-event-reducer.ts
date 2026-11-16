import type {
  IdeAgentStreamEvent,
  IdeChatAttachment,
  IdeConversation,
  IdeConversationSummary,
  IdeProviderAgentOption,
  IdeTodoItem
} from '../../../../shared/ide-agent/ide-agent-types'

export type IdeAgentStoreData = {
  workspaceKey: string | null
  providers: IdeProviderAgentOption[]
  providersLoading: boolean
  conversations: IdeConversationSummary[]
  activeConversation: IdeConversation | null
  draftsByConversation: Record<string, string>
  attachmentsByConversation: Record<string, IdeChatAttachment[]>
  todosByWorkspace: Record<string, IdeTodoItem[]>
  commandLiveOutput: Record<string, string>
  lastError: string | null
  subscriptionActive: boolean
}

export function updateSummaryFromConversation(
  list: IdeConversationSummary[],
  conv: IdeConversation
): IdeConversationSummary[] {
  const nextSummary: IdeConversationSummary = {
    id: conv.id,
    workspaceKey: conv.workspaceKey,
    title: conv.title,
    mode: conv.mode,
    agentId: conv.agentId,
    modelId: conv.modelId,
    status: conv.status,
    messageCount: conv.messages.length,
    updatedAt: conv.updatedAt,
    createdAt: conv.createdAt
  }
  const rest = list.filter((c) => c.id !== conv.id)
  return [nextSummary, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function applyIdeAgentStreamEvent(
  curr: IdeAgentStoreData,
  event: IdeAgentStreamEvent
): Partial<IdeAgentStoreData> | IdeAgentStoreData {
  if (event.type === 'conversation_updated') {
    const updatedList = updateSummaryFromConversation(curr.conversations, event.conversation)
    const active =
      curr.activeConversation?.id === event.conversation.id
        ? event.conversation
        : curr.activeConversation
    return { conversations: updatedList, activeConversation: active }
  }
  if (event.type === 'message_delta' && curr.activeConversation?.id === event.conversationId) {
    const conv = curr.activeConversation
    const hasMsg = conv.messages.some((m) => m.id === event.messageId)
    const nextMessages = hasMsg
      ? conv.messages.map((m) =>
          m.id === event.messageId ? { ...m, text: event.text, streaming: true } : m
        )
      : [
          ...conv.messages,
          {
            id: event.messageId,
            conversationId: conv.id,
            role: 'assistant' as const,
            mode: conv.mode,
            text: event.text,
            streaming: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            agentId: conv.agentId,
            modelId: conv.modelId
          }
        ]
    return { activeConversation: { ...conv, messages: nextMessages } }
  }
  if (event.type === 'command_output' && curr.activeConversation?.id === event.conversationId) {
    const prev = curr.commandLiveOutput[event.commandId] ?? ''
    return {
      commandLiveOutput: {
        ...curr.commandLiveOutput,
        [event.commandId]: (prev + event.chunk).slice(-16_000)
      }
    }
  }
  return curr
}


import type {
  IdeAgentStreamEvent,
  IdeChatAttachment,
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode,
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

export function mergeIncomingConversation(
  current: IdeConversation | null,
  incoming: IdeConversation
): IdeConversation {
  if (!current || current.id !== incoming.id) {
    return incoming
  }
  const incomingMaxSeq = incoming.activity.at(-1)?.seq ?? 0
  const newerActivity = current.activity.filter((ev) => ev.seq > incomingMaxSeq)
  const mergedActivity =
    newerActivity.length > 0
      ? [...incoming.activity, ...newerActivity].slice(-400)
      : incoming.activity

  const streamingById = new Map(
    current.messages.filter((m) => m.streaming && m.text.length > 0).map((m) => [m.id, m])
  )
  if (streamingById.size === 0) {
    return mergedActivity === incoming.activity
      ? incoming
      : { ...incoming, activity: mergedActivity }
  }
  const messages = incoming.messages.map((msg) => {
    const live = streamingById.get(msg.id)
    if (live && msg.streaming && msg.text.length < live.text.length) {
      return { ...msg, text: live.text }
    }
    return msg
  })
  for (const [id, live] of streamingById) {
    if (!messages.some((m) => m.id === id) && incoming.activeRunId !== null) {
      messages.push(live)
    }
  }
  return { ...incoming, messages, activity: mergedActivity }
}

export function withOptimisticUserPrompt(
  active: IdeConversation | null,
  params: {
    conversationId: string
    optimisticId: string
    now: number
    text: string
    mode: IdeExecutionMode
    agentId?: string
    modelId?: string
    attachments: IdeChatAttachment[]
  }
): IdeConversation | null {
  if (active?.id !== params.conversationId) {
    return active
  }
  return {
    ...active,
    status: 'analyzing',
    activeRunId: active.activeRunId ?? `optimistic-run-${params.now}`,
    updatedAt: params.now,
    messages: [
      ...active.messages,
      {
        id: params.optimisticId,
        conversationId: active.id,
        role: 'user',
        mode: params.mode,
        text: params.text,
        createdAt: params.now,
        updatedAt: params.now,
        agentId: params.agentId ?? active.agentId,
        modelId: params.modelId ?? active.modelId,
        ...(params.attachments.length > 0 ? { attachments: params.attachments } : {})
      }
    ]
  }
}

export function withoutOptimisticUserPrompt(
  active: IdeConversation | null,
  conversationId: string,
  optimisticId: string
): IdeConversation | null {
  if (active?.id !== conversationId) {
    return active
  }
  return {
    ...active,
    status: 'idle',
    activeRunId: null,
    messages: active.messages.filter((m) => m.id !== optimisticId)
  }
}

function syncCompletedPlanStepsToTodos(
  todos: readonly IdeTodoItem[] | undefined,
  conv: IdeConversation
): IdeTodoItem[] | null {
  if (!todos || todos.length === 0 || conv.plans.length === 0) {
    return null
  }
  const completedStepIds = new Set(
    conv.plans.flatMap((p) => p.steps.filter((s) => s.status === 'completed').map((s) => s.id))
  )
  if (completedStepIds.size === 0) {
    return null
  }
  let changed = false
  const next = todos.map((item) => {
    if (!item.done && item.linkedStepId && completedStepIds.has(item.linkedStepId)) {
      changed = true
      return { ...item, done: true, updatedAt: Date.now() }
    }
    return item
  })
  return changed ? next : null
}

export function applyIdeAgentStreamEvent(
  curr: IdeAgentStoreData,
  event: IdeAgentStreamEvent
): Partial<IdeAgentStoreData> | IdeAgentStoreData {
  if (event.type === 'conversation_updated') {
    if (curr.workspaceKey && event.conversation.workspaceKey !== curr.workspaceKey) {
      return curr
    }
    const updatedList = updateSummaryFromConversation(curr.conversations, event.conversation)
    const active =
      curr.activeConversation?.id === event.conversation.id
        ? mergeIncomingConversation(curr.activeConversation, event.conversation)
        : curr.activeConversation
    const syncedTodos = syncCompletedPlanStepsToTodos(
      curr.todosByWorkspace[event.conversation.workspaceKey],
      event.conversation
    )
    return {
      conversations: updatedList,
      activeConversation: active,
      ...(syncedTodos
        ? {
            todosByWorkspace: {
              ...curr.todosByWorkspace,
              [event.conversation.workspaceKey]: syncedTodos
            }
          }
        : {})
    }
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
  if (event.type === 'message_complete' && curr.activeConversation?.id === event.conversationId) {
    const conv = curr.activeConversation
    const exists = conv.messages.some((m) => m.id === event.message.id)
    const nextMessages = exists
      ? conv.messages.map((m) =>
          m.id === event.message.id ? { ...event.message, streaming: false } : m
        )
      : [...conv.messages, { ...event.message, streaming: false }]
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
  if (event.type === 'activity' && curr.activeConversation?.id === event.conversationId) {
    const conv = curr.activeConversation
    if (conv.activity.some((ev) => ev.id === event.event.id)) {
      return curr
    }
    const nextActivity =
      conv.activity.length >= 400
        ? [...conv.activity.slice(-399), event.event]
        : [...conv.activity, event.event]
    return { activeConversation: { ...conv, activity: nextActivity } }
  }
  if (event.type === 'run_status' && curr.activeConversation?.id === event.conversationId) {
    const conv = curr.activeConversation
    if (conv.status === event.status && conv.activeRunId === event.runId) {
      return curr
    }
    return {
      activeConversation: {
        ...conv,
        status: event.status,
        activeRunId: event.runId
      }
    }
  }
  if (event.type === 'command_done' && event.execution.id in curr.commandLiveOutput) {
    const rest = { ...curr.commandLiveOutput }
    delete rest[event.execution.id]
    return { commandLiveOutput: rest }
  }
  return curr
}

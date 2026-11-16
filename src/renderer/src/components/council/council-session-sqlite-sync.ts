import { toast } from 'sonner'
import {
  normalizeConversationWorkspaceKey,
  type ChatConversationRecord,
  type ChatMessageRecord,
  type UpsertChatConversationTurnInput,
  type UpsertChatMessageInput
} from '../../../../shared/chat-conversations/chat-conversation-types'
import {
  COUNCIL_MODES,
  type CouncilMessage,
  type CouncilMessageStatus,
  type CouncilMode,
  type CouncilParticipant,
  type CouncilRunStatus,
  type CouncilSession
} from '../../../../shared/council/council-contract'
import { loadCouncilSessions } from './council-session-storage'
import {
  MULTI_MODEL_CHAT_CONFIG_KEY,
  MULTI_MODEL_CHAT_SESSIONS_KEY,
  type MultiModelChatConfig,
  multiModelChatSessionStorage
} from '../native-chat/group-chat/multi-model-chat-state'

const STREAM_CHECKPOINT_INTERVAL_MS = 350
const WRITE_ERROR_TOAST_COOLDOWN_MS = 5000

const pendingTurnsById = new Map<
  string,
  { input: UpsertChatConversationTurnInput; timer: ReturnType<typeof setTimeout> | null }
>()
const lastCommittedMessageCountById = new Map<string, number>()
let legacyImportPromise: Promise<void> | null = null
let lastWriteErrorToastAt = 0
let beforeUnloadRegistered = false

function ensureBeforeUnloadFlush(): void {
  if (beforeUnloadRegistered || typeof window === 'undefined') {
    return
  }
  beforeUnloadRegistered = true
  window.addEventListener('beforeunload', () => {
    void flushPendingChatConversationSave()
  })
}

export function hasChatConversationsBridge(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.api?.chatConversations?.saveTurn === 'function'
  )
}

function reportSqliteWriteFailure(error: unknown): void {
  console.error('[chat-conversations] Failed to persist conversation state:', error)
  const now = Date.now()
  if (now - lastWriteErrorToastAt >= WRITE_ERROR_TOAST_COOLDOWN_MS) {
    lastWriteErrorToastAt = now
    const detail = error instanceof Error ? error.message : String(error)
    toast.error(`Failed to save conversation: ${detail}`)
  }
}

function toDbConversationStatus(
  status: CouncilRunStatus
): UpsertChatConversationTurnInput['conversation']['status'] {
  if (status === 'stopped') {
    return 'interrupted'
  }
  return status
}

function fromDbConversationStatus(
  status: ChatConversationRecord['status']
): CouncilRunStatus {
  if (status === 'running' || status === 'interrupted' || status === 'error') {
    return 'stopped'
  }
  if (status === 'active') {
    return 'draft'
  }
  return status
}

function toDbMessageStatus(status: CouncilMessageStatus): UpsertChatMessageInput['status'] {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'processing':
      return 'streaming'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'interrupted'
  }
}

function fromDbMessageStatus(status: ChatMessageRecord['status']): CouncilMessageStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'error':
      return 'failed'
    case 'pending':
    case 'streaming':
    case 'interrupted':
      return 'cancelled'
  }
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isCouncilMode(value: unknown): value is CouncilMode {
  return typeof value === 'string' && (COUNCIL_MODES as readonly string[]).includes(value)
}

export function councilSessionToTurnInput(
  session: CouncilSession,
  workspaceOverride?: string | null
): UpsertChatConversationTurnInput {
  const workspaceId = workspaceOverride !== undefined ? workspaceOverride : session.workspaceId
  const lastMessageAt = session.messages.reduce(
    (max, msg) => (msg.createdAt > max ? msg.createdAt : max),
    session.createdAt
  )
  const messages: UpsertChatMessageInput[] = session.messages.map((msg, index) => ({
    id: msg.id,
    conversationId: session.id,
    sequence: index,
    role: msg.kind,
    content: msg.content,
    status: toDbMessageStatus(msg.status),
    metadataJson: JSON.stringify({
      participantId: msg.participantId,
      participantLabel: msg.participantLabel,
      provider: msg.provider,
      model: msg.model,
      role: msg.role,
      round: msg.round,
      error: msg.error,
      replyToLabel: msg.replyToLabel,
      replyToMessageId: msg.replyToMessageId
    }),
    createdAt: msg.createdAt,
    updatedAt: session.updatedAt
  }))

  return {
    conversation: {
      id: session.id,
      kind: session.surface === 'chat' ? 'multi-model' : 'council',
      workspaceId: workspaceId || null,
      scopeKey: session.chatId ?? session.id,
      title: session.title,
      status: toDbConversationStatus(session.status),
      configJson: JSON.stringify({
        mode: session.mode,
        maxRounds: session.maxRounds,
        participants: session.participants
      }),
      metadataJson: JSON.stringify({
        prompt: session.prompt,
        currentRound: session.currentRound,
        finalDecision: session.finalDecision,
        queuedUserMessages: session.queuedUserMessages,
        chatId: session.chatId,
        surface: session.surface,
        contextNote: session.contextNote
      }),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastMessageAt
    },
    messages
  }
}

export function dbConversationToCouncilSession(
  record: ChatConversationRecord,
  dbMessages: readonly ChatMessageRecord[]
): CouncilSession {
  const config = safeParseObject(record.configJson)
  const meta = safeParseObject(record.metadataJson)
  const participants = Array.isArray(config.participants)
    ? (config.participants as CouncilParticipant[])
    : []
  const messages: CouncilMessage[] = dbMessages.map((row) => {
    const msgMeta = safeParseObject(row.metadataJson)
    const kind =
      row.role === 'user' ||
      row.role === 'response' ||
      row.role === 'system' ||
      row.role === 'decision'
        ? row.role
        : 'response'
    return {
      id: row.id,
      participantId: typeof msgMeta.participantId === 'string' ? msgMeta.participantId : undefined,
      participantLabel:
        typeof msgMeta.participantLabel === 'string' ? msgMeta.participantLabel : row.role,
      provider: typeof msgMeta.provider === 'string' ? msgMeta.provider : undefined,
      model: typeof msgMeta.model === 'string' ? msgMeta.model : undefined,
      role: typeof msgMeta.role === 'string' ? msgMeta.role : kind,
      round: typeof msgMeta.round === 'number' ? msgMeta.round : 1,
      createdAt: row.createdAt,
      status: fromDbMessageStatus(row.status),
      kind,
      content: row.content,
      error: typeof msgMeta.error === 'string' ? msgMeta.error : undefined,
      replyToLabel: typeof msgMeta.replyToLabel === 'string' ? msgMeta.replyToLabel : undefined,
      replyToMessageId:
        typeof msgMeta.replyToMessageId === 'string' ? msgMeta.replyToMessageId : undefined
    }
  })

  return {
    id: record.id,
    workspaceId: record.workspaceId ?? '',
    title: record.title,
    prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
    mode: isCouncilMode(config.mode) ? config.mode : 'debate',
    maxRounds: typeof config.maxRounds === 'number' ? config.maxRounds : 2,
    participants,
    messages,
    status: fromDbConversationStatus(record.status),
    currentRound: typeof meta.currentRound === 'number' ? meta.currentRound : 1,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finalDecision: typeof meta.finalDecision === 'string' ? meta.finalDecision : undefined,
    queuedUserMessages: Array.isArray(meta.queuedUserMessages)
      ? meta.queuedUserMessages.filter((item): item is string => typeof item === 'string')
      : [],
    chatId: typeof meta.chatId === 'string' ? meta.chatId : undefined,
    surface:
      meta.surface === 'chat' || record.kind === 'multi-model'
        ? 'chat'
        : meta.surface === 'council'
          ? 'council'
          : undefined,
    contextNote: typeof meta.contextNote === 'string' ? meta.contextNote : undefined
  }
}

function readLegacyConfigRaw(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    const raw = localStorage.getItem(MULTI_MODEL_CHAT_CONFIG_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? raw : null
  } catch {
    return null
  }
}

export async function ensureLegacyChatConversationsImported(): Promise<void> {
  if (!hasChatConversationsBridge()) {
    return
  }
  if (!legacyImportPromise) {
    legacyImportPromise = (async () => {
      const entries: UpsertChatConversationTurnInput[] = []
      for (const session of loadCouncilSessions()) {
        entries.push(councilSessionToTurnInput(session))
      }
      for (const session of multiModelChatSessionStorage.loadAll()) {
        entries.push(
          councilSessionToTurnInput({
            ...session,
            surface: 'chat'
          })
        )
      }
      if (entries.length > 0) {
        await window.api.chatConversations.importConversations(entries)
      }
      const configRaw = readLegacyConfigRaw()
      if (configRaw) {
        await window.api.chatConversations.importKvStateIfMissing({
          [MULTI_MODEL_CHAT_CONFIG_KEY]: configRaw
        })
      }
    })().catch((error) => {
      legacyImportPromise = null
      console.warn('[chat-conversations] Legacy localStorage import failed:', error)
    })
  }
  await legacyImportPromise
}

async function commitTurnNow(
  input: UpsertChatConversationTurnInput,
  streamed: boolean
): Promise<void> {
  try {
    await window.api.chatConversations.saveTurn(input, streamed)
    lastCommittedMessageCountById.set(input.conversation.id, input.messages.length)
  } catch (error) {
    reportSqliteWriteFailure(error)
    throw error
  }
}

export async function flushPendingChatConversationSave(conversationId?: string): Promise<void> {
  if (!hasChatConversationsBridge()) {
    return
  }
  const ids =
    conversationId !== undefined ? [conversationId] : Array.from(pendingTurnsById.keys())
  await Promise.all(
    ids.map(async (id) => {
      const pending = pendingTurnsById.get(id)
      if (!pending) {
        return
      }
      if (pending.timer) {
        clearTimeout(pending.timer)
      }
      pendingTurnsById.delete(id)
      await commitTurnNow(pending.input, false)
    })
  )
}

export function scheduleCouncilSessionSqliteSync(
  session: CouncilSession,
  options?: { immediate?: boolean; workspaceOverride?: string | null }
): Promise<void> {
  if (!hasChatConversationsBridge()) {
    return Promise.resolve()
  }
  ensureBeforeUnloadFlush()
  const input = councilSessionToTurnInput(session, options?.workspaceOverride)
  const existing = pendingTurnsById.get(session.id)
  const previousCount = lastCommittedMessageCountById.get(session.id) ?? -1
  const hasNewMessages = input.messages.length !== previousCount
  const shouldFlushNow =
    options?.immediate === true || session.status !== 'running' || hasNewMessages
  if (shouldFlushNow) {
    if (existing?.timer) {
      clearTimeout(existing.timer)
    }
    pendingTurnsById.delete(session.id)
    return commitTurnNow(input, false)
  }
  if (existing) {
    existing.input = input
    return Promise.resolve()
  }
  const timer = setTimeout(() => {
    const latest = pendingTurnsById.get(session.id)
    if (!latest) {
      return
    }
    pendingTurnsById.delete(session.id)
    void commitTurnNow(latest.input, true).catch(() => {})
  }, STREAM_CHECKPOINT_INTERVAL_MS)
  pendingTurnsById.set(session.id, { input, timer })
  return Promise.resolve()
}

function councilActiveSessionKvKey(workspaceId: string | null | undefined): string {
  return `council.activeSession:${normalizeConversationWorkspaceKey(workspaceId)}`
}

export async function setActiveCouncilSessionIdInSqlite(
  workspaceId: string | null | undefined,
  sessionId: string | null
): Promise<void> {
  if (!hasChatConversationsBridge()) {
    return
  }
  try {
    await window.api.chatConversations.setKvState(
      councilActiveSessionKvKey(workspaceId),
      JSON.stringify(sessionId)
    )
  } catch (error) {
    console.warn('[chat-conversations] Failed to save active council session id:', error)
  }
}

export async function loadWorkspaceCouncilSessionsFromSqlite(
  workspaceId: string | null | undefined
): Promise<{
  sessions: CouncilSession[]
  activeSession: CouncilSession | null
}> {
  if (!hasChatConversationsBridge()) {
    return { sessions: [], activeSession: null }
  }
  await ensureLegacyChatConversationsImported()
  const records = await window.api.chatConversations.list({
    workspaceId: workspaceId ?? null,
    kind: 'council',
    includeGlobal: !workspaceId,
    limit: 50
  })
  const sessions = records.map((record) => dbConversationToCouncilSession(record, []))
  let activeSessionId: string | null = null
  try {
    const activeRaw = await window.api.chatConversations.getKvState(
      councilActiveSessionKvKey(workspaceId)
    )
    if (activeRaw) {
      const parsed: unknown = JSON.parse(activeRaw)
      if (typeof parsed === 'string') {
        activeSessionId = parsed
      }
    }
  } catch {
    activeSessionId = null
  }
  const targetId =
    (activeSessionId && sessions.some((item) => item.id === activeSessionId)
      ? activeSessionId
      : sessions[0]?.id) ?? null
  const activeDetail = targetId
    ? await loadCouncilSessionDetailFromSqlite(targetId)
    : null
  const mergedSessions = activeDetail
    ? sessions.map((item) => (item.id === activeDetail.id ? activeDetail : item))
    : sessions
  return {
    sessions: mergedSessions,
    activeSession: activeDetail
  }
}

export async function loadCouncilSessionDetailFromSqlite(
  conversationId: string,
  limit = 500
): Promise<CouncilSession | null> {
  if (!hasChatConversationsBridge()) {
    return null
  }
  const detail = await window.api.chatConversations.get({ conversationId, limit })
  if (!detail) {
    return null
  }
  return dbConversationToCouncilSession(detail.conversation, detail.messages)
}

export async function deleteCouncilSessionFromSqlite(conversationId: string): Promise<boolean> {
  const existing = pendingTurnsById.get(conversationId)
  if (existing?.timer) {
    clearTimeout(existing.timer)
  }
  pendingTurnsById.delete(conversationId)
  if (!hasChatConversationsBridge()) {
    return false
  }
  try {
    return await window.api.chatConversations.deleteConversation(conversationId)
  } catch (error) {
    reportSqliteWriteFailure(error)
    throw error
  }
}

export async function loadMultiModelSessionFromSqlite(
  chatId: string,
  workspaceId: string | null | undefined
): Promise<CouncilSession | null> {
  if (!hasChatConversationsBridge() || !chatId) {
    return null
  }
  await ensureLegacyChatConversationsImported()
  const records = await window.api.chatConversations.list({
    workspaceId: workspaceId ?? null,
    scopeKey: chatId,
    kind: 'multi-model',
    limit: 1
  })
  const first = records[0]
  if (!first) {
    return null
  }
  return loadCouncilSessionDetailFromSqlite(first.id)
}

export async function loadMultiModelConfigMapFromSqlite(): Promise<
  Record<string, MultiModelChatConfig> | null
> {
  if (!hasChatConversationsBridge()) {
    return null
  }
  await ensureLegacyChatConversationsImported()
  const raw = await window.api.chatConversations.getKvState(MULTI_MODEL_CHAT_CONFIG_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, MultiModelChatConfig>)
      : null
  } catch {
    return null
  }
}

export async function saveMultiModelConfigEntryToSqlite(
  chatId: string,
  config: MultiModelChatConfig
): Promise<void> {
  if (!hasChatConversationsBridge() || !chatId) {
    return
  }
  try {
    const current = (await loadMultiModelConfigMapFromSqlite()) ?? {}
    const next = { ...current, [chatId]: config }
    await window.api.chatConversations.setKvState(
      MULTI_MODEL_CHAT_CONFIG_KEY,
      JSON.stringify(next)
    )
  } catch (error) {
    reportSqliteWriteFailure(error)
  }
}

export { MULTI_MODEL_CHAT_SESSIONS_KEY }

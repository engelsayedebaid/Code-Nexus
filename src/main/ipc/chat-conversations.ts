import { ipcMain } from 'electron'
import type {
  GetChatConversationInput,
  ListChatConversationsInput,
  UpsertChatConversationInput,
  UpsertChatConversationTurnInput,
  UpsertChatMessageInput
} from '../../shared/chat-conversations/chat-conversation-types'
import { ChatConversationRepository } from '../chat-conversations/chat-conversation-repository'
import {
  journalDatabasePath,
  type JournalHostDatabase
} from '../native-chat/agent-session-journal/database/journal-host-database'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { ensureStructuredAgentSessionHostUnlessRefused } from '../runtime/agent-session/structured-agent-session-host-refusal'

const repositories = new WeakMap<JournalHostDatabase, Promise<ChatConversationRepository>>()

async function resolveRepository(runtime: {
  ensureStructuredAgentSessionHost(): Promise<void>
}): Promise<ChatConversationRepository> {
  await ensureStructuredAgentSessionHostUnlessRefused(() => runtime.ensureStructuredAgentSessionHost())
  const journalDatabase = getStructuredAgentSessionHost()?.deps.journalDatabase
  if (!journalDatabase || journalDatabase.isClosed) {
    throw new Error('chat_conversations_storage_unavailable')
  }
  let pending = repositories.get(journalDatabase)
  if (!pending) {
    const repo = new ChatConversationRepository(
      journalDatabase,
      journalDatabasePath(journalDatabase.stateDirectory)
    )
    pending = repo.initialize().then(
      () => repo,
      (error: unknown) => {
        if (repositories.get(journalDatabase) === pending) {
          repositories.delete(journalDatabase)
        }
        throw error
      }
    )
    repositories.set(journalDatabase, pending)
  }
  return pending
}

export function registerChatConversationHandlers(runtime: {
  ensureStructuredAgentSessionHost(): Promise<void>
}): void {
  ipcMain.handle(
    'chatConversations:list',
    async (_event, input?: ListChatConversationsInput) => {
      const repo = await resolveRepository(runtime)
      return repo.listConversations(input ?? {})
    }
  )

  ipcMain.handle('chatConversations:get', async (_event, input: GetChatConversationInput) => {
    const repo = await resolveRepository(runtime)
    return repo.getConversationWithMessages(input)
  })

  ipcMain.handle(
    'chatConversations:upsertConversation',
    async (_event, input: UpsertChatConversationInput) => {
      const repo = await resolveRepository(runtime)
      return repo.upsertConversation(input)
    }
  )

  ipcMain.handle(
    'chatConversations:upsertMessages',
    async (
      _event,
      payload: { messages: readonly UpsertChatMessageInput[]; streamed?: boolean }
    ) => {
      const repo = await resolveRepository(runtime)
      return repo.upsertMessages(payload.messages, payload.streamed === true)
    }
  )

  ipcMain.handle(
    'chatConversations:saveTurn',
    async (
      _event,
      payload: { input: UpsertChatConversationTurnInput; streamed?: boolean }
    ) => {
      const repo = await resolveRepository(runtime)
      return repo.saveConversationTurn(payload.input, payload.streamed === true)
    }
  )

  ipcMain.handle('chatConversations:delete', async (_event, conversationId: string) => {
    const repo = await resolveRepository(runtime)
    return repo.deleteConversation(conversationId)
  })

  ipcMain.handle(
    'chatConversations:importConversations',
    async (_event, entries: readonly UpsertChatConversationTurnInput[]) => {
      const repo = await resolveRepository(runtime)
      return repo.importConversations(entries)
    }
  )

  ipcMain.handle('chatConversations:getKvState', async (_event, key: string) => {
    const repo = await resolveRepository(runtime)
    return repo.getKvState(key)
  })

  ipcMain.handle(
    'chatConversations:setKvState',
    async (_event, payload: { key: string; valueJson: string }) => {
      const repo = await resolveRepository(runtime)
      repo.setKvState(payload.key, payload.valueJson)
    }
  )

  ipcMain.handle(
    'chatConversations:importKvStateIfMissing',
    async (_event, entries: Record<string, string>) => {
      const repo = await resolveRepository(runtime)
      return repo.importKvStateIfMissing(entries)
    }
  )

  ipcMain.handle(
    'chatConversations:listStructuredHistory',
    async (_event, workspaceId?: string | null) => {
      const repo = await resolveRepository(runtime)
      return repo.listWorkspaceStructuredHistory(workspaceId)
    }
  )
}

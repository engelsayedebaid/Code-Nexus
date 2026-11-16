import {
  GLOBAL_CONVERSATION_WORKSPACE_KEY,
  normalizeConversationWorkspaceKey,
  type ChatConversationKind,
  type ChatConversationRecord,
  type ChatConversationStatus,
  type ChatConversationWithMessages,
  type ChatMessageRecord,
  type ChatMessageStatus,
  type ChatWorkspaceStructuredHistoryEntry,
  type GetChatConversationInput,
  type ListChatConversationsInput,
  type UpsertChatConversationInput,
  type UpsertChatConversationTurnInput,
  type UpsertChatMessageInput
} from '../../shared/chat-conversations/chat-conversation-types'
import type { SqliteBindings, SqliteRow } from '../sqlite/sqlite-statement'
import type Database from '../sqlite/sync-database'
import {
  backupDatabaseBeforeChatTableMigration,
  createChatConversationTablesSql
} from './chat-conversation-schema'

export type ChatConversationDatabaseHost = {
  readonly db: Database.Database
  readonly readOnly: boolean
  transaction<T>(run: (db: Database.Database) => T, streamed?: boolean): T
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asKind(value: unknown): ChatConversationKind {
  return value === 'multi-model' || value === 'council' ? value : 'council'
}

function asConversationStatus(value: unknown): ChatConversationStatus {
  switch (value) {
    case 'draft':
    case 'active':
    case 'running':
    case 'paused':
    case 'completed':
    case 'interrupted':
    case 'error':
      return value
    default:
      return 'active'
  }
}

function asMessageStatus(value: unknown): ChatMessageStatus {
  switch (value) {
    case 'pending':
    case 'streaming':
    case 'completed':
    case 'interrupted':
    case 'error':
      return value
    default:
      return 'completed'
  }
}

function mapConversationRow(row: SqliteRow): ChatConversationRecord {
  return {
    id: asString(row.id),
    kind: asKind(row.kind),
    workspaceKey: asString(row.workspace_key),
    workspaceId: asNullableString(row.workspace_id),
    scopeKey: asString(row.scope_key),
    title: asString(row.title),
    status: asConversationStatus(row.status),
    configJson: asString(row.config_json),
    metadataJson: asString(row.metadata_json),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    lastMessageAt: asNumber(row.last_message_at)
  }
}

function mapMessageRow(row: SqliteRow): ChatMessageRecord {
  return {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    sequence: asNumber(row.sequence),
    role: asString(row.role),
    content: asString(row.content),
    status: asMessageStatus(row.status),
    metadataJson: asString(row.metadata_json),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at)
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  )
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function upsertConversationRow(
  db: Database.Database,
  input: UpsertChatConversationInput,
  now: number
): void {
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now
  const lastMessageAt = input.lastMessageAt ?? updatedAt
  const workspaceKey = normalizeConversationWorkspaceKey(input.workspaceId)
  db.prepare(
    `INSERT INTO chat_conversations (
       id, kind, workspace_key, workspace_id, scope_key, title, status,
       config_json, metadata_json, created_at, updated_at, last_message_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       workspace_key = excluded.workspace_key,
       workspace_id = excluded.workspace_id,
       scope_key = excluded.scope_key,
       title = excluded.title,
       status = excluded.status,
       config_json = excluded.config_json,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at,
       last_message_at = MAX(chat_conversations.last_message_at, excluded.last_message_at)`
  ).run(
    input.id,
    input.kind,
    workspaceKey,
    input.workspaceId ?? null,
    input.scopeKey,
    input.title,
    input.status,
    input.configJson ?? '{}',
    input.metadataJson ?? '{}',
    createdAt,
    updatedAt,
    lastMessageAt
  )
}

function upsertMessageRow(
  db: Database.Database,
  input: UpsertChatMessageInput,
  now: number
): void {
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now
  db.prepare(
    `INSERT INTO chat_messages (
       id, conversation_id, sequence, role, content, status, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, id) DO UPDATE SET
       sequence = excluded.sequence,
       role = excluded.role,
       content = excluded.content,
       status = excluded.status,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`
  ).run(
    input.id,
    input.conversationId,
    input.sequence,
    input.role,
    input.content,
    input.status,
    input.metadataJson ?? '{}',
    createdAt,
    updatedAt
  )
}

export class ChatConversationRepository {
  private initialized = false
  private initializing: Promise<void> | null = null

  constructor(
    private readonly host: ChatConversationDatabaseHost,
    private readonly databaseFilePath: string | null = null
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    if (!this.initializing) {
      this.initializing = this.runInitialization().finally(() => {
        this.initializing = null
      })
    }
    await this.initializing
  }

  private async runInitialization(): Promise<void> {
    if (!this.host.readOnly) {
      await backupDatabaseBeforeChatTableMigration(this.host.db, this.databaseFilePath)
    }
    this.initializeSchemaAndReconcileSync()
  }

  initializeSchemaAndReconcileSync(): void {
    if (this.initialized) {
      return
    }
    if (this.host.readOnly) {
      this.initialized = true
      return
    }
    const now = Date.now()
    this.host.transaction((db) => {
      db.exec('PRAGMA foreign_keys = ON;')
      db.exec(createChatConversationTablesSql())
      // Mark orphaned in-flight streams/runs interrupted so partial output stays visible and never auto-reruns.
      db.prepare(
        "UPDATE chat_messages SET status = 'interrupted', updated_at = ? WHERE status IN ('pending', 'streaming')"
      ).run(now)
      db.prepare(
        "UPDATE chat_conversations SET status = 'interrupted', updated_at = ? WHERE status = 'running'"
      ).run(now)
    })
    this.initialized = true
  }

  private assertWritable(): void {
    if (this.host.readOnly) {
      throw new Error('chat_conversations_read_only')
    }
    this.initializeSchemaAndReconcileSync()
  }

  upsertConversation(input: UpsertChatConversationInput): ChatConversationRecord {
    this.assertWritable()
    const now = Date.now()
    return this.host.transaction((db) => {
      upsertConversationRow(db, input, now)
      const row = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(input.id)
      if (!row) {
        throw new Error(`chat_conversation_write_missing:${input.id}`)
      }
      return mapConversationRow(row)
    })
  }

  upsertMessages(inputs: readonly UpsertChatMessageInput[], streamed = false): ChatMessageRecord[] {
    this.assertWritable()
    if (inputs.length === 0) {
      return []
    }
    const now = Date.now()
    return this.host.transaction((db) => {
      const checkConversation = db.prepare('SELECT id FROM chat_conversations WHERE id = ?')
      const bumpConversation = db.prepare(
        `UPDATE chat_conversations
         SET updated_at = MAX(updated_at, ?),
             last_message_at = MAX(last_message_at, ?)
         WHERE id = ?`
      )
      const touched = new Set<string>()
      for (const message of inputs) {
        if (!touched.has(message.conversationId)) {
          if (!checkConversation.get(message.conversationId)) {
            throw new Error(`chat_conversation_not_found:${message.conversationId}`)
          }
          touched.add(message.conversationId)
        }
        upsertMessageRow(db, message, now)
      }
      for (const conversationId of touched) {
        bumpConversation.run(now, now, conversationId)
      }
      const results: ChatMessageRecord[] = []
      const readMessage = db.prepare(
        'SELECT * FROM chat_messages WHERE conversation_id = ? AND id = ?'
      )
      for (const message of inputs) {
        const saved = readMessage.get(message.conversationId, message.id)
        if (saved) {
          results.push(mapMessageRow(saved))
        }
      }
      return results
    }, streamed)
  }

  saveConversationTurn(
    input: UpsertChatConversationTurnInput,
    streamed = false
  ): ChatConversationWithMessages {
    this.assertWritable()
    const now = Date.now()
    return this.host.transaction((db) => {
      upsertConversationRow(db, input.conversation, now)
      for (const message of input.messages) {
        if (message.conversationId !== input.conversation.id) {
          throw new Error(
            `chat_message_conversation_mismatch:${message.id}:${message.conversationId}:${input.conversation.id}`
          )
        }
        upsertMessageRow(db, message, now)
      }
      const conversationRow = db
        .prepare('SELECT * FROM chat_conversations WHERE id = ?')
        .get(input.conversation.id)
      if (!conversationRow) {
        throw new Error(`chat_conversation_write_missing:${input.conversation.id}`)
      }
      const messageRows = db
        .prepare(
          'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY sequence ASC, created_at ASC'
        )
        .all(input.conversation.id)
      return {
        conversation: mapConversationRow(conversationRow),
        messages: messageRows.map(mapMessageRow),
        hasMore: false
      }
    }, streamed)
  }

  listConversations(input: ListChatConversationsInput = {}): ChatConversationRecord[] {
    if (!hasTable(this.host.db, 'chat_conversations')) {
      return []
    }
    const clauses: string[] = []
    const params: SqliteBindings = []
    if (input.scopeKey !== undefined) {
      clauses.push('scope_key = ?')
      params.push(input.scopeKey)
    }
    if (input.workspaceId !== undefined) {
      const key = normalizeConversationWorkspaceKey(input.workspaceId)
      if (input.includeGlobal && key !== GLOBAL_CONVERSATION_WORKSPACE_KEY) {
        clauses.push('(workspace_key = ? OR workspace_key = ?)')
        params.push(key, GLOBAL_CONVERSATION_WORKSPACE_KEY)
      } else {
        clauses.push('workspace_key = ?')
        params.push(key)
      }
    }
    if (input.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(input.kind)
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limitSql =
      typeof input.limit === 'number' && input.limit > 0 ? `LIMIT ${Math.trunc(input.limit)}` : ''
    const rows = this.host.db
      .prepare(
        `SELECT * FROM chat_conversations
         ${whereSql}
         ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
         ${limitSql}`
      )
      .all(...params)
    return rows.map(mapConversationRow)
  }

  getConversationWithMessages(
    input: GetChatConversationInput
  ): ChatConversationWithMessages | null {
    if (!hasTable(this.host.db, 'chat_conversations')) {
      return null
    }
    const row = this.host.db
      .prepare('SELECT * FROM chat_conversations WHERE id = ?')
      .get(input.conversationId)
    if (!row) {
      return null
    }
    if (!hasTable(this.host.db, 'chat_messages')) {
      return { conversation: mapConversationRow(row), messages: [], hasMore: false }
    }
    const limit =
      typeof input.limit === 'number' && input.limit > 0 ? Math.trunc(input.limit) : null
    if (limit !== null) {
      const beforeClause =
        typeof input.beforeSequence === 'number' ? 'AND sequence < ?' : ''
      const params: SqliteBindings =
        typeof input.beforeSequence === 'number'
          ? [input.conversationId, input.beforeSequence, limit + 1]
          : [input.conversationId, limit + 1]
      const descRows = this.host.db
        .prepare(
          `SELECT * FROM chat_messages
           WHERE conversation_id = ? ${beforeClause}
           ORDER BY sequence DESC, created_at DESC
           LIMIT ?`
        )
        .all(...params)
      const hasMore = descRows.length > limit
      const pageRows = (hasMore ? descRows.slice(0, limit) : descRows).reverse()
      return {
        conversation: mapConversationRow(row),
        messages: pageRows.map(mapMessageRow),
        hasMore
      }
    }
    const rows = this.host.db
      .prepare(
        `SELECT * FROM chat_messages
         WHERE conversation_id = ?
         ORDER BY sequence ASC, created_at ASC`
      )
      .all(input.conversationId)
    return {
      conversation: mapConversationRow(row),
      messages: rows.map(mapMessageRow),
      hasMore: false
    }
  }

  deleteConversation(conversationId: string): boolean {
    this.assertWritable()
    return this.host.transaction((db) => {
      db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(conversationId)
      const result = db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(conversationId)
      return Number(result.changes) > 0
    })
  }

  importConversations(entries: readonly UpsertChatConversationTurnInput[]): {
    importedCount: number
  } {
    this.assertWritable()
    if (entries.length === 0) {
      return { importedCount: 0 }
    }
    const now = Date.now()
    return this.host.transaction((db) => {
      const insertConv = db.prepare(
        `INSERT OR IGNORE INTO chat_conversations (
           id, kind, workspace_key, workspace_id, scope_key, title, status,
           config_json, metadata_json, created_at, updated_at, last_message_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertMsg = db.prepare(
        `INSERT OR IGNORE INTO chat_messages (
           id, conversation_id, sequence, role, content, status, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      let importedCount = 0
      for (const entry of entries) {
        const conv = entry.conversation
        const safeStatus: ChatConversationStatus =
          conv.status === 'running' ? 'interrupted' : conv.status
        const result = insertConv.run(
          conv.id,
          conv.kind,
          normalizeConversationWorkspaceKey(conv.workspaceId),
          conv.workspaceId ?? null,
          conv.scopeKey,
          conv.title,
          safeStatus,
          conv.configJson ?? '{}',
          conv.metadataJson ?? '{}',
          conv.createdAt ?? now,
          conv.updatedAt ?? now,
          conv.lastMessageAt ?? conv.updatedAt ?? now
        )
        if (Number(result.changes) > 0) {
          importedCount += 1
          for (const msg of entry.messages) {
            const safeMsgStatus: ChatMessageStatus =
              msg.status === 'pending' || msg.status === 'streaming' ? 'interrupted' : msg.status
            insertMsg.run(
              msg.id,
              conv.id,
              msg.sequence,
              msg.role,
              msg.content,
              safeMsgStatus,
              msg.metadataJson ?? '{}',
              msg.createdAt ?? now,
              msg.updatedAt ?? now
            )
          }
        }
      }
      return { importedCount }
    })
  }

  getKvState(key: string): string | null {
    if (!hasTable(this.host.db, 'chat_kv_state')) {
      return null
    }
    const row = this.host.db.prepare('SELECT value_json FROM chat_kv_state WHERE key = ?').get(key)
    return row ? asNullableString(row.value_json) : null
  }

  setKvState(key: string, valueJson: string): void {
    this.assertWritable()
    const now = Date.now()
    this.host.transaction((db) => {
      db.prepare(
        `INSERT INTO chat_kv_state (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      ).run(key, valueJson, now)
    })
  }

  importKvStateIfMissing(entries: Record<string, string>): number {
    this.assertWritable()
    const keys = Object.keys(entries)
    if (keys.length === 0) {
      return 0
    }
    const now = Date.now()
    return this.host.transaction((db) => {
      const insertKv = db.prepare(
        `INSERT OR IGNORE INTO chat_kv_state (key, value_json, updated_at)
         VALUES (?, ?, ?)`
      )
      let imported = 0
      for (const key of keys) {
        const result = insertKv.run(key, entries[key]!, now)
        if (Number(result.changes) > 0) {
          imported += 1
        }
      }
      return imported
    })
  }

  listWorkspaceStructuredHistory(
    workspaceId?: string | null
  ): ChatWorkspaceStructuredHistoryEntry[] {
    if (!hasTable(this.host.db, 'agent_session_records')) {
      return []
    }
    const targetKey =
      workspaceId !== undefined ? normalizeConversationWorkspaceKey(workspaceId) : null
    const openTabsBySessionId = new Map<string, string>()
    if (hasTable(this.host.db, 'agent_session_tabs')) {
      for (const row of this.host.db
        .prepare('SELECT tab_id, session_id FROM agent_session_tabs ORDER BY position ASC')
        .all()) {
        const sessionId = asNullableString(row.session_id)
        const tabId = asNullableString(row.tab_id)
        if (sessionId && tabId && !openTabsBySessionId.has(sessionId)) {
          openTabsBySessionId.set(sessionId, tabId)
        }
      }
    }
    const journalWorkspaceBySessionId = new Map<string, string>()
    if (hasTable(this.host.db, 'journal_sessions')) {
      for (const row of this.host.db
        .prepare('SELECT session_id, workspace_id FROM journal_sessions')
        .all()) {
        const sessionId = asNullableString(row.session_id)
        const wsId = asNullableString(row.workspace_id)
        if (sessionId && wsId) {
          journalWorkspaceBySessionId.set(sessionId, wsId)
        }
      }
    }
    const entries: ChatWorkspaceStructuredHistoryEntry[] = []
    for (const row of this.host.db
      .prepare('SELECT session_id, record_json FROM agent_session_records ORDER BY rowid DESC')
      .all()) {
      const sessionId = asNullableString(row.session_id)
      const recordJson = asNullableString(row.record_json)
      if (!sessionId || !recordJson) {
        continue
      }
      const parsed = parseJsonRecord(recordJson)
      if (!parsed) {
        continue
      }
      const location =
        typeof parsed.location === 'object' && parsed.location !== null
          ? (parsed.location as Record<string, unknown>)
          : null
      const recordWorkspaceId =
        asNullableString(location?.workspaceId) ?? journalWorkspaceBySessionId.get(sessionId) ?? null
      if (!recordWorkspaceId) {
        continue
      }
      const workspaceKey = normalizeConversationWorkspaceKey(recordWorkspaceId)
      if (targetKey !== null && workspaceKey !== targetKey) {
        continue
      }
      const lease =
        typeof parsed.lease === 'object' && parsed.lease !== null
          ? (parsed.lease as Record<string, unknown>)
          : null
      const tabId = openTabsBySessionId.get(sessionId) ?? null
      entries.push({
        sessionId,
        agent: asString(parsed.provider) || 'unknown',
        workspaceId: recordWorkspaceId,
        workspaceKey,
        title: asNullableString(parsed.conversationName) ?? asNullableString(parsed.title),
        createdAt: asNumber(parsed.createdAt),
        updatedAt: asNumber(parsed.updatedAt) || asNumber(parsed.createdAt),
        tabId,
        isOpenTab: tabId !== null,
        status: asNullableString(lease?.claimStatus)
      })
    }
    entries.sort((left, right) => right.updatedAt - left.updatedAt)
    return entries
  }
}

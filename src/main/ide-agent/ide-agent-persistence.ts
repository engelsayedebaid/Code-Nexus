import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import SyncDatabase from '../sqlite/sync-database'
import { getCanonicalUserDataPath } from '../persistence/loading-store/user-data-path'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeRunStatus,
  IdeTodoItem
} from '../../shared/ide-agent/ide-agent-types'

const ACTIVE_TRANSIENT_STATUSES = new Set<IdeRunStatus>([
  'analyzing',
  'planning',
  'executing',
  'verifying'
])

function normalizeRestoredConversation(raw: IdeConversation): IdeConversation {
  let changed = false
  let status = raw.status
  if (ACTIVE_TRANSIENT_STATUSES.has(status)) {
    status = raw.activePlanId ? 'paused' : 'canceled'
    changed = true
  }
  const messages = raw.messages.map((msg) => {
    if (!msg.streaming) {
      return msg
    }
    changed = true
    return { ...msg, streaming: false }
  })
  const commandExecutions = raw.commandExecutions.map((cmd) => {
    if (cmd.status !== 'running') {
      return cmd
    }
    changed = true
    return {
      ...cmd,
      status: 'canceled' as const,
      finishedAt: raw.updatedAt
    }
  })
  if (!changed) {
    return raw
  }
  return {
    ...raw,
    status,
    activeRunId: status === 'canceled' ? null : raw.activeRunId,
    messages,
    commandExecutions
  }
}

export class IdeAgentStore {
  private readonly db: SyncDatabase

  constructor(databasePath?: string) {
    const resolvedPath =
      databasePath ?? join(getCanonicalUserDataPath(), 'ide-agent.sqlite')
    if (resolvedPath !== ':memory:') {
      mkdirSync(dirname(resolvedPath), { recursive: true })
    }
    this.db = new SyncDatabase(resolvedPath, { timeout: 5000 })
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ide_conversations (
        id TEXT PRIMARY KEY,
        workspace_key TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ide_conversations_workspace
        ON ide_conversations (workspace_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ide_todos (
        workspace_key TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        items_json TEXT NOT NULL
      );
    `)
  }

  listConversationSummaries(workspaceKey: string): IdeConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM ide_conversations WHERE workspace_key = ? ORDER BY updated_at DESC`
      )
      .all(workspaceKey) as { payload_json: string }[]
    const summaries: IdeConversationSummary[] = []
    for (const row of rows) {
      try {
        const parsed = normalizeRestoredConversation(
          JSON.parse(row.payload_json) as IdeConversation
        )
        summaries.push({
          id: parsed.id,
          workspaceKey: parsed.workspaceKey,
          title: parsed.title,
          mode: parsed.mode,
          agentId: parsed.agentId,
          modelId: parsed.modelId,
          status: parsed.status,
          messageCount: parsed.messages.length,
          updatedAt: parsed.updatedAt,
          createdAt: parsed.createdAt
        })
      } catch {
        // Ignore corrupted JSON rows rather than breaking the workspace list.
      }
    }
    return summaries
  }

  getConversation(conversationId: string): IdeConversation | null {
    const row = this.db
      .prepare(`SELECT payload_json FROM ide_conversations WHERE id = ?`)
      .get(conversationId) as { payload_json: string } | undefined
    if (!row) {
      return null
    }
    try {
      const parsed = JSON.parse(row.payload_json) as IdeConversation
      return normalizeRestoredConversation(parsed)
    } catch {
      return null
    }
  }

  saveConversation(conversation: IdeConversation): void {
    this.db
      .prepare(
        `INSERT INTO ide_conversations (id, workspace_key, workspace_path, updated_at, payload_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_key = excluded.workspace_key,
           workspace_path = excluded.workspace_path,
           updated_at = excluded.updated_at,
           payload_json = excluded.payload_json`
      )
      .run(
        conversation.id,
        conversation.workspaceKey,
        conversation.workspacePath,
        conversation.updatedAt,
        JSON.stringify(conversation)
      )
  }

  deleteConversation(conversationId: string): void {
    this.db.prepare(`DELETE FROM ide_conversations WHERE id = ?`).run(conversationId)
  }

  listTodos(workspaceKey: string): IdeTodoItem[] {
    const row = this.db
      .prepare(`SELECT items_json FROM ide_todos WHERE workspace_key = ?`)
      .get(workspaceKey) as { items_json: string } | undefined
    if (!row) {
      return []
    }
    try {
      const parsed = JSON.parse(row.items_json)
      return Array.isArray(parsed) ? (parsed as IdeTodoItem[]) : []
    } catch {
      return []
    }
  }

  saveTodos(workspaceKey: string, items: IdeTodoItem[]): void {
    this.db
      .prepare(
        `INSERT INTO ide_todos (workspace_key, updated_at, items_json)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_key) DO UPDATE SET
           updated_at = excluded.updated_at,
           items_json = excluded.items_json`
      )
      .run(workspaceKey, Date.now(), JSON.stringify(items))
  }

  close(): void {
    this.db.close()
  }
}

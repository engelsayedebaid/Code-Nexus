import { existsSync, statSync, statfsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type Database from '../sqlite/sync-database'

const MIN_BACKUP_HEADROOM_BYTES = 64 * 1024 * 1024

export function createChatConversationTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  workspace_id TEXT,
  scope_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace_kind_last_msg
  ON chat_conversations (workspace_key, kind, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_scope_key
  ON chat_conversations (scope_key, last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_sequence
  ON chat_messages (conversation_id, sequence ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS chat_kv_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  )
}

/** Back up an existing populated database before adding the chat conversation tables. */
export async function backupDatabaseBeforeChatTableMigration(
  db: Database.Database,
  dbPath: string | null
): Promise<string | null> {
  if (!dbPath || dbPath === ':memory:' || !existsSync(dbPath)) {
    return null
  }
  if (tableExists(db, 'chat_conversations')) {
    return null
  }
  const hasExistingData =
    tableExists(db, 'journal_rows') || tableExists(db, 'agent_session_records')
  if (!hasExistingData) {
    return null
  }
  try {
    const dbSize = statSync(dbPath).size
    const stats = statfsSync(dirname(dbPath))
    const freeBytes = Number(stats.bavail) * Number(stats.bsize)
    if (freeBytes <= dbSize + MIN_BACKUP_HEADROOM_BYTES) {
      console.warn(
        `[chat-conversations] Skipping full pre-migration DB backup due to limited disk space (${Math.round(freeBytes / 1048576)}MB free for ${Math.round(dbSize / 1048576)}MB DB)`
      )
      return null
    }
    const backupPath = join(
      dirname(dbPath),
      `${basename(dbPath)}.pre-chat-tables.${Date.now()}.db`
    )
    await db.backup(backupPath)
    return backupPath
  } catch (error) {
    console.warn('[chat-conversations] Pre-migration DB backup skipped due to error:', error)
    return null
  }
}

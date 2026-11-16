import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMART_PASTE_CONFIG } from '../../shared/smart-paste/smart-paste-config'
import { IdeAttachmentStore } from './ide-attachment-store'

let tempRoot: string
let store: IdeAttachmentStore

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'orca-ide-att-'))
  store = new IdeAttachmentStore(join(tempRoot, 'ide-agent-attachments'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('IdeAttachmentStore', () => {
  it('persists pasted text with structured metadata without exposing storage paths and survives restart', async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `item_${i + 1} = "val_${i + 1}"`).join(
      '\n'
    )
    const meta = await store.savePastedText({
      conversationId: 'conv-alpha',
      displayName: 'Pasted text',
      content: lines
    })

    expect(meta.kind).toBe('pasted_text')
    expect(meta.name).toBe('Pasted text')
    expect(meta.lineCount).toBe(2000)
    expect(meta.sizeBytes).toBe(Buffer.byteLength(lines, 'utf8'))
    expect(meta.status).toBe('ready')
    expect('relativePath' in meta).toBe(false)
    expect(JSON.stringify(meta)).not.toContain(tempRoot)

    // Simulate app restart with a fresh store instance.
    const reloaded = new IdeAttachmentStore(join(tempRoot, 'ide-agent-attachments'))
    const full = await reloaded.readFullText('conv-alpha', meta.id)
    expect(full).toMatchObject({ exists: true, lineCount: 2000, content: lines })

    const page = await reloaded.readRange({
      conversationId: 'conv-alpha',
      attachmentId: meta.id,
      startLine: 1995,
      endLine: 2000
    })
    expect(page.exists).toBe(true)
    expect(page.content).toContain('item_2000 = "val_2000"')
    expect(page.hasMore).toBe(false)
  })

  it('enforces conversation isolation, search, path traversal defense, and size caps', async () => {
    const saved = await store.savePastedText({
      conversationId: 'conv-owner',
      content: 'alpha\nNEEDLE_TOKEN here\nomega'
    })

    // Another conversation cannot read owner's attachment.
    await expect(store.readFullText('conv-other', saved.id)).resolves.toEqual({ exists: false })

    // Traversal IDs are rejected before any filesystem operation.
    await expect(store.readFullText('../escape', saved.id)).rejects.toThrow(
      'Invalid conversationId'
    )
    await expect(store.readFullText('conv-owner', '../secret')).rejects.toThrow(
      'Invalid attachmentId'
    )

    // Search works inside owning conversation.
    const search = await store.searchContent({
      conversationId: 'conv-owner',
      attachmentId: saved.id,
      query: 'needle_token'
    })
    expect(search.exists).toBe(true)
    expect(search.hits).toEqual([{ line: 2, preview: 'NEEDLE_TOKEN here' }])

    // Reject oversized payloads.
    await expect(
      store.savePastedText({
        conversationId: 'conv-owner',
        content: 'a'.repeat(SMART_PASTE_CONFIG.maxAttachmentBytes + 1)
      })
    ).rejects.toThrow('exceeds maximum')

    // Delete conversation cleans up attachment directory.
    await store.deleteConversationAttachments('conv-owner')
    await expect(store.readFullText('conv-owner', saved.id)).resolves.toEqual({ exists: false })
  })

  it('rejects symlinked attachment targets on platforms supporting symlinks', async () => {
    const outside = join(tempRoot, 'secret.txt')
    await writeFile(outside, 'top-secret', 'utf8')
    const saved = await store.savePastedText({
      conversationId: 'conv-sym',
      attachmentId: 'paste-sym-1',
      content: 'safe'
    })
    await rm(join(store.rootDir, 'conv-sym', `${saved.id}.txt`))
    try {
      await symlink(outside, join(store.rootDir, 'conv-sym', `${saved.id}.txt`))
    } catch {
      return
    }
    await expect(store.readFullText('conv-sym', saved.id)).rejects.toThrow()
  })
})

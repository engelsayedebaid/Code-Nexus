import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentSessionAttachmentStore } from './agent-session-attachment-store'
import { setAgentSessionAttachmentStore } from './agent-session-attachment-store-registry'
import { statAgentSessionAttachment } from './agent-session-attachment-stat'
import {
  hasStorePastedTextReference,
  resolveAgentSessionBodyPastedText,
  resolvePastedTextReferencesInString
} from './agent-session-text-attachment-dispatch'
import type { AgentJournalMessageItem } from '../../../shared/agent-session/journal/agent-session-journal-types'

let tempRoot: string
let store: AgentSessionAttachmentStore

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'orca-text-dispatch-'))
  store = new AgentSessionAttachmentStore(join(tempRoot, 'agent-session-attachments'), {
    hasSession: (id) => id === 'session-1'
  })
  setAgentSessionAttachmentStore(store)
})

afterEach(async () => {
  store.clearInFlightForTests()
  setAgentSessionAttachmentStore(null)
  await rm(tempRoot, { recursive: true, force: true })
})

describe('agent-session text attachment dispatch & stat', () => {
  it('stats committed paste files and reports missing files without escaping store root', async () => {
    const content = Array.from({ length: 120 }, (_, i) => `row-${i + 1}`).join('\n')
    const savedPath = await store.storeFile(
      'orca-paste-12345678-1234-1234-1234-1234567890ab.txt',
      Buffer.from(content, 'utf8')
    )

    await expect(statAgentSessionAttachment(store.rootDir, savedPath)).resolves.toEqual({
      exists: true,
      sizeBytes: Buffer.byteLength(content, 'utf8')
    })

    await rm(savedPath)
    await expect(statAgentSessionAttachment(store.rootDir, savedPath)).resolves.toEqual({
      exists: false,
      sizeBytes: null
    })

    await expect(
      statAgentSessionAttachment(store.rootDir, join(tempRoot, 'outside.txt'))
    ).rejects.toThrow('Not a committed chat attachment')
  })

  it('expands full 2000-line pasted attachments inline for ACP/Codex without sending raw path', async () => {
    const twoThousandLines = Array.from({ length: 2000 }, (_, i) => `ln ${i + 1}`).join('\n')
    const savedPath = await store.storeFile(
      'orca-paste-12345678-1234-1234-1234-1234567890ab.txt',
      Buffer.from(twoThousandLines, 'utf8')
    )

    const body: AgentJournalMessageItem = {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: `Analyze:\n@"${savedPath}"` }]
    }

    expect(hasStorePastedTextReference(body, store.rootDir)).toBe(true)
    const resolved = await resolveAgentSessionBodyPastedText(body, {
      mode: 'inline',
      storeRoot: store.rootDir,
      inlineBudgetBytes: 64 * 1024
    })
    const promptText = resolved.blocks[0].type === 'text' ? resolved.blocks[0].text : ''
    expect(promptText).toContain('ln 1')
    expect(promptText).toContain('ln 2000')
    expect(promptText).toContain('2000 lines')
    expect(promptText).not.toContain('agent-session-attachments')
  })

  it('bounds oversized attachments with explicit line notice instead of silent truncation', async () => {
    const bigPayload = Array.from(
      { length: 500 },
      (_, i) => `line-${i + 1}: ${'z'.repeat(80)}`
    ).join('\n')
    const savedPath = await store.storeFile(
      'orca-paste-12345678-1234-1234-1234-1234567890ab.txt',
      Buffer.from(bigPayload, 'utf8')
    )

    const resolved = await resolvePastedTextReferencesInString(`@"${savedPath}"`, {
      mode: 'inline',
      storeRoot: store.rootDir,
      inlineBudgetBytes: 2048
    })
    expect(resolved.text).toContain('Showing lines 1–')
    expect(resolved.text).toContain('of 500')
    expect(resolved.text).toContain('omitted by')
  })

  it('throws an explicit error when the stored paste file was deleted or symlinked', async () => {
    const savedPath = await store.storeFile(
      'orca-paste-12345678-1234-1234-1234-1234567890ab.txt',
      Buffer.from('hello world', 'utf8')
    )
    await rm(savedPath)

    await expect(
      resolvePastedTextReferencesInString(`@"${savedPath}"`, {
        mode: 'inline',
        storeRoot: store.rootDir
      })
    ).rejects.toThrow('missing or no longer available')

    if (process.platform !== 'win32') {
      const outside = join(tempRoot, 'secret.txt')
      await symlink(outside, savedPath).catch(() => {})
      await expect(
        resolvePastedTextReferencesInString(`@"${savedPath}"`, {
          mode: 'verify-path',
          storeRoot: store.rootDir
        })
      ).rejects.toThrow()
    }
  })
})

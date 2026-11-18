import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeProviderAgentOption
} from '../../shared/ide-agent/ide-agent-types'
import { IdeAgentEngine } from './ide-agent-engine'
import { IdeAgentStore } from './ide-agent-persistence'
import type { IdeAiClient, IdeAiCompletionRequest, IdeAiCompletionResponse } from './ide-ai-client'
import type {
  IdeWorkspaceGateway,
  IdeWorkspaceTarget,
  WorkspaceInspectionSnapshot,
  WorkspaceWriteResult
} from './ide-workspace-gateway'

class TestAiClient implements IdeAiClient {
  requests: IdeAiCompletionRequest[] = []
  private responder: (req: IdeAiCompletionRequest) => Promise<IdeAiCompletionResponse> =
    async () => ({ ok: true, text: 'Answered.' })

  setResponder(
    fn: (req: IdeAiCompletionRequest) => IdeAiCompletionResponse | Promise<IdeAiCompletionResponse>
  ): void {
    this.responder = async (req) => fn(req)
  }

  async listProviders(): Promise<IdeProviderAgentOption[]> {
    return []
  }

  async complete(req: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> {
    this.requests.push(req)
    return this.responder(req)
  }
}

class TestGateway implements IdeWorkspaceGateway {
  readonly target: IdeWorkspaceTarget = {
    worktreeId: 'wt-smart',
    workspacePath: '/ws',
    executionHostId: LOCAL_EXECUTION_HOST_ID
  }

  async inspectWorkspace(): Promise<WorkspaceInspectionSnapshot> {
    return {
      workspacePath: '/ws',
      isGitRepo: false,
      fileList: ['src/app.ts'],
      keyFiles: [],
      blockedSecretFiles: []
    }
  }

  async readTextFile() {
    return { ok: true as const, content: null, sha256: null }
  }

  async writeTextChunk(relativePath: string, content: string): Promise<WorkspaceWriteResult> {
    return { ok: true, relativePath, sha256: 'sha', created: true, persistedContent: content }
  }

  async deleteWorkspaceFile(_relativePath: string, _options: { mode: IdeExecutionMode }) {
    return { ok: true as const }
  }

  async getGitDiffSummary() {
    return null
  }

  async runShellCommand() {
    return { exitCode: 0, stdout: '', stderr: '', canceled: false, timedOut: false, durationMs: 0 }
  }
}

const dirs: string[] = []
const openedStores: IdeAgentStore[] = []

afterEach(async () => {
  while (openedStores.length > 0) {
    openedStores.pop()!.close()
  }
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 })
  }
})

async function createDiskEngine() {
  const dir = await mkdtemp(join(tmpdir(), 'orca-ide-engine-att-'))
  dirs.push(dir)
  const dbPath = join(dir, 'ide-agent.sqlite')
  const store = new IdeAgentStore(dbPath)
  openedStores.push(store)
  const aiClient = new TestAiClient()
  const engine = new IdeAgentEngine({
    store,
    aiClient,
    resolveGateway: async () => new TestGateway(),
    defaultAgentId: 'claude',
    chunkDelayMs: 0
  })
  return { dir, dbPath, store, aiClient, engine }
}

async function waitTerminal(store: IdeAgentStore, convId: string): Promise<IdeConversation> {
  return vi.waitFor(() => {
    const conv = store.getConversation(convId)
    if (!conv || (conv.status !== 'completed' && conv.status !== 'failed')) {
      throw new Error(`waiting for terminal status (currently ${conv?.status})`)
    }
    return conv
  })
}

describe('IdeAgentEngine smart paste E2E', () => {
  it('stores 2000-line attachment without exposing path in message and delivers full text to AI + survives restart', async () => {
    const { dbPath, store, aiClient, engine } = await createDiskEngine()
    const conv = engine.createConversation({
      workspaceKey: 'ws-key',
      workspacePath: '/ws'
    })

    const twoThousandLines = Array.from(
      { length: 2000 },
      (_, idx) => `const entry_${idx + 1} = ${idx + 1}`
    ).join('\n')
    const att = await engine.savePastedAttachment({
      conversationId: conv.id,
      displayName: 'Pasted text',
      content: twoThousandLines
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: 'wt-smart',
      text: 'Summarize the pasted constants.',
      mode: 'ask',
      attachments: [att]
    })

    const settled = await waitTerminal(store, conv.id)
    expect(settled.status).toBe('completed')
    const userMsg = settled.messages.find((m) => m.role === 'user')!
    expect(userMsg.text).toBe('Summarize the pasted constants.')
    expect(userMsg.text).not.toContain('ide-agent-attachments')
    expect(userMsg.attachments?.[0]).toMatchObject({
      id: att.id,
      kind: 'pasted_text',
      name: 'Pasted text',
      lineCount: 2000,
      truncatedInPrompt: false
    })

    // AI received full verbatim 2000 lines.
    expect(aiClient.requests[0].prompt).toContain('const entry_1 = 1')
    expect(aiClient.requests[0].prompt).toContain('const entry_2000 = 2000')
    expect(aiClient.requests[0].prompt).not.toContain('ide-agent-attachments')

    // Reopen store/engine from disk and inspect attachment content + delete cleanup.
    const reloadedStore = new IdeAgentStore(dbPath)
    openedStores.push(reloadedStore)
    const reloadedEngine = new IdeAgentEngine({
      store: reloadedStore,
      aiClient: new TestAiClient(),
      resolveGateway: async () => new TestGateway(),
      chunkDelayMs: 0
    })
    const readBack = await reloadedEngine.readAttachmentContent({
      conversationId: conv.id,
      attachmentId: att.id,
      startLine: 1998,
      endLine: 2000
    })
    expect(readBack.exists).toBe(true)
    expect(readBack.content).toContain('entry_2000 = 2000')

    reloadedEngine.deleteConversation(conv.id)
    await vi.waitFor(async () => {
      await expect(access(join(reloadedStore.attachmentsRootDir!, conv.id))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    })
  })

  it('bounds oversized attachment inline and lets AI inspect full content via read-only attachment tools', async () => {
    const { store, aiClient, engine } = await createDiskEngine()
    const conv = engine.createConversation({ workspaceKey: 'ws-tools', workspacePath: '/ws' })

    const huge = Array.from(
      { length: 1200 },
      (_, idx) => `log_${idx + 1}: ${idx === 1190 ? 'ROOT_CAUSE_XYZ' : 'ok_'.repeat(30)}`
    ).join('\n')
    const att = await engine.savePastedAttachment({
      conversationId: conv.id,
      content: huge
    })

    let turn = 0
    aiClient.setResponder((req) => {
      turn += 1
      if (turn === 1) {
        return {
          ok: true,
          text: JSON.stringify({
            toolCalls: [
              { tool: 'list_message_attachments', args: {} },
              {
                tool: 'search_attachment_content',
                args: { attachmentId: att.id, query: 'ROOT_CAUSE_XYZ' }
              },
              {
                tool: 'read_attachment_range',
                args: { attachmentId: att.id, startLine: 1188, endLine: 1195 }
              }
            ]
          })
        }
      }
      expect(req.prompt).toContain('ROOT_CAUSE_XYZ')
      return { ok: true, text: 'Found ROOT_CAUSE_XYZ at line 1191.' }
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: 'wt-smart',
      text: 'Find root cause in attachment',
      mode: 'ask',
      attachments: [att]
    })

    const settled = await waitTerminal(store, conv.id)
    expect(settled.status).toBe('completed')
    const userMsg = settled.messages.find((m) => m.role === 'user')!
    expect(userMsg.attachments?.[0]?.truncatedInPrompt).toBe(true)
    expect(aiClient.requests[0].prompt).toContain('PARTIAL EXCERPT')
    expect(settled.messages.at(-1)?.text).toContain('Found ROOT_CAUSE_XYZ at line 1191.')
  })

  it('fails honestly and marks attachment missing when stored file is deleted before turn execution', async () => {
    const { dir, store, aiClient, engine } = await createDiskEngine()
    const conv = engine.createConversation({ workspaceKey: 'ws-missing', workspacePath: '/ws' })
    const att = await engine.savePastedAttachment({
      conversationId: conv.id,
      content: 'a'.repeat(2500)
    })

    await rm(join(dir, 'ide-agent-attachments', conv.id, `${att.id}.txt`))

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: 'wt-smart',
      text: 'Read this missing attachment',
      mode: 'ask',
      attachments: [att]
    })

    const settled = await waitTerminal(store, conv.id)
    expect(settled.status).toBe('failed')
    expect(aiClient.requests).toHaveLength(0)
    const userMsg = settled.messages.find((m) => m.role === 'user')!
    expect(userMsg.attachments?.[0]?.status).toBe('missing')
    expect(settled.messages.at(-1)?.text).toContain('missing')
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { IdeAgentStreamEvent } from '../../shared/ide-agent/ide-agent-events'
import type { IdeConversation, IdeRunStatus } from '../../shared/ide-agent/ide-agent-types'
import type { IdeAiClient, IdeAiCompletionRequest, IdeAiCompletionResponse } from './ide-ai-client'
import { IdeAgentEngine } from './ide-agent-engine'
import { IdeAgentStore } from './ide-agent-persistence'
import { LocalIdeWorkspaceGateway, type WorkspaceCommandRunResult } from './ide-workspace-gateway'

const stores: IdeAgentStore[] = []
const tempDirs: string[] = []

class ScriptedAiClient implements IdeAiClient {
  requests: IdeAiCompletionRequest[] = []
  private responder: (
    req: IdeAiCompletionRequest,
    turn: number
  ) => Promise<IdeAiCompletionResponse> | IdeAiCompletionResponse = async () => ({
    ok: true,
    text: 'done'
  })
  private turn = 0

  setResponder(
    fn: (
      req: IdeAiCompletionRequest,
      turn: number
    ) => Promise<IdeAiCompletionResponse> | IdeAiCompletionResponse
  ): void {
    this.turn = 0
    this.responder = fn
  }

  async listProviders() {
    return [
      {
        id: 'claude',
        label: 'Claude',
        binary: 'claude',
        available: true,
        defaultModelId: 'claude-sonnet-4-6',
        supportsStreaming: true,
        supportsToolLoop: true,
        models: [
          {
            id: 'claude-sonnet-4-6',
            label: 'Claude Sonnet',
            isDefault: true,
            contextWindowTokens: 200000
          }
        ]
      }
    ]
  }

  async complete(request: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> {
    this.requests.push(request)
    this.turn += 1
    return this.responder(request, this.turn)
  }
}

class TestLocalGateway extends LocalIdeWorkspaceGateway {
  shellResponder: (cmd: string) => Promise<WorkspaceCommandRunResult> | WorkspaceCommandRunResult =
    async () => ({
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      timedOut: false,
      canceled: false,
      durationMs: 12
    })

  override async runShellCommand(command: string): Promise<WorkspaceCommandRunResult> {
    return this.shellResponder(command)
  }
}

afterEach(async () => {
  while (stores.length > 0) {
    stores.pop()!.close()
  }
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

async function createHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'orca-ide-harness-'))
  tempDirs.push(dir)
  const store = new IdeAgentStore(':memory:')
  stores.push(store)
  const aiClient = new ScriptedAiClient()
  const gateway = new TestLocalGateway({
    worktreeId: 'wt-harness',
    workspacePath: dir,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  })
  const engine = new IdeAgentEngine({
    store,
    aiClient,
    resolveGateway: async () => gateway,
    defaultAgentId: 'claude',
    chunkDelayMs: 0
  })
  return { dir, store, aiClient, gateway, engine }
}

function waitForConversationStatus(
  engine: IdeAgentEngine,
  store: IdeAgentStore,
  conversationId: string,
  targets: readonly IdeRunStatus[]
): Promise<IdeConversation> {
  const existing = store.getConversation(conversationId)
  if (existing && targets.includes(existing.status)) {
    return Promise.resolve(existing)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      const latest = store.getConversation(conversationId)
      reject(new Error(`Timed out waiting for [${targets.join(', ')}]; status=${latest?.status}`))
    }, 5000)
    const unsub = engine.subscribe((event) => {
      if (event.type === 'conversation_updated' && targets.includes(event.conversation.status)) {
        clearTimeout(timer)
        unsub()
        resolve(event.conversation)
      }
    }, conversationId)
  })
}

describe('IdeAgentEngine agent harness', () => {
  it('runs read-only tool inspection loop and blocks repeated failing tool calls via loop guard', async () => {
    const { dir, store, aiClient, engine } = await createHarness()
    await writeFile(join(dir, 'target.ts'), 'export const ANSWER = 42\n', 'utf8')

    aiClient.setResponder((_req, turn) => {
      if (turn === 1) {
        return {
          ok: true,
          text: '```json\n{"toolCalls":[{"tool":"read_file","args":{"path":"missing.ts"}},{"tool":"read_file","args":{"path":"target.ts"}}]}\n```'
        }
      }
      if (turn === 2) {
        // Repeating failed missing.ts must be blocked by AgentLoopGuard before touching gateway
        return {
          ok: true,
          text: '```json\n{"toolCalls":[{"tool":"read_file","args":{"path":"missing.ts"}}]}\n```'
        }
      }
      return {
        ok: true,
        text: 'Found `ANSWER = 42` in `target.ts`.'
      }
    })

    const conv = engine.createConversation({ workspaceKey: dir, workspacePath: dir })
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: dir,
      text: 'Inspect target.ts',
      mode: 'ask'
    })

    const finished = await waitForConversationStatus(engine, store, conv.id, [
      'completed',
      'failed'
    ])
    expect(finished.status).toBe('completed')
    expect(aiClient.requests[1]?.prompt).toContain('ANSWER = 42')
    expect(aiClient.requests[2]?.prompt).toContain('Blocked repeating previously failed tool call')
    expect(finished.contextBudget?.loadedFiles).toBeGreaterThanOrEqual(1)
  })

  it('streams live character edit events before atomic disk commit for create/patch/mkdir/rename', async () => {
    const { dir, store, aiClient, engine } = await createHarness()
    const events: IdeAgentStreamEvent[] = []
    engine.subscribe((e) => events.push(e))

    aiClient.setResponder(async (req) => {
      if (req.prompt.includes('Mode: PLAN ONLY')) {
        return {
          ok: true,
          text: JSON.stringify({
            intro: 'Plan ready',
            objective: 'Create auth folder and helper',
            requestSummary: 'Build auth util',
            affectedFiles: [
              { path: 'src/auth', action: 'mkdir', summary: 'Create auth folder' },
              { path: 'src/auth/token.ts', action: 'create', summary: 'Create token helper' },
              {
                fromPath: 'src/auth/token.ts',
                path: 'src/auth/authToken.ts',
                action: 'rename',
                summary: 'Rename token helper'
              }
            ],
            steps: [
              {
                id: 's1',
                index: 1,
                title: 'Create files',
                detail: 'Make folder and token file',
                targetFiles: ['src/auth', 'src/auth/token.ts', 'src/auth/authToken.ts']
              }
            ],
            risks: [],
            testsAndVerification: [],
            estimatedComplexity: 'low',
            requiresApproval: true
          })
        }
      }
      if (req.prompt.includes('executing ONE approved step')) {
        const chunks = [
          '{"operations":[{"action":"mkdir","path":"src/auth"},',
          '{"action":"create","path":"src/auth/token.ts","content":"export const TOKEN = ',
          '\\"abc\\"\\n"},',
          '{"action":"patch","path":"src/auth/token.ts","patches":[{"search":"\\"abc\\"","replace":"\\"xyz\\""}]},',
          '{"action":"rename","fromPath":"src/auth/token.ts","path":"src/auth/authToken.ts"}]}'
        ]
        for (const chunk of chunks) {
          req.onDelta?.(chunk)
        }
        return {
          ok: true,
          text: `\`\`\`json\n${chunks.join('')}\n\`\`\``
        }
      }
      return { ok: true, text: 'All changes verified cleanly.' }
    })

    const conv = engine.createConversation({ workspaceKey: dir, workspacePath: dir })
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: dir,
      text: 'Create an auth folder, create a token helper, patch it, and rename it to authToken.ts with tests',
      mode: 'agent'
    })

    const awaiting = await waitForConversationStatus(engine, store, conv.id, ['awaiting_approval'])
    expect(awaiting.activePlanId).toBeTruthy()

    await engine.handlePlanDecision({
      conversationId: conv.id,
      planId: awaiting.activePlanId!,
      decision: 'approve'
    })

    const done = await waitForConversationStatus(engine, store, conv.id, ['completed', 'failed'])
    expect(done.status).toBe('completed')
    expect(await readFile(join(dir, 'src/auth/authToken.ts'), 'utf8')).toBe(
      'export const TOKEN = "xyz"\n'
    )

    const streamedChunks = events.filter(
      (e): e is Extract<IdeAgentStreamEvent, { type: 'editor_edit_chunk' }> =>
        e.type === 'editor_edit_chunk' && e.sourceKind === 'streamed'
    )
    expect(streamedChunks.length).toBeGreaterThanOrEqual(2)
    expect(streamedChunks[0]?.afterContent).toContain('export const TOKEN')
    expect(events.some((e) => e.type === 'folder_created' && e.relativePath === 'src/auth')).toBe(
      true
    )
    expect(
      events.some(
        (e) =>
          e.type === 'file_renamed' &&
          e.fromRelativePath === 'src/auth/token.ts' &&
          e.relativePath === 'src/auth/authToken.ts'
      )
    ).toBe(true)
  })

  it('marks the run failed honestly when a verification command fails and repair cannot fix it', async () => {
    const { dir, store, aiClient, gateway, engine } = await createHarness()
    gateway.shellResponder = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'FAIL src/math.test.ts: expected 2 to be 3',
      timedOut: false,
      canceled: false,
      durationMs: 12
    })

    aiClient.setResponder((req) => {
      if (req.prompt.includes('Mode: PLAN ONLY')) {
        return {
          ok: true,
          text: JSON.stringify({
            intro: 'Small fix',
            objective: 'Add sum function',
            requestSummary: 'Add sum and run test',
            affectedFiles: [
              { path: 'src/math.ts', action: 'create', summary: 'Create math helper' }
            ],
            steps: [
              {
                id: 's1',
                index: 1,
                title: 'Write math.ts',
                detail: 'Write sum',
                targetFiles: ['src/math.ts']
              }
            ],
            risks: [],
            testsAndVerification: ['pnpm test src/math.test.ts'],
            estimatedComplexity: 'low',
            requiresApproval: false
          })
        }
      }
      if (req.prompt.includes('Carver Test Fixer agent')) {
        return { ok: true, text: '{"operations":[]}' }
      }
      return {
        ok: true,
        text: JSON.stringify({
          operations: [
            {
              action: 'create',
              path: 'src/math.ts',
              content: 'export const add = (a: number, b: number) => a + b\n'
            }
          ]
        })
      }
    })

    const conv = engine.createConversation({ workspaceKey: dir, workspacePath: dir })
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: dir,
      text: 'Add math helper',
      mode: 'agent'
    })

    const done = await waitForConversationStatus(engine, store, conv.id, ['completed', 'failed'])
    expect(done.status).toBe('failed')
    expect(done.messages.at(-1)?.error).toContain('Verification failed: pnpm test src/math.test.ts')
  })

  it('aborts an in-flight execution immediately when stopped by the user', async () => {
    const { dir, store, aiClient, engine } = await createHarness()
    let markRequestStarted: (() => void) | null = null
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    let abortedObserved = false

    aiClient.setResponder((req) => {
      markRequestStarted?.()
      return new Promise<IdeAiCompletionResponse>((resolve) => {
        if (req.signal?.aborted) {
          abortedObserved = true
          resolve({ ok: false, error: 'Canceled', canceled: true })
          return
        }
        req.signal?.addEventListener(
          'abort',
          () => {
            abortedObserved = true
            resolve({ ok: false, error: 'Canceled', canceled: true })
          },
          { once: true }
        )
      })
    })

    const conv = engine.createConversation({ workspaceKey: dir, workspacePath: dir })
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: dir,
      text: 'Analyze project',
      mode: 'ask'
    })

    await requestStarted
    await engine.handleRunControl({
      conversationId: conv.id,
      runId: store.getConversation(conv.id)!.activeRunId!,
      action: 'stop'
    })

    const stopped = await waitForConversationStatus(engine, store, conv.id, ['canceled'])
    expect(stopped.status).toBe('canceled')
    expect(abortedObserved).toBe(true)
  })
})

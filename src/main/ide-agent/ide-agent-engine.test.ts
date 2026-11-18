import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeProviderAgentOption
} from '../../shared/ide-agent/ide-agent-types'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'
import type {
  IdeWorkspaceGateway,
  IdeWorkspaceTarget,
  WorkspaceWriteResult
} from './ide-workspace-gateway'
import type { IdeAiClient, IdeAiCompletionRequest, IdeAiCompletionResponse } from './ide-ai-client'
import { IdeAgentEngine } from './ide-agent-engine'
import { IdeAgentStore } from './ide-agent-persistence'

const WORKSPACE_PATH = '/ws'
const WORKTREE_SELECTOR = 'wt-test'

class FakeAiClient implements IdeAiClient {
  requests: IdeAiCompletionRequest[] = []
  private responder: (req: IdeAiCompletionRequest) => Promise<IdeAiCompletionResponse> =
    async () => ({ ok: true, text: 'ok' })
  private providers: IdeProviderAgentOption[] = []

  setResponder(
    responder: (
      req: IdeAiCompletionRequest
    ) => IdeAiCompletionResponse | Promise<IdeAiCompletionResponse>
  ): void {
    this.responder = async (req) => responder(req)
  }

  setProviders(providers: IdeProviderAgentOption[]): void {
    this.providers = providers
  }

  async listProviders(): Promise<IdeProviderAgentOption[]> {
    return this.providers
  }

  async complete(request: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> {
    this.requests.push(request)
    return this.responder(request)
  }
}

class FakeGateway implements IdeWorkspaceGateway {
  readonly target: IdeWorkspaceTarget = {
    worktreeId: WORKTREE_SELECTOR,
    workspacePath: WORKSPACE_PATH,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  }
  writes: { path: string; mode: IdeExecutionMode }[] = []
  deletes: { path: string; mode: IdeExecutionMode }[] = []

  async inspectWorkspace(): Promise<WorkspaceInspectionSnapshot> {
    return {
      workspacePath: WORKSPACE_PATH,
      isGitRepo: false,
      fileList: [],
      keyFiles: [],
      blockedSecretFiles: []
    }
  }

  async readTextFile(): Promise<{ ok: true; content: string | null; sha256: string | null }> {
    return { ok: true, content: null, sha256: null }
  }

  async writeTextChunk(
    relativePath: string,
    content: string,
    options: { mode: IdeExecutionMode }
  ): Promise<WorkspaceWriteResult> {
    this.writes.push({ path: relativePath, mode: options.mode })
    return { ok: true, relativePath, sha256: 'sha', created: true, persistedContent: content }
  }

  async deleteWorkspaceFile(
    relativePath: string,
    options: { mode: IdeExecutionMode }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    this.deletes.push({ path: relativePath, mode: options.mode })
    return { ok: true }
  }

  async getGitDiffSummary(): Promise<string | null> {
    return null
  }

  async runShellCommand(): Promise<{
    exitCode: number | null
    stdout: string
    stderr: string
    canceled: boolean
    timedOut: boolean
    durationMs: number
  }> {
    return { exitCode: 0, stdout: '', stderr: '', canceled: false, timedOut: false, durationMs: 0 }
  }
}

const stores: IdeAgentStore[] = []

function createEngine() {
  const store = new IdeAgentStore(':memory:')
  stores.push(store)
  const aiClient = new FakeAiClient()
  const gateway = new FakeGateway()
  const engine = new IdeAgentEngine({
    store,
    aiClient,
    resolveGateway: async () => gateway,
    defaultAgentId: 'claude',
    chunkDelayMs: 0
  })
  return { store, aiClient, gateway, engine }
}

async function waitForStatus(
  store: IdeAgentStore,
  conversationId: string,
  statuses: string[]
): Promise<IdeConversation> {
  return vi.waitFor(
    () => {
      const conv = store.getConversation(conversationId)
      if (!conv || !statuses.includes(conv.status)) {
        throw new Error(`Waiting for status ${statuses.join('/')} on ${conversationId}`)
      }
      return conv
    },
    { timeout: 5000 }
  )
}

async function waitForRequests(aiClient: FakeAiClient, count: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(aiClient.requests.length).toBeGreaterThanOrEqual(count)
    },
    { timeout: 5000 }
  )
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close()
  }
})

describe('IdeAgentEngine execution configuration', () => {
  it('routes the selected provider and model to the AI client on every request', async () => {
    const { store, aiClient, engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'ask',
      agentId: 'claude',
      modelId: 'sonnet'
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'What does this project do?',
      mode: 'ask'
    })
    await waitForStatus(store, conv.id, ['completed', 'failed'])

    engine.updateConversationSettings({
      conversationId: conv.id,
      agentId: 'kimi',
      modelId: 'kimi-code/k3'
    })
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'And now?',
      mode: 'ask'
    })
    await waitForStatus(store, conv.id, ['completed'])

    expect(aiClient.requests).toHaveLength(2)
    expect(aiClient.requests[0].agentId).toBe('claude')
    expect(aiClient.requests[0].modelId).toBe('sonnet')
    expect(aiClient.requests[1].agentId).toBe('kimi')
    expect(aiClient.requests[1].modelId).toBe('kimi-code/k3')
  })

  it('rejects unsupported providers and models unavailable for the provider', async () => {
    const { engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'ask'
    })

    expect(() =>
      engine.updateConversationSettings({ conversationId: conv.id, agentId: 'not-a-provider' })
    ).toThrow(/does not support IDE chat/)

    // kimi uses a static model list; unknown ids must fail explicitly.
    engine.updateConversationSettings({ conversationId: conv.id, agentId: 'kimi' })
    expect(() =>
      engine.updateConversationSettings({ conversationId: conv.id, modelId: 'bogus-model' })
    ).toThrow(/not available for Kimi/)

    // gemini has no non-interactive generation spec; creation falls back to an executable provider.
    const fallback = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      agentId: 'gemini',
      modelId: 'gemini-2.5-pro'
    })
    expect(fallback.agentId).toBe('claude')
    expect(fallback.modelId).toBe('sonnet')
  })

  it('keeps in-flight requests on their original config while newer selections persist', async () => {
    const { store, aiClient, engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'ask',
      agentId: 'claude',
      modelId: 'sonnet'
    })

    const gate = deferred<IdeAiCompletionResponse>()
    aiClient.setResponder(() => gate.promise)
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'long running question',
      mode: 'ask'
    })
    await waitForRequests(aiClient, 1)

    // User changes provider/model/mode while the request is in flight.
    engine.updateConversationSettings({
      conversationId: conv.id,
      agentId: 'kimi',
      modelId: 'kimi-code/k3',
      mode: 'review'
    })
    gate.resolve({ ok: true, text: 'done' })
    await waitForStatus(store, conv.id, ['completed', 'failed'])

    // The in-flight request kept its snapshot...
    expect(aiClient.requests[0].agentId).toBe('claude')
    expect(aiClient.requests[0].modelId).toBe('sonnet')
    // ...and the run's publishes did not clobber the newer selection.
    const persisted = store.getConversation(conv.id)!
    expect(persisted.agentId).toBe('kimi')
    expect(persisted.modelId).toBe('kimi-code/k3')
    expect(persisted.mode).toBe('review')
  })

  it('enforces mode write policy and passes the run mode to the workspace gateway', async () => {
    const { store, aiClient, gateway, engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'agent',
      agentId: 'claude',
      modelId: 'sonnet'
    })

    const planJson = JSON.stringify({
      objective: 'Create foo module',
      affectedFiles: [{ path: 'src/foo.ts', action: 'create', summary: 'new file' }],
      steps: [{ title: 'Create foo', detail: 'write file', targetFiles: ['src/foo.ts'] }],
      risks: [],
      testsAndVerification: [],
      estimatedComplexity: 'low'
    })
    const stepGate = deferred<IdeAiCompletionResponse>()
    let call = 0
    aiClient.setResponder(() => {
      call += 1
      if (call === 1) {
        return { ok: true, text: planJson }
      }
      return stepGate.promise
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'make a plan to create src/foo.ts',
      mode: 'agent'
    })
    const awaiting = await waitForStatus(store, conv.id, ['awaiting_approval', 'failed'])
    expect(awaiting.status).toBe('awaiting_approval')
    expect(gateway.writes).toHaveLength(0)

    await engine.handlePlanDecision({
      conversationId: conv.id,
      planId: awaiting.activePlanId!,
      worktreeSelector: WORKTREE_SELECTOR,
      decision: 'approve'
    })
    // Wait until the execution step request is in flight, then drop to read-only mode.
    await waitForRequests(aiClient, 2)
    engine.updateConversationSettings({ conversationId: conv.id, mode: 'ask' })
    stepGate.resolve({
      ok: true,
      text: JSON.stringify({
        summary: 'created foo',
        operations: [{ path: 'src/foo.ts', action: 'create', content: 'export const foo = 1\n' }],
        verificationCommands: []
      })
    })
    const finished = await waitForStatus(store, conv.id, ['completed', 'failed'])
    expect(finished.status).toBe('completed')

    // The in-flight execution kept its approved agent policy...
    expect(gateway.writes).toHaveLength(1)
    expect(gateway.writes[0].path).toBe('src/foo.ts')
    expect(gateway.writes[0].mode).toBe('agent')
    // ...while the persisted selection reflects the user's newer read-only mode.
    expect(store.getConversation(conv.id)!.mode).toBe('ask')

    // Manual commands are rejected outside agent mode.
    engine.updateConversationSettings({ conversationId: conv.id, mode: 'ask' })
    await expect(
      engine.runManualCommand({
        conversationId: conv.id,
        worktreeSelector: WORKTREE_SELECTOR,
        command: 'echo hi'
      })
    ).rejects.toThrow(/disabled in ask mode/)
  })

  it('answers clarification prompts directly in agent mode while preserving the awaiting plan', async () => {
    const { store, aiClient, gateway, engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'agent',
      agentId: 'claude',
      modelId: 'sonnet'
    })

    let call = 0
    aiClient.setResponder(() => {
      call += 1
      if (call === 1) {
        return {
          ok: true,
          text: JSON.stringify({
            intro: 'Prepared portfolio layout plan.',
            objective: 'Build a responsive portfolio page',
            affectedFiles: [
              { path: 'index.html', action: 'create', summary: 'Portfolio markup' },
              { path: 'styles.css', action: 'create', summary: 'Responsive styles' }
            ],
            steps: [
              {
                title: 'Create index.html',
                detail: 'Add semantic sections',
                targetFiles: ['index.html']
              },
              { title: 'Create styles.css', detail: 'Style layout', targetFiles: ['styles.css'] }
            ],
            risks: [],
            testsAndVerification: ['Open index.html in a browser'],
            estimatedComplexity: 'medium',
            requiresApproval: true
          })
        }
      }
      return { ok: true, text: 'سننشئ صفحتين فقط لعرض أعمالك بشكل مرتب.' }
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'اعمل خطة لبناء portfolio html css',
      mode: 'agent'
    })
    const awaiting = await waitForStatus(store, conv.id, ['awaiting_approval', 'failed'])
    expect(awaiting.status).toBe('awaiting_approval')
    const firstPlanId = awaiting.activePlanId

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'مش فاهم وضح',
      mode: 'agent'
    })
    const clarified = await waitForStatus(store, conv.id, [
      'awaiting_approval',
      'completed',
      'failed'
    ])
    expect(clarified.status).toBe('awaiting_approval')
    expect(clarified.plans).toHaveLength(1)
    expect(clarified.activePlanId).toBe(firstPlanId)
    expect(clarified.messages.at(-1)?.text).toBe('سننشئ صفحتين فقط لعرض أعمالك بشكل مرتب.')
    expect(aiClient.requests[1].prompt).toContain('Build a responsive portfolio page')
    expect(gateway.writes).toHaveLength(0)
  })

  it('supports direct answers and executes requested edits without a plan approval in agent mode', async () => {
    const { store, aiClient, gateway, engine } = createEngine()
    const conv = engine.createConversation({
      workspaceKey: 'wk',
      workspacePath: WORKSPACE_PATH,
      mode: 'agent',
      agentId: 'claude',
      modelId: 'sonnet'
    })

    aiClient.setResponder(() => ({
      ok: true,
      text: JSON.stringify({
        responseType: 'answer',
        message: 'هذا المشروع يستخدم HTML وCSS فقط.'
      })
    }))

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'هل المشروع فيه React؟',
      mode: 'agent'
    })
    const answered = await waitForStatus(store, conv.id, ['completed', 'failed'])
    expect(answered.status).toBe('completed')
    expect(answered.plans).toHaveLength(0)
    expect(answered.messages.at(-1)?.text).toBe('هذا المشروع يستخدم HTML وCSS فقط.')

    // Agent mode executes a multi-file edit directly even if the model asks for plan approval.
    let stepCall = 0
    aiClient.setResponder(() => {
      stepCall += 1
      if (stepCall === 1) {
        return {
          ok: true,
          text: JSON.stringify({
            intro: 'Updating hero styling.',
            objective: 'Update the page and button styling',
            affectedFiles: [
              { path: 'styles.css', action: 'create', summary: 'Add button style' },
              { path: 'index.html', action: 'create', summary: 'Add button markup' }
            ],
            steps: [
              {
                title: 'Update the button',
                detail: 'Add markup and styling',
                targetFiles: ['styles.css', 'index.html']
              }
            ],
            risks: [],
            testsAndVerification: [],
            estimatedComplexity: 'medium',
            requiresApproval: true
          })
        }
      }
      return {
        ok: true,
        text: JSON.stringify({
          summary: 'Added primary button style',
          operations: [
            { path: 'styles.css', action: 'create', content: '.btn { color: #fff; }\n' },
            { path: 'index.html', action: 'create', content: '<button class="btn">Go</button>\n' }
          ],
          verificationCommands: []
        })
      }
    })

    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'add button color in styles.css',
      mode: 'agent'
    })
    const completed = await waitForStatus(store, conv.id, ['completed', 'failed'])
    expect(completed.status).toBe('completed')
    expect(gateway.writes.map((w) => w.path)).toEqual(['styles.css', 'index.html'])

    // Plan mode must still wait for approval even if requiresApproval is false.
    stepCall = 0
    await engine.sendPrompt({
      conversationId: conv.id,
      worktreeSelector: WORKTREE_SELECTOR,
      text: 'add another rule in styles.css',
      mode: 'plan'
    })
    const planAwaiting = await waitForStatus(store, conv.id, ['awaiting_approval', 'failed'])
    expect(planAwaiting.status).toBe('awaiting_approval')
    expect(gateway.writes).toHaveLength(2)
  })
})

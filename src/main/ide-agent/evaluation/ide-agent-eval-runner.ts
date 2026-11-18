import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { IdeConversation, IdeRunStatus } from '../../../shared/ide-agent/ide-agent-types'
import { normalizeWorkspaceRelativePath } from '../../../shared/ide-agent/ide-plan-policy'
import { IdeAgentEngine } from '../ide-agent-engine'
import { IdeAgentStore } from '../ide-agent-persistence'
import type { IdeAiClient, IdeAiCompletionRequest, IdeAiCompletionResponse } from '../ide-ai-client'
import { LocalIdeWorkspaceGateway, type WorkspaceCommandRunResult } from '../ide-workspace-gateway'
import { aggregateIdeAgentEvalReport } from './ide-agent-eval-metrics'
import { ADVANCED_EVAL_SCENARIOS } from './ide-agent-eval-scenarios-advanced'
import { CORE_EVAL_SCENARIOS, type EvalScenarioDefinition } from './ide-agent-eval-scenarios-core'
import { PLATFORM_EVAL_SCENARIOS } from './ide-agent-eval-scenarios-platform'
import { RESILIENCE_EVAL_SCENARIOS } from './ide-agent-eval-scenarios-resilience'
import type { IdeAgentEvalScenarioMetrics, IdeAgentEvalSuiteReport } from './ide-agent-eval-types'

class EvalAiClient implements IdeAiClient {
  requests: IdeAiCompletionRequest[] = []
  completions: string[] = []
  onFirstRequest?: () => void
  private turn = 0
  private responder: (
    req: IdeAiCompletionRequest,
    turn: number
  ) => Promise<IdeAiCompletionResponse> | IdeAiCompletionResponse = async () => ({
    ok: true,
    text: 'ok'
  })

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
        defaultModelId: 'sonnet',
        supportsStreaming: true,
        supportsToolLoop: true,
        models: [{ id: 'sonnet', label: 'Sonnet', isDefault: true, contextWindowTokens: 200_000 }]
      },
      {
        id: 'codex',
        label: 'Codex',
        binary: 'codex',
        available: true,
        defaultModelId: 'gpt-5.4',
        supportsStreaming: true,
        supportsToolLoop: true,
        models: [{ id: 'gpt-5.4', label: 'GPT-5.4', isDefault: true, contextWindowTokens: 200_000 }]
      },
      {
        id: 'cursor',
        label: 'Cursor',
        binary: 'cursor-agent',
        available: true,
        defaultModelId: 'auto',
        supportsStreaming: true,
        supportsToolLoop: true,
        models: [{ id: 'auto', label: 'Auto', isDefault: true, contextWindowTokens: 128_000 }]
      }
    ]
  }

  async complete(request: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> {
    this.requests.push(request)
    this.turn += 1
    if (this.turn === 1) {
      this.onFirstRequest?.()
    }
    const res = await this.responder(request, this.turn)
    if (res.ok) {
      this.completions.push(res.text)
    }
    return res
  }
}

class EvalWorkspaceGateway extends LocalIdeWorkspaceGateway {
  shellResponder: (cmd: string) => Promise<WorkspaceCommandRunResult> | WorkspaceCommandRunResult =
    async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      canceled: false,
      timedOut: false,
      durationMs: 5
    })

  override async runShellCommand(command: string): Promise<WorkspaceCommandRunResult> {
    return this.shellResponder(command)
  }
}

function waitForTerminalStatus(
  engine: IdeAgentEngine,
  store: IdeAgentStore,
  conversationId: string
): Promise<IdeConversation> {
  const terminal: readonly IdeRunStatus[] = ['completed', 'failed', 'canceled', 'awaiting_approval']
  const current = store.getConversation(conversationId)
  if (current && terminal.includes(current.status)) {
    return Promise.resolve(current)
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub()
      reject(new Error(`Eval scenario timed out for conversation ${conversationId}`))
    }, 10_000)
    const unsub = engine.subscribe((event) => {
      if (event.type === 'conversation_updated' && terminal.includes(event.conversation.status)) {
        clearTimeout(timeout)
        unsub()
        resolve(event.conversation)
      }
    }, conversationId)
  })
}

async function runSingleScenario(
  scenario: EvalScenarioDefinition
): Promise<IdeAgentEvalScenarioMetrics> {
  const dir = await mkdtemp(join(tmpdir(), `orca-ide-eval-${scenario.id}-`))
  const store = new IdeAgentStore(':memory:')
  const aiClient = new EvalAiClient()
  const gateway = new EvalWorkspaceGateway({
    worktreeId: `eval-${scenario.id}`,
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
  await engine.listProviders(dir)

  const startedAt = performance.now()
  try {
    let lastConv: IdeConversation | null = null
    const outcome = await scenario.execute(
      {
        dir,
        requests: aiClient.requests,
        setAiResponder: (fn) => aiClient.setResponder(fn),
        setShellResponder: (fn) => {
          gateway.shellResponder = fn
        }
      },
      async (input) => {
        const conv = engine.createConversation({
          workspaceKey: dir,
          workspacePath: dir,
          mode: input.mode,
          agentId: input.agentId ?? 'claude',
          modelId: input.modelId
        })
        if (input.priorMessages && input.priorMessages.length > 0) {
          const seeded = store.getConversation(conv.id)!
          let ts = Date.now() - input.priorMessages.length * 1000
          for (const msg of input.priorMessages) {
            ts += 500
            seeded.messages.push({
              id: randomUUID(),
              conversationId: conv.id,
              role: msg.role,
              mode: input.mode,
              text: msg.text,
              createdAt: ts,
              updatedAt: ts
            })
          }
          store.saveConversation(seeded)
        }

        const engineForReload = input.priorMessages?.length
          ? new IdeAgentEngine({
              store,
              aiClient,
              resolveGateway: async () => gateway,
              defaultAgentId: 'claude',
              chunkDelayMs: 0
            })
          : engine

        if (input.cancelOnFirstRequest) {
          aiClient.onFirstRequest = () => {
            const activeRunId = store.getConversation(conv.id)?.activeRunId ?? undefined
            void engineForReload.handleRunControl({
              conversationId: conv.id,
              runId: activeRunId,
              action: 'stop'
            })
          }
        }

        await engineForReload.sendPrompt({
          conversationId: conv.id,
          worktreeSelector: dir,
          text: input.text,
          mode: input.mode,
          agentId: input.agentId,
          modelId: input.modelId,
          activeFilePath: input.activeFilePath
        })
        const settled = await waitForTerminalStatus(engineForReload, store, conv.id)
        lastConv = settled
        const lastAssistant = [...settled.messages].toReversed().find((m) => m.role === 'assistant')
        return {
          status: settled.status,
          lastText: lastAssistant?.text ?? '',
          error: lastAssistant?.error,
          toolCallsCount: settled.runTelemetry?.at(-1)?.toolCalls ?? 0,
          unnecessaryToolsCount: settled.runTelemetry?.at(-1)?.blockedToolCalls ?? 0,
          failedEditsCount: settled.runTelemetry?.at(-1)?.failedEdits ?? 0,
          verificationPassed:
            settled.commandExecutions.length > 0 &&
            settled.commandExecutions.at(-1)?.status === 'passed'
        }
      }
    )

    const latencyMs = Math.round(performance.now() - startedAt)
    const promptChars = aiClient.requests.reduce((sum, r) => sum + r.prompt.length, 0)
    const completionChars = aiClient.completions.reduce((sum, c) => sum + c.length, 0)
    const allPromptsCombined = aiClient.requests.map((r) => r.prompt).join('\n')
    const matchedTargets = scenario.targetContextPaths.filter((p) =>
      allPromptsCombined.includes(normalizeWorkspaceRelativePath(p))
    ).length
    const totalTargets = scenario.targetContextPaths.length
    const contextRelevanceRatio = totalTargets > 0 ? matchedTargets / totalTargets : 1

    const finalConv = lastConv as IdeConversation | null
    const telemetry = finalConv?.runTelemetry?.at(-1)
    const verPassed =
      scenario.verificationApplicable &&
      outcome.passed &&
      Boolean(
        finalConv &&
        finalConv.commandExecutions.length > 0 &&
        finalConv.commandExecutions.at(-1)?.status === 'passed'
      )

    const estimatedInputTokens = Math.ceil(promptChars / 4)
    const estimatedOutputTokens = Math.ceil(completionChars / 4)

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      passed: outcome.passed,
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      verificationApplicable: scenario.verificationApplicable,
      verificationPassed: verPassed,
      incorrectModification: Boolean(outcome.incorrectModification),
      llmRequests: aiClient.requests.length,
      toolInvocations: telemetry?.toolCalls ?? 0,
      unnecessaryToolCalls: telemetry?.blockedToolCalls ?? 0,
      contextRelevantTargets: matchedTargets,
      contextTotalTargets: totalTargets,
      contextRelevanceRatio,
      promptChars,
      completionChars,
      estimatedInputTokens,
      estimatedOutputTokens,
      totalEstimatedTokens: estimatedInputTokens + estimatedOutputTokens,
      latencyMs,
      failedEdits: outcome.passed ? 0 : Math.max(1, telemetry?.failedEdits ?? 0),
      recoveryApplicable: scenario.recoveryApplicable,
      recoverySucceeded: Boolean(outcome.recoverySucceeded)
    }
  } finally {
    store.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 30 })
  }
}

export async function runIdeAgentEvaluationSuite(label: string): Promise<IdeAgentEvalSuiteReport> {
  const allScenarios: readonly EvalScenarioDefinition[] = [
    ...CORE_EVAL_SCENARIOS,
    ...ADVANCED_EVAL_SCENARIOS,
    ...RESILIENCE_EVAL_SCENARIOS,
    ...PLATFORM_EVAL_SCENARIOS
  ]
  const results: IdeAgentEvalScenarioMetrics[] = []
  for (const scenario of allScenarios) {
    results.push(await runSingleScenario(scenario))
  }
  return aggregateIdeAgentEvalReport(label, results)
}

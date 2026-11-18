import type {
  IdeConversation,
  IdeRunTelemetrySummary
} from '../../../shared/ide-agent/ide-agent-types'
import type { IdeAiClient, IdeAiCompletionRequest, IdeAiCompletionResponse } from '../ide-ai-client'

const MAX_RETAINED_RUN_TELEMETRY = 25

export class AgentRunTelemetryCollector {
  private readonly startedAt = Date.now()
  private llmCalls = 0
  private promptChars = 0
  private completionChars = 0
  private toolCalls = 0
  private blockedToolCalls = 0
  private failedEdits = 0
  private recoveredErrors = 0
  private subagentRuns = 0
  private compactedMessages = 0
  private verificationChecksRun = 0
  private verificationChecksPassed = 0

  constructor(
    private readonly runId: string,
    private readonly agentId: string,
    private readonly modelId: string
  ) {}

  wrapAiClient(baseClient: IdeAiClient): IdeAiClient {
    return {
      listProviders: (sel) => baseClient.listProviders(sel),
      complete: async (req: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> => {
        this.llmCalls += 1
        this.promptChars += req.prompt.length
        const res = await baseClient.complete(req)
        if (res.ok) {
          this.completionChars += res.text.length
        }
        return res
      }
    }
  }

  recordToolCall(blocked = false): void {
    if (blocked) {
      this.blockedToolCalls += 1
    } else {
      this.toolCalls += 1
    }
  }

  recordFailedEdit(): void {
    this.failedEdits += 1
  }

  recordRecoveredError(): void {
    this.recoveredErrors += 1
  }

  recordSubagentRun(count = 1): void {
    this.subagentRuns += count
  }

  recordCompactedMessages(count: number): void {
    this.compactedMessages = Math.max(this.compactedMessages, count)
  }

  recordVerificationOutcome(passed: boolean): void {
    this.verificationChecksRun += 1
    if (passed) {
      this.verificationChecksPassed += 1
    }
  }

  finalizeIntoConversation(conv: IdeConversation): IdeRunTelemetrySummary {
    const finishedAt = Date.now()
    const summary: IdeRunTelemetrySummary = {
      runId: this.runId,
      agentId: this.agentId,
      modelId: this.modelId,
      startedAt: this.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - this.startedAt),
      llmCalls: this.llmCalls,
      promptChars: this.promptChars,
      completionChars: this.completionChars,
      estimatedInputTokens: Math.ceil(this.promptChars / 4),
      estimatedOutputTokens: Math.ceil(this.completionChars / 4),
      toolCalls: this.toolCalls,
      blockedToolCalls: this.blockedToolCalls,
      failedEdits: this.failedEdits,
      recoveredErrors: this.recoveredErrors,
      subagentRuns: this.subagentRuns,
      compactedMessages: this.compactedMessages,
      verificationChecksRun: this.verificationChecksRun,
      verificationChecksPassed: this.verificationChecksPassed
    }
    const existing = conv.runTelemetry ?? []
    const filtered = existing.filter((item) => item.runId !== this.runId)
    conv.runTelemetry = [...filtered, summary].slice(-MAX_RETAINED_RUN_TELEMETRY)
    return summary
  }
}

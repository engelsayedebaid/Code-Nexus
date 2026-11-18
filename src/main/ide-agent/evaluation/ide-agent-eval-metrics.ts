import type { IdeAgentEvalScenarioMetrics, IdeAgentEvalSuiteReport } from './ide-agent-eval-types'

export function aggregateIdeAgentEvalReport(
  label: string,
  results: IdeAgentEvalScenarioMetrics[]
): IdeAgentEvalSuiteReport {
  const passedScenarios = results.filter((r) => r.passed).length
  const verApplicable = results.filter((r) => r.verificationApplicable)
  const verPassed = verApplicable.filter((r) => r.verificationPassed).length
  const recApplicable = results.filter((r) => r.recoveryApplicable)
  const recPassed = recApplicable.filter((r) => r.recoverySucceeded).length
  const totalTokens = results.reduce((s, r) => s + r.totalEstimatedTokens, 0)
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0)
  const relevanceItems = results.filter((r) => r.contextTotalTargets > 0)

  return {
    label,
    executedAtIso: new Date().toISOString(),
    totalScenarios: results.length,
    passedScenarios,
    taskSuccessRate: Number(((passedScenarios / results.length) * 100).toFixed(1)),
    verificationPassRate:
      verApplicable.length > 0
        ? Number(((verPassed / verApplicable.length) * 100).toFixed(1))
        : null,
    incorrectModificationRate: Number(
      ((results.filter((r) => r.incorrectModification).length / results.length) * 100).toFixed(1)
    ),
    totalToolInvocations: results.reduce((s, r) => s + r.toolInvocations, 0),
    unnecessaryToolCalls: results.reduce((s, r) => s + r.unnecessaryToolCalls, 0),
    averageContextRelevance:
      relevanceItems.length > 0
        ? Number(
            (
              (relevanceItems.reduce((s, r) => s + r.contextRelevanceRatio, 0) /
                relevanceItems.length) *
              100
            ).toFixed(1)
          )
        : 100,
    totalEstimatedTokens: totalTokens,
    averageTokensPerTask: Math.round(totalTokens / results.length),
    totalLatencyMs: totalLatency,
    averageLatencyMs: Math.round(totalLatency / results.length),
    totalFailedEdits: results.reduce((s, r) => s + r.failedEdits, 0),
    errorRecoverySuccessRate:
      recApplicable.length > 0
        ? Number(((recPassed / recApplicable.length) * 100).toFixed(1))
        : null,
    unavailableMetrics: [
      'Estimated API cost ($): CLI-routed providers (Claude/Codex/Cursor/Copilot) bill per subscription/CLI account without returning per-token USD invoices to Orca.'
    ],
    scenarios: results
  }
}
